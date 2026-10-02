// Presenters: (facts, viewer) → DTO. They OMIT what the viewer may not see (terms only for the
// borrower and the selected lender, internal notes only for the lender org, nothing for unrelated
// parties, auditors only within their granted scopes, technical ids only for ledger stakeholders).
// A null result means "unavailable to this account" (404-shaped). The API and the UI_MOCK client
// both call these, so permission semantics cannot diverge (ADR §4).
import { CONFIRMATION_COPY, GOVERNANCE_INTEGRATION_LABELS } from "./copy";
import {
  activationPrerequisites,
  attestationValidity,
  currentAttestation,
  deriveNextAction,
  effectiveProposalState,
  evidenceCompleteness,
  evidenceMatchesAttestation,
  latestDocumentVersion,
  latestProposal,
  latestVerification,
  NEXT_ACTIONS,
  openReleaseRequest,
  pledgeDisplayState,
  reviewSnapshotStale,
} from "./derive";
import {
  AUDIT_SCOPE_LABELS,
  eventTypeMeta,
  type AssetFacts,
  type AttestationFacts,
  type AudienceTag,
  type CaseFacts,
  type EventFacts,
  type EvidenceDocumentFacts,
  type ExportFacts,
  type ProposalVersionFacts,
  type ReleaseRequestFacts,
  type VerificationFacts,
} from "./facts";
import {
  CASE_TABS,
  navigationFor,
  type AccessGrant,
  type AssetDetail,
  type AssetSummary,
  type AssetTab,
  type Attestation,
  type AuditEvent,
  type CaseDetail,
  type DemoPersona,
  type CaseSummary,
  type CaseTab,
  type EvidenceDocument,
  type GovernanceProposal,
  type GovernanceState,
  type Me,
  type OrgRef,
  type Page,
  type PageQuery,
  type Pledge,
  type Proposal,
  type ReleaseRequest,
  type Report,
  type Review,
  type ReviewSummary,
  type SavedView,
  type VerificationRequest,
  type VerifierEntry,
} from "./dto";
import {
  governanceProposalState,
  isOpenGovernanceProposal,
  liveConfirmationSeats,
  seatConfirmationState,
  confirmationExpiry,
  type GovernanceFacts,
  type GovernanceProposalFacts,
} from "./governance";
import { CAPABILITIES } from "./capabilities";
import { moneyRatio } from "./money";
import { assetContext, can, caseContext, type ContextOptions, type EffectiveAuditAccess, type PolicyContext } from "./policy";
import { CREDIT_POLICY_MAX_ADVANCE_PERCENT, formatVersionedRef } from "./refs";
import {
  DEMO_ORGANIZATIONS,
  MANDATE_LABELS,
  ROLE_LABELS,
  actorLine,
  governanceSeatOf,
  orderRoles,
  orgName,
  personaByUserId,
  type Actor,
  type OrgId,
  type Persona,
} from "./roles";
import {
  accessGrantStates,
  activationAuthorizationStates,
  assetLifecycleStates,
  attestationValidityStates,
  caseStages,
  checkResults,
  eventKinds,
  evidenceLedgerStates,
  evidenceReviewStates,
  evidenceScanStates,
  evidenceUploadStates,
  exportJobStates,
  governanceProposalStates,
  integrityStates,
  lockStates,
  OPEN_VERIFICATION_STATES,
  pledgeDisplayStates,
  proposalStates,
  releaseReasons,
  releaseRequestStates,
  reviewStates,
  seatConfirmationStates,
  verificationStates,
  verifierRegistryStates,
  type CaseStage,
  type RuntimeMode,
} from "./states";
import {
  allowedAssetActions,
  allowedCaseActions,
  allowedVerificationActions,
  canViewVerification,
  type CaseAction,
} from "./workflow";

export interface PresentContext extends ContextOptions {
  readonly now: Date;
  readonly mode: RuntimeMode;
  /** Worker checkpoint (LOCALNET). UI_MOCK passes { offset: null, at: null }. */
  readonly sync: { readonly offset: number | null; readonly at: string | null };
  /** userId → display name; defaults to the demo personas. */
  readonly userName?: (userId: string) => string | null;
}

const org = (id: OrgId): OrgRef => ({ id, name: orgName(id) });

/**
 * "CNC machining center · DEMO-CNC-500". Missing parts are left out (never a stray separator); an empty string
 * when the viewer has no equipment identity at all.
 */
export function equipmentSummary(asset: { readonly equipmentClass: string; readonly model: string }): string {
  return [asset.equipmentClass, asset.model].map((part) => part.trim()).filter(Boolean).join(" · ");
}

function userLabel(pctx: PresentContext, userId: string | null): string | null {
  if (!userId) return null;
  const name = pctx.userName?.(userId) ?? personaByUserId(userId)?.displayName ?? null;
  const persona = personaByUserId(userId);
  return name && persona ? `${name} · ${orgName(persona.orgId)}` : name;
}

// --- Disclosure ------------------------------------------------------------------------------------

export interface CaseDisclosure {
  readonly ctx: PolicyContext;
  readonly related: boolean;
  readonly isOwner: boolean;
  readonly isDealer: boolean;
  readonly isVerifier: boolean;
  readonly isLender: boolean;
  readonly audit: EffectiveAuditAccess | null;
  readonly equipment: boolean;
  readonly evidence: boolean;
  /**
   * The viewer sees the whole evidence package (owner, selected lender through its shares, auditor with the
   * evidence-manifest scope). A dealer sees only its own contributions and a verifier only its assignment, so
   * package completeness and the stages derived from it are not theirs to show.
   */
  readonly packageVisible: boolean;
  readonly attestation: boolean;
  readonly internalNotes: boolean;
  readonly terms: boolean;
  readonly history: boolean;
  readonly export: boolean;
  readonly selectedLender: boolean;
  readonly review: boolean;
  readonly pledge: boolean;
  readonly technical: boolean;
  readonly audience: ReadonlySet<AudienceTag>;
}

export function caseDisclosure(facts: CaseFacts, viewer: Actor, pctx: PresentContext): CaseDisclosure {
  const ctx = caseContext(facts, pctx.now, pctx);
  const history = can(viewer, "history.view", ctx);
  const member = (list: readonly OrgId[] | undefined) => history && (list?.includes(viewer.orgId) ?? false);
  const isOwner = member(ctx.ownerOrgIds) && viewer.roles.includes("BORROWER");
  const isDealer = member(ctx.dealerOrgIds) && viewer.roles.includes("DEALER");
  const isVerifier = member(ctx.verifierOrgIds) && viewer.roles.includes("VERIFIER");
  const isLender =
    member(ctx.lenderOrgIds) && (viewer.roles.includes("LENDER_ANALYST") || viewer.roles.includes("LENDER_APPROVER"));
  const rawAudit = viewer.roles.includes("AUDITOR") ? (ctx.auditAccess?.[viewer.orgId] ?? null) : null;
  const audit = rawAudit && rawAudit.scopes.length > 0 ? rawAudit : null;
  const equipment = can(viewer, "equipment.view", ctx);
  const audience = new Set<AudienceTag>();
  if (isOwner) audience.add("OWNER");
  if (isDealer) audience.add("DEALER");
  if (isVerifier) audience.add("VERIFIER");
  if (isLender) audience.add("LENDER");
  if (audit) audience.add("AUDITOR");
  return {
    ctx,
    related: equipment || history,
    isOwner,
    isDealer,
    isVerifier,
    isLender,
    audit,
    equipment,
    evidence: can(viewer, "evidence.view", ctx),
    packageVisible: isOwner || isLender || !!audit?.scopes.includes("EVIDENCE_MANIFEST"),
    attestation: can(viewer, "attestation.view", ctx),
    internalNotes: isLender && can(viewer, "lenderInternal.view", ctx) && viewer.orgId === facts.review.lenderOrgId,
    terms: can(viewer, "terms.view", ctx),
    history,
    export: can(viewer, "report.export", ctx),
    selectedLender: isOwner || isDealer || isLender || !!audit,
    review: isOwner || isLender || !!audit?.scopes.includes("DECISION_OUTCOME"),
    pledge: isOwner || isLender || !!audit?.scopes.includes("PLEDGE_RELEASE_EVENTS"),
    technical: isOwner || isLender,
    audience,
  };
}

