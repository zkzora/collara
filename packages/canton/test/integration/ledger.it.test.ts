// Integration tests against a live Canton 3.5.19 sandbox with HMAC JWT auth.
// Run: CANTON_IT=1 pnpm --filter @collara/canton test:it (see packages/canton/README.md).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  create,
  createHmacTokenProviders,
  damlValue,
  exercise,
  HmacTokenProvider,
  LedgerClient,
  LedgerError,
  rights,
  templateId,
  type LedgerEvent,
  type TransactionShape,
} from "../../src";

const RUN_IT = process.env.CANTON_IT === "1";
const BASE_URL = process.env.CANTON_JSON_API_URL ?? "http://127.0.0.1:7575";
const AUDIENCE = process.env.CANTON_JWT_AUDIENCE ?? "https://collara.local/ledger-api";
// Dev-only placeholder, the same default as infra/canton/sandbox-auth.conf.
const SECRET = process.env.CANTON_JWT_HMAC_SECRET ?? "collara-local-dev-secret-change-me";
const IT_DAR = fileURLToPath(new URL("../fixtures/it-daml/.daml/dist/collara-canton-it-0.1.0.dar", import.meta.url));

const RUN = Date.now().toString(36);
const TOKEN = templateId("collara-canton-it", "It", "Token");
const NOTICE = templateId("collara-canton-it", "It", "Notice");
const PROBE = templateId("collara-canton-it", "It", "ValueProbe");
const ROLES = ["issuer", "holder", "observer", "outsider"] as const;
type Role = (typeof ROLES)[number];

async function rejection(promise: Promise<unknown>): Promise<LedgerError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LedgerError);
  return error as LedgerError;
}

