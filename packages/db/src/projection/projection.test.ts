import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { createPgliteDatabase, type DbHandle } from "../client";
import { commands, ledgerContracts, ledgerEvents, ledgerSources, ledgerUpdates } from "../schema";
import { seedDemoIdentities } from "../seed";
import { applyTransaction } from "./apply";
import { advanceCommandStatuses, reconcileUnknownOutcomes } from "./commands";
import { FakeLedger } from "./fake-ledger";
import { projectOnce, resetProjectionSource, type ProjectionSourceConfig } from "./project";
import { TEMPLATES as T } from "./index";

const NS = "1220aaaa";
const P = {
  registrar: `CollaraRegistrar::${NS}`,
  owner: `DemoManufacturer::${NS}`,
  lenderA: `DemoLenderA::${NS}`,
  lenderB: `DemoLenderB::${NS}`,
};
const PARTIES = Object.values(P);
const source = (parties: readonly string[] = PARTIES): ProjectionSourceConfig => ({
  source: "sandbox",
  jsonApiUrl: "http://127.0.0.1:7575",
  parties,
  ledgerUserId: "projector-svc",
});

let handle: DbHandle;

async function wipe() {
  const db = handle.db;
  await db.delete(commands);
  await db.delete(ledgerEvents);
  await db.delete(ledgerContracts);
  await db.delete(ledgerUpdates);
  await db.delete(ledgerSources);
}

async function counts() {
  const db = handle.db;
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerContracts);
  const [e] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerEvents);
  const [u] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerUpdates);
  const [s] = await db.select().from(ledgerSources).where(eq(ledgerSources.source, "sandbox"));
  return { contracts: c?.n ?? 0, events: e?.n ?? 0, updates: u?.n ?? 0, checkpoint: s?.checkpointOffset ?? null, status: s?.status ?? null };
}

/** Registration-like history: control v1 created, shared with Lender A (consume + recreate), an exercised-only node. */
function history(ledger: FakeLedger) {
  let control = "";
  const t1 = ledger.tx((tx) => {
    control = tx.create(
      T.AssetControl,
      { registrar: P.registrar, owner: P.owner, namespace: "collara-localnet", assetId: "ASSET-DEMO-001", controlVersion: "1", evidence: null, sharedLender: null },
      { signatories: [P.registrar, P.owner] },
    );
  });
  const t2 = ledger.tx((tx) => {
    tx.exercise(control, "Control_ShareWithLender", { lender: P.lenderA, actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner] });
    control = tx.create(
      T.AssetControl,
      { registrar: P.registrar, owner: P.owner, namespace: "collara-localnet", assetId: "ASSET-DEMO-001", controlVersion: "1", evidence: null, sharedLender: P.lenderA },
      { signatories: [P.registrar, P.owner], observers: [P.lenderA] },
    );
    tx.foreign(P.owner);
  });
  return { t1, t2, control: () => control };
}

beforeAll(async () => {
  handle = await createPgliteDatabase();
  await seedDemoIdentities(handle.db);
});

afterAll(async () => {
  await handle.close();
});

beforeEach(wipe);