// --- Events ------------------------------------------------------------------------------------------

function eventVisible(event: EventFacts, viewer: Actor, d: CaseDisclosure): boolean {
  const meta = eventTypeMeta(event.type);
  if (event.actor.orgId === viewer.orgId && d.related) return true;
  if (meta.audience.some((tag) => tag !== "AUDITOR" && d.audience.has(tag))) return true;
  if (d.audit) {
    if (meta.audience.includes("AUDITOR") || meta.auditScope === "ANY") return true;
    if (meta.auditScope !== "NONE" && d.audit.scopes.includes(meta.auditScope)) return true;
  }
  return false;
}

function presentEvent(event: EventFacts, caseId: string | null, assetRef: string): AuditEvent {
  const meta = eventTypeMeta(event.type);
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    caseId,
    assetRef,
    ref: event.ref,
    type: event.type,
    label: event.detail ? `${meta.summary} · ${event.detail}` : meta.summary,
    actor: event.actor.label,
    stateChange: event.stateChange,
    version: event.version,
    kind: eventKinds.badge(event.kind),
    commit: event.commit,
  };
}

const newestFirst = (a: AuditEvent, b: AuditEvent) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt);

/** Case activity: asset/evidence/verification events plus case events, scoped to the viewer. */
export function presentCaseActivity(facts: CaseFacts, viewer: Actor, pctx: PresentContext): AuditEvent[] | null {
  const d = caseDisclosure(facts, viewer, pctx);
  if (!d.history) return null;
  const assetEvents = facts.asset.events.filter((e) => eventVisible(e, viewer, d)).map((e) => presentEvent(e, null, facts.asset.ref));
  const caseEvents = facts.events.filter((e) => eventVisible(e, viewer, d)).map((e) => presentEvent(e, facts.ref, facts.asset.ref));
  return [...assetEvents, ...caseEvents].sort(newestFirst);
}

// --- Cases ------------------------------------------------------------------------------------------

/** Stages that say nothing about the lender review, proposal, pledge or release. */
const EARLY_STAGES: readonly CaseStage[] = ["DRAFT", "EVIDENCE_COLLECTION", "VERIFICATION", "CANCELLED"];
/** Early stages derived from evidence completeness: only meaningful to a viewer who sees the whole package. */
const PACKAGE_STAGES: readonly CaseStage[] = ["DRAFT", "EVIDENCE_COLLECTION"];

/**
 * The projected stage (and anything derived from it) reveals review, proposal and pledge status, so
 * it is disclosed only to viewers who may see both the review and the pledge (S L775: no credit or
 * loan-term screens for the dealer). A viewer with a partial package (dealer, verifier) would derive
 * "Evidence collection" from the documents it cannot see, so package stages need the whole package.
 */
function stageVisible(stage: CaseStage, d: CaseDisclosure): boolean {
  if (d.review && d.pledge) return true;
  return EARLY_STAGES.includes(stage) && (!PACKAGE_STAGES.includes(stage) || d.packageVisible);
}

/**
 * Verification status for the viewer: the latest request when the viewer may see it, else the attestation the
 * viewer holds (the selected lender sees ATT-001 through its AttestationDisclosure, never the owner↔verifier
 * request itself).
 */
function verificationStatus(asset: AssetFacts, canSeeRequest: boolean, canSeeAttestation: boolean) {
  const verification = latestVerification(asset);
  if (verification && canSeeRequest) return verificationStates.badge(verification.state);
  if (!verification && canSeeAttestation && currentAttestation(asset)) return verificationStates.badge("ATTESTED");
  return null;
}

function savedViews(facts: CaseFacts, isMine: boolean, stage: CaseStage, d: CaseDisclosure): SavedView[] {
  const views: SavedView[] = ["all"];
  if (!stageVisible(stage, d)) return views;
  if (isMine) views.push("mine");
  if (facts.review.state === "SUBMITTED" || facts.review.state === "IN_REVIEW") views.push("ready-for-review");
  if (facts.review.state === "NEEDS_INFORMATION" || stage === "EVIDENCE_COLLECTION") views.push("needs-evidence");
  if (facts.review.state === "PENDING_APPROVAL") views.push("awaiting-approval");
  if (openReleaseRequest(facts)) views.push("release-requests");
  return views;
}

/** Latest event the viewer may see (never leaks the timing of hidden events). */
function lastVisibleUpdate(facts: CaseFacts, viewer: Actor, d: CaseDisclosure): string {
  const times = [
    facts.createdAt,
    ...[...facts.events, ...facts.asset.events].filter((e) => eventVisible(e, viewer, d)).map((e) => e.occurredAt),
  ];
  return times.reduce((max, t) => (Date.parse(t) > Date.parse(max) ? t : max));
}

function viewerIsNextActor(viewer: Actor, actor: { orgId: OrgId; role: string } | null): boolean {
  if (!actor || actor.orgId !== viewer.orgId) return false;
  if (actor.role === "LENDER_ANALYST") return viewer.roles.includes("LENDER_ANALYST") || viewer.roles.includes("LENDER_APPROVER");
  return viewer.roles.includes(actor.role as Actor["roles"][number]);
}

export function presentCaseSummary(facts: CaseFacts, viewer: Actor, pctx: PresentContext): CaseSummary | null {
  const d = caseDisclosure(facts, viewer, pctx);
  if (!d.related) return null;
  const next = deriveNextAction(facts, pctx.now);
  const showStage = stageVisible(next.stage, d);
  // The next actor is shown only when the viewer may know that organization's role in the case.
  const actorVisible =
    showStage &&
    next.nextActor &&
    (next.nextActor.orgId === viewer.orgId ||
      next.nextActor.orgId === facts.borrowerOrgId ||
      (d.selectedLender && next.nextActor.orgId === facts.selectedLenderOrgId) ||
      d.isOwner);
  const nextActor = actorVisible && next.nextActor
    ? { org: org(next.nextActor.orgId), role: next.nextActor.role, label: actorLine(next.nextActor.orgId, next.nextActor.role) }
    : null;
  const isMine = showStage && viewerIsNextActor(viewer, next.nextActor);
  return {
    caseId: facts.ref,
    title: facts.title,
    asset: { ref: facts.asset.ref, equipmentClass: facts.asset.equipmentClass, model: facts.asset.model },
    stage: showStage ? caseStages.badge(next.stage) : null,
    borrower: d.equipment ? org(facts.borrowerOrgId) : null,
    verification: verificationStatus(facts.asset, d.attestation || d.isOwner, d.attestation),
    review: d.review ? reviewStates.badge(facts.review.state) : null,
    pledge: d.pledge ? pledgeDisplayStates.badge(pledgeDisplayState(facts)) : null,
    nextActor,
    // Shown with a visible actor, or when no specific actor is due (e.g. `Export case history`).
    nextAction:
      showStage && next.action && (nextActor || !next.nextActor) ? { code: next.action, label: NEXT_ACTIONS[next.action] } : null,
    isMine,
    views: savedViews(facts, isMine, next.stage, d),
    updatedAt: lastVisibleUpdate(facts, viewer, d),
  };
}

