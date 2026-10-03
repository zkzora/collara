// Server-side action evaluation: policy (who) + workflow preconditions (when). The API runs these
// before submitting a command, the UI_MOCK client before mutating fixtures, and presenters use
// them to compute `allowedActions`. The ledger still enforces the invariants on its own (ADR §2.3).
import { COMMAND_COPY, ERROR_COPY, STATUS_COPY } from "./copy";
import {
  acceptedProposal,
  attestationValidity,
  currentAttestation,
  effectiveProposalState,
  evidenceCompleteness,
  evidenceMatchesAttestation,
  latestProposal,
  openReleaseRequest,
  openVerification,
  reviewSnapshotStale,
  usableActivation,
} from "./derive";
import type { AssetFacts, AuditScope, CaseFacts, ConsentFacts, ExportFacts, VerificationFacts } from "./facts";
import type { ConsentState } from "./states";
import {
  assetContext,
  can,
  caseContext,
  isRelated,
  type ContextOptions,
  type PolicyAction,
  type PolicyContext,
} from "./policy";
import { hasMandate, type Actor } from "./roles";

export const CASE_ACTIONS = [
  "evidence.upload",
  "verification.request",
  "sharing.share",
  "sharing.revoke",
  "review.saveAssessment",
  "review.requestInformation",
  "review.submitForApproval",
  "review.decide",
  "proposal.draft",
  "proposal.issue",
  "proposal.withdraw",
  "proposal.accept",
  "proposal.decline",
  "activation.authorize",
  "pledge.activate",
  "release.request",
  "release.requestInformation",
  "release.respond",
  "release.authorize",
  "release.reject",
  "release.withdraw",
  "auditGrant.create",
  "auditGrant.revoke",
  "report.export",
] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];

export const VERIFICATION_ACTIONS = [
  "verification.acceptAssignment",
  "verification.declineAssignment",
  "verification.requestChanges",
  "verification.submitEvidence",
  "verification.issueAttestation",
  "verification.reject",
] as const;
export type VerificationAction = (typeof VERIFICATION_ACTIONS)[number];

export const ASSET_ACTIONS = ["evidence.upload", "verification.request", "case.create"] as const;
export type AssetAction = (typeof ASSET_ACTIONS)[number];

/** INFERRED copy (needs approval): case creation refusals, shared by the API and the UI_MOCK client. */
export const CASE_CREATE_COPY = {
  NOT_REGISTERED: "Register the asset before creating a case.",
  ACTIVE_CASE: "This asset already has an active case workflow.",
} as const;

/** One case workflow per asset: a case holds its asset until it is cancelled, closed, released or rejected. */
export function caseHoldsAsset(facts: CaseFacts): boolean {
  return !facts.cancelledAt && !facts.closedAt && facts.lock?.state !== "RELEASED" && facts.review.state !== "REJECTED";
}

const CASE_ACTION_POLICY: Readonly<Record<CaseAction, PolicyAction>> = {
  "evidence.upload": "evidence.upload",
  "verification.request": "verification.request",
  "sharing.share": "sharing.approve",
  "sharing.revoke": "sharing.approve",
  "review.saveAssessment": "review.assess",
  "review.requestInformation": "review.assess",
  "review.submitForApproval": "review.submitForApproval",
  "review.decide": "review.decide",
  "proposal.draft": "proposal.draft",
  "proposal.issue": "proposal.issue",
  "proposal.withdraw": "proposal.issue",
  "proposal.accept": "proposal.respond",
  "proposal.decline": "proposal.respond",
  "activation.authorize": "activation.authorize",
  "pledge.activate": "pledge.activate",
  "release.request": "release.request",
  "release.requestInformation": "release.decide",
  "release.respond": "release.request",
  "release.authorize": "release.decide",
  "release.reject": "release.decide",
  "release.withdraw": "release.request",
  "auditGrant.create": "auditGrant.create",
  "auditGrant.revoke": "auditGrant.create",
  "report.export": "report.export",
};

/** Actions the API permits but the MVP UI does not expose (lender-initiated release is P1, CR-19). */
const UI_DEFERRED: ReadonlySet<CaseAction> = new Set(["release.request"]);

export type ActionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "UNAVAILABLE" | "FORBIDDEN" | "CONFLICT"; readonly message: string };

const OK: ActionCheck = { ok: true };
const unavailable: ActionCheck = { ok: false, reason: "UNAVAILABLE", message: ERROR_COPY.UNAVAILABLE };
const conflict = (message: string = COMMAND_COPY.STATE_CHANGED): ActionCheck => ({ ok: false, reason: "CONFLICT", message });