describe("projection: applying updates", () => {
  it("upserts created contracts, archives consumed ones, stores exercised events and advances the checkpoint", async () => {
    const ledger = new FakeLedger();
    const { control } = history(ledger);
    const result = await projectOnce(handle.db, ledger, source());
    expect(result).toMatchObject({ status: "ACTIVE", checkpointBefore: 0, checkpoint: 2, ledgerEnd: 2, transactionsApplied: 2, complete: true });

    const rows = await handle.db.select().from(ledgerContracts).orderBy(asc(ledgerContracts.createdOffset));
    expect(rows).toHaveLength(2);
    const [v1, shared] = rows;
    expect(v1?.archivedOffset).toBe(2);
    expect(v1?.archivedChoice).toBe("Control_ShareWithLender");
    expect(shared?.contractId).toBe(control());
    expect(shared?.archivedOffset).toBeNull();
    expect(shared?.stakeholders.sort()).toEqual([P.lenderA, P.owner, P.registrar].sort());
    expect(shared).toMatchObject({ templateRef: T.AssetControl, packageName: "collara-contracts", businessRef: "ASSET-DEMO-001", assetRef: "ASSET-DEMO-001", caseRef: null });

    const events = await handle.db.select().from(ledgerEvents).orderBy(asc(ledgerEvents.offset), asc(ledgerEvents.nodeId));
    expect(events.map((e) => `${e.offset}:${e.kind}:${e.choice ?? ""}`)).toEqual(["1:created:", "2:exercised:Control_ShareWithLender", "2:created:"]);
    expect(events[1]?.actingParties).toEqual([P.owner]);
    expect(events[1]?.detail).toMatchObject({ argument: { lender: P.lenderA } });

    const updates = await handle.db.select().from(ledgerUpdates).orderBy(asc(ledgerUpdates.offset));
    // The foreign-package event is counted but not stored.
    expect(updates.map((u) => [u.offset, u.projectedEvents, u.totalEvents])).toEqual([
      [1, 1, 1],
      [2, 2, 3],
    ]);
  });

  it("treats duplicate delivery as a no-op (same transaction twice, and a full re-delivery from offset 0)", async () => {
    const ledger = new FakeLedger();
    const { t1, t2 } = history(ledger);
    await projectOnce(handle.db, ledger, source());
    const before = await counts();

    expect((await applyTransaction(handle.db, "sandbox", t2)).applied).toBe(false);
    expect((await applyTransaction(handle.db, "sandbox", t1)).applied).toBe(false);

    ledger.redeliverAll = true;
    ledger.tx((tx) => {
      tx.create(T.AuditGrant, { grantor: P.owner, auditor: P.lenderB, grantRef: "AG-001", caseRef: "CL-001" }, { signatories: [P.owner], observers: [P.lenderB] });
    });
    const again = await projectOnce(handle.db, ledger, source());
    expect(again.transactionsSkipped).toBe(2);
    expect(again.transactionsApplied).toBe(1);
    const after = await counts();
    expect(after).toEqual({ ...before, contracts: before.contracts + 1, events: before.events + 1, updates: before.updates + 1, checkpoint: 3 });
  });

  it("rolls back the whole update (rows and checkpoint) when applying fails mid-update", async () => {
    const ledger = new FakeLedger();
    const { t2 } = history(ledger);
    let fail = true;
    await expect(
      projectOnce(handle.db, ledger, source(), {
        beforeCommit: async (_tx, transaction) => {
          if (fail && transaction.updateId === t2.updateId) throw new Error("injected failure");
        },
      }),
    ).rejects.toThrow("injected failure");
    const partial = await counts();
    expect(partial).toMatchObject({ contracts: 1, events: 1, updates: 1, checkpoint: 1 });
    const [v1] = await handle.db.select().from(ledgerContracts);
    expect(v1?.archivedOffset).toBeNull();
    const [row] = await handle.db.select().from(ledgerSources);
    expect(row?.lastError).toContain("injected failure");

    fail = false;
    const resumed = await projectOnce(handle.db, ledger, source());
    expect(resumed).toMatchObject({ checkpointBefore: 1, checkpoint: 2, transactionsApplied: 1 });
    expect(await counts()).toMatchObject({ contracts: 2, events: 3, updates: 2, checkpoint: 2 });
  });

  it("pages through updates and moves the checkpoint over offsets the projector cannot see", async () => {
    const ledger = new FakeLedger();
    for (let i = 0; i < 5; i++) {
      ledger.tx((tx) => {
        tx.create(T.AuditGrant, { grantor: P.owner, auditor: P.lenderB, grantRef: `AG-00${i}`, caseRef: "CL-001" }, { signatories: [P.owner], observers: [P.lenderB] });
      });
      ledger.invisibleOffset();
    }
    const result = await projectOnce(handle.db, ledger, source(), { pageLimit: 2 });
    expect(result).toMatchObject({ checkpoint: 10, ledgerEnd: 10, transactionsApplied: 5, complete: true });
    expect(ledger.updateCalls).toBeGreaterThanOrEqual(3);
  });
});

