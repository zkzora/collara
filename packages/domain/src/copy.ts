// Approved UI copy, verbatim. Do not reword. Sources:
//   MP  = master brief (collara-full-stack-master-prompt.md), via synthesis §1.1
//   S   = system spec (collara-full-website-system.md), line refs as quoted in docs/_research
//   P-* = prototype microcopy (docs/_research/proto-dashboard.md, proto-landing-docs.md)
// Strings marked INFERRED are not approved copy yet; they exist because a screen needs a string.
import type { RuntimeMode } from "./states";

/** MP L101–102. UI_MOCK must never display `Confirmed on the ledger.` */
export const MODE_BANNERS: Readonly<Record<RuntimeMode, string>> = {
  UI_MOCK: "Synthetic demo data — UI mockup.",
  LOCALNET: "Synthetic demo data — Canton LocalNet.",
};

/** Header environment chip, matching the real connection (S L542; `UI mockup` value INFERRED). */
export const ENVIRONMENT_CHIPS: Readonly<Record<RuntimeMode, string>> = {
  UI_MOCK: "UI mockup",
  LOCALNET: "LocalNet",
};

/** Command lifecycle copy (S §18.2 L1125–1136). */
export const COMMAND_COPY = {
  SUBMITTED: "Submitted. Waiting for ledger confirmation.",
  /** LOCALNET only, and only with an update id. */
  COMMITTED: "Confirmed on the ledger.",
  PROJECTION_DELAYED: "The action is confirmed. This view is still synchronizing.",
  UNKNOWN_OUTCOME: "Confirmation is delayed. We are checking the original submission before retrying.",
  STATE_CHANGED: "This action could not complete because the asset workflow state changed.",
  LEDGER_UNAVAILABLE: "The ledger is unavailable. No confirmed state change has been recorded.",
} as const;

/** INFERRED (needs copy approval): UI_MOCK and application-record outcomes never claim ledger confirmation. */
export const SIMULATED_COPY = {
  RECORDED_IN_MOCKUP: "Recorded in the UI mockup. No ledger transaction was submitted.",
  APPLICATION_RECORD_SAVED: "Saved as an application record. No ledger transaction was submitted.",
  /** P-Dash §3.11 governance toasts. */
  GOVERNANCE_RECORDED: "Recorded in the governance simulation.",
  GOVERNANCE_EXECUTED: "Executed in the governance simulation. Registry updated.",
  GOVERNANCE_PROPOSED: "Proposal opened in the governance simulation.",
} as const;

/** Errors (S §18.2, S §7.2, S §6.1). */
export const ERROR_COPY = {
  /** 404-shaped responses for unrelated parties; never reveals existence (S L1132). */
  UNAVAILABLE: "This record is unavailable to your account.",
  RELEASE_UNAUTHORIZED: "Release requires the designated lender's authorization.",
  HASH_MISMATCH: "The file does not match its recorded integrity reference.",
  INVITATION_EXPIRED: "This invitation has expired.",
  INVITATION_WRONG_ACCOUNT: "This invitation cannot be used with your account.",
  PILOT_SUBMIT_FAILED: "We couldn't submit your request. Please try again.",
  /** INFERRED (needs copy approval). */
  FORBIDDEN: "Your role or mandate does not permit this action.",
  /** INFERRED (needs copy approval). */
  IDEMPOTENCY_CONFLICT: "This request key was already used for a different action.",
  /** INFERRED (needs copy approval). */
  VALIDATION: "Some fields need attention.",
} as const;

/** Status and boundary copy (S §18.2, S §9). */
export const STATUS_COPY = {
  EVIDENCE_MISSING: "Required evidence is missing. Review the checklist before submitting.",
  EVIDENCE_STALE: "The reviewed evidence has changed. A new review is required.",
  ATTESTATION_EXPIRED: "This attestation is outside its validity period.",
  REVIEW_ELIGIBLE: "Eligible for this lender and case. Financing is not yet active.",
  RELEASE_PENDING: "Release requested. The collateral lock remains active.",
  ACCESS_REVOKED: "Future document access has been revoked. Previously shared copies may still exist.",
  SCOPED_EXPORT: "This report includes only records available within your access scope.",
  REGISTER_ASSET_WARNING: "Submitted ownership evidence has not yet been independently verified.",
} as const;

