// State vocabularies — one per state machine (synthesis §1.5). Never a single `VERIFIED` status:
// evidence, verification, review, proposal and pledge are separate machines displayed separately.
// UI labels are sentence case; raw enum values are shown only in technical mode.
import { z } from "zod";

export const BADGE_TONES = ["success", "warning", "danger", "info", "neutral", "pending"] as const;
export const BadgeToneSchema = z.enum(BADGE_TONES);
export type BadgeTone = z.infer<typeof BadgeToneSchema>;

export interface StateMeta {
  readonly label: string;
  readonly tone: BadgeTone;
}

export interface Badge<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly tone: BadgeTone;
}

function defineVocabulary<const V extends readonly [string, ...string[]]>(
  values: V,
  meta: { readonly [K in V[number]]: StateMeta },
) {
  type T = V[number];
  const schema = z.enum(values);
  return {
    values,
    schema,
    meta,
    label: (value: T): string => meta[value].label,
    tone: (value: T): BadgeTone => meta[value].tone,
    badge: (value: T): Badge<T> => ({ value, label: meta[value].label, tone: meta[value].tone }),
  };
}

/** Zod schema for a `{ value, label, tone }` badge restricted to one vocabulary. */
export function badgeSchema<S extends z.ZodType<string>>(valueSchema: S) {
  return z.object({ value: valueSchema, label: z.string(), tone: BadgeToneSchema });
}

// --- Runtime mode and data provenance -------------------------------------------------------

export const RUNTIME_MODES = ["UI_MOCK", "LOCALNET", "DEVNET"] as const;
export const RuntimeModeSchema = z.enum(RUNTIME_MODES);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

/** Modes that submit to a real Canton participant (LOCALNET: local sandbox; DEVNET: a shared DevNet participant). */
export type LedgerMode = Exclude<RuntimeMode, "UI_MOCK">;

/** True when the mode talks to a real ledger through the API (never simulated success). */
export function isLedgerMode(mode: RuntimeMode): mode is LedgerMode {
  return mode !== "UI_MOCK";
}

export const dataSources = defineVocabulary(["LEDGER_COMMITTED", "APPLICATION_RECORD"], {
  LEDGER_COMMITTED: { label: "Ledger-committed", tone: "success" },
  APPLICATION_RECORD: { label: "Application record", tone: "neutral" },
});
export const DataSourceSchema = dataSources.schema;
export type DataSource = z.infer<typeof DataSourceSchema>;

// --- #1 Asset identity (S §11.1; registrar propose/accept states inferred) -------------------

export const assetLifecycleStates = defineVocabulary(
  ["DRAFT", "REGISTRATION_REQUESTED", "REGISTERED", "ARCHIVED", "REGISTRATION_DECLINED"],
  {
    DRAFT: { label: "Draft", tone: "neutral" },
    REGISTRATION_REQUESTED: { label: "Registration requested", tone: "pending" },
    REGISTERED: { label: "Registered", tone: "success" },
    ARCHIVED: { label: "Archived", tone: "neutral" },
    REGISTRATION_DECLINED: { label: "Registration declined", tone: "danger" },
  },
);
export const AssetLifecycleStateSchema = assetLifecycleStates.schema;
export type AssetLifecycleState = z.infer<typeof AssetLifecycleStateSchema>;

// --- #2 Evidence document (off-ledger). The MVP does not virus-scan and says so. --------------

export const evidenceUploadStates = defineVocabulary(
  ["UPLOAD_PENDING", "QUARANTINED", "AVAILABLE", "REJECTED", "HASH_MISMATCH"],
  {
    UPLOAD_PENDING: { label: "Upload pending", tone: "pending" },
    QUARANTINED: { label: "Pending validation", tone: "pending" },
    AVAILABLE: { label: "Available", tone: "success" },
    REJECTED: { label: "Rejected", tone: "danger" },
    HASH_MISMATCH: { label: "Integrity mismatch", tone: "danger" },
  },
);
export const EvidenceUploadStateSchema = evidenceUploadStates.schema;
export type EvidenceUploadState = z.infer<typeof EvidenceUploadStateSchema>;

