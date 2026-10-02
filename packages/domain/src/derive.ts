// Pure projections over facts: case stage (synthesis §1.5.1), next actor/action/blockers,
// attestation validity, pledge display composite, evidence completeness, activation prerequisites.
import { STATUS_COPY } from "./copy";
import {
  DOCUMENT_TYPE_LABELS,
  REQUIRED_DOCUMENT_TYPES,
  type AssetFacts,
  type AttestationFacts,
  type CaseFacts,
  type DocumentType,
  type EvidenceDocumentFacts,
  type ProposalVersionFacts,
  type ReleaseRequestFacts,
  type VerificationFacts,
} from "./facts";
import { formatVersionedRef } from "./refs";
import type { OrgId, Role } from "./roles";
import {
  ACTIVE_REVIEW_STATES,
  OPEN_RELEASE_REQUEST_STATES,
  OPEN_VERIFICATION_STATES,
  type AttestationValidity,
  type CaseStage,
  type PledgeDisplayState,
  type ProposalState,
} from "./states";

const time = (iso: string) => Date.parse(iso);
const byTime = <T>(get: (item: T) => string) => (a: T, b: T) => time(get(a)) - time(get(b));

// --- Documents and evidence ------------------------------------------------------------------

export function latestDocumentVersion(doc: EvidenceDocumentFacts) {
  return doc.versions.reduce((latest, v) => (v.version > latest.version ? v : latest));
}

export interface EvidenceCompletenessItem {
  readonly type: DocumentType;
  readonly label: string;
  readonly required: boolean;
  readonly documentRef: string | null;
  readonly version: number | null;
  readonly present: boolean;
}

export interface EvidenceCompleteness {
  readonly complete: boolean;
  readonly missing: readonly DocumentType[];
  readonly items: readonly EvidenceCompletenessItem[];
}

/** Required documents present (AVAILABLE upload state) per CR-51; the purchase agreement is optional. */
export function evidenceCompleteness(asset: AssetFacts): EvidenceCompleteness {
  const types: DocumentType[] = [...REQUIRED_DOCUMENT_TYPES, "PURCHASE_AGREEMENT"];
  const items = types.map((type) => {
    const doc = asset.documents.find(
      (d) => d.type === type && d.versions.some((v) => v.uploadState === "AVAILABLE"),
    );
    const version = doc ? latestDocumentVersion(doc).version : null;
    return {
      type,
      label: DOCUMENT_TYPE_LABELS[type],
      required: REQUIRED_DOCUMENT_TYPES.includes(type),
      documentRef: doc?.ref ?? null,
      version,
      present: !!doc,
    };
  });
  const missing = items.filter((item) => item.required && !item.present).map((item) => item.type);
  return { complete: missing.length === 0, missing, items };
}

// --- Verification and attestation ---------------------------------------------------------------

export function latestVerification(asset: AssetFacts): VerificationFacts | null {
  return [...asset.verifications].sort(byTime((v) => v.requestedAt)).at(-1) ?? null;
}

export function openVerification(asset: AssetFacts): VerificationFacts | null {
  const latest = latestVerification(asset);
  return latest && OPEN_VERIFICATION_STATES.includes(latest.state) ? latest : null;
}

/** EXPIRED is computed from validUntil at read time; it is never a ledger event. */
export function attestationValidity(attestation: AttestationFacts, now: Date): AttestationValidity {
  if (attestation.revokedAt) return "REVOKED";
  if (attestation.supersededBy) return "SUPERSEDED";
  if (now.getTime() > time(attestation.validUntil)) return "EXPIRED";
  return "VALID";
}

/** The newest attestation that has not been superseded (it may still be expired or revoked). */
export function currentAttestation(asset: AssetFacts): AttestationFacts | null {
  return [...asset.attestations].filter((a) => !a.supersededBy).sort(byTime((a) => a.issuedAt)).at(-1) ?? null;
}

