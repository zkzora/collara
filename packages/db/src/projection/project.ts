// One projection pass per participant source: reset detection, then /v2/updates (LEDGER_EFFECTS) from the
// durable checkpoint to the ledger end, each transaction applied atomically (apply.ts), then the command-status
// sweep. Restart-safe: everything resumes from ledger_sources.checkpoint_offset.
import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { ledgerContracts, ledgerEvents, ledgerSources, ledgerUpdates, type LedgerSourceRow } from "../schema";
import { applyTransaction, ProjectionSourceInactiveError, type ApplyOptions } from "./apply";
import { advanceCommandStatuses } from "./commands";
import { PROJECTED_PACKAGE_NAMES } from "./templates";
import type { ProjectionLedgerClient } from "./types";

export interface ProjectionSourceConfig {
  /** Participant alias, e.g. "sandbox". */
  readonly source: string;
  readonly jsonApiUrl: string;
  /** Parties the projector reads as (its CanReadAs rights). Order does not matter. */
  readonly parties: readonly string[];
  /** Ledger user of the client (recorded for health; e.g. "projector-svc"). */
  readonly ledgerUserId?: string;
}

export interface ProjectOnceOptions {
  /** Elements per /v2/updates call (default 200). */
  readonly pageLimit?: number;
  /** Stop after this many pages even if the ledger end is not reached (default: no limit). */
  readonly maxPages?: number;
  readonly packageNames?: readonly string[];
  /** COMMITTED → PROJECTION_DELAYED after this many seconds without projection (default 5). */
  readonly projectionDelaySeconds?: number;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
  /** Test hook passed to applyTransaction. */
  readonly beforeCommit?: ApplyOptions["beforeCommit"];
}

export type ProjectionStatus = "ACTIVE" | "RESET_DETECTED" | "PAUSED";

export interface ProjectOnceResult {
  readonly source: string;
  readonly status: ProjectionStatus;
  readonly resetReason: string | null;
  readonly participantId: string | null;
  readonly checkpointBefore: number;
  readonly checkpoint: number;
  readonly ledgerEnd: number | null;
  readonly transactionsApplied: number;
  /** Transactions at or below the checkpoint (duplicate delivery). */
  readonly transactionsSkipped: number;
  readonly eventsProjected: number;
  readonly commandsProjected: number;
  readonly commandsDelayed: number;
  /** True when the checkpoint reached the ledger end observed at the start of the pass. */
  readonly complete: boolean;
}

const sortedParties = (parties: readonly string[]) => [...new Set(parties)].sort();
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

async function loadSource(db: Db, source: string): Promise<LedgerSourceRow | null> {
  const [row] = await db.select().from(ledgerSources).where(eq(ledgerSources.source, source)).limit(1);
  return row ?? null;
}

async function markReset(db: Db, source: string, reason: string, now: Date): Promise<void> {
  await db
    .update(ledgerSources)
    .set({ status: "RESET_DETECTED", resetDetectedAt: now, resetReason: reason.slice(0, 500), updatedAt: now })
    .where(eq(ledgerSources.source, source));
}

function inactive(row: LedgerSourceRow, ledgerEnd: number | null, participantId: string | null): ProjectOnceResult {
  return {
    source: row.source,
    status: row.status as ProjectionStatus,
    resetReason: row.resetReason,
    participantId,
    checkpointBefore: row.checkpointOffset,
    checkpoint: row.checkpointOffset,
    ledgerEnd,
    transactionsApplied: 0,
    transactionsSkipped: 0,
    eventsProjected: 0,
    commandsProjected: 0,
    commandsDelayed: 0,
    complete: false,
  };
}

/**
 * Projects every update from the source's checkpoint up to the current ledger end. Returns without applying
 * anything when the source is (or is found to be) RESET_DETECTED: a reset is cleared only by
 * resetProjectionSource (explicit operator command).
 */
