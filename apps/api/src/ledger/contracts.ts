// Zod schemas of the Collara contract payloads as served by the JSON Ledger API v2 (daml-model.md §4).
// Encoding: Party/Text/ContractId/Time/Date are strings, Int is a string (decoded to number here),
// Numeric 2 is a decimal string ("150000.00"), Optional is null or the value, Set is {"map": [[x, {}]]},
// enums are strings. The ledger is an external boundary: every ACS read decodes through these.
import { damlValue } from "@collara/canton";
import { z } from "zod";
import { TEMPLATES, type TemplateName } from "./templates";

const Party = z.string().min(1);
const Text = z.string();
const Cid = z.string().min(1);
/** Daml Int64 (a string on the wire; numbers are accepted for robustness). Values in Collara are small. */
const Int = z.union([z.string().regex(/^-?\d+$/), z.number().int()]).transform((value) => Number(value));
const Time = z.string().min(1);
const DateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Numeric2 = z.string().regex(/^-?\d+(\.\d{1,2})?$/);
const PartySet = damlValue.damlSchemas.set(Party);
const TextSet = damlValue.damlSchemas.set(Text);
/**
 * Daml `Optional`: the JSON API omits None-valued fields from created-event payloads (observed on
 * 3.5.19) and accepts null on submission. Decoded as `T | null`.
 */
const opt = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null);

export const MoneySchema = z.object({ amount: Numeric2, currency: Text });
export const EvidenceAnchorSchema = z.object({ packageRef: Text, manifestVersion: Int, manifestHash: Text });
export const ReviewSnapshotSchema = z.object({
  evidence: EvidenceAnchorSchema,
  attestationRef: Text,
  attestationVerifier: Party,
  attestationValidUntil: Time,
});
export const EquipmentIdentitySchema = z.object({ manufacturer: Text, model: Text, serialNumber: Text });
export const PassportDetailsSchema = z.object({ yearOfManufacture: opt(Int), locationScope: Text });
export const ManifestEntrySchema = z.object({
  docRef: Text,
  docType: Text,
  docVersion: Int,
  sha256: Text,
  source: Party,
  contributorRef: Text,
});
export const SharedDocumentSchema = z.object({ docRef: Text, docVersion: Int, sha256: Text, source: Party });
export const CheckItemSchema = z.object({
  item: Text,
  finding: Text,
  result: z.enum(["CHECKED", "CHECKED_NOTED", "REVIEWED_DOCUMENTS", "NOT_CHECKED"]),
});
export const ValuationSchema = z.object({ value: MoneySchema, source: Text, valuationDate: DateText, limitations: Text });
export const AssessmentStatusSchema = z.enum(["SUBMITTED", "IN_REVIEW", "NEEDS_INFORMATION", "PENDING_APPROVAL", "ELIGIBLE", "REJECTED"]);
export const VerifierStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);

// --- Config ------------------------------------------------------------------------------------------

export const CollaraConfigSchema = z.object({
  registrar: Party,
  namespace: Text,
  governanceParty: Party,
  suspensionPolicy: z.enum(["REQUIRE_ACTIVE_VERIFIER", "ALLOW_ISSUED_ATTESTATIONS"]),
  configVersion: Int,
  directory: z.array(Party),
});

export const VerifierStatusMirrorSchema = z.object({
  registrar: Party,
  namespace: Text,
  governanceParty: Party,
  verifier: Party,
  verifierRef: Text,
  status: VerifierStatusSchema,
  registryVersion: Int,
  sourceRef: Text,
  directory: z.array(Party),
});

// --- Registration ------------------------------------------------------------------------------------

export const AssetRegistrationRequestSchema = z.object({
  owner: Party,
  registrar: Party,
  namespace: Text,
  requestRef: Text,
  equipmentClass: Text,
  equipment: EquipmentIdentitySchema,
  details: PassportDetailsSchema,
  identityCommitment: Text,
  ownerClaimRef: Text,
});

export const AssetRegistrySchema = z.object({
  registrar: Party,
  namespace: Text,
  issuedAssetIds: TextSet,
  issuedIdentityCommitments: TextSet,
  version: Int,
});

export const IssuanceTicketSchema = z.object({
  registrar: Party,
  owner: Party,
  namespace: Text,
  assetId: Text,
  requestRef: Text,
  identityCommitment: Text,
});

export const AssetPassportSchema = z.object({
  owner: Party,
  registrar: Party,
  namespace: Text,
  assetId: Text,
  passportVersion: Int,
  equipmentClass: Text,
  equipment: EquipmentIdentitySchema,
  details: PassportDetailsSchema,
  identityCommitment: Text,
  documents: z.array(z.object({ docRef: Text, sha256: Text })),
  registeredAt: Time,
});

