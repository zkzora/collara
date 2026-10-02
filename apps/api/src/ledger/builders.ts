// Typed builders for every Collara ledger command (daml-model.md §4 and §7). They encode arguments in the
// JSON Ledger API v2 form (Int and Numeric as strings, Time as ISO UTC, Set as {"map": …}, Optional as
// null) so callers never hand-write Daml JSON. Validate inputs before building: the JSON API answers
// some malformed payloads with HTTP 500 (packages/canton/README.md).
import { createHash } from "node:crypto";
import { create, damlValue, exercise, type LedgerCommand } from "@collara/canton";
import type { DocumentType } from "@collara/domain";
import { canonicalJson } from "../services/commands";
import { TEMPLATES as T } from "./templates";

const { int64, numeric, time, date, damlSet } = damlValue;

type Party = string;
type Cid = string;
type TimeInput = Date | string;

export interface EvidenceAnchorInput {
  readonly packageRef: string;
  readonly manifestVersion: number;
  readonly manifestHash: string;
}
export interface ReviewSnapshotInput {
  readonly evidence: EvidenceAnchorInput;
  readonly attestationRef: string;
  readonly attestationVerifier: Party;
  readonly attestationValidUntil: TimeInput;
}
/** Money as a decimal string + ISO currency ("100000.00", "USD"). */
export interface MoneyInput {
  readonly amount: string;
  readonly currency: string;
}
export interface ManifestEntryInput {
  readonly docRef: string;
  readonly docType: string;
  readonly docVersion: number;
  readonly sha256: string;
  readonly source: Party;
  readonly contributorRef: string;
}
export interface SharedDocumentInput {
  readonly docRef: string;
  readonly docVersion: number;
  readonly sha256: string;
  readonly source: Party;
}
export interface CheckItemInput {
  readonly item: string;
  readonly finding: string;
  readonly result: "CHECKED" | "CHECKED_NOTED" | "REVIEWED_DOCUMENTS" | "NOT_CHECKED";
}
export interface EquipmentIdentityInput {
  readonly manufacturer: string;
  readonly model: string;
  readonly serialNumber: string;
}
export interface ValuationInput {
  readonly value: MoneyInput;
  readonly source: string;
  readonly valuationDate: TimeInput;
  readonly limitations: string;
}
export interface GenesisVerifierInput {
  readonly verifier: Party;
  readonly verifierRef: string;
  readonly orgName: string;
  readonly scope: readonly string[];
  readonly validUntil: TimeInput | null;
}

// --- Encoders ----------------------------------------------------------------------------------------

export const encode = {
  anchor: (a: EvidenceAnchorInput) => ({ packageRef: a.packageRef, manifestVersion: int64(a.manifestVersion), manifestHash: a.manifestHash }),
  snapshot: (s: ReviewSnapshotInput) => ({
    evidence: encode.anchor(s.evidence),
    attestationRef: s.attestationRef,
    attestationVerifier: s.attestationVerifier,
    attestationValidUntil: time(s.attestationValidUntil),
  }),
  money: (m: MoneyInput) => ({ amount: numeric(m.amount, 2), currency: m.currency }),
  entry: (e: ManifestEntryInput) => ({ ...e, docVersion: int64(e.docVersion) }),
  sharedDocument: (d: SharedDocumentInput) => ({ ...d, docVersion: int64(d.docVersion) }),
  valuation: (v: ValuationInput) => ({ value: encode.money(v.value), source: v.source, valuationDate: date(v.valuationDate), limitations: v.limitations }),
  /** DA.Time RelTime. */
  relTime: (milliseconds: number) => ({ microseconds: int64(Math.round(milliseconds) * 1000) }),
  partySet: (parties: Iterable<Party>) => damlSet(parties),
  time: (value: TimeInput) => time(value),
  optionalTime: (value: TimeInput | null | undefined) => (value === null || value === undefined ? null : time(value)),
} as const;

// --- Hashes and references computed off-ledger -------------------------------------------------------

/**
 * Identity commitment exactly as `Collara.Registration.identityCommitmentOf` computes it on-ledger:
 * SHA-256 (lowercase hex) of "<MANUFACTURER>|<MODEL>|<SERIAL>", each part trimmed and ASCII upper-cased.
 * The ledger rejects a request whose commitment does not match its equipment.
 */
