// Extra queue rows from the prototype (P-Dash §4.2), built as complete fact sets so every stage is
// produced by the same derivation as CL-001 (MP L171: CL-002 needs information, CL-003 pledge active,
// CL-004 awaiting approval, CL-005 released). Values not given by any source are INFERRED and kept
// consistent with CL-001 (same DEMO-CNC-500 model → same valuation/principal); CL-003's figures come
// from the prototype overview totals (P-Dash §3.1: 180,000 principal, 260,000 valuation).
import type { AssetFacts, CaseFacts, EvidenceDocumentFacts, EventFacts } from "../facts";
import { money, type Money } from "../money";
import { ASSET_NAMESPACE, CREDIT_POLICY_REF, formatRef } from "../refs";
import { DEMO_ORG_IDS as ORG, DEMO_PERSONAS, orgName, type OrgId } from "../roles";
import { syntheticSha256, stamp, type Clock, type EventLog } from "./support";

const DEALER = DEMO_PERSONAS["dealer-contributor"].userId;
const INSPECTOR = DEMO_PERSONAS["verifier-inspector"].userId;
const ANALYST = DEMO_PERSONAS["lender-a-analyst"].userId;
const APPROVER = DEMO_PERSONAS["lender-a-approver"].userId;

type Outcome = "NEEDS_INFORMATION" | "PENDING_APPROVAL" | "PLEDGE_ACTIVE" | "RELEASED";

interface ExtraSpec {
  readonly n: number;
  readonly borrowerOrgId: OrgId;
  /** Borrower user ids are synthetic for borrowers without a demo persona. */
  readonly borrowerUserId: string;
  readonly equipmentClass: string;
  readonly model: string;
  readonly outcome: Outcome;
  readonly principal: Money;
  readonly valuation: Money;
  /** Age of the last event, in hours (prototype "Last update"). */
  readonly lastUpdateHours: number;
}

const EXTRA_ROWS: readonly ExtraSpec[] = [
  {
    n: 4,
    borrowerOrgId: ORG.tooling,
    borrowerUserId: "user-demo-tooling",
    equipmentClass: "CNC machining center",
    model: "DEMO-CNC-500",
    outcome: "PENDING_APPROVAL",
    principal: money("100000.00", "USD"),
    valuation: money("150000.00", "USD"),
    lastUpdateHours: 5,
  },
  {
    n: 2,
    borrowerOrgId: ORG.machining,
    borrowerUserId: "user-demo-machining",
    equipmentClass: "CNC vertical mill",
    model: "DEMO-CNC-320",
    outcome: "NEEDS_INFORMATION",
    principal: money("100000.00", "USD"),
    valuation: money("150000.00", "USD"),
    lastUpdateHours: 24,
  },
  {
    n: 3,
    borrowerOrgId: ORG.fabrication,
    borrowerUserId: "user-demo-fabrication",
    equipmentClass: "CNC turning center",
    model: "DEMO-CNC-200",
    outcome: "PLEDGE_ACTIVE",
    principal: money("180000.00", "USD"),
    valuation: money("260000.00", "USD"),
    lastUpdateHours: 72,
  },
  {
    n: 5,
    borrowerOrgId: ORG.manufacturer,
    borrowerUserId: DEMO_PERSONAS["manufacturer-owner"].userId,
    equipmentClass: "CNC machining center",
    model: "DEMO-CNC-500",
    outcome: "RELEASED",
    principal: money("100000.00", "USD"),
    valuation: money("150000.00", "USD"),
    lastUpdateHours: 24 * 14,
  },
];

const DOC_TYPES = [
  { type: "DEALER_INVOICE", title: "Dealer invoice", media: "PDF · 1 page", source: "dealer" },
  { type: "EQUIPMENT_PHOTOS", title: "Equipment photos", media: "JPEG · 6 files", source: "owner" },
  { type: "INSPECTION_REPORT", title: "Inspection report", media: "PDF · 4 pages", source: "verifier" },
  { type: "MAINTENANCE_SUMMARY", title: "Maintenance summary", media: "PDF · 8 pages", source: "owner" },
] as const;