// --- Control -----------------------------------------------------------------------------------------

export const AssetControlSchema = z.object({
  registrar: Party,
  owner: Party,
  namespace: Text,
  assetId: Text,
  controlVersion: Int,
  evidence: opt(EvidenceAnchorSchema),
  sharedLender: opt(Party),
});

export const RetiredControlSchema = z.object({
  registrar: Party,
  owner: Party,
  namespace: Text,
  assetId: Text,
  finalControlVersion: Int,
  reason: Text,
  retiredAt: Time,
  retiredByRef: Text,
});

export const CollateralLockSchema = z.object({
  registrar: Party,
  owner: Party,
  lender: Party,
  namespace: Text,
  assetId: Text,
  controlVersion: Int,
  evidence: EvidenceAnchorSchema,
  lockRef: Text,
  caseRef: Text,
  authorizationRef: Text,
  agreementRef: Text,
  attestationRef: Text,
  activatedAt: Time,
  activatedByRef: Text,
});

export const CollateralLockReleasedSchema = z.object({
  registrar: Party,
  owner: Party,
  lender: Party,
  namespace: Text,
  assetId: Text,
  lockRef: Text,
  caseRef: Text,
  releaseRequestRef: Text,
  lockControlVersion: Int,
  releasedControlVersion: Int,
  activatedAt: Time,
  releasedAt: Time,
  releasedByRef: Text,
});

// --- Evidence ----------------------------------------------------------------------------------------

export const EvidenceManifestSchema = z.object({
  owner: Party,
  registrar: Party,
  namespace: Text,
  assetId: Text,
  packageRef: Text,
  version: Int,
  manifestHash: Text,
  entries: z.array(ManifestEntrySchema),
});

export const DealerContributionSchema = z.object({
  dealer: Party,
  owner: Party,
  caseRef: Text,
  docRef: Text,
  docType: Text,
  docVersion: Int,
  sha256: Text,
  contributorRef: Text,
  verificationUseConsented: z.boolean(),
});

const ShareFields = {
  owner: Party,
  recipient: Party,
  shareRef: Text,
  purpose: Text,
  caseRef: Text,
  evidence: EvidenceAnchorSchema,
  documents: z.array(SharedDocumentSchema),
  permission: z.enum(["VIEW", "VIEW_DOWNLOAD"]),
  expiresAt: Time,
};
export const PackageShareProposalSchema = z.object({ ...ShareFields, dealer: Party });
export const PackageShareSchema = z.object({ ...ShareFields, consenters: z.array(Party) });

// --- Verification ------------------------------------------------------------------------------------

export const VerificationRequestSchema = z.object({
  owner: Party,
  verifier: Party,
  registrar: Party,
  namespace: Text,
  requestRef: Text,
  assetId: Text,
  passportVersion: Int,
  caseRef: opt(Text),
  evidence: EvidenceAnchorSchema,
  equipmentScope: Text,
  checklist: z.array(Text),
  dueBy: opt(Time),
  status: z.enum(["REQUESTED", "IN_REVIEW", "CHANGES_REQUESTED"]),
  version: Int,
  changeNote: Text,
});

export const VerificationAttestationSchema = z.object({
  verifier: Party,
  owner: Party,
  registrar: Party,
  namespace: Text,
  governanceParty: Party,
  attestationRef: Text,
  requestRef: Text,
  verifierRef: Text,
  assetId: Text,
  passportVersion: Int,
  caseRef: opt(Text),
  evidence: EvidenceAnchorSchema,
  equipmentScope: Text,
  checks: z.array(CheckItemSchema),
  limitations: Text,
  method: Text,
  inspectedAt: Time,
  validFrom: Time,
  validUntil: Time,
  supersedesRef: opt(Text),
  issuedAt: Time,
  issuedByRef: Text,
});

export const AttestationDisclosureSchema = z.object({
  verifier: Party,
  owner: Party,
  recipient: Party,
  purpose: Text,
  caseRef: Text,
  attestationCid: Cid,
  attestation: VerificationAttestationSchema,
  disclosedAt: Time,
  /** Its DisclosureValidity (created with it; archived by every choice that ends it). */
  validityCid: Cid,
});

/** Owner-signed marker that one AttestationDisclosure is live; Control_Activate fetches it (daml-model.md §4.5). */
export const DisclosureValiditySchema = z.object({
  owner: Party,
  verifier: Party,
  recipient: Party,
  namespace: Text,
  assetId: Text,
  caseRef: Text,
  attestationRef: Text,
  evidence: EvidenceAnchorSchema,
  validUntil: Time,
});

