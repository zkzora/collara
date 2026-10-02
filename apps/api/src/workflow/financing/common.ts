// Shared plumbing of the financing workflows (review → proposal → activation → pledge → release → audit →
// exports). Every mutation follows the same order:
//   1. resolve the record through the read model (stakeholder-filtered; unknown or unrelated → 404-shaped);
//   2. domain policy + workflow preconditions on the projected facts (the same check the UI_MOCK client and
//      the presenters' allowedActions use) — skipped for an idempotent replay of the caller's own command;
//   3. the workflow runner: prepare() re-reads the ACS as the acting organisation's ledger user and re-checks
//      the authoritative state before building commands (daml-model.md §7); the ledger enforces the rest.
import { allocateRef, commands as commandsTable, loadReadWorld, readViewerOf, type CommandRow, type Db, type ReadWorld } from "@collara/db";
import {
  checkCaseAction,
  verifierActiveLookup,
  type ActionCheck,
  type CaseAction,
  type CaseFacts,
  type PresentContext,
  type RefKind,
} from "@collara/domain";
import { and, eq } from "drizzle-orm";
import type { CollaraMode } from "../../config";
import { problems, type ProblemError } from "../../errors";
import type { ResolvedActor } from "../../plugins/actor";
import type { WorkflowServices } from "../context";

/** What the financing workflows need (built once per route module from WorkflowRouteOptions). */
export interface FinanceDeps {
  readonly db: Db;
  readonly workflow: WorkflowServices;
  readonly mode: CollaraMode;
  readonly clock: () => Date;
}

/** The viewer's read world plus the presentation context derived from it. */
export interface WorldScope {
  readonly world: ReadWorld;
  readonly pctx: PresentContext;
  readonly now: Date;
}

export interface CaseScope extends WorldScope {
  readonly facts: CaseFacts;
}

/** Presentation context for LOCALNET reads: watermark from the checkpoint, verifier status from the viewer's view. */
export function presentContextOf(world: ReadWorld, mode: CollaraMode): PresentContext {
  return {
    now: world.now,
    mode,
    sync: { offset: world.lastSync.offset, at: world.lastSync.at },
    ...(world.governance ? { isVerifierActive: verifierActiveLookup(world.governance) } : {}),
  };
}

/** The member's read world (built only from the server-side authority, never from browser values). */
export async function readWorld(deps: FinanceDeps, member: ResolvedActor): Promise<WorldScope> {
  const now = deps.clock();
  const world = await loadReadWorld(deps.db, readViewerOf(member), { now });
  return { world, pctx: presentContextOf(world, deps.mode), now };
}

/** The first visible case matching `pick`, or the 404-shaped `unavailable` problem (no existence leak). */
export async function findCase(deps: FinanceDeps, member: ResolvedActor, pick: (facts: CaseFacts) => boolean): Promise<CaseScope> {
  const scope = await readWorld(deps, member);
  const facts = scope.world.cases.find(pick);
  if (!facts) throw problems.unavailable();
  return { ...scope, facts };
}

/** ActionCheck → problem: UNAVAILABLE → 404-shaped, FORBIDDEN → 403, CONFLICT → 409 (approved copy). */
export function problemOf(check: Exclude<ActionCheck, { ok: true }>): ProblemError {
  if (check.reason === "UNAVAILABLE") return problems.unavailable();
  if (check.reason === "FORBIDDEN") return problems.forbidden(check.message);
  return problems.stateConflict(check.message);
}

export function guard(check: ActionCheck): void {
  if (!check.ok) throw problemOf(check);
}

/** Domain policy + preconditions for a case action on the projected facts. */
export function guardCase(scope: CaseScope, member: ResolvedActor, action: CaseAction): void {
  guard(checkCaseAction(scope.facts, member, action, scope.now, scope.pctx));
}

/**
 * True when the member already has a command record for (operation, key). Such a request is a replay: the
 * runner returns the stored outcome (or settles an unknown one with the same command id) and the projected
 * preconditions are not evaluated again (they would refuse a replay of a committed activation).
 */
export async function isReplay(db: Db, member: Pick<ResolvedActor, "userId" | "orgId">, operation: string, idempotencyKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: commandsTable.id })
    .from(commandsTable)
    .where(
      and(
        eq(commandsTable.actorUserId, member.userId),
        eq(commandsTable.orgId, member.orgId),
        eq(commandsTable.operation, operation),
        eq(commandsTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return !!row;
}

/** Guard unless the request replays the member's own command (see isReplay). */
export async function guardUnlessReplay(deps: FinanceDeps, scope: CaseScope, member: ResolvedActor, action: CaseAction, operation: string, key: string): Promise<void> {
  if (await isReplay(deps.db, member, operation, key)) return;
  guardCase(scope, member, action);
}

/**
 * A field of the first command of a record's stored submission (e.g. the lockRef chosen in prepare), so a
 * pending (202) response can still name the reference the ledger will commit.
 */
export function submittedField(record: CommandRow, field: string): string | null {
  const result = record.result as { submission?: { commands?: unknown[] } } | null;
  const command = result?.submission?.commands?.[0] as Record<string, { createArguments?: Record<string, unknown>; choiceArgument?: Record<string, unknown> }> | undefined;
  if (!command) return null;
  const body = command.CreateCommand?.createArguments ?? command.ExerciseCommand?.choiceArgument ?? null;
  const value = body?.[field];
  return typeof value === "string" ? value : null;
}

/** Next display reference of a kind, skipping refs already used on the ledger (e.g. fixed seed refs). */
export async function nextRef(db: Db, kind: RefKind, taken: Iterable<string> = []): Promise<string> {
  const used = new Set(taken);
  for (let i = 0; i < 1000; i++) {
    const ref = await allocateRef(db, kind);
    if (!used.has(ref)) return ref;
  }
  throw new Error(`could not allocate a free ${kind} reference`);
}

/** Wall-clock offset in days (relative dates only, never constants). */
export function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/** True when `iso` is at or before `now`. */
export function isPast(iso: string, now: Date): boolean {
  return Date.parse(iso) <= now.getTime();
}
