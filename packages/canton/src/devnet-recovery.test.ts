// DEVNET recovery cases: each failure kind (credential, key, pruning, reset, parties, packages, network) maps to one
// case, through the real LedgerClient where the error comes from the JSON API, and diagnoseDevnet orders the
// findings and names the exact next commands. Pruning bodies are SYNTHETIC fixtures (not recorded on a participant).
import { describe, expect, it } from "vitest";
import { errorFixture, syntheticErrorFixture } from "./__fixtures__";
import { LedgerClient } from "./client";
import { classifyRecoveryError, diagnoseDevnet, formatDiagnosis, type DevnetObservation } from "./devnet-recovery";
import { LedgerCredentialError } from "./oidc";

const BASE = "https://ledger.devnet.invalid";

/** A LedgerClient whose JSON API answers every call with `response` (status + body). */
function clientAnswering(response: { status: number; body: unknown } | Error, tokenError?: Error) {
  const fetchImpl = async (): Promise<Response> => {
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { "content-type": "application/json" } });
  };
  return new LedgerClient({
    baseUrl: BASE,
    fetch: fetchImpl as typeof fetch,
    tokenProvider: { getToken: async () => (tokenError ? Promise.reject(tokenError) : "access-token") },
  });
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a failure");
    },
    (error: unknown) => error,
  );
}

const updates = (client: LedgerClient) => client.updates({ beginExclusive: 12, endInclusive: 40, parties: ["P::1220"] });

describe("classifyRecoveryError", () => {
  it("PRUNED: PARTICIPANT_PRUNED_DATA_ACCESSED from /v2/updates", async () => {
    const error = await failureOf(updates(clientAnswering(syntheticErrorFixture("participant-pruned-data-accessed"))));
    expect(classifyRecoveryError(error)).toMatchObject({ case: "PRUNED", detail: expect.stringContaining("PARTICIPANT_PRUNED_DATA_ACCESSED") });
  });

  it("LEDGER_RESET: an offset after the ledger end, or a LedgerResetError", async () => {
    const error = await failureOf(updates(clientAnswering(syntheticErrorFixture("offset-after-ledger-end"))));
    expect(classifyRecoveryError(error)?.case).toBe("LEDGER_RESET");
    expect(classifyRecoveryError(Object.assign(new Error("participant changed"), { name: "LedgerResetError" }))?.case).toBe("LEDGER_RESET");
  });

  it("PARTIES_MISSING: a redacted 403 when reading as the bound parties", async () => {
    const error = await failureOf(updates(clientAnswering(errorFixture("permission-denied-read-as"))));
    expect(classifyRecoveryError(error)).toMatchObject({ case: "PARTIES_MISSING", detail: expect.stringContaining("lacks a right on a bound party") });
  });

  it("PACKAGES_MISSING: unknown package names or templates", async () => {
    for (const name of ["package-names-not-found", "invalid-template"]) {
      const error = await failureOf(updates(clientAnswering(errorFixture(name))));
      expect(classifyRecoveryError(error)?.case).toBe("PACKAGES_MISSING");
    }
  });

  it("CREDENTIAL_REVOKED / CREDENTIAL_MISSING / CREDENTIAL_KEY through the token provider (nothing was sent)", async () => {
    const revoked = new LedgerCredentialError("REFRESH_REJECTED", "The identity provider rejected the stored refresh token (invalid_grant). Run node scripts/devnet/login.mjs again");
    const error = await failureOf(clientAnswering({ status: 200, body: { offset: 1 } }, revoked).ledgerEnd());
    expect(classifyRecoveryError(error)).toMatchObject({ case: "CREDENTIAL_REVOKED", detail: expect.stringContaining("login.mjs") });
    expect(classifyRecoveryError(new LedgerCredentialError("NO_REFRESH_TOKEN", "No DevNet refresh token is stored"))?.case).toBe("CREDENTIAL_MISSING");
    const keyError = Object.assign(new Error("the stored DevNet credential does not decrypt with key id k1"), { name: "CredentialCipherError", code: "DECRYPT_FAILED" });
    expect(classifyRecoveryError(await failureOf(clientAnswering({ status: 200, body: {} }, keyError).ledgerEnd()))?.case).toBe("CREDENTIAL_KEY");
  });

  it("LEDGER_UNREACHABLE: network failure or identity provider down", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(classifyRecoveryError(await failureOf(clientAnswering(refused).ledgerEnd()))?.case).toBe("LEDGER_UNREACHABLE");
    expect(classifyRecoveryError(new LedgerCredentialError("TOKEN_ENDPOINT_UNAVAILABLE", "down", true))?.case).toBe("LEDGER_UNREACHABLE");
  });

  it("returns null for failures that are not a recovery case", async () => {
    expect(classifyRecoveryError(await failureOf(updates(clientAnswering(errorFixture("contract-not-found")))))).toBeNull();
    expect(classifyRecoveryError(new Error("bug"))).toBeNull();
  });

  it("LedgerClient.latestPrunedOffset reads participantPrunedUpToInclusive", async () => {
    expect(await clientAnswering({ status: 200, body: { participantPrunedUpToInclusive: 25, allDivulgedContractsPrunedUpToInclusive: 20 } }).latestPrunedOffset()).toBe(25);
    expect(await clientAnswering({ status: 200, body: {} }).latestPrunedOffset()).toBe(0);
  });
});

