// Lenient decoders for projected Daml payloads (JSON Ledger API v2 encoding, packages/canton/README.md):
// Party/Text/ContractId → string, Int → string (numbers accepted), Numeric → decimal string, Time → ISO string,
// Optional → null | value, DA.Set → {"map": [[x, {}], …]}, enums → "CTOR", records → objects. A missing or
// malformed field decodes to a neutral default instead of throwing, so one odd contract never breaks a page.
// Field names follow daml/collara/**/*.daml (daml-model.md §4).
import { safeParseMoney, type Money } from "@collara/domain";

export type Json = Readonly<Record<string, unknown>>;

export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
export const optStr = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
export const int = (v: unknown, fallback = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  return fallback;
};
export const optInt = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = int(v, Number.NaN);
  return Number.isNaN(n) ? null : n;
};
export const bool = (v: unknown): boolean => v === true || v === "true";
export const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
export const strList = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string");
/** DA.Set.Set Party/Text: {"map": [[x, {}], …]} (a plain array is accepted too). */
export const set = (v: unknown): string[] => {
  if (Array.isArray(v)) return strList(v);
  return list(obj(v).map).flatMap((entry) => (Array.isArray(entry) && typeof entry[0] === "string" ? [entry[0]] : []));
};
/** Money {amount : Numeric 2, currency}; null when invalid (unavailable is never 0). */
export const money = (v: unknown): Money | null => {
  const m = obj(v);
  const amount = typeof m.amount === "number" ? m.amount.toFixed(2) : str(m.amount);
  return safeParseMoney({ amount: amount.replace(/^(\d+\.\d{2})0+$/, "$1"), currency: str(m.currency) });
};
/** RelTime {"microseconds": "1800000000"} → milliseconds. */
export const relTimeMs = (v: unknown): number | null => {
  const micros = int(obj(v).microseconds, Number.NaN);
  return Number.isFinite(micros) ? micros / 1000 : null;
};

// --- Shared value types (Collara.Types) -------------------------------------------------------------

export interface EvidenceAnchor {
  readonly packageRef: string;
  readonly manifestVersion: number;
  readonly manifestHash: string;
}
export const anchor = (v: unknown): EvidenceAnchor | null => {
  const a = obj(v);
  const packageRef = optStr(a.packageRef);
  return packageRef ? { packageRef, manifestVersion: int(a.manifestVersion), manifestHash: str(a.manifestHash) } : null;
};

export interface ReviewSnapshot {
  readonly evidence: EvidenceAnchor | null;
  readonly attestationRef: string;
  readonly attestationVerifier: string;
  readonly attestationValidUntil: string;
}
export const snapshot = (v: unknown): ReviewSnapshot => {
  const s = obj(v);
  return {
    evidence: anchor(s.evidence),
    attestationRef: str(s.attestationRef),
    attestationVerifier: str(s.attestationVerifier),
    attestationValidUntil: str(s.attestationValidUntil),
  };
};

// --- Templates ---------------------------------------------------------------------------------------

