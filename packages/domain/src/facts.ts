// Normalized internal facts. The API builds these from projections + application records; the
// UI_MOCK client builds them from fixtures. Presenters turn (facts, viewer) into DTOs, omitting
// whatever the viewer may not see. Dates are ISO-8601 UTC strings.
import { z } from "zod";
import type { Money } from "./money";
import type { OrgId, Role } from "./roles";
import type {
  AccessGrantState,
  ActivationAuthorizationState,
  AssessmentOutcome,
  AssetControlState,
  AssetLifecycleState,
  CheckResult,
  EventKind,
  EvidenceLedgerState,
  EvidenceReviewState,
  EvidenceUploadState,
  ExportJobState,
  IntegrityState,
  LockState,
  ProposalState,
  ReleaseReason,
  ReleaseRequestState,
  ReviewState,
  VerificationState,
} from "./states";

// --- Documents --------------------------------------------------------------------------------

export const DOCUMENT_TYPES = [
  "DEALER_INVOICE",
  "EQUIPMENT_PHOTOS",
  "INSPECTION_REPORT",
  "MAINTENANCE_SUMMARY",
  "PURCHASE_AGREEMENT",
  "OTHER",
] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DOCUMENT_TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  DEALER_INVOICE: "Dealer invoice",
  EQUIPMENT_PHOTOS: "Equipment photos",
  INSPECTION_REPORT: "Inspection report",
  MAINTENANCE_SUMMARY: "Maintenance summary",
  PURCHASE_AGREEMENT: "Purchase agreement",
  OTHER: "Other document",
};

/** MP's four required documents (CR-51); the purchase agreement is an optional fifth. */
export const REQUIRED_DOCUMENT_TYPES: readonly DocumentType[] = [
  "DEALER_INVOICE",
  "EQUIPMENT_PHOTOS",
  "INSPECTION_REPORT",
  "MAINTENANCE_SUMMARY",
];

/** File policy (S L1178): PDF, JPEG, PNG; max 20 MB per file. A product policy, not a Canton limit. */
export const EVIDENCE_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const EvidenceContentTypeSchema = z.enum(EVIDENCE_CONTENT_TYPES);
export type EvidenceContentType = z.infer<typeof EvidenceContentTypeSchema>;
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;

export interface ActorStamp {
  readonly orgId: OrgId;
  readonly userId: string | null;
  /** Display line, e.g. "Demo Manufacturer · Owner" or "Inspector · Demo Verifier". */
  readonly label: string;
}

export interface DocumentVersionFacts {
  version: number;
  uploadedAt: string;
  uploadedBy: ActorStamp;
  fileName: string;
  contentType: EvidenceContentType;
  sizeBytes: number | null;
  sha256: string | null;
  uploadState: EvidenceUploadState;
  integrity: IntegrityState;
}

export interface EvidenceDocumentFacts {
  ref: string; // DOC-001
  type: DocumentType;
  title: string;
  /** "PDF · 4 pages", "JPEG · 6 files" */
  mediaSummary: string;
  sourceOrgId: OrgId;
  versions: DocumentVersionFacts[];
  reviewState: EvidenceReviewState;
  ledgerState: EvidenceLedgerState;
}

export interface ManifestEntry {
  documentRef: string;
  version: number;
}

export interface EvidencePackageFacts {
  ref: string; // PKG-001
  version: number;
  entries: ManifestEntry[];
  history: { version: number; committedAt: string }[];
}

// --- Verification -----------------------------------------------------------------------------

/**
 * Purpose of the owner-signed PackageShare that grants the assigned verifier the documents selected for one
 * verification request (daml-model.md §4.6, "Verification evidence grants"). Lender shares use LENDER_REVIEW.
 */
export const VERIFICATION_GRANT_PURPOSE = "VERIFICATION";

/**
 * Share reference of a verification grant, which binds it to one request and evidence version:
 * `<requestRef>-G<manifestVersion>` for the owner's documents, `<requestRef>-G<manifestVersion>-D<n>` for the
 * documents of dealer n (granted by that dealer's Consent_Grant).
 */
export function verificationGrantRef(requestRef: string, manifestVersion: number, dealerIndex?: number): string {
  return `${requestRef}-G${manifestVersion}${dealerIndex === undefined ? "" : `-D${dealerIndex}`}`;
}

/** The request a verification grant reference belongs to, or null when the reference is not one. */
export function verificationGrantRequestRef(shareRef: string): string | null {
  return /^(.+)-G\d+(?:-D\d+)?$/.exec(shareRef)?.[1] ?? null;
}