const PARTIES = { CollaraRegistrar: "c2-CollaraRegistrar::1220", DemoLenderA: "c2-DemoLenderA::1220" };
const healthy = (): DevnetObservation => ({
  database: { reachable: true, migrated: true },
  credential: { state: "OK", detail: "encrypted with key k1" },
  state: { participantId: "PAR::noders::1220", namespace: "collara-devnet-r1", parties: PARTIES },
  ledger: {
    reachable: true,
    participantId: "PAR::noders::1220",
    ledgerEnd: 100,
    prunedUpTo: 0,
    actAs: Object.values(PARTIES),
    readAs: Object.values(PARTIES),
    packages: [{ name: "collara-contracts", version: "0.2.0", packageId: "1c0e5e62aaaaaaaa", present: true, vetted: true }],
  },
  projection: { status: "ACTIVE", participantId: "PAR::noders::1220", checkpoint: 90, historyFloor: null, reason: null },
});
const withLedger = (o: DevnetObservation, ledger: Partial<Extract<NonNullable<DevnetObservation["ledger"]>, { reachable: true }>>): DevnetObservation => ({
  ...o,
  ledger: { ...(o.ledger as Extract<NonNullable<DevnetObservation["ledger"]>, { reachable: true }>), ...ledger },
});

describe("diagnoseDevnet", () => {
  it("OK when everything matches", () => {
    const d = diagnoseDevnet(healthy());
    expect(d).toMatchObject({ primary: "OK", newRunRequired: false });
    expect(formatDiagnosis(d)).toContain("nothing to recover");
  });

  it.each([
    ["DATABASE_MISSING", { ...healthy(), database: { reachable: true, migrated: false } }, "node scripts/devnet/db-setup.mjs", true],
    ["CREDENTIAL_MISSING", { ...healthy(), credential: { state: "MISSING", detail: "no DevNet credential is stored" } }, "node scripts/devnet/login.mjs", false],
    ["CREDENTIAL_REVOKED", { ...healthy(), credential: { state: "REAUTH_REQUIRED", detail: "invalid_grant" } }, "node scripts/devnet/login.mjs", false],
    ["CREDENTIAL_KEY", { ...healthy(), credential: { state: "KEY_UNKNOWN", detail: "key id k0" } }, "DEVNET_CREDENTIAL_KEY_PREVIOUS=<old id>:<old key>", false],
    ["LEDGER_UNREACHABLE", { ...healthy(), ledger: { reachable: false, error: "ledger unreachable (ECONNREFUSED)" } }, "node scripts/devnet/preflight.mjs", false],
    ["LEDGER_RESET", withLedger(healthy(), { participantId: "PAR::noders::1220new", ledgerEnd: 5 }), "node scripts/devnet/recover.mjs --new-run --yes", true],
    ["STATE_MISSING", { ...healthy(), state: null }, "node scripts/devnet/recover.mjs --new-run --yes", false],
    ["PARTIES_MISSING", withLedger(healthy(), { actAs: [PARTIES.CollaraRegistrar] }), "noders-rights-request.md", false],
    ["PACKAGES_MISSING", withLedger(healthy(), { packages: [{ name: "collara-contracts", version: "0.2.0", packageId: "1c0e5e62aaaaaaaa", present: true, vetted: false }] }), "Upload DAR", false],
    ["PRUNED", withLedger(healthy(), { prunedUpTo: 95 }), "the projection restarts at offset 95", true],
  ] as const)("%s", (expected, observation, command, newRun) => {
    const d = diagnoseDevnet(observation as DevnetObservation);
    expect(d.primary).toBe(expected);
    expect(d.newRunRequired).toBe(newRun);
    const text = formatDiagnosis(d);
    expect(text).toContain(`case: ${expected}`);
    expect(text).toContain(command);
  });

  it("pruning within retention resumes (warning only); a fresh projection on a pruned participant needs a new run", () => {
    const within = diagnoseDevnet(withLedger(healthy(), { prunedUpTo: 90 }));
    expect(within.primary).toBe("OK");
    expect(within.findings.find((f) => f.title === "pruning")).toMatchObject({ status: "warn", detail: expect.stringContaining("still within retention") });
    const fresh = diagnoseDevnet({ ...withLedger(healthy(), { prunedUpTo: 10 }), projection: null });
    expect(fresh).toMatchObject({ primary: "PRUNED", newRunRequired: true });
    const stopped = diagnoseDevnet({ ...healthy(), projection: { ...healthy().projection!, status: "PRUNED", reason: "pruned" } });
    expect(stopped.primary).toBe("PRUNED");
  });

  it("names the missing parties and never suggests allocating parties", () => {
    const text = formatDiagnosis(diagnoseDevnet(withLedger(healthy(), { actAs: [PARTIES.CollaraRegistrar] })));
    expect(text).toContain("DemoLenderA (c2-DemoLenderA::1220)");
    expect(text).not.toMatch(/allocat/i);
  });
});
