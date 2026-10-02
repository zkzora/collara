// Main seed (synthesis §1.6, MP L167): CL-001 registered, attested (ATT-001), PKG-001 v2 shared with
// Demo Lender A, lender review SUBMITTED ("Awaiting lender review"), no proposal, no lock.
// Verbatim prototype fixture data (P-Dash §4.3–§4.6) with the CR-12 principal and CR-47 fixes.
import type { AssetFacts, CaseFacts, EvidenceDocumentFacts } from "../facts";
import type { GovernanceFacts } from "../governance";
import { money } from "../money";
import { ASSET_NAMESPACE, CREDIT_POLICY_REF } from "../refs";
import { DEMO_ORG_IDS as ORG, DEMO_PERSONAS } from "../roles";
import { clock, syntheticSha256, stamp, type Clock, type EventLog } from "./support";

const OWNER = DEMO_PERSONAS["manufacturer-owner"].userId;
const DEALER = DEMO_PERSONAS["dealer-contributor"].userId;
const INSPECTOR = DEMO_PERSONAS["verifier-inspector"].userId;
const ANALYST = DEMO_PERSONAS["lender-a-analyst"].userId;
const APPROVER = DEMO_PERSONAS["lender-a-approver"].userId;

/** Labels for uploaders (CR-47: "Verifier seat 1" renamed to avoid governance-seat confusion). */
const BY = {
  plant: stamp(ORG.manufacturer, OWNER, "Plant manager · Demo Manufacturer"),
  finance: stamp(ORG.manufacturer, OWNER, "Finance · Demo Manufacturer"),
  dealer: stamp(ORG.dealer, DEALER, "Sales desk · Demo CNC Dealer"),
  inspector: stamp(ORG.verifier, INSPECTOR, "Inspector · Demo Verifier"),
};

function doc(
  ref: string,
  partial: Omit<EvidenceDocumentFacts, "ref" | "versions" | "ledgerState"> & {
    versions: { version: number; uploadedAt: string; by: EvidenceDocumentFacts["versions"][number]["uploadedBy"]; fileName: string; contentType: "application/pdf" | "image/jpeg" }[];
  },
): EvidenceDocumentFacts {
  return {
    ref,
    type: partial.type,
    title: partial.title,
    mediaSummary: partial.mediaSummary,
    sourceOrgId: partial.sourceOrgId,
    reviewState: partial.reviewState,
    ledgerState: "COMMITTED",
    versions: partial.versions.map((v) => ({
      version: v.version,
      uploadedAt: v.uploadedAt,
      uploadedBy: v.by,
      fileName: v.fileName,
      contentType: v.contentType,
      sizeBytes: null,
      sha256: syntheticSha256(`${ref}:v${v.version}`),
      uploadState: "AVAILABLE",
      integrity: "VERIFIED",
    })),
  };
}

export const CL001_CHECKS = [
  { item: "Serial consistency", finding: "SYNTH-CNC-001 matches dealer invoice and nameplate photo", result: "CHECKED" },
  { item: "Photos", finding: "6 photos reviewed · nameplate, spindle, control panel, table, enclosure, site", result: "CHECKED" },
  { item: "Document consistency", finding: "Invoice, purchase agreement and photos consistent", result: "CHECKED" },
  { item: "Inspected condition", finding: "Operational · minor wear on spindle housing · 4,120 h", result: "CHECKED" },
  { item: "Location evidence", finding: "Site visit · Demo Manufacturer facility, Ohio", result: "CHECKED" },
  { item: "Maintenance evidence", finding: "Log reviewed · gap Q2 2025 · borrower explanation attached", result: "CHECKED_NOTED" },
  { item: "Ownership / lien", finding: "Purchase agreement and invoice reviewed · no registry search", result: "REVIEWED_DOCUMENTS" },
] as const;

