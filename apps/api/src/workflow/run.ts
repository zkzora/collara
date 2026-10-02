// The ledger write path (ADR-0001 §2.6, synthesis §1.5.2), shared by every workflow endpoint and the seed:
//   durable command record (idempotency key, deterministic commandId) → prepare(ctx) reads the ACS as the
//   acting organisation's ledger user and builds the commands → CommandService.submitToLedger (fresh
//   submissionId per attempt) → COMMITTED with updateId/offset | REJECTED | FAILED | UNKNOWN_OUTCOME.
// Replays: a settled record returns its stored status and result without resubmitting; UNKNOWN_OUTCOME
// (or a stale SUBMITTED) resubmits the stored submission with the same commandId, so the ledger
// deduplicates it; FAILED never reached the ledger and is prepared again.
// Multi-step operations (`sequence`) are a parent record plus one child record per step, linked by the
// parent id (child key "<parentId>:<step>", child operation "<operation>/<step>").
import { randomUUID } from "node:crypto";
import { isLedgerError, type LedgerCommand, type LedgerTransaction } from "@collara/canton";
import { commands as commandsTable, type CommandRow, type Db } from "@collara/db";
import { COMMAND_COPY, type CommandState, type CommandStatus } from "@collara/domain";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isProblemError } from "../errors";
import { AcsReader } from "../ledger/acs";
import type { LedgerAccess } from "../ledger/access";
import { templateNameOf } from "../ledger/contracts";
import type { TemplateName } from "../ledger/templates";
import { CommandService, IllegalCommandTransitionError } from "../services/commands";
import type { LedgerGateway, LedgerSubmitOutcome, LedgerSubmitRequest } from "../services/ledger";
import { requireIdentity, type LedgerIdentity, type WorkflowActor } from "./actors";
import { workflowProblems } from "./problems";

// --- Types -------------------------------------------------------------------------------------------

/** What prepare() returns: the commands and which of the actor's identities submits them. */
export interface PlannedSubmission {
  /** "business" (default): the org's business party; "seat": the governance seat (readAs governance). */
  readonly as?: "business" | "seat";
  readonly commands: readonly LedgerCommand[];
  /** Extra readAs parties (rarely needed: the seat identity already reads as the governance party). */
  readonly readAs?: readonly string[];
}

export interface PrepareContext {
  readonly actor: WorkflowActor;
  /** Fresh ACS reads as the actor's business ledger user (parties: the business party). */
  readonly acs: AcsReader;
  /** Fresh ACS reads as the actor's governance-seat user (parties: seat + governance), or null. */
  readonly seatAcs: AcsReader | null;
  /** Collara namespace of this environment. */
  readonly namespace: string;
  /** Wall-clock now (the sandbox's ledger time follows it). Use for relative dates, never constants. */
  readonly now: Date;
  /** Opaque actor reference to record on choices. */
  readonly actorRef: string;
  /** The command record being prepared (id is stable across retries). */
  readonly record: CommandRow;
  readonly access: LedgerAccess;
}

export interface CreatedRef {
  readonly templateRef: string;
  readonly template: TemplateName | null;
  readonly contractId: string;
  /** The create argument (payload) as served; decode with PAYLOAD_SCHEMAS. Not stored on the record. */
  readonly argument: unknown;
}

/** A committed submission: created contracts and the root exercise result, for chaining and refs. */
export interface CommittedStep {
  readonly updateId: string;
  readonly offset: number;
  /** True when the ledger deduplicated a resubmission of an already committed command id. */
  readonly deduplicated: boolean;
  /** The transaction as visible to actAs ∪ readAs (LEDGER_EFFECTS), when the gateway returned it. */
  readonly transaction: LedgerTransaction | null;
  readonly created: readonly CreatedRef[];
  /** Result of the first root exercise (e.g. {"_1": cid, "_2": cid} for tuples), or null. */
  readonly exerciseResult: unknown;
  /** Contract id of the first created contract of a template, or null. */
  createdOf(template: TemplateName): string | null;
}

