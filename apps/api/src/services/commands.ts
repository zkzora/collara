// Durable command records and the command lifecycle (synthesis §1.5.2, ADR-0001 §2.6).
// PREPARED → SUBMITTED → COMMITTED → PROJECTED, plus REJECTED, FAILED (pre-commit infrastructure),
// UNKNOWN_OUTCOME (timeout/5xx: reconcile, never report as failure) and PROJECTION_DELAYED.
import { createHash, randomUUID } from "node:crypto";
import { commands, type CommandRow, type Db } from "@collara/db";
import {
  COMMAND_COPY,
  ERROR_COPY,
  SIMULATED_COPY,
  type Actor,
  type CommandState,
  type CommandStatus,
} from "@collara/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { problems } from "../errors";
import type { LedgerGateway, LedgerSubmitOutcome, LedgerSubmitRequest } from "./ledger";

export type CommandTarget = "LEDGER" | "APPLICATION";

/** Allowed predecessor states for each target state. Anything else is an illegal transition. */
export const COMMAND_TRANSITIONS: Readonly<Record<CommandState, readonly CommandState[]>> = {
  PREPARED: [],
  // A FAILED attempt never reached the ledger and an UNKNOWN_OUTCOME is resubmitted with the same command id.
  SUBMITTED: ["PREPARED", "FAILED", "UNKNOWN_OUTCOME"],
  // APPLICATION commands commit directly from PREPARED; reconciliation can settle an unknown outcome.
  COMMITTED: ["PREPARED", "SUBMITTED", "UNKNOWN_OUTCOME"],
  REJECTED: ["PREPARED", "SUBMITTED", "UNKNOWN_OUTCOME"],
  FAILED: ["PREPARED", "SUBMITTED"],
  UNKNOWN_OUTCOME: ["SUBMITTED"],
  PROJECTION_DELAYED: ["COMMITTED"],
  PROJECTED: ["COMMITTED", "PROJECTION_DELAYED"],
};

const TERMINAL_OR_SETTLED: readonly CommandState[] = ["COMMITTED", "PROJECTED", "PROJECTION_DELAYED", "REJECTED"];

export class IllegalCommandTransitionError extends Error {
  constructor(
    readonly commandId: string,
    readonly from: string,
    readonly to: CommandState,
  ) {
    super(`illegal command transition ${from} → ${to} (${commandId})`);
    this.name = "IllegalCommandTransitionError";
  }
}

/** JSON with object keys sorted recursively, so equal payloads hash equally regardless of key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function payloadHash(operation: string, payload: unknown): string {
  return sha256Hex(canonicalJson({ operation, payload }));
}

/**
 * Deterministic Canton command id. It includes the idempotency key, so two deliberate identical actions
 * (different keys) are distinct commands, while a retry with the same key reuses the id and is
 * deduplicated by the ledger.
 */
export function ledgerCommandId(input: { orgId: string; userId: string; operation: string; idempotencyKey: string; payloadHash: string }): string {
  const digest = sha256Hex([input.orgId, input.userId, input.operation, input.idempotencyKey, input.payloadHash].join("\n"));
  return `collara-${digest.slice(0, 48)}`;
}

const JWT_LIKE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER = /\bBearer\s+\S+/gi;

/** Error text stored on a command: no tokens, bounded length. */
export function redactErrorMessage(message: string): string {
  return message.replace(JWT_LIKE, "[redacted]").replace(BEARER, "Bearer [redacted]").slice(0, 500);
}

