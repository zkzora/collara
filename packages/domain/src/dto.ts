// Wire contract between the API, the web UI (HTTP and UI_MOCK clients) and tests. Every response
// is Zod-parsed by the client. Fields a viewer may not see are OMITTED server-side (null or absent),
// never sent and hidden (MP L97).
import { z } from "zod";
import { CapabilityStatusSchema } from "./capabilities";
import {
  AccessPermissionSchema,
  AuditScopeSchema,
  DocumentTypeSchema,
  EvidenceContentTypeSchema,
  EVIDENCE_MAX_BYTES,
  EventTypeSchema,
  ReportFormatSchema,
} from "./facts";
import { MoneySchema } from "./money";
import { CASE_ACTIONS, ASSET_ACTIONS, VERIFICATION_ACTIONS } from "./workflow";
import {
  AssetRefSchema,
  AttestationRefSchema,
  CaseRefSchema,
  DocumentRefSchema,
  GovernanceProposalRefSchema,
  PledgeRefSchema,
  ProposalRefSchema,
  ReleaseRequestRefSchema,
  ReportRefSchema,
  VerificationRefSchema,
  VerifierRefSchema,
} from "./refs";
import {
  GovernanceSeatSchema,
  MandateSchema,
  OrgIdSchema,
  OrgTypeSchema,
  PersonaIdSchema,
  RoleSchema,
  type Mandate,
  type Role,
} from "./roles";
import {
  AccessGrantStateSchema,
  ActivationAuthorizationStateSchema,
  AssetControlStateSchema,
  AssetLifecycleStateSchema,
  AttestationValiditySchema,
  CaseStageSchema,
  CheckResultSchema,
  CommandStateSchema,
  DataSourceSchema,
  EventKindSchema,
  EvidenceLedgerStateSchema,
  EvidenceReviewStateSchema,
  EvidenceScanStateSchema,
  EvidenceUploadStateSchema,
  ExportJobStateSchema,
  GovernanceProposalStateSchema,
  IntegrityStateSchema,
  LockStateSchema,
  PilotRequestStateSchema,
  PledgeDisplayStateSchema,
  ProposalStateSchema,
  ReleaseReasonSchema,
  ReleaseRequestStateSchema,
  ReviewStateSchema,
  RuntimeModeSchema,
  SeatConfirmationStateSchema,
  VerificationStateSchema,
  VerifierRegistryStateSchema,
  badgeSchema,
} from "./states";

// --- Common -------------------------------------------------------------------------------------

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const CursorSchema = z.string().min(1).max(200);
export const LimitSchema = z.coerce.number().int().min(1).max(100);
export const IdempotencyKeySchema = z.string().min(8).max(200);

export const OrgRefSchema = z.object({ id: OrgIdSchema, name: z.string() });
export type OrgRef = z.infer<typeof OrgRefSchema>;

/** "Demo Lender A · Analyst" style actor reference (no party ids). */
export const ActorRefSchema = z.object({
  orgId: OrgIdSchema,
  orgName: z.string(),
  role: RoleSchema.nullable(),
  label: z.string(),
  displayName: z.string().nullable(),
});
export type ActorRef = z.infer<typeof ActorRefSchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const PageQuerySchema = z.object({ cursor: CursorSchema.optional(), limit: LimitSchema.optional() });
export type PageQuery = z.infer<typeof PageQuerySchema>;

export const VersionedRefSchema = z.object({ ref: z.string(), version: z.number().int().positive() });

// --- Errors (application/problem+json) -----------------------------------------------------------

export const PROBLEM_CODES = [
  "unavailable",
  "forbidden",
  "unauthenticated",
  "state_conflict",
  "idempotency_conflict",
  "validation_error",
  "rate_limited",
  "ledger_unavailable",
  "internal_error",
] as const;
export const ProblemCodeSchema = z.enum(PROBLEM_CODES);
export type ProblemCode = z.infer<typeof ProblemCodeSchema>;

/** RFC 9457 problem details. Never reveals whether an unrelated record exists. */
export const ApiProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: ProblemCodeSchema,
  detail: z.string().optional(),
  instance: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiProblem = z.infer<typeof ApiProblemSchema>;

export const PROBLEM_STATUS: Readonly<Record<ProblemCode, number>> = {
  unavailable: 404,
  forbidden: 403,
  unauthenticated: 401,
  state_conflict: 409,
  idempotency_conflict: 409,
  validation_error: 400,
  rate_limited: 429,
  ledger_unavailable: 503,
  internal_error: 500,
};

export const PROBLEM_TITLES: Readonly<Record<ProblemCode, string>> = {
  unavailable: "Unavailable",
  forbidden: "Forbidden",
  unauthenticated: "Not signed in",
  state_conflict: "State changed",
  idempotency_conflict: "Idempotency key reused",
  validation_error: "Validation failed",
  rate_limited: "Too many requests",
  ledger_unavailable: "Ledger unavailable",
  internal_error: "Internal error",
};

/** The one problem+json shape the API and the UI_MOCK client emit (content type application/problem+json). */
export function problemFor(code: ProblemCode, detail?: string, issues?: ApiProblem["issues"]): ApiProblem {
  return {
    type: `urn:collara:problem:${code}`,
    title: PROBLEM_TITLES[code],
    status: PROBLEM_STATUS[code],
    code,
    ...(detail ? { detail } : {}),
    ...(issues?.length ? { issues } : {}),
  };
}

