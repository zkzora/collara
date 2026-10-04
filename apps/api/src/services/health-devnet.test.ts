// DEVNET health: the topology wording and the credential check (no token, URL or party id in the details).
import { devnetCredentialId } from "@collara/canton";
import { PgRefreshTokenStore, type DbHandle } from "@collara/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededDb } from "../test-support";
import { devnetCredentialStatus, topologyLabel } from "./health";

const USER = "c2ede6f6-team";

describe("DEVNET health", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await seededDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("names the shared participant, not a sandbox", () => {
    expect(topologyLabel({ topology: "devnet-shared-participant", cantonVersion: "3.5.19" })).toBe(
      "Canton 3.5.19, Canton DevNet, one shared participant run by a node operator, one tenant ledger user",
    );
  });

  it("reports a missing, active and rejected credential without secrets", async () => {
    expect((await devnetCredentialStatus({ DEVNET_LEDGER_USER_ID: USER }, handle.db)).status).toBe("unavailable");
    const store = new PgRefreshTokenStore(handle.db);
    await store.storeLogin({ id: devnetCredentialId(USER), ledgerUserId: USER, issuer: "https://idp.example/r", clientId: "c", refreshToken: "rt-secret", accessTokenExpiresAt: new Date() });
    expect(await devnetCredentialStatus({ DEVNET_LEDGER_USER_ID: USER }, handle.db)).toEqual({ status: "ok" });
    await store.withCredential(devnetCredentialId(USER), async () => ({ update: { kind: "rejected", reason: "invalid_grant" }, value: null }));
    const rejected = await devnetCredentialStatus({ DEVNET_LEDGER_USER_ID: USER }, handle.db);
    expect(rejected.status).toBe("unavailable");
    expect(rejected.detail).toContain("login.mjs");
    expect(JSON.stringify(rejected)).not.toContain("rt-secret");
  });
});
