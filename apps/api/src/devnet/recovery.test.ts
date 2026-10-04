// scripts/devnet/recover.mjs, diagnose mode, against a fake DevNet JSON API (the real LedgerClient over a fake fetch),
// PGlite and a temporary state file: one test per recovery case checks the printed case and the exact next
// commands. planNewRun is checked for idempotency (a completed run plans "bootstrap only") and for the history floor
// after pruning. Synthetic data; nothing contacts DevNet.
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devnetCredentialId, diagnoseDevnet, formatDiagnosis, LedgerClient, LedgerCredentialError } from "@collara/canton";
import { CredentialCipher, ledgerCredentials, ledgerSources, PgRefreshTokenStore, resetProjectionSource, type DbHandle } from "@collara/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seededDb } from "../test-support";
import { buildDevnetState, COLLARA_PARTIES, DEVNET_SOURCE, type CollaraPartyHint } from "./bindings";
import type { ManifestEntry } from "./preflight";
import { generatedRunRef, observeDevnet, planNewRun } from "./recovery";

const USER = "c2ede6f6-0000-4000-8000-00000000beef";
const API = "https://ledger.devnet.invalid";
const PARTICIPANT = "PAR::noders::1220aa";
const party = (hint: string) => `c2ede6f6-${hint}::1220aa`;
const PARTIES = Object.fromEntries(COLLARA_PARTIES.map(({ hint }) => [hint, party(hint)])) as Record<CollaraPartyHint, string>;
const PKG = "1c0e5e62" + "0".repeat(56);
const MANIFEST: ManifestEntry[] = [{ order: 2, file: "collara-contracts-0.2.0.dar", sizeBytes: 1, sha256: "00", mainPackageId: PKG, name: "collara-contracts", version: "0.2.0", embeds: [] }];
const K1 = { id: "k1", key: new Uint8Array(randomBytes(32)) };

interface FakeLedgerState {
  participantId: string;
  ledgerEnd: number;
  prunedUpTo: number;
  actAs: string[];
  packages: string[];
  vetted: string[];
  down: boolean;
  tokenError: Error | null;
}

const healthyLedger = (): FakeLedgerState => ({
  participantId: PARTICIPANT,
  ledgerEnd: 100,
  prunedUpTo: 0,
  actAs: Object.values(PARTIES),
  packages: [PKG],
  vetted: [PKG],
  down: false,
  tokenError: null,
});

function fakeClient(ledger: FakeLedgerState): LedgerClient {
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (ledger.down) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === "/v2/parties/participant-id") return Response.json({ participantId: ledger.participantId });
    if (path === "/v2/state/ledger-end") return Response.json({ offset: ledger.ledgerEnd });
    if (path === "/v2/state/latest-pruned-offsets") return Response.json({ participantPrunedUpToInclusive: ledger.prunedUpTo, allDivulgedContractsPrunedUpToInclusive: 0 });
    if (path === `/v2/users/${USER}/rights`) return Response.json({ rights: ledger.actAs.flatMap((p) => [{ kind: { CanActAs: { value: { party: p } } } }, { kind: { CanReadAs: { value: { party: p } } } }]) });
    if (path === "/v2/packages") return Response.json({ packageIds: ledger.packages });
    if (path === "/v2/package-vetting/list") {
      return Response.json({ vettedPackages: [{ participantId: ledger.participantId, synchronizerId: "sync::1220", topologySerial: 1, packages: ledger.vetted.map((packageId) => ({ packageId })) }], nextPageToken: "" });
    }
    return new Response(JSON.stringify({ code: "NOT_FOUND", cause: path }), { status: 404 });
  };
  return new LedgerClient({
    baseUrl: API,
    fetch: fetchImpl as typeof fetch,
    tokenProvider: { getToken: async () => (ledger.tokenError ? Promise.reject(ledger.tokenError) : "access-token") },
  });
}

let handle: DbHandle;
let dir: string;
let statePath: string;
let ledger: FakeLedgerState;
const store = () => new PgRefreshTokenStore(handle.db, { cipher: new CredentialCipher({ current: K1, previous: [] }) });

