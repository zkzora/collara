// Route-side helpers shared by the financing route modules (reviews, proposals, pledges, release, audit, reports).
import { z } from "zod";
import type { WorkflowRouteOptions } from "../../routes/workflow/types";
import type { WorkflowOutcome } from "../run";
import type { FinanceDeps } from "./common";

export function financeDeps(opts: WorkflowRouteOptions): FinanceDeps {
  return { db: opts.services.db.db, workflow: opts.workflow, mode: opts.mode, clock: opts.services.clock };
}

/**
 * Path ids are opaque here: any unknown, malformed-but-short or unauthorized id gets the same 404-shaped
 * `unavailable` body (no existence leak through a different validation error).
 */
export const RefParams = z.object({ id: z.string().trim().min(1).max(80) });

/** Mutations whose clients send `{}` (or nothing meaningful): unknown fields are stripped, never used. */
export const EmptyBody = z.object({}).optional();

/** The same outcome with its result replaced (e.g. a presented DTO instead of the stored refs). */
export function withResult<R, T>(outcome: WorkflowOutcome<R>, result: T | null): WorkflowOutcome<T> {
  return { ...outcome, result };
}

/** `{ command }` only (CommandResponse endpoints). */
export function commandOnly<R>(outcome: WorkflowOutcome<R>): WorkflowOutcome<never> {
  return { ...outcome, result: null };
}