// --- Commands --------------------------------------------------------------------------------

export const COMMAND_TARGETS = ["LEDGER", "APPLICATION"] as const;

export const CommandStatusSchema = z.object({
  commandId: z.string().min(1),
  operation: z.string(),
  target: z.enum(COMMAND_TARGETS),
  state: CommandStateSchema,
  /** True in UI_MOCK: nothing was submitted to a ledger. */
  simulated: z.boolean(),
  /** Present only for a real ledger commit (LOCALNET). Committed success is shown only with it. */
  updateId: z.string().optional(),
  completionOffset: z.number().int().nonnegative().optional(),
  message: z.string(),
  submittedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  error: z.object({ code: z.string(), detail: z.string() }).optional(),
});
export type CommandStatus = z.infer<typeof CommandStatusSchema>;

export const CommandResponseSchema = z.object({ command: CommandStatusSchema });
export type CommandResponse = z.infer<typeof CommandResponseSchema>;

export function commandResultSchema<T extends z.ZodType>(result: T) {
  return z.object({ command: CommandStatusSchema, result });
}
export interface CommandResult<T> {
  command: CommandStatus;
  result: T;
}

// --- Session ---------------------------------------------------------------------------------

export const NAV_KEYS = ["overview", "cases", "assets", "verifications", "pledges", "audit", "governance", "settings"] as const;
export const NavKeySchema = z.enum(NAV_KEYS);
export type NavKey = z.infer<typeof NavKeySchema>;

/** Per-role navigation (S L531–535; synthesis §1.2.3 [INFERRED]). Hiding a menu item is not enforcement. */
export function navigationFor(actor: { readonly roles: readonly Role[]; readonly mandates: readonly Mandate[] }): NavKey[] {
  const roles = new Set(actor.roles);
  const keys = new Set<NavKey>(["overview"]);
  if (roles.has("BORROWER") || roles.has("LENDER_ANALYST") || roles.has("LENDER_APPROVER")) {
    for (const key of ["cases", "assets", "pledges", "audit"] as const) keys.add(key);
  }
  if (roles.has("VERIFIER")) for (const key of ["verifications", "assets", "audit"] as const) keys.add(key);
  if (roles.has("AUDITOR")) for (const key of ["cases", "audit"] as const) keys.add(key);
  if (roles.has("DEALER")) keys.add("cases");
  if (actor.mandates.some((m) => m.code === "GOVERNANCE_SEAT")) keys.add("governance");
  keys.add("settings");
  return NAV_KEYS.filter((key) => keys.has(key));
}

export const MeSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), displayName: z.string(), title: z.string().nullable() }),
  org: z.object({ id: OrgIdSchema, name: z.string(), type: OrgTypeSchema }),
  roles: z.array(RoleSchema),
  roleLabels: z.array(z.string()),
  mandates: z.array(MandateSchema),
  governanceSeat: GovernanceSeatSchema.nullable(),
  mode: RuntimeModeSchema,
  /** Demo sessions only; null for real accounts. */
  personaId: PersonaIdSchema.nullable(),
  navigation: z.array(NavKeySchema),
});
export type Me = z.infer<typeof MeSchema>;

export const DemoSessionRequestSchema = z.object({ personaId: PersonaIdSchema });
export type DemoSessionRequest = z.infer<typeof DemoSessionRequestSchema>;

export const DemoPersonaSchema = z.object({
  id: PersonaIdSchema,
  displayName: z.string(),
  title: z.string().nullable(),
  org: OrgRefSchema,
  roleLabels: z.array(z.string()),
  mandateLabels: z.array(z.string()),
});
export type DemoPersona = z.infer<typeof DemoPersonaSchema>;

// --- Cases -----------------------------------------------------------------------------------

export const SAVED_VIEWS = ["all", "mine", "ready-for-review", "needs-evidence", "awaiting-approval", "release-requests"] as const;
export const SavedViewSchema = z.enum(SAVED_VIEWS);
export type SavedView = z.infer<typeof SavedViewSchema>;
export const SAVED_VIEW_LABELS: Readonly<Record<SavedView, string>> = {
  all: "All",
  mine: "My actions",
  "ready-for-review": "Ready for review",
  "needs-evidence": "Needs evidence",
  "awaiting-approval": "Awaiting approval",
  "release-requests": "Release requests",
};

export const CASE_TABS = ["summary", "evidence", "verification", "sharing", "review", "proposal", "pledge", "activity"] as const;
export const CaseTabSchema = z.enum(CASE_TABS);
export type CaseTab = z.infer<typeof CaseTabSchema>;
export const CASE_TAB_LABELS: Readonly<Record<CaseTab, string>> = {
  summary: "Summary",
  evidence: "Evidence",
  verification: "Verification",
  sharing: "Sharing & Access",
  review: "Review",
  proposal: "Proposal",
  pledge: "Pledge",
  activity: "Activity",
};

export const CaseActionSchema = z.enum(CASE_ACTIONS);
export const AssetActionSchema = z.enum(ASSET_ACTIONS);
export const VerificationActionSchema = z.enum(VERIFICATION_ACTIONS);

