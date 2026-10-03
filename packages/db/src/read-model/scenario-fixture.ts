// Test support: the daml-model.md §7 command sequence (bootstrap B1–B8, main fixture M1–M18, walkthrough
// W1–W14) as normalized LEDGER_EFFECTS transactions with JSON Ledger API v2 payload encodings, served by a
// FakeLedger. Party ids use a fixed fake namespace. Never used by production code.
import type { LocalnetBindingSource } from "../bindings";
import { FakeLedger } from "../projection/fake-ledger";
import { TEMPLATES as T } from "../projection";

export const HINTS = [
  "CollaraRegistrar",
  "CollaraGovernance",
  "GovSeat1",
  "GovSeat2",
  "GovSeat3",
  "DemoManufacturer",
  "DemoCNCDealer",
  "DemoVerifier",
  "DemoLenderA",
  "DemoLenderB",
  "DemoAuditor",
] as const;

export type ScenarioParties = Record<
  "registrar" | "governance" | "seat1" | "seat2" | "seat3" | "owner" | "dealer" | "verifier" | "lenderA" | "lenderB" | "auditor",
  string
>;

export function scenarioParties(ns = "1220feed"): ScenarioParties {
  const p = (hint: string) => `${hint}::${ns}`;
  return {
    registrar: p("CollaraRegistrar"),
    governance: p("CollaraGovernance"),
    seat1: p("GovSeat1"),
    seat2: p("GovSeat2"),
    seat3: p("GovSeat3"),
    owner: p("DemoManufacturer"),
    dealer: p("DemoCNCDealer"),
    verifier: p("DemoVerifier"),
    lenderA: p("DemoLenderA"),
    lenderB: p("DemoLenderB"),
    auditor: p("DemoAuditor"),
  };
}

/** A bootstrap state for importLocalnetState (party_bindings for the fake parties). */
export function scenarioBindingState(ns = "1220feed", participantId = "sandbox::1220fake"): LocalnetBindingSource {
  return {
    topology: "sandbox-1-participant",
    participants: { sandbox: { jsonApiUrl: "http://127.0.0.1:7575", participantId } },
    parties: Object.fromEntries(HINTS.map((h) => [h, { party: `${h}::${ns}`, participant: "sandbox", user: `${h.toLowerCase()}-svc` }])),
    users: [],
  };
}

const anchor = (version: number) => ({ packageRef: "PKG-001", manifestVersion: String(version), manifestHash: `hash-manifest-v${version}` });
const set = (...parties: string[]) => ({ map: parties.map((p) => [p, {}]) });
const iso = (base: Date, days: number) => new Date(base.getTime() + days * 86_400_000).toISOString();

export interface ScenarioResult {
  readonly ledger: FakeLedger;
  readonly parties: ScenarioParties;
}

/**
 * Where buildScenario stops: "main" after M18 (review SUBMITTED, no proposal, no lock); "eligible" after W4;
 * "proposal" after W5 (FP-001 v1 issued); "authorized" after W7 (accepted, activation authorized); "pledged"
 * after W8 (PL-001 active); "release-requested" with RR-001 open; "release-rejected" after RR-001 was rejected;
 * "full" runs the walkthrough through the release (RR-002) and both audit grants.
 */
export type ScenarioStage = "main" | "eligible" | "proposal" | "authorized" | "pledged" | "release-requested" | "release-rejected" | "full";

