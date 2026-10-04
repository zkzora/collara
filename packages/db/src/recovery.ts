// Database side of the DEVNET recovery diagnosis (@collara/canton diagnoseDevnet): is the database there and migrated,
// and where does the projection source stand. Shared by scripts/devnet/recover.mjs (API CLI) and the worker's health.
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { ledgerCredentials, ledgerSources } from "./schema";

export interface DatabaseRecoveryState {
  readonly reachable: boolean;
  readonly migrated: boolean;
  readonly detail?: string;
}

export interface ProjectionRecoveryState {
  readonly status: string;
  readonly participantId: string;
  readonly checkpoint: number;
  readonly historyFloor: number | null;
  readonly reason: string | null;
}

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 160);

/** Null `db` = unreachable. Migrated means migration 0005 (encrypted credentials, history floor) is applied. */
export async function databaseRecoveryState(db: Db | null, error?: string): Promise<DatabaseRecoveryState> {
  if (!db) return { reachable: false, migrated: false, detail: `the DEVNET database is unreachable${error ? ` (${error})` : ""}` };
  try {
    await db.select({ keyId: ledgerCredentials.refreshTokenKeyId }).from(ledgerCredentials).limit(1);
    await db.select({ floor: ledgerSources.historyFloorOffset }).from(ledgerSources).limit(1);
    return { reachable: true, migrated: true };
  } catch (e) {
    return { reachable: true, migrated: false, detail: `the DEVNET database is not migrated to 0005 (lost, new or never set up): ${short(e)}` };
  }
}

/** The projection source's state, or null when the worker never created it. */
export async function projectionRecoveryState(db: Db, source: string): Promise<ProjectionRecoveryState | null> {
  const [row] = await db.select().from(ledgerSources).where(eq(ledgerSources.source, source)).limit(1);
  if (!row) return null;
  return { status: row.status, participantId: row.participantId, checkpoint: row.checkpointOffset, historyFloor: row.historyFloorOffset, reason: row.resetReason };
}