export function buildCl001Asset(c: Clock, log: EventLog): AssetFacts {
  const documents: EvidenceDocumentFacts[] = [
    doc("DOC-001", {
      type: "EQUIPMENT_PHOTOS",
      title: "Equipment photos",
      mediaSummary: "JPEG · 6 files",
      sourceOrgId: ORG.manufacturer,
      reviewState: "REVIEWED",
      versions: [{ version: 1, uploadedAt: c.at("2026-09-01T09:05:00Z"), by: BY.plant, fileName: "equipment-photos.jpg", contentType: "image/jpeg" }],
    }),
    doc("DOC-002", {
      type: "PURCHASE_AGREEMENT",
      title: "Purchase agreement",
      mediaSummary: "PDF · 6 pages",
      sourceOrgId: ORG.manufacturer,
      reviewState: "REVIEWED",
      versions: [{ version: 1, uploadedAt: c.at("2026-09-01T09:05:00Z"), by: BY.finance, fileName: "purchase-agreement.pdf", contentType: "application/pdf" }],
    }),
    doc("DOC-003", {
      type: "DEALER_INVOICE",
      title: "Dealer invoice",
      mediaSummary: "PDF · 1 page",
      sourceOrgId: ORG.dealer,
      reviewState: "REVIEWED",
      versions: [{ version: 1, uploadedAt: c.at("2026-09-02T11:20:00Z"), by: BY.dealer, fileName: "dealer-invoice.pdf", contentType: "application/pdf" }],
    }),
    doc("DOC-004", {
      type: "INSPECTION_REPORT",
      title: "Inspection report",
      mediaSummary: "PDF · 4 pages",
      sourceOrgId: ORG.verifier,
      reviewState: "ATTESTED",
      versions: [
        { version: 1, uploadedAt: c.at("2026-09-05T10:00:00Z"), by: BY.inspector, fileName: "inspection-report-v1.pdf", contentType: "application/pdf" },
        { version: 2, uploadedAt: c.at("2026-09-08T09:48:00Z"), by: BY.inspector, fileName: "inspection-report-v2.pdf", contentType: "application/pdf" },
      ],
    }),
    doc("DOC-005", {
      type: "MAINTENANCE_SUMMARY",
      title: "Maintenance summary",
      mediaSummary: "PDF · 12 pages",
      sourceOrgId: ORG.manufacturer,
      reviewState: "REVIEWED_GAP_NOTED",
      versions: [{ version: 1, uploadedAt: c.at("2026-09-03T09:30:00Z"), by: BY.plant, fileName: "maintenance-summary.pdf", contentType: "application/pdf" }],
    }),
  ];
  const manifestV2 = [
    { documentRef: "DOC-001", version: 1 },
    { documentRef: "DOC-002", version: 1 },
    { documentRef: "DOC-003", version: 1 },
    { documentRef: "DOC-004", version: 2 },
    { documentRef: "DOC-005", version: 1 },
  ];
  const ev = (input: Parameters<EventLog["event"]>[0]) => log.event(input);
  const owner = { orgId: ORG.manufacturer, role: "BORROWER" as const, userId: OWNER, actorLabel: "Demo Manufacturer · Owner" };
  const verifier = { orgId: ORG.verifier, role: "VERIFIER" as const, userId: INSPECTOR, actorLabel: "Demo Verifier" };
  return {
    ref: "ASSET-DEMO-001",
    namespace: ASSET_NAMESPACE,
    equipmentClass: "CNC machining center",
    manufacturer: "Demo Machine Works (synthetic)",
    model: "DEMO-CNC-500",
    serialNumber: "SYNTH-CNC-001",
    yearOfManufacture: 2019,
    ownerOrgId: ORG.manufacturer,
    ownerClaimSource: "Purchase agreement v1, dealer invoice v1",
    locationScope: "Demo Manufacturer facility · Ohio, US (declared)",
    claimedAcquisitionValue: null,
    lifecycle: "REGISTERED",
    createdAt: c.at("2026-09-01T08:30:00Z"),
    registeredAt: c.at("2026-09-01T08:40:00Z"),
    updatedAt: c.at("2026-09-10T17:02:00Z"),
    passportVersion: 1,
    documents,
    package: {
      ref: "PKG-001",
      version: 2,
      entries: manifestV2,
      history: [
        { version: 1, committedAt: c.at("2026-09-03T10:00:00Z") },
        { version: 2, committedAt: c.at("2026-09-08T10:15:00Z") },
      ],
    },
    verifications: [
      {
        ref: "VR-001",
        assetRef: "ASSET-DEMO-001",
        caseRef: null,
        verifierOrgId: ORG.verifier,
        verifierRegistryRef: "VER-001",
        requestedByOrgId: ORG.manufacturer,
        scope: CL001_CHECKS.map((check) => check.item),
        // CR-47: the purchase agreement is shared with the verifier because a check cites it.
        documentRefs: ["DOC-001", "DOC-002", "DOC-003", "DOC-004", "DOC-005"],
        packageVersion: 2,
        state: "ATTESTED",
        requestedAt: c.at("2026-09-03T10:00:00Z"),
        updatedAt: c.at("2026-09-10T17:02:00Z"),
        dueAt: null,
        attestationRef: "ATT-001",
        lastMessage: "Spindle photos and maintenance log",
      },
    ],
    attestations: [
      {
        ref: "ATT-001",
        verificationRef: "VR-001",
        assetRef: "ASSET-DEMO-001",
        issuerOrgId: ORG.verifier,
        verifierRegistryRef: "VER-001",
        method: "On-site inspection + document review",
        inspectedAt: c.at("2026-09-10T09:00:00Z"),
        issuedAt: c.at("2026-09-10T17:02:00Z"),
        validFrom: c.at("2026-09-10T17:02:00Z"),
        validUntil: c.at("2027-03-10T23:59:59Z"),
        checks: CL001_CHECKS.map((check) => ({ ...check })),
        limitations:
          "Ownership and lien status were reviewed from submitted documents only. No UCC, title, or registry search was performed. Maintenance history verified for Q3 2025 onward.",
        packageRef: "PKG-001",
        packageVersion: 2,
        supportingVersions: manifestV2,
        supersedes: null,
        supersededBy: null,
        revokedAt: null,
      },
    ],
    control: { version: 3, state: "AVAILABLE", lockRef: null },
    events: [
      ev({ at: c.at("2026-09-01T08:40:00Z"), ref: "ASSET-DEMO-001", type: "PASSPORT_REGISTERED", ...owner, from: "DRAFT", to: "REGISTERED", version: "passport v1" }),
      ev({ at: c.at("2026-09-01T09:05:00Z"), ref: "DOC-001, DOC-002", type: "EVIDENCE_UPLOADED", ...owner, detail: "Equipment photos, Purchase agreement", version: "v1", kind: "OPERATIONAL" }),
      ev({ at: c.at("2026-09-02T11:20:00Z"), ref: "DOC-003", type: "EVIDENCE_UPLOADED", orgId: ORG.dealer, role: "DEALER", userId: DEALER, detail: "Dealer invoice", version: "v1", kind: "OPERATIONAL" }),
      ev({ at: c.at("2026-09-03T09:30:00Z"), ref: "DOC-005", type: "EVIDENCE_UPLOADED", ...owner, detail: "Maintenance summary", version: "v1", kind: "OPERATIONAL" }),
      ev({ at: c.at("2026-09-03T10:00:00Z"), ref: "VR-001", type: "VERIFICATION_REQUESTED", ...owner, from: null, to: "REQUESTED", version: "scope v1" }),
      ev({ at: c.at("2026-09-04T08:15:00Z"), ref: "VR-001", type: "ASSIGNMENT_ACCEPTED", ...verifier, from: "REQUESTED", to: "IN_REVIEW" }),
      ev({ at: c.at("2026-09-05T10:00:00Z"), ref: "DOC-004", type: "EVIDENCE_UPLOADED", ...verifier, detail: "Inspection report", version: "v1", kind: "OPERATIONAL" }),
      ev({ at: c.at("2026-09-06T16:30:00Z"), ref: "VR-001", type: "CHANGES_REQUESTED", ...verifier, detail: "spindle photos and maintenance log", from: "IN_REVIEW", to: "CHANGES_REQUESTED" }),
      ev({ at: c.at("2026-09-08T09:48:00Z"), ref: "DOC-004", type: "EVIDENCE_VERSION_ADDED", ...verifier, detail: "Inspection report v2", version: "v1 → v2", kind: "OPERATIONAL" }),
      ev({ at: c.at("2026-09-08T10:15:00Z"), ref: "VR-001", type: "EVIDENCE_RESUBMITTED", ...owner, from: "CHANGES_REQUESTED", to: "IN_REVIEW", version: "package v2" }),
      ev({ at: c.at("2026-09-10T17:02:00Z"), ref: "ATT-001", type: "ATTESTATION_ISSUED", ...verifier, from: "IN_REVIEW", to: "ATTESTED", version: "evidence v2" }),
    ],
  };
}

