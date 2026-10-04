// DEVNET health: the topology wording, the credential check with one wording per recovery case (missing, revoked,
// key), and the projection states (reset vs pruned). No token, key, URL or party id in the details.
import { randomBytes } from "node:crypto";
import { devnetCredentialId } from "@collara/canton";
import { CredentialCipher, PgRefreshTokenStore, type DbHandle, type LedgerSourceRow } from "@collara/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededDb } from "../test-support";
import { devnetCredentialStatus, topologyLabel, workerCheck } from "./health";

const USER = "c2ede6f6-team";
const KEY = randomBytes(32).toString("base64");
const ENV = { DEVNET_LEDGER_USER_ID: USER, DEVNET_CREDENTIAL_KEY: KEY, DEVNET_CREDENTIAL_KEY_ID: "k1" };

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

  it("reports a missing, active, undecryptable and rejected credential, each distinctly and without secrets", async () => {
    expect(await devnetCredentialStatus(ENV, handle.db)).toMatchObject({ status: "unavailable", detail: expect.stringMatching(/^CREDENTIAL_MISSING/) });
    const store = new PgRefreshTokenStore(handle.db, { cipher: new CredentialCipher({ current: { id: "k1", key: Buffer.from(KEY, "base64") }, previous: [] }) });
    await store.storeLogin({ id: devnetCredentialId(USER), ledgerUserId: USER, issuer: "https://idp.example/r", clientId: "c", refreshToken: "rt-secret", accessTokenExpiresAt: new Date() });
    expect(await devnetCredentialStatus(ENV, handle.db)).toEqual({ status: "ok" });

    const otherKey = randomBytes(32).toString("base64");
    const wrong = await devnetCredentialStatus({ ...ENV, DEVNET_CREDENTIAL_KEY: otherKey }, handle.db);
    expect(wrong).toMatchObject({ status: "unavailable", detail: expect.stringMatching(/^CREDENTIAL_KEY/) });
    expect((await devnetCredentialStatus({ ...ENV, DEVNET_CREDENTIAL_KEY: "" }, handle.db)).detail).toMatch(/^CREDENTIAL_KEY: DEVNET_CREDENTIAL_KEY is missing/);

    await store.withCredential(devnetCredentialId(USER), async () => ({ update: { kind: "rejected", reason: "invalid_grant" }, value: null }));
    const rejected = await devnetCredentialStatus(ENV, handle.db);
    expect(rejected).toMatchObject({ status: "unavailable", detail: expect.stringMatching(/^CREDENTIAL_REVOKED.*login\.mjs/) });
    for (const check of [wrong, rejected]) {
      const text = JSON.stringify(check);
      expect(text).not.toContain("rt-secret");
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(otherKey);
      expect(text).not.toContain(USER);
    }
  });

  it("tells a pruned projection from a reset one", () => {
    const row = (status: string) => ({ source: "devnet", status, checkpointOffset: 10, lastAppliedAt: new Date() }) as LedgerSourceRow;
    expect(workerCheck([row("PRUNED")], new Date(), 120).detail).toMatch(/^PRUNED: .*new run is required/);
    expect(workerCheck([row("RESET_DETECTED")], new Date(), 120).detail).toMatch(/^LEDGER_RESET/);
  });
});