async function writeState(participantId = PARTICIPANT, namespace = "collara-devnet-r1") {
  const state = buildDevnetState({ ledgerUserId: USER, jsonApiUrl: API, participantId, ledgerEnd: 50, cantonVersion: "3.5.19", audience: "aud", parties: PARTIES, packages: [], namespace });
  await writeFile(statePath, JSON.stringify(state));
}

async function diagnose(options: { db?: DbHandle | null; store?: PgRefreshTokenStore } = {}) {
  const db = options.db === undefined ? handle : options.db;
  const detail = await observeDevnet({
    db: db?.db ?? null,
    databaseError: db ? undefined : "connect ECONNREFUSED 127.0.0.1:5432",
    store: db ? (options.store ?? store()) : null,
    credentialId: devnetCredentialId(USER),
    ledgerUserId: USER,
    client: fakeClient(ledger),
    statePath,
    manifest: MANIFEST,
  });
  const diagnosis = diagnoseDevnet(detail.observation);
  return { ...detail, diagnosis, text: formatDiagnosis(diagnosis) };
}

async function setProjection(values: Partial<typeof ledgerSources.$inferInsert>) {
  await handle.db.delete(ledgerSources).where(eq(ledgerSources.source, DEVNET_SOURCE));
  await handle.db.insert(ledgerSources).values({ source: DEVNET_SOURCE, participantId: PARTICIPANT, jsonApiUrl: API, checkpointOffset: 90, ...values });
}

beforeAll(async () => {
  handle = await seededDb();
  dir = await mkdtemp(join(tmpdir(), "collara-recover-"));
  statePath = join(dir, "state.json");
});
afterAll(async () => {
  await handle.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  ledger = healthyLedger();
  await handle.db.delete(ledgerCredentials);
  await handle.db.delete(ledgerSources);
  await store().storeLogin({ id: devnetCredentialId(USER), ledgerUserId: USER, issuer: "https://idp.example/r", clientId: "c", refreshToken: "rt-secret", accessTokenExpiresAt: new Date() });
  await writeState();
  await setProjection({});
});