describe.skipIf(!RUN_IT)("Canton sandbox integration (CANTON_IT=1)", () => {
  const tokens = createHmacTokenProviders({ secret: SECRET, audience: AUDIENCE });
  const admin = new LedgerClient({ baseUrl: BASE_URL, tokenProvider: tokens("participant_admin") });
  const party = {} as Record<Role, string>;
  const as = {} as Record<Role, LedgerClient>;

  const tokenArgs = (label: string) => ({
    issuer: party.issuer,
    owner: party.holder,
    amount: damlValue.numeric("100000", 2),
    label,
  });

  async function createToken(label: string): Promise<string> {
    const tx = await as.issuer.submitAndWaitForTransaction({
      commandId: `create-${label}-${RUN}`,
      actAs: [party.issuer],
      commands: [create(TOKEN, tokenArgs(label))],
    });
    const event = tx.events[0];
    if (event?.kind !== "created") throw new Error("expected a created event");
    return event.contractId;
  }

  beforeAll(async () => {
    expect((await admin.readyz()).ready).toBe(true);
    await admin.uploadDar(readFileSync(IT_DAR));
    for (const role of ROLES) {
      const details = await admin.allocateParty({ partyIdHint: `It-${role}-${RUN}` });
      party[role] = details.party;
      const userId = `it-${role}-${RUN}`;
      await admin.createUser({
        id: userId,
        primaryParty: details.party,
        rights: [rights.canActAs(details.party), rights.canReadAs(details.party)],
      });
      as[role] = admin.withTokenProvider(tokens(userId));
    }
  });

  it("creates and exercises with per-user tokens", async () => {
    const tx = await as.issuer.submitAndWaitForTransaction({
      commandId: `create-first-${RUN}`,
      actAs: [party.issuer],
      commands: [create(TOKEN, tokenArgs("first"))],
    });
    const created = tx.events[0];
    expect(created).toMatchObject({ kind: "created", templateRef: TOKEN, witnessParties: [party.issuer] });
    expect(tx.updateId).toMatch(/^1220/);
    const contractId = created!.contractId;

    const before = await as.holder.activeContracts({ parties: [party.holder], templateIds: [TOKEN] });
    expect(before.contracts.map((c) => c.event.contractId)).toContain(contractId);

    const result = await as.holder.submitAndWait({
      commandId: `consume-first-${RUN}`,
      actAs: [party.holder],
      commands: [exercise(TOKEN, contractId, "Consume")],
    });
    expect(result.updateId).toMatch(/^1220/);
    expect(result.completionOffset).toBeGreaterThan(tx.offset);

    const after = await as.holder.activeContracts({ parties: [party.holder], templateIds: [TOKEN] });
    expect(after.contracts.map((c) => c.event.contractId)).not.toContain(contractId);
  });

  it("commits exactly one of two concurrent consuming exercises, 10 rounds", async () => {
    const losers: Record<string, number> = {};
    for (let round = 0; round < 10; round++) {
      const contractId = await createToken(`race-${round}`);
      const attempt = (who: "a" | "b") =>
        as.holder.submitAndWait({
          commandId: `race-${round}-${who}-${RUN}`,
          actAs: [party.holder],
          commands: [exercise(TOKEN, contractId, "Consume")],
        });
      const results = await Promise.allSettled([attempt("a"), attempt("b")]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loserIndex = results.findIndex((r) => r.status === "rejected");
      const lost = results[loserIndex] as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(LedgerError);
      const error = lost.reason as LedgerError;
      expect(["CONTRACT_NOT_FOUND", "LOCKED_CONTRACTS"]).toContain(error.kind);
      expect(error.info).toMatchObject({ commandState: "REJECTED", definite: true });
      losers[error.kind] = (losers[error.kind] ?? 0) + 1;

      if (error.kind === "LOCKED_CONTRACTS") {
        expect(error.info.retryable).toBe(true);
        // Retrying the same change id after the winner committed is a definite rejection.
        const retry = await rejection(attempt(loserIndex === 0 ? "a" : "b"));
        expect(retry.info).toMatchObject({ kind: "CONTRACT_NOT_FOUND", commandState: "REJECTED", retryable: false });
      }
    }
    console.info(`[canton-it] contention losers over 10 rounds: ${JSON.stringify(losers)}`);
  });

  it("classifies a resubmitted commandId as a committed DUPLICATE_COMMAND and reconciles it", async () => {
    const commandId = `dup-${RUN}`;
    const request = { commandId, actAs: [party.issuer], commands: [create(TOKEN, tokenArgs("dup"))] };
    const tx = await as.issuer.submitAndWaitForTransaction({ ...request, submissionId: `dup-1-${RUN}` });

    const error = await rejection(as.issuer.submitAndWaitForTransaction({ ...request, submissionId: `dup-2-${RUN}` }));
    expect(error.info).toMatchObject({
      kind: "DUPLICATE_COMMAND",
      commandState: "COMMITTED",
      definite: true,
      retryable: false,
      httpStatus: 409,
      duplicate: { accepted: true, completionOffset: tx.offset, existingSubmissionId: `dup-1-${RUN}` },
    });

    const { completions } = await as.issuer.commandCompletions({ parties: [party.issuer], beginExclusive: tx.offset - 1 });
    const original = completions.find((c) => c.commandId === commandId && c.status.code === 0);
    expect(original).toMatchObject({ updateId: tx.updateId, offset: tx.offset, submissionId: `dup-1-${RUN}` });
  });

  it("classifies missing rights and missing Daml authority", async () => {
    const actAsOther = await rejection(
      as.outsider.submitAndWait({
        commandId: `perm-${RUN}`,
        actAs: [party.issuer],
        commands: [create(TOKEN, tokenArgs("perm"))],
      }),
    );
    expect(actAsOther.info).toMatchObject({ kind: "PERMISSION_DENIED", commandState: "FAILED", definite: true, httpStatus: 403 });

    const forged = await rejection(
      as.holder.submitAndWait({
        commandId: `forge-${RUN}`,
        actAs: [party.holder],
        commands: [create(TOKEN, tokenArgs("forged"))],
      }),
    );
    expect(forged.info).toMatchObject({
      kind: "AUTHORIZATION",
      code: "DAML_AUTHORIZATION_ERROR",
      commandState: "REJECTED",
      definite: true,
    });

    const readOther = await rejection(as.outsider.activeContracts({ parties: [party.issuer] }));
    expect(readOther.kind).toBe("PERMISSION_DENIED");

    const wrongSecret = admin.withTokenProvider(
      new HmacTokenProvider(`it-issuer-${RUN}`, { secret: "wrong-secret-for-the-it-tests", audience: AUDIENCE }),
    );
    const unauthenticated = await rejection(wrongSecret.ledgerEnd());
    expect(unauthenticated.info).toMatchObject({ kind: "UNAUTHENTICATED", commandState: "FAILED", httpStatus: 401 });
  });

  it("streams created/archived events to the observer and nothing to a non-stakeholder", async () => {
    const begin = await admin.ledgerEnd();
    const tx = await as.issuer.submitAndWaitForTransaction({
      commandId: `notice-${RUN}`,
      actAs: [party.issuer],
      commands: [create(NOTICE, { issuer: party.issuer, audience: [party.observer], body: "Synthetic notice" })],
    });
    const contractId = tx.events[0]!.contractId;
    await as.issuer.submitAndWait({
      commandId: `withdraw-${RUN}`,
      actAs: [party.issuer],
      commands: [exercise(NOTICE, contractId, "Withdraw")],
    });
    const end = await admin.ledgerEnd();

    const eventsFor = async (role: Role, shape: TransactionShape) => {
      const page = await as[role].updates({ beginExclusive: begin, endInclusive: end, parties: [party[role]], shape });
      expect(page.complete).toBe(true);
      return page.updates.flatMap((u) =>
        u.kind === "transaction"
          ? u.transaction.events
              .filter((e) => e.contractId === contractId)
              .map((e): LedgerEvent & { commandId: string } => ({ ...e, commandId: u.transaction.commandId }))
          : [],
      );
    };

    const delta = await eventsFor("observer", "ACS_DELTA");
    expect(delta.map((e) => e.kind)).toEqual(["created", "archived"]);
    for (const e of delta) expect(e.witnessParties).toEqual([party.observer]);
    expect(delta[0]!.commandId).toBe(""); // only the submitter sees its command id

    const effects = await eventsFor("observer", "LEDGER_EFFECTS");
    expect(effects.map((e) => e.kind)).toEqual(["created", "exercised"]);
    expect(effects[1]).toMatchObject({
      kind: "exercised",
      choice: "Withdraw",
      consuming: true,
      actingParties: [party.issuer],
      witnessParties: [party.observer],
    });

    const submitterView = await eventsFor("issuer", "ACS_DELTA");
    expect(submitterView[0]).toMatchObject({ kind: "created", commandId: `notice-${RUN}`, witnessParties: [party.issuer] });

    for (const shape of ["ACS_DELTA", "LEDGER_EFFECTS"] as const) {
      const page = await as.outsider.updates({ beginExclusive: begin, endInclusive: end, parties: [party.outsider], shape });
      expect(page.updates.filter((u) => u.kind === "transaction")).toEqual([]);
    }
  });

  it("round-trips the value encoders through Daml", async () => {
    const { numeric, decimal, int64, time, date, optional, nestedOptional, damlSet, damlMap, variant } = damlValue;
    const args = {
      owner: party.issuer,
      count: int64(-42),
      price: numeric("150000", 2),
      ratio: decimal("0.6666666667"),
      at: time("2026-01-15T08:30:00.123456Z"),
      day: date("2026-01-15"),
      flag: true,
      note: optional("Synthetic"),
      nested: nestedOptional({ some: int64(7) }),
      tags: ["a", "b"],
      members: damlSet([party.issuer, party.holder]),
      limits: damlMap([["y", int64(2)], ["x", int64(1)]]),
      colour: "Green",
      shape: variant("Circle", { radius: numeric("1.5", 2) }),
    };
    const tx = await as.issuer.submitAndWaitForTransaction({
      commandId: `probe-${RUN}`,
      actAs: [party.issuer],
      commands: [create(PROBE, args)],
    });
    const created = tx.events[0];
    if (created?.kind !== "created") throw new Error("expected a created event");
    const echoed = created.createArgument as Record<string, unknown>;
    expect(echoed).toMatchObject({ count: "-42", price: "150000.00", nested: [["7"]], limits: [["x", "1"], ["y", "2"]] });
    expect(damlValue.decodeNestedOptional(echoed.nested)).toEqual({ some: "7" });
    expect(damlValue.damlSchemas.set(damlValue.damlSchemas.party).parse(echoed.members).sort()).toEqual(
      [party.issuer, party.holder].sort(),
    );

    const described = await as.issuer.submitAndWaitForTransaction({
      commandId: `describe-${RUN}`,
      actAs: [party.issuer],
      commands: [exercise(PROBE, created.contractId, "Describe")],
      shape: "LEDGER_EFFECTS",
    });
    const result = described.events.find((e) => e.kind === "exercised");
    const members = [party.issuer, party.holder].sort().map((p) => `'${p}'`).join(",");
    expect(result).toMatchObject({
      kind: "exercised",
      exerciseResult: [
        "-42",
        "150000.0",
        "0.6666666667",
        "2026-01-15T08:30:00.123456Z",
        "2026-01-15",
        'Some "Synthetic"',
        "Some (Some 7)",
        `Set [${members}]`,
        'Map [("x",1),("y",2)]',
        "Green",
        "Circle {radius = 1.5}",
      ].join(" | "),
    });
  });
});