function allowedTabs(d: CaseDisclosure): CaseTab[] {
  const allowed: Record<CaseTab, boolean> = {
    summary: true,
    evidence: d.evidence,
    verification: d.attestation,
    sharing: d.isOwner || d.isDealer || d.isLender,
    review: d.review,
    proposal: d.terms,
    pledge: d.pledge,
    activity: d.history,
  };
  return CASE_TABS.filter((tab) => allowed[tab]);
}

function participants(facts: CaseFacts, viewer: Actor, d: CaseDisclosure): CaseDetail["participants"] {
  const list: { orgId: OrgId; roleLabel: string; show: boolean }[] = [
    { orgId: facts.borrowerOrgId, roleLabel: "Borrower · asset owner", show: true },
    { orgId: facts.dealerOrgId ?? "", roleLabel: "Dealer · contributor", show: !!facts.dealerOrgId && (d.isOwner || d.isDealer || d.isLender) },
    ...[...new Set(facts.asset.attestations.map((a) => a.issuerOrgId))].map((orgId) => ({
      orgId,
      roleLabel: "Verifier",
      show: d.attestation,
    })),
    { orgId: facts.selectedLenderOrgId ?? "", roleLabel: "Selected lender", show: !!facts.selectedLenderOrgId && d.selectedLender },
    ...[...new Set(facts.auditGrants.filter((g) => !g.revokedAt).map((g) => g.auditorOrgId))].map((orgId) => ({
      orgId,
      roleLabel: "Auditor · scoped grant",
      show: d.isOwner || d.isLender || orgId === viewer.orgId,
    })),
  ];
  return list.filter((p) => p.show && p.orgId).map((p) => ({ org: org(p.orgId), roleLabel: p.roleLabel, isViewer: p.orgId === viewer.orgId }));
}

export function presentCaseDetail(facts: CaseFacts, viewer: Actor, pctx: PresentContext): CaseDetail | null {
  const summary = presentCaseSummary(facts, viewer, pctx);
  if (!summary) return null;
  const d = caseDisclosure(facts, viewer, pctx);
  const next = deriveNextAction(facts, pctx.now);
  const attestation = currentAttestation(facts.asset);
  const completeness = evidenceCompleteness(facts.asset);
  const proposal = visibleProposalVersion(facts, d);
  const actions: CaseAction[] = allowedCaseActions(facts, viewer, pctx.now, pctx);
  // Ledger-committed only when the projection carries real commit refs; UI_MOCK never fabricates them.
  const committed = [...facts.events, ...facts.asset.events].some((e) => e.commit !== null);
  return {
    ...summary,
    purpose: facts.purpose,
    selectedLender: d.selectedLender && facts.selectedLenderOrgId ? org(facts.selectedLenderOrgId) : null,
    statuses: {
      evidence:
        d.evidence && d.packageVisible
          ? { complete: completeness.complete, label: completeness.complete ? `Complete · ${facts.asset.package.entries.length} documents` : "Incomplete" }
          : null,
      verification: summary.verification,
      attestation: attestation && d.attestation ? attestationValidityStates.badge(attestationValidity(attestation, pctx.now)) : null,
      review: summary.review,
      proposal: d.terms ? (proposal ? proposalStates.badge(effectiveProposalState(proposal, pctx.now)) : null) : null,
      pledge: summary.pledge,
    },
    currentStep: summary.stage && (summary.nextActor || d.isOwner || d.isLender) ? next.currentStep : summary.stage?.label ?? null,
    blockers: d.isOwner || d.isLender ? [...next.blockers] : [],
    allowedActions: actions,
    allowedTabs: allowedTabs(d),
    prerequisites: d.isOwner || d.isLender ? activationPrerequisites(facts, pctx.now) : null,
    participants: participants(facts, viewer, d),
    references: {
      passport: facts.asset.ref,
      attestation: attestation && d.attestation ? { ref: attestation.ref, validUntil: attestation.validUntil } : null,
      package:
        d.evidence && d.packageVisible && facts.asset.package.ref
          ? { ref: facts.asset.package.ref, version: facts.asset.package.version, documentCount: facts.asset.package.entries.length }
          : null,
      proposal:
        d.terms && proposal
          ? { ref: proposal.ref, version: proposal.version, state: proposalStates.badge(effectiveProposalState(proposal, pctx.now)) }
          : null,
      pledge: d.pledge && facts.lock ? { ref: facts.lock.ref, state: pledgeDisplayStates.badge(pledgeDisplayState(facts)) } : null,
      review: d.review && facts.review.ref ? { ref: facts.review.ref } : null,
    },
    requestedPrincipal: d.terms ? facts.requestedPrincipal : null,
    dataSource: committed ? "LEDGER_COMMITTED" : "APPLICATION_RECORD",
    lastSync: { offset: pctx.sync.offset, at: pctx.sync.at },
    technical: d.technical
      ? { controlVersion: facts.asset.control.version, packageVersion: facts.asset.package.version, namespace: facts.asset.namespace }
      : null,
  };
}

export interface CaseListResult {
  readonly items: CaseSummary[];
  readonly counts: Record<SavedView, number>;
}

/** Lists and counts share the detail view's scope (S L554): unrelated cases are not counted. */
export function presentCaseList(cases: readonly CaseFacts[], viewer: Actor, pctx: PresentContext, view: SavedView = "all"): CaseListResult {
  const summaries = cases
    .map((c) => presentCaseSummary(c, viewer, pctx))
    .filter((s): s is CaseSummary => s !== null)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const counts = { all: 0, mine: 0, "ready-for-review": 0, "needs-evidence": 0, "awaiting-approval": 0, "release-requests": 0 };
  for (const s of summaries) for (const v of s.views) counts[v] += 1;
  return { items: summaries.filter((s) => s.views.includes(view)), counts };
}

// --- Assets and evidence ------------------------------------------------------------------------------

function casesForAsset(asset: AssetFacts, cases: readonly CaseFacts[]) {
  return cases.filter((c) => c.asset.ref === asset.ref);
}

interface AssetDisclosure {
  readonly ctx: PolicyContext;
  readonly related: boolean;
  readonly isOwner: boolean;
  readonly visibleCases: readonly CaseFacts[];
  readonly caseDisclosures: readonly CaseDisclosure[];
  readonly isVerifier: boolean;
}

function assetDisclosure(asset: AssetFacts, cases: readonly CaseFacts[], viewer: Actor, pctx: PresentContext): AssetDisclosure {
  const ctx = assetContext(asset, cases, pctx.now, pctx);
  const related = casesForAsset(asset, cases);
  const caseDisclosures = related.map((c) => caseDisclosure(c, viewer, pctx));
  const visibleCases = related.filter((_, i) => caseDisclosures[i]?.related);
  const isOwner = asset.ownerOrgId === viewer.orgId && viewer.roles.includes("BORROWER");
  const isVerifier = viewer.roles.includes("VERIFIER") && asset.verifications.some((v) => v.verifierOrgId === viewer.orgId);
  return {
    ctx,
    related: isOwner || isVerifier || visibleCases.length > 0,
    isOwner,
    visibleCases,
    caseDisclosures: caseDisclosures.filter((cd) => cd.related),
    isVerifier,
  };
}