export const evidenceScanStates = defineVocabulary(["NOT_SCANNED"], {
  NOT_SCANNED: { label: "Not scanned", tone: "warning" },
});
export const EvidenceScanStateSchema = evidenceScanStates.schema;
export type EvidenceScanState = z.infer<typeof EvidenceScanStateSchema>;

export const evidenceLedgerStates = defineVocabulary(["UNCOMMITTED", "COMMITTED"], {
  UNCOMMITTED: { label: "Not in a committed manifest", tone: "neutral" },
  COMMITTED: { label: "In committed manifest", tone: "success" },
});
export const EvidenceLedgerStateSchema = evidenceLedgerStates.schema;
export type EvidenceLedgerState = z.infer<typeof EvidenceLedgerStateSchema>;

export const integrityStates = defineVocabulary(["VERIFIED", "MISMATCH", "NOT_CHECKED"], {
  VERIFIED: { label: "Hash verified", tone: "success" },
  MISMATCH: { label: "Hash mismatch", tone: "danger" },
  NOT_CHECKED: { label: "Not checked", tone: "neutral" },
});
export const IntegrityStateSchema = integrityStates.schema;
export type IntegrityState = z.infer<typeof IntegrityStateSchema>;

// --- #3 Evidence review (per document, display labels from the prototype) ---------------------

export const evidenceReviewStates = defineVocabulary(
  ["SUBMITTED", "REVIEWED", "REVIEWED_GAP_NOTED", "CORRECTION_REQUESTED", "ATTESTED"],
  {
    SUBMITTED: { label: "Submitted", tone: "neutral" },
    REVIEWED: { label: "Reviewed", tone: "success" },
    REVIEWED_GAP_NOTED: { label: "Reviewed · gap noted", tone: "pending" },
    CORRECTION_REQUESTED: { label: "Correction requested", tone: "warning" },
    ATTESTED: { label: "Attested", tone: "success" },
  },
);
export const EvidenceReviewStateSchema = evidenceReviewStates.schema;
export type EvidenceReviewState = z.infer<typeof EvidenceReviewStateSchema>;

// --- #4 Verification request (S §11.2; DECLINED/CANCELLED inferred) --------------------------

export const verificationStates = defineVocabulary(
  ["REQUESTED", "IN_REVIEW", "CHANGES_REQUESTED", "ATTESTED", "REJECTED", "DECLINED", "CANCELLED"],
  {
    REQUESTED: { label: "Requested", tone: "pending" },
    IN_REVIEW: { label: "In review", tone: "pending" },
    CHANGES_REQUESTED: { label: "Changes requested", tone: "warning" },
    ATTESTED: { label: "Attestation issued", tone: "success" },
    REJECTED: { label: "Verification rejected", tone: "danger" },
    DECLINED: { label: "Assignment declined", tone: "neutral" },
    CANCELLED: { label: "Cancelled", tone: "neutral" },
  },
);
export const VerificationStateSchema = verificationStates.schema;
export type VerificationState = z.infer<typeof VerificationStateSchema>;
export const OPEN_VERIFICATION_STATES: readonly VerificationState[] = ["REQUESTED", "IN_REVIEW", "CHANGES_REQUESTED"];

export const checkResults = defineVocabulary(["CHECKED", "CHECKED_NOTED", "REVIEWED_DOCUMENTS", "NOT_CHECKED"], {
  CHECKED: { label: "Checked", tone: "success" },
  CHECKED_NOTED: { label: "Checked · noted", tone: "pending" },
  REVIEWED_DOCUMENTS: { label: "Reviewed documents", tone: "neutral" },
  NOT_CHECKED: { label: "Not checked", tone: "neutral" },
});
export const CheckResultSchema = checkResults.schema;
export type CheckResult = z.infer<typeof CheckResultSchema>;

// --- #5 Attestation validity (EXPIRED is computed from validUntil, never a ledger event) ------

