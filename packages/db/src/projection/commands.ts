// Command lifecycle steps owned by the worker (ADR-0001 §2.6, synthesis §1.5.2):
// - COMMITTED/PROJECTION_DELAYED → PROJECTED once the command's update id has been applied (ledger_updates);
// - COMMITTED → PROJECTION_DELAYED when it stays unprojected for longer than the configured delay;
// - UNKNOWN_OUTCOME → COMMITTED | REJECTED from the submitting user's command completions. When neither can be
//   determined the command stays UNKNOWN_OUTCOME and the attempt is recorded (reconcile_attempts, note).
// Every transition is a guarded UPDATE (… WHERE status = <expected>), so a concurrent API resubmission wins.
import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { commands, ledgerUpdates, ledgerUsers, type CommandRow } from "../schema";
import type { CompletionLedgerClient, ProjectionCommandCompletion } from "./types";

export interface AdvanceOptions {
  readonly now?: Date;
  /** COMMITTED older than this without projection becomes PROJECTION_DELAYED (default 5). */
  readonly delaySeconds?: number;
}

export interface AdvanceSummary {
  readonly projected: number;
  readonly delayed: number;
}

export async function advanceCommandStatuses(db: Db, options: AdvanceOptions = {}): Promise<AdvanceSummary> {
  const now = options.now ?? new Date();
  const delaySeconds = options.delaySeconds ?? 5;
  const projected = await db
    .update(commands)
    .set({ status: "PROJECTED", projectedAt: now, updatedAt: now })
    .where(
      and(
        eq(commands.target, "LEDGER"),
        inArray(commands.status, ["COMMITTED", "PROJECTION_DELAYED"]),
        isNotNull(commands.updateId),
        sql`exists (select 1 from ${ledgerUpdates} where ${ledgerUpdates.updateId} = ${commands.updateId})`,
      ),
    )
    .returning({ id: commands.id });
  const cutoff = new Date(now.getTime() - delaySeconds * 1000);
  const delayed = await db
    .update(commands)
    .set({ status: "PROJECTION_DELAYED", updatedAt: now })
    .where(
      and(
        eq(commands.target, "LEDGER"),
        eq(commands.status, "COMMITTED"),
        lt(sql`coalesce(${commands.committedAt}, ${commands.updatedAt})`, cutoff),
      ),
    )
    .returning({ id: commands.id });
  return { projected: projected.length, delayed: delayed.length };
}

// --- UNKNOWN_OUTCOME reconciliation --------------------------------------------------------------------

export interface ReconcileDeps {
  /** A completions client authenticated as `ledgerUserId` (null when the worker cannot act for that user). */
  completionClient(ledgerUserId: string, source: string | null): CompletionLedgerClient | null;
}

export interface ReconcileOptions {
  readonly now?: Date;
  /** Commands examined per pass (oldest first). Default 20. */
  readonly limit?: number;
  /** Leave very recent unknown outcomes to the API's own resubmission first. Default 2 s. */
  readonly minAgeSeconds?: number;
  /** Completions read per call. Default 200. */
  readonly pageLimit?: number;
  readonly signal?: AbortSignal;
}

export interface ReconcileOutcome {
  readonly commandId: string;
  readonly outcome: "COMMITTED" | "REJECTED" | "UNKNOWN";
  readonly note: string;
}

const MAX_NOTE = 500;

interface Candidate {
  readonly userId: string;
  readonly actAs: readonly string[];
  readonly source: string | null;
}

async function candidatesFor(db: Db, row: CommandRow): Promise<Candidate[]> {
  if (row.ledgerUserId && row.actAs && row.actAs.length > 0) {
    return [{ userId: row.ledgerUserId, actAs: row.actAs, source: row.ledgerSource }];
  }
  // Fallback for gateways that did not record the submission context: every org ledger user of the command's
  // organization (business user and governance seat user).
  const users = await db
    .select()
    .from(ledgerUsers)
    .where(and(eq(ledgerUsers.orgId, row.orgId), eq(ledgerUsers.role, "org")))
    .orderBy(asc(ledgerUsers.ledgerUserId));
  return users
    .filter((u) => (row.ledgerUserId ? u.ledgerUserId === row.ledgerUserId : true) && u.actAs.length > 0)
    .map((u) => ({ userId: u.ledgerUserId, actAs: u.actAs, source: row.ledgerSource ?? u.source }));
}

