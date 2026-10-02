// Read model: viewer → stakeholder-filtered projections → domain facts. The API presents these with the domain
// presenters (field omission by role and mandate) and answers 404-shaped `unavailable` when a lookup returns
// null. Mapping documentation: README.md in this folder.
import {
  presentVerifierEntries,
  type AssetFacts,
  type CaseFacts,
  type GovernanceFacts,
  type ReleaseRequestFacts,
  type VerificationFacts,
  type VerifierEntry,
} from "@collara/domain";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { DbOrTx } from "../client";
import { auditEvents, cases, evidenceDocuments, exportJobs, type AuditEventRow } from "../schema";
import { T } from "../projection/templates";
import { decode } from "./decode";
import { discloseEquipmentIdentity } from "./disclosure";
import type { MappedEvent } from "./events";
import { buildGovernance } from "./governance";
import { loadLedgerView, loadPartyDirectory, readLastSync, type LastSync, type LedgerView, type PartyDirectory, type VisibleContract } from "./ledger-view";
import { buildWorld, type PendingRegistration } from "./world";
import { withNotes } from "../notes";
import type { ReadOptions, ReadViewer } from "./viewer";

export type { LastSync, LedgerView, PartyDirectory, VisibleContract, VisibleEvent } from "./ledger-view";
export { loadLedgerView, loadPartyDirectory, readLastSync } from "./ledger-view";
export type { MappedEvent } from "./events";
export { mapLedgerEvent } from "./events";
export { buildGovernance } from "./governance";
export { discloseEquipmentIdentity, equipmentEntitlements, type EquipmentIdentity } from "./disclosure";
export { buildWorld, documentTypeOf, type PendingRegistration, type WorldInput } from "./world";
export { readViewerOf, type ReadOptions, type ReadViewer } from "./viewer";
export * as payloads from "./decode";

export interface ReadWorld {
  readonly viewer: ReadViewer;
  readonly now: Date;
  readonly assets: readonly AssetFacts[];
  readonly cases: readonly CaseFacts[];
  readonly pendingRegistrations: readonly PendingRegistration[];
  readonly governance: GovernanceFacts | null;
  /** Ledger events the viewer is a stakeholder of, mapped to domain events (with case/asset context). */
  readonly events: readonly MappedEvent[];
  readonly lastSync: LastSync;
  /** Raw stakeholder view (for endpoint-specific needs, e.g. contract ids for commands; never sent as is). */
  readonly view: LedgerView;
  readonly parties: PartyDirectory;
}

async function appRecords(db: DbOrTx, viewer: ReadViewer, view: LedgerView) {
  const ledgerCaseRefs = [...new Set(view.contracts.map((c) => c.caseRef).filter((x): x is string => !!x))];
  const caseRows = await db
    .select()
    .from(cases)
    .where(
      ledgerCaseRefs.length
        ? or(eq(cases.borrowerOrgId, viewer.orgId), inArray(cases.caseRef, ledgerCaseRefs))
        : eq(cases.borrowerOrgId, viewer.orgId),
    );
  const assetRefs = [
    ...new Set([...caseRows.map((r) => r.assetRef), ...view.contracts.map((c) => c.assetRef).filter((x): x is string => !!x)]),
  ];
  const documents = await db
    .select()
    .from(evidenceDocuments)
    .where(
      assetRefs.length
        ? or(inArray(evidenceDocuments.assetRef, assetRefs), eq(evidenceDocuments.ownerOrgId, viewer.orgId), eq(evidenceDocuments.contributorOrgId, viewer.orgId))
        : or(eq(evidenceDocuments.ownerOrgId, viewer.orgId), eq(evidenceDocuments.contributorOrgId, viewer.orgId)),
    );
  const exports = await db.select().from(exportJobs).where(eq(exportJobs.orgId, viewer.orgId));
  return { caseRows, documents, exports };
}

/**
 * Everything the viewer may read, as domain facts. Auditors additionally get, for each case with an active
 * AuditGrant they observe, the grantor's facts for that case (exports are produced from the grantor's projection
 * and the presenters keep only the granted scopes, daml-model.md §4.9).
 */
