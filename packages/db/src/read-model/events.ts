// Ledger events → domain EventFacts (timeline/audit rows). Only events the viewer is a stakeholder of reach this
// mapper (ledger-view.ts); the presenters then apply the per-audience rules (EVENT_TYPES[*].audience).
import {
  actorLine,
  releaseReasons,
  roleFromActorRef,
  userIdFromActorRef,
  type EventFacts,
  type EventType,
  type Role,
} from "@collara/domain";
import { int, obj, str, type Json } from "./decode";
import type { PartyDirectory, VisibleEvent } from "./ledger-view";
import { T } from "../projection/templates";

export interface MappedEvent {
  readonly event: EventFacts;
  /** Case the event belongs to (null for asset-level events). */
  readonly caseRef: string | null;
  readonly assetRef: string | null;
  /** True for verification/evidence/registration events, which belong to the asset timeline. */
  readonly assetLevel: boolean;
}

interface Mapping {
  readonly type: EventType;
  readonly ref: string;
  readonly actorRef: string | null;
  readonly actorParty: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly version?: string | null;
  readonly detail?: string | null;
  readonly role?: Role | null;
}

const p = (e: VisibleEvent): Json => e.contract.payload;

/** Created-event mappings: template → event. */
function onCreate(e: VisibleEvent): Mapping | null {
  const payload = p(e);
  const signatory = e.contract.signatories[0] ?? null;
  switch (e.templateRef) {
    case T.AssetPassport:
      return int(payload.passportVersion, 1) === 1
        ? { type: "PASSPORT_REGISTERED", ref: str(payload.assetId), actorRef: null, actorParty: str(payload.owner), from: "DRAFT", to: "REGISTERED", version: "passport v1", role: "BORROWER" }
        : null;
    case T.VerificationRequest:
      return int(payload.version, 1) === 1
        ? {
            type: "VERIFICATION_REQUESTED",
            ref: str(payload.requestRef),
            actorRef: null,
            actorParty: str(payload.owner),
            from: null,
            to: "REQUESTED",
            version: `package v${int(obj(payload.evidence).manifestVersion, 1)}`,
            role: "BORROWER",
          }
        : null;
    case T.PackageShare:
      return {
        type: "PACKAGE_SHARED",
        ref: str(payload.shareRef),
        actorRef: null,
        actorParty: str(payload.owner),
        version: `package v${int(obj(payload.evidence).manifestVersion, 1)}`,
        detail: `${list(payload.documents)} document(s)`,
        role: "BORROWER",
      };
    case T.LenderDecisionNotice: {
      const outcome = str(payload.outcome);
      return {
        type: outcome === "NEEDS_INFORMATION" ? "INFORMATION_REQUESTED" : "DECISION_RECORDED",
        ref: str(payload.assessmentRef),
        actorRef: null,
        actorParty: str(payload.lender),
        to: outcome,
        detail: outcome === "ELIGIBLE" ? "Eligible for this case" : outcome === "REJECTED" ? "Rejected for this case" : null,
        role: outcome === "NEEDS_INFORMATION" ? "LENDER_ANALYST" : "LENDER_APPROVER",
      };
    }
    case T.FinancingProposal:
      return {
        type: "PROPOSAL_ISSUED",
        ref: str(payload.proposalRef),
        actorRef: str(payload.issuedByRef),
        actorParty: str(payload.lender),
        from: "DRAFT",
        to: "ISSUED",
        version: `v${int(payload.version, 1)}`,
        role: "LENDER_APPROVER",
      };
    case T.PledgeActivationAuthorization:
      return {
        type: "ACTIVATION_AUTHORIZED",
        ref: str(payload.authorizationRef),
        actorRef: str(payload.authorizedByRef),
        actorParty: str(payload.borrower),
        to: "AUTHORIZED",
        version: `control v${int(payload.expectedControlVersion, 1)}`,
        role: "BORROWER",
      };
    case T.CollateralLock: {
      const v = int(payload.controlVersion, 2);
      return {
        type: "PLEDGE_ACTIVATED",
        ref: str(payload.lockRef),
        actorRef: str(payload.activatedByRef),
        actorParty: str(payload.lender),
        from: "AVAILABLE",
        to: "ACTIVE",
        version: `control v${v - 1} → v${v}`,
        role: "LENDER_APPROVER",
      };
    }
    case T.ReleaseRequest:
      return int(payload.version, 1) === 1
        ? {
            type: "RELEASE_REQUESTED",
            ref: str(payload.releaseRequestRef),
            actorRef: str(payload.requestedByRef),
            actorParty: str(payload.requester),
            to: "REQUESTED",
            detail: releaseReasonDetail(str(payload.reason)),
          }
        : null;
    case T.ReleaseDecision: {
      const authorized = str(payload.outcome) === "AUTHORIZED";
      return {
        type: authorized ? "RELEASE_AUTHORIZED" : "RELEASE_REJECTED",
        ref: str(payload.releaseRequestRef),
        actorRef: str(payload.decidedByRef),
        actorParty: str(payload.lender),
        to: authorized ? "AUTHORIZED" : "REJECTED",
        detail: authorized ? null : str(payload.sharedReason) || null,
        role: "LENDER_APPROVER",
      };
    }
    case T.AuditGrant:
      return { type: "AUDIT_GRANT_CREATED", ref: str(payload.grantRef), actorRef: null, actorParty: signatory, to: "GRANTED" };
    default:
      return null;
  }
}

