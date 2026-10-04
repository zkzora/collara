// DEVNET worker wiring with a local mock issuer and a fake JSON Ledger API: the projector reads as exactly the bound
// Collara parties through the tenant user's OIDC token, PROJECTION_PARTIES can only narrow that set, and the worker
// and an API-side provider sharing ledger_credentials never send one refresh token twice. The opt-in block repeats
// the last check with two separate PostgreSQL pools (two processes' worth of connections) when
// DEVNET_CREDENTIALS_PG_URL names a throw-away database whose name contains "devnet".
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devnetCredentialId, OidcRefreshTokenProvider, remoteJwks } from "@collara/canton";
import { startMockOidcIssuer, type MockOidcIssuer } from "@collara/canton/testing";
import { createPgDatabase, createPgliteDatabase, PgRefreshTokenStore, type DbHandle } from "@collara/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { connectDevnetLedger } from "./ledger";

const USER = "c2ede6f6-0000-4000-8000-00000000beef";
const AUDIENCE = "https://hackcanton-01.devnet.naas.noders.services";
const API = "https://ledger.devnet.invalid";
const HINTS = ["CollaraRegistrar", "CollaraGovernance", "DemoManufacturer", "DemoCNCDealer", "DemoVerifier", "DemoLenderA", "DemoLenderB", "DemoAuditor", "GovSeat1", "GovSeat2", "GovSeat3"];
const party = (hint: string) => `c2ede6f6-${hint}::1220aa`;
const OTHER = "c2ede6f6-unrelated::1220aa";

function devnetState() {
  const bound = HINTS.map(party);
  return {
    version: 1,
    bootstrappedAt: "2026-10-04T00:00:00Z",
    topology: "devnet-shared-participant",
    cantonVersion: "3.5.19",
    audience: AUDIENCE,
    jsonApiUrl: API,
    participantId: "PAR::noders::1220",
    participants: { devnet: { jsonApiUrl: API, participantId: "PAR::noders::1220", ledgerEndAtBootstrap: 100 } },
    parties: Object.fromEntries(HINTS.map((hint) => [hint, { party: party(hint), participant: "devnet", user: USER }])),
    // A tampered state that also lists an unrelated party: the projector must still read only the bound ones.
    users: [{ id: USER, participant: "devnet", role: "tenant", actAs: bound, readAs: [...bound, OTHER] }],
    packages: [],
    namespace: "collara-devnet-test",
  };
}

/** Fake JSON API: records the bearer token per call and answers ledger-end. */
function fakeLedger() {
  const tokens: string[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    tokens.push(request.headers.get("authorization") ?? "");
    if (new URL(request.url).pathname === "/v2/state/ledger-end") return Response.json({ offset: 123 });
    return new Response("not found", { status: 404 });
  };
  return { tokens, fetch: fetchImpl as typeof fetch };
}

let issuer: MockOidcIssuer;
let dir: string;
let statePath: string;

beforeAll(async () => {
  issuer = await startMockOidcIssuer({ claims: { sub: USER, aud: [AUDIENCE], scope: "openid daml_ledger_api offline_access", expiresIn: 10_800 } });
  dir = await mkdtemp(join(tmpdir(), "collara-devnet-"));
  statePath = join(dir, "state.json");
  await writeFile(statePath, JSON.stringify(devnetState()));
});
afterAll(async () => {
  await issuer.close();
  await rm(dir, { recursive: true, force: true });
});

const oidc = () => ({ issuer: issuer.issuer, tokenEndpoint: issuer.tokenEndpoint, jwksUri: issuer.jwksUri, clientId: issuer.clientId, allowInsecureHttp: true });
const config = (extra: Record<string, string> = {}) =>
  loadConfig({
    COLLARA_MODE: "DEVNET",
    DATABASE_URL: "postgres://collara:unused@127.0.0.1:5432/collara_devnet",
    DEVNET_LEDGER_USER_ID: USER,
    COLLARA_DEVNET_STATE: statePath,
    ...extra,
  });

async function storeLogin(db: DbHandle) {
  await new PgRefreshTokenStore(db.db).storeLogin({
    id: devnetCredentialId(USER),
    ledgerUserId: USER,
    issuer: issuer.issuer,
    clientId: issuer.clientId,
    refreshToken: issuer.issueRefreshToken(),
    accessTokenExpiresAt: new Date(),
  });
}

