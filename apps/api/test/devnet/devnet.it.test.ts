// DevNet integration (OPT-IN: DEVNET_IT=1 plus the DEVNET env with a stored credential; see vitest.devnet.config.ts).
// Read-only against the shared participant: it creates, uploads and submits nothing. It checks that the stored
// credential works, that the participant is the one the DevNet state was imported for, that the tenant user still
// holds CanActAs on every bound party, that the Collara packages are vetted, and (after bootstrap) that the
// registrar sees exactly one AssetRegistry and one CollaraConfig of the run namespace.
import { devnetCredentialId, DevnetEnvSchema, devnetGuardIssues, devnetStatePath, LedgerClient } from "@collara/canton";
import { createPgDatabase, PgRefreshTokenStore, type DbHandle } from "@collara/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchParties, rightsToParties } from "../../src/devnet/bindings";
import { readUploadManifest, requiredPackages } from "../../src/devnet/preflight";
import { AcsReader } from "../../src/ledger/acs";
import { assertDevnetState, devnetTokenProvider } from "../../src/ledger/devnet";
import { loadLedgerState, type LedgerState } from "../../src/ledger/state";

const env = DevnetEnvSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
const databaseUrl = process.env.DATABASE_URL;
const configured =
  process.env.DEVNET_IT === "1" &&
  !!databaseUrl &&
  !!env.DEVNET_LEDGER_USER_ID &&
  devnetGuardIssues({ ...env, DATABASE_URL: databaseUrl, COLLARA_LOCALNET_STATE: process.env.COLLARA_LOCALNET_STATE, CANTON_JWT_HMAC_SECRET: process.env.CANTON_JWT_HMAC_SECRET }).length === 0;

describe.skipIf(!configured)("DevNet shared participant (read-only)", () => {
  let handle: DbHandle;
  let client: LedgerClient;
  let state: LedgerState | null;
  const user = env.DEVNET_LEDGER_USER_ID ?? "";

  beforeAll(async () => {
    handle = createPgDatabase({ url: databaseUrl ?? "", max: 2, applicationName: "collara-devnet-it" });
    const status = await new PgRefreshTokenStore(handle.db).status(devnetCredentialId(user));
    if (!status?.hasRefreshToken || status.status !== "ACTIVE") throw new Error("no active DevNet credential: run node scripts/devnet/login.mjs");
    client = new LedgerClient({ baseUrl: env.CANTON_DEVNET_JSON_API_URL, tokenProvider: devnetTokenProvider(env, handle.db), timeoutMs: 30_000 });
    state = await loadLedgerState(devnetStatePath(env));
  });
  afterAll(async () => {
    await handle?.close();
  });

  it("authenticates as the configured ledger user on Canton 3.5.19", async () => {
    expect((await client.version()).version).toBe("3.5.19");
    expect((await client.authenticatedUser()).id).toBe(user);
  });

  it("the tenant user holds CanActAs on all eleven Collara parties", async () => {
    const match = matchParties(rightsToParties(await client.listUserRights(user)));
    expect(match.missing).toEqual([]);
    expect(match.ambiguous).toEqual([]);
    expect(match.readOnly).toEqual([]);
  });

  it("every Collara package of the upload manifest is present and vetted", async () => {
    const required = requiredPackages(await readUploadManifest());
    const known = new Set(await client.listPackages());
    const vetted = new Set((await client.vettedPackages({ packageIds: required.map((p) => p.packageId), participantIds: [await client.participantId()] })).flatMap((v) => v.packages.map((p) => p.packageId)));
    expect(required.filter((p) => !known.has(p.packageId) || !vetted.has(p.packageId)).map((p) => p.name)).toEqual([]);
  });

  it("the DevNet state matches this participant and, once bootstrapped, the registry and config exist once", async (context) => {
    if (!state) return context.skip();
    assertDevnetState(state, env);
    expect(await client.participantId()).toBe(state.participantId);
    const registrar = state.parties.CollaraRegistrar?.party ?? "";
    const acs = new AcsReader(client, [registrar]);
    const registries = await acs.list("AssetRegistry", (r) => r.namespace === state?.namespace);
    if (registries.length === 0) return context.skip();
    expect(registries).toHaveLength(1);
    expect(await acs.list("CollaraConfig", (c) => c.namespace === state?.namespace)).toHaveLength(1);
  });
});