const RELEASE_DECISIONS: ReadonlySet<string> = new Set(["release.requestInformation", "release.authorize", "release.reject"]);

function forbidden(action: string): ActionCheck {
  const message = RELEASE_DECISIONS.has(action) ? ERROR_COPY.RELEASE_UNAUTHORIZED : ERROR_COPY.FORBIDDEN;
  return { ok: false, reason: "FORBIDDEN", message };
}

function activeShare(facts: CaseFacts, now: Date) {
  return facts.shares.find(
    (s) =>
      s.recipientOrgId === facts.selectedLenderOrgId &&
      s.state === "GRANTED" &&
      (s.expiresAt === null || Date.parse(s.expiresAt) > now.getTime()),
  );
}

function casePrecondition(facts: CaseFacts, action: CaseAction, actor: Actor, now: Date, options: ContextOptions): ActionCheck {
  const review = facts.review;
  const proposal = latestProposal(facts);
  const proposalState = proposal ? effectiveProposalState(proposal, now) : null;
  const attestation = currentAttestation(facts.asset);
  const attestationValid = !!attestation && attestationValidity(attestation, now) === "VALID";
  const rr = openReleaseRequest(facts);
  const lockActive = facts.lock?.state === "ACTIVE";

  switch (action) {
    case "evidence.upload":
      return facts.asset.lifecycle === "ARCHIVED" ? conflict() : OK;
    case "verification.request":
      return openVerification(facts.asset) ? conflict() : OK;
    case "sharing.share":
      if (!facts.selectedLenderOrgId || activeShare(facts, now)) return conflict();
      if (review.state !== "NOT_SUBMITTED") return conflict();
      return evidenceCompleteness(facts.asset).complete ? OK : conflict(STATUS_COPY.EVIDENCE_MISSING);
    case "sharing.revoke":
      return activeShare(facts, now) ? OK : conflict();
    case "review.saveAssessment":
      if (!activeShare(facts, now)) return conflict(STATUS_COPY.ACCESS_REVOKED);
      return ["SUBMITTED", "IN_REVIEW", "NEEDS_INFORMATION"].includes(review.state) ? OK : conflict();
    case "review.requestInformation":
      return review.state === "IN_REVIEW" || review.state === "PENDING_APPROVAL" ? OK : conflict();
    case "review.submitForApproval":
      if (review.state !== "IN_REVIEW") return conflict();
      return review.assessment ? OK : conflict("Save the assessment before submitting it for approval.");
    case "review.decide":
      if (review.state !== "IN_REVIEW" && review.state !== "PENDING_APPROVAL") return conflict();
      if (!review.assessment) return conflict("Save the assessment before recording a decision.");
      return reviewSnapshotStale(facts) ? conflict(STATUS_COPY.EVIDENCE_STALE) : OK;
    case "proposal.draft":
    case "proposal.issue":
      if (review.state !== "ELIGIBLE" || facts.lock) return conflict();
      if (proposalState === "ISSUED" || proposalState === "ACCEPTED") return conflict();
      return action === "proposal.draft" && proposalState === "DRAFT" ? conflict() : OK;
    case "proposal.withdraw":
      return proposalState === "ISSUED" ? OK : conflict();
    case "proposal.accept":
    case "proposal.decline":
      return proposalState === "ISSUED" ? OK : conflict();
    case "activation.authorize": {
      const accepted = acceptedProposal(facts);
      if (!accepted || facts.lock || facts.asset.control.state !== "AVAILABLE") return conflict();
      if (usableActivation(facts, now)) return conflict();
      return attestationValid ? OK : conflict(STATUS_COPY.ATTESTATION_EXPIRED);
    }
    case "pledge.activate": {
      if (facts.lock || facts.asset.control.state !== "AVAILABLE") return conflict();
      const auth = usableActivation(facts, now);
      if (!auth) return conflict();
      if (!attestationValid || !attestation) return conflict(STATUS_COPY.ATTESTATION_EXPIRED);
      if (!evidenceMatchesAttestation(facts.asset, attestation) || auth.packageVersion !== facts.asset.package.version) {
        return conflict(STATUS_COPY.EVIDENCE_STALE);
      }
      const isActive = options.isVerifierActive ?? (() => true);
      return isActive(attestation.verifierRegistryRef) ? OK : conflict(STATUS_COPY.ATTESTATION_EXPIRED);
    }
    case "release.request":
      return lockActive && !rr ? OK : conflict();
    case "release.requestInformation":
      return lockActive && rr?.state === "REQUESTED" ? OK : conflict();
    case "release.respond":
      return lockActive && rr?.state === "INFORMATION_REQUESTED" ? OK : conflict();
    case "release.authorize":
    case "release.reject":
      return lockActive && rr ? OK : conflict();
    case "release.withdraw":
      if (!lockActive || !rr) return conflict();
      return rr.requestedByOrgId === actor.orgId ? OK : forbidden(action);
    case "auditGrant.create":
      return OK;
    case "auditGrant.revoke":
      return facts.auditGrants.some((g) => g.grantorOrgId === actor.orgId && !g.revokedAt) ? OK : conflict();
    case "report.export":
      return OK;
  }
}