export async function loadReadWorld(db: DbOrTx, viewer: ReadViewer, options: ReadOptions = {}): Promise<ReadWorld> {
  const now = options.now ?? new Date();
  const [view, parties, lastSync] = await Promise.all([
    loadLedgerView(db, viewer, options.sources ? { sources: options.sources } : {}),
    loadPartyDirectory(db, options.environment),
    readLastSync(db, options.sources),
  ]);
  const records = await appRecords(db, viewer, view);
  const built = buildWorld({ viewer, now, view, parties, ...records });
  // Equipment identity of shared, invited or assigned cases (application-level disclosure, disclosure.ts).
  const disclosed = await discloseEquipmentIdentity(db, viewer, built, view, { now, ...(options.sources ? { sources: options.sources } : {}) });
  let worldCases = disclosed.cases;
  let worldAssets = disclosed.assets;

  // Audit delegation: active grants observed by the viewer → the grantor's view of that one case.
  const delegated = new Map<string, Set<string>>();
  // Only for auditors (when roles are given): a grant names the auditor party, the presenters the auditor role.
  const auditor = !viewer.roles || viewer.roles.includes("AUDITOR");
  for (const c of auditor ? view.contracts : []) {
    if (c.templateRef !== T.AuditGrant || c.archived) continue;
    const g = decode.auditGrant(c.payload);
    if (!viewer.readableParties.includes(g.auditor) || Date.parse(g.expiresAt) < now.getTime()) continue;
    const set = delegated.get(g.caseRef) ?? new Set<string>();
    set.add(g.grantor);
    delegated.set(g.caseRef, set);
  }
  for (const [caseRef, grantors] of delegated) {
    const grantorView = await loadLedgerView(db, { orgId: viewer.orgId, readableParties: [...grantors] }, options.sources ? { sources: options.sources } : {});
    // Other auditors' grants are not the viewer's business: keep only grants to the viewer.
    const scoped = scopeViewToCase(grantorView, caseRef, (c) => c.templateRef !== T.AuditGrant || viewer.readableParties.includes(decode.auditGrant(c.payload).auditor));
    // Build as the record owner would see it (the owner-side grantor when there is one); presenters then keep
    // only the scopes every record owner granted.
    const [caseRow] = await db.select().from(cases).where(eq(cases.caseRef, caseRef)).limit(1);
    const grantorOrgs = [...grantors].map((g) => parties.orgIdOf(g));
    const asOrg = grantorOrgs.find((o) => o === caseRow?.borrowerOrgId) ?? grantorOrgs[0] ?? viewer.orgId;
    const grantorViewer: ReadViewer = { orgId: asOrg, readableParties: [...grantors] };
    const grantorRecords = await appRecords(db, grantorViewer, scoped);
    const facts = buildWorld({
      viewer: grantorViewer,
      now,
      view: scoped,
      parties,
      caseRows: grantorRecords.caseRows.filter((r) => r.caseRef === caseRef),
      documents: grantorRecords.documents,
      exports: records.exports,
    }).cases.find((x) => x.ref === caseRef);
    if (!facts) continue;
    worldCases = [...worldCases.filter((x) => x.ref !== caseRef), facts];
    if (facts.asset.ref) worldAssets = [...worldAssets.filter((a) => a.ref !== facts.asset.ref), facts.asset];
  }

  return {
    viewer,
    now,
    assets: worldAssets,
    // Private off-ledger notes the viewer may read (../notes.ts); the presenters still omit fields by role.
    cases: (await withNotes(db, viewer, worldCases)).sort((a, b) => a.ref.localeCompare(b.ref)),
    pendingRegistrations: built.pendingRegistrations,
    governance: buildGovernance(view, parties),
    events: built.events,
    lastSync,
    view,
    parties,
  };
}

/** Restricts a (grantor's) view to one case and its asset: case contracts plus asset-level contracts. */
function scopeViewToCase(view: LedgerView, caseRef: string, include: (c: VisibleContract) => boolean = () => true): LedgerView {
  const caseContracts = view.contracts.filter((c) => c.caseRef === caseRef);
  const assetRefs = new Set(caseContracts.map((c) => c.assetRef).filter((x): x is string => !!x));
  const keep = view.contracts.filter(
    (c) =>
      include(c) &&
      (c.caseRef === caseRef || (c.assetRef !== null && assetRefs.has(c.assetRef) && (c.caseRef === null || c.caseRef === caseRef))),
  );
  const ids = new Set(keep.map((c) => c.contractId));
  return { contracts: keep, events: view.events.filter((e) => ids.has(e.contractId)), byId: new Map(keep.map((c) => [c.contractId, c])) };
}

// --- Convenience lookups (each builds the viewer's world once) ----------------------------------------------

export async function listVisibleCaseRefs(db: DbOrTx, viewer: ReadViewer, options: ReadOptions = {}): Promise<string[]> {
  return (await loadReadWorld(db, viewer, options)).cases.map((c) => c.ref);
}

/** Null when the viewer has no stakeholder view of the case and is not its borrower organization. */
export async function loadCaseFacts(db: DbOrTx, viewer: ReadViewer, caseRef: string, options: ReadOptions = {}): Promise<CaseFacts | null> {
  return (await loadReadWorld(db, viewer, options)).cases.find((c) => c.ref === caseRef) ?? null;
}

