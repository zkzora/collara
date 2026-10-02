// HTTP helpers for workflow route modules: the Idempotency-Key header, turning a WorkflowOutcome into a
// response (never success without an update id), and the projection watermark (lastSync).
import type { LedgerSourceRow } from "@collara/db";
import {
  COMMAND_COPY,
  CommandStatusSchema,
  ERROR_COPY,
  IdempotencyKeySchema,
  problemFor,
  type ApiProblem,
  type CommandStatus,
} from "@collara/domain";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { ProblemError } from "../errors";
import type { ProjectionReader } from "../services/ledger";
import type { WorkflowOutcome } from "./run";

/** Every mutating endpoint requires `Idempotency-Key` (8–200 chars). Use as `schema.headers`. */
export const IdempotencyHeadersSchema = z.object({ "idempotency-key": IdempotencyKeySchema });

/** `{ command }` (CommandResponse) or `{ command, result }` (CommandResult) for 200 and 202 responses. */
export function workflowResponseSchemas<T extends z.ZodType>(result?: T) {
  const body = result ? z.object({ command: CommandStatusSchema, result }) : z.object({ command: CommandStatusSchema });
  return { 200: body, 202: body } as const;
}

/** A problem+json error that also carries the command status (RFC 9457 extension member `command`). */
export function commandProblem(code: "state_conflict" | "unavailable" | "ledger_unavailable", detail: string, command: CommandStatus): ProblemError {
  const problem: ApiProblem & { command: CommandStatus } = { ...problemFor(code, detail), command };
  return new ProblemError(problem);
}

/**
 * Sends a workflow outcome:
 *   committed (update id present)          → 200 { command, result }
 *   SUBMITTED / UNKNOWN_OUTCOME (pending)  → 202 { command, result? } — the client polls GET /api/commands/:id
 *   REJECTED                               → throws 409 state_conflict (404 unavailable for a ledger
 *                                            authorization rejection) with `command`
 *   FAILED                                 → throws 503 ledger_unavailable with `command`
 * `pendingResult` is returned with 202 when the route already knows its refs (e.g. an allocated ref);
 * committed outcomes return `outcome.result ?? pendingResult`.
 */
export function replyWithOutcome<R>(reply: FastifyReply, outcome: WorkflowOutcome<R>, options: { pendingResult?: R } = {}): { command: CommandStatus; result?: R } {
  const { command } = outcome;
  const result = outcome.result ?? options.pendingResult;
  if (outcome.committed) {
    reply.code(200);
    return result === undefined || result === null ? { command } : { command, result };
  }
  switch (command.state) {
    case "REJECTED":
      if (outcome.record.errorKind === "AUTHORIZATION") throw commandProblem("unavailable", ERROR_COPY.UNAVAILABLE, command);
      throw commandProblem("state_conflict", command.message, command);
    case "FAILED":
      throw commandProblem("ledger_unavailable", COMMAND_COPY.LEDGER_UNAVAILABLE, command);
    default:
      reply.code(202);
      return result === undefined || result === null ? { command } : { command, result };
  }
}

export interface LastSync {
  readonly offset: number | null;
  readonly at: string | null;
}

/**
 * Projection watermark for responses (`lastSync`): the checkpoint of the primary ledger source ("sandbox"
 * first, else the first active source). Offsets of different participants are not comparable.
 */
export function lastSyncOf(sources: readonly LedgerSourceRow[]): LastSync {
  const active = sources.filter((s) => s.status === "ACTIVE");
  const primary = active.find((s) => s.source === "sandbox") ?? active[0];
  if (!primary) return { offset: null, at: null };
  return { offset: primary.lastAppliedAt ? primary.checkpointOffset : null, at: primary.lastAppliedAt?.toISOString() ?? null };
}

export async function lastSync(projections: ProjectionReader): Promise<LastSync> {
  return lastSyncOf(await projections.checkpoints());
}

/**
 * Presents a committed command against the projection watermark: PROJECTED once the checkpoint reached
 * its completion offset, PROJECTION_DELAYED (approved copy) when it has not after `delayMs`. Other states
 * are returned unchanged. Single-source assumption (1-participant sandbox); see lastSyncOf.
 */
export function withProjectionState(command: CommandStatus, sync: LastSync, now: Date, delayMs = 5_000): CommandStatus {
  if (command.state !== "COMMITTED" || command.completionOffset === undefined) return command;
  if (sync.offset !== null && sync.offset >= command.completionOffset) return { ...command, state: "PROJECTED" };
  if (now.getTime() - Date.parse(command.updatedAt) > delayMs) {
    return { ...command, state: "PROJECTION_DELAYED", message: COMMAND_COPY.PROJECTION_DELAYED };
  }
  return command;
}