/** Policy + preconditions for one case action. Unrelated parties get UNAVAILABLE (404-shaped). */
export function checkCaseAction(
  facts: CaseFacts,
  actor: Actor,
  action: CaseAction,
  now: Date,
  options: ContextOptions = {},
): ActionCheck {
  const ctx = caseContext(facts, now, options);
  if (!isRelated(actor, ctx)) return unavailable;
  if (!can(actor, CASE_ACTION_POLICY[action], ctx)) return forbidden(action);
  return casePrecondition(facts, action, actor, now, options);
}

/** Server-computed allowed actions for the case header and tabs. */
export function allowedCaseActions(facts: CaseFacts, actor: Actor, now: Date, options: ContextOptions = {}): CaseAction[] {
  return CASE_ACTIONS.filter((action) => {
    if (UI_DEFERRED.has(action) && !actor.roles.includes("BORROWER")) return false;
    return checkCaseAction(facts, actor, action, now, options).ok;
  });
}

// --- Reports: access is evaluated at generation and again at download (S L751) ------------------------

/** Scopes to record on an export: the auditor's effective scopes, or null for case participants. */
export function exportAuditScopes(facts: CaseFacts, actor: Actor, now: Date, options: ContextOptions = {}): AuditScope[] | null {
  if (!actor.roles.includes("AUDITOR")) return null;
  return [...(caseContext(facts, now, options).auditAccess?.[actor.orgId]?.scopes ?? [])];
}

export function canDownloadReport(
  facts: CaseFacts,
  exp: ExportFacts,
  actor: Actor,
  now: Date,
  options: ContextOptions = {},
): boolean {
  if (exp.requestedByOrgId !== actor.orgId || exp.state !== "READY") return false;
  if (exp.expiresAt !== null && Date.parse(exp.expiresAt) <= now.getTime()) return false;
  const ctx = caseContext(facts, now, options);
  if (!can(actor, "report.export", ctx)) return false;
  if (exp.auditScopes === null) return true;
  const current = ctx.auditAccess?.[actor.orgId]?.scopes ?? [];
  return exp.auditScopes.every((scope) => current.includes(scope));
}

// --- Asset- and verification-level actions (verification can precede any case, CR-14) -------------

export function checkAssetAction(
  asset: AssetFacts,
  cases: readonly CaseFacts[],
  actor: Actor,
  action: AssetAction,
  now: Date,
  options: ContextOptions = {},
): ActionCheck {
  const ctx = assetContext(asset, cases, now, options);
  if (!isRelated(actor, ctx)) return unavailable;
  if (action === "case.create") {
    // Creating a case needs the borrower mandate on the asset owner organization (S §9.3).
    if (asset.ownerOrgId !== actor.orgId || !actor.roles.includes("BORROWER") || !hasMandate(actor, "BORROWER")) return forbidden(action);
    if (asset.lifecycle !== "REGISTERED") return conflict(CASE_CREATE_COPY.NOT_REGISTERED);
    return cases.some((c) => c.asset.ref === asset.ref && caseHoldsAsset(c)) ? conflict(CASE_CREATE_COPY.ACTIVE_CASE) : OK;
  }
  if (!can(actor, action, ctx)) return forbidden(action);
  if (asset.lifecycle !== "REGISTERED") return conflict();
  if (action === "verification.request" && openVerification(asset)) return conflict();
  return OK;
}

export function allowedAssetActions(
  asset: AssetFacts,
  cases: readonly CaseFacts[],
  actor: Actor,
  now: Date,
  options: ContextOptions = {},
): AssetAction[] {
  return ASSET_ACTIONS.filter((action) => checkAssetAction(asset, cases, actor, action, now, options).ok);
}