export const NextActorSchema = z.object({ org: OrgRefSchema, role: RoleSchema, label: z.string() });
export const NextActionSchema = z.object({ code: z.string(), label: z.string() });
export const BlockerSchema = z.object({ code: z.string(), message: z.string() });
export const LastSyncSchema = z.object({ offset: z.number().int().nonnegative().nullable(), at: IsoDateTimeSchema.nullable() });

export const AssetBriefSchema = z.object({
  ref: AssetRefSchema,
  equipmentClass: z.string(),
  model: z.string(),
});

export const CaseSummarySchema = z.object({
  caseId: CaseRefSchema,
  title: z.string(),
  asset: AssetBriefSchema,
  /** Omitted unless the viewer may see both the review and the pledge (stage reveals both). */
  stage: badgeSchema(CaseStageSchema).nullable(),
  /** Omitted (null) unless the viewer may know the borrower (S L575). */
  borrower: OrgRefSchema.nullable(),
  verification: badgeSchema(VerificationStateSchema).nullable(),
  review: badgeSchema(ReviewStateSchema).nullable(),
  /** Omitted unless authorized (S L575). */
  pledge: badgeSchema(PledgeDisplayStateSchema).nullable(),
  nextActor: NextActorSchema.nullable(),
  nextAction: NextActionSchema.nullable(),
  /** The viewer is the next actor. */
  isMine: z.boolean(),
  views: z.array(SavedViewSchema),
  updatedAt: IsoDateTimeSchema,
});
export type CaseSummary = z.infer<typeof CaseSummarySchema>;

export const CaseListQuerySchema = PageQuerySchema.extend({ view: SavedViewSchema.optional() });
export type CaseListQuery = z.infer<typeof CaseListQuerySchema>;

export const CaseListSchema = pageSchema(CaseSummarySchema).extend({
  /** Counts use the same scope as the list (S L554). */
  counts: z.record(SavedViewSchema, z.number().int().nonnegative()),
});
export type CaseList = z.infer<typeof CaseListSchema>;

export const PrerequisiteSchema = z.object({ code: z.string(), label: z.string(), done: z.boolean(), detail: z.string() });

export const ParticipantSchema = z.object({ org: OrgRefSchema, roleLabel: z.string(), isViewer: z.boolean() });

export const CaseDetailSchema = CaseSummarySchema.extend({
  purpose: z.string().nullable(),
  selectedLender: OrgRefSchema.nullable(),
  statuses: z.object({
    evidence: z.object({ complete: z.boolean(), label: z.string() }).nullable(),
    verification: badgeSchema(VerificationStateSchema).nullable(),
    attestation: badgeSchema(AttestationValiditySchema).nullable(),
    review: badgeSchema(ReviewStateSchema).nullable(),
    proposal: badgeSchema(ProposalStateSchema).nullable(),
    pledge: badgeSchema(PledgeDisplayStateSchema).nullable(),
  }),
  currentStep: z.string().nullable(),
  blockers: z.array(BlockerSchema),
  allowedActions: z.array(CaseActionSchema),
  allowedTabs: z.array(CaseTabSchema),
  prerequisites: z.array(PrerequisiteSchema).nullable(),
  participants: z.array(ParticipantSchema),
  references: z.object({
    passport: AssetRefSchema,
    attestation: z.object({ ref: AttestationRefSchema, validUntil: IsoDateTimeSchema }).nullable(),
    package: z.object({ ref: z.string(), version: z.number().int(), documentCount: z.number().int() }).nullable(),
    proposal: z.object({ ref: ProposalRefSchema, version: z.number().int(), state: badgeSchema(ProposalStateSchema) }).nullable(),
    pledge: z.object({ ref: PledgeRefSchema, state: badgeSchema(PledgeDisplayStateSchema) }).nullable(),
  }),
  requestedPrincipal: MoneySchema.nullable(),
  dataSource: DataSourceSchema,
  lastSync: LastSyncSchema,
  /** Contract-level identifiers appear only under `Technical details` when authorized (S L699). */
  technical: z
    .object({ controlVersion: z.number().int(), packageVersion: z.number().int(), namespace: z.string() })
    .nullable(),
});
export type CaseDetail = z.infer<typeof CaseDetailSchema>;

export const CreateCaseRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  assetRef: AssetRefSchema,
  selectedLenderOrgId: OrgIdSchema,
  purpose: z.string().trim().max(500).optional(),
  requestedPrincipal: MoneySchema.optional(),
});
export type CreateCaseRequest = z.input<typeof CreateCaseRequestSchema>;

// --- Assets / passport -----------------------------------------------------------------------------