export function buildCl001Case(c: Clock, log: EventLog, asset: AssetFacts): CaseFacts {
  return {
    ref: "CL-001",
    title: "Used CNC financing",
    purpose: null,
    createdAt: c.at("2026-09-12T10:10:00Z"),
    createdByUserId: OWNER,
    borrowerOrgId: ORG.manufacturer,
    dealerOrgId: ORG.dealer,
    selectedLenderOrgId: ORG.lenderA,
    requestedPrincipal: money("100000.00", "USD"),
    policyRef: CREDIT_POLICY_REF,
    asset,
    shares: [
      {
        ref: "AG-001",
        recipientOrgId: ORG.lenderA,
        purpose: "LENDER_REVIEW",
        packageRef: "PKG-001",
        packageVersion: 2,
        entries: asset.package.entries.map((e) => ({ ...e })),
        permission: "VIEW_DOWNLOAD",
        state: "GRANTED",
        consentingOrgIds: [ORG.manufacturer, ORG.dealer],
        createdAt: c.at("2026-09-12T10:35:00Z"),
        expiresAt: c.at("2026-12-31T23:59:59Z"),
        revokedAt: null,
      },
    ],
    review: {
      ref: "CA-001",
      lenderOrgId: ORG.lenderA,
      state: "SUBMITTED",
      analystUserId: ANALYST,
      approverUserId: APPROVER,
      startedAt: null,
      submittedForApprovalAt: null,
      evidenceSnapshot: asset.package.entries.map((e) => ({ ...e })),
      snapshotPackageVersion: 2,
      assessment: null,
      internalNotes: null,
      sharedFeedback: null,
      informationRequest: null,
      decision: null,
    },
    proposals: [],
    activation: null,
    lock: null,
    releaseRequests: [],
    auditGrants: [],
    exports: [],
    events: [
      // Case creation is an application record (off-ledger, synthesis §5.3), so it is operational.
      log.event({ at: c.at("2026-09-12T10:10:00Z"), ref: "CL-001", type: "CASE_CREATED", orgId: ORG.manufacturer, role: "BORROWER", userId: OWNER, from: null, to: "DRAFT", version: "case v1", kind: "OPERATIONAL" }),
      log.event({
        at: c.at("2026-09-12T10:35:00Z"),
        ref: "PKG-001",
        type: "PACKAGE_SHARED",
        orgId: ORG.manufacturer,
        role: "BORROWER",
        userId: OWNER,
        actorLabel: "Demo Manufacturer + Demo CNC Dealer (consent)",
        detail: "Demo Lender A · 5 documents",
        from: "NOT_SUBMITTED",
        to: "SUBMITTED",
        version: "package v2",
      }),
    ],
    cancelledAt: null,
    closedAt: null,
  };
}

