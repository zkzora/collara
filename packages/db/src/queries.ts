// Scoped query helpers. Projection reads are always filtered by the caller's parties: a helper never
// returns ledger rows for an empty party list (no "unscoped" fallback).
import { formatRef, type RefKind } from "@collara/domain";
import { and, arrayOverlaps, asc, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db, DbOrTx } from "./client";
import {
  ledgerContracts,
  ledgerEvents,
  ledgerSources,
  mandates,
  memberships,
  organizations,
  partyBindings,
  refCounters,
  users,
  type LedgerContractRow,
  type LedgerEventRow,
  type LedgerSourceRow,
  type MandateRow,
  type OrganizationRow,
  type PartyBindingRow,
  type UserRow,
} from "./schema";

export interface VisibleContractsQuery {
  /** Parties the caller may read as (derived server-side). Empty → no rows. */
  readonly parties: readonly string[];
  /** Package-name template refs, e.g. "#collara-contracts:Collara.Control:AssetControl". */
  readonly templateRefs?: readonly string[];
  readonly source?: string;
  readonly contractIds?: readonly string[];
  /** Default false: active contracts only. */
  readonly includeArchived?: boolean;
  readonly limit?: number;
}

export async function visibleContracts(db: DbOrTx, query: VisibleContractsQuery): Promise<LedgerContractRow[]> {
  if (query.parties.length === 0) return [];
  const conditions: (SQL | undefined)[] = [arrayOverlaps(ledgerContracts.witnessParties, [...query.parties])];
  if (query.templateRefs) {
    if (query.templateRefs.length === 0) return [];
    conditions.push(inArray(ledgerContracts.templateRef, [...query.templateRefs]));
  }
  if (query.contractIds) {
    if (query.contractIds.length === 0) return [];
    conditions.push(inArray(ledgerContracts.contractId, [...query.contractIds]));
  }
  if (query.source) conditions.push(eq(ledgerContracts.source, query.source));
  if (!query.includeArchived) conditions.push(isNull(ledgerContracts.archivedOffset));
  return db
    .select()
    .from(ledgerContracts)
    .where(and(...conditions))
    .orderBy(asc(ledgerContracts.createdOffset), asc(ledgerContracts.createdNodeId))
    .limit(query.limit ?? 500);
}

export interface VisibleEventsQuery {
  readonly parties: readonly string[];
  readonly templateRefs?: readonly string[];
  readonly contractIds?: readonly string[];
  readonly source?: string;
  /** Exclusive lower bound (keyset cursor). */
  readonly afterOffset?: number;
  readonly limit?: number;
}

export async function visibleEvents(db: DbOrTx, query: VisibleEventsQuery): Promise<LedgerEventRow[]> {
  if (query.parties.length === 0) return [];
  const conditions: (SQL | undefined)[] = [arrayOverlaps(ledgerEvents.witnessParties, [...query.parties])];
  if (query.templateRefs) {
    if (query.templateRefs.length === 0) return [];
    conditions.push(inArray(ledgerEvents.templateRef, [...query.templateRefs]));
  }
  if (query.contractIds) {
    if (query.contractIds.length === 0) return [];
    conditions.push(inArray(ledgerEvents.contractId, [...query.contractIds]));
  }
  if (query.source) conditions.push(eq(ledgerEvents.source, query.source));
  if (query.afterOffset !== undefined) conditions.push(gt(ledgerEvents.offset, query.afterOffset));
  return db
    .select()
    .from(ledgerEvents)
    .where(and(...conditions))
    .orderBy(asc(ledgerEvents.offset), asc(ledgerEvents.nodeId))
    .limit(query.limit ?? 500);
}

export async function ledgerCheckpoints(db: DbOrTx): Promise<LedgerSourceRow[]> {
  return db.select().from(ledgerSources).orderBy(asc(ledgerSources.source));
}

/**
 * Allocates the next display reference for a kind ("document" → DOC-007) with one atomic upsert, so
 * concurrent requests never receive the same ref.
 */
export async function allocateRef(db: DbOrTx, kind: RefKind): Promise<string> {
  const [row] = await db
    .insert(refCounters)
    .values({ kind, value: 1 })
    .onConflictDoUpdate({ target: refCounters.kind, set: { value: sql`${refCounters.value} + 1` } })
    .returning({ value: refCounters.value });
  if (!row) throw new Error(`could not allocate a ${kind} reference`);
  return formatRef(kind, row.value);
}

export interface UserAuthority {
  readonly user: UserRow;
  /** The organization the session acts for, or null when the user has no active membership. */
  readonly org: OrganizationRow | null;
  readonly roles: string[];
  readonly mandates: MandateRow[];
  /**
   * ACTIVE party bindings of the organization (business, governance-member seats), plus the shared
   * governance binding when the user holds a governance seat mandate.
   */
  readonly bindings: PartyBindingRow[];
}

/**
 * Loads a user's authority inside one organization: ACTIVE memberships → roles, ACTIVE mandates and the
 * organization's ACTIVE party bindings. `preferredOrgId` is honoured only when the user has an active
 * membership there; otherwise the first active membership (by org id) is used.
 */
export async function loadUserAuthority(db: Db, userId: string, preferredOrgId?: string | null): Promise<UserAuthority | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.disabledAt) return null;
  const active = await db
    .select({ orgId: memberships.orgId, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.state, "ACTIVE"), eq(organizations.state, "ACTIVE")))
    .orderBy(asc(memberships.orgId), asc(memberships.role));
  const orgIds = [...new Set(active.map((m) => m.orgId))];
  const orgId = preferredOrgId && orgIds.includes(preferredOrgId) ? preferredOrgId : orgIds[0];
  if (!orgId) return { user, org: null, roles: [], mandates: [], bindings: [] };
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const [mandateRows, bindings] = await Promise.all([
    db
      .select()
      .from(mandates)
      .where(and(eq(mandates.userId, userId), eq(mandates.orgId, orgId), eq(mandates.state, "ACTIVE")))
      .orderBy(asc(mandates.code), asc(mandates.seat)),
    db
      .select()
      .from(partyBindings)
      .where(and(eq(partyBindings.orgId, orgId), eq(partyBindings.state, "ACTIVE")))
      .orderBy(asc(partyBindings.kind), asc(partyBindings.partyId)),
  ]);
  const governance = mandateRows.some((m) => m.code === "GOVERNANCE_SEAT")
    ? await db
        .select()
        .from(partyBindings)
        .where(and(eq(partyBindings.kind, "governance"), eq(partyBindings.state, "ACTIVE")))
    : [];
  return {
    user,
    org: org ?? null,
    roles: active.filter((m) => m.orgId === orgId).map((m) => m.role),
    mandates: mandateRows,
    bindings: [...bindings, ...governance.filter((g) => !bindings.some((b) => b.id === g.id))],
  };
}
