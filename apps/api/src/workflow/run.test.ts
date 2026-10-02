// The runner records the submission context on each LEDGER command row (ledger user, actAs, participant
// source, ledger end before the first submission) so the worker reconciles UNKNOWN_OUTCOME exactly.
import { commands as commandsTable, type CommandRow, type DbHandle } from "@collara/db";
import { DEMO_ORG_IDS } from "@collara/domain";
import { create, templateId } from "@collara/canton";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerAccess } from "../ledger/access";
import type { LedgerState } from "../ledger/state";
import type { LedgerGateway, LedgerSubmitOutcome, LedgerSubmitRequest } from "../services/ledger";
import { seededDb } from "../test-support";
import type { WorkflowActor } from "./actors";
import { WorkflowRunner } from "./run";

const PARTY = "DemoManufacturer::1220aa";
const STATE: LedgerState = {
  version: 1,
  bootstrappedAt: "2026-10-01T00:00:00Z",
  topology: "sandbox-1-participant",
  audience: "https://canton.network.global",
  jsonApiUrl: "http://127.0.0.1:1",
  participantId: "sandbox::1220",
  participants: { sandbox: { jsonApiUrl: "http://127.0.0.1:1", participantId: "sandbox::1220", ledgerEndAtBootstrap: 0 } },
  parties: { DemoManufacturer: { party: PARTY, participant: "sandbox", user: "borrower-svc" } },
  users: [{ id: "borrower-svc", participant: "sandbox", role: "org", primaryParty: PARTY, actAs: [PARTY], readAs: [] }],
  packages: [],
};

const actor: WorkflowActor = {
  kind: "member",
  userId: "user-manufacturer-owner",
  orgId: DEMO_ORG_IDS.manufacturer,
  actorRef: "mbr:manufacturer-owner",
  business: { party: PARTY, ledgerUserId: "borrower-svc", source: "sandbox", readAs: [] },
  seat: null,
  governanceParty: null,
  readableParties: [PARTY],
  member: null,
};

const COMMAND = create(templateId("collara-contracts", "Collara.Audit", "AuditGrant"), {});