describe("projection: reset detection", () => {
  it("refuses to apply after a participant id change until the operator resets the source", async () => {
    const ledger = new FakeLedger();
    history(ledger);
    await projectOnce(handle.db, ledger, source());

    const restarted = new FakeLedger();
    restarted.participant = "sandbox::1220new";
    history(restarted);
    restarted.tx(() => {});
    const result = await projectOnce(handle.db, restarted, source());
    expect(result.status).toBe("RESET_DETECTED");
    expect(result.resetReason).toContain("participant changed");
    expect(result.transactionsApplied).toBe(0);
    expect((await counts()).checkpoint).toBe(2);
    // Still refused on the next pass.
    expect((await projectOnce(handle.db, restarted, source())).status).toBe("RESET_DETECTED");

    const summary = await resetProjectionSource(handle.db, "sandbox", { participantId: restarted.participant });
    expect(summary).toMatchObject({ contracts: 2, events: 3, updates: 2 });
    const rebuilt = await projectOnce(handle.db, restarted, source());
    expect(rebuilt).toMatchObject({ status: "ACTIVE", checkpoint: 3, transactionsApplied: 2 });
  });

  it("detects a ledger end behind the checkpoint and a changed party filter", async () => {
    const ledger = new FakeLedger();
    history(ledger);
    await projectOnce(handle.db, ledger, source());

    const shorter = new FakeLedger();
    shorter.tx(() => {});
    const behind = await projectOnce(handle.db, shorter, source());
    expect(behind.status).toBe("RESET_DETECTED");
    expect(behind.resetReason).toBe("ledger end 1 is behind checkpoint 2");

    await resetProjectionSource(handle.db, "sandbox");
    await projectOnce(handle.db, ledger, source());
    const widened = await projectOnce(handle.db, ledger, source([...PARTIES, "DemoAuditor::1220aaaa"]));
    expect(widened.status).toBe("RESET_DETECTED");
    expect(widened.resetReason).toContain("party filter changed (1 added, 0 removed)");
  });
});