function list(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/** Exercised-event mappings: choice → event (the choice argument carries actorRef). */
function onExercise(e: VisibleEvent): Mapping | null {
  const arg = e.argument;
  const payload = p(e);
  const actorRef = str(arg.actorRef) || null;
  const actorParty = e.actingParties[0] ?? null;
  const ref = e.contract.businessRef ?? "";
  switch (e.choice) {
    case "VR_AcceptAssignment":
      return { type: "ASSIGNMENT_ACCEPTED", ref, actorRef, actorParty, from: "REQUESTED", to: "IN_REVIEW", role: "VERIFIER" };
    case "VR_DeclineAssignment":
      return { type: "ASSIGNMENT_DECLINED", ref, actorRef, actorParty, from: "REQUESTED", to: "DECLINED", detail: str(arg.reason) || null, role: "VERIFIER" };
    case "VR_RequestChanges":
      return { type: "CHANGES_REQUESTED", ref, actorRef, actorParty, from: "IN_REVIEW", to: "CHANGES_REQUESTED", detail: str(arg.note) || null, role: "VERIFIER" };
    case "VR_SubmitNewEvidence":
      return {
        type: "EVIDENCE_RESUBMITTED",
        ref,
        actorRef,
        actorParty,
        from: "CHANGES_REQUESTED",
        to: "IN_REVIEW",
        version: `package v${int(obj(arg.newEvidence).manifestVersion, 1)}`,
        role: "BORROWER",
      };
    case "VR_IssueAttestation":
      return {
        type: "ATTESTATION_ISSUED",
        ref: str(arg.attestationRef) || ref,
        actorRef,
        actorParty,
        from: "IN_REVIEW",
        to: "ATTESTED",
        version: `evidence v${int(obj(payload.evidence).manifestVersion, 1)}`,
        role: "VERIFIER",
      };
    case "VR_Reject":
      return { type: "VERIFICATION_REJECTED", ref, actorRef, actorParty, to: "REJECTED", detail: str(arg.reason) || null, role: "VERIFIER" };
    case "Manifest_NewVersion":
      return {
        type: "EVIDENCE_VERSION_ADDED",
        ref,
        actorRef,
        actorParty,
        version: `package v${int(payload.version, 1)} → v${int(payload.version, 1) + 1}`,
        role: "BORROWER",
      };
    case "Share_Revoke":
    case "AttDisc_Revoke":
      return { type: "ACCESS_REVOKED", ref, actorRef, actorParty, from: "GRANTED", to: "REVOKED", role: "BORROWER" };
    case "Share_WithdrawConsent":
      return { type: "ACCESS_REVOKED", ref, actorRef, actorParty, detail: "Dealer consent withdrawn", from: "GRANTED", to: "REVOKED", role: "DEALER" };
    case "Assessment_StartReview":
      return { type: "REVIEW_STARTED", ref, actorRef, actorParty, from: str(payload.status) || null, to: "IN_REVIEW" };
    case "Assessment_Save":
      return { type: "ASSESSMENT_SAVED", ref, actorRef, actorParty, version: `assessment v${int(payload.version, 1) + 1}` };
    case "Assessment_SubmitForApproval":
      return { type: "SUBMITTED_FOR_APPROVAL", ref, actorRef, actorParty, from: "IN_REVIEW", to: "PENDING_APPROVAL" };
    case "Proposal_Accept":
      return { type: "PROPOSAL_ACCEPTED", ref, actorRef, actorParty, from: "ISSUED", to: "ACCEPTED", version: `v${int(payload.version, 1)}`, role: "BORROWER" };
    case "Proposal_Decline":
      return { type: "PROPOSAL_DECLINED", ref, actorRef, actorParty, from: "ISSUED", to: "DECLINED", version: `v${int(payload.version, 1)}`, role: "BORROWER" };
    case "Proposal_Withdraw":
      return { type: "PROPOSAL_WITHDRAWN", ref, actorRef, actorParty, from: "ISSUED", to: "WITHDRAWN", version: `v${int(payload.version, 1)}`, role: "LENDER_APPROVER" };
    case "Release_RequestInformation":
      return { type: "RELEASE_INFORMATION_REQUESTED", ref, actorRef, actorParty, from: "REQUESTED", to: "INFORMATION_REQUESTED", role: "LENDER_APPROVER" };
    case "Release_Respond":
      return { type: "RELEASE_INFORMATION_PROVIDED", ref, actorRef, actorParty, from: "INFORMATION_REQUESTED", to: "REQUESTED", role: "BORROWER" };
    case "Release_Withdraw":
      return { type: "RELEASE_WITHDRAWN", ref, actorRef, actorParty, to: "WITHDRAWN" };
    case "Grant_Revoke":
      return { type: "AUDIT_GRANT_REVOKED", ref, actorRef, actorParty, from: "GRANTED", to: "REVOKED" };
    default:
      return null;
  }
}

const ASSET_LEVEL: ReadonlySet<EventType> = new Set<EventType>([
  "PASSPORT_REGISTERED",
  "EVIDENCE_UPLOADED",
  "EVIDENCE_VERSION_ADDED",
  "VERIFICATION_REQUESTED",
  "ASSIGNMENT_ACCEPTED",
  "ASSIGNMENT_DECLINED",
  "CHANGES_REQUESTED",
  "EVIDENCE_RESUBMITTED",
  "ATTESTATION_ISSUED",
  "VERIFICATION_REJECTED",
]);

const ROLE_BY_TEMPLATE: Readonly<Record<string, Role>> = {
  [T.CollateralAssessment]: "LENDER_ANALYST",
  [T.AuditGrant]: "BORROWER",
};

export function mapLedgerEvent(e: VisibleEvent, parties: PartyDirectory): MappedEvent | null {
  const m = e.kind === "created" ? onCreate(e) : e.kind === "exercised" ? onExercise(e) : null;
  if (!m) return null;
  const orgId = parties.orgIdOf(m.actorParty);
  const role = roleFromActorRef(m.actorRef) ?? m.role ?? ROLE_BY_TEMPLATE[e.templateRef] ?? null;
  const event: EventFacts = {
    id: `${e.updateId}:${e.nodeId}`,
    occurredAt: e.effectiveAt,
    ref: m.ref,
    type: m.type,
    detail: m.detail ?? null,
    actor: { orgId, userId: userIdFromActorRef(m.actorRef), role, label: actorLine(orgId, role) },
    stateChange: m.to ? { from: m.from ?? null, to: m.to } : null,
    version: m.version ?? null,
    kind: "COMMITTED",
    commit: { updateId: e.updateId, offset: e.offset },
  };
  return { event, caseRef: e.contract.caseRef, assetRef: e.contract.assetRef, assetLevel: ASSET_LEVEL.has(m.type) };
}

/** "external loan completion" (the UI_MOCK wording), never the raw ledger code; unknown codes are left out. */
function releaseReasonDetail(code: string): string | null {
  const parsed = releaseReasons.schema.safeParse(code);
  return parsed.success ? releaseReasons.label(parsed.data).toLowerCase() : null;
}