/** Scripted gateway: one outcome per submit call, and a ledger end per call (or an error). */
function fakeGateway(outcomes: LedgerSubmitOutcome[], ledgerEnds: (number | Error)[]) {
  const submitted: LedgerSubmitRequest[] = [];
  const endCalls: { ledgerUserId: string; source?: string }[] = [];
  const gateway: LedgerGateway = {
    async submit(_row, request) {
      submitted.push(request);
      const next = outcomes.shift();
      if (!next) throw new Error("no scripted outcome left");
      return next;
    },
    async ledgerEnd(request) {
      endCalls.push(request);
      const next = ledgerEnds.shift();
      if (next === undefined) throw new Error("no scripted ledger end left");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { gateway, submitted, endCalls };
}

describe("WorkflowRunner submission context", () => {
  let handle: DbHandle;
  const access = new LedgerAccess({ state: STATE, secret: "unit-test-secret-0123456789" });

  beforeEach(async () => {
    handle = await seededDb();
  });
  afterEach(async () => {
    await handle.close();
  });

  const row = async (id: string): Promise<CommandRow> => {
    const [r] = await handle.db.select().from(commandsTable).where(eq(commandsTable.id, id));
    if (!r) throw new Error("missing command row");
    return r;
  };

  const runOnce = (runner: WorkflowRunner, key = "ctx-key-0001") =>
    runner.run({ actor, operation: "test.context", idempotencyKey: key, payload: { n: 1 }, prepare: async () => ({ commands: [COMMAND] }) });

  it("records ledger user, actAs, source and the ledger end observed before the submission", async () => {
    const { gateway, submitted, endCalls } = fakeGateway([{ kind: "committed", updateId: "upd-1", offset: 43 }], [42]);
    const outcome = await runOnce(new WorkflowRunner({ db: handle.db, gateway, access }));
    expect(outcome.committed).toBe(true);
    const r = await row(outcome.record.id);
    expect(r).toMatchObject({ status: "COMMITTED", updateId: "upd-1", ledgerUserId: "borrower-svc", actAs: [PARTY], ledgerSource: "sandbox", ledgerEndAtSubmit: 42 });
    expect(endCalls).toEqual([{ ledgerUserId: "borrower-svc", source: "sandbox" }]);
    expect(submitted[0]).toMatchObject({ ledgerUserId: "borrower-svc", actAs: [PARTY], source: "sandbox", commandId: r.ledgerCommandId });
  });

  it("keeps the first ledger end when an UNKNOWN_OUTCOME is resubmitted with the same command id", async () => {
    const { gateway, submitted } = fakeGateway(
      [
        { kind: "unknown", errorKind: "TIMEOUT", message: "timed out" },
        { kind: "committed", updateId: "upd-2", offset: 25, deduplicated: true },
      ],
      [10, 20],
    );
    const runner = new WorkflowRunner({ db: handle.db, gateway, access });
    const first = await runOnce(runner);
    expect(first.record.status).toBe("UNKNOWN_OUTCOME");
    expect(await row(first.record.id)).toMatchObject({ ledgerUserId: "borrower-svc", actAs: [PARTY], ledgerSource: "sandbox", ledgerEndAtSubmit: 10 });

    const second = await runOnce(runner);
    expect(second.record.id).toBe(first.record.id);
    expect(second.committed).toBe(true);
    const r = await row(first.record.id);
    // The worker must scan completions from before the FIRST submission, not the retry.
    expect(r).toMatchObject({ status: "COMMITTED", ledgerEndAtSubmit: 10 });
    expect(submitted.map((s) => s.commandId)).toEqual([r.ledgerCommandId, r.ledgerCommandId]);
  });

  it("still submits (and records the user) when the ledger end cannot be read", async () => {
    const { gateway, submitted } = fakeGateway([{ kind: "committed", updateId: "upd-3", offset: 7 }], [new Error("ledger end unavailable")]);
    const outcome = await runOnce(new WorkflowRunner({ db: handle.db, gateway, access }), "ctx-key-0003");
    expect(outcome.committed).toBe(true);
    expect(submitted).toHaveLength(1);
    expect(await row(outcome.record.id)).toMatchObject({ ledgerUserId: "borrower-svc", actAs: [PARTY], ledgerSource: "sandbox", ledgerEndAtSubmit: null });
  });

  it("records FAILED (never PREPARED or simulated) when the fresh ACS read cannot reach the ledger; a retry prepares again", async () => {
    const { gateway, submitted } = fakeGateway([], []);
    const runner = new WorkflowRunner({ db: handle.db, gateway, access });
    let prepared = 0;
    const run = () =>
      runner.run({
        actor,
        operation: "test.unreachable",
        idempotencyKey: "ctx-key-0005",
        payload: { n: 1 },
        // STATE points at http://127.0.0.1:1: nothing listens there.
        prepare: async (ctx) => {
          prepared += 1;
          await ctx.acs.list("AuditGrant");
          return { commands: [COMMAND] };
        },
      });
    const first = await run();
    expect(first.committed).toBe(false);
    expect(first.command).toMatchObject({ state: "FAILED", simulated: false });
    expect((await row(first.record.id)).status).toBe("FAILED");
    const second = await run();
    expect(second.record.id).toBe(first.record.id);
    expect(second.command.state).toBe("FAILED");
    expect(prepared).toBe(2);
    expect(submitted).toHaveLength(0);
  });

  it("records nothing for a gateway without ledgerEnd beyond the submitting identity", async () => {
    const gateway: LedgerGateway = { submit: async () => ({ kind: "rejected", errorKind: "FAILED_PRECONDITION", message: "no" }) };
    const outcome = await runOnce(new WorkflowRunner({ db: handle.db, gateway, access }), "ctx-key-0004");
    expect(outcome.record.status).toBe("REJECTED");
    expect(await row(outcome.record.id)).toMatchObject({ ledgerUserId: "borrower-svc", actAs: [PARTY], ledgerSource: "sandbox", ledgerEndAtSubmit: null });
  });
});