describe("projection: command status advancement", () => {
  async function command(updateId: string | null, status: string, committedAt: Date | null, extra: Partial<typeof commands.$inferInsert> = {}) {
    const [row] = await handle.db
      .insert(commands)
      .values({
        idempotencyKey: `key-${Math.random()}`,
        actorUserId: "user-manufacturer-owner",
        orgId: "demo-manufacturer",
        operation: "test.op",
        target: "LEDGER",
        payloadHash: "h",
        payload: {},
        status,
        ledgerCommandId: `collara-${Math.random().toString(16).slice(2)}`,
        updateId,
        committedAt,
        ...extra,
      })
      .returning();
    if (!row) throw new Error("insert failed");
    return row;
  }
  const statusOf = async (id: string) => (await handle.db.select().from(commands).where(eq(commands.id, id)))[0]?.status;

  it("marks COMMITTED commands PROJECTED when their update is applied, and delays the others", async () => {
    const ledger = new FakeLedger();
    const { t1, t2 } = history(ledger);
    const now = new Date();
    const matched = await command(t1.updateId, "COMMITTED", now);
    const late = await command("1220upd-not-yet", "COMMITTED", new Date(now.getTime() - 10_000));
    const fresh = await command("1220upd-later", "COMMITTED", now);
    const app = await command(null, "COMMITTED", new Date(now.getTime() - 60_000), { target: "APPLICATION" });

    await projectOnce(handle.db, ledger, source(), { now: () => now });
    expect(await statusOf(matched.id)).toBe("PROJECTED");
    expect(await statusOf(late.id)).toBe("PROJECTION_DELAYED");
    expect(await statusOf(fresh.id)).toBe("COMMITTED");
    expect(await statusOf(app.id)).toBe("COMMITTED");

    // The API recorded COMMITTED after the worker had already applied the update (race): the sweep catches it.
    const raced = await command(t2.updateId, "COMMITTED", now);
    await advanceCommandStatuses(handle.db, { now });
    expect(await statusOf(raced.id)).toBe("PROJECTED");

    // The delayed command's update lands later: PROJECTION_DELAYED → PROJECTED.
    await handle.db.update(commands).set({ updateId: "1220upd000003" }).where(eq(commands.id, late.id));
    ledger.tx((tx) => {
      tx.create(T.AuditGrant, { grantor: P.owner, auditor: P.lenderB, grantRef: "AG-009", caseRef: "CL-001" }, { signatories: [P.owner], observers: [P.lenderB] });
    });
    const pass = await projectOnce(handle.db, ledger, source(), { now: () => now });
    expect(pass.commandsProjected).toBe(1);
    expect(await statusOf(late.id)).toBe("PROJECTED");
  });

  it("reconciles UNKNOWN_OUTCOME from completions: committed, rejected, or still unknown with the attempt recorded", async () => {
    const ledger = new FakeLedger();
    const { t1 } = history(ledger);
    await projectOnce(handle.db, ledger, source());
    const old = new Date(Date.now() - 60_000);
    const base = { ledgerUserId: "borrower-svc", actAs: [P.owner], ledgerEndAtSubmit: 0, updatedAt: old };
    const committed = await command(null, "UNKNOWN_OUTCOME", null, base);
    const rejected = await command(null, "UNKNOWN_OUTCOME", null, base);
    const unknown = await command(null, "UNKNOWN_OUTCOME", null, base);
    const deduped = await command(null, "UNKNOWN_OUTCOME", null, base);
    ledger.completions.push(
      { commandId: committed.ledgerCommandId, submissionId: "s1", updateId: t1.updateId, offset: 1, userId: "borrower-svc", actAs: [P.owner], status: { code: 0, message: "" } },
      { commandId: rejected.ledgerCommandId, submissionId: "s2", updateId: "", offset: 2, userId: "borrower-svc", actAs: [P.owner], status: { code: 9, message: "DAML_FAILURE" } },
      { commandId: deduped.ledgerCommandId, submissionId: "s3", updateId: "", offset: 2, userId: "borrower-svc", actAs: [P.owner], status: { code: 6, message: "DUPLICATE_COMMAND" } },
    );
    const outcomes = await reconcileUnknownOutcomes(handle.db, { completionClient: (user) => (user === "borrower-svc" ? ledger : null) });
    const byId = Object.fromEntries(outcomes.map((o) => [o.commandId, o.outcome]));
    expect(byId).toEqual({ [committed.id]: "COMMITTED", [rejected.id]: "REJECTED", [unknown.id]: "UNKNOWN", [deduped.id]: "UNKNOWN" });

    const rows = Object.fromEntries((await handle.db.select().from(commands)).map((r) => [r.id, r]));
    expect(rows[committed.id]).toMatchObject({ status: "COMMITTED", updateId: t1.updateId, completionOffset: 1, reconcileAttempts: 1 });
    expect(rows[rejected.id]).toMatchObject({ status: "REJECTED", errorKind: "COMPLETION_REJECTED", errorCode: "GRPC_9" });
    expect(rows[unknown.id]).toMatchObject({ status: "UNKNOWN_OUTCOME", reconcileAttempts: 1 });
    expect(rows[unknown.id]?.reconcileNote).toContain("no completion for borrower-svc");

    // Already applied update: the next sweep moves the reconciled command to PROJECTED.
    await advanceCommandStatuses(handle.db);
    expect(await statusOf(committed.id)).toBe("PROJECTED");
  });
});
