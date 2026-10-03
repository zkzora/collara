// Case creation write (POST /cases), run inside the case.create command's transaction (CommandService
// .runApplicationCommand): the case row, the superseded marks and the command's COMMITTED result commit together.
// One active case per asset is decided here on the database rows, serialised per asset, and enforced again by the
// partial unique index cases_active_asset_key (migration 0003).
import { allocateRef, cases, type DbOrTx } from "@collara/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export type NewCaseValues = Omit<typeof cases.$inferInsert, "id" | "caseRef" | "supersededAt" | "createdAt" | "updatedAt">;

const ACTIVE_ASSET_INDEX = "cases_active_asset_key";

/** True for a PostgreSQL unique violation on `constraint` (node-postgres and PGlite errors, also wrapped by Drizzle). */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, constraint: name } = e as { code?: unknown; constraint?: unknown };
    if (code === "23505" && name === constraint) return true;
  }
  return false;
}

/** The case a case.create command already inserted (same transaction as its completion), if any. */
export async function caseOfCommand(tx: DbOrTx, commandId: string): Promise<string | null> {
  const [row] = await tx.select({ caseRef: cases.caseRef }).from(cases).where(eq(cases.createCommandId, commandId)).limit(1);
  return row?.caseRef ?? null;
}

/**
 * Inserts the case under a savepoint: marks `supersede` (cases the ledger shows finished) superseded, allocates the
 * ref and inserts the row. Returns null, with nothing of it kept, when the one-active-case-per-asset index refuses
 * the row (a writer that bypassed the check in createCaseForAsset); the caller's transaction stays usable.
 */
export async function insertActiveCase(tx: DbOrTx, values: NewCaseValues, supersede: readonly string[], now: Date): Promise<string | null> {
  try {
    return await tx.transaction(async (sp) => {
      if (supersede.length > 0) {
        await sp
          .update(cases)
          .set({ supersededAt: now, updatedAt: now })
          .where(and(inArray(cases.caseRef, [...supersede]), eq(cases.assetRef, values.assetRef), isNull(cases.supersededAt)));
      }
      const caseRef = await allocateRef(sp, "case");
      await sp.insert(cases).values({ ...values, caseRef });
      return caseRef;
    });
  } catch (error) {
    if (isUniqueViolation(error, ACTIVE_ASSET_INDEX)) return null;
    throw error;
  }
}

/**
 * Creates the asset's case unless another case holds the asset (null). `finished` are the asset's cases the viewer's
 * ledger facts show finished (pledge released or review rejected): they no longer hold the asset and are marked
 * superseded. Creations for one asset are serialised (transaction-scoped advisory lock), so the check below sees
 * every case committed before it.
 */
export async function createCaseForAsset(tx: DbOrTx, values: NewCaseValues, finished: ReadonlySet<string>, now: Date): Promise<string | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`case:${values.assetRef}`}))`);
  const active = await tx
    .select({ caseRef: cases.caseRef })
    .from(cases)
    .where(and(eq(cases.assetRef, values.assetRef), isNull(cases.cancelledAt), isNull(cases.closedAt), isNull(cases.supersededAt)));
  if (active.some((row) => !finished.has(row.caseRef))) return null;
  return insertActiveCase(
    tx,
    values,
    active.map((row) => row.caseRef),
    now,
  );
}