function documentVisibleTo(doc: EvidenceDocumentFacts, asset: AssetFacts, viewer: Actor, ad: AssetDisclosure): boolean {
  if (ad.isOwner) return true;
  if (ad.isVerifier && asset.verifications.some((v) => v.verifierOrgId === viewer.orgId && v.documentRefs.includes(doc.ref))) return true;
  return ad.visibleCases.some((c, i) => {
    const d = ad.caseDisclosures[i];
    if (!d) return false;
    if (d.isDealer) return doc.sourceOrgId === viewer.orgId;
    const inShare = c.shares.some((s) => s.entries.some((e) => e.documentRef === doc.ref));
    if (d.isLender) return inShare && c.shares.some((s) => s.recipientOrgId === viewer.orgId);
    return !!d.audit?.scopes.includes("EVIDENCE_MANIFEST") && inShare;
  });
}

function canDownload(doc: EvidenceDocumentFacts, asset: AssetFacts, viewer: Actor, ad: AssetDisclosure, now: Date): boolean {
  if (ad.isOwner) return true;
  if (ad.isVerifier) {
    return asset.verifications.some(
      (v) => v.verifierOrgId === viewer.orgId && v.documentRefs.includes(doc.ref) && OPEN_VERIFICATION_STATES.includes(v.state),
    );
  }
  return ad.visibleCases.some((c, i) => {
    const d = ad.caseDisclosures[i];
    if (d?.isDealer) return doc.sourceOrgId === viewer.orgId;
    if (!d?.isLender) return false;
    return c.shares.some(
      (s) =>
        s.recipientOrgId === viewer.orgId &&
        s.state === "GRANTED" &&
        s.permission === "VIEW_DOWNLOAD" &&
        (s.expiresAt === null || Date.parse(s.expiresAt) > now.getTime()) &&
        s.entries.some((e) => e.documentRef === doc.ref),
    );
  });
}

function sharingScope(doc: EvidenceDocumentFacts, asset: AssetFacts, ad: AssetDisclosure): string[] {
  const scope: string[] = [];
  ad.visibleCases.forEach((c, i) => {
    const d = ad.caseDisclosures[i];
    for (const s of c.shares) {
      if (d?.selectedLender && s.state !== "DECLINED" && s.entries.some((e) => e.documentRef === doc.ref)) {
        scope.push(`${s.packageRef} · ${orgName(s.recipientOrgId)}`);
      }
    }
  });
  const showVerifier = ad.isOwner || ad.isVerifier || ad.caseDisclosures.some((d) => d.isLender || d.attestation);
  if (showVerifier) {
    for (const verifierOrgId of new Set(asset.verifications.filter((v) => v.documentRefs.includes(doc.ref)).map((v) => v.verifierOrgId))) {
      scope.push(orgName(verifierOrgId));
    }
  }
  return [...new Set(scope)];
}

/**
 * A verifier (not the owner) sees only the document versions its assignments grant (VerificationFacts
 * .documentVersions, the request's active VERIFICATION grants). Requests recorded without versions (legacy
 * fixtures) do not narrow anything.
 */
function verifierScopedDocument(doc: EvidenceDocumentFacts, asset: AssetFacts, viewer: Actor, ad: AssetDisclosure): EvidenceDocumentFacts {
  if (ad.isOwner || !ad.isVerifier) return doc;
  const granted = asset.verifications.flatMap((v) =>
    v.verifierOrgId === viewer.orgId && v.documentRefs.includes(doc.ref) && v.documentVersions ? v.documentVersions : [],
  );
  const versions = new Set(granted.filter((e) => e.documentRef === doc.ref).map((e) => e.version));
  const kept = doc.versions.filter((v) => versions.has(v.version));
  return kept.length > 0 && kept.length < doc.versions.length ? { ...doc, versions: kept } : doc;
}

function presentDocument(input: EvidenceDocumentFacts, asset: AssetFacts, viewer: Actor, ad: AssetDisclosure, pctx: PresentContext): EvidenceDocument {
  const doc = verifierScopedDocument(input, asset, viewer, ad);
  const latest = latestDocumentVersion(doc);
  const reviewVisible = ad.isOwner || ad.caseDisclosures.some((d) => d.isLender) || ad.isVerifier;
  return {
    id: doc.ref,
    assetRef: asset.ref,
    type: doc.type,
    title: doc.title,
    mediaSummary: doc.mediaSummary,
    source: org(doc.sourceOrgId),
    uploadedBy: latest.uploadedBy.label,
    version: latest.version,
    uploadedAt: latest.uploadedAt,
    status: evidenceUploadStates.badge(latest.uploadState),
    scanStatus: evidenceScanStates.badge("NOT_SCANNED"),
    integrity: { algorithm: "SHA-256", hash: latest.sha256, state: integrityStates.badge(latest.integrity) },
    review: reviewVisible ? evidenceReviewStates.badge(doc.reviewState) : null,
    ledger: evidenceLedgerStates.badge(doc.ledgerState),
    sharingScope: sharingScope(doc, asset, ad),
    versions: doc.versions.map((v) => ({ version: v.version, uploadedAt: v.uploadedAt })),
    canDownload: latest.uploadState === "AVAILABLE" && canDownload(doc, asset, viewer, ad, pctx.now),
  };
}

export function presentEvidenceList(
  asset: AssetFacts,
  cases: readonly CaseFacts[],
  viewer: Actor,
  pctx: PresentContext,
): EvidenceDocument[] | null {
  const ad = assetDisclosure(asset, cases, viewer, pctx);
  if (!ad.related) return null;
  return asset.documents.filter((doc) => documentVisibleTo(doc, asset, viewer, ad)).map((doc) => presentDocument(doc, asset, viewer, ad, pctx));
}

export function presentEvidenceDocument(
  asset: AssetFacts,
  documentRef: string,
  cases: readonly CaseFacts[],
  viewer: Actor,
  pctx: PresentContext,
): EvidenceDocument | null {
  return presentEvidenceList(asset, cases, viewer, pctx)?.find((doc) => doc.id === documentRef) ?? null;
}

/** Case evidence tab: the case asset's documents visible to the viewer. */
export function presentCaseEvidence(facts: CaseFacts, cases: readonly CaseFacts[], viewer: Actor, pctx: PresentContext): EvidenceDocument[] | null {
  const d = caseDisclosure(facts, viewer, pctx);
  if (!d.related) return null;
  if (!d.evidence) return [];
  return presentEvidenceList(facts.asset, cases, viewer, pctx) ?? [];
}

export function presentAttestation(asset: AssetFacts, attestation: AttestationFacts, pctx: PresentContext): Attestation {
  const titles = new Map(asset.documents.map((doc) => [doc.ref, doc.title]));
  return {
    ref: attestation.ref,
    verificationRef: attestation.verificationRef,
    assetRef: attestation.assetRef,
    issuer: org(attestation.issuerOrgId),
    verifierRegistryRef: attestation.verifierRegistryRef,
    outcome: verificationStates.label("ATTESTED"),
    method: attestation.method,
    inspectedAt: attestation.inspectedAt,
    issuedAt: attestation.issuedAt,
    validFrom: attestation.validFrom,
    validUntil: attestation.validUntil,
    validity: attestationValidityStates.badge(attestationValidity(attestation, pctx.now)),
    checks: attestation.checks.map((c) => ({ item: c.item, finding: c.finding, result: checkResults.badge(c.result) })),
    limitations: attestation.limitations,
    evidencePackage: { ref: attestation.packageRef, version: attestation.packageVersion },
    supportingVersions: attestation.supportingVersions.map((e) => ({
      documentId: e.documentRef,
      title: titles.get(e.documentRef) ?? e.documentRef,
      version: e.version,
    })),
    supersedes: attestation.supersedes,
    supersededBy: attestation.supersededBy,
  };
}