/** Scans one user's completions after `beginExclusive` for the command id. */
async function findCompletions(
  client: CompletionLedgerClient,
  commandId: string,
  parties: readonly string[],
  beginExclusive: number,
  options: ReconcileOptions,
): Promise<ProjectionCommandCompletion[]> {
  const end = await client.ledgerEnd({ signal: options.signal });
  const matches: ProjectionCommandCompletion[] = [];
  let begin = beginExclusive;
  for (let pages = 0; begin < end && pages < 1000; pages++) {
    const page = await client.commandCompletions(
      { parties: [...parties], beginExclusive: begin, limit: options.pageLimit ?? 200, idleTimeoutMs: 500 },
      { signal: options.signal },
    );
    matches.push(...page.completions.filter((c) => c.commandId === commandId));
    const last = Math.max(begin, page.checkpointOffset ?? 0, ...page.completions.map((c) => c.offset));
    if (last <= begin) break;
    begin = last;
  }
  return matches;
}

export async function reconcileUnknownOutcomes(db: Db, deps: ReconcileDeps, options: ReconcileOptions = {}): Promise<ReconcileOutcome[]> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.minAgeSeconds ?? 2) * 1000);
  const rows = await db
    .select()
    .from(commands)
    .where(and(eq(commands.target, "LEDGER"), eq(commands.status, "UNKNOWN_OUTCOME"), lt(commands.updatedAt, cutoff)))
    .orderBy(asc(commands.updatedAt))
    .limit(options.limit ?? 20);

  const outcomes: ReconcileOutcome[] = [];
  for (const row of rows) {
    if (options.signal?.aborted) break;
    let found: ProjectionCommandCompletion | null = null;
    let rejected: ProjectionCommandCompletion | null = null;
    const notes: string[] = [];
    const candidates = await candidatesFor(db, row);
    if (candidates.length === 0) notes.push("no ledger user known for this command");
    for (const candidate of candidates) {
      const client = deps.completionClient(candidate.userId, candidate.source);
      if (!client) {
        notes.push(`no completions client for ${candidate.userId}`);
        continue;
      }
      try {
        const matches = await findCompletions(client, row.ledgerCommandId, candidate.actAs, row.ledgerEndAtSubmit ?? 0, options);
        found = matches.find((c) => c.status.code === 0 && c.updateId) ?? null;
        // gRPC 6 (ALREADY_EXISTS) is a deduplication of an earlier accepted submission, not a rejection.
        rejected = matches.find((c) => c.status.code !== 0 && c.status.code !== 6) ?? null;
        if (found || rejected) break;
        notes.push(matches.length > 0 ? `only deduplication completions for ${candidate.userId}` : `no completion for ${candidate.userId}`);
      } catch (error) {
        notes.push(`completions of ${candidate.userId} unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const base = {
      reconcileAttempts: sql`${commands.reconcileAttempts} + 1`,
      lastReconcileAt: now,
      updatedAt: now,
    };
    const guard = and(eq(commands.id, row.id), eq(commands.status, "UNKNOWN_OUTCOME"));
    if (found) {
      const note = `completion found at offset ${found.offset}`;
      await db
        .update(commands)
        .set({
          ...base,
          status: "COMMITTED",
          committedAt: now,
          updateId: found.updateId,
          completionOffset: found.offset,
          reconcileNote: note,
        })
        .where(guard);
      outcomes.push({ commandId: row.id, outcome: "COMMITTED", note });
    } else if (rejected) {
      const note = `rejected (gRPC ${rejected.status.code}) at offset ${rejected.offset}`;
      await db
        .update(commands)
        .set({
          ...base,
          status: "REJECTED",
          errorKind: "COMPLETION_REJECTED",
          errorCode: `GRPC_${rejected.status.code}`,
          errorMessage: rejected.status.message.slice(0, MAX_NOTE),
          reconcileNote: note,
        })
        .where(guard);
      outcomes.push({ commandId: row.id, outcome: "REJECTED", note });
    } else {
      // Interpretation failures emit no completion, so "not found" is not proof of rejection: stay unknown.
      const note = (notes.join("; ") || "outcome not determinable").slice(0, MAX_NOTE);
      await db
        .update(commands)
        .set({ ...base, reconcileNote: note })
        .where(guard);
      outcomes.push({ commandId: row.id, outcome: "UNKNOWN", note });
    }
  }
  return outcomes;
}