export const RevokedAttestationSchema = z.object({
  verifier: Party,
  owner: Party,
  attestationRef: Text,
  assetId: Text,
  reason: Text,
  revokedAt: Time,
  revokedByRef: Text,
});

// --- Financing ---------------------------------------------------------------------------------------

export const CollateralAssessmentSchema = z.object({
  lender: Party,
  borrower: Party,
  assessmentRef: Text,
  caseRef: Text,
  namespace: Text,
  assetId: Text,
  snapshot: ReviewSnapshotSchema,
  valuation: opt(ValuationSchema),
  policyRef: Text,
  status: AssessmentStatusSchema,
  version: Int,
  lastActorRef: Text,
});

export const LenderDecisionNoticeSchema = z.object({
  lender: Party,
  borrower: Party,
  noticeRef: Text,
  caseRef: Text,
  assessmentRef: Text,
  outcome: AssessmentStatusSchema,
  sharedFeedback: Text,
  decidedAt: Time,
});

const ProposalFields = {
  lender: Party,
  borrower: Party,
  caseRef: Text,
  namespace: Text,
  assetId: Text,
  assessmentRef: Text,
  snapshot: ReviewSnapshotSchema,
  principal: MoneySchema,
  termMetadata: Text,
  externalLegalRef: Text,
};
export const FinancingProposalSchema = z.object({
  ...ProposalFields,
  proposalRef: Text,
  version: Int,
  expiresAt: Time,
  issuedAt: Time,
  issuedByRef: Text,
});
export const FinancingAgreementSchema = z.object({
  ...ProposalFields,
  agreementRef: Text,
  proposalVersion: Int,
  acceptedAt: Time,
  acceptedByRef: Text,
});

export const PledgeActivationAuthorizationSchema = z.object({
  lender: Party,
  borrower: Party,
  authorizationRef: Text,
  caseRef: Text,
  agreementRef: Text,
  agreementVersion: Int,
  namespace: Text,
  assetId: Text,
  expectedControlVersion: Int,
  snapshot: ReviewSnapshotSchema,
  expiresAt: Time,
  authorizedAt: Time,
  authorizedByRef: Text,
});

// --- Release and audit -------------------------------------------------------------------------------

export const ReleaseRequestSchema = z.object({
  requester: Party,
  owner: Party,
  lender: Party,
  lockCid: Cid,
  lockRef: Text,
  caseRef: Text,
  namespace: Text,
  assetId: Text,
  releaseRequestRef: Text,
  reason: z.enum(["EXTERNAL_LOAN_COMPLETION", "REFINANCING", "ADMINISTRATIVE_CORRECTION"]),
  noteRef: Text,
  status: z.enum(["REQUESTED", "INFORMATION_REQUESTED"]),
  version: Int,
  requestedByRef: Text,
});

export const ReleaseDecisionSchema = z.object({
  lender: Party,
  owner: Party,
  decisionRef: Text,
  releaseRequestRef: Text,
  lockRef: Text,
  caseRef: Text,
  outcome: z.enum(["AUTHORIZED", "REJECTED"]),
  sharedReason: Text,
  decidedAt: Time,
  decidedByRef: Text,
});

export const AuditGrantSchema = z.object({
  grantor: Party,
  auditor: Party,
  grantRef: Text,
  caseRef: Text,
  scopes: z.array(z.enum(["EVIDENCE_MANIFEST", "ATTESTATION", "DECISION_OUTCOME", "PROPOSAL_TERMS", "PLEDGE_RELEASE_EVENTS"])),
  permission: z.enum(["VIEW", "EXPORT"]),
  purpose: Text,
  expiresAt: Time,
});

// --- Governance --------------------------------------------------------------------------------------

export const VerifierRegistrySchema = z.object({
  governanceParty: Party,
  operator: Party,
  registryId: Text,
  version: Int,
  activeVerifiers: PartySet,
});

export const VerifierAccreditationSchema = z.object({
  governanceParty: Party,
  operator: Party,
  verifier: Party,
  verifierRef: Text,
  orgName: Text,
  scope: z.array(Text),
  status: VerifierStatusSchema,
  validUntil: opt(Time),
  registryId: Text,
  registryVersion: Int,
  reason: Text,
});

export const GenesisVerifierSchema = z.object({
  verifier: Party,
  verifierRef: Text,
  orgName: Text,
  scope: z.array(Text),
  validUntil: opt(Time),
});

export const BootstrapVerifierRegistryProposalSchema = z.object({
  governanceParty: Party,
  proposer: Party,
  operator: Party,
  registryId: Text,
  genesisVerifiers: z.array(GenesisVerifierSchema),
  proposalDeadline: Time,
  reason: Text,
});