export const AssetSummarySchema = z.object({
  ref: AssetRefSchema,
  equipmentClass: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  owner: OrgRefSchema.nullable(),
  lifecycle: badgeSchema(AssetLifecycleStateSchema),
  verification: badgeSchema(VerificationStateSchema).nullable(),
  attestation: badgeSchema(AttestationValiditySchema).nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type AssetSummary = z.infer<typeof AssetSummarySchema>;

export const ASSET_TABS = ["overview", "evidence", "verification", "cases", "activity"] as const;
export const AssetTabSchema = z.enum(ASSET_TABS);
export type AssetTab = z.infer<typeof AssetTabSchema>;

export const AssetDetailSchema = AssetSummarySchema.extend({
  namespace: z.string(),
  serialNumber: z.string().nullable(),
  yearOfManufacture: z.number().int().nullable(),
  ownerClaimSource: z.string().nullable(),
  locationScope: z.string().nullable(),
  passportVersion: z.number().int(),
  registeredAt: IsoDateTimeSchema.nullable(),
  evidence: z.object({ documentCount: z.number().int(), packageRef: z.string(), packageVersion: z.number().int() }).nullable(),
  /** Collateral control: shown to owner and lenders of known cases only. */
  control: z
    .object({ state: badgeSchema(PledgeDisplayStateSchema), lockRef: PledgeRefSchema.nullable(), version: z.number().int().nullable() })
    .nullable(),
  cases: z.array(z.object({ caseId: CaseRefSchema, title: z.string(), stage: badgeSchema(CaseStageSchema).nullable() })),
  allowedActions: z.array(AssetActionSchema),
  allowedTabs: z.array(AssetTabSchema),
});
export type AssetDetail = z.infer<typeof AssetDetailSchema>;

export const RegisterAssetRequestSchema = z.object({
  intent: z.enum(["DRAFT", "REGISTER"]),
  equipmentClass: z.string().trim().min(1).max(120),
  manufacturer: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(120),
  serialNumber: z.string().trim().min(1).max(120),
  yearOfManufacture: z.number().int().min(1950).max(2100).optional(),
  locationScope: z.string().trim().min(1).max(200),
  claimedAcquisitionValue: MoneySchema.optional(),
});
export type RegisterAssetRequest = z.input<typeof RegisterAssetRequestSchema>;

// --- Evidence ---------------------------------------------------------------------------------

export const EvidenceDocumentSchema = z.object({
  id: DocumentRefSchema,
  assetRef: AssetRefSchema,
  type: DocumentTypeSchema,
  title: z.string(),
  mediaSummary: z.string(),
  source: OrgRefSchema,
  uploadedBy: z.string(),
  version: z.number().int().positive(),
  uploadedAt: IsoDateTimeSchema,
  status: badgeSchema(EvidenceUploadStateSchema),
  scanStatus: badgeSchema(EvidenceScanStateSchema),
  integrity: z.object({
    algorithm: z.literal("SHA-256"),
    hash: z.string().nullable(),
    state: badgeSchema(IntegrityStateSchema),
  }),
  review: badgeSchema(EvidenceReviewStateSchema).nullable(),
  ledger: badgeSchema(EvidenceLedgerStateSchema),
  /** Recipients the viewer may know about (e.g. "PKG-001 · Demo Lender A"). */
  sharingScope: z.array(z.string()),
  versions: z.array(z.object({ version: z.number().int(), uploadedAt: IsoDateTimeSchema })),
  canDownload: z.boolean(),
});
export type EvidenceDocument = z.infer<typeof EvidenceDocumentSchema>;

export const UploadIntentRequestSchema = z.object({
  assetRef: AssetRefSchema,
  caseId: CaseRefSchema.optional(),
  type: DocumentTypeSchema,
  title: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(200),
  contentType: EvidenceContentTypeSchema,
  sizeBytes: z.number().int().positive().max(EVIDENCE_MAX_BYTES),
  /** Adds a new version of an existing document instead of a new document. */
  replacesDocumentId: DocumentRefSchema.optional(),
});
export type UploadIntentRequest = z.input<typeof UploadIntentRequestSchema>;

export const UploadIntentSchema = z.object({
  evidenceId: DocumentRefSchema,
  version: z.number().int().positive(),
  /** Same-origin API path the bytes are PUT to (quarantine), e.g. /api/evidence/DOC-006/content. */
  uploadPath: z.string(),
  maxBytes: z.number().int().positive(),
  expiresAt: IsoDateTimeSchema,
});
export type UploadIntent = z.infer<typeof UploadIntentSchema>;

export const EvidenceDownloadSchema = z.object({ url: z.string(), expiresAt: IsoDateTimeSchema });
export type EvidenceDownload = z.infer<typeof EvidenceDownloadSchema>;

// --- Verification -------------------------------------------------------------------------------

export const AttestationSchema = z.object({
  ref: AttestationRefSchema,
  verificationRef: VerificationRefSchema,
  assetRef: AssetRefSchema,
  issuer: OrgRefSchema,
  verifierRegistryRef: VerifierRefSchema,
  outcome: z.string(),
  method: z.string(),
  inspectedAt: IsoDateTimeSchema,
  issuedAt: IsoDateTimeSchema,
  validFrom: IsoDateTimeSchema,
  validUntil: IsoDateTimeSchema,
  /** Computed at read time from validUntil / revocation / supersession. */
  validity: badgeSchema(AttestationValiditySchema),
  checks: z.array(z.object({ item: z.string(), finding: z.string(), result: badgeSchema(CheckResultSchema) })),
  limitations: z.string(),
  evidencePackage: VersionedRefSchema,
  supportingVersions: z.array(z.object({ documentId: DocumentRefSchema, title: z.string(), version: z.number().int() })),
  supersedes: AttestationRefSchema.nullable(),
  supersededBy: AttestationRefSchema.nullable(),
});
export type Attestation = z.infer<typeof AttestationSchema>;

export const VerificationRequestSchema = z.object({
  ref: VerificationRefSchema,
  assetRef: AssetRefSchema,
  equipmentSummary: z.string(),
  caseId: CaseRefSchema.nullable(),
  verifier: OrgRefSchema,
  verifierRegistryRef: VerifierRefSchema,
  requester: OrgRefSchema,
  scope: z.array(z.string()),
  state: badgeSchema(VerificationStateSchema),
  evidencePackage: VersionedRefSchema,
  documentIds: z.array(DocumentRefSchema),
  dueAt: IsoDateTimeSchema.nullable(),
  requestedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  lastMessage: z.string().nullable(),
  attestation: AttestationSchema.nullable(),
  allowedActions: z.array(VerificationActionSchema),
});
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;

export const CreateVerificationRequestSchema = z.object({
  verifierRegistryRef: VerifierRefSchema,
  scope: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  documentIds: z.array(DocumentRefSchema).min(1),
  caseId: CaseRefSchema.optional(),
  dueAt: IsoDateTimeSchema.optional(),
});
export type CreateVerificationRequest = z.input<typeof CreateVerificationRequestSchema>;

export const AssignmentDecisionRequestSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("ACCEPT") }),
  z.object({ decision: z.literal("DECLINE"), reason: z.string().trim().min(1).max(1000) }),
]);
export type AssignmentDecisionRequest = z.infer<typeof AssignmentDecisionRequestSchema>;