export async function projectOnce(
  db: Db,
  client: ProjectionLedgerClient,
  config: ProjectionSourceConfig,
  options: ProjectOnceOptions = {},
): Promise<ProjectOnceResult> {
  const clock = options.now ?? (() => new Date());
  const parties = sortedParties(config.parties);
  if (parties.length === 0) throw new Error(`projection source ${config.source} has no parties to read as`);
  const signal = options.signal;

  try {
    const participantId = await client.participantId({ signal });
    let row = await loadSource(db, config.source);
    if (!row) {
      await db
        .insert(ledgerSources)
        .values({
          source: config.source,
          participantId,
          jsonApiUrl: config.jsonApiUrl,
          partyFilter: parties,
          ledgerUserId: config.ledgerUserId ?? null,
        })
        .onConflictDoNothing();
      row = await loadSource(db, config.source);
      if (!row) throw new Error(`could not create projection source ${config.source}`);
    }
    if (row.status !== "ACTIVE") return inactive(row, null, participantId);

    const now = clock();
    if (row.participantId !== participantId) {
      await markReset(db, config.source, `participant changed from ${row.participantId} to ${participantId}`, now);
      return inactive((await loadSource(db, config.source)) ?? row, null, participantId);
    }
    if (row.partyFilter === null) {
      await db
        .update(ledgerSources)
        .set({ partyFilter: parties, ledgerUserId: config.ledgerUserId ?? row.ledgerUserId, updatedAt: now })
        .where(eq(ledgerSources.source, config.source));
    } else if (!sameSet(row.partyFilter, parties)) {
      const added = parties.filter((p) => !row.partyFilter?.includes(p)).length;
      const removed = row.partyFilter.filter((p) => !parties.includes(p)).length;
      await markReset(
        db,
        config.source,
        `party filter changed (${added} added, ${removed} removed); reset the projection to rebuild it from offset 0`,
        now,
      );
      return inactive((await loadSource(db, config.source)) ?? row, null, participantId);
    }

    const ledgerEnd = await client.ledgerEnd({ signal });
    if (ledgerEnd < row.checkpointOffset) {
      await markReset(db, config.source, `ledger end ${ledgerEnd} is behind checkpoint ${row.checkpointOffset}`, now);
      return inactive((await loadSource(db, config.source)) ?? row, ledgerEnd, participantId);
    }

    const checkpointBefore = row.checkpointOffset;
    let checkpoint = checkpointBefore;
    let applied = 0;
    let skippedTx = 0;
    let events = 0;
    let commandsProjected = 0;
    let complete = checkpoint >= ledgerEnd;
    const applyOptions: ApplyOptions = {
      packageNames: options.packageNames ?? PROJECTED_PACKAGE_NAMES,
      ...(options.beforeCommit ? { beforeCommit: options.beforeCommit } : {}),
    };

    for (let pages = 0; !complete && (options.maxPages === undefined || pages < options.maxPages); pages++) {
      signal?.throwIfAborted();
      const page = await client.updates(
        { beginExclusive: checkpoint, endInclusive: ledgerEnd, parties, shape: "LEDGER_EFFECTS", limit: options.pageLimit ?? 200 },
        { signal },
      );
      for (const update of page.updates) {
        if (update.kind !== "transaction") continue;
        const result = await applyTransaction(db, config.source, update.transaction, { ...applyOptions, now: clock() });
        if (result.applied) {
          applied++;
          events += result.projectedEvents;
          commandsProjected += result.projectedCommands;
        } else {
          skippedTx++;
        }
      }
      // Every update up to nextBeginExclusive was delivered in order and applied above, so the checkpoint can
      // move there even when the last element was an offset checkpoint rather than a transaction.
      const next = Math.max(checkpoint, page.nextBeginExclusive);
      if (next > checkpoint) {
        const at = clock();
        const advanced = await db
          .update(ledgerSources)
          .set({ checkpointOffset: next, lastAppliedAt: at, updatedAt: at })
          .where(eq(ledgerSources.source, config.source))
          .returning({ status: ledgerSources.status });
        if (advanced[0]?.status !== "ACTIVE") throw new ProjectionSourceInactiveError(config.source, advanced[0]?.status ?? "missing");
      }
      if (next <= checkpoint && !page.complete) throw new Error(`no progress reading updates of ${config.source} after offset ${checkpoint}`);
      checkpoint = next;
      complete = page.complete || checkpoint >= ledgerEnd;
    }

    const at = clock();
    await db
      .update(ledgerSources)
      .set({
        ledgerEndSeen: ledgerEnd,
        lastPolledAt: at,
        // "Synced at": an idle ledger keeps the projection current, so the checkpoint age stays small.
        ...(complete ? { lastAppliedAt: at } : {}),
        lastError: null,
        lastErrorAt: null,
        jsonApiUrl: config.jsonApiUrl,
        updatedAt: at,
      })
      .where(eq(ledgerSources.source, config.source));

    const sweep = await advanceCommandStatuses(db, { now: at, delaySeconds: options.projectionDelaySeconds ?? 5 });
    return {
      source: config.source,
      status: "ACTIVE",
      resetReason: null,
      participantId,
      checkpointBefore,
      checkpoint,
      ledgerEnd,
      transactionsApplied: applied,
      transactionsSkipped: skippedTx,
      eventsProjected: events,
      commandsProjected: commandsProjected + sweep.projected,
      commandsDelayed: sweep.delayed,
      complete,
    };
  } catch (error) {
    if (!(error instanceof ProjectionSourceInactiveError)) {
      const at = clock();
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(ledgerSources)
        .set({ lastError: message.slice(0, 500), lastErrorAt: at, updatedAt: at })
        .where(eq(ledgerSources.source, config.source))
        .catch(() => undefined);
    }
    throw error;
  }
}