export async function listCaseFacts(db: DbOrTx, viewer: ReadViewer, options: ReadOptions = {}): Promise<readonly CaseFacts[]> {
  return (await loadReadWorld(db, viewer, options)).cases;
}

export async function listAssets(db: DbOrTx, viewer: ReadViewer, options: ReadOptions = {}): Promise<readonly AssetFacts[]> {
  return (await loadReadWorld(db, viewer, options)).assets;
}

export async function loadAsset(db: DbOrTx, viewer: ReadViewer, assetRef: string, options: ReadOptions = {}): Promise<AssetFacts | null> {
  return (await loadReadWorld(db, viewer, options)).assets.find((a) => a.ref === assetRef) ?? null;
}

export interface VerificationView {
  readonly asset: AssetFacts;
  readonly verification: VerificationFacts;
}

export async function listVerifications(db: DbOrTx, viewer: ReadViewer, options: ReadOptions = {}): Promise<VerificationView[]> {
  const world = await loadReadWorld(db, viewer, options);
  return world.assets.flatMap((asset) => asset.verifications.map((verification) => ({ asset, verification })));
}

export async function loadVerification(db: DbOrTx, viewer: ReadViewer, ref: string, options: ReadOptions = {}): Promise<VerificationView | null> {
  return (await listVerifications(db, viewer, options)).find((v) => v.verification.ref === ref) ?? null;
}

/** Cases with a lender review the viewer can see (lender: its assessments; borrower: the decision notices). */
export async function listReviews(db: DbOrTx, viewer: ReadViewer, options: ReadOptions = {}): Promise<readonly CaseFacts[]> {
  return (await loadReadWorld(db, viewer, options)).cases.filter((c) => c.review.ref !== "");
}

export async function loadReview(db: DbOrTx, viewer: ReadViewer, reviewRef: string, options: ReadOptions = {}): Promise<CaseFacts | null> {
  return (await listReviews(db, viewer, options)).find((c) => c.review.ref === reviewRef) ?? null;
}

export async function listPledges(db: DbOrTx, viewer: ReadViewer, options: ReadOptions = {}): Promise<readonly CaseFacts[]> {
  return (await loadReadWorld(db, viewer, options)).cases.filter((c) => c.lock !== null);
}

export async function loadPledge(db: DbOrTx, viewer: ReadViewer, lockRef: string, options: ReadOptions = {}): Promise<CaseFacts | null> {
  return (await listPledges(db, viewer, options)).find((c) => c.lock?.ref === lockRef) ?? null;
}

export async function loadReleaseRequest(
  db: DbOrTx,
  viewer: ReadViewer,
  ref: string,
  options: ReadOptions = {},
): Promise<{ facts: CaseFacts; request: ReleaseRequestFacts } | null> {
  for (const facts of (await loadReadWorld(db, viewer, options)).cases) {
    const request = facts.releaseRequests.find((r) => r.ref === ref);
    if (request) return { facts, request };
  }
  return null;
}

export interface AuditEventsQuery extends ReadOptions {
  readonly caseRef?: string;
  readonly limit?: number;
}

export interface AuditEventsResult {
  /** Committed ledger events within the viewer's stakeholder scope (the presenters apply audiences). */
  readonly ledger: readonly MappedEvent[];
  /** Operational application events of the viewer's own organization only (never other organizations'). */
  readonly operational: readonly AuditEventRow[];
}

export async function listAuditEvents(db: DbOrTx, viewer: ReadViewer, query: AuditEventsQuery = {}): Promise<AuditEventsResult> {
  const world = await loadReadWorld(db, viewer, query);
  const caseAsset = query.caseRef ? world.cases.find((c) => c.ref === query.caseRef)?.asset.ref : undefined;
  const ledger = world.events.filter((e) => !query.caseRef || e.caseRef === query.caseRef || (caseAsset !== undefined && e.assetRef === caseAsset));
  const operational = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.orgId, viewer.orgId), query.caseRef ? eq(auditEvents.resourceRef, query.caseRef) : undefined))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(query.limit ?? 200);
  return { ledger: ledger.slice(-(query.limit ?? 500)), operational };
}

export async function governanceState(db: DbOrTx, viewer: ReadViewer, options: ReadOptions = {}): Promise<GovernanceFacts | null> {
  return (await loadReadWorld(db, viewer, options)).governance;
}

/** Verifier registry entries from the viewer's view (accreditations, else the registrar's mirrors). */
export async function verifierEntries(db: DbOrTx, viewer: ReadViewer, options: ReadOptions = {}): Promise<VerifierEntry[]> {
  const world = await loadReadWorld(db, viewer, options);
  if (!world.governance) return [];
  return presentVerifierEntries(world.governance, world.assets, { now: world.now, mode: "LOCALNET", sync: world.lastSync });
}