export function validAttestation(asset: AssetFacts, now: Date): AttestationFacts | null {
  const attestation = currentAttestation(asset);
  return attestation && attestationValidity(attestation, now) === "VALID" ? attestation : null;
}

/** True when the current evidence manifest is the version the attestation was issued against. */
export function evidenceMatchesAttestation(asset: AssetFacts, attestation: AttestationFacts | null): boolean {
  return !!attestation && attestation.packageVersion === asset.package.version;
}

/** "The reviewed evidence has changed. A new review is required." */
export function reviewSnapshotStale(facts: CaseFacts): boolean {
  const snapshot = facts.review.snapshotPackageVersion;
  return snapshot !== null && snapshot !== facts.asset.package.version;
}

// --- Proposal, activation, lock, release ---------------------------------------------------------

export function latestProposal(facts: CaseFacts): ProposalVersionFacts | null {
  return [...facts.proposals].sort((a, b) => a.version - b.version || time(a.draftedAt) - time(b.draftedAt)).at(-1) ?? null;
}

/** ISSUED past its expiry reads as EXPIRED (expiry is evaluated at read and at acceptance). */
export function effectiveProposalState(proposal: ProposalVersionFacts, now: Date): ProposalState {
  return proposal.state === "ISSUED" && now.getTime() > time(proposal.expiresAt) ? "EXPIRED" : proposal.state;
}

export function acceptedProposal(facts: CaseFacts): ProposalVersionFacts | null {
  const latest = latestProposal(facts);
  return latest?.state === "ACCEPTED" ? latest : null;
}

/** Activation authorization usable for the accepted version (AUTHORIZED and not past expiry). */
export function usableActivation(facts: CaseFacts, now: Date) {
  const auth = facts.activation;
  const accepted = acceptedProposal(facts);
  if (!auth || !accepted || auth.state !== "AUTHORIZED") return null;
  if (auth.proposalRef !== accepted.ref || auth.proposalVersion !== accepted.version) return null;
  if (now.getTime() > time(auth.expiresAt)) return null;
  return auth;
}

export function latestReleaseRequest(facts: CaseFacts): ReleaseRequestFacts | null {
  return [...facts.releaseRequests].sort(byTime((r) => r.requestedAt)).at(-1) ?? null;
}

export function openReleaseRequest(facts: CaseFacts): ReleaseRequestFacts | null {
  const latest = latestReleaseRequest(facts);
  return latest && OPEN_RELEASE_REQUEST_STATES.includes(latest.state) ? latest : null;
}

/** Composite pill derived from control, lock and release request (#11a). */
export function pledgeDisplayState(facts: CaseFacts): PledgeDisplayState {
  const lock = facts.lock;
  if (!lock) return "AVAILABLE";
  if (lock.state === "RELEASED") return "RELEASED";
  const latest = latestReleaseRequest(facts);
  if (latest && OPEN_RELEASE_REQUEST_STATES.includes(latest.state)) return "RELEASE_REQUESTED";
  if (latest?.state === "REJECTED") return "RELEASE_REJECTED";
  return "ACTIVE";
}

// --- Case stage (§1.5.1: evaluate top-down; the first match wins) -----------------------------------

export function deriveCaseStage(facts: CaseFacts, _now: Date): CaseStage {
  const lock = facts.lock;
  if (facts.cancelledAt && !lock) return "CANCELLED";
  if (lock?.state === "RELEASED" || (facts.closedAt && lock?.state !== "ACTIVE")) return "CLOSED";
  if (lock?.state === "ACTIVE") return openReleaseRequest(facts) ? "RELEASE_REVIEW" : "PLEDGE_ACTIVE";
  if (facts.review.state === "ELIGIBLE") return "PROPOSAL";
  const verification = latestVerification(facts.asset);
  if (facts.review.state === "REJECTED" || verification?.state === "REJECTED") return "REJECTED";
  if (ACTIVE_REVIEW_STATES.includes(facts.review.state)) return "LENDER_REVIEW";
  if (verification && OPEN_VERIFICATION_STATES.includes(verification.state)) return "VERIFICATION";
  if (!evidenceCompleteness(facts.asset).complete) return "EVIDENCE_COLLECTION";
  return "DRAFT";
}