describe("recover.mjs diagnose (fake ledger)", () => {
  it("OK: nothing to recover", async () => {
    const { diagnosis, text } = await diagnose();
    expect(diagnosis.primary).toBe("OK");
    expect(text).toContain("nothing to recover");
    expect(text).not.toContain("rt-secret");
  });

  it("DATABASE_MISSING: unreachable, or not migrated (lost database)", async () => {
    const down = await diagnose({ db: null });
    expect(down.diagnosis.primary).toBe("DATABASE_MISSING");
    expect(down.text).toContain("pnpm db:up");
    const empty = await (await import("@collara/db")).createPgliteDatabase({ migrate: false });
    try {
      const lost = await diagnose({ db: empty });
      expect(lost.diagnosis).toMatchObject({ primary: "DATABASE_MISSING", newRunRequired: true });
      expect(lost.text).toContain("node scripts/devnet/db-setup.mjs");
      expect(lost.text).toContain("node scripts/devnet/recover.mjs --new-run --yes");
    } finally {
      await empty.close();
    }
  });

  it("CREDENTIAL_MISSING and CREDENTIAL_REVOKED: log in again", async () => {
    await handle.db.delete(ledgerCredentials);
    const missing = await diagnose();
    expect(missing.diagnosis.primary).toBe("CREDENTIAL_MISSING");
    expect(missing.text).toContain("node scripts/devnet/login.mjs");

    await store().storeLogin({ id: devnetCredentialId(USER), ledgerUserId: USER, issuer: "https://idp.example/r", clientId: "c", refreshToken: "rt-secret", accessTokenExpiresAt: new Date() });
    await store().withCredential(devnetCredentialId(USER), async () => ({ update: { kind: "rejected", reason: "The identity provider rejected the stored refresh token (invalid_grant)" }, value: null }));
    const revoked = await diagnose();
    expect(revoked.diagnosis.primary).toBe("CREDENTIAL_REVOKED");
    expect(revoked.text).toMatch(/\[CREDENTIAL_REVOKED\].*invalid_grant/);
    expect(revoked.text).toContain("winpty node scripts/devnet/login.mjs");
  });

  it("CREDENTIAL_REVOKED found by the ledger call (token refresh rejected right now)", async () => {
    ledger.tokenError = new LedgerCredentialError("REFRESH_REJECTED", "The identity provider rejected the stored refresh token (invalid_grant). Run node scripts/devnet/login.mjs again");
    const { diagnosis, text } = await diagnose();
    expect(diagnosis.primary).toBe("CREDENTIAL_REVOKED");
    expect(text).toContain("node scripts/devnet/login.mjs");
  });

  it("CREDENTIAL_KEY: the configured key does not open the row", async () => {
    const other = new PgRefreshTokenStore(handle.db, { cipher: new CredentialCipher({ current: { id: "k2", key: new Uint8Array(randomBytes(32)) }, previous: [] }) });
    const { diagnosis, text } = await diagnose({ store: other });
    expect(diagnosis.primary).toBe("CREDENTIAL_KEY");
    expect(text).toContain("DEVNET_CREDENTIAL_KEY_PREVIOUS=<old id>:<old key>");
    expect(text).not.toContain(Buffer.from(K1.key).toString("base64"));
  });

  it("LEDGER_UNREACHABLE", async () => {
    ledger.down = true;
    const { diagnosis, text } = await diagnose();
    expect(diagnosis.primary).toBe("LEDGER_UNREACHABLE");
    expect(text).toContain("ECONNREFUSED");
    expect(text).toContain("node scripts/devnet/preflight.mjs");
  });

  it("LEDGER_RESET: new participant id, ledger end behind the checkpoint", async () => {
    ledger.participantId = "PAR::noders::1220bb";
    ledger.ledgerEnd = 3;
    const { diagnosis, text } = await diagnose();
    expect(diagnosis).toMatchObject({ primary: "LEDGER_RESET", newRunRequired: true });
    expect(text).toContain("ledger end 3 is behind the projection checkpoint 90");
    expect(text).toContain("node scripts/devnet/recover.mjs --new-run --yes");
  });

  it("PRUNED: pruned past the checkpoint (new run), or within retention (resume)", async () => {
    ledger.prunedUpTo = 95;
    const pruned = await diagnose();
    expect(pruned.diagnosis).toMatchObject({ primary: "PRUNED", newRunRequired: true });
    expect(pruned.text).toContain("cannot be rebuilt from before the pruning horizon");
    expect(pruned.text).toContain("the projection restarts at offset 95");

    ledger.prunedUpTo = 80;
    const within = await diagnose();
    expect(within.diagnosis.primary).toBe("OK");
    expect(within.text).toMatch(/WARN\s+pruning\s+pruned up to offset 80; the projection checkpoint 90 is still within retention/);
  });

  it("PARTIES_MISSING: names the parties the tenant user lost", async () => {
    ledger.actAs = Object.values(PARTIES).filter((p) => p !== PARTIES.DemoLenderA && p !== PARTIES.GovSeat2);
    const { diagnosis, text } = await diagnose();
    expect(diagnosis.primary).toBe("PARTIES_MISSING");
    expect(text).toContain(`DemoLenderA (${PARTIES.DemoLenderA})`);
    expect(text).toContain(`GovSeat2 (${PARTIES.GovSeat2})`);
    expect(text).toContain("noders-rights-request.md");
  });

  it("PACKAGES_MISSING: present but not vetted, or absent", async () => {
    ledger.vetted = [];
    const unvetted = await diagnose();
    expect(unvetted.diagnosis.primary).toBe("PACKAGES_MISSING");
    expect(unvetted.text).toContain("collara-contracts 0.2.0 (1c0e5e620000…) present, NOT vetted");
    ledger.packages = [];
    expect((await diagnose()).text).toContain("NOT present, NOT vetted");
    expect((await diagnose()).text).toContain("bump the package version");
  });

  it("STATE_MISSING: no state file", async () => {
    await rm(statePath);
    const { diagnosis, text } = await diagnose();
    expect(diagnosis.primary).toBe("STATE_MISSING");
    expect(text).toContain("node scripts/devnet/recover.mjs --new-run --yes");
  });
});

