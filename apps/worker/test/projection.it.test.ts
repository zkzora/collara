// LIVE projection test against the shared LocalNet sandbox (opt-in: PROJECTION_IT=1). Read-only on the ledger:
// it projects an already seeded namespace (default: the ledger-core builder's prefix "core") into its own
// database, with the real worker process.
//
//   PROJECTION_IT=1 pnpm --filter @collara/worker test:it
//
// Environment (defaults in brackets):
//   PROJECTION_IT_DATABASE_URL  [postgres://collara:collara_dev@127.0.0.1:5432/collara_proj]  created if missing
//   COLLARA_LOCALNET_STATE      [<repo>/.local/localnet/state-core.json]
//   PROJECTION_IT_BORROWER_USER [<prefix>-borrower-svc from the state]  ledger user whose completions are read
//   WORKER_PORT                 [4110]
//   PROJECTION_IT_REPORT        [<repo>/.local/it/projection-it-report.json]  the run's numbers
//
// Steps: (1) reference projection into in-process PGlite (uninterrupted); (2) reset the PostgreSQL projection,
// add command records (COMMITTED with a real update id, COMMITTED with an update that never comes, and an
// UNKNOWN_OUTCOME with a real command id from the borrower's completions); (3) start the worker, hard-kill it
// mid-stream, restart it and wait for convergence; (4) compare counts and hashes with the reference; (5) replay
// from an older checkpoint (duplicate delivery) and compare again; (6) read CL-001 through the read model as
// Demo Lender A and Demo Lender B.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalnetState, type LocalnetState } from "@collara/canton";
import {
  commands,
  createPgDatabase,
  createPgliteDatabase,
  exportJobs,
  importLocalnetState,
  ledgerSources,
  loadReadWorld,
  projectOnce,
  resetProjectionSource,
  seedDemoIdentities,
  type Db,
  type DbHandle,
  type ReadViewer,
} from "@collara/db";
import { deriveCaseStage } from "@collara/domain";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { claimExportJob } from "../src/jobs/registry";
import { connectLedger, type WorkerLedger } from "../src/ledger";

const RUN = process.env.PROJECTION_IT === "1";
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const WORKER_DIR = fileURLToPath(new URL("../", import.meta.url));
const DATABASE_URL = process.env.PROJECTION_IT_DATABASE_URL ?? "postgres://collara:collara_dev@127.0.0.1:5432/collara_proj";
const STATE_PATH = process.env.COLLARA_LOCALNET_STATE ?? `${REPO}.local/localnet/state-core.json`;
const PORT = Number(process.env.WORKER_PORT ?? 4110);
const SOURCE = "sandbox";
const REPORT_PATH = process.env.PROJECTION_IT_REPORT ?? `${REPO}.local/it/projection-it-report.json`;

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => (result as { rows: Row[] }).rows;

async function ensureDatabase(url: string): Promise<boolean> {
  const name = new URL(url).pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(name) || ["collara", "collara_test", "postgres"].includes(name)) throw new Error(`refusing to use database ${name}`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    if ((await client.query("select 1 from pg_database where datname = $1", [name])).rowCount) return false;
    await client.query(`create database "${name}"`);
    return true;
  } finally {
    await client.end();
  }
}

/** Row counts and hashes of the projection up to `upTo` (inclusive), comparable across databases. */
async function fingerprint(db: Db, upTo: number) {
  const [row] = rowsOf(
    await db.execute(sql`
      select
        (select count(*)::int from ledger_updates where source = ${SOURCE} and "offset" <= ${upTo}) as updates,
        (select count(*)::int from ledger_events where source = ${SOURCE} and "offset" <= ${upTo}) as events,
        (select count(*)::int from ledger_contracts where source = ${SOURCE} and created_offset <= ${upTo}) as contracts,
        (select count(*)::int from ledger_contracts where source = ${SOURCE} and archived_offset <= ${upTo}) as archived,
        (select md5(coalesce(string_agg(contract_id || ':' || case when archived_offset <= ${upTo} then archived_offset::text else '-' end, ',' order by contract_id), ''))
           from ledger_contracts where source = ${SOURCE} and created_offset <= ${upTo}) as contracts_hash,
        (select md5(coalesce(string_agg(update_id || '/' || node_id::text || '/' || kind, ',' order by update_id, node_id), ''))
           from ledger_events where source = ${SOURCE} and "offset" <= ${upTo}) as events_hash`),
  );
  return row as { updates: number; events: number; contracts: number; archived: number; contracts_hash: string; events_hash: string };
}

