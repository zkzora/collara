// Templates the projection keeps, and the business columns it extracts at write time (business_ref, case_ref,
// asset_ref on ledger_contracts). Field names follow the Daml source (daml/collara/**, docs/architecture/
// daml-model.md §4 and §9). To add a template: add one entry to TEMPLATE_MAPPINGS (and, if the read model needs
// it, a decoder in read-model/decode.ts). Templates of the projected packages without an entry are still stored,
// with null business columns.

/** Packages whose events are projected. Everything else in a transaction is counted but not stored. */
export const PROJECTED_PACKAGE_NAMES: readonly string[] = ["collara-contracts", "collara-governance", "governance-core-v1"];

type Payload = Readonly<Record<string, unknown>>;
type Extractor = (payload: Payload) => string | null;

export interface TemplateMapping {
  /** Package-name template id, e.g. "#collara-contracts:Collara.Control:AssetControl". */
  readonly templateRef: string;
  /** Display/business reference (requestRef, attestationRef, lockRef, …). */
  readonly businessRef?: Extractor;
  /** Defaults to the `caseRef` field (Text or Optional Text). */
  readonly caseRef?: Extractor;
  /** Defaults to the `assetId` field. */
  readonly assetRef?: Extractor;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const field = (name: string): Extractor => (p) => text(p[name]);
const nested = (outer: string, inner: string): Extractor => (p) => {
  const o = p[outer];
  return o && typeof o === "object" ? text((o as Payload)[inner]) : null;
};
const none: Extractor = () => null;

export const T = {
  CollaraConfig: "#collara-contracts:Collara.Config:CollaraConfig",
  VerifierStatusMirror: "#collara-contracts:Collara.Config:VerifierStatusMirror",
  AssetRegistrationRequest: "#collara-contracts:Collara.Registration:AssetRegistrationRequest",
  AssetRegistry: "#collara-contracts:Collara.Registration:AssetRegistry",
  IssuanceTicket: "#collara-contracts:Collara.Registration:IssuanceTicket",
  AssetPassport: "#collara-contracts:Collara.Registration:AssetPassport",
  AssetControl: "#collara-contracts:Collara.Control:AssetControl",
  RetiredControl: "#collara-contracts:Collara.Control:RetiredControl",
  CollateralLock: "#collara-contracts:Collara.Control:CollateralLock",
  CollateralLockReleased: "#collara-contracts:Collara.Control:CollateralLockReleased",
  EvidenceManifest: "#collara-contracts:Collara.Evidence:EvidenceManifest",
  DealerContribution: "#collara-contracts:Collara.Evidence:DealerContribution",
  PackageShareProposal: "#collara-contracts:Collara.Evidence:PackageShareProposal",
  PackageShare: "#collara-contracts:Collara.Evidence:PackageShare",
  VerificationRequest: "#collara-contracts:Collara.Verification:VerificationRequest",
  VerificationAttestation: "#collara-contracts:Collara.Verification:VerificationAttestation",
  AttestationDisclosure: "#collara-contracts:Collara.Verification:AttestationDisclosure",
  DisclosureValidity: "#collara-contracts:Collara.Verification:DisclosureValidity",
  RevokedAttestation: "#collara-contracts:Collara.Verification:RevokedAttestation",
  CollateralAssessment: "#collara-contracts:Collara.Financing:CollateralAssessment",
  LenderDecisionNotice: "#collara-contracts:Collara.Financing:LenderDecisionNotice",
  FinancingProposal: "#collara-contracts:Collara.Financing:FinancingProposal",
  FinancingAgreement: "#collara-contracts:Collara.Financing:FinancingAgreement",
  PledgeActivationAuthorization: "#collara-contracts:Collara.Financing:PledgeActivationAuthorization",
  ReleaseRequest: "#collara-contracts:Collara.Release:ReleaseRequest",
  ReleaseDecision: "#collara-contracts:Collara.Release:ReleaseDecision",
  AuditGrant: "#collara-contracts:Collara.Audit:AuditGrant",
  VerifierRegistry: "#collara-governance:Collara.Governance.Registry:VerifierRegistry",
  VerifierAccreditation: "#collara-governance:Collara.Governance.Registry:VerifierAccreditation",
  BootstrapVerifierRegistryProposal: "#collara-governance:Collara.Governance.Proposals:BootstrapVerifierRegistryProposal",
  AddVerifierProposal: "#collara-governance:Collara.Governance.Proposals:AddVerifierProposal",
  SuspendVerifierProposal: "#collara-governance:Collara.Governance.Proposals:SuspendVerifierProposal",
  GovernanceRules: "#governance-core-v1:Governance.Rules:GovernanceRules",
  GovernanceConfirmation: "#governance-core-v1:Governance.Confirmation:GovernanceConfirmation",
  GovernanceExecutionResult: "#governance-core-v1:Governance.ExecutionResult:GovernanceExecutionResult",
} as const;
export type KnownTemplate = keyof typeof T;

export const TEMPLATE_MAPPINGS: readonly TemplateMapping[] = [
  { templateRef: T.CollaraConfig, businessRef: field("namespace"), caseRef: none, assetRef: none },
  { templateRef: T.VerifierStatusMirror, businessRef: field("verifierRef"), caseRef: none, assetRef: none },
  { templateRef: T.AssetRegistrationRequest, businessRef: field("requestRef"), caseRef: none, assetRef: none },
  { templateRef: T.AssetRegistry, businessRef: field("namespace"), caseRef: none, assetRef: none },
  { templateRef: T.IssuanceTicket, businessRef: field("assetId") },
  { templateRef: T.AssetPassport, businessRef: field("assetId") },
  { templateRef: T.AssetControl, businessRef: field("assetId") },
  { templateRef: T.RetiredControl, businessRef: field("assetId") },
  { templateRef: T.CollateralLock, businessRef: field("lockRef") },
  { templateRef: T.CollateralLockReleased, businessRef: field("lockRef") },
  { templateRef: T.EvidenceManifest, businessRef: field("packageRef") },
  { templateRef: T.DealerContribution, businessRef: field("docRef"), assetRef: none },
  { templateRef: T.PackageShareProposal, businessRef: field("shareRef"), assetRef: none },
  { templateRef: T.PackageShare, businessRef: field("shareRef"), assetRef: none },
  { templateRef: T.VerificationRequest, businessRef: field("requestRef") },
  { templateRef: T.VerificationAttestation, businessRef: field("attestationRef") },
  {
    templateRef: T.AttestationDisclosure,
    businessRef: nested("attestation", "attestationRef"),
    assetRef: nested("attestation", "assetId"),
  },
  // The activation's ledger dependency on a live disclosure (daml-model.md §4.5). Stored, not presented.
  { templateRef: T.DisclosureValidity, businessRef: field("attestationRef") },
  { templateRef: T.RevokedAttestation, businessRef: field("attestationRef"), caseRef: none },
  { templateRef: T.CollateralAssessment, businessRef: field("assessmentRef") },
  { templateRef: T.LenderDecisionNotice, businessRef: field("noticeRef"), assetRef: none },
  { templateRef: T.FinancingProposal, businessRef: field("proposalRef") },
  { templateRef: T.FinancingAgreement, businessRef: field("agreementRef") },
  { templateRef: T.PledgeActivationAuthorization, businessRef: field("authorizationRef") },
  { templateRef: T.ReleaseRequest, businessRef: field("releaseRequestRef") },
  { templateRef: T.ReleaseDecision, businessRef: field("decisionRef"), assetRef: none },
  { templateRef: T.AuditGrant, businessRef: field("grantRef"), assetRef: none },
  { templateRef: T.VerifierRegistry, businessRef: field("registryId"), caseRef: none, assetRef: none },
  { templateRef: T.VerifierAccreditation, businessRef: field("verifierRef"), caseRef: none, assetRef: none },
  { templateRef: T.BootstrapVerifierRegistryProposal, businessRef: field("registryId"), caseRef: none, assetRef: none },
  { templateRef: T.AddVerifierProposal, businessRef: field("verifierRef"), caseRef: none, assetRef: none },
  { templateRef: T.SuspendVerifierProposal, businessRef: none, caseRef: none, assetRef: none },
  { templateRef: T.GovernanceRules, businessRef: none, caseRef: none, assetRef: none },
  { templateRef: T.GovernanceConfirmation, businessRef: field("actionLabel"), caseRef: none, assetRef: none },
  { templateRef: T.GovernanceExecutionResult, businessRef: field("actionLabel"), caseRef: none, assetRef: none },
];

const BY_REF = new Map(TEMPLATE_MAPPINGS.map((m) => [m.templateRef, m]));

export function templateMapping(templateRef: string): TemplateMapping | undefined {
  return BY_REF.get(templateRef);
}

export interface ExtractedRefs {
  readonly businessRef: string | null;
  readonly caseRef: string | null;
  readonly assetRef: string | null;
}

/** Business columns for a created contract; unknown templates of projected packages get the defaults. */
export function extractRefs(templateRef: string, createArgument: unknown): ExtractedRefs {
  const payload: Payload = createArgument && typeof createArgument === "object" ? (createArgument as Payload) : {};
  const mapping = BY_REF.get(templateRef);
  return {
    businessRef: (mapping?.businessRef ?? none)(payload),
    caseRef: (mapping?.caseRef ?? field("caseRef"))(payload),
    assetRef: (mapping?.assetRef ?? field("assetId"))(payload),
  };
}