describe("recover.mjs --new-run plan", () => {
  const now = new Date("2026-10-04T15:30:00Z");

  it("refuses while a blocker (credential, parties, packages) is unresolved", async () => {
    await handle.db.delete(ledgerCredentials);
    const { observation, diagnosis } = await diagnose();
    expect(planNewRun({ diagnosis, observation, currentNamespace: "collara-devnet-r1", now }).refusal).toMatch(/CREDENTIAL_MISSING must be fixed first/);
  });

  it("after a reset: new namespace, projection reset from 0; once done the plan is bootstrap only (idempotent)", async () => {
    ledger.participantId = "PAR::noders::1220bb";
    ledger.ledgerEnd = 3;
    const { observation, diagnosis, state } = await diagnose();
    const plan = planNewRun({ diagnosis, observation, currentNamespace: state?.namespace ?? null, now });
    expect(plan).toEqual({ refusal: null, importRunRef: generatedRunRef(now), resetProjection: { startOffset: 0, reason: "participant changed, ledger end behind checkpoint" }, bootstrap: true });
    expect(plan.importRunRef).toBe("r202610041530");

    // What --new-run then does to the DB and state (import writes the state; the projection source is reset).
    await writeState(ledger.participantId, "collara-devnet-r202610041530");
    await resetProjectionSource(handle.db, DEVNET_SOURCE, { participantId: ledger.participantId, jsonApiUrl: API, startOffset: 0 });
    const again = await diagnose();
    expect(again.diagnosis.primary).toBe("OK");
    expect(planNewRun({ diagnosis: again.diagnosis, observation: again.observation, currentNamespace: again.state?.namespace ?? null, now })).toEqual({
      refusal: null,
      importRunRef: null,
      resetProjection: null,
      bootstrap: true,
    });
  });

  it("after pruning: new namespace and a projection restarted at the pruning offset (history floor)", async () => {
    ledger.prunedUpTo = 95;
    const { observation, diagnosis, state } = await diagnose();
    const plan = planNewRun({ diagnosis, observation, requestedRunRef: "r2", currentNamespace: state?.namespace ?? null, now });
    expect(plan).toMatchObject({ importRunRef: "r2", resetProjection: { startOffset: 95 } });
    await resetProjectionSource(handle.db, DEVNET_SOURCE, { participantId: PARTICIPANT, jsonApiUrl: API, startOffset: 95 });
    await writeState(PARTICIPANT, "collara-devnet-r2");
    const after = await diagnose();
    expect(after.diagnosis.primary).toBe("OK");
    expect(after.observation.projection).toMatchObject({ checkpoint: 95, historyFloor: 95, status: "ACTIVE" });
  });

  it("lost database with no projection on a pruned participant: creates the source at the floor", async () => {
    await handle.db.delete(ledgerSources);
    ledger.prunedUpTo = 40;
    const { observation, diagnosis } = await diagnose();
    expect(diagnosis.primary).toBe("PRUNED");
    const plan = planNewRun({ diagnosis, observation, currentNamespace: "collara-devnet-r1", now });
    expect(plan.resetProjection).toEqual({ startOffset: 40, reason: "no projection yet on a pruned participant" });
    await resetProjectionSource(handle.db, DEVNET_SOURCE, { participantId: PARTICIPANT, jsonApiUrl: API, startOffset: 40 });
    const [row] = await handle.db.select().from(ledgerSources).where(eq(ledgerSources.source, DEVNET_SOURCE));
    expect(row).toMatchObject({ checkpointOffset: 40, historyFloorOffset: 40, status: "ACTIVE" });
  });
});