/** Governance set and verifier registry (P-Dash §4.8), recast to DM semantics (CR-28). */
export function buildGovernance(now: Date, integration: GovernanceFacts["integration"] = "SIMULATED"): GovernanceFacts {
  const c = clock(now);
  const deadline = (iso: string) => new Date(Date.parse(c.at(iso)) + 14 * 86_400_000).toISOString();
  return {
    integration,
    threshold: 2,
    registryVersion: 2,
    proposalDeadlineDays: 14,
    // DM tests use 30 minutes; the demo needs confirmations to outlive a session (CR-28).
    confirmationTimeoutHours: 168,
    seats: [
      { seat: 1, orgId: ORG.lenderA, memberRef: "gov-seat-1", mandateLabel: "Approver mandate", since: c.at("2026-08-01T00:00:00Z") },
      { seat: 2, orgId: ORG.lenderB, memberRef: "gov-seat-2", mandateLabel: "Approver mandate", since: c.at("2026-08-01T00:00:00Z") },
      { seat: 3, orgId: ORG.auditor, memberRef: "gov-seat-3", mandateLabel: "Audit lead mandate", since: c.at("2026-08-01T00:00:00Z") },
    ],
    verifiers: [
      { ref: "VER-001", orgName: "Demo Verifier", orgId: ORG.verifier, scope: "Industrial equipment inspection", status: "ACTIVE", since: c.at("2026-08-01T00:00:00Z"), via: "genesis" },
      { ref: "VER-002", orgName: "Demo Inspection Partners", orgId: null, scope: "Industrial equipment inspection", status: "ACTIVE", since: c.at("2026-08-21T10:06:00Z"), via: "GP-001" },
      { ref: "VER-003", orgName: "Demo Field Audit Co", orgId: null, scope: "Site audit · asset location", status: "SUSPENDED", since: c.at("2026-09-15T11:21:00Z"), via: "GP-002" },
    ],
    proposals: [
      {
        ref: "GP-001",
        type: "ADD_VERIFIER",
        target: { verifierRef: "VER-002", orgName: "Demo Inspection Partners", scope: "Industrial equipment inspection" },
        proposerSeat: 1,
        rationale: "First registry expansion after LocalNet genesis. Onboarding checklist and sample inspection reviewed.",
        effect: "VER-002 added as ACTIVE.",
        openedAt: c.at("2026-08-20T09:00:00Z"),
        deadlineAt: deadline("2026-08-20T09:00:00Z"),
        expectedRegistryVersion: 0,
        confirmations: [
          { seat: 1, confirmedAt: c.at("2026-08-20T09:00:00Z") },
          { seat: 3, confirmedAt: c.at("2026-08-21T10:05:00Z") },
        ],
        executedAt: c.at("2026-08-21T10:06:00Z"),
        executedBySeat: 1,
        cancelledAt: null,
      },
      {
        ref: "GP-002",
        type: "SUSPEND_VERIFIER",
        target: { verifierRef: "VER-003", orgName: "Demo Field Audit Co", scope: "Site audit · asset location" },
        proposerSeat: 1,
        // The prototype text named an absolute lapse date; dropped so the fixture stays date-relative.
        rationale: "Inspector accreditation lapsed. Suspension until renewed accreditation is filed.",
        effect: "VER-003 set to SUSPENDED. Existing attestations remain valid; no new assignments can be accepted.",
        openedAt: c.at("2026-09-12T14:00:00Z"),
        deadlineAt: deadline("2026-09-12T14:00:00Z"),
        expectedRegistryVersion: 1,
        confirmations: [
          { seat: 1, confirmedAt: c.at("2026-09-12T14:00:00Z") },
          { seat: 2, confirmedAt: c.at("2026-09-15T11:20:00Z") },
        ],
        executedAt: c.at("2026-09-15T11:21:00Z"),
        executedBySeat: 2,
        cancelledAt: null,
      },
      {
        ref: "GP-003",
        type: "SUSPEND_VERIFIER",
        target: { verifierRef: "VER-002", orgName: "Demo Inspection Partners", scope: "Industrial equipment inspection" },
        proposerSeat: 3,
        // DM has no reject vote: the prototype's "rejected" proposal becomes a proposer withdrawal.
        rationale: "Late response on a sample re-inspection request.",
        effect: "None. VER-002 remains ACTIVE.",
        openedAt: c.at("2026-09-20T09:30:00Z"),
        deadlineAt: deadline("2026-09-20T09:30:00Z"),
        expectedRegistryVersion: 2,
        confirmations: [{ seat: 3, confirmedAt: c.at("2026-09-20T09:30:00Z") }],
        executedAt: null,
        executedBySeat: null,
        cancelledAt: c.at("2026-09-22T08:45:00Z"),
      },
      {
        ref: "GP-004",
        type: "ADD_VERIFIER",
        target: { verifierRef: "VER-004", orgName: "Demo Calibration Lab", scope: "Industrial equipment inspection · calibration" },
        proposerSeat: 2,
        rationale:
          "Second inspection capacity for CNC equipment in the Midwest region. Onboarding checklist complete; sample inspection reviewed by Demo Lender B.",
        effect: "Demo Calibration Lab is added to the registry as ACTIVE and becomes assignable to verification requests.",
        openedAt: c.at("2026-09-28T10:14:00Z"),
        deadlineAt: deadline("2026-09-28T10:14:00Z"),
        expectedRegistryVersion: 2,
        confirmations: [{ seat: 2, confirmedAt: c.at("2026-09-28T10:14:00Z") }],
        executedAt: null,
        executedBySeat: null,
        cancelledAt: null,
      },
    ],
  };
}