// --- Next actor / next action / blockers -------------------------------------------------------------

/** Next-action labels. Action names follow S §9 where they exist; others are INFERRED. */
export const NEXT_ACTIONS = {
  ADD_EVIDENCE: "Add evidence",
  REQUEST_VERIFICATION: "Request verification",
  ACCEPT_ASSIGNMENT: "Accept assignment",
  SUBMIT_ATTESTATION: "Submit attestation",
  SUBMIT_NEW_EVIDENCE: "Submit new evidence version",
  REVIEW_SHARING: "Review sharing",
  REVIEW_EVIDENCE: "Review evidence",
  OPEN_COLLATERAL_REVIEW: "Open collateral review",
  PROVIDE_INFORMATION: "Provide requested information",
  DECIDE_ELIGIBILITY: "Approve or reject collateral eligibility",
  ISSUE_PROPOSAL: "Issue proposal",
  RESPOND_TO_PROPOSAL: "Review proposal",
  AUTHORIZE_ACTIVATION: "Authorize pledge activation",
  ACTIVATE_PLEDGE: "Activate pledge",
  DECIDE_RELEASE: "Decide release request",
  RESPOND_RELEASE_INFORMATION: "Respond to information request",
  EXPORT_CASE_HISTORY: "Export case history",
} as const;
export type NextActionCode = keyof typeof NEXT_ACTIONS;

export interface Blocker {
  readonly code: string;
  readonly message: string;
}

export interface NextStep {
  readonly stage: CaseStage;
  readonly nextActor: { readonly orgId: OrgId; readonly role: Role } | null;
  readonly action: NextActionCode | null;
  readonly currentStep: string;
  readonly blockers: readonly Blocker[];
}

function activationBlockers(facts: CaseFacts, now: Date): Blocker[] {
  const blockers: Blocker[] = [];
  const attestation = currentAttestation(facts.asset);
  if (!attestation || attestationValidity(attestation, now) !== "VALID") {
    blockers.push({ code: "ATTESTATION_NOT_VALID", message: STATUS_COPY.ATTESTATION_EXPIRED });
  } else if (!evidenceMatchesAttestation(facts.asset, attestation)) {
    blockers.push({ code: "EVIDENCE_CHANGED", message: STATUS_COPY.EVIDENCE_STALE });
  }
  if (facts.asset.control.state !== "AVAILABLE") {
    blockers.push({ code: "CONTROL_NOT_AVAILABLE", message: "Asset control is not available." });
  }
  return blockers;
}