export interface VerificationFacts {
  ref: string; // VR-001
  assetRef: string;
  /** Asset-level requests (CR-14) have no case; case-scoped requests make the verifier a case participant. */
  caseRef: string | null;
  verifierOrgId: OrgId;
  verifierRegistryRef: string; // VER-001
  requestedByOrgId: OrgId;
  scope: string[];
  /** Documents disclosed to the verifier for this assignment. */
  documentRefs: string[];
  /**
   * The exact versions granted to the verifier for the request's current evidence version (its active
   * VERIFICATION grants). Absent for requests recorded without a grant (legacy fixtures): no version scoping.
   */
  documentVersions?: ManifestEntry[];
  packageVersion: number;
  state: VerificationState;
  requestedAt: string;
  updatedAt: string;
  dueAt: string | null;
  attestationRef: string | null;
  lastMessage: string | null;
}

export interface CheckFacts {
  item: string;
  finding: string;
  result: CheckResult;
}

export interface AttestationFacts {
  ref: string; // ATT-001
  verificationRef: string;
  assetRef: string;
  issuerOrgId: OrgId;
  verifierRegistryRef: string;
  method: string;
  inspectedAt: string;
  issuedAt: string;
  validFrom: string;
  validUntil: string;
  checks: CheckFacts[];
  limitations: string;
  packageRef: string;
  packageVersion: number;
  supportingVersions: ManifestEntry[];
  supersedes: string | null;
  supersededBy: string | null;
  revokedAt: string | null;
}

// --- Asset (passport, evidence, verification, canonical control) --------------------------------

export interface AssetControlFacts {
  version: number;
  state: AssetControlState;
  /** Set while the control token is held inside a lock. */
  lockRef: string | null;
}

export interface AssetFacts {
  ref: string; // ASSET-DEMO-001
  namespace: string;
  equipmentClass: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  yearOfManufacture: number | null;
  ownerOrgId: OrgId;
  ownerClaimSource: string;
  locationScope: string;
  claimedAcquisitionValue: Money | null;
  lifecycle: AssetLifecycleState;
  createdAt: string;
  registeredAt: string | null;
  updatedAt: string;
  passportVersion: number;
  documents: EvidenceDocumentFacts[];
  package: EvidencePackageFacts;
  verifications: VerificationFacts[];
  attestations: AttestationFacts[];
  control: AssetControlFacts;
  /** Asset, evidence and verification events (case events live on the case). */
  events: EventFacts[];
}

// --- Case -------------------------------------------------------------------------------------

export const ACCESS_PERMISSIONS = ["VIEW", "VIEW_DOWNLOAD", "VIEW_EXPORT"] as const;
export const AccessPermissionSchema = z.enum(ACCESS_PERMISSIONS);
export type AccessPermission = z.infer<typeof AccessPermissionSchema>;