function verificationContext(asset: AssetFacts, verification: VerificationFacts, options: ContextOptions): PolicyContext {
  const isActive = options.isVerifierActive ?? (() => true);
  return {
    ownerOrgIds: [asset.ownerOrgId],
    verifierOrgIds: [verification.verifierOrgId],
    activeVerifierOrgIds: isActive(verification.verifierRegistryRef) ? [verification.verifierOrgId] : [],
  };
}

export function canViewVerification(asset: AssetFacts, verification: VerificationFacts, actor: Actor): boolean {
  return actor.orgId === asset.ownerOrgId || actor.orgId === verification.verifierOrgId;
}

export function checkVerificationAction(
  asset: AssetFacts,
  verification: VerificationFacts,
  actor: Actor,
  action: VerificationAction,
  _now: Date,
  options: ContextOptions = {},
): ActionCheck {
  if (!canViewVerification(asset, verification, actor)) return unavailable;
  const ctx = verificationContext(asset, verification, options);
  const policy: PolicyAction = action === "verification.submitEvidence" ? "verification.request" : "verification.perform";
  if (!can(actor, policy, ctx)) return forbidden(action);
  switch (action) {
    case "verification.acceptAssignment":
    case "verification.declineAssignment":
      return verification.state === "REQUESTED" ? OK : conflict();
    case "verification.requestChanges":
    case "verification.issueAttestation":
    case "verification.reject":
      return verification.state === "IN_REVIEW" ? OK : conflict();
    case "verification.submitEvidence":
      return verification.state === "CHANGES_REQUESTED" ? OK : conflict();
  }
}

export function allowedVerificationActions(
  asset: AssetFacts,
  verification: VerificationFacts,
  actor: Actor,
  now: Date,
  options: ContextOptions = {},
): VerificationAction[] {
  return VERIFICATION_ACTIONS.filter((action) => checkVerificationAction(asset, verification, actor, action, now, options).ok);
}

// --- Dealer consent requests (daml-model.md §4.6): only the dealer whose documents are listed decides ---------

export const CONSENT_ACTIONS = ["consent.grant", "consent.decline", "consent.withdraw"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

/** INFERRED copy (needs approval): consent refusals, shared by the API and the UI_MOCK client. */
export const CONSENT_COPY = {
  EXPIRED: "This consent request has expired. Ask the owner for a new request.",
  NOT_PENDING: "This consent request has already been answered.",
  NOT_GRANTED: "Only granted consent can be withdrawn.",
} as const;

/** Stored state with expiry applied (a pending request or a granted share past its expiry is EXPIRED). */
export function effectiveConsentState(consent: ConsentFacts, now: Date): ConsentState {
  const expired = Date.parse(consent.expiresAt) <= now.getTime();
  return (consent.state === "PENDING" || consent.state === "GRANTED") && expired ? "EXPIRED" : consent.state;
}

/**
 * Policy + state for a consent decision. The invited dealer whose documents the request lists decides
 * ("Consent for own records"); unrelated parties get UNAVAILABLE, other case participants (the owner
 * included) FORBIDDEN.
 */
export function checkConsentAction(
  facts: CaseFacts,
  consent: ConsentFacts,
  actor: Actor,
  action: ConsentAction,
  now: Date,
  options: ContextOptions = {},
): ActionCheck {
  const ctx = caseContext(facts, now, options);
  if (!isRelated(actor, ctx)) return unavailable;
  const isConsentingDealer =
    actor.roles.includes("DEALER") && consent.dealerOrgId === actor.orgId && facts.dealerOrgId === actor.orgId && facts.borrowerOrgId !== actor.orgId;
  if (!isConsentingDealer || !can(actor, "sharing.approve", ctx)) return forbidden(action);
  const state = effectiveConsentState(consent, now);
  if (action === "consent.withdraw") return state === "GRANTED" ? OK : conflict(CONSENT_COPY.NOT_GRANTED);
  if (state === "EXPIRED" && consent.state === "PENDING") return conflict(CONSENT_COPY.EXPIRED);
  return state === "PENDING" ? OK : conflict(CONSENT_COPY.NOT_PENDING);
}

export function allowedConsentActions(facts: CaseFacts, consent: ConsentFacts, actor: Actor, now: Date, options: ContextOptions = {}): ConsentAction[] {
  return CONSENT_ACTIONS.filter((action) => checkConsentAction(facts, consent, actor, action, now, options).ok);
}
