import { commands, createPgliteDatabase, exportJobs, importLocalnetState, ledgerSources, ledgerUpdates, seedDemoIdentities, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, type FakeLedger, type ScenarioParties } from "@collara/db/testing";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { startRuntime, type WorkerRuntime } from "./runtime";

const config = loadConfig({
  COLLARA_MODE: "LOCALNET",
  DATABASE_URL: "postgres://unused",
  WORKER_ID: "test-worker",
  PROJECTION_POLL_INTERVAL_MS: "50",
  PROJECTION_PAGE_LIMIT: "7",
  PROJECTION_DELAY_SECONDS: "5",
  RECONCILE_INTERVAL_MS: "100",
  JOB_POLL_INTERVAL_MS: "100",
});
const log = pino({ level: "silent" });

async function until<T>(probe: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`condition not met: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("worker runtime (PGlite + in-memory ledger)", () => {
  let handle: DbHandle;
  let ledger: FakeLedger;
  let P: ScenarioParties;
  let controller: AbortController;
  let runtime: WorkerRuntime | null;

  beforeEach(async () => {
    handle = await createPgliteDatabase();
    await seedDemoIdentities(handle.db);
    await importLocalnetState(handle.db, scenarioBindingState());
    ({ ledger, parties: P } = buildScenario("main"));
    controller = new AbortController();
    runtime = null;
  });

  afterEach(async () => {
    controller.abort();
    if (runtime) await runtime.done;
    await handle.close();
  });

  const start = () =>
    startRuntime({
      config,
      db: handle.db,
      ledger: { sources: [{ config: { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P), ledgerUserId: "projector-svc" }, client: ledger }], completionClient: () => ledger },
      log,
      signal: controller.signal,
    });

  const command = (id: string, values: Partial<typeof commands.$inferInsert>) => ({
    idempotencyKey: id,
    actorUserId: "user-manufacturer-owner",
    orgId: "demo-manufacturer",
    operation: "test.operation",
    target: "LEDGER",
    payloadHash: "hash",
    payload: {},
    ledgerCommandId: id,
    ...values,
  });

  it("projects to the ledger end, advances command states, reconciles unknown outcomes, runs export jobs and reports health", async () => {
    const old = new Date(Date.now() - 60_000);
    const projectedTx = ledger.transactions[5];
    const reconciledTx = ledger.transactions[10];
    if (!projectedTx || !reconciledTx) throw new Error("scenario too short");
    await handle.db.insert(commands).values([
      command("cmd-committed", { status: "COMMITTED", updateId: projectedTx.updateId, committedAt: old }),
      command("cmd-lost-update", { status: "COMMITTED", updateId: "1220upd-never-applied", committedAt: old }),
      command("cmd-unknown", { status: "UNKNOWN_OUTCOME", ledgerUserId: "demomanufacturer-svc", actAs: [P.owner], updatedAt: old }),
    ]);
    ledger.completions.push({
      commandId: "cmd-unknown",
      submissionId: "sub-1",
      updateId: reconciledTx.updateId,
      offset: reconciledTx.offset,
      userId: "demomanufacturer-svc",
      actAs: [P.owner],
      status: { code: 0, message: "" },
    });
    await handle.db.insert(exportJobs).values({
      reportRef: "RPT-0001",
      caseRef: "CL-001",
      requestedByUserId: "user-manufacturer-owner",
      orgId: "demo-manufacturer",
      scope: {},
      schemaVersion: "collara.case-report/v1",
    });

    runtime = start();
    const end = await ledger.ledgerEnd();
    const health = await until(
      () => (runtime as WorkerRuntime).health(),
      (h) => {
        const s = (h.sources as { checkpoint: number }[])[0];
        const c = h.commands as Record<string, number>;
        return s?.checkpoint === end && !c.COMMITTED && !c.UNKNOWN_OUTCOME && (h.loops as { exports: { runs: number } }).exports.runs > 0;
      },
    );
    expect(health).toMatchObject({
      degraded: false,
      sources: [{ source: "sandbox", status: "ACTIVE", checkpoint: end, ledgerEnd: end, lag: 0, resetReason: null, lastError: null }],
      commands: { PROJECTION_DELAYED: 1 },
    });

    const rows = new Map((await handle.db.select().from(commands)).map((r) => [r.ledgerCommandId, r]));
    expect(rows.get("cmd-committed")?.status).toBe("PROJECTED");
    expect(rows.get("cmd-lost-update")?.status).toBe("PROJECTION_DELAYED");
    // UNKNOWN_OUTCOME → COMMITTED (completion found) → PROJECTED (its update is in ledger_updates).
    expect(rows.get("cmd-unknown")).toMatchObject({ status: "PROJECTED", updateId: reconciledTx.updateId, reconcileAttempts: 1 });
    const [job] = await handle.db.select().from(exportJobs);
    // The export handler ran and settled the job (it cannot produce a report here: no case facts or no storage).
    expect(job).toMatchObject({ state: "FAILED", leaseOwner: null });
    expect(job?.errorMessage).toBeTruthy();

    // New ledger activity after the worker caught up is picked up by the running loop.
    const extra = ledger.tx((tx) => tx.foreign(P.owner));
    await until(
      () => handle.db.select().from(ledgerSources),
      (r) => r[0]?.checkpointOffset === extra.offset,
    );

    controller.abort();
    await runtime.done;
  });

  it("restarts from the durable checkpoint and reports a reset instead of mixing histories", async () => {
    runtime = start();
    const end = await ledger.ledgerEnd();
    await until(
      () => handle.db.select().from(ledgerSources),
      (r) => r[0]?.checkpointOffset === end,
    );
    controller.abort();
    await runtime.done;
    const appliedBefore = (await handle.db.select().from(ledgerUpdates)).length;

    // A second worker instance resumes at the checkpoint: nothing is re-applied.
    controller = new AbortController();
    runtime = start();
    await until(
      () => (runtime as WorkerRuntime).health(),
      (h) => (h.sources as { lastPassAt: string | null }[])[0]?.lastPassAt !== null,
    );
    expect((await handle.db.select().from(ledgerUpdates)).length).toBe(appliedBefore);
    controller.abort();
    await runtime.done;

    // After a ledger reset (new participant id) the source stops and health reports it.
    controller = new AbortController();
    ledger.participant = "sandbox::1220reset";
    runtime = start();
    const health = await until(
      () => (runtime as WorkerRuntime).health(),
      (h) => (h.sources as { status: string }[])[0]?.status === "RESET_DETECTED",
    );
    expect(health.degraded).toBe(true);
    expect(health.sources).toMatchObject([{ checkpoint: end, resetReason: expect.stringContaining("participant changed") }]);
  });
});