export function deriveNextAction(facts: CaseFacts, now: Date): NextStep {
  const stage = deriveCaseStage(facts, now);
  const owner = { orgId: facts.borrowerOrgId, role: "BORROWER" as const };
  const lenderOrgId = facts.selectedLenderOrgId ?? facts.review.lenderOrgId;
  const analyst = { orgId: lenderOrgId, role: "LENDER_ANALYST" as const };
  const approver = { orgId: facts.lock?.lenderOrgId ?? lenderOrgId, role: "LENDER_APPROVER" as const };
  const pkg = formatVersionedRef(facts.asset.package.ref, facts.asset.package.version);
  const step = (
    nextActor: NextStep["nextActor"],
    action: NextActionCode | null,
    currentStep: string,
    blockers: Blocker[] = [],
  ): NextStep => ({ stage, nextActor, action, currentStep, blockers });

  switch (stage) {
    case "CANCELLED":
      return step(null, null, "Case cancelled before any collateral lock.");
    case "CLOSED":
      return step(
        null,
        "EXPORT_CASE_HISTORY",
        facts.lock?.state === "RELEASED"
          ? "Lock released. Case can be closed after dependency check."
          : "Case closed after dependency check.",
      );
    case "RELEASE_REVIEW": {
      const rr = openReleaseRequest(facts);
      if (rr?.state === "INFORMATION_REQUESTED") {
        return step(owner, "RESPOND_RELEASE_INFORMATION", `Lender requested information on release request ${rr.ref}.`, [
          { code: "RELEASE_INFORMATION_REQUESTED", message: STATUS_COPY.RELEASE_PENDING },
        ]);
      }
      return step(approver, "DECIDE_RELEASE", `Lender decision on release request ${rr?.ref ?? "pending"}.`, [
        { code: "AWAITING_APPROVER", message: STATUS_COPY.RELEASE_PENDING },
      ]);
    }
    case "PLEDGE_ACTIVE": {
      const latest = latestReleaseRequest(facts);
      const suffix = latest?.state === "REJECTED" ? ` Release request ${latest.ref} was rejected; the lock remains active.` : "";
      return step(null, null, `Collateral lock ${facts.lock?.ref ?? "record"} is active.${suffix}`);
    }
    case "PROPOSAL": {
      const proposal = latestProposal(facts);
      const state = proposal ? effectiveProposalState(proposal, now) : null;
      if (!proposal || state === "DRAFT" || state === "WITHDRAWN" || state === "DECLINED" || state === "EXPIRED") {
        return step(approver, "ISSUE_PROPOSAL", "Collateral decision recorded. Proposal can be issued by the approver.", [
          { code: "PROPOSAL_NOT_ISSUED", message: "Proposal not yet issued." },
        ]);
      }
      const ref = formatVersionedRef(proposal.ref, proposal.version);
      if (state === "ISSUED") {
        return step(owner, "RESPOND_TO_PROPOSAL", `Proposal ${ref} awaits the borrower's response.`, [
          { code: "PROPOSAL_NOT_ACCEPTED", message: "Proposal not yet accepted." },
        ]);
      }
      const blockers = activationBlockers(facts, now);
      if (!usableActivation(facts, now)) {
        return step(owner, "AUTHORIZE_ACTIVATION", `Proposal ${ref} accepted. The borrower authorizes pledge activation.`, [
          { code: "ACTIVATION_NOT_AUTHORIZED", message: "Borrower activation authorization not yet recorded." },
          ...blockers,
        ]);
      }
      return step(approver, "ACTIVATE_PLEDGE", `Activation authorized for ${ref}. The approver activates the pledge.`, blockers);
    }
    case "REJECTED":
      return step(
        null,
        null,
        facts.review.state === "REJECTED" ? "Rejected for this case." : "Verification rejected.",
      );
    case "LENDER_REVIEW": {
      const stale: Blocker[] = reviewSnapshotStale(facts)
        ? [{ code: "EVIDENCE_CHANGED", message: STATUS_COPY.EVIDENCE_STALE }]
        : [];
      switch (facts.review.state) {
        case "SUBMITTED":
          return step(analyst, "REVIEW_EVIDENCE", `Lender review of the shared evidence package ${pkg}.`, [
            { code: "REVIEW_NOT_STARTED", message: "Review not yet started." },
            ...stale,
          ]);
        case "PENDING_APPROVAL":
          return step(approver, "DECIDE_ELIGIBILITY", "Assessment submitted for approval.", [
            { code: "AWAITING_APPROVER", message: "Awaiting approver decision." },
            ...stale,
          ]);
        case "NEEDS_INFORMATION":
          return step(owner, "PROVIDE_INFORMATION", "Waiting on borrower · information requested by the lender.", [
            { code: "INFORMATION_REQUESTED", message: "No lender action until the requested information is provided." },
            ...stale,
          ]);
        default:
          return step(analyst, "OPEN_COLLATERAL_REVIEW", `Lender review of the shared evidence package ${pkg}.`, [
            { code: "ASSESSMENT_NOT_SUBMITTED", message: "Assessment not yet submitted for approval." },
            ...stale,
          ]);
      }
    }
    case "VERIFICATION": {
      const v = openVerification(facts.asset);
      const verifier = v ? { orgId: v.verifierOrgId, role: "VERIFIER" as const } : null;
      if (v?.state === "CHANGES_REQUESTED") {
        return step(owner, "SUBMIT_NEW_EVIDENCE", `Verifier requested changes on ${v.ref}.`, [
          { code: "CHANGES_REQUESTED", message: "Verification is waiting for a new evidence version." },
        ]);
      }
      if (v?.state === "REQUESTED") {
        return step(verifier, "ACCEPT_ASSIGNMENT", `Verification ${v.ref} awaits the assigned verifier.`);
      }
      return step(verifier, "SUBMIT_ATTESTATION", `Verification ${v?.ref ?? "request"} is in review.`);
    }
    case "EVIDENCE_COLLECTION":
      return step(owner, "ADD_EVIDENCE", "Collect the required equipment evidence.", [
        { code: "EVIDENCE_MISSING", message: STATUS_COPY.EVIDENCE_MISSING },
      ]);
    case "DRAFT":
      return validAttestation(facts.asset, now)
        ? step(owner, "REVIEW_SHARING", "Share the attested evidence package with the selected lender.")
        : step(owner, "REQUEST_VERIFICATION", "Request verification of the equipment evidence.");
  }
}