export const decode = {
  registrationRequest: (p: Json) => {
    const equipment = obj(p.equipment);
    const details = obj(p.details);
    return {
      owner: str(p.owner),
      registrar: str(p.registrar),
      namespace: str(p.namespace),
      requestRef: str(p.requestRef),
      equipmentClass: str(p.equipmentClass),
      manufacturer: str(equipment.manufacturer),
      model: str(equipment.model),
      serialNumber: str(equipment.serialNumber),
      yearOfManufacture: optInt(details.yearOfManufacture),
      locationScope: str(details.locationScope),
      ownerClaimRef: str(p.ownerClaimRef),
    };
  },
  issuanceTicket: (p: Json) => ({ owner: str(p.owner), assetId: str(p.assetId), requestRef: str(p.requestRef) }),
  passport: (p: Json) => {
    const equipment = obj(p.equipment);
    const details = obj(p.details);
    return {
      owner: str(p.owner),
      namespace: str(p.namespace),
      assetId: str(p.assetId),
      passportVersion: int(p.passportVersion, 1),
      equipmentClass: str(p.equipmentClass),
      manufacturer: str(equipment.manufacturer),
      model: str(equipment.model),
      serialNumber: str(equipment.serialNumber),
      yearOfManufacture: optInt(details.yearOfManufacture),
      locationScope: str(details.locationScope),
      documents: list(p.documents).map((d) => ({ docRef: str(obj(d).docRef), sha256: str(obj(d).sha256) })),
      registeredAt: optStr(p.registeredAt),
    };
  },
  control: (p: Json) => ({
    registrar: str(p.registrar),
    owner: str(p.owner),
    namespace: str(p.namespace),
    assetId: str(p.assetId),
    controlVersion: int(p.controlVersion, 1),
    evidence: anchor(p.evidence),
    sharedLender: optStr(p.sharedLender),
  }),
  retiredControl: (p: Json) => ({ assetId: str(p.assetId), finalControlVersion: int(p.finalControlVersion), retiredAt: optStr(p.retiredAt) }),
  lock: (p: Json) => ({
    owner: str(p.owner),
    lender: str(p.lender),
    namespace: str(p.namespace),
    assetId: str(p.assetId),
    controlVersion: int(p.controlVersion),
    evidence: anchor(p.evidence),
    lockRef: str(p.lockRef),
    caseRef: str(p.caseRef),
    authorizationRef: str(p.authorizationRef),
    agreementRef: str(p.agreementRef),
    attestationRef: str(p.attestationRef),
    activatedAt: str(p.activatedAt),
    activatedByRef: str(p.activatedByRef),
  }),
  lockReleased: (p: Json) => ({
    owner: str(p.owner),
    lender: str(p.lender),
    assetId: str(p.assetId),
    lockRef: str(p.lockRef),
    caseRef: str(p.caseRef),
    releaseRequestRef: str(p.releaseRequestRef),
    lockControlVersion: int(p.lockControlVersion),
    releasedControlVersion: int(p.releasedControlVersion),
    activatedAt: str(p.activatedAt),
    releasedAt: str(p.releasedAt),
    releasedByRef: str(p.releasedByRef),
  }),
  manifest: (p: Json) => ({
    owner: str(p.owner),
    namespace: str(p.namespace),
    assetId: str(p.assetId),
    packageRef: str(p.packageRef),
    version: int(p.version, 1),
    manifestHash: str(p.manifestHash),
    entries: list(p.entries).map((e) => {
      const x = obj(e);
      return {
        docRef: str(x.docRef),
        docType: str(x.docType),
        docVersion: int(x.docVersion, 1),
        sha256: str(x.sha256),
        source: str(x.source),
        contributorRef: str(x.contributorRef),
      };
    }),
  }),
  dealerContribution: (p: Json) => ({
    dealer: str(p.dealer),
    owner: str(p.owner),
    caseRef: str(p.caseRef),
    docRef: str(p.docRef),
    docType: str(p.docType),
    docVersion: int(p.docVersion, 1),
    sha256: str(p.sha256),
    contributorRef: str(p.contributorRef),
    verificationUseConsented: bool(p.verificationUseConsented),
  }),
  share: (p: Json) => ({
    owner: str(p.owner),
    dealer: optStr(p.dealer),
    consenters: strList(p.consenters),
    recipient: str(p.recipient),
    shareRef: str(p.shareRef),
    purpose: str(p.purpose),
    caseRef: str(p.caseRef),
    evidence: anchor(p.evidence),
    documents: list(p.documents).map((d) => {
      const x = obj(d);
      return { docRef: str(x.docRef), docVersion: int(x.docVersion, 1), sha256: str(x.sha256), source: str(x.source) };
    }),
    permission: str(p.permission) === "VIEW" ? ("VIEW" as const) : ("VIEW_DOWNLOAD" as const),
    expiresAt: optStr(p.expiresAt),
  }),
  verificationRequest: (p: Json) => ({
    owner: str(p.owner),
    verifier: str(p.verifier),
    namespace: str(p.namespace),
    requestRef: str(p.requestRef),
    assetId: str(p.assetId),
    passportVersion: int(p.passportVersion, 1),
    caseRef: optStr(p.caseRef),
    evidence: anchor(p.evidence),
    equipmentScope: str(p.equipmentScope),
    checklist: strList(p.checklist),
    dueBy: optStr(p.dueBy),
    status: str(p.status, "REQUESTED"),
    version: int(p.version, 1),
    changeNote: str(p.changeNote),
  }),
  attestation: (p: Json) => ({
    verifier: str(p.verifier),
    owner: str(p.owner),
    governanceParty: str(p.governanceParty),
    attestationRef: str(p.attestationRef),
    requestRef: str(p.requestRef),
    verifierRef: str(p.verifierRef),
    assetId: str(p.assetId),
    passportVersion: int(p.passportVersion, 1),
    caseRef: optStr(p.caseRef),
    evidence: anchor(p.evidence),
    equipmentScope: str(p.equipmentScope),
    checks: list(p.checks).map((c) => {
      const x = obj(c);
      return { item: str(x.item), finding: str(x.finding), result: str(x.result, "NOT_CHECKED") };
    }),
    limitations: str(p.limitations),
    method: str(p.method),
    inspectedAt: str(p.inspectedAt),
    validFrom: str(p.validFrom),
    validUntil: str(p.validUntil),
    supersedesRef: optStr(p.supersedesRef),
    issuedAt: str(p.issuedAt),
    issuedByRef: str(p.issuedByRef),
  }),
  disclosure: (p: Json) => ({
    verifier: str(p.verifier),
    owner: str(p.owner),
    recipient: str(p.recipient),
    purpose: str(p.purpose),
    caseRef: str(p.caseRef),
    attestationCid: str(p.attestationCid),
    attestation: obj(p.attestation),
    disclosedAt: str(p.disclosedAt),
  }),
  revokedAttestation: (p: Json) => ({ attestationRef: str(p.attestationRef), assetId: str(p.assetId), reason: str(p.reason), revokedAt: str(p.revokedAt) }),
  assessment: (p: Json) => {
    const valuation = p.valuation === null || p.valuation === undefined ? null : obj(p.valuation);
    return {
      lender: str(p.lender),
      borrower: str(p.borrower),
      assessmentRef: str(p.assessmentRef),
      caseRef: str(p.caseRef),
      assetId: str(p.assetId),
      snapshot: snapshot(p.snapshot),
      valuation: valuation
        ? {
            value: money(valuation.value),
            source: str(valuation.source),
            valuationDate: str(valuation.valuationDate),
            limitations: str(valuation.limitations),
          }
        : null,
      policyRef: str(p.policyRef),
      status: str(p.status, "SUBMITTED"),
      version: int(p.version, 1),
      lastActorRef: str(p.lastActorRef),
    };
  },
  notice: (p: Json) => ({
    lender: str(p.lender),
    borrower: str(p.borrower),
    noticeRef: str(p.noticeRef),
    caseRef: str(p.caseRef),
    assessmentRef: str(p.assessmentRef),
    outcome: str(p.outcome),
    sharedFeedback: str(p.sharedFeedback),
    decidedAt: str(p.decidedAt),
  }),
  proposal: (p: Json) => ({
    lender: str(p.lender),
    borrower: str(p.borrower),
    proposalRef: str(p.proposalRef),
    version: int(p.version, 1),
    caseRef: str(p.caseRef),
    assetId: str(p.assetId),
    assessmentRef: str(p.assessmentRef),
    snapshot: snapshot(p.snapshot),
    principal: money(p.principal),
    termMetadata: optStr(p.termMetadata),
    externalLegalRef: optStr(p.externalLegalRef),
    expiresAt: str(p.expiresAt),
    issuedAt: str(p.issuedAt),
    issuedByRef: str(p.issuedByRef),
  }),
  agreement: (p: Json) => ({
    lender: str(p.lender),
    borrower: str(p.borrower),
    agreementRef: str(p.agreementRef),
    proposalVersion: int(p.proposalVersion, 1),
    caseRef: str(p.caseRef),
    assetId: str(p.assetId),
    snapshot: snapshot(p.snapshot),
    principal: money(p.principal),
    acceptedAt: str(p.acceptedAt),
    acceptedByRef: str(p.acceptedByRef),
  }),
  authorization: (p: Json) => ({
    lender: str(p.lender),
    borrower: str(p.borrower),
    authorizationRef: str(p.authorizationRef),
    caseRef: str(p.caseRef),
    agreementRef: str(p.agreementRef),
    agreementVersion: int(p.agreementVersion, 1),
    assetId: str(p.assetId),
    expectedControlVersion: int(p.expectedControlVersion, 1),
    snapshot: snapshot(p.snapshot),
    expiresAt: str(p.expiresAt),
    authorizedAt: str(p.authorizedAt),
    authorizedByRef: str(p.authorizedByRef),
  }),
  releaseRequest: (p: Json) => ({
    requester: str(p.requester),
    owner: str(p.owner),
    lender: str(p.lender),
    lockRef: str(p.lockRef),
    caseRef: str(p.caseRef),
    assetId: str(p.assetId),
    releaseRequestRef: str(p.releaseRequestRef),
    reason: str(p.reason, "EXTERNAL_LOAN_COMPLETION"),
    noteRef: str(p.noteRef),
    status: str(p.status, "REQUESTED"),
    version: int(p.version, 1),
    requestedByRef: str(p.requestedByRef),
  }),
  releaseDecision: (p: Json) => ({
    lender: str(p.lender),
    owner: str(p.owner),
    decisionRef: str(p.decisionRef),
    releaseRequestRef: str(p.releaseRequestRef),
    lockRef: str(p.lockRef),
    caseRef: str(p.caseRef),
    outcome: str(p.outcome),
    sharedReason: str(p.sharedReason),
    decidedAt: str(p.decidedAt),
    decidedByRef: str(p.decidedByRef),
  }),
  auditGrant: (p: Json) => ({
    grantor: str(p.grantor),
    auditor: str(p.auditor),
    grantRef: str(p.grantRef),
    caseRef: str(p.caseRef),
    scopes: strList(p.scopes),
    permission: str(p.permission, "VIEW"),
    purpose: str(p.purpose),
    expiresAt: str(p.expiresAt),
  }),
  config: (p: Json) => ({
    registrar: str(p.registrar),
    namespace: str(p.namespace),
    governanceParty: str(p.governanceParty),
    suspensionPolicy: str(p.suspensionPolicy),
    configVersion: int(p.configVersion, 1),
    directory: strList(p.directory),
  }),
  mirror: (p: Json) => ({
    registrar: str(p.registrar),
    namespace: str(p.namespace),
    governanceParty: str(p.governanceParty),
    verifier: str(p.verifier),
    verifierRef: str(p.verifierRef),
    status: str(p.status, "ACTIVE"),
    registryVersion: int(p.registryVersion),
    sourceRef: str(p.sourceRef),
  }),
  registry: (p: Json) => ({
    governanceParty: str(p.governanceParty),
    operator: str(p.operator),
    registryId: str(p.registryId),
    version: int(p.version),
    activeVerifiers: set(p.activeVerifiers),
  }),
  accreditation: (p: Json) => ({
    governanceParty: str(p.governanceParty),
    operator: str(p.operator),
    verifier: str(p.verifier),
    verifierRef: str(p.verifierRef),
    orgName: str(p.orgName),
    scope: strList(p.scope),
    status: str(p.status, "ACTIVE"),
    validUntil: optStr(p.validUntil),
    registryId: str(p.registryId),
    registryVersion: int(p.registryVersion),
    reason: str(p.reason),
  }),
  governanceProposal: (p: Json) => ({
    governanceParty: str(p.governanceParty),
    proposer: str(p.proposer),
    registryCid: optStr(p.registryCid),
    expectedVersion: int(p.expectedVersion),
    accreditationCid: optStr(p.accreditationCid),
    verifier: optStr(p.verifier),
    verifierRef: optStr(p.verifierRef),
    orgName: optStr(p.orgName),
    scope: strList(p.scope),
    proposalDeadline: str(p.proposalDeadline),
    reason: str(p.reason),
    genesisVerifiers: list(p.genesisVerifiers).map((g) => ({ verifierRef: str(obj(g).verifierRef), orgName: str(obj(g).orgName) })),
  }),
  rules: (p: Json) => ({
    governanceParty: str(p.governanceParty),
    members: set(p.members),
    threshold: int(p.threshold, 2),
    timeoutMs: relTimeMs(p.actionConfirmationTimeout),
  }),
  confirmation: (p: Json) => ({
    governanceParty: str(p.governanceParty),
    confirmer: str(p.confirmer),
    actionProposalCid: str(p.actionProposalCid),
    actionLabel: str(p.actionLabel),
    expiresAt: str(p.expiresAt),
  }),
  executionResult: (p: Json) => ({
    actionLabel: str(p.actionLabel),
    description: str(p.description),
    executor: str(p.executor),
    confirmers: strList(p.confirmers),
    executedAt: str(p.executedAt),
  }),
};