describe("worker DEVNET config", () => {
  it("refuses the LocalNet database, a LocalNet state and HMAC", () => {
    expect(config().COLLARA_MODE).toBe("DEVNET");
    expect(() => config({ DATABASE_URL: "postgres://collara:x@127.0.0.1:5432/collara" })).toThrow(/refuses database/);
    expect(() => config({ COLLARA_LOCALNET_STATE: "state.json" })).toThrow(/COLLARA_LOCALNET_STATE/);
    expect(() => config({ CANTON_JWT_HMAC_SECRET: "collara-local-dev-secret-change-me" })).toThrow(/refuses HMAC/);
  });
});

describe("connectDevnetLedger (PGlite + mock issuer)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createPgliteDatabase();
    await storeLogin(handle);
  });
  afterAll(async () => {
    await handle.close();
  });

  it("projects as exactly the bound parties with the tenant's OIDC token", async () => {
    const ledger = fakeLedger();
    const worker = await connectDevnetLedger(config(), handle.db, { fetch: ledger.fetch, oidc: oidc() });
    expect(worker.sources).toHaveLength(1);
    const [source] = worker.sources;
    expect(source?.config).toMatchObject({ source: "devnet", ledgerUserId: USER });
    expect([...(source?.config.parties ?? [])].sort()).toEqual(HINTS.map(party).sort());
    expect(source?.config.parties).not.toContain(OTHER);
    expect(await source?.client.ledgerEnd()).toBe(123);
    expect(ledger.tokens[0]).toMatch(/^Bearer ey/);
    expect(worker.completionClient(USER, null)).not.toBeNull();
    expect(worker.completionClient("someone-else", null)).toBeNull();
  });

  it("PROJECTION_PARTIES may narrow the set but never add a party", async () => {
    const narrowed = await connectDevnetLedger(config({ PROJECTION_PARTIES: party("DemoLenderA") }), handle.db, { oidc: oidc() });
    expect(narrowed.sources[0]?.config.parties).toEqual([party("DemoLenderA")]);
    await expect(connectDevnetLedger(config({ PROJECTION_PARTIES: `${party("DemoLenderA")},${OTHER}` }), handle.db, { oidc: oidc() })).rejects.toThrow(
      /not bound Collara parties/,
    );
  });

  it("the worker and an API-side provider sharing the store never reuse a refresh token", async () => {
    issuer.delayMs = 30;
    const before = issuer.refreshCount();
    const ledger = fakeLedger();
    const worker = await connectDevnetLedger(config(), handle.db, { fetch: ledger.fetch, oidc: oidc() });
    const api = new OidcRefreshTokenProvider({
      settings: { ...oidc(), audience: AUDIENCE, ledgerUserId: USER },
      store: new PgRefreshTokenStore(handle.db),
      jwks: remoteJwks(issuer.jwksUri),
    });
    await Promise.all([worker.sources[0]?.client.ledgerEnd(), api.getToken(), api.getToken()]);
    expect(issuer.refreshCount() - before).toBe(2);
    expect(issuer.reuseCount()).toBe(0);
    issuer.delayMs = 0;
  });
});

const PG_URL = process.env.DEVNET_CREDENTIALS_PG_URL;

describe.skipIf(!PG_URL)("refresh lock across two PostgreSQL pools (opt-in)", () => {
  it("serialises refreshes from two pools: one refresh token is never sent twice", async () => {
    const a = createPgDatabase({ url: PG_URL ?? "", max: 2, applicationName: "devnet-lock-a" });
    const b = createPgDatabase({ url: PG_URL ?? "", max: 2, applicationName: "devnet-lock-b" });
    try {
      await a.migrate();
      await storeLogin(a);
      issuer.delayMs = 50;
      const before = issuer.refreshCount();
      const reusesBefore = issuer.reuseCount();
      const provider = (handle: DbHandle) =>
        new OidcRefreshTokenProvider({ settings: { ...oidc(), audience: AUDIENCE, ledgerUserId: USER }, store: new PgRefreshTokenStore(handle.db), jwks: remoteJwks(issuer.jwksUri) });
      const providers = [provider(a), provider(b), provider(a), provider(b)];
      await Promise.all(providers.map((p) => p.getToken()));
      expect(issuer.refreshCount() - before).toBe(4);
      expect(issuer.reuseCount() - reusesBefore).toBe(0);
      expect((await new PgRefreshTokenStore(b.db).status(devnetCredentialId(USER)))?.status).toBe("ACTIVE");
    } finally {
      issuer.delayMs = 0;
      await a.close();
      await b.close();
    }
  });
});