export interface LedgerWorkflowInput<R> {
  readonly actor: WorkflowActor;
  /** Stable operation name, e.g. "case.share" (part of the idempotency scope). */
  readonly operation: string;
  /** Client Idempotency-Key (or a deterministic seed key). */
  readonly idempotencyKey: string;
  /** The request input; hashed for the idempotency check (same key + different payload → 409). */
  readonly payload: unknown;
  /** Display ref the command acts on (CL-001, VR-001…). */
  readonly resourceRef?: string;
  /** Reads fresh ACS state, validates preconditions (throw a ProblemError) and returns the commands. */
  readonly prepare: (ctx: PrepareContext) => Promise<PlannedSubmission>;
  /** Domain refs from the committed transaction (JSON-serialisable). Stored, and returned on replay. */
  readonly result?: (step: CommittedStep) => R | Promise<R>;
}

export interface WorkflowOutcome<R> {
  /** The domain CommandStatus DTO (state, updateId only when committed, approved copy). */
  readonly command: CommandStatus;
  readonly record: CommandRow;
  /** COMMITTED/PROJECTED/PROJECTION_DELAYED with an update id. */
  readonly committed: boolean;
  /** True when this call returned a stored outcome without submitting anything. */
  readonly replayed: boolean;
  /** result() of the committed step (stored on the record), or null. */
  readonly result: R | null;
  /** The committed step when it committed in this call (null on replay). */
  readonly step: CommittedStep | null;
}

/** Stored on commands.result: the exact submission (for same-commandId resubmission) and the outcome. */
const StoredResultSchema = z.object({
  submission: z
    .object({
      ledgerUserId: z.string(),
      source: z.string(),
      actAs: z.array(z.string()),
      readAs: z.array(z.string()),
      commands: z.array(z.unknown()),
    })
    .optional(),
  outcome: z
    .object({
      updateId: z.string(),
      offset: z.number(),
      created: z.array(z.object({ templateRef: z.string(), contractId: z.string() })),
    })
    .optional(),
  steps: z.array(z.object({ step: z.string(), commandId: z.string(), state: z.string(), updateId: z.string().nullable() })).optional(),
  refs: z.unknown().optional(),
});
type StoredResult = z.infer<typeof StoredResultSchema>;
type StoredSubmission = NonNullable<StoredResult["submission"]>;

const SETTLED: readonly CommandState[] = ["COMMITTED", "PROJECTED", "PROJECTION_DELAYED", "REJECTED"];
const COMMITTED_STATES: readonly CommandState[] = ["COMMITTED", "PROJECTED", "PROJECTION_DELAYED"];

export interface WorkflowRunnerOptions {
  readonly db: Db;
  readonly gateway: LedgerGateway;
  /** null in UI_MOCK or without a bootstrap state: every run is recorded as FAILED (never simulated). */
  readonly access: LedgerAccess | null;
  readonly clock?: () => Date;
  /** A SUBMITTED record older than this is treated as UNKNOWN_OUTCOME and resubmitted (default 150 s). */
  readonly staleSubmittedMs?: number;
}

// --- Runner ------------------------------------------------------------------------------------------

export class WorkflowRunner {
  readonly db: Db;
  readonly access: LedgerAccess | null;
  readonly commands: CommandService;
  readonly #gateway: LedgerGateway;
  readonly #clock: () => Date;
  readonly #staleMs: number;