export function identityCommitmentOf(equipment: EquipmentIdentityInput): string {
  const part = (value: string) => value.trim().replace(/[a-z]/g, (c) => c.toUpperCase());
  return createHash("sha256").update([equipment.manufacturer, equipment.model, equipment.serialNumber].map(part).join("|")).digest("hex");
}

/**
 * Manifest hash: SHA-256 of the canonical JSON (sorted keys) of {packageRef, version, entries}, entries in
 * the given order with docVersion as a number. The ledger compares it and cannot recompute it.
 */
export function manifestHashOf(manifest: { packageRef: string; version: number; entries: readonly ManifestEntryInput[] }): string {
  return createHash("sha256")
    .update(canonicalJson({ packageRef: manifest.packageRef, version: manifest.version, entries: manifest.entries.map((e) => ({ ...e })) }))
    .digest("hex");
}

/** Ledger `docType` text for a domain document type (daml-model.md §7 uses "INVOICE" for the dealer invoice). */
export const LEDGER_DOC_TYPES: Readonly<Record<DocumentType, string>> = {
  DEALER_INVOICE: "INVOICE",
  EQUIPMENT_PHOTOS: "EQUIPMENT_PHOTOS",
  INSPECTION_REPORT: "INSPECTION_REPORT",
  MAINTENANCE_SUMMARY: "MAINTENANCE_SUMMARY",
  PURCHASE_AGREEMENT: "PURCHASE_AGREEMENT",
  OTHER: "OTHER",
};

/** Opaque in-organisation actor reference recorded on choices (never a name or an e-mail). */
export function actorRefFor(userId: string, kind: "member" | "system" = "member"): string {
  const id = userId.replace(/^user-/, "").replace(/^system:/, "");
  return kind === "system" ? `svc:${id}` : `mbr:${id}`;
}

// --- Commands ----------------------------------------------------------------------------------------