export const MessageRequestSchema = z.object({ message: z.string().trim().min(1).max(2000) });
export type MessageRequest = z.infer<typeof MessageRequestSchema>;

export const IssueAttestationRequestSchema = z.object({
  method: z.string().trim().min(1).max(200),
  inspectedAt: IsoDateTimeSchema,
  validUntil: IsoDateTimeSchema,
  checks: z
    .array(z.object({ item: z.string().trim().min(1).max(120), finding: z.string().trim().max(500), result: CheckResultSchema }))
    .min(1),
  limitations: z.string().trim().min(1).max(2000),
});
export type IssueAttestationRequest = z.infer<typeof IssueAttestationRequestSchema>;

export const ReasonRequestSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
export type ReasonRequest = z.infer<typeof ReasonRequestSchema>;

// --- Sharing and access grants ----------------------------------------------------------------------

export const AccessGrantSchema = z.object({
  /** AG-### for stored grants; derived verification-scope rows use "verification:VR-###". */
  id: z.string().min(1),
  kind: z.enum(["PACKAGE_SHARE", "VERIFICATION_SCOPE", "AUDIT"]),
  caseId: CaseRefSchema,
  recipient: OrgRefSchema,
  purpose: z.string(),
  scope: z.string(),
  auditScopes: z.array(AuditScopeSchema).nullable(),
  permission: AccessPermissionSchema,
  includesTerms: z.boolean(),
  state: badgeSchema(AccessGrantStateSchema),
  expiresAt: IsoDateTimeSchema.nullable(),
  consentingParties: z.array(OrgRefSchema),
  createdAt: IsoDateTimeSchema,
  canRevoke: z.boolean(),
});
export type AccessGrant = z.infer<typeof AccessGrantSchema>;

export const AccessGrantQuerySchema = PageQuerySchema.extend({ caseId: CaseRefSchema.optional() });
export type AccessGrantQuery = z.infer<typeof AccessGrantQuerySchema>;

export const ShareCaseRequestSchema = z.object({
  /** The case's selected lender; any other recipient is refused. */
  recipientOrgId: OrgIdSchema,
  permission: z.enum(["VIEW", "VIEW_DOWNLOAD"]),
  expiresAt: IsoDateTimeSchema.optional(),
});
export type ShareCaseRequest = z.infer<typeof ShareCaseRequestSchema>;

export const CreateAuditGrantRequestSchema = z.object({
  caseId: CaseRefSchema,
  auditorOrgId: OrgIdSchema,
  scopes: z.array(AuditScopeSchema).min(1),
  permission: z.enum(["VIEW", "VIEW_EXPORT"]),
  purpose: z.string().trim().min(1).max(200),
  expiresAt: IsoDateTimeSchema,
});
export type CreateAuditGrantRequest = z.infer<typeof CreateAuditGrantRequestSchema>;

// --- Review / assessment -------------------------------------------------------------------------

export const ReviewSchema = z.object({
  ref: z.string(),
  caseId: CaseRefSchema,
  equipmentSummary: z.string(),
  state: badgeSchema(ReviewStateSchema),
  lender: OrgRefSchema,
  analyst: z.string().nullable(),
  approver: z.string().nullable(),
  evidenceSnapshot: z.object({ package: VersionedRefSchema, matchesAttested: z.boolean(), stale: z.boolean() }).nullable(),
  attestationValidity: badgeSchema(AttestationValiditySchema).nullable(),
  assessment: z
    .object({
      valuation: MoneySchema,
      valuationSource: z.string(),
      valuationDate: z.string(),
      limitations: z.string(),
      outcome: badgeSchema(ReviewStateSchema),
      policyRef: z.string(),
      version: z.number().int(),
      savedAt: IsoDateTimeSchema,
      requiredExternalChecks: z.array(z.object({ label: z.string(), status: z.string() })),
    })
    .nullable(),
  /** Terms-level figures: borrower and selected lender only. */
  derived: z
    .object({
      requestedPrincipal: MoneySchema.nullable(),
      principalToValuation: z.string().nullable(),
      policyMaximum: z.string(),
    })
    .nullable(),
  /** Lender organization only (S L671, L677). Absent for everyone else. */
  internalNotes: z.string().nullable(),
  sharedFeedback: z.string().nullable(),
  informationRequest: z.string().nullable(),
  decision: z
    .object({ outcome: badgeSchema(ReviewStateSchema), decidedAt: IsoDateTimeSchema, decidedBy: z.string() })
    .nullable(),
  allowedActions: z.array(CaseActionSchema),
  updatedAt: IsoDateTimeSchema,
});
export type Review = z.infer<typeof ReviewSchema>;

