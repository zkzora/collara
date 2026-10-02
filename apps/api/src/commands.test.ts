import { commands as commandsTable, type CommandRow, type DbHandle } from "@collara/db";
import { ApiProblemSchema, COMMAND_COPY, CommandStatusSchema } from "@collara/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isProblemError } from "./errors";
import { canonicalJson, CommandService, IllegalCommandTransitionError, ledgerCommandId, payloadHash } from "./services/commands";
import type { LedgerGateway, LedgerSubmitOutcome, LedgerSubmitRequest } from "./services/ledger";
import { loginAs, seededDb, testApp, type TestApp } from "./test-support";

const approver = { userId: "user-lender-a-approver", orgId: "demo-lender-a" };
const submission = { ledgerUserId: "lender-a-svc", actAs: ["DemoLenderA::1"], readAs: ["DemoLenderA::1"], commands: [] };

function scriptedGateway(outcomes: (LedgerSubmitOutcome | Error)[]): LedgerGateway & { calls: { command: CommandRow; request: LedgerSubmitRequest }[] } {
  const calls: { command: CommandRow; request: LedgerSubmitRequest }[] = [];
  return {
    calls,
    async submit(command, request) {
      calls.push({ command, request });
      const next = outcomes.shift();
      if (!next) throw new Error("no scripted outcome");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe("payload hashing and command ids", () => {
  it("hashes payloads independently of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"x":2,"y":1}]},"b":1}');
    expect(payloadHash("op", { a: 1, b: 2 })).toBe(payloadHash("op", { b: 2, a: 1 }));
    expect(payloadHash("op", { a: 1 })).not.toBe(payloadHash("other", { a: 1 }));
  });

  it("derives a deterministic ledger command id per (org, actor, operation, key, payload)", () => {
    const input = { orgId: "o", userId: "u", operation: "op", idempotencyKey: "k".repeat(8), payloadHash: "h" };
    expect(ledgerCommandId(input)).toBe(ledgerCommandId({ ...input }));
    expect(ledgerCommandId(input)).toMatch(/^collara-[0-9a-f]{48}$/);
    expect(ledgerCommandId({ ...input, idempotencyKey: "j".repeat(8) })).not.toBe(ledgerCommandId(input));
  });
});

describe("CommandService", () => {
  let db: DbHandle;

  beforeAll(async () => {
    db = await seededDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it("returns the same command for the same key and payload, and 409 for a different payload", async () => {
    const service = new CommandService(db.db, scriptedGateway([]));
    const input = { actor: approver, operation: "review.decide", idempotencyKey: "idem-key-0001", payload: { decision: "ELIGIBLE", caseId: "CL-001" }, target: "LEDGER" as const };
    const first = await service.createOrGetCommand(input);
    expect(first.created).toBe(true);
    expect(first.record.status).toBe("PREPARED");
    const again = await service.createOrGetCommand({ ...input, payload: { caseId: "CL-001", decision: "ELIGIBLE" } });
    expect(again).toMatchObject({ created: false, record: { id: first.record.id } });
    const conflict = await service.createOrGetCommand({ ...input, payload: { decision: "REJECTED", caseId: "CL-001" } }).catch((e: unknown) => e);
    expect(isProblemError(conflict) && conflict.problem).toMatchObject({ status: 409, code: "idempotency_conflict" });
    // The same key is independent per operation and per actor.
    const otherOp = await service.createOrGetCommand({ ...input, operation: "review.submit" });
    expect(otherOp.created).toBe(true);
    const otherActor = await service.createOrGetCommand({ ...input, actor: { userId: "user-lender-b-approver", orgId: "demo-lender-b" } });
    expect(otherActor.created).toBe(true);
  });

  it("enforces lifecycle transitions", async () => {
    const service = new CommandService(db.db, scriptedGateway([]));
    const { record } = await service.createOrGetCommand({ actor: approver, operation: "t.lifecycle", idempotencyKey: "idem-key-0002", payload: {}, target: "LEDGER" });
    await expect(service.transition(record.id, "PROJECTED")).rejects.toBeInstanceOf(IllegalCommandTransitionError);
    const submitted = await service.transition(record.id, "SUBMITTED", { submissionId: "s1", incrementAttempts: true });
    expect(submitted).toMatchObject({ status: "SUBMITTED", attempts: 1 });
    const committed = await service.transition(record.id, "COMMITTED", { updateId: "upd-1", completionOffset: 42 });
    expect(committed).toMatchObject({ status: "COMMITTED", updateId: "upd-1", completionOffset: 42 });
    await expect(service.transition(record.id, "REJECTED")).rejects.toBeInstanceOf(IllegalCommandTransitionError);
    await service.transition(record.id, "PROJECTION_DELAYED");
    const projected = await service.transition(record.id, "PROJECTED");
    expect(service.toStatus(projected)).toMatchObject({ state: "PROJECTED", updateId: "upd-1", completionOffset: 42, simulated: false, message: COMMAND_COPY.COMMITTED });
  });

  it("maps gateway outcomes to the lifecycle and never reports a timeout as a failure", async () => {
    const gateway = scriptedGateway([
      new Error("socket hang up"),
      { kind: "committed", updateId: "upd-9", offset: 99 },
    ]);
    const service = new CommandService(db.db, gateway);
    const { record } = await service.createOrGetCommand({ actor: approver, operation: "pledge.activate", idempotencyKey: "idem-key-0003", payload: { caseId: "CL-001" }, target: "LEDGER" });

    const unknown = await service.submitToLedger(record, submission);
    expect(unknown.status).toBe("UNKNOWN_OUTCOME");
    expect(service.toStatus(unknown)).toMatchObject({ state: "UNKNOWN_OUTCOME", message: COMMAND_COPY.UNKNOWN_OUTCOME });
    expect(service.toStatus(unknown).updateId).toBeUndefined();

    // Resubmission reuses the deterministic command id with a new submission id.
    const committed = await service.submitToLedger(unknown, submission);
    expect(committed).toMatchObject({ status: "COMMITTED", updateId: "upd-9", completionOffset: 99, attempts: 2 });
    expect(gateway.calls.map((c) => c.request.commandId)).toEqual([record.ledgerCommandId, record.ledgerCommandId]);
    expect(new Set(gateway.calls.map((c) => c.request.submissionId)).size).toBe(2);
    expect(CommandStatusSchema.parse(service.toStatus(committed)).message).toBe(COMMAND_COPY.COMMITTED);

    // A settled command is not submitted again.
    expect((await service.submitToLedger(committed, submission)).status).toBe("COMMITTED");
    expect(gateway.calls).toHaveLength(2);
  });

  it("records rejections and pre-commit failures with redacted errors", async () => {
    const gateway = scriptedGateway([
      { kind: "rejected", errorKind: "CONTRACT_NOT_FOUND", code: "CONTRACT_NOT_FOUND", message: "contract gone" },
      { kind: "failed", errorKind: "UNAUTHENTICATED", message: "token Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln rejected" },
    ]);
    const service = new CommandService(db.db, gateway);
    const a = await service.createOrGetCommand({ actor: approver, operation: "op.a", idempotencyKey: "idem-key-0004", payload: {}, target: "LEDGER" });
    const rejected = await service.submitToLedger(a.record, submission);
    expect(service.toStatus(rejected)).toMatchObject({ state: "REJECTED", message: COMMAND_COPY.STATE_CHANGED, error: { code: "CONTRACT_NOT_FOUND" } });
    const b = await service.createOrGetCommand({ actor: approver, operation: "op.b", idempotencyKey: "idem-key-0005", payload: {}, target: "LEDGER" });
    const failed = await service.submitToLedger(b.record, submission);
    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).not.toContain("eyJ");
    expect(service.toStatus(failed).message).toBe(COMMAND_COPY.LEDGER_UNAVAILABLE);
  });
});

describe("GET /api/commands/:id", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await testApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it("is visible only to the actor that issued the command (404-shaped otherwise)", async () => {
    const services = t.app.services;
    if (!services) throw new Error("services missing");
    const { record } = await services.commands.createOrGetCommand({ actor: approver, operation: "review.decide", idempotencyKey: "idem-key-0100", payload: {}, target: "LEDGER" });

    const mine = await t.app.inject({ method: "GET", url: `/api/commands/${record.id}`, headers: { cookie: await loginAs(t.app, "lender-a-approver") } });
    expect(mine.statusCode).toBe(200);
    expect(CommandStatusSchema.parse(mine.json())).toMatchObject({ commandId: record.id, state: "PREPARED", target: "LEDGER", simulated: false, message: COMMAND_COPY.SUBMITTED });

    for (const persona of ["lender-a-analyst", "lender-b-approver"] as const) {
      const other = await t.app.inject({ method: "GET", url: `/api/commands/${record.id}`, headers: { cookie: await loginAs(t.app, persona) } });
      expect(other.statusCode).toBe(404);
      expect(ApiProblemSchema.parse(other.json())).toMatchObject({ code: "unavailable", detail: "This record is unavailable to your account." });
    }
    const missing = await t.app.inject({ method: "GET", url: "/api/commands/not-a-uuid", headers: { cookie: await loginAs(t.app, "lender-a-approver") } });
    expect(missing.statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/api/commands/${record.id}` })).statusCode).toBe(401);
    const [row] = await t.db.db.select().from(commandsTable).where(eq(commandsTable.id, record.id));
    expect(row?.status).toBe("PREPARED");
  });

  it("GET /api/verifiers reads the projected registry: empty before anything is projected, 401 without a session", async () => {
    // Served by the governance route module (routes/workflow/governance.ts); LocalNet coverage in governance.it.test.ts.
    const res = await t.app.inject({ method: "GET", url: "/api/verifiers", headers: { cookie: await loginAs(t.app, "manufacturer-owner") } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect((await t.app.inject({ method: "GET", url: "/api/verifiers" })).statusCode).toBe(401);
  });
});