export const ledgerCommands = {
  // Config and verifier status (registrar) ------------------------------------------------------------
  /** B7 */
  createConfig(a: { registrar: Party; namespace: string; governanceParty: Party; suspensionPolicy?: "REQUIRE_ACTIVE_VERIFIER" | "ALLOW_ISSUED_ATTESTATIONS"; configVersion?: number; directory: readonly Party[] }): LedgerCommand {
    return create(T.CollaraConfig, {
      registrar: a.registrar,
      namespace: a.namespace,
      governanceParty: a.governanceParty,
      suspensionPolicy: a.suspensionPolicy ?? "REQUIRE_ACTIVE_VERIFIER",
      configVersion: int64(a.configVersion ?? 1),
      directory: [...a.directory],
    });
  },
  /** B8 (non-consuming) → mirror cid */
  publishVerifierStatus(configCid: Cid, a: { accreditationCid: Cid; sourceRef: string }): LedgerCommand {
    return exercise(T.CollaraConfig, configCid, "Config_PublishVerifierStatus", { accreditationCid: a.accreditationCid, sourceRef: a.sourceRef });
  },
  configUpdate(configCid: Cid, a: { newGovernanceParty: Party; newSuspensionPolicy: "REQUIRE_ACTIVE_VERIFIER" | "ALLOW_ISSUED_ATTESTATIONS"; newDirectory: readonly Party[] }): LedgerCommand {
    return exercise(T.CollaraConfig, configCid, "Config_Update", { ...a, newDirectory: [...a.newDirectory] });
  },
  mirrorSync(mirrorCid: Cid, a: { configCid: Cid; accreditationCid: Cid; newSourceRef: string }): LedgerCommand {
    return exercise(T.VerifierStatusMirror, mirrorCid, "Mirror_Sync", { ...a });
  },

  // Registration ------------------------------------------------------------------------------------
  /** B1 */
  createAssetRegistry(a: { registrar: Party; namespace: string }): LedgerCommand {
    return create(T.AssetRegistry, { registrar: a.registrar, namespace: a.namespace, issuedAssetIds: damlSet([]), issuedIdentityCommitments: damlSet([]), version: int64(0) });
  },
  /** M1 (owner). The identity commitment is computed here, exactly as the ledger checks it. */
  createRegistrationRequest(a: {
    owner: Party;
    registrar: Party;
    namespace: string;
    requestRef: string;
    equipmentClass: string;
    equipment: EquipmentIdentityInput;
    yearOfManufacture: number | null;
    locationScope: string;
    ownerClaimRef: string;
  }): LedgerCommand {
    return create(T.AssetRegistrationRequest, {
      owner: a.owner,
      registrar: a.registrar,
      namespace: a.namespace,
      requestRef: a.requestRef,
      equipmentClass: a.equipmentClass,
      equipment: { ...a.equipment },
      details: { yearOfManufacture: a.yearOfManufacture === null ? null : int64(a.yearOfManufacture), locationScope: a.locationScope },
      identityCommitment: identityCommitmentOf(a.equipment),
      ownerClaimRef: a.ownerClaimRef,
    });
  },
  /** M2 (registrar, top-level) → (registryCid, ticketCid) */
  registryReserve(registryCid: Cid, a: { assetId: string; owner: Party; requestRef: string; identityCommitment: string; actorRef: string }): LedgerCommand {
    return exercise(T.AssetRegistry, registryCid, "Registry_Reserve", { ...a });
  },
  /** M3 (registrar) → (controlCid v1, passportCid) */
  requestAccept(requestCid: Cid, a: { ticketCid: Cid; actorRef: string }): LedgerCommand {
    return exercise(T.AssetRegistrationRequest, requestCid, "Request_Accept", { ...a });
  },
  requestDecline(requestCid: Cid, a: { reasonCode: string; actorRef: string }): LedgerCommand {
    return exercise(T.AssetRegistrationRequest, requestCid, "Request_Decline", { ...a });
  },
  requestWithdraw(requestCid: Cid, a: { actorRef: string }): LedgerCommand {
    return exercise(T.AssetRegistrationRequest, requestCid, "Request_Withdraw", { ...a });
  },

  // Evidence ----------------------------------------------------------------------------------------
  /** M4 (dealer) */
  createDealerContribution(a: { dealer: Party; owner: Party; caseRef: string; docRef: string; docType: string; docVersion: number; sha256: string; contributorRef: string; verificationUseConsented: boolean }): LedgerCommand {
    return create(T.DealerContribution, { ...a, docVersion: int64(a.docVersion) });
  },
  contributionWithdraw(contributionCid: Cid, a: { actorRef: string }): LedgerCommand {
    return exercise(T.DealerContribution, contributionCid, "Contribution_Withdraw", { ...a });
  },
  /** M5 (owner) */
  createManifest(a: { owner: Party; registrar: Party; namespace: string; assetId: string; packageRef: string; version: number; manifestHash: string; entries: readonly ManifestEntryInput[] }): LedgerCommand {
    return create(T.EvidenceManifest, { ...a, version: int64(a.version), entries: a.entries.map(encode.entry) });
  },
  /** M6 (owner, non-consuming) → new control cid (version+1) */
  manifestAnchor(manifestCid: Cid, a: { controlCid: Cid; actorRef: string }): LedgerCommand {
    return exercise(T.EvidenceManifest, manifestCid, "Manifest_Anchor", { ...a });
  },
  /** M10 (owner) → (manifestCid, controlCid) */
  manifestNewVersion(manifestCid: Cid, a: { newEntries: readonly ManifestEntryInput[]; newManifestHash: string; controlCid: Cid; actorRef: string }): LedgerCommand {
    return exercise(T.EvidenceManifest, manifestCid, "Manifest_NewVersion", { ...a, newEntries: a.newEntries.map(encode.entry) });
  },
  /** M7 (owner, non-consuming) → request cid (REQUESTED) */
  manifestRequestVerification(
    manifestCid: Cid,
    a: { verifier: Party; requestRef: string; passportVersion: number; caseRef: string | null; equipmentScope: string; checklist: readonly string[]; dueBy: TimeInput | null; actorRef: string },
  ): LedgerCommand {
    return exercise(T.EvidenceManifest, manifestCid, "Manifest_RequestVerification", {
      ...a,
      passportVersion: int64(a.passportVersion),
      checklist: [...a.checklist],
      dueBy: encode.optionalTime(a.dueBy),
    });
  },
  /** M11 (owner, non-consuming) → request cid (IN_REVIEW) */
  manifestSubmitToVerification(manifestCid: Cid, a: { requestCid: Cid; actorRef: string }): LedgerCommand {
    return exercise(T.EvidenceManifest, manifestCid, "Manifest_SubmitToVerification", { ...a });
  },
  /** M13 (owner): dealer documents only */
  createPackageShareProposal(a: {
    owner: Party;
    dealer: Party;
    recipient: Party;
    shareRef: string;
    purpose: string;
    caseRef: string;
    evidence: EvidenceAnchorInput;
    documents: readonly SharedDocumentInput[];
    permission: "VIEW" | "VIEW_DOWNLOAD";
    expiresAt: TimeInput;
  }): LedgerCommand {
    return create(T.PackageShareProposal, { ...a, evidence: encode.anchor(a.evidence), documents: a.documents.map(encode.sharedDocument), expiresAt: time(a.expiresAt) });
  },
  /** M14 (dealer) → share cid */
  consentGrant(proposalCid: Cid, a: { actorRef: string }): LedgerCommand {
    return exercise(T.PackageShareProposal, proposalCid, "Consent_Grant", { ...a });
  },
  consentDecline(proposalCid: Cid, a: { reason: string; actorRef: string }): LedgerCommand {
    return exercise(T.PackageShareProposal, proposalCid, "Consent_Decline", { ...a });
  },
  shareProposalWithdraw(proposalCid: Cid, a: { actorRef: string }): LedgerCommand {
    return exercise(T.PackageShareProposal, proposalCid, "ShareProposal_Withdraw", { ...a });
  },
  /** M15 (owner): owner documents, consenters = [] */
  createPackageShare(a: {
    owner: Party;
    consenters?: readonly Party[];
    recipient: Party;
    shareRef: string;
    purpose: string;
    caseRef: string;
    evidence: EvidenceAnchorInput;
    documents: readonly SharedDocumentInput[];
    permission: "VIEW" | "VIEW_DOWNLOAD";
    expiresAt: TimeInput;
  }): LedgerCommand {
    return create(T.PackageShare, {
      ...a,
      consenters: [...(a.consenters ?? [])],
      evidence: encode.anchor(a.evidence),
      documents: a.documents.map(encode.sharedDocument),
      expiresAt: time(a.expiresAt),
    });
  },
  shareRevoke(shareCid: Cid, a: { actorRef: string }): LedgerCommand {
    return exercise(T.PackageShare, shareCid, "Share_Revoke", { ...a });
  },
  shareWithdrawConsent(shareCid: Cid, a: { consenter: Party; actorRef: string }): LedgerCommand {
    return exercise(T.PackageShare, shareCid, "Share_WithdrawConsent", { ...a });
  },

  // Control -----------------------------------------------------------------------------------------
  /** M16 (owner) → control cid (same version) */
  controlShareWithLender(controlCid: Cid, a: { lender: Party; actorRef: string }): LedgerCommand {
    return exercise(T.AssetControl, controlCid, "Control_ShareWithLender", { ...a });
  },
  controlRevokeLenderView(controlCid: Cid, a: { lender: Party; actorRef: string }): LedgerCommand {
    return exercise(T.AssetControl, controlCid, "Control_RevokeLenderView", { ...a });
  },
  controlCorrect(controlCid: Cid, a: { reason: string; actorRef: string }): LedgerCommand {
    return exercise(T.AssetControl, controlCid, "Control_Correct", { ...a });
  },
  /** W8 (lender approver). Check the lender's AttestationDisclosure off-ledger first (daml-model.md §8.2). */
  controlActivate(controlCid: Cid, a: { lender: Party; authorizationCid: Cid; configCid: Cid; verifierStatusCid: Cid; lockRef: string; actorRef: string }): LedgerCommand {
    return exercise(T.AssetControl, controlCid, "Control_Activate", { ...a });
  },

  // Verification ------------------------------------------------------------------------------------
  /** M8 (verifier) */
  vrAcceptAssignment(requestCid: Cid, a: { configCid: Cid; accreditationCid: Cid; actorRef: string }): LedgerCommand {
    return exercise(T.VerificationRequest, requestCid, "VR_AcceptAssignment", { ...a });
  },
  vrDeclineAssignment(requestCid: Cid, a: { reason: string; actorRef: string }): LedgerCommand {
    return exercise(T.VerificationRequest, requestCid, "VR_DeclineAssignment", { ...a });
  },
  /** M9 (verifier) */
  vrRequestChanges(requestCid: Cid, a: { note: string; actorRef: string }): LedgerCommand {
    return exercise(T.VerificationRequest, requestCid, "VR_RequestChanges", { ...a });
  },
  /** M12 (verifier) → attestation cid */
  vrIssueAttestation(
    requestCid: Cid,
    a: {
      configCid: Cid;
      accreditationCid: Cid;
      attestationRef: string;
      checks: readonly CheckItemInput[];
      limitations: string;
      method: string;
      inspectedAt: TimeInput;
      validFrom: TimeInput;
      validUntil: TimeInput;
      supersedes: { previousCid: Cid; previousDisclosureCids: readonly Cid[] } | null;
      actorRef: string;
    },
  ): LedgerCommand {
    return exercise(T.VerificationRequest, requestCid, "VR_IssueAttestation", {
      ...a,
      checks: a.checks.map((c) => ({ ...c })),
      inspectedAt: time(a.inspectedAt),
      validFrom: time(a.validFrom),
      validUntil: time(a.validUntil),
      supersedes: a.supersedes ? { previousCid: a.supersedes.previousCid, previousDisclosureCids: [...a.supersedes.previousDisclosureCids] } : null,
    });
  },
  vrReject(requestCid: Cid, a: { reason: string; actorRef: string }): LedgerCommand {
    return exercise(T.VerificationRequest, requestCid, "VR_Reject", { ...a });
  },
  vrCancel(requestCid: Cid, a: { actorRef: string }): LedgerCommand {
    return exercise(T.VerificationRequest, requestCid, "VR_Cancel", { ...a });
  },
  /** M17 (owner, non-consuming) → disclosure cid */
  attDiscloseTo(attestationCid: Cid, a: { recipient: Party; purpose: string; disclosureCaseRef: string; actorRef: string }): LedgerCommand {
    return exercise(T.VerificationAttestation, attestationCid, "Att_DiscloseTo", { ...a });
  },
  attRevoke(attestationCid: Cid, a: { reason: string; disclosureCids: readonly Cid[]; actorRef: string }): LedgerCommand {
    return exercise(T.VerificationAttestation, attestationCid, "Att_Revoke", { ...a, disclosureCids: [...a.disclosureCids] });
  },
  attDiscRevoke(disclosureCid: Cid, a: { actorRef: string }): LedgerCommand {
    return exercise(T.AttestationDisclosure, disclosureCid, "AttDisc_Revoke", { ...a });
  },

  // Financing ---------------------------------------------------------------------------------------
  /** M18 (lender): snapshot copied from the lender's AttestationDisclosure */
  createCollateralAssessment(a: {
    lender: Party;
    borrower: Party;
    assessmentRef: string;
    caseRef: string;
    namespace: string;
    assetId: string;
    snapshot: ReviewSnapshotInput;
    valuation?: ValuationInput | null;
    policyRef: string;
    status?: "SUBMITTED";
    version?: number;
    lastActorRef: string;
  }): LedgerCommand {
    return create(T.CollateralAssessment, {
      lender: a.lender,
      borrower: a.borrower,
      assessmentRef: a.assessmentRef,
      caseRef: a.caseRef,
      namespace: a.namespace,
      assetId: a.assetId,
      snapshot: encode.snapshot(a.snapshot),
      valuation: a.valuation ? encode.valuation(a.valuation) : null,
      policyRef: a.policyRef,
      status: a.status ?? "SUBMITTED",
      version: int64(a.version ?? 1),
      lastActorRef: a.lastActorRef,
    });
  },
  assessmentStartReview: (cid: Cid, a: { actorRef: string }) => exercise(T.CollateralAssessment, cid, "Assessment_StartReview", { ...a }),
  assessmentSave: (cid: Cid, a: { newValuation: ValuationInput; newPolicyRef: string; actorRef: string }) =>
    exercise(T.CollateralAssessment, cid, "Assessment_Save", { newValuation: encode.valuation(a.newValuation), newPolicyRef: a.newPolicyRef, actorRef: a.actorRef }),
  assessmentSubmitForApproval: (cid: Cid, a: { actorRef: string }) => exercise(T.CollateralAssessment, cid, "Assessment_SubmitForApproval", { ...a }),
  /** → (assessmentCid, noticeCid) */
  assessmentApprove: (cid: Cid, a: { noticeRef: string; sharedFeedback: string; actorRef: string }) => exercise(T.CollateralAssessment, cid, "Assessment_Approve", { ...a }),
  assessmentReject: (cid: Cid, a: { noticeRef: string; sharedFeedback: string; actorRef: string }) => exercise(T.CollateralAssessment, cid, "Assessment_Reject", { ...a }),
  assessmentRequestInformation: (cid: Cid, a: { noticeRef: string; sharedFeedback: string; actorRef: string }) =>
    exercise(T.CollateralAssessment, cid, "Assessment_RequestInformation", { ...a }),
  assessmentUpdateSnapshot: (cid: Cid, a: { newSnapshot: ReviewSnapshotInput; actorRef: string }) =>
    exercise(T.CollateralAssessment, cid, "Assessment_UpdateSnapshot", { newSnapshot: encode.snapshot(a.newSnapshot), actorRef: a.actorRef }),
  /** W5 (non-consuming) → proposal cid */
  assessmentIssueProposal: (cid: Cid, a: { proposalRef: string; principal: MoneyInput; termMetadata: string; externalLegalRef: string; expiresAt: TimeInput; actorRef: string }) =>
    exercise(T.CollateralAssessment, cid, "Assessment_IssueProposal", { ...a, principal: encode.money(a.principal), expiresAt: time(a.expiresAt) }),
  /** W6 (borrower) → agreement cid */
  proposalAccept: (cid: Cid, a: { expectedProposalRef: string; expectedVersion: number; actorRef: string }) =>
    exercise(T.FinancingProposal, cid, "Proposal_Accept", { ...a, expectedVersion: int64(a.expectedVersion) }),
  proposalDecline: (cid: Cid, a: { reason: string; actorRef: string }) => exercise(T.FinancingProposal, cid, "Proposal_Decline", { ...a }),
  proposalWithdraw: (cid: Cid, a: { reason: string; actorRef: string }) => exercise(T.FinancingProposal, cid, "Proposal_Withdraw", { ...a }),
  proposalRevise: (cid: Cid, a: { newPrincipal: MoneyInput; newTermMetadata: string; newExternalLegalRef: string; newExpiresAt: TimeInput; actorRef: string }) =>
    exercise(T.FinancingProposal, cid, "Proposal_Revise", { ...a, newPrincipal: encode.money(a.newPrincipal), newExpiresAt: time(a.newExpiresAt) }),
  /** W7 (borrower, non-consuming) → authorization cid */
  agreementAuthorizeActivation: (cid: Cid, a: { authorizationRef: string; expectedControlVersion: number; expiresAt: TimeInput; actorRef: string }) =>
    exercise(T.FinancingAgreement, cid, "Agreement_AuthorizeActivation", { ...a, expectedControlVersion: int64(a.expectedControlVersion), expiresAt: time(a.expiresAt) }),
  authWithdraw: (cid: Cid, a: { actorRef: string }) => exercise(T.PledgeActivationAuthorization, cid, "Auth_Withdraw", { ...a }),

  // Release -----------------------------------------------------------------------------------------
  /** W9/W11 (owner or lender) */
  createReleaseRequest(a: {
    requester: Party;
    owner: Party;
    lender: Party;
    lockCid: Cid;
    lockRef: string;
    caseRef: string;
    namespace: string;
    assetId: string;
    releaseRequestRef: string;
    reason: "EXTERNAL_LOAN_COMPLETION" | "REFINANCING" | "ADMINISTRATIVE_CORRECTION";
    noteRef: string;
    requestedByRef: string;
  }): LedgerCommand {
    return create(T.ReleaseRequest, { ...a, status: "REQUESTED", version: int64(1) });
  },
  /** W12 → (controlCid, releasedCid, decisionCid) */
  releaseAuthorize: (cid: Cid, a: { decisionRef: string; actorRef: string }) => exercise(T.ReleaseRequest, cid, "Release_Authorize", { ...a }),
  releaseReject: (cid: Cid, a: { decisionRef: string; sharedReason: string; actorRef: string }) => exercise(T.ReleaseRequest, cid, "Release_Reject", { ...a }),
  releaseRequestInformation: (cid: Cid, a: { questionRef: string; actorRef: string }) => exercise(T.ReleaseRequest, cid, "Release_RequestInformation", { ...a }),
  releaseRespond: (cid: Cid, a: { responseNoteRef: string; actorRef: string }) => exercise(T.ReleaseRequest, cid, "Release_Respond", { ...a }),
  releaseWithdraw: (cid: Cid, a: { actorRef: string }) => exercise(T.ReleaseRequest, cid, "Release_Withdraw", { ...a }),

  // Audit -------------------------------------------------------------------------------------------
  createAuditGrant(a: {
    grantor: Party;
    auditor: Party;
    grantRef: string;
    caseRef: string;
    scopes: readonly ("EVIDENCE_MANIFEST" | "ATTESTATION" | "DECISION_OUTCOME" | "PROPOSAL_TERMS" | "PLEDGE_RELEASE_EVENTS")[];
    permission: "VIEW" | "EXPORT";
    purpose: string;
    expiresAt: TimeInput;
  }): LedgerCommand {
    return create(T.AuditGrant, { ...a, scopes: [...a.scopes], expiresAt: time(a.expiresAt) });
  },
  grantRevoke: (cid: Cid, a: { actorRef: string }) => exercise(T.AuditGrant, cid, "Grant_Revoke", { ...a }),

  // Governance (seats act as themselves and read as the governance party) -----------------------------
  /** B2 (governance party, Tier A) */
  createGovernanceRules(a: { governanceParty: Party; members: readonly Party[]; threshold: number; actionConfirmationTimeoutMs: number; additionalProposers?: readonly Party[] | null }): LedgerCommand {
    return create(T.GovernanceRules, {
      governanceParty: a.governanceParty,
      members: damlSet(a.members),
      threshold: int64(a.threshold),
      actionConfirmationTimeout: encode.relTime(a.actionConfirmationTimeoutMs),
      additionalProposers: a.additionalProposers ? damlSet(a.additionalProposers) : null,
    });
  },
  /** B3 (seat) */
  createBootstrapVerifierRegistryProposal(a: {
    governanceParty: Party;
    proposer: Party;
    operator: Party;
    registryId: string;
    genesisVerifiers: readonly GenesisVerifierInput[];
    proposalDeadline: TimeInput;
    reason: string;
  }): LedgerCommand {
    return create(T.BootstrapVerifierRegistryProposal, {
      ...a,
      genesisVerifiers: a.genesisVerifiers.map((g) => ({ ...g, scope: [...g.scope], validUntil: encode.optionalTime(g.validUntil) })),
      proposalDeadline: time(a.proposalDeadline),
    });
  },
  createAddVerifierProposal(a: {
    governanceParty: Party;
    proposer: Party;
    registryCid: Cid;
    expectedVersion: number;
    verifier: Party;
    verifierRef: string;
    orgName: string;
    scope: readonly string[];
    validUntil: TimeInput | null;
    proposalDeadline: TimeInput;
    reason: string;
  }): LedgerCommand {
    return create(T.AddVerifierProposal, {
      ...a,
      expectedVersion: int64(a.expectedVersion),
      scope: [...a.scope],
      validUntil: encode.optionalTime(a.validUntil),
      proposalDeadline: time(a.proposalDeadline),
    });
  },
  createSuspendVerifierProposal(a: {
    governanceParty: Party;
    proposer: Party;
    registryCid: Cid;
    expectedVersion: number;
    accreditationCid: Cid;
    verifier: Party;
    proposalDeadline: TimeInput;
    reason: string;
  }): LedgerCommand {
    return create(T.SuspendVerifierProposal, { ...a, expectedVersion: int64(a.expectedVersion), proposalDeadline: time(a.proposalDeadline) });
  },
  /** B4/B5 → { confirmationCid } */
  confirmAction: (rulesCid: Cid, a: { confirmer: Party; actionProposalCid: Cid }) => exercise(T.GovernanceRules, rulesCid, "GovernanceRules_ConfirmAction", { ...a }),
  /** B6 → { executionResultCid } */
  executeConfirmedAction: (rulesCid: Cid, a: { executor: Party; actionProposalCid: Cid; confirmations: readonly Cid[] }) =>
    exercise(T.GovernanceRules, rulesCid, "GovernanceRules_ExecuteConfirmedAction", { ...a, confirmations: [...a.confirmations] }),
  /** Interface choice: the proposer cancels its own governed action. */
  proposerCancel: (actionProposalCid: Cid) => exercise(T.GovernableAction, actionProposalCid, "GovernableAction_ProposerCancel", {}),
} as const;