  constructor(options: WorkflowRunnerOptions) {
    this.db = options.db;
    this.access = options.access;
    this.#gateway = options.gateway;
    this.#clock = options.clock ?? (() => new Date());
    this.#staleMs = options.staleSubmittedMs ?? 150_000;
    this.commands = new CommandService(options.db, options.gateway, this.#clock);
  }

  get namespace(): string | null {
    return this.access?.namespace ?? null;
  }

  /** One ledger submission under one command record. */
  async run<R>(input: LedgerWorkflowInput<R>): Promise<WorkflowOutcome<R>> {
    const { record } = await this.commands.createOrGetCommand({
      actor: { userId: input.actor.userId, orgId: input.actor.orgId },
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? null,
      target: "LEDGER",
      ...(input.resourceRef ? { resourceRef: input.resourceRef } : {}),
    });
    return this.execute(record, input);
  }

  /**
   * A multi-step operation (e.g. registration = owner request + registrar reserve + registrar accept).
   * The parent record mirrors the overall outcome: COMMITTED with the last step's update id when every
   * step committed, otherwise the state of the first step that did not commit.
   */
  async sequence<R>(input: {
    readonly actor: WorkflowActor;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly payload: unknown;
    readonly resourceRef?: string;
    readonly steps: (seq: WorkflowSequence) => Promise<R>;
  }): Promise<WorkflowOutcome<R>> {
    let { record: parent } = await this.commands.createOrGetCommand({
      actor: { userId: input.actor.userId, orgId: input.actor.orgId },
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? null,
      target: "LEDGER",
      ...(input.resourceRef ? { resourceRef: input.resourceRef } : {}),
    });
    const state = parent.status as CommandState;
    if (SETTLED.includes(state) || (state === "SUBMITTED" && !this.#isStale(parent))) return this.#replayed<R>(parent);
    if (!this.access) return this.#unavailable<R>(parent);

    const seq = new WorkflowSequence(this, parent, input.actor, input.resourceRef);
    try {
      const refs = await input.steps(seq);
      parent = await seq.markSubmitted();
      const last = seq.lastCommitted();
      if (!last) throw new Error(`sequence ${input.operation} committed no step`);
      parent = await this.commands.transition(parent.id, "COMMITTED", { updateId: last.updateId, completionOffset: last.offset });
      parent = await this.#storeResult(parent, { steps: seq.summary(), refs: refs ?? null });
      return { command: this.commands.toStatus(parent), record: parent, committed: true, replayed: false, result: refs, step: null };
    } catch (error) {
      if (error instanceof StepNotCommittedError) {
        parent = await seq.markSubmitted();
        const child = error.outcome.record;
        const childState = child.status as CommandState;
        const patch = { error: { kind: child.errorKind ?? "STEP", ...(child.errorCode ? { code: child.errorCode } : {}), message: child.errorMessage ?? `step ${error.step} did not commit` } };
        if (childState === "REJECTED" || childState === "FAILED" || childState === "UNKNOWN_OUTCOME") {
          parent = await this.commands.transition(parent.id, childState, patch);
        }
        parent = await this.#storeResult(parent, { steps: seq.summary() });
        return { command: this.commands.toStatus(parent), record: parent, committed: false, replayed: false, result: null, step: null };
      }
      if (isProblemError(error) && seq.anyCommitted()) {
        // A precondition failed after earlier steps committed: record the partial outcome, then report it.
        parent = await seq.markSubmitted();
        parent = await this.commands.transition(parent.id, "REJECTED", { error: { kind: "PRECONDITION", message: error.message } });
        await this.#storeResult(parent, { steps: seq.summary() });
      }
      throw error;
    }
  }

  /** Executes (or replays) one LEDGER command record. Used by run() and by sequence steps. */
  async execute<R>(record: CommandRow, input: Pick<LedgerWorkflowInput<R>, "actor" | "prepare" | "result">, hooks: { beforeSubmit?: () => Promise<unknown> } = {}): Promise<WorkflowOutcome<R>> {
    let current = record;
    let state = current.status as CommandState;
    if (SETTLED.includes(state)) return this.#replayed<R>(current);
    if (state === "SUBMITTED") {
      if (!this.#isStale(current)) return this.#replayed<R>(current);
      current = await this.commands.transition(current.id, "UNKNOWN_OUTCOME", {
        error: { kind: "STALE_SUBMISSION", message: "no outcome was recorded for the previous attempt" },
      });
      state = "UNKNOWN_OUTCOME";
    }
    const access = this.access;
    if (!access) return this.#unavailable<R>(current);

    const stored = parseStored(current.result);
    let submission: StoredSubmission;
    if (state === "UNKNOWN_OUTCOME" && stored.submission) {
      // Same commandId, same submission: the ledger deduplicates it if the original committed.
      submission = stored.submission;
    } else {
      const ctx = this.#context(access, input.actor, current);
      const plan = await prepareOrUnavailable(() => input.prepare(ctx));
      if (plan.commands.length === 0) throw new Error("prepare() returned no commands");
      const identity = requireIdentity(input.actor, plan.as ?? "business");
      submission = {
        ledgerUserId: identity.ledgerUserId,
        source: identity.source,
        actAs: [identity.party],
        readAs: [...new Set([...identity.readAs, ...(plan.readAs ?? [])])],
        commands: [...plan.commands],
      };
      current = await this.#storeResult(current, { submission });
    }

    await hooks.beforeSubmit?.();
    let captured: LedgerSubmitOutcome | undefined;
    const capturing: LedgerGateway = {
      submit: async (command, request) => {
        captured = await this.#gateway.submit(command, request);
        return captured;
      },
    };
    const service = new CommandService(this.db, capturing, this.#clock);
    const request: Omit<LedgerSubmitRequest, "commandId" | "submissionId"> = {
      ledgerUserId: submission.ledgerUserId,
      source: submission.source,
      actAs: submission.actAs,
      readAs: submission.readAs,
      commands: submission.commands as LedgerCommand[],
    };
    try {
      current = await service.submitToLedger(current, request);
    } catch (error) {
      // A concurrent request with the same key moved the record first: report its state instead.
      if (!(error instanceof IllegalCommandTransitionError)) throw error;
      const fresh = await this.commands.get(current.id);
      if (!fresh) throw error;
      return this.#replayed<R>(fresh);
    }

    const committed = COMMITTED_STATES.includes(current.status as CommandState) && !!current.updateId;
    if (!committed) {
      return { command: this.commands.toStatus(current), record: current, committed: false, replayed: false, result: null, step: null };
    }
    const step = committedStep(current, captured);
    const refs = input.result ? await input.result(step) : null;
    current = await this.#storeResult(current, {
      outcome: { updateId: step.updateId, offset: step.offset, created: step.created.map(({ templateRef, contractId }) => ({ templateRef, contractId })) },
      refs: refs ?? null,
    });
    return { command: this.commands.toStatus(current), record: current, committed: true, replayed: false, result: refs, step };
  }

  /** ACS reader for one of an actor's identities (fresh ledger reads, not projections). */
  acsFor(identity: LedgerIdentity): AcsReader {
    if (!this.access) throw workflowProblems.ledgerUnavailable();
    return new AcsReader(this.access.client(identity.ledgerUserId, identity.source), [identity.party, ...identity.readAs]);
  }

  #context(access: LedgerAccess, actor: WorkflowActor, record: CommandRow): PrepareContext {
    const business = actor.business;
    return {
      actor,
      get acs(): AcsReader {
        if (!business) throw workflowProblems.ledgerUnavailable();
        return new AcsReader(access.client(business.ledgerUserId, business.source), [business.party]);
      },
      seatAcs: actor.seat ? new AcsReader(access.client(actor.seat.ledgerUserId, actor.seat.source), [actor.seat.party, ...actor.seat.readAs]) : null,
      namespace: access.namespace,
      now: this.#clock(),
      actorRef: actor.actorRef,
      record,
      access,
    };
  }

  #isStale(record: CommandRow): boolean {
    return this.#clock().getTime() - record.updatedAt.getTime() > this.#staleMs;
  }

  #replayed<R>(record: CommandRow): WorkflowOutcome<R> {
    const stored = parseStored(record.result);
    const committed = COMMITTED_STATES.includes(record.status as CommandState) && !!record.updateId;
    return {
      command: this.commands.toStatus(record),
      record,
      committed,
      replayed: true,
      result: committed && stored.refs !== undefined ? (stored.refs as R) : null,
      step: null,
    };
  }