/** Confirmation-dialog caveats (S §9.9, §9.12, §9.15, §9.18). */
export const CONFIRMATION_COPY = {
  ATTESTATION: "This attestation records the checks listed above. It does not approve financing or establish legal lien priority.",
  PROPOSAL_ACCEPT: "Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.",
  RELEASE: "This releases the Collara workflow lock. Any required legal lien termination must be completed separately.",
  REPORT_LABEL: "Case workflow report — not a legal title or lien certificate.",
} as const;

/** Empty states (S §9.1, §9.2). */
export const EMPTY_STATE_COPY = {
  OVERVIEW: "No cases require your action.",
  NEW_CASE: "Create a case to coordinate equipment evidence and lender review.",
} as const;

/** /pilot form (S §6.1). Consent text, retention period and notification inbox are BPD-1 (blocked). */
export const PILOT_COPY = {
  HEADING: "Tell us about your equipment-finance workflow.",
  DESCRIPTION:
    "We are looking for teams handling used CNC financing to help define and test a focused coordination workflow.",
  SUBMIT: "Request a conversation",
  SUCCESS: "Your request has been received. We will contact you using the email provided.",
  ERROR: "We couldn't submit your request. Please try again.",
  DISCLAIMER: "A pilot request is not a loan application. Do not submit financial documents through this form.",
} as const;

/** Prototype boundary microcopy (P-Dash §3.3–§3.7). */
export const BOUNDARY_COPY = {
  HASH_MATCH:
    "A hash match confirms the file bytes match the committed integrity reference. It does not establish that a document is original, genuine, or legally enforceable. Downloads use short-lived links issued after a server-side access check.",
  ACTIVITY_KINDS:
    "Committed events are ledger transactions. Operational events are application actions and are not evidence of a state change.",
  AUDIT_EVENTS:
    "Operational events (uploads, drafts, views) are application actions. Only ledger-committed events change workflow state. Failed or unknown commands never appear as successful lifecycle events.",
  SHARING_TERMS:
    "Loan terms are disclosed only to the borrower and the selected lender. Revoking a grant limits future document access; previously shared copies may still exist.",
  NO_BULK: "Bulk approval and bulk release are not available. Sensitive decisions are recorded per case.",
  WHAT_DOES_NOT_RELEASE:
    "A maturity date, an uploaded proof of repayment, case cancellation, or an operator or governance action. Only the designated lender's authorization does.",
  /** First sentence of the prototype note; the "never summed" sentence is dropped per CR-13. */
  VALUATION_PRINCIPAL_SEPARATE: "Valuation and principal are separate fields.",
  PROPOSAL_EMPTY:
    "A financing proposal can be issued by an authorized approver after the collateral decision for this case is recorded. Issuing a proposal creates a workflow record; it does not disburse funds.",
  /** Adapted from the prototype ("…applies to Demo Lender A and case CL-001 only…"); needs copy approval. */
  REVIEW_SCOPE:
    "Eligibility applies to this lender and case only. It does not make the passport eligible elsewhere and it does not promise funding.",
  /** P-Docs §3.8 info callout. */
  GOVERNANCE_SCOPE:
    "Governance controls verifier-registry administration only. It never authorizes collateral release. Collateral decisions, financing proposals, pledge activation, and release remain under lender mandates and are not subject to governance votes.",
  /** INFERRED (needs copy approval); MP L137 requires the UI to say the MVP does not scan. */
  NOT_SCANNED: "Uploads are not virus-scanned in this synthetic-only demo.",
} as const;

/** Per-currency figure labels (S §9.1, §13.3). Never `TVL`. */
export const FIGURE_LABELS = {
  RECORDED_PRINCIPAL: "Recorded financing principal",
  RECORDED_VALUATION: "Recorded collateral valuation",
} as const;

/**
 * Governance integration status (synthesis §1.1; strings INFERRED, need copy approval).
 * `SIMULATED` is the only honest value in UI_MOCK.
 */
export const GOVERNANCE_INTEGRATION_LABELS = {
  SIMULATED: "Simulated",
  // Synthesis §3 (BitSafe DM, Tier A) UI label.
  PARTIAL_TIER_A: "Partial — governance contracts on one local participant; decentralized party not demonstrated",
  DM_TIER_B: "Decentralization Manager · local 3-node topology · one operator",
  UNAVAILABLE: "Unavailable",
} as const;
export type GovernanceIntegrationStatus = keyof typeof GOVERNANCE_INTEGRATION_LABELS;