/** UI copy for a command state (S §18.2 verbatim; never `Confirmed on the ledger.` without an update id). */
export function commandMessage(record: Pick<CommandRow, "status" | "target" | "updateId" | "errorKind">): string {
  const state = record.status as CommandState;
  if (record.target === "APPLICATION") {
    if (state === "REJECTED" || state === "FAILED") {
      if (record.errorKind === "HASH_MISMATCH") return ERROR_COPY.HASH_MISMATCH;
      if (record.errorKind === "VALIDATION") return ERROR_COPY.VALIDATION;
      return COMMAND_COPY.STATE_CHANGED;
    }
    return SIMULATED_COPY.APPLICATION_RECORD_SAVED;
  }
  switch (state) {
    case "PREPARED":
    case "SUBMITTED":
      return COMMAND_COPY.SUBMITTED;
    case "COMMITTED":
    case "PROJECTED":
      return record.updateId ? COMMAND_COPY.COMMITTED : COMMAND_COPY.SUBMITTED;
    case "PROJECTION_DELAYED":
      return COMMAND_COPY.PROJECTION_DELAYED;
    case "UNKNOWN_OUTCOME":
      return COMMAND_COPY.UNKNOWN_OUTCOME;
    case "FAILED":
      return COMMAND_COPY.LEDGER_UNAVAILABLE;
    case "REJECTED":
      return record.errorKind === "AUTHORIZATION" ? ERROR_COPY.UNAVAILABLE : COMMAND_COPY.STATE_CHANGED;
  }
}

export interface CreateCommandInput {
  readonly actor: Pick<Actor, "userId" | "orgId">;
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly target: CommandTarget;
  readonly resourceRef?: string;
}

export interface TransitionPatch {
  readonly updateId?: string;
  readonly completionOffset?: number;
  readonly submissionId?: string;
  readonly error?: { kind: string; code?: string; message: string };
  readonly result?: unknown;
  readonly resourceRef?: string;
  readonly incrementAttempts?: boolean;
}