function buildExtra(spec: ExtraSpec, c: Clock, log: EventLog): CaseFacts {
  const id = (kind: Parameters<typeof formatRef>[0]) => formatRef(kind, spec.n);
  const assetRef = id("asset");
  const caseRef = id("case");
  // Timeline: registration 40 days before the last update; each later step moves closer to it.
  const end = Date.parse(c.hoursAgo(spec.lastUpdateHours));
  const day = 86_400_000;
  const t = (daysBeforeEnd: number) => new Date(end - daysBeforeEnd * day).toISOString();
  const attested = spec.outcome !== "NEEDS_INFORMATION";
  const owner = { orgId: spec.borrowerOrgId, role: "BORROWER" as const, userId: spec.borrowerUserId };
  const verifier = { orgId: ORG.verifier, role: "VERIFIER" as const, userId: INSPECTOR, actorLabel: "Demo Verifier" };

  const documents: EvidenceDocumentFacts[] = DOC_TYPES.map((d, i) => {
    const ref = formatRef("document", spec.n * 10 + i + 1);
    const by =
      d.source === "dealer"
        ? stamp(ORG.dealer, DEALER, "Sales desk · Demo CNC Dealer")
        : d.source === "verifier"
          ? stamp(ORG.verifier, INSPECTOR, "Inspector · Demo Verifier")
          : stamp(spec.borrowerOrgId, spec.borrowerUserId);
    return {
      ref,
      type: d.type,
      title: d.title,
      mediaSummary: d.media,
      sourceOrgId: by.orgId,
      reviewState: d.type === "MAINTENANCE_SUMMARY" && !attested ? "CORRECTION_REQUESTED" : attested && d.type === "INSPECTION_REPORT" ? "ATTESTED" : "REVIEWED",
      ledgerState: "COMMITTED",
      versions: [
        {
          version: 1,
          uploadedAt: t(38),
          uploadedBy: by,
          fileName: `${d.type.toLowerCase().replaceAll("_", "-")}.${d.type === "EQUIPMENT_PHOTOS" ? "jpg" : "pdf"}`,
          contentType: d.type === "EQUIPMENT_PHOTOS" ? "image/jpeg" : "application/pdf",
          sizeBytes: null,
          sha256: syntheticSha256(`${ref}:v1`),
          uploadState: "AVAILABLE",
          integrity: "VERIFIED",
        },
      ],
    };
  });
  const entries = documents.map((d) => ({ documentRef: d.ref, version: 1 }));
  const assetEvents: EventFacts[] = [
    log.event({ at: t(40), ref: assetRef, type: "PASSPORT_REGISTERED", ...owner, from: "DRAFT", to: "REGISTERED", version: "passport v1" }),
    log.event({ at: t(38), ref: entries.map((e) => e.documentRef).join(", "), type: "EVIDENCE_UPLOADED", ...owner, detail: `${documents.length} documents`, version: "v1", kind: "OPERATIONAL" }),
    log.event({ at: t(37), ref: id("verification"), type: "VERIFICATION_REQUESTED", ...owner, from: null, to: "REQUESTED", version: "scope v1" }),
    log.event({ at: t(36), ref: id("verification"), type: "ASSIGNMENT_ACCEPTED", ...verifier, from: "REQUESTED", to: "IN_REVIEW" }),
    attested
      ? log.event({ at: t(33), ref: id("attestation"), type: "ATTESTATION_ISSUED", ...verifier, from: "IN_REVIEW", to: "ATTESTED", version: "evidence v1" })
      : log.event({ at: t(2), ref: id("verification"), type: "CHANGES_REQUESTED", ...verifier, detail: "spindle photos", from: "IN_REVIEW", to: "CHANGES_REQUESTED" }),
  ];

  const asset: AssetFacts = {
    ref: assetRef,
    namespace: ASSET_NAMESPACE,
    equipmentClass: spec.equipmentClass,
    manufacturer: "Demo Machine Works (synthetic)",
    model: spec.model,
    serialNumber: `SYNTH-CNC-${String(spec.n).padStart(3, "0")}`,
    yearOfManufacture: null,
    ownerOrgId: spec.borrowerOrgId,
    ownerClaimSource: "Dealer invoice v1",
    locationScope: "Borrower facility (declared)",
    claimedAcquisitionValue: null,
    lifecycle: "REGISTERED",
    createdAt: t(41),
    registeredAt: t(40),
    updatedAt: attested ? t(33) : t(2),
    passportVersion: 1,
    documents,
    package: { ref: id("package"), version: 1, entries, history: [{ version: 1, committedAt: t(37) }] },
    verifications: [
      {
        ref: id("verification"),
        assetRef,
        caseRef: null,
        verifierOrgId: ORG.verifier,
        verifierRegistryRef: "VER-001",
        requestedByOrgId: spec.borrowerOrgId,
        scope: ["Serial consistency", "Photos", "Document consistency", "Inspected condition"],
        documentRefs: entries.map((e) => e.documentRef),
        packageVersion: 1,
        state: attested ? "ATTESTED" : "CHANGES_REQUESTED",
        requestedAt: t(37),
        updatedAt: attested ? t(33) : t(2),
        dueAt: null,
        attestationRef: attested ? id("attestation") : null,
        lastMessage: attested ? null : "Spindle photos",
      },
    ],
    attestations: attested
      ? [
          {
            ref: id("attestation"),
            verificationRef: id("verification"),
            assetRef,
            issuerOrgId: ORG.verifier,
            verifierRegistryRef: "VER-001",
            method: "On-site inspection + document review",
            inspectedAt: t(33.5),
            issuedAt: t(33),
            validFrom: t(33),
            validUntil: new Date(Date.parse(t(33)) + 181 * day).toISOString(),
            checks: [
              { item: "Serial consistency", finding: "Serial matches dealer invoice and nameplate photo", result: "CHECKED" },
              { item: "Photos", finding: "6 photos reviewed", result: "CHECKED" },
              { item: "Document consistency", finding: "Invoice and photos consistent", result: "CHECKED" },
              { item: "Inspected condition", finding: "Operational", result: "CHECKED" },
            ],
            limitations: "Ownership and lien status were reviewed from submitted documents only. No UCC, title, or registry search was performed.",
            packageRef: id("package"),
            packageVersion: 1,
            supportingVersions: entries,
            supersedes: null,
            supersededBy: null,
            revokedAt: null,
          },
        ]
      : [],
    control: { version: 1, state: "AVAILABLE", lockRef: null },
    events: assetEvents,
  };

  const lender = { orgId: ORG.lenderA, role: "LENDER_ANALYST" as const, userId: ANALYST };
  const approver = { orgId: ORG.lenderA, role: "LENDER_APPROVER" as const, userId: APPROVER };
  const caseEvents: EventFacts[] = [
    log.event({ at: t(30), ref: caseRef, type: "CASE_CREATED", ...owner, from: null, to: "DRAFT", version: "case v1", kind: "OPERATIONAL" }),
    log.event({ at: t(29), ref: id("package"), type: "PACKAGE_SHARED", ...owner, detail: `Demo Lender A · ${entries.length} documents`, from: "NOT_SUBMITTED", to: "SUBMITTED", version: "package v1" }),
    log.event({ at: t(28), ref: id("assessment"), type: "REVIEW_STARTED", ...lender, from: "SUBMITTED", to: "IN_REVIEW" }),
  ];

  const facts: CaseFacts = {
    ref: caseRef,
    title: "Used CNC financing",
    purpose: null,
    createdAt: t(30),
    createdByUserId: spec.borrowerUserId,
    borrowerOrgId: spec.borrowerOrgId,
    dealerOrgId: null,
    selectedLenderOrgId: ORG.lenderA,
    requestedPrincipal: spec.principal,
    policyRef: CREDIT_POLICY_REF,
    asset,
    shares: [
      {
        ref: formatRef("accessGrant", spec.n * 10),
        recipientOrgId: ORG.lenderA,
        purpose: "LENDER_REVIEW",
        packageRef: id("package"),
        packageVersion: 1,
        entries,
        permission: "VIEW_DOWNLOAD",
        state: "GRANTED",
        consentingOrgIds: [spec.borrowerOrgId],
        createdAt: t(29),
        expiresAt: null,
        revokedAt: null,
      },
    ],
    consents: [],
    review: {
      ref: id("assessment"),
      lenderOrgId: ORG.lenderA,
      state: "IN_REVIEW",
      analystUserId: ANALYST,
      approverUserId: APPROVER,
      startedAt: t(28),
      submittedForApprovalAt: null,
      evidenceSnapshot: entries,
      snapshotPackageVersion: 1,
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
    events: caseEvents,
    cancelledAt: null,
    closedAt: null,
  };

  const assessment = (at: string) => ({
    valuation: spec.valuation,
    valuationSource: "Verifier inspection report v1 · dealer invoice v1",
    valuationDate: at.slice(0, 10),
    limitations: "Desktop review of dealer invoice; no independent market comparables obtained.",
    outcome: "ELIGIBLE" as const,
    policyRef: CREDIT_POLICY_REF,
    version: 1,
    savedAt: at,
    savedByUserId: ANALYST,
    requiredExternalChecks: [
      { label: "UCC lien search", status: "Pending · external" },
      { label: "Title and ownership confirmation", status: "Outside Collara" },
    ],
  });

  if (spec.outcome === "NEEDS_INFORMATION") {
    facts.review.state = "NEEDS_INFORMATION";
    facts.review.informationRequest = "Maintenance log requested";
    caseEvents.push(
      log.event({ at: t(0), ref: id("assessment"), type: "INFORMATION_REQUESTED", ...lender, detail: "maintenance log", from: "IN_REVIEW", to: "NEEDS_INFORMATION" }),
    );
    return facts;
  }

  facts.review.assessment = assessment(t(27));
  facts.review.internalNotes = "Serial matches invoice and photos. Advance rate under policy CP-2026-CNC-01: within 70% of valuation.";
  caseEvents.push(log.event({ at: t(27), ref: id("assessment"), type: "ASSESSMENT_SAVED", ...lender, version: "draft", kind: "OPERATIONAL" }));

  if (spec.outcome === "PENDING_APPROVAL") {
    facts.review.state = "PENDING_APPROVAL";
    facts.review.submittedForApprovalAt = t(0);
    caseEvents.push(log.event({ at: t(0), ref: id("assessment"), type: "SUBMITTED_FOR_APPROVAL", ...lender, from: "IN_REVIEW", to: "PENDING_APPROVAL", version: "assessment v1" }));
    return facts;
  }

  // Eligible → proposal accepted → borrower authorization → activation (→ release for CL-005).
  facts.review.state = "ELIGIBLE";
  facts.review.decision = { outcome: "ELIGIBLE", decidedAt: t(26), decidedByUserId: APPROVER };
  facts.review.approverUserId = APPROVER;
  const proposalRef = id("proposal");
  facts.proposals = [
    {
      ref: proposalRef,
      version: 1,
      state: "ACCEPTED",
      lenderOrgId: ORG.lenderA,
      principal: spec.principal,
      termMetadata: "36 months · metadata only",
      financingRef: `LOAN-DEMO-${String(spec.n).padStart(3, "0")}`,
      externalLegalRef: "Executed financing documents held by Demo Lender A (external)",
      expiresAt: new Date(Date.parse(t(25)) + 14 * day).toISOString(),
      draftedAt: t(25.5),
      draftedByUserId: ANALYST,
      issuedAt: t(25),
      issuedByUserId: APPROVER,
      respondedAt: t(24),
      respondedByUserId: spec.borrowerUserId,
      withdrawnAt: null,
      note: null,
    },
  ];
  const lockRef = id("pledge");
  facts.activation = {
    state: "CONSUMED",
    proposalRef,
    proposalVersion: 1,
    attestationRef: id("attestation"),
    packageVersion: 1,
    controlVersion: 1,
    authorizedAt: t(23.5),
    authorizedByUserId: spec.borrowerUserId,
    expiresAt: new Date(Date.parse(t(23.5)) + 7 * day).toISOString(),
    consumedAt: t(23),
  };
  facts.lock = {
    ref: lockRef,
    state: "ACTIVE",
    lenderOrgId: ORG.lenderA,
    borrowerOrgId: spec.borrowerOrgId,
    activatedAt: t(23),
    activatedByUserId: APPROVER,
    proposalRef,
    proposalVersion: 1,
    attestationRef: id("attestation"),
    packageRef: id("package"),
    packageVersion: 1,
    controlVersionConsumed: 1,
    controlVersionLocked: 2,
    releasedAt: null,
    releasedByUserId: null,
    controlVersionAfterRelease: null,
  };
  asset.control = { version: 2, state: "LOCKED", lockRef };
  caseEvents.push(
    log.event({ at: t(26), ref: id("assessment"), type: "DECISION_RECORDED", ...approver, detail: "Eligible for this case", from: "IN_REVIEW", to: "ELIGIBLE", version: "assessment v1" }),
    log.event({ at: t(25), ref: proposalRef, type: "PROPOSAL_ISSUED", ...approver, from: "DRAFT", to: "ISSUED", version: "v1" }),
    log.event({ at: t(24), ref: proposalRef, type: "PROPOSAL_ACCEPTED", ...owner, from: "ISSUED", to: "ACCEPTED", version: "v1" }),
    log.event({ at: t(23.5), ref: proposalRef, type: "ACTIVATION_AUTHORIZED", ...owner, from: "NONE", to: "AUTHORIZED", version: "v1" }),
    log.event({
      at: t(23),
      ref: lockRef,
      type: "PLEDGE_ACTIVATED",
      ...approver,
      actorLabel: `${orgName(spec.borrowerOrgId)} + Demo Lender A`,
      from: "AVAILABLE",
      to: "ACTIVE",
      version: "control v1 → v2",
    }),
  );

  if (spec.outcome === "RELEASED") {
    const rrRef = id("releaseRequest");
    facts.releaseRequests = [
      {
        ref: rrRef,
        lockRef,
        state: "AUTHORIZED",
        reason: "EXTERNAL_LOAN_COMPLETION",
        note: null,
        servicingRef: `LOAN-DEMO-${String(spec.n).padStart(3, "0")} · external repayment confirmed (synthetic manual input)`,
        requestedByOrgId: spec.borrowerOrgId,
        requestedByUserId: spec.borrowerUserId,
        requestedAt: t(1),
        informationRequest: null,
        decidedAt: t(0),
        decidedByUserId: APPROVER,
        decisionReason: null,
      },
    ];
    facts.lock.state = "RELEASED";
    facts.lock.releasedAt = t(0);
    facts.lock.releasedByUserId = APPROVER;
    facts.lock.controlVersionAfterRelease = 3;
    asset.control = { version: 3, state: "AVAILABLE", lockRef: null };
    caseEvents.push(
      log.event({ at: t(1), ref: rrRef, type: "RELEASE_REQUESTED", ...owner, detail: "external loan completion", from: "ACTIVE", to: "RELEASE_REQUESTED" }),
      log.event({ at: t(0), ref: rrRef, type: "RELEASE_AUTHORIZED", ...approver, from: "RELEASE_REQUESTED", to: "RELEASED", version: "control v2 → v3" }),
    );
  }
  return facts;
}

/** CL-004, CL-002, CL-003, CL-005 in the prototype's queue order. */
export function buildExtraCases(c: Clock, log: EventLog): CaseFacts[] {
  return EXTRA_ROWS.map((spec) => buildExtra(spec, c, log));
}
