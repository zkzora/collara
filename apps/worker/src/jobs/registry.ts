// Durable jobs over PostgreSQL rows (no separate queue, ADR-0001 §2.7). Export jobs move
// QUEUED → GENERATING → READY | FAILED. A worker claims one job at a time with a lease
// (SELECT … FOR UPDATE SKIP LOCKED inside the claiming UPDATE), so two workers never take the same job; a job
// whose lease expired (crashed worker) is claimed again until JOB_MAX_ATTEMPTS, then FAILED.
// Handlers live in ./handlers; the export handler is replaced by the reports builder (same file and export).
import { exportJobs, type Db, type ExportJobRow } from "@collara/db";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { WorkerConfig } from "../config";
import { exportJobHandler } from "./handlers/export";

export interface JobContext {
  readonly db: Db;
  readonly log: Logger;
  readonly workerId: string;
  readonly config: WorkerConfig;
  readonly signal: AbortSignal;
  now(): Date;
}

export type ExportJobOutcome =
  | {
      readonly state: "READY";
      readonly storageKey: string;
      readonly checksumSha256: string;
      readonly sizeBytes: number;
      /** Ledger offset the report is cut at, and the sync watermark per source ({ sandbox: { offset, at } }). */
      readonly cutoffOffset: number | null;
      readonly watermark: Record<string, unknown> | null;
      readonly expiresAt: Date | null;
      readonly generatedAt?: Date;
    }
  | { readonly state: "FAILED"; readonly errorMessage: string };

/** Generates one export. Must not throw for expected failures (return FAILED); a throw is recorded as FAILED. */
export type ExportJobHandler = (job: ExportJobRow, ctx: JobContext) => Promise<ExportJobOutcome>;

export const JOB_HANDLERS = { export: exportJobHandler } as const satisfies Record<string, ExportJobHandler>;

export interface ClaimOptions {
  readonly workerId: string;
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  readonly now: Date;
}

/** Claims the oldest QUEUED job (or one whose lease expired). Returns null when there is nothing to do. */
export async function claimExportJob(db: Db, options: ClaimOptions): Promise<ExportJobRow | null> {
  const { now } = options;
  const claimable = or(eq(exportJobs.state, "QUEUED"), and(eq(exportJobs.state, "GENERATING"), lt(exportJobs.leaseExpiresAt, now)));
  // Jobs that exhausted their attempts under expired leases fail instead of looping forever.
  await db
    .update(exportJobs)
    .set({ state: "FAILED", errorMessage: `Export generation failed after ${options.maxAttempts} attempts`, leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
    .where(and(eq(exportJobs.state, "GENERATING"), lt(exportJobs.leaseExpiresAt, now), sql`${exportJobs.attempts} >= ${options.maxAttempts}`));
  const candidate = db
    .select({ id: exportJobs.id })
    .from(exportJobs)
    .where(claimable)
    .orderBy(asc(exportJobs.requestedAt))
    .limit(1)
    .for("update", { skipLocked: true });
  const [job] = await db
    .update(exportJobs)
    .set({
      state: "GENERATING",
      leaseOwner: options.workerId,
      leaseExpiresAt: new Date(now.getTime() + options.leaseSeconds * 1000),
      attempts: sql`${exportJobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(and(inArray(exportJobs.id, candidate), claimable))
    .returning();
  return job ?? null;
}

/** Records the outcome if this worker still holds the lease. Returns false when the lease was lost. */
export async function finishExportJob(db: Db, job: ExportJobRow, workerId: string, outcome: ExportJobOutcome, now: Date): Promise<boolean> {
  const held = and(eq(exportJobs.id, job.id), eq(exportJobs.state, "GENERATING"), eq(exportJobs.leaseOwner, workerId));
  const rows =
    outcome.state === "READY"
      ? await db
          .update(exportJobs)
          .set({
            state: "READY",
            storageKey: outcome.storageKey,
            checksumSha256: outcome.checksumSha256,
            sizeBytes: outcome.sizeBytes,
            cutoffOffset: outcome.cutoffOffset,
            watermark: outcome.watermark,
            generatedAt: outcome.generatedAt ?? now,
            expiresAt: outcome.expiresAt,
            errorMessage: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: now,
          })
          .where(held)
          .returning({ id: exportJobs.id })
      : await db
          .update(exportJobs)
          .set({ state: "FAILED", errorMessage: outcome.errorMessage.slice(0, 500), leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
          .where(held)
          .returning({ id: exportJobs.id });
  return rows.length > 0;
}

export interface JobPassSummary {
  readonly processed: number;
  readonly ready: number;
  readonly failed: number;
}

/** Claims and runs export jobs until none is left (or `max` were processed). */
export async function runExportJobsOnce(ctx: JobContext, handler: ExportJobHandler = JOB_HANDLERS.export, max = 10): Promise<JobPassSummary> {
  let processed = 0;
  let ready = 0;
  let failed = 0;
  while (processed < max && !ctx.signal.aborted) {
    const job = await claimExportJob(ctx.db, {
      workerId: ctx.workerId,
      leaseSeconds: ctx.config.JOB_LEASE_SECONDS,
      maxAttempts: ctx.config.JOB_MAX_ATTEMPTS,
      now: ctx.now(),
    });
    if (!job) break;
    processed++;
    let outcome: ExportJobOutcome;
    try {
      outcome = await handler(job, ctx);
    } catch (error) {
      ctx.log.error({ err: error, job: job.reportRef }, "export handler threw");
      outcome = { state: "FAILED", errorMessage: "Export generation failed." };
    }
    const recorded = await finishExportJob(ctx.db, job, ctx.workerId, outcome, ctx.now());
    if (!recorded) ctx.log.warn({ job: job.reportRef }, "export job lease lost before completion; outcome discarded");
    else if (outcome.state === "READY") ready++;
    else failed++;
  }
  return { processed, ready, failed };
}