/** The case's current attestation, when the viewer may see attestations. */
export function presentCaseAttestation(facts: CaseFacts, viewer: Actor, pctx: PresentContext): Attestation | null {
  const d = caseDisclosure(facts, viewer, pctx);
  const attestation = currentAttestation(facts.asset);
  return d.attestation && attestation ? presentAttestation(facts.asset, attestation, pctx) : null;
}

export function presentAssetSummary(asset: AssetFacts, cases: readonly CaseFacts[], viewer: Actor, pctx: PresentContext): AssetSummary | null {
  const ad = assetDisclosure(asset, cases, viewer, pctx);
  if (!ad.related) return null;
  const attestation = currentAttestation(asset);
  const seesAttestation = ad.isOwner || ad.isVerifier || ad.caseDisclosures.some((d) => d.attestation);
  const updated = [asset.updatedAt, ...asset.events.map((e) => e.occurredAt)].reduce((max, t) => (Date.parse(t) > Date.parse(max) ? t : max));
  return {
    ref: asset.ref,
    equipmentClass: asset.equipmentClass,
    manufacturer: asset.manufacturer,
    model: asset.model,
    owner: org(asset.ownerOrgId),
    lifecycle: assetLifecycleStates.badge(asset.lifecycle),
    verification: verificationStatus(asset, seesAttestation, seesAttestation),
    attestation: attestation && seesAttestation ? attestationValidityStates.badge(attestationValidity(attestation, pctx.now)) : null,
    updatedAt: updated,
  };
}

export function presentAssetDetail(asset: AssetFacts, cases: readonly CaseFacts[], viewer: Actor, pctx: PresentContext): AssetDetail | null {
  const summary = presentAssetSummary(asset, cases, viewer, pctx);
  if (!summary) return null;
  const ad = assetDisclosure(asset, cases, viewer, pctx);
  const pledgeCase = ad.visibleCases.find((c, i) => c.lock && ad.caseDisclosures[i]?.pledge);
  const seesControl = ad.isOwner || ad.caseDisclosures.some((d) => d.isLender);
  const tabs: Record<AssetTab, boolean> = {
    overview: true,
    evidence: ad.isOwner || ad.isVerifier || ad.caseDisclosures.some((d) => d.evidence),
    verification: summary.attestation !== null || summary.verification !== null,
    cases: ad.visibleCases.length > 0,
    activity: true,
  };
  return {
    ...summary,
    namespace: asset.namespace,
    serialNumber: asset.serialNumber,
    yearOfManufacture: asset.yearOfManufacture,
    ownerClaimSource: ad.isOwner || ad.caseDisclosures.some((d) => d.isLender) ? asset.ownerClaimSource : null,
    locationScope: asset.locationScope,
    passportVersion: asset.passportVersion,
    registeredAt: asset.registeredAt,
    // Package size and version only for viewers who see the whole package (not a dealer's or verifier's slice).
    evidence:
      tabs.evidence && asset.package.ref && (ad.isOwner || ad.caseDisclosures.some((d) => d.packageVisible))
        ? { documentCount: asset.package.entries.length, packageRef: asset.package.ref, packageVersion: asset.package.version }
        : null,
    control: seesControl
      ? {
          state: pledgeDisplayStates.badge(pledgeCase ? pledgeDisplayState(pledgeCase) : "AVAILABLE"),
          // The lock currently holding the control token; historical locks stay on their cases.
          lockRef: asset.control.lockRef,
          version: asset.control.version,
        }
      : null,
    cases: ad.visibleCases.map((c) => ({ caseId: c.ref, title: c.title, stage: presentCaseSummary(c, viewer, pctx)?.stage ?? null })),
    allowedActions: allowedAssetActions(asset, cases, viewer, pctx.now, pctx),
    allowedTabs: (Object.keys(tabs) as AssetTab[]).filter((tab) => tabs[tab]),
  };
}

/** Passport activity: asset, passport, verification and control events only (PDB bug 14). */
export function presentAssetActivity(asset: AssetFacts, cases: readonly CaseFacts[], viewer: Actor, pctx: PresentContext): AuditEvent[] | null {
  const ad = assetDisclosure(asset, cases, viewer, pctx);
  if (!ad.related) return null;
  const ownView = ad.isOwner || ad.isVerifier;
  const assetEvents = asset.events
    .filter((e) => ownView || ad.caseDisclosures.some((d) => eventVisible(e, viewer, d)))
    .map((e) => presentEvent(e, null, asset.ref));
  const controlEvents = ad.visibleCases.flatMap((c, i) => {
    const d = ad.caseDisclosures[i];
    if (!d) return [];
    return c.events
      .filter((e) => (e.type === "PLEDGE_ACTIVATED" || e.type === "RELEASE_AUTHORIZED") && eventVisible(e, viewer, d))
      .map((e) => presentEvent(e, c.ref, asset.ref));
  });
  return [...assetEvents, ...controlEvents].sort(newestFirst);
}

// --- Verification ----------------------------------------------------------------------------------

export function presentVerification(
  asset: AssetFacts,
  verification: VerificationFacts,
  viewer: Actor,
  pctx: PresentContext,
): VerificationRequest | null {
  if (!canViewVerification(asset, verification, viewer)) return null;
  const attestation = verification.attestationRef ? asset.attestations.find((a) => a.ref === verification.attestationRef) : undefined;
  return {
    ref: verification.ref,
    assetRef: asset.ref,
    equipmentSummary: equipmentSummary(asset),
    caseId: verification.caseRef,
    verifier: org(verification.verifierOrgId),
    verifierRegistryRef: verification.verifierRegistryRef,
    requester: org(verification.requestedByOrgId),
    scope: verification.scope,
    state: verificationStates.badge(verification.state),
    evidencePackage: { ref: asset.package.ref, version: verification.packageVersion },
    documentIds: verification.documentRefs,
    ...(verification.documentVersions
      ? { assignedVersions: verification.documentVersions.map((e) => ({ documentId: e.documentRef, version: e.version })) }
      : {}),
    dueAt: verification.dueAt,
    requestedAt: verification.requestedAt,
    updatedAt: verification.updatedAt,
    lastMessage: verification.lastMessage,
    attestation: attestation ? presentAttestation(asset, attestation, pctx) : null,
    allowedActions: allowedVerificationActions(asset, verification, viewer, pctx.now, pctx),
  };
}

// --- Review --------------------------------------------------------------------------------------