  async #unavailable<R>(record: CommandRow): Promise<WorkflowOutcome<R>> {
    // No ledger connection (UI_MOCK, or LOCALNET without a bootstrap state): recorded as FAILED, never
    // simulated. An UNKNOWN_OUTCOME stays unknown until a ledger can settle it.
    let current = record;
    if (current.status === "PREPARED") {
      current = await this.commands.transition(current.id, "FAILED", { error: { kind: "UNAVAILABLE", message: COMMAND_COPY.LEDGER_UNAVAILABLE } });
    }
    return { command: this.commands.toStatus(current), record: current, committed: false, replayed: false, result: null, step: null };
  }

  async #storeResult(record: CommandRow, patch: Partial<StoredResult>): Promise<CommandRow> {
    const merged = { ...parseStored(record.result), ...patch };
    const [row] = await this.db.update(commandsTable).set({ result: merged, updatedAt: this.#clock() }).where(eq(commandsTable.id, record.id)).returning();
    return row ?? record;
  }
}

/** Thrown inside a sequence when a step did not commit; the sequence turns it into the parent outcome. */
export class StepNotCommittedError extends Error {
  constructor(
    readonly step: string,
    readonly outcome: WorkflowOutcome<unknown>,
  ) {
    super(`step ${step} did not commit (${outcome.record.status})`);
    this.name = "StepNotCommittedError";
  }
}

