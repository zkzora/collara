// Package-name template ids (daml-model.md §9). Never use package ids: they change with every source change.
import { templateId, type TemplateId } from "@collara/canton";

const contracts = (module: string, entity: string) => templateId("collara-contracts", module, entity);
const governance = (module: string, entity: string) => templateId("collara-governance", module, entity);

export const TEMPLATES = {
  CollaraConfig: contracts("Collara.Config", "CollaraConfig"),
  VerifierStatusMirror: contracts("Collara.Config", "VerifierStatusMirror"),
  AssetRegistrationRequest: contracts("Collara.Registration", "AssetRegistrationRequest"),
  AssetRegistry: contracts("Collara.Registration", "AssetRegistry"),
  IssuanceTicket: contracts("Collara.Registration", "IssuanceTicket"),
  AssetPassport: contracts("Collara.Registration", "AssetPassport"),
  AssetControl: contracts("Collara.Control", "AssetControl"),
  RetiredControl: contracts("Collara.Control", "RetiredControl"),
  CollateralLock: contracts("Collara.Control", "CollateralLock"),
  CollateralLockReleased: contracts("Collara.Control", "CollateralLockReleased"),
  EvidenceManifest: contracts("Collara.Evidence", "EvidenceManifest"),
  DealerContribution: contracts("Collara.Evidence", "DealerContribution"),
  PackageShareProposal: contracts("Collara.Evidence", "PackageShareProposal"),
  PackageShare: contracts("Collara.Evidence", "PackageShare"),
  VerificationRequest: contracts("Collara.Verification", "VerificationRequest"),
  VerificationAttestation: contracts("Collara.Verification", "VerificationAttestation"),
  AttestationDisclosure: contracts("Collara.Verification", "AttestationDisclosure"),
  DisclosureValidity: contracts("Collara.Verification", "DisclosureValidity"),
  RevokedAttestation: contracts("Collara.Verification", "RevokedAttestation"),
  CollateralAssessment: contracts("Collara.Financing", "CollateralAssessment"),
  LenderDecisionNotice: contracts("Collara.Financing", "LenderDecisionNotice"),
  FinancingProposal: contracts("Collara.Financing", "FinancingProposal"),
  FinancingAgreement: contracts("Collara.Financing", "FinancingAgreement"),
  PledgeActivationAuthorization: contracts("Collara.Financing", "PledgeActivationAuthorization"),
  ReleaseRequest: contracts("Collara.Release", "ReleaseRequest"),
  ReleaseDecision: contracts("Collara.Release", "ReleaseDecision"),
  AuditGrant: contracts("Collara.Audit", "AuditGrant"),
  VerifierRegistry: governance("Collara.Governance.Registry", "VerifierRegistry"),
  VerifierAccreditation: governance("Collara.Governance.Registry", "VerifierAccreditation"),
  BootstrapVerifierRegistryProposal: governance("Collara.Governance.Proposals", "BootstrapVerifierRegistryProposal"),
  AddVerifierProposal: governance("Collara.Governance.Proposals", "AddVerifierProposal"),
  SuspendVerifierProposal: governance("Collara.Governance.Proposals", "SuspendVerifierProposal"),
  GovernanceRules: templateId("governance-core-v1", "Governance.Rules", "GovernanceRules"),
  GovernanceConfirmation: templateId("governance-core-v1", "Governance.Confirmation", "GovernanceConfirmation"),
  GovernanceExecutionResult: templateId("governance-core-v1", "Governance.ExecutionResult", "GovernanceExecutionResult"),
  /** Interface: interface choices (GovernableAction_ProposerCancel) use the interface id as templateId. */
  GovernableAction: templateId("governance-action-v1", "Governance.Action", "GovernableAction"),
} as const satisfies Record<string, TemplateId>;

export type TemplateName = keyof typeof TEMPLATES;
