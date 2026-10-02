// Applies one ledger transaction to the projections in ONE database transaction: the ledger_updates row, the
// event rows, created/archived contracts, the per-source checkpoint and the PROJECTED transition of matching
// command records. A transaction at or below the checkpoint is a duplicate delivery and changes nothing; event
// and contract inserts are additionally idempotent by key, so a replay can never double-apply.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../client";
import { commands, ledgerContracts, ledgerEvents, ledgerSources, ledgerUpdates } from "../schema";
import { extractRefs, PROJECTED_PACKAGE_NAMES } from "./templates";
import type { ProjectionEvent, ProjectionTransaction } from "./types";

export interface ApplyOptions {
  /** Packages whose events are stored (default PROJECTED_PACKAGE_NAMES). */
  readonly packageNames?: readonly string[];
  readonly now?: Date;
  /** Test hook: runs inside the database transaction just before it commits. Throwing rolls everything back. */
  readonly beforeCommit?: (tx: DbOrTx, transaction: ProjectionTransaction) => Promise<void>;
}

export interface ApplyResult {
  /** False when the transaction was already applied (offset at or below the checkpoint). */
  readonly applied: boolean;
  readonly offset: number;
  readonly projectedEvents: number;
  readonly totalEvents: number;
  /** Command records moved to PROJECTED by this transaction. */
  readonly projectedCommands: number;
}

export class ProjectionSourceInactiveError extends Error {
  constructor(
    readonly source: string,
    readonly status: string,
  ) {
    super(`projection source ${source} is ${status}; refusing to apply updates`);
    this.name = "ProjectionSourceInactiveError";
  }
}

const date = (iso: string) => new Date(iso);

function eventDetail(event: ProjectionEvent): Record<string, unknown> | null {
  if (event.kind !== "exercised") return null;
  return {
    argument: event.choiceArgument ?? null,
    result: event.exerciseResult ?? null,
    lastDescendantNodeId: event.lastDescendantNodeId,
    ...(event.interfaceId ? { interfaceId: event.interfaceId } : {}),
  };
}

export async function applyTransaction(
  db: Db,
  source: string,
  transaction: ProjectionTransaction,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const packages = new Set(options.packageNames ?? PROJECTED_PACKAGE_NAMES);
  const now = options.now ?? new Date();
  const kept = transaction.events.filter((e) => packages.has(e.packageName));
  const skipped: ApplyResult = {
    applied: false,
    offset: transaction.offset,
    projectedEvents: 0,
    totalEvents: transaction.events.length,
    projectedCommands: 0,
  };

  return db.transaction(async (tx) => {
    // Row lock: serializes concurrent appliers of the same source (e.g. two workers by mistake).
    const [sourceRow] = await tx
      .select({ checkpoint: ledgerSources.checkpointOffset, status: ledgerSources.status })
      .from(ledgerSources)
      .where(eq(ledgerSources.source, source))
      .for("update");
    if (!sourceRow) throw new Error(`unknown projection source ${source}`);
    if (sourceRow.status !== "ACTIVE") throw new ProjectionSourceInactiveError(source, sourceRow.status);
    if (transaction.offset <= sourceRow.checkpoint) return skipped;

    const inserted = await tx
      .insert(ledgerUpdates)
      .values({
        source,
        updateId: transaction.updateId,
        offset: transaction.offset,
        commandId: transaction.commandId || null,
        workflowId: transaction.workflowId || null,
        effectiveAt: date(transaction.effectiveAt),
        recordTime: transaction.recordTime ? date(transaction.recordTime) : null,
        projectedEvents: kept.length,
        totalEvents: transaction.events.length,
        appliedAt: now,
      })
      .onConflictDoNothing()
      .returning({ updateId: ledgerUpdates.updateId });
    if (inserted.length === 0) return skipped;

    if (kept.length > 0) {
      await tx
        .insert(ledgerEvents)
        .values(
          kept.map((event) => ({
            source,
            updateId: transaction.updateId,
            offset: transaction.offset,
            nodeId: event.nodeId,
            kind: event.kind,
            contractId: event.contractId,
            templateId: event.templateId,
            templateRef: event.templateRef,
            choice: event.kind === "exercised" ? event.choice : null,
            consuming: event.kind === "exercised" ? event.consuming : event.kind === "archived" ? true : null,
            actingParties: event.kind === "exercised" ? [...event.actingParties] : [],
            witnessParties: [...event.witnessParties],
            commandId: transaction.commandId || null,
            effectiveAt: date(transaction.effectiveAt),
            recordTime: transaction.recordTime ? date(transaction.recordTime) : null,
            detail: eventDetail(event),
            projectedAt: now,
          })),
        )
        .onConflictDoNothing();
    }

    const created = kept.filter((e): e is Extract<ProjectionEvent, { kind: "created" }> => e.kind === "created");
    if (created.length > 0) {
      await tx
        .insert(ledgerContracts)
        .values(
          created.map((event) => ({
            source,
            contractId: event.contractId,
            templateId: event.templateId,
            templateRef: event.templateRef,
            packageName: event.packageName,
            payload: (event.createArgument ?? {}) as object,
            signatories: [...event.signatories],
            observers: [...event.observers],
            witnessParties: [...event.witnessParties],
            ...extractRefs(event.templateRef, event.createArgument),
            createdUpdateId: transaction.updateId,
            createdOffset: transaction.offset,
            createdNodeId: event.nodeId,
            createdAt: date(event.createdAt || transaction.effectiveAt),
          })),
        )
        .onConflictDoNothing();
    }

    // Archives after creates, so a contract created and consumed in the same transaction ends up archived.
    for (const event of kept) {
      const consuming = event.kind === "archived" || (event.kind === "exercised" && event.consuming);
      if (!consuming) continue;
      await tx
        .update(ledgerContracts)
        .set({
          archivedUpdateId: transaction.updateId,
          archivedOffset: transaction.offset,
          archivedAt: date(transaction.effectiveAt),
          archivedChoice: event.kind === "exercised" ? event.choice : null,
          archivedNodeId: event.nodeId,
        })
        .where(
          and(
            eq(ledgerContracts.source, source),
            eq(ledgerContracts.contractId, event.contractId),
            isNull(ledgerContracts.archivedOffset),
          ),
        );
    }

    await tx
      .update(ledgerSources)
      .set({ checkpointOffset: transaction.offset, lastUpdateId: transaction.updateId, lastAppliedAt: now, updatedAt: now })
      .where(and(eq(ledgerSources.source, source), sql`${ledgerSources.checkpointOffset} < ${transaction.offset}`));

    const projected = await tx
      .update(commands)
      .set({ status: "PROJECTED", projectedAt: now, updatedAt: now })
      .where(
        and(
          eq(commands.updateId, transaction.updateId),
          eq(commands.target, "LEDGER"),
          inArray(commands.status, ["COMMITTED", "PROJECTION_DELAYED"]),
        ),
      )
      .returning({ id: commands.id });

    await options.beforeCommit?.(tx, transaction);

    return {
      applied: true,
      offset: transaction.offset,
      projectedEvents: kept.length,
      totalEvents: transaction.events.length,
      projectedCommands: projected.length,
    };
  });
}