export function presentReview(facts: CaseFacts, viewer: Actor, pctx: PresentContext): Review | null {
  const d = caseDisclosure(facts, viewer, pctx);
  if (!d.review) return null;
  const review = facts.review;
  const attestation = currentAttestation(facts.asset);
  const valuation = review.assessment?.valuation ?? null;
  const lenderView = d.isLender;
  const decisionOutcome = review.decision ? reviewStates.badge(review.decision.outcome) : null;
  return {
    ref: review.ref,
    caseId: facts.ref,
    equipmentSummary: equipmentSummary(facts.asset),
    state: reviewStates.badge(review.state),
    lender: org(review.lenderOrgId),
    analyst: lenderView ? userLabel(pctx, review.analystUserId) : null,
    approver: lenderView || d.isOwner ? userLabel(pctx, review.approverUserId) : null,
    evidenceSnapshot:
      lenderView && review.snapshotPackageVersion !== null
        ? {
            package: { ref: facts.asset.package.ref, version: review.snapshotPackageVersion },
            matchesAttested: evidenceMatchesAttestation(facts.asset, attestation),
            stale: reviewSnapshotStale(facts),
          }
        : null,
    attestationValidity: attestation && d.attestation ? attestationValidityStates.badge(attestationValidity(attestation, pctx.now)) : null,
    // The assessment (valuation, limitations) is a lender-only record (CollateralAssessment, S: lender).
    assessment:
      lenderView && review.assessment
        ? {
            valuation: review.assessment.valuation,
            valuationSource: review.assessment.valuationSource,
            valuationDate: review.assessment.valuationDate,
            limitations: review.assessment.limitations,
            outcome: reviewStates.badge(review.assessment.outcome),
            policyRef: review.assessment.policyRef,
            version: review.assessment.version,
            savedAt: review.assessment.savedAt,
            requiredExternalChecks: review.assessment.requiredExternalChecks,
          }
        : null,
    derived:
      lenderView && d.terms
        ? {
            requestedPrincipal: facts.requestedPrincipal,
            principalToValuation: moneyRatio(facts.requestedPrincipal, valuation)?.display ?? null,
            policyMaximum: `${CREDIT_POLICY_MAX_ADVANCE_PERCENT}%`,
          }
        : null,
    internalNotes: d.internalNotes ? review.internalNotes : null,
    sharedFeedback: lenderView || d.isOwner ? review.sharedFeedback : null,
    informationRequest: lenderView || d.isOwner ? review.informationRequest : null,
    decision:
      review.decision && decisionOutcome
        ? { outcome: decisionOutcome, decidedAt: review.decision.decidedAt, decidedBy: userLabel(pctx, review.decision.decidedByUserId) ?? orgName(review.lenderOrgId) }
        : null,
    allowedActions: allowedCaseActions(facts, viewer, pctx.now, pctx).filter((a) => a.startsWith("review.")),
    updatedAt: lastVisibleUpdate(facts, viewer, d),
  };
}

export function presentReviewSummary(facts: CaseFacts, viewer: Actor, pctx: PresentContext): ReviewSummary | null {
  const d = caseDisclosure(facts, viewer, pctx);
  if (!d.isLender) return null;
  const summary = presentCaseSummary(facts, viewer, pctx);
  const attestation = currentAttestation(facts.asset);
  return {
    ref: facts.review.ref,
    caseId: facts.ref,
    equipmentSummary: equipmentSummary(facts.asset),
    evidenceComplete: evidenceCompleteness(facts.asset).complete,
    attestationValidity: attestation ? attestationValidityStates.badge(attestationValidity(attestation, pctx.now)) : null,
    requestedPrincipal: d.terms ? facts.requestedPrincipal : null,
    state: reviewStates.badge(facts.review.state),
    analyst: userLabel(pctx, facts.review.analystUserId),
    views: summary?.views ?? ["all"],
    updatedAt: summary?.updatedAt ?? facts.createdAt,
  };
}

// --- Proposal --------------------------------------------------------------------------------------

/** Drafts are lender-internal; counterparties only ever see issued versions. */
function visibleProposalVersion(facts: CaseFacts, d: CaseDisclosure): ProposalVersionFacts | null {
  if (!d.terms) return null;
  const versions = d.isLender ? facts.proposals : facts.proposals.filter((p) => p.state !== "DRAFT");
  return [...versions].sort((a, b) => a.version - b.version).at(-1) ?? null;
}

export function presentProposal(facts: CaseFacts, viewer: Actor, pctx: PresentContext): Proposal | null {
  const d = caseDisclosure(facts, viewer, pctx);
  const current = visibleProposalVersion(facts, d);
  if (!current) return null;
  const versions = (d.isLender ? facts.proposals : facts.proposals.filter((p) => p.state !== "DRAFT")).filter((p) => p.ref === current.ref);
  const activation = facts.activation && facts.activation.proposalRef === current.ref ? facts.activation : null;
  const latest = latestProposal(facts);
  return {
    ref: current.ref,
    version: current.version,
    caseId: facts.ref,
    assetRef: facts.asset.ref,
    state: proposalStates.badge(effectiveProposalState(current, pctx.now)),
    lender: org(current.lenderOrgId),
    borrower: org(facts.borrowerOrgId),
    principal: current.principal,
    termMetadata: current.termMetadata,
    financingRef: current.financingRef,
    externalLegalRef: current.externalLegalRef,
    expiresAt: current.expiresAt,
    approver: userLabel(pctx, current.issuedByUserId),
    issuedAt: current.issuedAt,
    respondedAt: current.respondedAt,
    respondedBy: userLabel(pctx, current.respondedByUserId),
    versions: versions
      .sort((a, b) => b.version - a.version)
      .map((p) => ({ version: p.version, state: proposalStates.badge(effectiveProposalState(p, pctx.now)), issuedAt: p.issuedAt, note: p.note })),
    activation: activation
      ? {
          state: activationAuthorizationStates.badge(
            activation.state === "AUTHORIZED" && pctx.now.getTime() > Date.parse(activation.expiresAt) ? "EXPIRED" : activation.state,
          ),
          authorizedAt: activation.authorizedAt,
          expiresAt: activation.expiresAt,
          proposalVersion: activation.proposalVersion,
        }
      : null,
    allowedActions:
      latest && (d.isLender || latest.state !== "DRAFT")
        ? allowedCaseActions(facts, viewer, pctx.now, pctx).filter((a) => a.startsWith("proposal.") || a === "activation.authorize" || a === "pledge.activate")
        : [],
  };
}

// --- Pledge and release ------------------------------------------------------------------------------

/** `notes`: the viewer is the lock's owner or designated lender (release notes and Q&A are theirs only). */
function presentReleaseRequest(rr: ReleaseRequestFacts, pctx: PresentContext, notes: boolean): ReleaseRequest {
  const decided = rr.state === "AUTHORIZED" || rr.state === "REJECTED";
  return {
    ref: rr.ref,
    pledgeRef: rr.lockRef,
    state: releaseRequestStates.badge(rr.state),
    reason: releaseReasons.badge(rr.reason),
    note: notes ? rr.note : null,
    servicingRef: notes ? rr.servicingRef : null,
    requestedBy: userLabel(pctx, rr.requestedByUserId) ?? orgName(rr.requestedByOrgId),
    requestedAt: rr.requestedAt,
    informationRequest: notes ? rr.informationRequest : null,
    thread: notes
      ? [...(rr.thread ?? [])]
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
          .map((e) => ({ kind: e.kind, body: e.body, author: org(e.authorOrgId), by: userLabel(pctx, e.authorUserId), at: e.at }))
      : [],
    decision:
      decided && rr.decidedAt
        ? {
            outcome: releaseRequestStates.badge(rr.state),
            decidedAt: rr.decidedAt,
            decidedBy: userLabel(pctx, rr.decidedByUserId) ?? "",
            reason: rr.decisionReason,
          }
        : null,
  };
}