/** Every applied update has exactly its projected events (no half-applied transaction survived a kill). */
async function partialUpdates(db: Db): Promise<number> {
  const [row] = rowsOf(
    await db.execute(sql`
      select count(*)::int as n from ledger_updates u
      where u.source = ${SOURCE}
        and u.projected_events <> (select count(*) from ledger_events e where e.source = u.source and e.update_id = u.update_id)`),
  );
  return Number(row?.n ?? -1);
}

async function checkpoint(db: Db): Promise<number> {
  const [row] = await db.select({ c: ledgerSources.checkpointOffset }).from(ledgerSources).where(eq(ledgerSources.source, SOURCE));
  return row?.c ?? 0;
}

function startWorker(log: string[]): ChildProcess {
  const tsxCli = createRequire(`${WORKER_DIR}package.json`).resolve("tsx/cli");
  const envFile = `${REPO}.env`;
  const child = spawn(process.execPath, [tsxCli, ...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), "src/main.ts"], {
    cwd: WORKER_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      COLLARA_MODE: "LOCALNET",
      DATABASE_URL,
      COLLARA_LOCALNET_STATE: STATE_PATH,
      WORKER_PORT: String(PORT),
      // One update per page: the projection is slow enough to be killed mid-stream.
      PROJECTION_PAGE_LIMIT: "1",
      PROJECTION_POLL_INTERVAL_MS: "200",
      PROJECTION_DELAY_SECONDS: "5",
      RECONCILE_INTERVAL_MS: "500",
      LOG_LEVEL: "info",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const collect = (chunk: Buffer) => log.push(...chunk.toString().split("\n").filter(Boolean));
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  return child;
}

/** Hard kill (a crash, not a graceful stop): the whole process tree. */
async function killWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || !child.pid) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGKILL");
  await exited;
}