export interface ShareFacts {
  ref: string; // AG-001
  recipientOrgId: OrgId;
  purpose: "LENDER_REVIEW";
  packageRef: string;
  packageVersion: number;
  entries: ManifestEntry[];
  permission: Exclude<AccessPermission, "VIEW_EXPORT">;
  state: AccessGrantState;
  consentingOrgIds: OrgId[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface AssessmentFacts {
  valuation: Money;
  valuationSource: string;
  valuationDate: string;
  limitations: string;
  outcome: AssessmentOutcome;
  policyRef: string;
  version: number;
  savedAt: string;
  savedByUserId: string;
  requiredExternalChecks: { label: string; status: string }[];
}

export interface ReviewFacts {
  ref: string; // CA-001
  lenderOrgId: OrgId;
  state: ReviewState;
  analystUserId: string | null;
  approverUserId: string | null;
  startedAt: string | null;
  submittedForApprovalAt: string | null;
  evidenceSnapshot: ManifestEntry[] | null;
  snapshotPackageVersion: number | null;
  assessment: AssessmentFacts | null;
  /** Lender-org only. Never sent to counterparties. */
  internalNotes: string | null;
  /** Feedback recorded for the borrower. */
  sharedFeedback: string | null;
  informationRequest: string | null;
  decision: { outcome: "ELIGIBLE" | "REJECTED"; decidedAt: string; decidedByUserId: string } | null;
}

export interface ProposalVersionFacts {
  ref: string; // FP-001 (stable across versions)
  version: number;
  state: ProposalState;
  lenderOrgId: OrgId;
  principal: Money;
  termMetadata: string | null;
  financingRef: string | null;
  externalLegalRef: string | null;
  expiresAt: string;
  draftedAt: string;
  draftedByUserId: string;
  issuedAt: string | null;
  issuedByUserId: string | null;
  respondedAt: string | null;
  respondedByUserId: string | null;
  withdrawnAt: string | null;
  note: string | null;
}

export interface ActivationAuthorizationFacts {
  state: ActivationAuthorizationState;
  proposalRef: string;
  proposalVersion: number;
  attestationRef: string;
  packageVersion: number;
  controlVersion: number;
  authorizedAt: string;
  authorizedByUserId: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface LockFacts {
  ref: string; // PL-001
  state: LockState;
  lenderOrgId: OrgId;
  borrowerOrgId: OrgId;
  activatedAt: string;
  activatedByUserId: string;
  proposalRef: string;
  proposalVersion: number;
  attestationRef: string;
  packageRef: string;
  packageVersion: number;
  /** Control version consumed by activation (e.g. 3) and the version held by the lock (4). */
  controlVersionConsumed: number;
  controlVersionLocked: number;
  releasedAt: string | null;
  releasedByUserId: string | null;
  /** Control version recreated on release (e.g. 5). */
  controlVersionAfterRelease: number | null;
}

export interface ReleaseRequestFacts {
  ref: string; // RR-001
  lockRef: string;
  state: ReleaseRequestState;
  reason: ReleaseReason;
  note: string | null;
  servicingRef: string | null;
  requestedByOrgId: OrgId;
  requestedByUserId: string;
  requestedAt: string;
  informationRequest: string | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decisionReason: string | null;
  /** Private note thread (off-ledger note store): the lock's owner and designated lender only. */
  thread?: ReleaseThreadEntryFacts[];
}

/** One entry of a release request's note thread: the request note, a lender question or a borrower response. */
export interface ReleaseThreadEntryFacts {
  kind: "NOTE" | "QUESTION" | "RESPONSE";
  body: string;
  authorOrgId: OrgId;
  authorUserId: string;
  at: string;
}

export const AUDIT_SCOPES = [
  "EVIDENCE_MANIFEST",
  "ATTESTATION",
  "DECISION_OUTCOME",
  "PROPOSAL_TERMS",
  "PLEDGE_RELEASE_EVENTS",
] as const;
export const AuditScopeSchema = z.enum(AUDIT_SCOPES);
export type AuditScope = z.infer<typeof AuditScopeSchema>;

export const AUDIT_SCOPE_LABELS: Readonly<Record<AuditScope, string>> = {
  EVIDENCE_MANIFEST: "Evidence manifest",
  ATTESTATION: "Attestation",
  DECISION_OUTCOME: "Decision outcome",
  PROPOSAL_TERMS: "Proposal terms",
  PLEDGE_RELEASE_EVENTS: "Pledge and release events",
};

/**
 * Record owners per scope. A scope is effective for an auditor only when every owner of the
 * underlying records has granted it ("multiple data owners may need separate consent", §1.5 #14).
 */
export const AUDIT_SCOPE_OWNERS: Readonly<Record<AuditScope, readonly ("OWNER" | "LENDER")[]>> = {
  EVIDENCE_MANIFEST: ["OWNER"],
  ATTESTATION: ["OWNER"],
  DECISION_OUTCOME: ["LENDER"],
  PROPOSAL_TERMS: ["OWNER", "LENDER"],
  PLEDGE_RELEASE_EVENTS: ["OWNER", "LENDER"],
};

export interface AuditGrantFacts {
  ref: string; // AG-002
  grantorOrgId: OrgId;
  grantorSide: "OWNER" | "LENDER";
  grantedByUserId: string;
  auditorOrgId: OrgId;
  scopes: AuditScope[];
  permission: "VIEW" | "VIEW_EXPORT";
  purpose: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export const REPORT_FORMATS = ["JSON", "CSV"] as const;
export const ReportFormatSchema = z.enum(REPORT_FORMATS);
export type ReportFormat = z.infer<typeof ReportFormatSchema>;
export const REPORT_SCHEMA_VERSION = "collara.case-report/v1";

export interface ExportFacts {
  ref: string; // RPT-0001
  caseRef: string;
  format: ReportFormat;
  state: ExportJobState;
  requestedByOrgId: OrgId;
  requestedByUserId: string;
  requestedRole: Role;
  requestedAt: string;
  generatedAt: string | null;
  cutoff: { offset: number | null; at: string };
  checksum: string | null;
  scopeLabel: string;
  schemaVersion: string;
  expiresAt: string | null;
  /** Auditor exports: the effective scopes at generation; each must still be granted at download. */
  auditScopes: AuditScope[] | null;
}

export interface CaseFacts {
  ref: string; // CL-001
  title: string;
  purpose: string | null;
  createdAt: string;
  createdByUserId: string;
  borrowerOrgId: OrgId;
  dealerOrgId: OrgId | null;
  selectedLenderOrgId: OrgId | null;
  /** Requested principal is financing-term data: borrower and selected lender only. */
  requestedPrincipal: Money | null;
  policyRef: string;
  asset: AssetFacts;
  shares: ShareFacts[];
  review: ReviewFacts;
  /** Every proposal version, oldest first. */
  proposals: ProposalVersionFacts[];
  activation: ActivationAuthorizationFacts | null;
  lock: LockFacts | null;
  releaseRequests: ReleaseRequestFacts[];
  auditGrants: AuditGrantFacts[];
  exports: ExportFacts[];
  events: EventFacts[];
  cancelledAt: string | null;
  closedAt: string | null;
}

// --- Events -----------------------------------------------------------------------------------

export type AudienceTag = "OWNER" | "DEALER" | "VERIFIER" | "LENDER" | "AUDITOR";
export type EventCategory =
  | "ASSET"
  | "EVIDENCE"
  | "VERIFICATION"
  | "CASE"
  | "SHARING"
  | "REVIEW"
  | "PROPOSAL"
  | "PLEDGE"
  | "RELEASE"
  | "AUDIT"
  | "EXPORT";

export interface EventTypeMeta {
  readonly summary: string;
  readonly category: EventCategory;
  /** Who may see the event (the acting organization always sees its own events). */
  readonly audience: readonly AudienceTag[];
  /** Audit scope that exposes the event to a granted auditor: ANY = any active grant; NONE = never. */
  readonly auditScope: AuditScope | "ANY" | "NONE";
}

const ALL_PARTICIPANTS: readonly AudienceTag[] = ["OWNER", "DEALER", "VERIFIER", "LENDER"];
const VERIFICATION_AUDIENCE: readonly AudienceTag[] = ["OWNER", "VERIFIER", "LENDER"];
const BORROWER_LENDER: readonly AudienceTag[] = ["OWNER", "LENDER"];

export const EVENT_TYPES = {
  PASSPORT_REGISTERED: { summary: "Passport registered", category: "ASSET", audience: ALL_PARTICIPANTS, auditScope: "EVIDENCE_MANIFEST" },
  EVIDENCE_UPLOADED: { summary: "Evidence uploaded", category: "EVIDENCE", audience: ALL_PARTICIPANTS, auditScope: "EVIDENCE_MANIFEST" },
  EVIDENCE_VERSION_ADDED: { summary: "Evidence version added", category: "EVIDENCE", audience: ALL_PARTICIPANTS, auditScope: "EVIDENCE_MANIFEST" },
  VERIFICATION_REQUESTED: { summary: "Verification requested", category: "VERIFICATION", audience: VERIFICATION_AUDIENCE, auditScope: "ATTESTATION" },
  ASSIGNMENT_ACCEPTED: { summary: "Assignment accepted", category: "VERIFICATION", audience: VERIFICATION_AUDIENCE, auditScope: "ATTESTATION" },
  ASSIGNMENT_DECLINED: { summary: "Assignment declined", category: "VERIFICATION", audience: VERIFICATION_AUDIENCE, auditScope: "ATTESTATION" },
  CHANGES_REQUESTED: { summary: "Changes requested", category: "VERIFICATION", audience: VERIFICATION_AUDIENCE, auditScope: "ATTESTATION" },
  EVIDENCE_RESUBMITTED: { summary: "New evidence version submitted for verification", category: "VERIFICATION", audience: VERIFICATION_AUDIENCE, auditScope: "ATTESTATION" },
  ATTESTATION_ISSUED: { summary: "Attestation issued", category: "VERIFICATION", audience: VERIFICATION_AUDIENCE, auditScope: "ATTESTATION" },
  VERIFICATION_REJECTED: { summary: "Verification rejected", category: "VERIFICATION", audience: VERIFICATION_AUDIENCE, auditScope: "ATTESTATION" },
  CASE_CREATED: { summary: "Case created", category: "CASE", audience: ["OWNER", "DEALER", "LENDER"], auditScope: "ANY" },
  PACKAGE_SHARED: { summary: "Package shared", category: "SHARING", audience: ["OWNER", "DEALER", "LENDER"], auditScope: "EVIDENCE_MANIFEST" },
  ACCESS_REVOKED: { summary: "Future document access revoked", category: "SHARING", audience: ["OWNER", "DEALER", "LENDER"], auditScope: "EVIDENCE_MANIFEST" },
  REVIEW_STARTED: { summary: "Review started", category: "REVIEW", audience: ["LENDER"], auditScope: "DECISION_OUTCOME" },
  ASSESSMENT_SAVED: { summary: "Assessment draft saved", category: "REVIEW", audience: ["LENDER"], auditScope: "NONE" },
  SUBMITTED_FOR_APPROVAL: { summary: "Assessment submitted for approval", category: "REVIEW", audience: ["LENDER"], auditScope: "NONE" },
  INFORMATION_REQUESTED: { summary: "Information requested", category: "REVIEW", audience: BORROWER_LENDER, auditScope: "DECISION_OUTCOME" },
  DECISION_RECORDED: { summary: "Collateral decision recorded", category: "REVIEW", audience: BORROWER_LENDER, auditScope: "DECISION_OUTCOME" },
  PROPOSAL_DRAFTED: { summary: "Proposal drafted", category: "PROPOSAL", audience: ["LENDER"], auditScope: "NONE" },
  PROPOSAL_ISSUED: { summary: "Proposal issued", category: "PROPOSAL", audience: BORROWER_LENDER, auditScope: "PROPOSAL_TERMS" },
  PROPOSAL_WITHDRAWN: { summary: "Proposal withdrawn", category: "PROPOSAL", audience: BORROWER_LENDER, auditScope: "PROPOSAL_TERMS" },
  PROPOSAL_ACCEPTED: { summary: "Proposal accepted · exact version", category: "PROPOSAL", audience: BORROWER_LENDER, auditScope: "PROPOSAL_TERMS" },
  PROPOSAL_DECLINED: { summary: "Proposal declined", category: "PROPOSAL", audience: BORROWER_LENDER, auditScope: "PROPOSAL_TERMS" },
  ACTIVATION_AUTHORIZED: { summary: "Pledge activation authorized", category: "PLEDGE", audience: BORROWER_LENDER, auditScope: "PLEDGE_RELEASE_EVENTS" },
  PLEDGE_ACTIVATED: { summary: "Pledge activated", category: "PLEDGE", audience: BORROWER_LENDER, auditScope: "PLEDGE_RELEASE_EVENTS" },
  RELEASE_REQUESTED: { summary: "Release requested", category: "RELEASE", audience: BORROWER_LENDER, auditScope: "PLEDGE_RELEASE_EVENTS" },
  RELEASE_INFORMATION_REQUESTED: { summary: "Release information requested", category: "RELEASE", audience: BORROWER_LENDER, auditScope: "PLEDGE_RELEASE_EVENTS" },
  RELEASE_INFORMATION_PROVIDED: { summary: "Release information provided", category: "RELEASE", audience: BORROWER_LENDER, auditScope: "PLEDGE_RELEASE_EVENTS" },
  RELEASE_AUTHORIZED: { summary: "Release authorized", category: "RELEASE", audience: BORROWER_LENDER, auditScope: "PLEDGE_RELEASE_EVENTS" },
  RELEASE_REJECTED: { summary: "Release rejected · lock remains active", category: "RELEASE", audience: BORROWER_LENDER, auditScope: "PLEDGE_RELEASE_EVENTS" },
  RELEASE_WITHDRAWN: { summary: "Release request withdrawn", category: "RELEASE", audience: BORROWER_LENDER, auditScope: "PLEDGE_RELEASE_EVENTS" },
  AUDIT_GRANT_CREATED: { summary: "Audit access granted", category: "AUDIT", audience: ["AUDITOR"], auditScope: "ANY" },
  AUDIT_GRANT_REVOKED: { summary: "Audit access revoked", category: "AUDIT", audience: ["AUDITOR"], auditScope: "ANY" },
  REPORT_GENERATED: { summary: "Case report exported", category: "EXPORT", audience: [], auditScope: "NONE" },
} as const satisfies Record<string, EventTypeMeta>;

export type EventType = keyof typeof EVENT_TYPES;
export const EVENT_TYPE_VALUES = Object.keys(EVENT_TYPES) as [EventType, ...EventType[]];
export const EventTypeSchema = z.enum(EVENT_TYPE_VALUES);

export function eventTypeMeta(type: EventType): EventTypeMeta {
  return EVENT_TYPES[type];
}

export interface EventFacts {
  id: string;
  occurredAt: string;
  /** Reference(s) the event is about, e.g. "VR-001" or "DOC-001, DOC-002". */
  ref: string;
  type: EventType;
  /** Optional detail appended to the summary, e.g. "Equipment photos, Purchase agreement". */
  detail: string | null;
  actor: ActorStamp & { role: Role | null };
  stateChange: { from: string | null; to: string } | null;
  version: string | null;
  kind: EventKind;
  /** Present only for events observed on the ledger (LOCALNET). Never fabricated in UI_MOCK. */
  commit: { updateId: string; offset: number } | null;
}