export interface ResetSummary {
  readonly source: string;
  readonly contracts: number;
  readonly events: number;
  readonly updates: number;
}

/**
 * Operator command after a ledger reset: deletes the source's projected contracts, events and updates and
 * restarts it from offset 0 (ACTIVE), optionally re-pointed at a new participant id. Command records are kept.
 */
export async function resetProjectionSource(
  db: Db,
  source: string,
  options: { participantId?: string; jsonApiUrl?: string; now?: Date } = {},
): Promise<ResetSummary> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(ledgerSources).where(eq(ledgerSources.source, source)).for("update");
    if (!row) throw new Error(`unknown projection source ${source}`);
    const events = await tx.delete(ledgerEvents).where(eq(ledgerEvents.source, source)).returning({ id: ledgerEvents.id });
    const contracts = await tx
      .delete(ledgerContracts)
      .where(eq(ledgerContracts.source, source))
      .returning({ id: ledgerContracts.contractId });
    const updates = await tx
      .delete(ledgerUpdates)
      .where(eq(ledgerUpdates.source, source))
      .returning({ id: ledgerUpdates.updateId });
    await tx
      .update(ledgerSources)
      .set({
        checkpointOffset: 0,
        lastUpdateId: null,
        lastAppliedAt: null,
        ledgerEndSeen: null,
        status: "ACTIVE",
        resetDetectedAt: null,
        resetReason: null,
        partyFilter: null,
        lastError: null,
        lastErrorAt: null,
        lastPolledAt: null,
        ...(options.participantId ? { participantId: options.participantId } : {}),
        ...(options.jsonApiUrl ? { jsonApiUrl: options.jsonApiUrl } : {}),
        updatedAt: now,
      })
      .where(eq(ledgerSources.source, source));
    return { source, contracts: contracts.length, events: events.length, updates: updates.length };
  });
}

export interface ProjectionLoopOptions extends ProjectOnceOptions {
  /** Pause between passes that reached the ledger end (default 1000 ms). */
  readonly intervalMs?: number;
  /** Pause after an error (default 5000 ms). */
  readonly errorBackoffMs?: number;
  readonly signal: AbortSignal;
  readonly onPass?: (result: ProjectOnceResult) => void;
  readonly onError?: (error: unknown) => void;
}

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

/** Long-running projection of one source until `signal` aborts. Never throws; errors go to onError. */
export async function runProjectionLoop(
  db: Db,
  client: ProjectionLedgerClient,
  config: ProjectionSourceConfig,
  options: ProjectionLoopOptions,
): Promise<void> {
  const { signal } = options;
  while (!signal.aborted) {
    let wait = options.intervalMs ?? 1_000;
    try {
      const result = await projectOnce(db, client, config, { ...options, maxPages: options.maxPages ?? 50 });
      options.onPass?.(result);
      // Keep reading without pausing while behind; pause longer while a reset blocks the source.
      if (result.status === "ACTIVE" && !result.complete) wait = 0;
      if (result.status !== "ACTIVE") wait = Math.max(wait, options.errorBackoffMs ?? 5_000);
    } catch (error) {
      if (signal.aborted) break;
      options.onError?.(error);
      wait = options.errorBackoffMs ?? 5_000;
    }
    if (wait > 0) await sleep(wait, signal);
  }
}