export const ReviewSummarySchema = z.object({
  ref: z.string(),
  caseId: CaseRefSchema,
  equipmentSummary: z.string(),
  evidenceComplete: z.boolean(),
  attestationValidity: badgeSchema(AttestationValiditySchema).nullable(),
  requestedPrincipal: MoneySchema.nullable(),
  state: badgeSchema(ReviewStateSchema),
  analyst: z.string().nullable(),
  views: z.array(SavedViewSchema),
  updatedAt: IsoDateTimeSchema,
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

export const SaveAssessmentRequestSchema = z.object({
  valuation: MoneySchema,
  valuationSource: z.string().trim().min(1).max(500),
  valuationDate: z.iso.date(),
  limitations: z.string().trim().max(2000),
  internalNotes: z.string().trim().max(4000).optional(),
  sharedFeedback: z.string().trim().max(2000).optional(),
  outcome: z.enum(["NEEDS_INFORMATION", "ELIGIBLE", "REJECTED"]),
  policyRef: z.string().trim().min(1).max(60),
});
export type SaveAssessmentRequest = z.input<typeof SaveAssessmentRequestSchema>;

export const ReviewDecisionRequestSchema = z.object({
  outcome: z.enum(["ELIGIBLE", "REJECTED"]),
  sharedFeedback: z.string().trim().max(2000).optional(),
});
export type ReviewDecisionRequest = z.infer<typeof ReviewDecisionRequestSchema>;

// --- Proposal, activation -----------------------------------------------------------------------

export const ProposalSchema = z.object({
  ref: ProposalRefSchema,
  version: z.number().int().positive(),
  caseId: CaseRefSchema,
  assetRef: AssetRefSchema,
  state: badgeSchema(ProposalStateSchema),
  lender: OrgRefSchema,
  borrower: OrgRefSchema,
  principal: MoneySchema,
  termMetadata: z.string().nullable(),
  financingRef: z.string().nullable(),
  externalLegalRef: z.string().nullable(),
  expiresAt: IsoDateTimeSchema,
  approver: z.string().nullable(),
  issuedAt: IsoDateTimeSchema.nullable(),
  respondedAt: IsoDateTimeSchema.nullable(),
  respondedBy: z.string().nullable(),
  versions: z.array(
    z.object({ version: z.number().int(), state: badgeSchema(ProposalStateSchema), issuedAt: IsoDateTimeSchema.nullable(), note: z.string().nullable() }),
  ),
  activation: z
    .object({
      state: badgeSchema(ActivationAuthorizationStateSchema),
      authorizedAt: IsoDateTimeSchema,
      expiresAt: IsoDateTimeSchema,
      proposalVersion: z.number().int(),
    })
    .nullable(),
  allowedActions: z.array(CaseActionSchema),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const CreateProposalRequestSchema = z.object({
  /** Analysts may only draft; approvers issue (CR-18). */
  intent: z.enum(["DRAFT", "ISSUE"]),
  principal: MoneySchema,
  termMetadata: z.string().trim().max(200).optional(),
  financingRef: z.string().trim().max(80).optional(),
  externalLegalRef: z.string().trim().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(60).default(14),
});
export type CreateProposalRequest = z.input<typeof CreateProposalRequestSchema>;

export const ExpectedVersionRequestSchema = z.object({ expectedVersion: z.number().int().positive() });
export type ExpectedVersionRequest = z.infer<typeof ExpectedVersionRequestSchema>;

export const DeclineProposalRequestSchema = ExpectedVersionRequestSchema.extend({ reason: z.string().trim().max(1000).optional() });
export type DeclineProposalRequest = z.infer<typeof DeclineProposalRequestSchema>;

// --- Pledge and release ----------------------------------------------------------------------------

export const ReleaseRequestSchema = z.object({
  ref: ReleaseRequestRefSchema,
  pledgeRef: PledgeRefSchema,
  state: badgeSchema(ReleaseRequestStateSchema),
  reason: badgeSchema(ReleaseReasonSchema),
  note: z.string().nullable(),
  servicingRef: z.string().nullable(),
  requestedBy: z.string(),
  requestedAt: IsoDateTimeSchema,
  informationRequest: z.string().nullable(),
  decision: z
    .object({ outcome: badgeSchema(ReleaseRequestStateSchema), decidedAt: IsoDateTimeSchema, decidedBy: z.string(), reason: z.string().nullable() })
    .nullable(),
});
export type ReleaseRequest = z.infer<typeof ReleaseRequestSchema>;

export const PledgeSchema = z.object({
  ref: PledgeRefSchema,
  caseId: CaseRefSchema,
  assetRef: AssetRefSchema,
  state: badgeSchema(PledgeDisplayStateSchema),
  lockState: badgeSchema(LockStateSchema),
  /** Omitted unless authorized (S L703). */
  lender: OrgRefSchema.nullable(),
  borrower: OrgRefSchema.nullable(),
  principalRef: z.string().nullable(),
  activatedAt: IsoDateTimeSchema,
  releasedAt: IsoDateTimeSchema.nullable(),
  activation: z
    .object({
      authorizedBy: z.array(z.string()),
      proposal: VersionedRefSchema,
      attestationRef: AttestationRefSchema,
      evidencePackage: VersionedRefSchema,
    })
    .nullable(),
  releaseRequests: z.array(ReleaseRequestSchema),
  technical: z
    .object({
      controlVersionConsumed: z.number().int(),
      controlVersionLocked: z.number().int(),
      controlVersionAfterRelease: z.number().int().nullable(),
      controlState: AssetControlStateSchema,
    })
    .nullable(),
  allowedActions: z.array(CaseActionSchema),
});
export type Pledge = z.infer<typeof PledgeSchema>;

export const PLEDGE_FILTERS = ["active", "release-requested", "released"] as const;
export const PledgeFilterSchema = z.enum(PLEDGE_FILTERS);
export type PledgeFilter = z.infer<typeof PledgeFilterSchema>;
export const PledgeListQuerySchema = PageQuerySchema.extend({ filter: PledgeFilterSchema.optional() });
export type PledgeListQuery = z.infer<typeof PledgeListQuerySchema>;

export const CreateReleaseRequestSchema = z.object({
  reason: ReleaseReasonSchema,
  note: z.string().trim().max(2000).optional(),
  servicingRef: z.string().trim().max(120).optional(),
});
export type CreateReleaseRequest = z.infer<typeof CreateReleaseRequestSchema>;

export const ReleaseDecisionRequestSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("AUTHORIZE") }),
  z.object({ decision: z.literal("REJECT"), reason: z.string().trim().min(1).max(1000) }),
]);
export type ReleaseDecisionRequest = z.infer<typeof ReleaseDecisionRequestSchema>;