export class CommandService {
  constructor(
    private readonly db: Db,
    private readonly gateway: LedgerGateway,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Returns the command for (actor, org, operation, idempotency key), creating it in PREPARED when new.
   * The same key with a different payload is a 409 idempotency conflict.
   */
  async createOrGetCommand(input: CreateCommandInput): Promise<{ record: CommandRow; created: boolean }> {
    const hash = payloadHash(input.operation, input.payload);
    // One clock for every lifecycle timestamp (the database server's clock may differ slightly).
    const now = this.clock();
    const [inserted] = await this.db
      .insert(commands)
      .values({
        createdAt: now,
        updatedAt: now,
        idempotencyKey: input.idempotencyKey,
        actorUserId: input.actor.userId,
        orgId: input.actor.orgId,
        operation: input.operation,
        target: input.target,
        payloadHash: hash,
        payload: sortKeys(input.payload ?? null) as object,
        ledgerCommandId: ledgerCommandId({
          orgId: input.actor.orgId,
          userId: input.actor.userId,
          operation: input.operation,
          idempotencyKey: input.idempotencyKey,
          payloadHash: hash,
        }),
        resourceRef: input.resourceRef ?? null,
      })
      .onConflictDoNothing({ target: [commands.actorUserId, commands.orgId, commands.operation, commands.idempotencyKey] })
      .returning();
    if (inserted) return { record: inserted, created: true };

    const [existing] = await this.db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.actorUserId, input.actor.userId),
          eq(commands.orgId, input.actor.orgId),
          eq(commands.operation, input.operation),
          eq(commands.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("command insert conflicted but no existing row was found");
    if (existing.payloadHash !== hash) throw problems.idempotencyConflict();
    return { record: existing, created: false };
  }

  async get(id: string): Promise<CommandRow | null> {
    const [row] = await this.db.select().from(commands).where(eq(commands.id, id)).limit(1);
    return row ?? null;
  }

  /** Commands are visible only to the actor (and organization) that issued them. */
  async findForActor(id: string, actor: Pick<Actor, "userId" | "orgId">): Promise<CommandRow | null> {
    const [row] = await this.db
      .select()
      .from(commands)
      .where(and(eq(commands.id, id), eq(commands.actorUserId, actor.userId), eq(commands.orgId, actor.orgId)))
      .limit(1);
    return row ?? null;
  }

  /** Atomic, guarded state change: succeeds only from an allowed predecessor state. */
  async transition(id: string, to: CommandState, patch: TransitionPatch = {}): Promise<CommandRow> {
    const now = this.clock();
    const [row] = await this.db
      .update(commands)
      .set({
        status: to,
        updatedAt: now,
        ...(to === "SUBMITTED" ? { submittedAt: now } : {}),
        ...(to === "COMMITTED" ? { committedAt: now } : {}),
        ...(to === "PROJECTED" ? { projectedAt: now } : {}),
        ...(patch.updateId !== undefined ? { updateId: patch.updateId } : {}),
        ...(patch.completionOffset !== undefined ? { completionOffset: patch.completionOffset } : {}),
        ...(patch.submissionId !== undefined ? { submissionId: patch.submissionId } : {}),
        ...(patch.result !== undefined ? { result: patch.result as object } : {}),
        ...(patch.resourceRef !== undefined ? { resourceRef: patch.resourceRef } : {}),
        ...(patch.error
          ? { errorKind: patch.error.kind, errorCode: patch.error.code ?? null, errorMessage: redactErrorMessage(patch.error.message) }
          : {}),
        ...(patch.incrementAttempts ? { attempts: sql`${commands.attempts} + 1` } : {}),
      })
      .where(and(eq(commands.id, id), inArray(commands.status, [...COMMAND_TRANSITIONS[to]])))
      .returning();
    if (row) return row;
    const current = await this.get(id);
    throw new IllegalCommandTransitionError(id, current?.status ?? "missing", to);
  }

  /** Records an application-only command as committed (no ledger transaction; never claims one). */
  async completeApplicationCommand(record: CommandRow, result: unknown, resourceRef?: string): Promise<CommandRow> {
    if (record.status !== "PREPARED") return record;
    return this.transition(record.id, "COMMITTED", { result, ...(resourceRef ? { resourceRef } : {}) });
  }

  /**
   * Submits a LEDGER command through the gateway and records the outcome. Settled commands are returned
   * unchanged (idempotent replay); an in-flight SUBMITTED command is left to reconciliation.
   */
  async submitToLedger(record: CommandRow, request: Omit<LedgerSubmitRequest, "commandId" | "submissionId">): Promise<CommandRow> {
    if (record.target !== "LEDGER") throw new Error(`command ${record.id} is not a ledger command`);
    if (TERMINAL_OR_SETTLED.includes(record.status as CommandState) || record.status === "SUBMITTED") return record;

    const submissionId = randomUUID();
    const submitted = await this.transition(record.id, "SUBMITTED", { submissionId, incrementAttempts: true });
    let outcome: LedgerSubmitOutcome;
    try {
      outcome = await this.gateway.submit(submitted, { ...request, commandId: submitted.ledgerCommandId, submissionId });
    } catch (error) {
      // An exception after the request may have left the process: the outcome is unknown, never "failed".
      outcome = { kind: "unknown", errorKind: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
    }
    switch (outcome.kind) {
      case "committed":
        return this.transition(record.id, "COMMITTED", { updateId: outcome.updateId, completionOffset: outcome.offset });
      case "rejected":
        return this.transition(record.id, "REJECTED", { error: { kind: outcome.errorKind, code: outcome.code, message: outcome.message } });
      case "failed":
        return this.transition(record.id, "FAILED", { error: { kind: outcome.errorKind, code: outcome.code, message: outcome.message } });
      case "unknown":
        return this.transition(record.id, "UNKNOWN_OUTCOME", { error: { kind: outcome.errorKind, code: outcome.code, message: outcome.message } });
    }
  }

  toStatus(record: CommandRow): CommandStatus {
    const state = record.status as CommandState;
    const committed = (state === "COMMITTED" || state === "PROJECTED" || state === "PROJECTION_DELAYED") && record.updateId;
    return {
      commandId: record.id,
      operation: record.operation,
      target: record.target as CommandTarget,
      state,
      simulated: false,
      ...(committed && record.updateId ? { updateId: record.updateId } : {}),
      ...(committed && record.completionOffset !== null ? { completionOffset: record.completionOffset } : {}),
      message: commandMessage(record),
      submittedAt: (record.submittedAt ?? record.createdAt).toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      ...(record.errorKind && (state === "REJECTED" || state === "FAILED" || state === "UNKNOWN_OUTCOME")
        ? { error: { code: record.errorCode ?? record.errorKind, detail: commandMessage(record) } }
        : {}),
    };
  }
}