export function presentPledge(facts: CaseFacts, viewer: Actor, pctx: PresentContext): Pledge | null {
  const d = caseDisclosure(facts, viewer, pctx);
  const lock = facts.lock;
  if (!lock || !d.pledge) return null;
  const parties = d.isOwner || d.isLender || !!d.audit;
  return {
    ref: lock.ref,
    caseId: facts.ref,
    assetRef: facts.asset.ref,
    state: pledgeDisplayStates.badge(pledgeDisplayState(facts)),
    lockState: lockStates.badge(lock.state),
    lender: parties ? org(lock.lenderOrgId) : null,
    borrower: parties ? org(lock.borrowerOrgId) : null,
    principalRef: d.terms ? formatVersionedRef(lock.proposalRef, lock.proposalVersion) : null,
    activatedAt: lock.activatedAt,
    releasedAt: lock.releasedAt,
    activation: {
      authorizedBy: [
        `${orgName(lock.borrowerOrgId)} (borrower mandate)`,
        `${orgName(lock.lenderOrgId)} (approver mandate)`,
      ],
      proposal: { ref: lock.proposalRef, version: lock.proposalVersion },
      attestationRef: lock.attestationRef,
      evidencePackage: { ref: lock.packageRef, version: lock.packageVersion },
    },
    releaseRequests: [...facts.releaseRequests]
      .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
      .map((rr) => presentReleaseRequest(rr, pctx, d.isOwner || d.isLender)),
    technical: d.technical
      ? {
          controlVersionConsumed: lock.controlVersionConsumed,
          controlVersionLocked: lock.controlVersionLocked,
          controlVersionAfterRelease: lock.controlVersionAfterRelease,
          controlState: facts.asset.control.state,
        }
      : null,
    allowedActions: allowedCaseActions(facts, viewer, pctx.now, pctx).filter((a) => a.startsWith("release.")),
  };
}

// --- Sharing and access grants ------------------------------------------------------------------------

export function presentAccessGrants(facts: CaseFacts, viewer: Actor, pctx: PresentContext): AccessGrant[] | null {
  const d = caseDisclosure(facts, viewer, pctx);
  if (!d.related) return null;
  const now = pctx.now.getTime();
  const grants: AccessGrant[] = [];
  for (const s of facts.shares) {
    const visible = d.isOwner || (d.isDealer && s.consentingOrgIds.includes(viewer.orgId)) || (d.isLender && s.recipientOrgId === viewer.orgId);
    if (!visible) continue;
    const expired = s.state === "GRANTED" && s.expiresAt !== null && Date.parse(s.expiresAt) <= now;
    grants.push({
      id: s.ref,
      kind: "PACKAGE_SHARE",
      caseId: facts.ref,
      recipient: org(s.recipientOrgId),
      purpose: "Lender review",
      scope: `${formatVersionedRef(s.packageRef, s.packageVersion)} · ${s.entries.length} documents · loan terms`,
      auditScopes: null,
      permission: s.permission,
      includesTerms: true,
      state: accessGrantStates.badge(expired ? "EXPIRED" : s.state),
      expiresAt: s.expiresAt,
      consentingParties: s.consentingOrgIds.map(org),
      createdAt: s.createdAt,
      canRevoke: d.isOwner && s.state === "GRANTED" && !expired,
    });
  }
  if (d.isOwner || d.isVerifier) {
    for (const v of facts.asset.verifications) {
      if (d.isVerifier && v.verifierOrgId !== viewer.orgId) continue;
      const ended = v.state === "DECLINED" || v.state === "CANCELLED" ? "REVOKED" : "EXPIRED";
      grants.push({
        id: `verification:${v.ref}`,
        kind: "VERIFICATION_SCOPE",
        caseId: facts.ref,
        recipient: org(v.verifierOrgId),
        purpose: "Verification scope",
        // The verifier's own ledger view names the package version, not its documents: no count rather than "0".
        scope: v.documentRefs.length > 0 ? `Assigned evidence · ${v.documentRefs.length} documents · no loan terms` : "Assigned evidence · no loan terms",
        auditScopes: null,
        permission: "VIEW",
        includesTerms: false,
        // Document access lasts while the assignment is open ("Until attestation issued").
        state: accessGrantStates.badge(OPEN_VERIFICATION_STATES.includes(v.state) ? "GRANTED" : ended),
        expiresAt: null,
        consentingParties: [org(v.requestedByOrgId)],
        createdAt: v.requestedAt,
        canRevoke: false,
      });
    }
  }
  for (const g of facts.auditGrants) {
    const visible = g.grantorOrgId === viewer.orgId || g.auditorOrgId === viewer.orgId || d.isOwner || d.isLender;
    if (!visible) continue;
    const expired = !g.revokedAt && Date.parse(g.expiresAt) <= now;
    grants.push({
      id: g.ref,
      kind: "AUDIT",
      caseId: facts.ref,
      recipient: org(g.auditorOrgId),
      purpose: g.purpose,
      scope: `${facts.ref} history · ${g.scopes.map((s) => AUDIT_SCOPE_LABELS[s].toLowerCase()).join(", ")}`,
      auditScopes: g.scopes,
      permission: g.permission,
      includesTerms: g.scopes.includes("PROPOSAL_TERMS"),
      state: accessGrantStates.badge(g.revokedAt ? "REVOKED" : expired ? "EXPIRED" : "GRANTED"),
      expiresAt: g.expiresAt,
      consentingParties: [org(g.grantorOrgId)],
      createdAt: g.createdAt,
      canRevoke: g.grantorOrgId === viewer.orgId && !g.revokedAt && !expired,
    });
  }
  return grants;
}

// --- Reports ----------------------------------------------------------------------------------------

export function presentReport(exp: ExportFacts, viewer: Actor, pctx: PresentContext): Report | null {
  if (exp.requestedByOrgId !== viewer.orgId) return null;
  const expired = exp.state === "READY" && exp.expiresAt !== null && Date.parse(exp.expiresAt) <= pctx.now.getTime();
  return {
    ref: exp.ref,
    caseId: exp.caseRef,
    format: exp.format,
    schemaVersion: exp.schemaVersion,
    scope: exp.scopeLabel,
    requestedBy: userLabel(pctx, exp.requestedByUserId) ?? orgName(exp.requestedByOrgId),
    state: exportJobStates.badge(expired ? "EXPIRED" : exp.state),
    requestedAt: exp.requestedAt,
    generatedAt: exp.generatedAt,
    cutoff: exp.cutoff,
    checksum: exp.checksum,
    label: CONFIRMATION_COPY.REPORT_LABEL,
    expiresAt: exp.expiresAt,
  };
}

/**
 * Report content: built only from presenters, so it can never contain more than the requester
 * may see at generation time. Access is re-checked again at download.
 */
export function buildCaseReport(facts: CaseFacts, cases: readonly CaseFacts[], viewer: Actor, pctx: PresentContext) {
  const detail = presentCaseDetail(facts, viewer, pctx);
  if (!detail) return null;
  return {
    label: CONFIRMATION_COPY.REPORT_LABEL,
    case: {
      caseId: detail.caseId,
      title: detail.title,
      asset: detail.asset,
      stage: detail.stage?.value ?? null,
      borrower: detail.borrower,
      selectedLender: detail.selectedLender,
    },
    evidenceManifest: presentCaseEvidence(facts, cases, viewer, pctx)?.map((doc) => ({
      id: doc.id,
      title: doc.title,
      version: doc.version,
      sha256: doc.integrity.hash,
      source: doc.source.name,
    })),
    attestation: presentCaseAttestation(facts, viewer, pctx),
    review: (() => {
      const review = presentReview(facts, viewer, pctx);
      return review ? { state: review.state.value, decision: review.decision } : null;
    })(),
    proposal: (() => {
      const proposal = presentProposal(facts, viewer, pctx);
      return proposal ? { ref: proposal.ref, version: proposal.version, state: proposal.state.value, principal: proposal.principal } : null;
    })(),
    pledge: (() => {
      const pledge = presentPledge(facts, viewer, pctx);
      return pledge ? { ref: pledge.ref, state: pledge.state.value, activatedAt: pledge.activatedAt, releasedAt: pledge.releasedAt } : null;
    })(),
    accessScope: presentAccessGrants(facts, viewer, pctx)?.map((g) => ({ recipient: g.recipient.name, scope: g.scope, state: g.state.value })),
    events: presentCaseActivity(facts, viewer, pctx),
  };
}