export interface SequenceStep<S> extends Omit<LedgerWorkflowInput<S>, "operation" | "idempotencyKey" | "payload" | "actor"> {
  /** Defaults to the sequence's actor (e.g. pass the registrar service actor for registrar steps). */
  readonly actor?: WorkflowActor;
  /** Stable step input (hashed into the child record). */
  readonly payload?: unknown;
}

/** Steps of one sequence. Each step is its own command record, keyed by the parent id and the step name. */
export class WorkflowSequence {
  readonly parent: CommandRow;
  readonly #runner: WorkflowRunner;
  readonly #actor: WorkflowActor;
  readonly #resourceRef: string | undefined;
  readonly #steps: { step: string; outcome: WorkflowOutcome<unknown> }[] = [];
  #current: CommandRow;

  constructor(runner: WorkflowRunner, parent: CommandRow, actor: WorkflowActor, resourceRef: string | undefined) {
    this.#runner = runner;
    this.parent = parent;
    this.#current = parent;
    this.#actor = actor;
    this.#resourceRef = resourceRef;
  }

  /** Runs (or replays) a step; returns its stored/computed result, or throws StepNotCommittedError. */
  async step<S>(name: string, spec: SequenceStep<S>): Promise<S> {
    const outcome = await this.attempt(name, spec);
    if (!outcome.committed) throw new StepNotCommittedError(name, outcome);
    return outcome.result as S;
  }