// --- Audit and reports -------------------------------------------------------------------------

export const AuditEventSchema = z.object({
  id: z.string(),
  occurredAt: IsoDateTimeSchema,
  caseId: CaseRefSchema.nullable(),
  assetRef: AssetRefSchema,
  ref: z.string(),
  type: EventTypeSchema,
  label: z.string(),
  actor: z.string(),
  stateChange: z.object({ from: z.string().nullable(), to: z.string() }).nullable(),
  version: z.string().nullable(),
  kind: badgeSchema(EventKindSchema),
  commit: z.object({ updateId: z.string(), offset: z.number().int() }).nullable(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditEventQuerySchema = PageQuerySchema.extend({
  caseId: CaseRefSchema.optional(),
  assetRef: AssetRefSchema.optional(),
  kind: EventKindSchema.optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});
export type AuditEventQuery = z.infer<typeof AuditEventQuerySchema>;

export const ReportSchema = z.object({
  ref: ReportRefSchema,
  caseId: CaseRefSchema,
  format: ReportFormatSchema,
  schemaVersion: z.string(),
  scope: z.string(),
  requestedBy: z.string(),
  state: badgeSchema(ExportJobStateSchema),
  requestedAt: IsoDateTimeSchema,
  generatedAt: IsoDateTimeSchema.nullable(),
  cutoff: z.object({ offset: z.number().int().nullable(), at: IsoDateTimeSchema }),
  checksum: z.string().nullable(),
  label: z.string(),
  expiresAt: IsoDateTimeSchema.nullable(),
});
export type Report = z.infer<typeof ReportSchema>;

export const CreateReportRequestSchema = z.object({ caseId: CaseRefSchema, format: ReportFormatSchema.default("JSON") });
export type CreateReportRequest = z.input<typeof CreateReportRequestSchema>;

export const ReportDownloadSchema = EvidenceDownloadSchema;
export type ReportDownload = EvidenceDownload;

// --- Verifier registry and governance ------------------------------------------------------------

export const VerifierEntrySchema = z.object({
  ref: VerifierRefSchema,
  orgName: z.string(),
  status: badgeSchema(VerifierRegistryStateSchema),
  scope: z.string(),
  since: IsoDateTimeSchema.nullable(),
  via: z.string(),
  activeAssignments: z.number().int().nonnegative(),
  attestationsIssued: z.number().int().nonnegative(),
  pendingProposal: z.object({ ref: GovernanceProposalRefSchema, type: z.string(), confirmations: z.number().int() }).nullable(),
});
export type VerifierEntry = z.infer<typeof VerifierEntrySchema>;

export const GOVERNANCE_ACTION_TYPES = ["ADD_VERIFIER", "SUSPEND_VERIFIER"] as const;
export const GovernanceActionTypeSchema = z.enum(GOVERNANCE_ACTION_TYPES);
export type GovernanceActionType = z.infer<typeof GovernanceActionTypeSchema>;
export const GOVERNANCE_ACTION_LABELS: Readonly<Record<GovernanceActionType, string>> = {
  ADD_VERIFIER: "Add verifier",
  SUSPEND_VERIFIER: "Suspend verifier",
};

export const GovernanceIntegrationSchema = z.object({
  status: z.enum(["SIMULATED", "PARTIAL_TIER_A", "DM_TIER_B", "UNAVAILABLE"]),
  label: z.string(),
  capability: CapabilityStatusSchema,
});

export const GovernanceSeatEntrySchema = z.object({
  seat: GovernanceSeatSchema,
  org: OrgRefSchema,
  memberRef: z.string(),
  mandateLabel: z.string(),
  since: IsoDateTimeSchema,
});

export const GovernanceStateSchema = z.object({
  integration: GovernanceIntegrationSchema,
  threshold: z.number().int().positive(),
  seats: z.array(GovernanceSeatEntrySchema),
  viewerSeat: GovernanceSeatSchema.nullable(),
  registryVersion: z.number().int().nonnegative(),
  proposalDeadlineDays: z.number().int().positive(),
  // Fractional on LOCALNET: the DM rules default to 30 minutes (0.5 h); the UI_MOCK fixture uses whole hours.
  confirmationTimeoutHours: z.number().positive(),
  counts: z.object({
    activeVerifiers: z.number().int(),
    suspendedVerifiers: z.number().int(),
    openProposals: z.number().int(),
  }),
});
export type GovernanceState = z.infer<typeof GovernanceStateSchema>;

export const GovernanceProposalSchema = z.object({
  ref: GovernanceProposalRefSchema,
  type: GovernanceActionTypeSchema,
  typeLabel: z.string(),
  target: z.object({ verifierRef: z.string(), orgName: z.string(), scope: z.string() }),
  proposer: z.object({ seat: GovernanceSeatSchema, org: OrgRefSchema }),
  rationale: z.string(),
  effect: z.string(),
  openedAt: IsoDateTimeSchema,
  deadlineAt: IsoDateTimeSchema,
  expectedRegistryVersion: z.number().int().nonnegative(),
  state: badgeSchema(GovernanceProposalStateSchema),
  threshold: z.number().int().positive(),
  liveConfirmations: z.number().int().nonnegative(),
  confirmations: z.array(
    z.object({
      seat: GovernanceSeatSchema,
      org: OrgRefSchema,
      state: badgeSchema(SeatConfirmationStateSchema),
      confirmedAt: IsoDateTimeSchema.nullable(),
      expiresAt: IsoDateTimeSchema.nullable(),
    }),
  ),
  executedAt: IsoDateTimeSchema.nullable(),
  executedBySeat: GovernanceSeatSchema.nullable(),
  cancelledAt: IsoDateTimeSchema.nullable(),
  allowedActions: z.array(z.enum(["confirm", "execute", "cancel"])),
});
export type GovernanceProposal = z.infer<typeof GovernanceProposalSchema>;

export const CreateGovernanceProposalRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ADD_VERIFIER"),
    orgName: z.string().trim().min(1).max(120),
    scope: z.string().trim().min(1).max(200),
    rationale: z.string().trim().min(1).max(2000),
  }),
  z.object({
    type: z.literal("SUSPEND_VERIFIER"),
    verifierRef: VerifierRefSchema,
    rationale: z.string().trim().min(1).max(2000),
  }),
]);
export type CreateGovernanceProposalRequest = z.infer<typeof CreateGovernanceProposalRequestSchema>;