// --- Verifier registry and governance ------------------------------------------------------------------

export function presentVerifierEntries(gov: GovernanceFacts, assets: readonly AssetFacts[], pctx: PresentContext): VerifierEntry[] {
  const entries: VerifierEntry[] = gov.verifiers.map((v) => {
    const verifications = assets.flatMap((a) => a.verifications).filter((r) => r.verifierRegistryRef === v.ref);
    const pending = gov.proposals.find(
      (p) => p.target.verifierRef === v.ref && isOpenGovernanceProposal(governanceProposalState(p, gov, pctx.now)),
    );
    return {
      ref: v.ref,
      orgName: v.orgName,
      status: verifierRegistryStates.badge(v.status),
      scope: v.scope,
      since: v.since,
      via: v.via,
      activeAssignments: verifications.filter((r) => r.state === "IN_REVIEW" || r.state === "REQUESTED" || r.state === "CHANGES_REQUESTED").length,
      attestationsIssued: assets.flatMap((a) => a.attestations).filter((a) => a.verifierRegistryRef === v.ref).length,
      pendingProposal: pending
        ? { ref: pending.ref, type: pending.type, confirmations: liveConfirmationSeats(pending, gov, pctx.now).length }
        : null,
    };
  });
  // A re-accreditation (Add for a ref already in the registry, e.g. after a suspension) stays one entry; its
  // pendingProposal above shows the open Add.
  const known = new Set(gov.verifiers.map((v) => v.ref));
  const proposedAdds: VerifierEntry[] = gov.proposals
    .filter((p) => p.type === "ADD_VERIFIER" && !known.has(p.target.verifierRef) && isOpenGovernanceProposal(governanceProposalState(p, gov, pctx.now)))
    .map((p) => ({
      ref: p.target.verifierRef,
      orgName: p.target.orgName,
      status: verifierRegistryStates.badge("PROPOSED"),
      scope: p.target.scope,
      since: null,
      via: p.ref,
      activeAssignments: 0,
      attestationsIssued: 0,
      pendingProposal: { ref: p.ref, type: p.type, confirmations: liveConfirmationSeats(p, gov, pctx.now).length },
    }));
  return [...entries, ...proposedAdds];
}

export function presentGovernanceState(gov: GovernanceFacts, viewer: Actor, pctx: PresentContext): GovernanceState {
  const states = gov.proposals.map((p) => governanceProposalState(p, gov, pctx.now));
  const seat = governanceSeatOf(viewer);
  return {
    integration: {
      status: gov.integration,
      label: GOVERNANCE_INTEGRATION_LABELS[gov.integration],
      capability: CAPABILITIES.find((c) => c.id === "dm-integration")?.statuses[0] ?? "PLANNED",
    },
    threshold: gov.threshold,
    seats: gov.seats.map((s) => ({ seat: s.seat, org: org(s.orgId), memberRef: s.memberRef, mandateLabel: s.mandateLabel, since: s.since })),
    viewerSeat: seat && gov.seats.some((s) => s.seat === seat && s.orgId === viewer.orgId) ? seat : null,
    registryVersion: gov.registryVersion,
    proposalDeadlineDays: gov.proposalDeadlineDays,
    confirmationTimeoutHours: gov.confirmationTimeoutHours,
    counts: {
      activeVerifiers: gov.verifiers.filter((v) => v.status === "ACTIVE").length,
      suspendedVerifiers: gov.verifiers.filter((v) => v.status === "SUSPENDED").length,
      openProposals: states.filter(isOpenGovernanceProposal).length,
    },
  };
}

export function presentGovernanceProposal(
  proposal: GovernanceProposalFacts,
  gov: GovernanceFacts,
  viewer: Actor,
  pctx: PresentContext,
): GovernanceProposal {
  const state = governanceProposalState(proposal, gov, pctx.now);
  const live = liveConfirmationSeats(proposal, gov, pctx.now);
  const seat = governanceSeatOf(viewer);
  const isMember = seat !== null && gov.seats.some((s) => s.seat === seat && s.orgId === viewer.orgId) && can(viewer, "governance.act");
  const actions: GovernanceProposal["allowedActions"] = [];
  if (isMember && seat !== null) {
    if (state === "OPEN" || state === "EXECUTABLE") {
      if (!live.includes(seat)) actions.push("confirm");
      if (proposal.proposerSeat === seat) actions.push("cancel");
    }
    if (state === "EXECUTABLE") actions.push("execute");
  }
  const proposerSeat = gov.seats.find((s) => s.seat === proposal.proposerSeat);
  return {
    ref: proposal.ref,
    type: proposal.type,
    typeLabel: proposal.type === "ADD_VERIFIER" ? "Add verifier" : "Suspend verifier",
    target: proposal.target,
    proposer: { seat: proposal.proposerSeat, org: org(proposerSeat?.orgId ?? "") },
    rationale: proposal.rationale,
    effect: proposal.effect,
    openedAt: proposal.openedAt,
    deadlineAt: proposal.deadlineAt,
    expectedRegistryVersion: proposal.expectedRegistryVersion,
    state: governanceProposalStates.badge(state),
    threshold: gov.threshold,
    liveConfirmations: live.length,
    confirmations: gov.seats.map((s) => {
      const latest = proposal.confirmations.filter((c) => c.seat === s.seat).sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt))[0];
      return {
        seat: s.seat,
        org: org(s.orgId),
        state: seatConfirmationStates.badge(seatConfirmationState(proposal, gov, s.seat, pctx.now)),
        confirmedAt: latest?.confirmedAt ?? null,
        expiresAt: latest ? confirmationExpiry(gov, latest.confirmedAt) : null,
      };
    }),
    executedAt: proposal.executedAt,
    executedBySeat: proposal.executedBySeat,
    cancelledAt: proposal.cancelledAt,
    allowedActions: actions,
  };
}

// --- Session ------------------------------------------------------------------------------------------

export function presentMe(persona: Persona, mode: RuntimeMode, options: { demo?: boolean } = {}): Me {
  const roles = orderRoles(persona.roles);
  return {
    user: { id: persona.userId, email: persona.email, displayName: persona.displayName, title: persona.title },
    org: { id: persona.orgId, name: orgName(persona.orgId), type: DEMO_ORGANIZATIONS[persona.orgId]?.type ?? "BORROWER" },
    roles,
    roleLabels: roles.map((role) => ROLE_LABELS[role]),
    mandates: [...persona.mandates],
    governanceSeat: persona.mandates.find((m) => m.code === "GOVERNANCE_SEAT")?.seat ?? null,
    mode,
    personaId: options.demo === false ? null : persona.id,
    navigation: navigationFor(persona),
  };
}

export function personaSummary(persona: Persona): DemoPersona {
  return {
    id: persona.id,
    displayName: persona.displayName,
    title: persona.title,
    org: org(persona.orgId),
    roleLabels: orderRoles(persona.roles).map((role) => ROLE_LABELS[role]),
    mandateLabels: persona.mandates.map((m) => m.label ?? MANDATE_LABELS[m.code]),
  };
}

// --- Pagination (stable offset cursors for in-memory lists; the API uses keyset cursors) ---------------

export function paginate<T>(items: readonly T[], query: PageQuery = {}, defaultLimit = 50): Page<T> {
  const limit = query.limit ?? defaultLimit;
  const offset = query.cursor?.startsWith("o:") ? Number.parseInt(query.cursor.slice(2), 10) || 0 : 0;
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  return { items: [...slice], nextCursor: nextOffset < items.length ? `o:${nextOffset}` : null };
}