// --- Activation prerequisites (P-Dash §5.3 + the borrower authorization step, CR-20) --------------------

export interface Prerequisite {
  readonly code: string;
  readonly label: string;
  readonly done: boolean;
  readonly detail: string;
}

export function activationPrerequisites(facts: CaseFacts, now: Date): Prerequisite[] {
  const decision = facts.review.decision;
  const accepted = acceptedProposal(facts);
  const attestation = currentAttestation(facts.asset);
  const validity = attestation ? attestationValidity(attestation, now) : null;
  const matches = evidenceMatchesAttestation(facts.asset, attestation);
  const lock = facts.lock;
  const auth = facts.activation;
  return [
    {
      code: "DECISION",
      label: "Lender-authorized collateral decision",
      done: decision?.outcome === "ELIGIBLE",
      detail: decision ? `${facts.review.ref} · ${decision.outcome === "ELIGIBLE" ? "eligible" : "rejected"}` : "Pending approver",
    },
    {
      code: "PROPOSAL_ACCEPTED",
      label: "Proposal issued and accepted (exact version)",
      done: !!accepted || !!lock,
      detail: accepted ? `${formatVersionedRef(accepted.ref, accepted.version)} · accepted` : lock ? `${formatVersionedRef(lock.proposalRef, lock.proposalVersion)}` : "Not issued",
    },
    {
      code: "ACTIVATION_AUTHORIZED",
      label: "Borrower activation authorization",
      done: auth?.state === "AUTHORIZED" || auth?.state === "CONSUMED",
      detail: auth ? (auth.state === "CONSUMED" ? "Used for activation" : auth.state === "AUTHORIZED" ? "Authorized" : "Expired") : "Not authorized",
    },
    {
      code: "ATTESTATION_VALID",
      label: "Attestation valid at activation",
      done: validity === "VALID",
      detail: attestation ? `${attestation.ref} · ${validity === "VALID" ? "valid" : (validity ?? "").toLowerCase()}` : "No attestation",
    },
    {
      code: "EVIDENCE_MATCHES",
      label: "Evidence snapshot matches attested versions",
      done: matches,
      detail: formatVersionedRef(facts.asset.package.ref, facts.asset.package.version),
    },
    {
      code: "CONTROL_AVAILABLE",
      label: "Asset control available (no active lock)",
      done: facts.asset.control.state === "AVAILABLE",
      detail: facts.asset.control.state === "AVAILABLE" ? `${facts.asset.ref} · available` : `Held by ${facts.asset.control.lockRef ?? "a lock"}`,
    },
  ];
}
