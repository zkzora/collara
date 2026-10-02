// Stakeholder-filtered access to the projections. A contract is visible to a viewer only when one of the
// viewer's readable parties is a signatory or an observer (ledger_contracts.stakeholders). Witness parties
// (divulgence, fetch informees, actors) never grant visibility. Events are visible when the viewer is a
// stakeholder of the contract they act on.
import { and, arrayOverlaps, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "../client";
import { ledgerContracts, ledgerEvents, ledgerSources, partyBindings } from "../schema";
import { obj, type Json } from "./decode";
import type { ReadViewer } from "./viewer";

export interface VisibleContract {
  readonly source: string;
  readonly contractId: string;
  readonly templateRef: string;
  readonly payload: Json;
  readonly signatories: readonly string[];
  readonly observers: readonly string[];
  readonly businessRef: string | null;
  readonly caseRef: string | null;
  readonly assetRef: string | null;
  readonly createdAt: string;
  readonly createdOffset: number;
  readonly createdNodeId: number;
  readonly createdUpdateId: string;
  readonly archived: {
    readonly at: string;
    readonly offset: number;
    readonly updateId: string;
    readonly choice: string | null;
    /** Argument of the consuming choice (terminal outcomes without a successor contract, daml-model D14). */
    readonly argument: Json;
    readonly actingParties: readonly string[];
  } | null;
}

export interface VisibleEvent {
  readonly source: string;
  readonly updateId: string;
  readonly offset: number;
  readonly nodeId: number;
  readonly kind: "created" | "archived" | "exercised";
  readonly contractId: string;
  readonly templateRef: string;
  readonly choice: string | null;
  readonly consuming: boolean | null;
  readonly actingParties: readonly string[];
  readonly effectiveAt: string;
  readonly argument: Json;
  readonly result: unknown;
  /** The contract the event acts on (always visible to the viewer: that is the filter). */
  readonly contract: VisibleContract;
}

export interface LedgerView {
  readonly contracts: readonly VisibleContract[];
  readonly events: readonly VisibleEvent[];
  readonly byId: ReadonlyMap<string, VisibleContract>;
}

export interface LedgerViewFilter {
  readonly sources?: readonly string[];
  readonly templateRefs?: readonly string[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : "");

/** Every Collara contract (active and archived) the viewer is a stakeholder of, oldest first. */
export async function loadLedgerView(db: DbOrTx, viewer: ReadViewer, filter: LedgerViewFilter = {}): Promise<LedgerView> {
  const parties = [...new Set(viewer.readableParties)];
  if (parties.length === 0) return { contracts: [], events: [], byId: new Map() };
  if (filter.templateRefs && filter.templateRefs.length === 0) return { contracts: [], events: [], byId: new Map() };

  const conditions = [arrayOverlaps(ledgerContracts.stakeholders, parties)];
  if (filter.sources?.length) conditions.push(inArray(ledgerContracts.source, [...filter.sources]));
  if (filter.templateRefs) conditions.push(inArray(ledgerContracts.templateRef, [...filter.templateRefs]));

  const archiveEvent = sql`(select json_build_object('detail', e.detail, 'acting', e.acting_parties)
      from ${ledgerEvents} e
      where e.source = ${ledgerContracts.source} and e.update_id = ${ledgerContracts.archivedUpdateId}
        and e.node_id = ${ledgerContracts.archivedNodeId} limit 1)`;
  const rows = await db
    .select({ c: ledgerContracts, archive: archiveEvent.mapWith((v: unknown) => v) })
    .from(ledgerContracts)
    .where(and(...conditions))
    .orderBy(asc(ledgerContracts.createdOffset), asc(ledgerContracts.createdNodeId));

  const byId = new Map<string, VisibleContract>();
  const contracts: VisibleContract[] = [];
  for (const { c, archive } of rows) {
    // The same contract can be projected from several participants (3-participant mode): keep the first.
    if (byId.has(c.contractId)) continue;
    const a = obj(typeof archive === "string" ? JSON.parse(archive) : archive);
    const detail = obj(a.detail);
    const contract: VisibleContract = {
      source: c.source,
      contractId: c.contractId,
      templateRef: c.templateRef,
      payload: obj(c.payload),
      signatories: c.signatories,
      observers: c.observers,
      businessRef: c.businessRef,
      caseRef: c.caseRef,
      assetRef: c.assetRef,
      createdAt: iso(c.createdAt),
      createdOffset: c.createdOffset,
      createdNodeId: c.createdNodeId,
      createdUpdateId: c.createdUpdateId,
      archived:
        c.archivedOffset === null
          ? null
          : {
              at: iso(c.archivedAt),
              offset: c.archivedOffset,
              updateId: c.archivedUpdateId ?? "",
              choice: c.archivedChoice,
              argument: obj(detail.argument),
              actingParties: Array.isArray(a.acting) ? (a.acting as string[]) : [],
            },
    };
    byId.set(c.contractId, contract);
    contracts.push(contract);
  }

  const ids = [...byId.keys()];
  const events: VisibleEvent[] = [];
  // Chunked: a viewer with many contracts must not build one huge IN list.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const eventRows = await db
      .select()
      .from(ledgerEvents)
      .where(and(inArray(ledgerEvents.contractId, chunk), filter.sources?.length ? inArray(ledgerEvents.source, [...filter.sources]) : undefined))
      .orderBy(asc(ledgerEvents.offset), asc(ledgerEvents.nodeId));
    for (const e of eventRows) {
      const contract = byId.get(e.contractId);
      if (!contract || e.source !== contract.source) continue;
      const detail = obj(e.detail);
      events.push({
        source: e.source,
        updateId: e.updateId,
        offset: e.offset,
        nodeId: e.nodeId,
        kind: e.kind as VisibleEvent["kind"],
        contractId: e.contractId,
        templateRef: e.templateRef,
        choice: e.choice,
        consuming: e.consuming,
        actingParties: e.actingParties,
        effectiveAt: iso(e.effectiveAt),
        argument: obj(detail.argument),
        result: detail.result ?? null,
        contract,
      });
    }
  }
  events.sort((a, b) => a.offset - b.offset || a.nodeId - b.nodeId);
  return { contracts, events, byId };
}

// --- Parties → organizations -------------------------------------------------------------------------

export interface PartyDirectory {
  /** Organization of a party (any binding state: history keeps old bindings meaningful), or null. */
  orgOf(party: string | null | undefined): string | null;
  /** Organization id, or a stable placeholder ("party:<hint>") for parties bound to no organization. */
  orgIdOf(party: string | null | undefined): string;
  /** Governance seat (1–3) of a governance-member party. */
  seatOf(party: string | null | undefined): 1 | 2 | 3 | null;
  hintOf(party: string | null | undefined): string;
  readonly governanceParties: ReadonlySet<string>;
}

export async function loadPartyDirectory(db: DbOrTx, environment = "LOCALNET"): Promise<PartyDirectory> {
  const rows = await db
    .select()
    .from(partyBindings)
    .where(eq(partyBindings.environment, environment))
    .orderBy(asc(partyBindings.createdAt));
  const org = new Map<string, string>();
  const seat = new Map<string, 1 | 2 | 3>();
  const hint = new Map<string, string>();
  const governance = new Set<string>();
  for (const row of rows) {
    hint.set(row.partyId, row.partyHint);
    if (row.kind === "governance") {
      governance.add(row.partyId);
      continue;
    }
    org.set(row.partyId, row.orgId);
    if (row.kind === "governance-member" && (row.governanceSeat === 1 || row.governanceSeat === 2 || row.governanceSeat === 3)) {
      seat.set(row.partyId, row.governanceSeat);
    }
  }
  const hintOf = (party: string | null | undefined) => (party ? (hint.get(party) ?? party.split("::")[0] ?? party) : "");
  return {
    orgOf: (party) => (party ? (org.get(party) ?? null) : null),
    orgIdOf: (party) => (party ? (org.get(party) ?? `party:${hintOf(party)}`) : "party:unknown"),
    seatOf: (party) => (party ? (seat.get(party) ?? null) : null),
    hintOf,
    governanceParties: governance,
  };
}

// --- Sync watermark --------------------------------------------------------------------------------------

export interface LastSync {
  readonly offset: number | null;
  readonly at: string | null;
}

/**
 * The projection watermark for responses (`Ledger synced · offset N · HH:MM:SS UTC`): the ACTIVE source with the
 * oldest sync time (one source in single-participant mode). Null values when nothing was projected yet.
 */
export async function readLastSync(db: DbOrTx, sources?: readonly string[]): Promise<LastSync> {
  const rows = await db
    .select()
    .from(ledgerSources)
    .where(and(eq(ledgerSources.status, "ACTIVE"), sources?.length ? inArray(ledgerSources.source, [...sources]) : undefined))
    .orderBy(asc(ledgerSources.lastAppliedAt));
  const row = rows.find((r) => r.lastAppliedAt !== null) ?? rows[0];
  if (!row) return { offset: null, at: null };
  return { offset: row.lastAppliedAt ? row.checkpointOffset : null, at: row.lastAppliedAt ? row.lastAppliedAt.toISOString() : null };
}