export const AddVerifierProposalSchema = z.object({
  governanceParty: Party,
  proposer: Party,
  registryCid: Cid,
  expectedVersion: Int,
  verifier: Party,
  verifierRef: Text,
  orgName: Text,
  scope: z.array(Text),
  validUntil: opt(Time),
  proposalDeadline: Time,
  reason: Text,
});

export const SuspendVerifierProposalSchema = z.object({
  governanceParty: Party,
  proposer: Party,
  registryCid: Cid,
  expectedVersion: Int,
  accreditationCid: Cid,
  verifier: Party,
  proposalDeadline: Time,
  reason: Text,
});

export const GovernanceRulesSchema = z.object({
  governanceParty: Party,
  members: PartySet,
  threshold: Int,
  actionConfirmationTimeout: z.object({ microseconds: z.union([z.string(), z.number()]) }),
  additionalProposers: opt(PartySet),
});

export const GovernanceConfirmationSchema = z.object({
  governanceParty: Party,
  confirmer: Party,
  actionProposalCid: Cid,
  actionLabel: Text,
  expiresAt: Time,
});

export const GovernanceExecutionResultSchema = z.object({
  governanceParty: Party,
  actionLabel: Text,
  description: Text,
  executor: Party,
  confirmers: z.array(Party),
  executedAt: Time,
});

/** Payload schema per template (interfaces have none). */
export const PAYLOAD_SCHEMAS = {
  CollaraConfig: CollaraConfigSchema,
  VerifierStatusMirror: VerifierStatusMirrorSchema,
  AssetRegistrationRequest: AssetRegistrationRequestSchema,
  AssetRegistry: AssetRegistrySchema,
  IssuanceTicket: IssuanceTicketSchema,
  AssetPassport: AssetPassportSchema,
  AssetControl: AssetControlSchema,
  RetiredControl: RetiredControlSchema,
  CollateralLock: CollateralLockSchema,
  CollateralLockReleased: CollateralLockReleasedSchema,
  EvidenceManifest: EvidenceManifestSchema,
  DealerContribution: DealerContributionSchema,
  PackageShareProposal: PackageShareProposalSchema,
  PackageShare: PackageShareSchema,
  VerificationRequest: VerificationRequestSchema,
  VerificationAttestation: VerificationAttestationSchema,
  AttestationDisclosure: AttestationDisclosureSchema,
  DisclosureValidity: DisclosureValiditySchema,
  RevokedAttestation: RevokedAttestationSchema,
  CollateralAssessment: CollateralAssessmentSchema,
  LenderDecisionNotice: LenderDecisionNoticeSchema,
  FinancingProposal: FinancingProposalSchema,
  FinancingAgreement: FinancingAgreementSchema,
  PledgeActivationAuthorization: PledgeActivationAuthorizationSchema,
  ReleaseRequest: ReleaseRequestSchema,
  ReleaseDecision: ReleaseDecisionSchema,
  AuditGrant: AuditGrantSchema,
  VerifierRegistry: VerifierRegistrySchema,
  VerifierAccreditation: VerifierAccreditationSchema,
  BootstrapVerifierRegistryProposal: BootstrapVerifierRegistryProposalSchema,
  AddVerifierProposal: AddVerifierProposalSchema,
  SuspendVerifierProposal: SuspendVerifierProposalSchema,
  GovernanceRules: GovernanceRulesSchema,
  GovernanceConfirmation: GovernanceConfirmationSchema,
  GovernanceExecutionResult: GovernanceExecutionResultSchema,
} as const satisfies Partial<Record<TemplateName, z.ZodType>>;

export type PayloadTemplate = keyof typeof PAYLOAD_SCHEMAS;
export type Payload<N extends PayloadTemplate> = z.output<(typeof PAYLOAD_SCHEMAS)[N]>;

export type AssetControlPayload = Payload<"AssetControl">;
export type EvidenceManifestPayload = Payload<"EvidenceManifest">;
export type VerificationAttestationPayload = Payload<"VerificationAttestation">;
export type AttestationDisclosurePayload = Payload<"AttestationDisclosure">;
export type DisclosureValidityPayload = Payload<"DisclosureValidity">;
export type ReviewSnapshot = z.output<typeof ReviewSnapshotSchema>;
export type EvidenceAnchor = z.output<typeof EvidenceAnchorSchema>;
export type ManifestEntry = z.output<typeof ManifestEntrySchema>;

/** Template name for a package-name template ref (e.g. from a projected row), or undefined. */
export function templateNameOf(templateRef: string): TemplateName | undefined {
  return (Object.keys(TEMPLATES) as TemplateName[]).find((name) => TEMPLATES[name] === templateRef);
}