export function buildScenario(stage: ScenarioStage = "full", ledger = new FakeLedger(), parties = scenarioParties()): ScenarioResult {
  const P = parties;
  const ns = "collara-localnet";
  const asset = "ASSET-DEMO-001";
  const caseRef = "CL-001";
  const t0 = ledger.now();

  // B1 asset registry; B2 governance rules (Tier A).
  let registry = "";
  ledger.tx((tx) => {
    registry = tx.create(T.AssetRegistry, { registrar: P.registrar, namespace: ns, issuedAssetIds: set(), issuedIdentityCommitments: set(), version: "0" }, { signatories: [P.registrar] });
  });
  let rules = "";
  ledger.tx((tx) => {
    rules = tx.create(
      T.GovernanceRules,
      {
        governanceParty: P.governance,
        members: set(P.seat1, P.seat2, P.seat3),
        threshold: "2",
        actionConfirmationTimeout: { microseconds: "1800000000" },
        additionalProposers: null,
      },
      { signatories: [P.governance] },
    );
  });
  // B3–B6 bootstrap proposal, two confirmations, execution.
  let boot = "";
  ledger.tx((tx) => {
    boot = tx.create(
      T.BootstrapVerifierRegistryProposal,
      {
        governanceParty: P.governance,
        proposer: P.seat1,
        operator: P.registrar,
        registryId: ns,
        genesisVerifiers: [{ verifier: P.verifier, verifierRef: "VER-001", orgName: "Demo Verifier", scope: ["CNC_MACHINERY"], validUntil: iso(t0, 365) }],
        proposalDeadline: iso(t0, 1),
        reason: "Synthetic demo bootstrap",
      },
      { signatories: [P.seat1], observers: [P.governance] },
    );
  });
  const confirmations: string[] = [];
  for (const seat of [P.seat1, P.seat2]) {
    ledger.tx((tx) => {
      tx.exercise(rules, "GovernanceRules_ConfirmAction", { confirmer: seat, actionProposalCid: boot }, { actingParties: [seat], consuming: false });
      confirmations.push(
        tx.create(
          T.GovernanceConfirmation,
          { governanceParty: P.governance, confirmer: seat, actionProposalCid: boot, actionLabel: "CollaraBootstrapVerifierRegistry", expiresAt: iso(t0, 0.02) },
          { signatories: [seat, P.governance] },
        ),
      );
    });
  }
  let accreditation = "";
  ledger.tx((tx) => {
    tx.exercise(rules, "GovernanceRules_ExecuteConfirmedAction", { executor: P.seat2, actionProposalCid: boot, confirmations }, { actingParties: [P.seat2], consuming: false });
    for (const c of confirmations) tx.exercise(c, "GovernanceConfirmation_Consume", {}, { actingParties: [P.governance] });
    tx.exercise(boot, "GovernableAction_Execute", {}, { actingParties: [P.governance] });
    tx.create(T.VerifierRegistry, { governanceParty: P.governance, operator: P.registrar, registryId: ns, version: "0", activeVerifiers: set(P.verifier) }, { signatories: [P.governance], observers: [P.registrar] });
    accreditation = tx.create(
      T.VerifierAccreditation,
      {
        governanceParty: P.governance,
        operator: P.registrar,
        verifier: P.verifier,
        verifierRef: "VER-001",
        orgName: "Demo Verifier",
        scope: ["CNC_MACHINERY"],
        status: "ACTIVE",
        validUntil: iso(t0, 365),
        registryId: ns,
        registryVersion: "0",
        reason: "Synthetic demo bootstrap",
      },
      { signatories: [P.governance], observers: [P.registrar, P.verifier] },
    );
    tx.create(
      T.GovernanceExecutionResult,
      { governanceParty: P.governance, actionLabel: "CollaraBootstrapVerifierRegistry", description: "Bootstrap", executor: P.seat2, confirmers: [P.seat1, P.seat2], executedAt: iso(t0, 0) },
      { signatories: [P.governance] },
    );
  });
  // B7–B8 config and mirror.
  const directory = [P.verifier, P.lenderA, P.lenderB];
  let config = "";
  ledger.tx((tx) => {
    config = tx.create(
      T.CollaraConfig,
      { registrar: P.registrar, namespace: ns, governanceParty: P.governance, suspensionPolicy: "REQUIRE_ACTIVE_VERIFIER", configVersion: "1", directory },
      { signatories: [P.registrar], observers: directory },
    );
  });
  ledger.tx((tx) => {
    tx.exercise(config, "Config_PublishVerifierStatus", { accreditationCid: accreditation, sourceRef: "GP-000" }, { actingParties: [P.registrar], consuming: false });
    tx.create(
      T.VerifierStatusMirror,
      { registrar: P.registrar, namespace: ns, governanceParty: P.governance, verifier: P.verifier, verifierRef: "VER-001", status: "ACTIVE", registryVersion: "0", sourceRef: "GP-000", directory },
      { signatories: [P.registrar], observers: directory },
    );
  });

  // M1–M3 registration.
  const equipment = { manufacturer: "Demo Machine Works (synthetic)", model: "DEMO-CNC-500", serialNumber: "SYNTH-CNC-001" };
  const details = { yearOfManufacture: "2019", locationScope: "Demo Manufacturer facility · Ohio, US (declared)" };
  let request = "";
  ledger.tx((tx) => {
    request = tx.create(
      T.AssetRegistrationRequest,
      { owner: P.owner, registrar: P.registrar, namespace: ns, requestRef: "REG-001", equipmentClass: "CNC machining center", equipment, details, identityCommitment: "d0d834d9", ownerClaimRef: "CLAIM-001" },
      { signatories: [P.owner], observers: [P.registrar] },
    );
  });
  let ticket = "";
  ledger.tx((tx) => {
    tx.exercise(registry, "Registry_Reserve", { assetId: asset, owner: P.owner, requestRef: "REG-001", identityCommitment: "d0d834d9", actorRef: "svc:registrar" }, { actingParties: [P.registrar] });
    tx.create(T.AssetRegistry, { registrar: P.registrar, namespace: ns, issuedAssetIds: set(asset), issuedIdentityCommitments: set("d0d834d9"), version: "1" }, { signatories: [P.registrar] });
    ticket = tx.create(T.IssuanceTicket, { registrar: P.registrar, owner: P.owner, namespace: ns, assetId: asset, requestRef: "REG-001", identityCommitment: "d0d834d9" }, { signatories: [P.registrar], observers: [P.owner] });
  });
  let control = "";
  const controlPayload = (version: number, evidence: object | null, sharedLender: string | null) => ({
    registrar: P.registrar,
    owner: P.owner,
    namespace: ns,
    assetId: asset,
    controlVersion: String(version),
    evidence,
    sharedLender,
  });
  ledger.tx((tx) => {
    tx.exercise(request, "Request_Accept", { ticketCid: ticket, actorRef: "svc:registrar" }, { actingParties: [P.registrar] });
    tx.exercise(ticket, "Archive", {}, { actingParties: [P.registrar] });
    control = tx.create(T.AssetControl, controlPayload(1, null, null), { signatories: [P.registrar, P.owner] });
    tx.create(
      T.AssetPassport,
      { owner: P.owner, registrar: P.registrar, namespace: ns, assetId: asset, passportVersion: "1", equipmentClass: "CNC machining center", equipment, details, identityCommitment: "d0d834d9", documents: [], registeredAt: ledger.now().toISOString() },
      { signatories: [P.owner] },
    );
  });

  // M4–M6 contribution, manifest v1, anchor (control v2).
  ledger.tx((tx) => {
    tx.create(
      T.DealerContribution,
      { dealer: P.dealer, owner: P.owner, caseRef, docRef: "DOC-001", docType: "INVOICE", docVersion: "1", sha256: "sha-doc-001-v1", contributorRef: "mbr:dealer-contributor", verificationUseConsented: true },
      { signatories: [P.dealer], observers: [P.owner] },
    );
  });
  const entry = (docRef: string, docType: string, docVersion: number, source: string) => ({
    docRef,
    docType,
    docVersion: String(docVersion),
    sha256: `sha-${docRef.toLowerCase()}-v${docVersion}`,
    source,
    contributorRef: source === P.dealer ? "mbr:dealer-contributor" : "mbr:manufacturer-owner",
  });
  const entriesV1 = [entry("DOC-001", "INVOICE", 1, P.dealer), entry("DOC-002", "PHOTOS", 1, P.owner), entry("DOC-003", "INSPECTION", 1, P.owner), entry("DOC-004", "MAINTENANCE", 1, P.owner)];
  const entriesV2 = [entriesV1[0]!, entriesV1[1]!, entry("DOC-003", "INSPECTION", 2, P.owner), entriesV1[3]!];
  const manifest = (version: number, entries: object[]) => ({ owner: P.owner, registrar: P.registrar, namespace: ns, assetId: asset, packageRef: "PKG-001", version: String(version), manifestHash: `hash-manifest-v${version}`, entries });
  let manifest1 = "";
  ledger.tx((tx) => {
    manifest1 = tx.create(T.EvidenceManifest, manifest(1, entriesV1), { signatories: [P.owner] });
  });
  ledger.tx((tx) => {
    tx.exercise(manifest1, "Manifest_Anchor", { controlCid: control, actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner], consuming: false });
    tx.exercise(control, "Control_AnchorEvidence", { anchor: anchor(1), actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner] });
    control = tx.create(T.AssetControl, controlPayload(2, anchor(1), null), { signatories: [P.registrar, P.owner] });
  });

  // M7–M12 verification with a change request, manifest v2 (control v3), attestation.
  const vr = (version: number, status: string, evidenceVersion: number, changeNote = "") => ({
    owner: P.owner,
    verifier: P.verifier,
    registrar: P.registrar,
    namespace: ns,
    requestRef: "VR-001",
    assetId: asset,
    passportVersion: "1",
    caseRef,
    evidence: anchor(evidenceVersion),
    equipmentScope: "CNC_MACHINERY",
    checklist: ["Serial consistency", "Photos", "Inspected condition"],
    dueBy: iso(t0, 10),
    status,
    version: String(version),
    changeNote,
  });
  const vrParties = { signatories: [P.owner], observers: [P.verifier] };
  let request1 = "";
  ledger.tx((tx) => {
    tx.exercise(manifest1, "Manifest_RequestVerification", { verifier: P.verifier, requestRef: "VR-001", actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner], consuming: false });
    request1 = tx.create(T.VerificationRequest, vr(1, "REQUESTED", 1), vrParties);
  });
  let request2 = "";
  ledger.tx((tx) => {
    tx.exercise(request1, "VR_AcceptAssignment", { configCid: config, accreditationCid: accreditation, actorRef: "mbr:verifier-inspector" }, { actingParties: [P.verifier] });
    request2 = tx.create(T.VerificationRequest, vr(2, "IN_REVIEW", 1), vrParties);
  });
  const note = "Inspection report v1 does not cover the spindle; please upload the full scoped report.";
  let request3 = "";
  ledger.tx((tx) => {
    tx.exercise(request2, "VR_RequestChanges", { note, actorRef: "mbr:verifier-inspector" }, { actingParties: [P.verifier] });
    request3 = tx.create(T.VerificationRequest, vr(3, "CHANGES_REQUESTED", 1, note), vrParties);
  });
  let manifest2 = "";
  ledger.tx((tx) => {
    tx.exercise(manifest1, "Manifest_NewVersion", { newEntries: entriesV2, newManifestHash: "hash-manifest-v2", controlCid: control, actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner] });
    manifest2 = tx.create(T.EvidenceManifest, manifest(2, entriesV2), { signatories: [P.owner] });
    tx.exercise(control, "Control_AnchorEvidence", { anchor: anchor(2), actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner] });
    control = tx.create(T.AssetControl, controlPayload(3, anchor(2), null), { signatories: [P.registrar, P.owner] });
  });
  let request4 = "";
  ledger.tx((tx) => {
    tx.exercise(manifest2, "Manifest_SubmitToVerification", { requestCid: request3, actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner], consuming: false });
    tx.exercise(request3, "VR_SubmitNewEvidence", { newEvidence: anchor(2), actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner] });
    request4 = tx.create(T.VerificationRequest, vr(4, "IN_REVIEW", 2, note), vrParties);
  });
  const attestationPayload = {
    verifier: P.verifier,
    owner: P.owner,
    registrar: P.registrar,
    namespace: ns,
    governanceParty: P.governance,
    attestationRef: "ATT-001",
    requestRef: "VR-001",
    verifierRef: "VER-001",
    assetId: asset,
    passportVersion: "1",
    caseRef,
    evidence: anchor(2),
    equipmentScope: "CNC_MACHINERY",
    checks: [
      { item: "Serial consistency", finding: "SYNTH-CNC-001 matches dealer invoice", result: "CHECKED" },
      { item: "Maintenance evidence", finding: "Gap noted", result: "CHECKED_NOTED" },
    ],
    limitations: "No registry search was performed.",
    method: "On-site inspection + document review",
    inspectedAt: iso(t0, 0.5),
    validFrom: iso(t0, 0.5),
    validUntil: iso(t0, 180),
    supersedesRef: null,
    issuedAt: iso(t0, 0.5),
    issuedByRef: "mbr:verifier-inspector",
  };
  let attestation = "";
  ledger.tx((tx) => {
    tx.exercise(request4, "VR_IssueAttestation", { configCid: config, accreditationCid: accreditation, attestationRef: "ATT-001", actorRef: "mbr:verifier-inspector" }, { actingParties: [P.verifier], witnesses: [P.registrar, P.governance] });
    attestation = tx.create(T.VerificationAttestation, attestationPayload, { signatories: [P.verifier], observers: [P.owner] });
  });

  // M13–M17 sharing with Demo Lender A.
  const shareDocs = (entries: { docRef: string; docVersion: string; sha256: string; source: string }[]) =>
    entries.map((e) => ({ docRef: e.docRef, docVersion: e.docVersion, sha256: e.sha256, source: e.source }));
  const share = (shareRef: string, consenters: string[], docs: object[]) => ({
    owner: P.owner,
    consenters,
    recipient: P.lenderA,
    shareRef,
    purpose: "LENDER_REVIEW",
    caseRef,
    evidence: anchor(2),
    documents: docs,
    permission: "VIEW_DOWNLOAD",
    expiresAt: iso(t0, 30),
  });
  let shareProposal = "";
  ledger.tx((tx) => {
    const { consenters: _c, ...rest } = share("SHR-001", [], shareDocs([entriesV2[0]!]));
    shareProposal = tx.create(T.PackageShareProposal, { ...rest, dealer: P.dealer }, { signatories: [P.owner], observers: [P.dealer] });
  });
  ledger.tx((tx) => {
    tx.exercise(shareProposal, "Consent_Grant", { actorRef: "mbr:dealer-contributor" }, { actingParties: [P.dealer] });
    tx.create(T.PackageShare, share("SHR-001", [P.dealer], shareDocs([entriesV2[0]!])), { signatories: [P.owner, P.dealer], observers: [P.lenderA] });
  });
  ledger.tx((tx) => {
    tx.create(T.PackageShare, share("SHR-002", [], shareDocs(entriesV2.slice(1) as typeof entriesV1)), { signatories: [P.owner], observers: [P.lenderA] });
  });
  ledger.tx((tx) => {
    tx.exercise(control, "Control_ShareWithLender", { lender: P.lenderA, actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner] });
    control = tx.create(T.AssetControl, controlPayload(3, anchor(2), P.lenderA), { signatories: [P.registrar, P.owner], observers: [P.lenderA] });
  });
  let validity = "";
  ledger.tx((tx) => {
    tx.exercise(attestation, "Att_DiscloseTo", { recipient: P.lenderA, purpose: "LENDER_REVIEW", disclosureCaseRef: caseRef, actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner], consuming: false });
    // The disclosure's validity marker (collara-contracts 0.2.0; Control_Activate fetches it). Stored, not presented.
    validity = tx.create(
      T.DisclosureValidity,
      { owner: P.owner, verifier: P.verifier, recipient: P.lenderA, namespace: ns, assetId: asset, caseRef, attestationRef: "ATT-001", evidence: anchor(2), validUntil: attestationPayload.validUntil },
      { signatories: [P.owner], observers: [P.lenderA, P.verifier] },
    );
    tx.create(
      T.AttestationDisclosure,
      { verifier: P.verifier, owner: P.owner, recipient: P.lenderA, purpose: "LENDER_REVIEW", caseRef, attestationCid: attestation, attestation: attestationPayload, disclosedAt: ledger.now().toISOString(), validityCid: validity },
      { signatories: [P.verifier, P.owner], observers: [P.lenderA] },
    );
  });

  // M18 assessment SUBMITTED.
  const snapshot = { evidence: anchor(2), attestationRef: "ATT-001", attestationVerifier: P.verifier, attestationValidUntil: iso(t0, 180) };
  const assessment = (version: number, status: string, valuation: object | null, lastActorRef: string) => ({
    lender: P.lenderA,
    borrower: P.owner,
    assessmentRef: "CA-001",
    caseRef,
    namespace: ns,
    assetId: asset,
    snapshot,
    valuation,
    policyRef: "CP-2026-CNC-01",
    status,
    version: String(version),
    lastActorRef,
  });
  let ca = "";
  ledger.tx((tx) => {
    ca = tx.create(T.CollateralAssessment, assessment(1, "SUBMITTED", null, "svc:lender-a-intake"), { signatories: [P.lenderA] });
  });
  if (stage === "main") return { ledger, parties };

  // W1–W4 review to ELIGIBLE.
  const valuation = { value: { amount: "150000.00", currency: "USD" }, source: "Synthetic desktop valuation", valuationDate: iso(t0, 1).slice(0, 10), limitations: "Desktop valuation." };
  const step = (choice: string, version: number, status: string, val: object | null, actor: string, extra: object = {}) =>
    ledger.tx((tx) => {
      tx.exercise(ca, choice, { actorRef: actor, ...extra }, { actingParties: [P.lenderA] });
      ca = tx.create(T.CollateralAssessment, assessment(version, status, val, actor), { signatories: [P.lenderA] });
    });
  step("Assessment_StartReview", 2, "IN_REVIEW", null, "mbr:lender-a-analyst");
  step("Assessment_Save", 3, "IN_REVIEW", valuation, "mbr:lender-a-analyst", { newValuation: valuation, newPolicyRef: "CP-2026-CNC-01" });
  step("Assessment_SubmitForApproval", 4, "PENDING_APPROVAL", valuation, "mbr:lender-a-analyst");
  ledger.tx((tx) => {
    tx.exercise(ca, "Assessment_Approve", { noticeRef: "LDN-001", sharedFeedback: "Eligible for this lender and case.", actorRef: "mbr:lender-a-approver" }, { actingParties: [P.lenderA] });
    ca = tx.create(T.CollateralAssessment, assessment(5, "ELIGIBLE", valuation, "mbr:lender-a-approver"), { signatories: [P.lenderA] });
    tx.create(
      T.LenderDecisionNotice,
      { lender: P.lenderA, borrower: P.owner, noticeRef: "LDN-001", caseRef, assessmentRef: "CA-001", outcome: "ELIGIBLE", sharedFeedback: "Eligible for this lender and case.", decidedAt: ledger.now().toISOString() },
      { signatories: [P.lenderA], observers: [P.owner] },
    );
  });
  if (stage === "eligible") return { ledger, parties };

  // W5–W8 proposal, acceptance, authorization, activation (control v3 → lock v4).
  const terms = { principal: { amount: "100000.00", currency: "USD" }, termMetadata: "Synthetic 36-month terms", externalLegalRef: "LEGAL-DEMO-FP-001" };
  let proposal = "";
  ledger.tx((tx) => {
    tx.exercise(ca, "Assessment_IssueProposal", { proposalRef: "FP-001", ...terms, expiresAt: iso(t0, 14), actorRef: "mbr:lender-a-approver" }, { actingParties: [P.lenderA], consuming: false });
    proposal = tx.create(
      T.FinancingProposal,
      { lender: P.lenderA, borrower: P.owner, proposalRef: "FP-001", version: "1", caseRef, namespace: ns, assetId: asset, assessmentRef: "CA-001", snapshot, ...terms, expiresAt: iso(t0, 14), issuedAt: ledger.now().toISOString(), issuedByRef: "mbr:lender-a-approver" },
      { signatories: [P.lenderA], observers: [P.owner] },
    );
  });
  if (stage === "proposal") return { ledger, parties };
  let agreement = "";
  ledger.tx((tx) => {
    tx.exercise(proposal, "Proposal_Accept", { expectedProposalRef: "FP-001", expectedVersion: "1", actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner] });
    agreement = tx.create(
      T.FinancingAgreement,
      { lender: P.lenderA, borrower: P.owner, agreementRef: "FP-001", proposalVersion: "1", caseRef, namespace: ns, assetId: asset, assessmentRef: "CA-001", snapshot, ...terms, acceptedAt: ledger.now().toISOString(), acceptedByRef: "mbr:manufacturer-owner" },
      { signatories: [P.lenderA, P.owner] },
    );
  });
  let authorization = "";
  ledger.tx((tx) => {
    tx.exercise(agreement, "Agreement_AuthorizeActivation", { authorizationRef: "AUTH-001", expectedControlVersion: "3", expiresAt: iso(t0, 7), actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner], consuming: false });
    authorization = tx.create(
      T.PledgeActivationAuthorization,
      { lender: P.lenderA, borrower: P.owner, authorizationRef: "AUTH-001", caseRef, agreementRef: "FP-001", agreementVersion: "1", namespace: ns, assetId: asset, expectedControlVersion: "3", snapshot, expiresAt: iso(t0, 7), authorizedAt: ledger.now().toISOString(), authorizedByRef: "mbr:manufacturer-owner" },
      { signatories: [P.lenderA, P.owner] },
    );
  });
  if (stage === "authorized") return { ledger, parties };
  let lock = "";
  const lockPayload = { registrar: P.registrar, owner: P.owner, lender: P.lenderA, namespace: ns, assetId: asset, controlVersion: "4", evidence: anchor(2), lockRef: "PL-001", caseRef, authorizationRef: "AUTH-001", agreementRef: "FP-001", attestationRef: "ATT-001", activatedAt: "", activatedByRef: "mbr:lender-a-approver" };
  ledger.tx((tx) => {
    tx.exercise(control, "Control_Activate", { lender: P.lenderA, authorizationCid: authorization, validityCid: validity, configCid: config, lockRef: "PL-001", actorRef: "mbr:lender-a-approver" }, { actingParties: [P.lenderA] });
    tx.exercise(authorization, "Archive", {}, { actingParties: [P.lenderA, P.owner] });
    lock = tx.create(T.CollateralLock, { ...lockPayload, activatedAt: ledger.now().toISOString() }, { signatories: [P.registrar, P.owner, P.lenderA] });
  });
  if (stage === "pledged") return { ledger, parties };

  // W9–W12 release request rejected (lock stays), second request authorized (control v5).
  const rr = (ref: string) => ({
    requester: P.owner,
    owner: P.owner,
    lender: P.lenderA,
    lockCid: lock,
    lockRef: "PL-001",
    caseRef,
    namespace: ns,
    assetId: asset,
    releaseRequestRef: ref,
    reason: "EXTERNAL_LOAN_COMPLETION",
    noteRef: `NOTE-${ref}`,
    status: "REQUESTED",
    version: "1",
    requestedByRef: "mbr:manufacturer-owner",
  });
  const decision = (decisionRef: string, rrRef: string, outcome: string, sharedReason: string) => ({
    lender: P.lenderA,
    owner: P.owner,
    decisionRef,
    releaseRequestRef: rrRef,
    lockRef: "PL-001",
    caseRef,
    outcome,
    sharedReason,
    decidedAt: ledger.now().toISOString(),
    decidedByRef: "mbr:lender-a-approver",
  });
  let rr1 = "";
  ledger.tx((tx) => {
    rr1 = tx.create(T.ReleaseRequest, rr("RR-001"), { signatories: [P.owner], observers: [P.owner, P.lenderA] });
  });
  if (stage === "release-requested") return { ledger, parties };
  ledger.tx((tx) => {
    tx.exercise(rr1, "Release_Reject", { decisionRef: "RD-001", sharedReason: "Repayment confirmation has not been received.", actorRef: "mbr:lender-a-approver" }, { actingParties: [P.lenderA] });
    tx.create(T.ReleaseDecision, decision("RD-001", "RR-001", "REJECTED", "Repayment confirmation has not been received."), { signatories: [P.lenderA], observers: [P.owner] });
  });
  if (stage === "release-rejected") return { ledger, parties };
  let rr2 = "";
  ledger.tx((tx) => {
    rr2 = tx.create(T.ReleaseRequest, rr("RR-002"), { signatories: [P.owner], observers: [P.owner, P.lenderA] });
  });
  ledger.tx((tx) => {
    tx.exercise(rr2, "Release_Authorize", { decisionRef: "RD-002", actorRef: "mbr:lender-a-approver" }, { actingParties: [P.lenderA] });
    tx.exercise(lock, "Lock_Release", { releaseRequestRef: "RR-002", actorRef: "mbr:lender-a-approver" }, { actingParties: [P.lenderA] });
    control = tx.create(T.AssetControl, controlPayload(5, anchor(2), null), { signatories: [P.registrar, P.owner] });
    tx.create(
      T.CollateralLockReleased,
      { registrar: P.registrar, owner: P.owner, lender: P.lenderA, namespace: ns, assetId: asset, lockRef: "PL-001", caseRef, releaseRequestRef: "RR-002", lockControlVersion: "4", releasedControlVersion: "5", activatedAt: iso(t0, 1), releasedAt: ledger.now().toISOString(), releasedByRef: "mbr:lender-a-approver" },
      { signatories: [P.lenderA, P.owner], observers: [P.registrar] },
    );
    tx.create(T.ReleaseDecision, decision("RD-002", "RR-002", "AUTHORIZED", ""), { signatories: [P.lenderA], observers: [P.owner] });
  });

  // W13–W14 audit grants, one per record owner.
  const grant = (grantor: string, grantRef: string, scopes: string[]) => ({
    grantor,
    auditor: P.auditor,
    grantRef,
    caseRef,
    scopes,
    permission: "EXPORT",
    purpose: "Synthetic audit of case CL-001",
    expiresAt: iso(ledger.now(), 30),
  });
  ledger.tx((tx) => {
    tx.create(T.AuditGrant, grant(P.owner, "AG-001", ["EVIDENCE_MANIFEST", "ATTESTATION"]), { signatories: [P.owner], observers: [P.auditor] });
  });
  ledger.tx((tx) => {
    tx.create(T.AuditGrant, grant(P.lenderA, "AG-002", ["DECISION_OUTCOME", "PLEDGE_RELEASE_EVENTS"]), { signatories: [P.lenderA], observers: [P.auditor] });
  });
  return { ledger, parties };
}
