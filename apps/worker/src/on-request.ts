// "On-request" sync (WORKER_MODE=on-request; docs/devnet/deploy-free.md): for hosts without a persistent process
// (Vercel Hobby). NOT a persistent worker: the ledger projection, UNKNOWN_OUTCOME reconciliation and export jobs
// advance only while someone uses the app. Each pass is bounded by a time budget and single-flight:
//   - in-process: concurrent callers share the running pass;
//   - across instances: a transaction-scoped advisory lock (pg_try_advisory_xact_lock), which works through a
//     transaction-mode pooler (Supabase/PgBouncer), unlike session-level locks. The projection runs inside that
//     transaction; per-update transactions become savepoints, and work done before the budget ran out is committed.
// Export jobs run after the lock is released, under their own lease (SELECT … FOR UPDATE SKIP LOCKED).
import { ledgerSources, projectOnce, reconcileUnknownOutcomes, type Db, type ProjectOnceResult } from "@collara/db";
import { inArray, sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { WorkerConfig } from "./config";
import { JOB_HANDLERS, runExportJobsOnce, type ExportJobHandler } from "./jobs/registry";
import type { WorkerLedger } from "./ledger";

/** Advisory lock key of the on-request projection (any constant; hashtext keeps it readable). */
export const ON_REQUEST_LOCK_NAME = "collara:on-request-sync";

export interface OnRequestSyncOptions {
  readonly db: Db;
  readonly ledger: Pick<WorkerLedger, "sources" | "completionClient">;
  readonly config: WorkerConfig;
  readonly log: Logger;
  /** Wall-clock budget of one pass (projection + reconciliation + exports). */
  readonly budgetMs: number;
  /** A pass is skipped when every source was polled less than this long ago (any instance). */
  readonly minIntervalMs: number;
  readonly now?: () => Date;
  readonly exportHandler?: ExportJobHandler;
  /** Tests: replaces the advisory lock (must be transaction-scoped). */
  readonly tryLock?: (tx: Db) => Promise<boolean>;
}

export type OnRequestSyncStatus = "RAN" | "SKIPPED_FRESH" | "SKIPPED_LOCKED" | "FAILED";

export interface OnRequestSyncResult {
  readonly status: OnRequestSyncStatus;
  /** True when the budget ran out before the projection reached the ledger end. */
  readonly partial: boolean;
  readonly sources: readonly ProjectOnceResult[];
  readonly exportsProcessed: number;
  readonly durationMs: number;
  readonly error?: string;
}

export interface OnRequestSync {
  /** Runs (or joins) one bounded pass. Never throws; failures are logged and returned as FAILED. */
  sync(options?: { readonly force?: boolean }): Promise<OnRequestSyncResult>;
}

async function advisoryXactLock(tx: Db): Promise<boolean> {
  const result = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${ON_REQUEST_LOCK_NAME})) as locked`);
  const rows = (result as unknown as { rows?: { locked: boolean }[] }).rows ?? (result as unknown as { locked: boolean }[]);
  return rows[0]?.locked === true;
}

const isAbort = (error: unknown, signal: AbortSignal) =>
  signal.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));

export function createOnRequestSync(options: OnRequestSyncOptions): OnRequestSync {
  const { db, ledger, config, log } = options;
  const now = options.now ?? (() => new Date());
  const tryLock = options.tryLock ?? advisoryXactLock;
  const handler = options.exportHandler ?? JOB_HANDLERS.export;
  let inflight: Promise<OnRequestSyncResult> | null = null;

  async function fresh(): Promise<boolean> {
    const names = ledger.sources.map((s) => s.config.source);
    if (names.length === 0) return true;
    const rows = await db.select({ source: ledgerSources.source, lastPolledAt: ledgerSources.lastPolledAt }).from(ledgerSources).where(inArray(ledgerSources.source, names));
    const cutoff = now().getTime() - options.minIntervalMs;
    return names.every((name) => {
      const polled = rows.find((r) => r.source === name)?.lastPolledAt;
      return !!polled && polled.getTime() > cutoff;
    });
  }

  async function pass(force: boolean): Promise<OnRequestSyncResult> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("on-request sync budget exhausted", "TimeoutError")), options.budgetMs);
    const signal = controller.signal;
    const sources: ProjectOnceResult[] = [];
    let partial = false;
    try {
      if (!force && (await fresh())) return { status: "SKIPPED_FRESH", partial: false, sources, exportsProcessed: 0, durationMs: elapsed() };
      const locked = await db.transaction(async (tx) => {
        // Drizzle's transaction handle has the database's query surface; nested transactions become savepoints.
        const scoped = tx as unknown as Db;
        if (!(await tryLock(scoped))) return false;
        for (const { config: source, client } of ledger.sources) {
          if (signal.aborted) {
            partial = true;
            break;
          }
          try {
            const result = await projectOnce(scoped, client, source, {
              signal,
              pageLimit: config.PROJECTION_PAGE_LIMIT,
              projectionDelaySeconds: config.PROJECTION_DELAY_SECONDS,
              now,
            });
            sources.push(result);
            if (!result.complete && result.status === "ACTIVE") partial = true;
          } catch (error) {
            // Out of budget: keep (commit) what was applied; the next request continues from the checkpoint.
            if (!isAbort(error, signal)) throw error;
            partial = true;
          }
        }
        if (!signal.aborted) {
          try {
            await reconcileUnknownOutcomes(scoped, { completionClient: (user, src) => ledger.completionClient(user, src) }, { now: now(), signal });
          } catch (error) {
            if (!isAbort(error, signal)) throw error;
            partial = true;
          }
        }
        return true;
      });
      if (!locked) return { status: "SKIPPED_LOCKED", partial: false, sources, exportsProcessed: 0, durationMs: elapsed() };
      let exportsProcessed = 0;
      if (!signal.aborted) {
        const summary = await runExportJobsOnce({ db, log: log.child({ loop: "exports" }), workerId: config.WORKER_ID, config, signal, now }, handler, 1);
        exportsProcessed = summary.processed;
      }
      return { status: "RAN", partial: partial || signal.aborted, sources, exportsProcessed, durationMs: elapsed() };
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      log.error({ err: error }, "on-request sync failed");
      return { status: "FAILED", partial, sources, exportsProcessed: 0, durationMs: elapsed(), error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    sync(syncOptions = {}) {
      if (!inflight) {
        inflight = pass(syncOptions.force ?? false).finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}

/**
 * Wiring for the embedded API: worker configuration from the same environment, the ledger connections (DEVNET: the
 * tenant's refresh token from the database, state from COLLARA_DEVNET_STATE or DEVNET_STATE_JSON) and the sync.
 * Returns null (with a warning) while the ledger state is missing, so the API still serves and reports health.
 */
export async function connectOnRequestSync(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly db: Db;
  readonly log: Logger;
  readonly budgetMs: number;
  readonly minIntervalMs: number;
}): Promise<OnRequestSync | null> {
  const { loadConfig } = await import("./config");
  const { connectLedger, LedgerNotBootstrappedError } = await import("./ledger");
  const config = loadConfig(options.env);
  try {
    const ledger = await connectLedger(config, options.db);
    return createOnRequestSync({ db: options.db, ledger, config, log: options.log, budgetMs: options.budgetMs, minIntervalMs: options.minIntervalMs });
  } catch (error) {
    if (!(error instanceof LedgerNotBootstrappedError)) throw error;
    options.log.warn(error.message);
    return null;
  }
}