export const attestationValidityStates = defineVocabulary(["VALID", "EXPIRED", "REVOKED", "SUPERSEDED"], {
  VALID: { label: "Valid", tone: "success" },
  EXPIRED: { label: "Expired", tone: "warning" },
  REVOKED: { label: "Revoked", tone: "danger" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
});
export const AttestationValiditySchema = attestationValidityStates.schema;
export type AttestationValidity = z.infer<typeof AttestationValiditySchema>;

// --- #6 Lender review / assessment (S §11.3; PENDING_APPROVAL inferred) ----------------------

export const reviewStates = defineVocabulary(
  ["NOT_SUBMITTED", "SUBMITTED", "IN_REVIEW", "NEEDS_INFORMATION", "PENDING_APPROVAL", "ELIGIBLE", "REJECTED"],
  {
    NOT_SUBMITTED: { label: "Not submitted", tone: "neutral" },
    SUBMITTED: { label: "Awaiting lender review", tone: "pending" },
    IN_REVIEW: { label: "In review", tone: "pending" },
    NEEDS_INFORMATION: { label: "Needs information", tone: "warning" },
    PENDING_APPROVAL: { label: "Awaiting approval", tone: "pending" },
    ELIGIBLE: { label: "Eligible for this case", tone: "success" },
    REJECTED: { label: "Rejected for this case", tone: "danger" },
  },
);
export const ReviewStateSchema = reviewStates.schema;
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export const ACTIVE_REVIEW_STATES: readonly ReviewState[] = ["SUBMITTED", "IN_REVIEW", "NEEDS_INFORMATION", "PENDING_APPROVAL"];

export const ASSESSMENT_OUTCOMES = ["NEEDS_INFORMATION", "ELIGIBLE", "REJECTED"] as const;
export const AssessmentOutcomeSchema = z.enum(ASSESSMENT_OUTCOMES);
export type AssessmentOutcome = z.infer<typeof AssessmentOutcomeSchema>;

// --- #7 Financing proposal (ACCEPTED ≠ FUNDED) ------------------------------------------------

export const proposalStates = defineVocabulary(["DRAFT", "ISSUED", "ACCEPTED", "DECLINED", "WITHDRAWN", "EXPIRED"], {
  DRAFT: { label: "Draft", tone: "neutral" },
  ISSUED: { label: "Issued", tone: "pending" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  DECLINED: { label: "Declined", tone: "danger" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "warning" },
});
export const ProposalStateSchema = proposalStates.schema;
export type ProposalState = z.infer<typeof ProposalStateSchema>;

// --- #8 Activation authorization (borrower step, CR-20) ---------------------------------------

export const activationAuthorizationStates = defineVocabulary(["NONE", "AUTHORIZED", "CONSUMED", "EXPIRED"], {
  NONE: { label: "Not authorized", tone: "neutral" },
  AUTHORIZED: { label: "Authorized by borrower", tone: "pending" },
  CONSUMED: { label: "Used for activation", tone: "success" },
  EXPIRED: { label: "Expired", tone: "warning" },
});
export const ActivationAuthorizationStateSchema = activationAuthorizationStates.schema;
export type ActivationAuthorizationState = z.infer<typeof ActivationAuthorizationStateSchema>;

// --- #9–#11 Control, lock, release request (split per CR-15) -----------------------------------

export const assetControlStates = defineVocabulary(["AVAILABLE", "LOCKED"], {
  AVAILABLE: { label: "Available", tone: "neutral" },
  LOCKED: { label: "Locked", tone: "success" },
});
export const AssetControlStateSchema = assetControlStates.schema;
export type AssetControlState = z.infer<typeof AssetControlStateSchema>;

export const lockStates = defineVocabulary(["ACTIVE", "RELEASED"], {
  ACTIVE: { label: "Active", tone: "success" },
  RELEASED: { label: "Released", tone: "neutral" },
});
export const LockStateSchema = lockStates.schema;
export type LockState = z.infer<typeof LockStateSchema>;

export const releaseRequestStates = defineVocabulary(
  ["REQUESTED", "INFORMATION_REQUESTED", "AUTHORIZED", "REJECTED", "WITHDRAWN"],
  {
    REQUESTED: { label: "Release requested", tone: "pending" },
    INFORMATION_REQUESTED: { label: "Information requested", tone: "warning" },
    AUTHORIZED: { label: "Release authorized", tone: "success" },
    REJECTED: { label: "Release rejected", tone: "danger" },
    WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  },
);
export const ReleaseRequestStateSchema = releaseRequestStates.schema;
export type ReleaseRequestState = z.infer<typeof ReleaseRequestStateSchema>;
export const OPEN_RELEASE_REQUEST_STATES: readonly ReleaseRequestState[] = ["REQUESTED", "INFORMATION_REQUESTED"];

export const releaseReasons = defineVocabulary(
  ["EXTERNAL_LOAN_COMPLETION", "REFINANCING", "ADMINISTRATIVE_CORRECTION"],
  {
    EXTERNAL_LOAN_COMPLETION: { label: "External loan completion", tone: "neutral" },
    REFINANCING: { label: "Refinancing", tone: "neutral" },
    ADMINISTRATIVE_CORRECTION: { label: "Administrative correction (lender approval)", tone: "neutral" },
  },
);
export const ReleaseReasonSchema = releaseReasons.schema;
export type ReleaseReason = z.infer<typeof ReleaseReasonSchema>;

// #11a Pledge display composite (S's AVAILABLE/ACTIVE/RELEASE_REQUESTED/RELEASE_REJECTED/RELEASED).
export const pledgeDisplayStates = defineVocabulary(
  ["AVAILABLE", "ACTIVE", "RELEASE_REQUESTED", "RELEASE_REJECTED", "RELEASED"],
  {
    AVAILABLE: { label: "Available", tone: "neutral" },
    ACTIVE: { label: "Active", tone: "success" },
    RELEASE_REQUESTED: { label: "Active · release requested", tone: "pending" },
    RELEASE_REJECTED: { label: "Active · release rejected", tone: "success" },
    RELEASED: { label: "Released", tone: "neutral" },
  },
);
export const PledgeDisplayStateSchema = pledgeDisplayStates.schema;
export type PledgeDisplayState = z.infer<typeof PledgeDisplayStateSchema>;

// --- #12 Case stage (projection, never editable) -----------------------------------------------

export const caseStages = defineVocabulary(
  [
    "DRAFT",
    "EVIDENCE_COLLECTION",
    "VERIFICATION",
    "LENDER_REVIEW",
    "PROPOSAL",
    "PLEDGE_ACTIVE",
    "RELEASE_REVIEW",
    "CLOSED",
    "REJECTED",
    "CANCELLED",
  ],
  {
    DRAFT: { label: "Draft", tone: "neutral" },
    EVIDENCE_COLLECTION: { label: "Evidence collection", tone: "warning" },
    VERIFICATION: { label: "Verification", tone: "pending" },
    LENDER_REVIEW: { label: "Lender review", tone: "pending" },
    PROPOSAL: { label: "Proposal", tone: "pending" },
    PLEDGE_ACTIVE: { label: "Pledge active", tone: "success" },
    RELEASE_REVIEW: { label: "Release review", tone: "pending" },
    CLOSED: { label: "Closed", tone: "neutral" },
    REJECTED: { label: "Rejected", tone: "danger" },
    CANCELLED: { label: "Cancelled", tone: "neutral" },
  },
);
export const CaseStageSchema = caseStages.schema;
export type CaseStage = z.infer<typeof CaseStageSchema>;

// --- #13 Command lifecycle (S §15.3; FAILED kept for pre-commit infrastructure failures) --------

export const commandStates = defineVocabulary(
  ["PREPARED", "SUBMITTED", "COMMITTED", "PROJECTED", "REJECTED", "FAILED", "UNKNOWN_OUTCOME", "PROJECTION_DELAYED"],
  {
    PREPARED: { label: "Prepared", tone: "neutral" },
    SUBMITTED: { label: "Submitted", tone: "pending" },
    COMMITTED: { label: "Committed", tone: "success" },
    PROJECTED: { label: "Up to date", tone: "success" },
    REJECTED: { label: "Rejected", tone: "danger" },
    FAILED: { label: "Failed", tone: "danger" },
    UNKNOWN_OUTCOME: { label: "Outcome unknown", tone: "warning" },
    PROJECTION_DELAYED: { label: "Synchronizing", tone: "pending" },
  },
);
export const CommandStateSchema = commandStates.schema;
export type CommandState = z.infer<typeof CommandStateSchema>;

// --- #14 Access grant (package share or audit grant) ------------------------------------------

export const accessGrantStates = defineVocabulary(
  ["REQUESTED", "PARTIALLY_CONSENTED", "GRANTED", "DECLINED", "REVOKED", "EXPIRED"],
  {
    REQUESTED: { label: "Requested", tone: "pending" },
    PARTIALLY_CONSENTED: { label: "Partially consented", tone: "pending" },
    GRANTED: { label: "Active", tone: "success" },
    DECLINED: { label: "Declined", tone: "neutral" },
    REVOKED: { label: "Revoked", tone: "neutral" },
    EXPIRED: { label: "Expired", tone: "warning" },
  },
);
export const AccessGrantStateSchema = accessGrantStates.schema;
export type AccessGrantState = z.infer<typeof AccessGrantStateSchema>;

// --- #14b Dealer consent request (PackageShareProposal → Consent_Grant | Consent_Decline; PackageShare →
// Share_WithdrawConsent | Share_Revoke; daml-model.md §4.6). States and labels INFERRED (need copy approval).

export const consentStates = defineVocabulary(["PENDING", "GRANTED", "DECLINED", "WITHDRAWN", "REVOKED", "EXPIRED", "CANCELLED"], {
  PENDING: { label: "Awaiting consent", tone: "pending" },
  GRANTED: { label: "Consent granted", tone: "success" },
  DECLINED: { label: "Declined", tone: "neutral" },
  WITHDRAWN: { label: "Consent withdrawn", tone: "neutral" },
  REVOKED: { label: "Revoked by the owner", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "warning" },
  CANCELLED: { label: "Request withdrawn by the owner", tone: "neutral" },
});
export const ConsentStateSchema = consentStates.schema;
export type ConsentState = z.infer<typeof ConsentStateSchema>;

// --- #15–#16 Invitation, organization, membership, party binding (inferred) -------------------

export const invitationStates = defineVocabulary(["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "REVOKED"], {
  PENDING: { label: "Pending", tone: "pending" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  DECLINED: { label: "Declined", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "warning" },
  REVOKED: { label: "Revoked", tone: "neutral" },
});
export const InvitationStateSchema = invitationStates.schema;
export type InvitationState = z.infer<typeof InvitationStateSchema>;

export const organizationStates = defineVocabulary(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "SUSPENDED"], {
  DRAFT: { label: "Draft", tone: "neutral" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "pending" },
  ACTIVE: { label: "Active", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
});
export const OrganizationStateSchema = organizationStates.schema;
export type OrganizationState = z.infer<typeof OrganizationStateSchema>;

export const membershipStates = defineVocabulary(["PENDING", "ACTIVE", "DISABLED"], {
  PENDING: { label: "Pending", tone: "pending" },
  ACTIVE: { label: "Active", tone: "success" },
  DISABLED: { label: "Disabled", tone: "neutral" },
});
export const MembershipStateSchema = membershipStates.schema;
export type MembershipState = z.infer<typeof MembershipStateSchema>;

export const partyBindingStates = defineVocabulary(["REQUESTED", "ACTIVE", "REVOKED"], {
  REQUESTED: { label: "Requested", tone: "pending" },
  ACTIVE: { label: "Active", tone: "success" },
  REVOKED: { label: "Revoked", tone: "neutral" },
});
export const PartyBindingStateSchema = partyBindingStates.schema;
export type PartyBindingState = z.infer<typeof PartyBindingStateSchema>;

// --- #17 Export job --------------------------------------------------------------------------

export const exportJobStates = defineVocabulary(["QUEUED", "GENERATING", "READY", "EXPIRED", "FAILED"], {
  QUEUED: { label: "Queued", tone: "pending" },
  GENERATING: { label: "Generating", tone: "pending" },
  READY: { label: "Ready", tone: "success" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },
});
export const ExportJobStateSchema = exportJobStates.schema;
export type ExportJobState = z.infer<typeof ExportJobStateSchema>;

// --- #18 Governance proposal (DM lifecycle: confirm-only, no reject votes; CR-28) --------------

export const governanceProposalStates = defineVocabulary(["OPEN", "EXECUTABLE", "EXECUTED", "CANCELLED", "STALE"], {
  OPEN: { label: "Open", tone: "pending" },
  EXECUTABLE: { label: "Ready to execute", tone: "info" },
  EXECUTED: { label: "Executed", tone: "success" },
  CANCELLED: { label: "Withdrawn by proposer", tone: "neutral" },
  STALE: { label: "Stale", tone: "warning" },
});
export const GovernanceProposalStateSchema = governanceProposalStates.schema;
export type GovernanceProposalState = z.infer<typeof GovernanceProposalStateSchema>;

export const seatConfirmationStates = defineVocabulary(["NONE", "CONFIRMED", "EXPIRED"], {
  NONE: { label: "Not confirmed", tone: "neutral" },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  EXPIRED: { label: "Confirmation expired", tone: "warning" },
});
export const SeatConfirmationStateSchema = seatConfirmationStates.schema;
export type SeatConfirmationState = z.infer<typeof SeatConfirmationStateSchema>;

// --- #19 Verifier registry entry (PROPOSED is display-only for an open Add proposal) ----------

export const verifierRegistryStates = defineVocabulary(["ACTIVE", "SUSPENDED", "PROPOSED"], {
  ACTIVE: { label: "Active", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  PROPOSED: { label: "Proposed", tone: "pending" },
});
export const VerifierRegistryStateSchema = verifierRegistryStates.schema;
export type VerifierRegistryState = z.infer<typeof VerifierRegistryStateSchema>;

// --- #20 Pilot request ------------------------------------------------------------------------

export const pilotRequestStates = defineVocabulary(["RECEIVED", "NOTIFIED", "NOTIFY_RETRY"], {
  RECEIVED: { label: "Received", tone: "success" },
  NOTIFIED: { label: "Team notified", tone: "success" },
  NOTIFY_RETRY: { label: "Notification queued for retry", tone: "pending" },
});
export const PilotRequestStateSchema = pilotRequestStates.schema;
export type PilotRequestState = z.infer<typeof PilotRequestStateSchema>;

// --- Audit event kind (operational clicks vs ledger events, S §9.17) ---------------------------

export const eventKinds = defineVocabulary(["COMMITTED", "OPERATIONAL", "PENDING"], {
  COMMITTED: { label: "Committed", tone: "success" },
  OPERATIONAL: { label: "Operational", tone: "neutral" },
  PENDING: { label: "Pending", tone: "pending" },
});
export const EventKindSchema = eventKinds.schema;
export type EventKind = z.infer<typeof EventKindSchema>;

/** Every vocabulary, keyed by machine name (useful for docs and exhaustive tests). */
export const VOCABULARIES = {
  dataSource: dataSources,
  assetLifecycle: assetLifecycleStates,
  evidenceUpload: evidenceUploadStates,
  evidenceScan: evidenceScanStates,
  evidenceLedger: evidenceLedgerStates,
  integrity: integrityStates,
  evidenceReview: evidenceReviewStates,
  verification: verificationStates,
  checkResult: checkResults,
  attestationValidity: attestationValidityStates,
  review: reviewStates,
  proposal: proposalStates,
  activationAuthorization: activationAuthorizationStates,
  assetControl: assetControlStates,
  lock: lockStates,
  releaseRequest: releaseRequestStates,
  releaseReason: releaseReasons,
  pledgeDisplay: pledgeDisplayStates,
  caseStage: caseStages,
  command: commandStates,
  accessGrant: accessGrantStates,
  consent: consentStates,
  invitation: invitationStates,
  organization: organizationStates,
  membership: membershipStates,
  partyBinding: partyBindingStates,
  exportJob: exportJobStates,
  governanceProposal: governanceProposalStates,
  seatConfirmation: seatConfirmationStates,
  verifierRegistry: verifierRegistryStates,
  pilotRequest: pilotRequestStates,
  eventKind: eventKinds,
} as const;