async function until<T>(what: string, probe: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 120_000, everyMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    try {
      last = await probe();
      if (ok(last)) return last;
    } catch {
      // not ready yet
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

async function health(): Promise<Row> {
  const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
  return (await res.json()) as Row;
}

describe.skipIf(!RUN)("LIVE projection (shared LocalNet sandbox)", () => {
  let state: LocalnetState;
  let ledger: WorkerLedger;
  let handle: DbHandle;
  let reference: DbHandle;
  let referenceEnd = 0;
  const workerLog: string[] = [];
  const children: ChildProcess[] = [];
  const report: Record<string, unknown> = {};

  beforeAll(async () => {
    const loaded = await loadLocalnetState(STATE_PATH);
    if (!loaded) throw new Error(`LocalNet state not found at ${STATE_PATH}`);
    state = loaded;
    ledger = await connectLedger(loadConfig({ ...process.env, COLLARA_MODE: "LOCALNET", DATABASE_URL, COLLARA_LOCALNET_STATE: STATE_PATH, PROJECTION_SOURCES: SOURCE }));
    report.database = { url: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"), created: await ensureDatabase(DATABASE_URL) };
    handle = createPgDatabase({ url: DATABASE_URL, max: 4, applicationName: "collara-projection-it" });
    await handle.migrate();
    await seedDemoIdentities(handle.db);
    await importLocalnetState(handle.db, state);
  });

  afterAll(async () => {
    for (const child of children) await killWorker(child);
    await reference?.close();
    await handle?.close();
    // Vitest hides the console output of passing tests: the report also goes to a file.
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, JSON.stringify({ report, workerLog: workerLog.slice(-40) }, null, 2));
    console.log(`PROJECTION_IT REPORT (${REPORT_PATH}) ${JSON.stringify(report, null, 2)}`);
  });

  it("projects the namespace through kill/restart, converges to the reference and treats re-delivery as a no-op", async () => {
    const source = ledger.sources[0];
    if (!source) throw new Error("no projection source");

    // (1) Reference: one uninterrupted pass into PGlite.
    reference = await createPgliteDatabase();
    await seedDemoIdentities(reference.db);
    await importLocalnetState(reference.db, state);
    const t0 = Date.now();
    const ref = await projectOnce(reference.db, source.client, source.config);
    referenceEnd = ref.checkpoint;
    report.reference = { ms: Date.now() - t0, ledgerEnd: ref.ledgerEnd, applied: ref.transactionsApplied, events: ref.eventsProjected, fingerprint: await fingerprint(reference.db, referenceEnd) };
    expect(ref.complete).toBe(true);
    expect(ref.transactionsApplied).toBeGreaterThan(10);

    // (2) Fresh PostgreSQL projection + command records to advance.
    const reset = await resetProjectionSource(handle.db, SOURCE, { participantId: await source.client.participantId(), jsonApiUrl: source.config.jsonApiUrl });
    report.resetBeforeRun = reset;
    await handle.db.delete(commands).where(or(like(commands.idempotencyKey, "it-proj-%"), like(commands.ledgerCommandId, "it-proj-%")));
    const [lastUpdate] = rowsOf(await reference.db.execute(sql`select update_id, "offset" from ledger_updates order by "offset" desc limit 1`));
    const borrowerUser = process.env.PROJECTION_IT_BORROWER_USER ?? state.users.find((u) => u.party === "DemoManufacturer")?.id ?? "";
    const borrowerParty = state.parties.DemoManufacturer?.party ?? "";
    const completionClient = ledger.completionClient(borrowerUser, SOURCE);
    if (!completionClient) throw new Error(`no completion client for ${borrowerUser}`);
    const completions = await completionClient.commandCompletions({ parties: [borrowerParty], beginExclusive: 0, limit: 20 });
    const realCompletion = completions.completions.find((c) => c.status.code === 0 && c.updateId);
    if (!realCompletion) throw new Error(`no committed completion for ${borrowerUser}`);
    await handle.db.delete(commands).where(eq(commands.ledgerCommandId, realCompletion.commandId));
    const old = new Date(Date.now() - 60_000);
    const base = { actorUserId: "user-manufacturer-owner", orgId: "demo-manufacturer", operation: "it.projection", target: "LEDGER", payloadHash: "it", payload: {} };
    await handle.db.insert(commands).values([
      { ...base, idempotencyKey: "it-proj-committed", ledgerCommandId: "it-proj-committed", status: "COMMITTED", updateId: String(lastUpdate?.update_id), committedAt: new Date() },
      { ...base, idempotencyKey: "it-proj-delayed", ledgerCommandId: "it-proj-delayed", status: "COMMITTED", updateId: "it-proj-update-that-never-comes", committedAt: old },
      { ...base, idempotencyKey: "it-proj-unknown", ledgerCommandId: realCompletion.commandId, status: "UNKNOWN_OUTCOME", ledgerUserId: borrowerUser, actAs: [borrowerParty], ledgerSource: SOURCE, ledgerEndAtSubmit: 0, updatedAt: old },
    ]);
    report.commandsInserted = { committedUpdateId: lastUpdate?.update_id, unknownOutcomeCommandId: realCompletion.commandId, unknownOutcomeExpectedUpdate: realCompletion.updateId };

    // (3) Worker #1, hard-killed mid-stream.
    const first = startWorker(workerLog);
    children.push(first);
    const mid = await until("worker #1 to apply some updates", () => checkpoint(handle.db), (c) => c > 0, 120_000, 20);
    await killWorker(first);
    const killedAt = await checkpoint(handle.db);
    const afterKill = await fingerprint(handle.db, Number.MAX_SAFE_INTEGER);
    report.killedMidStream = { observedCheckpoint: mid, checkpointAfterKill: killedAt, referenceEnd, updatesApplied: afterKill.updates, partialUpdates: await partialUpdates(handle.db) };
    expect(killedAt).toBeLessThan(referenceEnd);
    expect(await partialUpdates(handle.db)).toBe(0);

    // Worker #2 resumes from the durable checkpoint and converges.
    const second = startWorker(workerLog);
    children.push(second);
    const healthy = await until(
      "worker #2 to reach the ledger end",
      health,
      (h) => {
        const s = (h.sources as Row[] | undefined)?.[0];
        return !!s && Number(s.checkpoint) >= referenceEnd && s.lag === 0;
      },
    );
    const statuses = await until(
      "command states",
      async () => new Map((await handle.db.select().from(commands).where(inArray(commands.idempotencyKey, ["it-proj-committed", "it-proj-delayed", "it-proj-unknown"]))).map((r) => [r.idempotencyKey, r])),
      (m) => m.get("it-proj-committed")?.status === "PROJECTED" && m.get("it-proj-unknown")?.status === "PROJECTED" && m.get("it-proj-delayed")?.status === "PROJECTION_DELAYED",
      30_000,
      200,
    );
    report.health = healthy;
    report.commands = Object.fromEntries(
      [...statuses].map(([k, r]) => [k, { status: r.status, updateId: r.updateId, completionOffset: r.completionOffset, reconcileAttempts: r.reconcileAttempts, reconcileNote: r.reconcileNote }]),
    );
    expect(statuses.get("it-proj-unknown")?.updateId).toBe(realCompletion.updateId);
    await killWorker(second);

    // (4) Convergence with the uninterrupted reference.
    const converged = await fingerprint(handle.db, referenceEnd);
    const expected = await fingerprint(reference.db, referenceEnd);
    report.converged = { postgres: converged, reference: expected, equal: JSON.stringify(converged) === JSON.stringify(expected) };
    expect(converged).toEqual(expected);
    expect(await partialUpdates(handle.db)).toBe(0);

    // (5) Duplicate delivery: move the checkpoint back and project again; the unique keys make it a no-op.
    // The older checkpoint sits just before the median applied update, so the second half is delivered again.
    const offsets = rowsOf(await handle.db.execute(sql`select "offset" from ledger_updates where source = ${SOURCE} order by "offset"`)).map((r) => Number(r.offset));
    const older = (offsets[Math.floor(offsets.length / 2)] ?? 1) - 1;
    const redelivered = offsets.filter((o) => o > older).length;
    await handle.db.update(ledgerSources).set({ checkpointOffset: older }).where(eq(ledgerSources.source, SOURCE));
    const replay = await projectOnce(handle.db, source.client, source.config, { pageLimit: 7 });
    const afterReplay = await fingerprint(handle.db, referenceEnd);
    report.replay = {
      from: older,
      to: replay.checkpoint,
      redelivered,
      applied: replay.transactionsApplied,
      skippedAsDuplicates: replay.transactionsSkipped,
      unchanged: JSON.stringify(afterReplay) === JSON.stringify(converged),
    };
    expect(replay.transactionsApplied).toBe(0);
    expect(replay.transactionsSkipped).toBe(redelivered);
    expect(redelivered).toBeGreaterThan(0);
    expect(afterReplay).toEqual(converged);
    // And a second pass at the ledger end changes nothing either.
    const again = await projectOnce(handle.db, source.client, source.config);
    expect(again.transactionsApplied).toBe(0);
  });

  it("reads CL-001 through the read model: Demo Lender A sees the case, Demo Lender B sees nothing", async () => {
    const party = (hint: string) => state.parties[hint]?.party ?? "";
    const viewers: Record<string, ReadViewer> = {
      lenderA: { orgId: "demo-lender-a", readableParties: [party("DemoLenderA")], roles: ["LENDER_ANALYST"] },
      lenderB: { orgId: "demo-lender-b", readableParties: [party("DemoLenderB")], roles: ["LENDER_ANALYST"] },
      lenderBSeatHolder: { orgId: "demo-lender-b", readableParties: [party("DemoLenderB"), party("GovSeat2"), party("CollaraGovernance")], roles: ["LENDER_APPROVER"] },
      borrower: { orgId: "demo-manufacturer", readableParties: [party("DemoManufacturer")], roles: ["BORROWER"] },
      verifier: { orgId: "demo-verifier", readableParties: [party("DemoVerifier")], roles: ["VERIFIER"] },
    };
    const seen: Record<string, unknown> = {};
    for (const [name, viewer] of Object.entries(viewers)) {
      const world = await loadReadWorld(handle.db, viewer);
      const facts = world.cases.find((c) => c.ref === "CL-001") ?? null;
      seen[name] = {
        templatesInView: [...new Set(world.view.contracts.map((c) => c.templateRef.split(":").at(-1)))].sort(),
        caseRefs: world.cases.map((c) => c.ref),
        assetRefs: world.assets.map((a) => a.ref),
        lastSync: world.lastSync,
        cl001: facts && {
          stage: deriveCaseStage(facts, new Date()),
          borrowerOrgId: facts.borrowerOrgId,
          selectedLenderOrgId: facts.selectedLenderOrgId,
          asset: { ref: facts.asset.ref, model: facts.asset.model, serial: facts.asset.serialNumber, lifecycle: facts.asset.lifecycle, control: facts.asset.control },
          package: { ref: facts.asset.package.ref, version: facts.asset.package.version, entries: facts.asset.package.entries.length },
          verifications: facts.asset.verifications.map((v) => `${v.ref}:${v.state}`),
          attestations: facts.asset.attestations.map((a) => `${a.ref}:v${a.packageVersion}`),
          shares: facts.shares.map((s) => `${s.ref}:${s.state}:${s.entries.length} docs`),
          review: { ref: facts.review.ref, state: facts.review.state, hasAssessment: facts.review.assessment !== null },
          proposals: facts.proposals.map((p) => `${p.ref} v${p.version}:${p.state}`),
          lock: facts.lock?.ref ?? null,
          events: facts.events.length + facts.asset.events.length,
        },
      };
    }
    report.readModel = seen;
    const a = seen.lenderA as { cl001: { review: { state: string } } | null; caseRefs: string[] };
    expect(a.cl001).not.toBeNull();
    expect(a.cl001?.review.state).toBe("SUBMITTED");
    for (const name of ["lenderB", "lenderBSeatHolder"]) {
      const b = seen[name] as { cl001: unknown; caseRefs: string[]; assetRefs: string[]; templatesInView: string[] };
      expect(b.cl001).toBeNull();
      expect(b.caseRefs).toEqual([]);
      expect(b.assetRefs).toEqual([]);
      expect(b.templatesInView.filter((t) => !["CollaraConfig", "VerifierStatusMirror", "GovernanceRules", "GovernanceConfirmation", "GovernanceExecutionResult", "VerifierRegistry", "VerifierAccreditation", "BootstrapVerifierRegistryProposal", "AddVerifierProposal", "SuspendVerifierProposal"].includes(t))).toEqual([]);
    }
    const v = seen.verifier as { templatesInView: string[] };
    expect(v.templatesInView).not.toContain("FinancingProposal");
    expect(v.templatesInView).not.toContain("CollateralAssessment");
  });

  it("leases export jobs so two concurrent workers never take the same job (PostgreSQL)", async () => {
    const other = createPgDatabase({ url: DATABASE_URL, max: 2, applicationName: "collara-projection-it-2" });
    try {
      await handle.db.delete(exportJobs).where(like(exportJobs.reportRef, "RPT-IT-%"));
      const refs = ["RPT-IT-1", "RPT-IT-2", "RPT-IT-3", "RPT-IT-4", "RPT-IT-5", "RPT-IT-6"];
      await handle.db.insert(exportJobs).values(
        refs.map((reportRef) => ({ reportRef, caseRef: "CL-001", requestedByUserId: "user-manufacturer-owner", orgId: "demo-manufacturer", scope: {}, schemaVersion: "collara.case-report/v1" })),
      );
      const claimAll = async (db: Db, workerId: string) => {
        const claimed: string[] = [];
        for (;;) {
          const job = await claimExportJob(db, { workerId, leaseSeconds: 60, maxAttempts: 3, now: new Date() });
          if (!job) return claimed;
          if (job.reportRef.startsWith("RPT-IT-")) claimed.push(job.reportRef);
        }
      };
      const [a, b] = await Promise.all([claimAll(handle.db, "it-worker-a"), claimAll(other.db, "it-worker-b")]);
      report.exportLeasing = { workerA: a, workerB: b };
      expect([...a, ...b].sort()).toEqual(refs);
      expect(a.filter((r) => b.includes(r))).toEqual([]);
      const rows = await handle.db.select().from(exportJobs).where(like(exportJobs.reportRef, "RPT-IT-%"));
      expect(rows.every((r) => r.state === "GENERATING" && r.attempts === 1 && (r.leaseOwner === "it-worker-a" || r.leaseOwner === "it-worker-b"))).toBe(true);
    } finally {
      await handle.db.delete(exportJobs).where(like(exportJobs.reportRef, "RPT-IT-%"));
      await other.close();
    }
  });
});
