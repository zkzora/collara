// The worker's long-running loops (LOCALNET): one projection loop per participant source, UNKNOWN_OUTCOME
// reconciliation, and the export job runner. Everything durable lives in PostgreSQL (checkpoints, command
// states, job leases), so a restart — graceful or a crash — resumes where the last committed transaction left
// off. In-memory state is only what /healthz reports between passes.
import { classifyRecoveryError, type DevnetDiagnosis, type DevnetRecoveryCase } from "@collara/canton";
import {
  commands,
  exportJobs,
  ledgerCheckpoints,
  reconcileUnknownOutcomes,
  runProjectionLoop,
  type Db,
  type ProjectOnceResult,
} from "@collara/db";
import { inArray, sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { WorkerConfig } from "./config";
import type { HealthDetails } from "./health";
import { JOB_HANDLERS, runExportJobsOnce, type ExportJobHandler, type JobContext } from "./jobs/registry";
import type { WorkerLedger } from "./ledger";

export interface RuntimeOptions {
  readonly config: WorkerConfig;
  readonly db: Db;
  /** The projector clients per source and the completions clients (the bootstrap state itself is not needed). */
  readonly ledger: Pick<WorkerLedger, "sources" | "completionClient" | "recoveryCheck">;
  readonly log: Logger;
  readonly signal: AbortSignal;
  readonly now?: () => Date;
  readonly exportHandler?: ExportJobHandler;
}

export interface WorkerRuntime {
  /** Resolves once every loop has stopped (after `signal` aborts). Never rejects. */
  readonly done: Promise<void>;
  health(): Promise<HealthDetails>;
}

interface LoopState {
  runs: number;
  lastRunAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

interface SourceState {
  lastPass: ProjectOnceResult | null;
  lastPassAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Recovery case the last error signals (devnet-recovery), e.g. CREDENTIAL_REVOKED or PARTIES_MISSING. */
  lastErrorCase: DevnetRecoveryCase | null;
}

/** The recovery case a projection status stands for. */
function statusCase(status: string | undefined): DevnetRecoveryCase | null {
  if (status === "PRUNED") return "PRUNED";
  if (status === "RESET_DETECTED") return "LEDGER_RESET";
  return null;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Runs `task` every `intervalMs` until `signal` aborts; errors are logged and recorded, never thrown. */
async function every(name: string, intervalMs: number, state: LoopState, log: Logger, signal: AbortSignal, task: () => Promise<void>, now: () => Date) {
  while (!signal.aborted) {
    try {
      await task();
      state.runs++;
      state.lastRunAt = now().toISOString();
      state.lastError = null;
    } catch (error) {
      if (signal.aborted) break;
      state.lastError = message(error).slice(0, 500);
      state.lastErrorAt = now().toISOString();
      log.error({ err: error, loop: name }, `${name} loop failed`);
    }
    await sleep(intervalMs, signal);
  }
}

export function startRuntime(options: RuntimeOptions): WorkerRuntime {
  const { config, db, ledger, log, signal } = options;
  const now = options.now ?? (() => new Date());
  const sources = new Map<string, SourceState>(
    ledger.sources.map((s) => [s.config.source, { lastPass: null, lastPassAt: null, lastError: null, lastErrorAt: null, lastErrorCase: null }]),
  );
  const recovery: { diagnosis: DevnetDiagnosis | null; checkedAt: string | null; error: string | null } = { diagnosis: null, checkedAt: null, error: null };
  const loops = {
    reconcile: { runs: 0, lastRunAt: null, lastError: null, lastErrorAt: null } as LoopState,
    exports: { runs: 0, lastRunAt: null, lastError: null, lastErrorAt: null } as LoopState,
  };

  const projection = ledger.sources.map(({ config: source, client }) => {
    const state = sources.get(source.source);
    let lastStatus: string | null = null;
    const slog = log.child({ source: source.source });
    slog.info({ jsonApiUrl: source.jsonApiUrl, ledgerUser: source.ledgerUserId, parties: source.parties.length }, "projection loop started");
    return runProjectionLoop(db, client, source, {
      signal,
      intervalMs: config.PROJECTION_POLL_INTERVAL_MS,
      pageLimit: config.PROJECTION_PAGE_LIMIT,
      projectionDelaySeconds: config.PROJECTION_DELAY_SECONDS,
      now,
      onPass(result) {
        if (state) {
          state.lastPass = result;
          state.lastPassAt = now().toISOString();
          state.lastError = null;
          state.lastErrorCase = null;
        }
        if (result.status !== lastStatus) {
          if (result.status === "ACTIVE") slog.info({ checkpoint: result.checkpoint, participantId: result.participantId }, "projection source active");
          else if (config.COLLARA_MODE === "DEVNET")
            slog.error({ status: result.status, case: statusCase(result.status), reason: result.resetReason }, "projection source is not active; run node scripts/devnet/recover.mjs (docs/devnet/recovery.md)");
          else slog.error({ status: result.status, reason: result.resetReason }, "projection source is not active; run `pnpm --filter @collara/worker projection:reset` after checking the ledger");
          lastStatus = result.status;
        }
        const changed = result.transactionsApplied > 0 || result.commandsProjected > 0 || result.commandsDelayed > 0;
        (changed ? slog.info.bind(slog) : slog.debug.bind(slog))(
          {
            checkpoint: result.checkpoint,
            ledgerEnd: result.ledgerEnd,
            applied: result.transactionsApplied,
            skipped: result.transactionsSkipped,
            events: result.eventsProjected,
            commandsProjected: result.commandsProjected,
            commandsDelayed: result.commandsDelayed,
            complete: result.complete,
          },
          "projection pass",
        );
      },
      onError(error) {
        const classified = classifyRecoveryError(error);
        if (state) {
          state.lastError = message(error).slice(0, 500);
          state.lastErrorAt = now().toISOString();
          state.lastErrorCase = classified?.case ?? null;
        }
        slog.error({ err: error, ...(classified ? { case: classified.case } : {}) }, classified ? `projection pass failed (${classified.case}); retrying` : "projection pass failed; retrying");
      },
    });
  });

  const reconcile = every(
    "reconcile",
    config.RECONCILE_INTERVAL_MS,
    loops.reconcile,
    log,
    signal,
    async () => {
      const outcomes = await reconcileUnknownOutcomes(db, { completionClient: (user, source) => ledger.completionClient(user, source) }, { now: now(), signal });
      for (const o of outcomes) {
        (o.outcome === "UNKNOWN" ? log.warn.bind(log) : log.info.bind(log))({ command: o.commandId, outcome: o.outcome, note: o.note }, "UNKNOWN_OUTCOME reconciliation");
      }
    },
    now,
  );

  const handler = options.exportHandler ?? JOB_HANDLERS.export;
  const jobContext: JobContext = { db, log: log.child({ loop: "exports" }), workerId: config.WORKER_ID, config, signal, now };
  const exportsLoop = every(
    "exports",
    config.JOB_POLL_INTERVAL_MS,
    loops.exports,
    log,
    signal,
    async () => {
      const summary = await runExportJobsOnce(jobContext, handler);
      if (summary.processed > 0) log.info(summary, "export jobs processed");
    },
    now,
  );

  // DEVNET: periodic read-only recovery diagnosis; the primary case is logged when it changes and shown in /healthz.
  const recoveryCheck = ledger.recoveryCheck;
  let lastCase: string | null = null;
  const recoveryLoop = recoveryCheck
    ? every(
        "recovery",
        config.DEVNET_RECOVERY_CHECK_INTERVAL_MS,
        { runs: 0, lastRunAt: null, lastError: null, lastErrorAt: null },
        log,
        signal,
        async () => {
          let diagnosis: DevnetDiagnosis;
          try {
            diagnosis = await recoveryCheck();
            recovery.diagnosis = diagnosis;
            recovery.error = null;
          } catch (error) {
            recovery.error = message(error).slice(0, 300);
            throw error;
          } finally {
            recovery.checkedAt = now().toISOString();
          }
          const primary = diagnosis.primary;
          if (primary !== lastCase) {
            const failing = diagnosis.findings.find((f) => f.case === primary);
            if (primary === "OK") log.info({ case: primary }, "DevNet recovery check: OK");
            else log.error({ case: primary, detail: failing?.detail, next: failing?.next }, "DevNet recovery needed: run node scripts/devnet/recover.mjs (docs/devnet/recovery.md)");
            lastCase = primary;
          }
        },
        now,
      )
    : Promise.resolve();

  const done = Promise.allSettled([...projection, reconcile, exportsLoop, recoveryLoop]).then(() => undefined);

  async function health(): Promise<HealthDetails> {
    const at = now();
    const rows = await ledgerCheckpoints(db);
    const commandCounts = await db
      .select({ status: commands.status, count: sql<number>`count(*)::int` })
      .from(commands)
      .where(inArray(commands.status, ["SUBMITTED", "COMMITTED", "PROJECTION_DELAYED", "UNKNOWN_OUTCOME"]))
      .groupBy(commands.status);
    const jobCounts = await db
      .select({ state: exportJobs.state, count: sql<number>`count(*)::int` })
      .from(exportJobs)
      .where(inArray(exportJobs.state, ["QUEUED", "GENERATING"]))
      .groupBy(exportJobs.state);

    const sourceHealth = ledger.sources.map(({ config: source }) => {
      const row = rows.find((r) => r.source === source.source);
      const state = sources.get(source.source);
      const ledgerEnd = Math.max(state?.lastPass?.ledgerEnd ?? 0, row?.ledgerEndSeen ?? 0) || null;
      const checkpoint = row?.checkpointOffset ?? 0;
      return {
        source: source.source,
        status: row?.status ?? "NOT_STARTED",
        participantId: row?.participantId ?? null,
        ledgerUser: source.ledgerUserId ?? null,
        checkpoint,
        ledgerEnd,
        lag: ledgerEnd === null ? null : Math.max(0, ledgerEnd - checkpoint),
        lastAppliedAt: row?.lastAppliedAt?.toISOString() ?? null,
        checkpointAgeSeconds: row?.lastAppliedAt ? Math.round((at.getTime() - row.lastAppliedAt.getTime()) / 1000) : null,
        lastPolledAt: row?.lastPolledAt?.toISOString() ?? null,
        lastPassAt: state?.lastPassAt ?? null,
        resetDetectedAt: row?.resetDetectedAt?.toISOString() ?? null,
        resetReason: row?.resetReason ?? null,
        historyFloor: row?.historyFloorOffset ?? null,
        // Recovery case (docs/devnet/recovery.md): PRUNED / LEDGER_RESET from the status, else what the last error signals.
        recoveryCase: statusCase(row?.status) ?? state?.lastErrorCase ?? null,
        lastError: state?.lastError ?? row?.lastError ?? null,
        lastErrorAt: state?.lastErrorAt ?? row?.lastErrorAt?.toISOString() ?? null,
      };
    });
    const recoveryCase = recovery.diagnosis?.primary ?? null;
    const degraded =
      sourceHealth.some((s) => s.status !== "ACTIVE" || s.lastError !== null) ||
      !!loops.reconcile.lastError ||
      !!loops.exports.lastError ||
      (recoveryCase !== null && recoveryCase !== "OK") ||
      recovery.error !== null;
    return {
      degraded,
      sources: sourceHealth,
      ...(recoveryCheck
        ? {
            recovery: {
              case: recoveryCase,
              newRunRequired: recovery.diagnosis?.newRunRequired ?? null,
              checkedAt: recovery.checkedAt,
              error: recovery.error,
              findings: (recovery.diagnosis?.findings ?? []).filter((f) => f.status !== "ok").map((f) => ({ case: f.case, status: f.status, title: f.title, detail: f.detail, next: f.next })),
              command: "node scripts/devnet/recover.mjs",
            },
          }
        : {}),
      commands: Object.fromEntries(commandCounts.map((c) => [c.status, c.count])),
      exportJobs: Object.fromEntries(jobCounts.map((j) => [j.state, j.count])),
      loops: { reconcile: { ...loops.reconcile }, exports: { ...loops.exports } },
    };
  }

  return { done, health };
}