  /** Like step(), but returns the outcome when the step does not commit (to branch on a rejection). */
  async attempt<S>(name: string, spec: SequenceStep<S>): Promise<WorkflowOutcome<S>> {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`invalid step name ${name}`);
    const actor = spec.actor ?? this.#actor;
    const { record } = await this.#runner.commands.createOrGetCommand({
      actor: { userId: actor.userId, orgId: actor.orgId },
      operation: `${this.parent.operation}/${name}`,
      idempotencyKey: `${this.parent.id}:${name}`,
      payload: { parentCommandId: this.parent.id, step: name, input: spec.payload ?? null },
      target: "LEDGER",
      ...(this.#resourceRef ? { resourceRef: this.#resourceRef } : {}),
    });
    const outcome = await this.#runner.execute(record, { actor, prepare: spec.prepare, ...(spec.result ? { result: spec.result } : {}) }, { beforeSubmit: () => this.markSubmitted() });
    this.#steps.push({ step: name, outcome });
    return outcome;
  }

  /** Moves the parent to SUBMITTED once (before the first submission of this run). */
  async markSubmitted(): Promise<CommandRow> {
    const state = this.#current.status as CommandState;
    if (state === "PREPARED" || state === "FAILED" || state === "UNKNOWN_OUTCOME") {
      this.#current = await this.#runner.commands.transition(this.#current.id, "SUBMITTED", { submissionId: randomUUID(), incrementAttempts: true });
    }
    return this.#current;
  }

  anyCommitted(): boolean {
    return this.#steps.some((s) => s.outcome.committed);
  }

  lastCommitted(): { updateId: string; offset: number } | null {
    const last = [...this.#steps].reverse().find((s) => s.outcome.committed && s.outcome.record.updateId);
    return last?.outcome.record.updateId ? { updateId: last.outcome.record.updateId, offset: last.outcome.record.completionOffset ?? 0 } : null;
  }

  summary(): { step: string; commandId: string; state: string; updateId: string | null }[] {
    return this.#steps.map(({ step, outcome }) => ({ step, commandId: outcome.record.id, state: outcome.record.status, updateId: outcome.record.updateId }));
  }
}

// --- helpers -----------------------------------------------------------------------------------------

/** ACS reads that fail for infrastructure reasons are a 503 (nothing was submitted), not a 500. */
async function prepareOrUnavailable<T>(prepare: () => Promise<T>): Promise<T> {
  try {
    return await prepare();
  } catch (error) {
    if (isLedgerError(error) && (error.info.commandState === "FAILED" || error.info.commandState === "UNKNOWN_OUTCOME")) {
      throw workflowProblems.ledgerUnavailable();
    }
    throw error;
  }
}

function parseStored(value: unknown): StoredResult {
  const parsed = StoredResultSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function committedStep(record: CommandRow, outcome: LedgerSubmitOutcome | undefined): CommittedStep {
  const transaction = outcome?.kind === "committed" ? (outcome.transaction ?? null) : null;
  const created: CreatedRef[] = [];
  let exerciseResult: unknown = null;
  if (transaction) {
    const roots = rootNodes(transaction);
    const firstExercise = transaction.events.find((e) => e.kind === "exercised" && roots.has(e.nodeId));
    if (firstExercise?.kind === "exercised") exerciseResult = firstExercise.exerciseResult;
    for (const event of transaction.events) {
      if (event.kind === "created") {
        created.push({ templateRef: event.templateRef, template: templateNameOf(event.templateRef) ?? null, contractId: event.contractId, argument: event.createArgument });
      }
    }
  }
  return {
    updateId: record.updateId ?? "",
    offset: record.completionOffset ?? 0,
    deduplicated: outcome?.kind === "committed" ? (outcome.deduplicated ?? false) : false,
    transaction,
    created,
    exerciseResult,
    createdOf: (template) => created.find((c) => c.template === template)?.contractId ?? null,
  };
}

/** Node ids that are not inside another exercised node's subtree. */
function rootNodes(transaction: LedgerTransaction): Set<number> {
  const covered = new Set<number>();
  for (const event of transaction.events) {
    if (event.kind === "exercised") for (let n = event.nodeId + 1; n <= event.lastDescendantNodeId; n++) covered.add(n);
  }
  return new Set(transaction.events.map((e) => e.nodeId).filter((n) => !covered.has(n)));
}

/** Decodes a Daml tuple exercise result ({"_1": a, "_2": b, …}) into an array. */
export function tupleResult(value: unknown, size: number): string[] {
  const record = (value ?? {}) as Record<string, unknown>;
  return Array.from({ length: size }, (_, i) => {
    const item = record[`_${i + 1}`];
    if (typeof item !== "string") throw new Error(`exercise result has no contract id at _${i + 1}`);
    return item;
  });
}