// --- Pilot requests (S §6.1). Option lists are INFERRED except `Unknown`; need copy approval. --------

export const COMPANY_TYPES = ["LENDER", "DEALER", "EQUIPMENT_OWNER", "VERIFIER", "OTHER"] as const;
export const COMPANY_TYPE_LABELS: Readonly<Record<(typeof COMPANY_TYPES)[number], string>> = {
  LENDER: "Equipment-finance lender",
  DEALER: "Equipment dealer",
  EQUIPMENT_OWNER: "Equipment owner or manufacturer",
  VERIFIER: "Inspector or appraiser",
  OTHER: "Other",
};
export const CASES_PER_MONTH = ["UNKNOWN", "1_5", "6_20", "21_50", "OVER_50"] as const;
export const CASES_PER_MONTH_LABELS: Readonly<Record<(typeof CASES_PER_MONTH)[number], string>> = {
  UNKNOWN: "Unknown",
  "1_5": "1–5",
  "6_20": "6–20",
  "21_50": "21–50",
  OVER_50: "More than 50",
};

export const PilotRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  workEmail: z.email().max(200),
  company: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(120),
  companyType: z.enum(COMPANY_TYPES),
  country: z.string().trim().min(2).max(80),
  equipmentCategory: z.string().trim().min(1).max(120),
  casesPerMonth: z.enum(CASES_PER_MONTH),
  workflowChallenge: z.string().trim().min(1).max(2000),
  currentSystems: z.string().trim().max(500).optional(),
  consent: z.literal(true),
  /** Honeypot: must stay empty. */
  website: z.string().max(0).optional(),
});
export type PilotRequest = z.infer<typeof PilotRequestSchema>;

export const PilotRequestReceiptSchema = z.object({
  id: z.string(),
  state: badgeSchema(PilotRequestStateSchema),
  receivedAt: IsoDateTimeSchema,
});
export type PilotRequestReceipt = z.infer<typeof PilotRequestReceiptSchema>;

// --- System -----------------------------------------------------------------------------------

export const HealthStatusSchema = z.enum(["ok", "degraded", "unavailable"]);
export const SystemHealthSchema = z.object({
  status: HealthStatusSchema,
  mode: RuntimeModeSchema,
  version: z.string(),
  checks: z.record(z.string(), z.object({ status: HealthStatusSchema, detail: z.string().optional() })),
});
export type SystemHealth = z.infer<typeof SystemHealthSchema>;
