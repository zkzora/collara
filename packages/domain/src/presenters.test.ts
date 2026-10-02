import { describe, expect, it } from "vitest";
import {
  AccessGrantSchema,
  AssetDetailSchema,
  AttestationSchema,
  AuditEventSchema,
  CaseDetailSchema,
  CaseSummarySchema,
  EvidenceDocumentSchema,
  GovernanceProposalSchema,
  GovernanceStateSchema,
  MeSchema,
  PledgeSchema,
  ProposalSchema,
  ReviewSchema,
  VerificationRequestSchema,
  VerifierEntrySchema,
} from "./dto";
import type { CaseFacts } from "./facts";
import { buildScenario, type DemoWorld } from "./fixtures";
import { money } from "./money";
import {
  presentAccessGrants,
  presentAssetDetail,
  presentCaseActivity,
  presentCaseAttestation,
  presentCaseDetail,
  presentCaseEvidence,
  presentCaseList,
  presentCaseSummary,
  equipmentSummary,
  presentGovernanceProposal,
  presentGovernanceState,
  presentMe,
  presentPledge,
  presentProposal,
  presentReview,
  presentVerification,
  presentVerifierEntries,
  type PresentContext,
} from "./presenters";
import { DEMO_PERSONAS, orderRoles, PERSONA_IDS, personaActor, primaryRoleOf, type PersonaId } from "./roles";

const now = new Date("2026-11-15T12:00:00Z");
const pctx: PresentContext = { now, mode: "UI_MOCK", sync: { offset: null, at: null } };
const INTERNAL_NOTE = "Internal risk view: comparable sale data is thin for this model.";

/** CL-001 advanced to an accepted proposal with internal notes and an active lock. */
function advancedWorld(): { world: DemoWorld; cl001: CaseFacts } {
  const world = buildScenario({ now });
  const cl001 = world.cases.find((c) => c.ref === "CL-001")!;
  cl001.review.state = "ELIGIBLE";
  cl001.review.internalNotes = INTERNAL_NOTE;
  cl001.review.sharedFeedback = "Eligible for this case.";
  cl001.review.assessment = {
    valuation: money("150000.00", "USD"),
    valuationSource: "Verifier inspection report v2 · dealer invoice v1",
    valuationDate: "2026-09-10",
    limitations: "Desktop review.",
    outcome: "ELIGIBLE",
    policyRef: "CP-2026-CNC-01",
    version: 1,
    savedAt: now.toISOString(),
    savedByUserId: "user-lender-a-analyst",
    requiredExternalChecks: [],
  };
  cl001.review.decision = { outcome: "ELIGIBLE", decidedAt: now.toISOString(), decidedByUserId: "user-lender-a-approver" };
  cl001.proposals = [
    {
      ref: "FP-001",
      version: 1,
      state: "ACCEPTED",
      lenderOrgId: "demo-lender-a",
      principal: money("100000.00", "USD"),
      termMetadata: "36 months · metadata only",
      financingRef: "LOAN-DEMO-001",
      externalLegalRef: null,
      expiresAt: "2026-11-29T12:00:00.000Z",
      draftedAt: now.toISOString(),
      draftedByUserId: "user-lender-a-analyst",
      issuedAt: now.toISOString(),
      issuedByUserId: "user-lender-a-approver",
      respondedAt: now.toISOString(),
      respondedByUserId: "user-manufacturer-owner",
      withdrawnAt: null,
      note: null,
    },
  ];
  cl001.lock = {
    ref: "PL-001",
    state: "ACTIVE",
    lenderOrgId: "demo-lender-a",
    borrowerOrgId: "demo-manufacturer",
    activatedAt: now.toISOString(),
    activatedByUserId: "user-lender-a-approver",
    proposalRef: "FP-001",
    proposalVersion: 1,
    attestationRef: "ATT-001",
    packageRef: "PKG-001",
    packageVersion: 2,
    controlVersionConsumed: 3,
    controlVersionLocked: 4,
    releasedAt: null,
    releasedByUserId: null,
    controlVersionAfterRelease: null,
  };
  cl001.asset.control = { version: 4, state: "LOCKED", lockRef: "PL-001" };
  return { world, cl001 };
}

const viewer = (id: PersonaId) => personaActor(id);

describe("unrelated party (Demo Lender B)", () => {
  it("gets nothing for CL-001: no summary, detail, terms, pledge, review, evidence or events", () => {
    const { world, cl001 } = advancedWorld();
    const lenderB = viewer("lender-b-approver");
    expect(presentCaseSummary(cl001, lenderB, pctx)).toBeNull();
    expect(presentCaseDetail(cl001, lenderB, pctx)).toBeNull();
    expect(presentProposal(cl001, lenderB, pctx)).toBeNull();
    expect(presentPledge(cl001, lenderB, pctx)).toBeNull();
    expect(presentReview(cl001, lenderB, pctx)).toBeNull();
    expect(presentCaseEvidence(cl001, world.cases, lenderB, pctx)).toBeNull();
    expect(presentCaseActivity(cl001, lenderB, pctx)).toBeNull();
    expect(presentAccessGrants(cl001, lenderB, pctx)).toBeNull();
    expect(presentAssetDetail(cl001.asset, world.cases, lenderB, pctx)).toBeNull();
  });

  it("sees no cases and zero counts in the queue", () => {
    const { world } = advancedWorld();
    const list = presentCaseList(world.cases, viewer("lender-b-approver"), pctx);
    expect(list.items).toEqual([]);
    expect(Object.values(list.counts).every((n) => n === 0)).toBe(true);
  });
});

describe("field omission", () => {
  it("shows terms only to the borrower and the selected lender", () => {
    const { cl001 } = advancedWorld();
    expect(presentProposal(cl001, viewer("manufacturer-owner"), pctx)?.principal).toEqual(money("100000.00", "USD"));
    expect(presentProposal(cl001, viewer("lender-a-analyst"), pctx)?.principal).toEqual(money("100000.00", "USD"));
    const dealer = presentCaseDetail(cl001, viewer("dealer-contributor"), pctx)!;
    expect(dealer.requestedPrincipal).toBeNull();
    expect(dealer.statuses.proposal).toBeNull();
    expect(dealer.references.proposal).toBeNull();
    expect(dealer.allowedTabs).not.toContain("proposal");
    expect(dealer.allowedTabs).not.toContain("review");
    expect(dealer.pledge).toBeNull();
    expect(presentProposal(cl001, viewer("dealer-contributor"), pctx)).toBeNull();
    expect(JSON.stringify(dealer)).not.toContain("100000");
  });

  it("does not reveal review, proposal or pledge status to the dealer through the stage", () => {
    const { world, cl001 } = advancedWorld();
    const dealer = presentCaseDetail(cl001, viewer("dealer-contributor"), pctx)!;
    expect(dealer.stage).toBeNull();
    expect(dealer.currentStep).toBeNull();
    expect(dealer.nextAction).toBeNull();
    expect(dealer.views).toEqual(["all"]);
    expect(presentAssetDetail(cl001.asset, world.cases, viewer("dealer-contributor"), pctx)?.cases[0]?.stage).toBeNull();
    expect(presentCaseDetail(cl001, viewer("lender-a-analyst"), pctx)?.stage?.value).toBe("PLEDGE_ACTIVE");
  });

  it("shows package completeness and package stages only to viewers who see the whole package", () => {
    const world = buildScenario({ now });
    const cl001 = world.cases.find((c) => c.ref === "CL-001")!;
    // A LOCALNET dealer or verifier sees only its slice of the package (no owner manifest on its ledger view).
    const partial: CaseFacts = { ...cl001, review: { ...cl001.review, state: "NOT_SUBMITTED" }, asset: { ...cl001.asset, documents: [], package: { ...cl001.asset.package, entries: [] } } };
    for (const id of ["dealer-contributor"] as const) {
      const detail = presentCaseDetail(partial, viewer(id), pctx)!;
      expect(detail.statuses.evidence).toBeNull();
      expect(detail.references.package).toBeNull();
      // "Evidence collection" would be derived from documents the viewer cannot see.
      expect(detail.stage).toBeNull();
      expect(detail.nextAction).toBeNull();
    }
    const owner = presentCaseDetail(partial, viewer("manufacturer-owner"), pctx)!;
    expect(owner.stage?.value).toBe("EVIDENCE_COLLECTION");
    expect(owner.statuses.evidence?.label).toBe("Incomplete");
    expect(presentCaseDetail(cl001, viewer("lender-a-analyst"), pctx)?.statuses.evidence?.label).toBe("Complete · 5 documents");
  });

  it("shows the selected lender's attestation as the verification status when the request itself is not visible", () => {
    const world = buildScenario({ now });
    const cl001 = world.cases.find((c) => c.ref === "CL-001")!;
    // LOCALNET: the lender holds ATT-001 through its AttestationDisclosure, never the owner↔verifier request.
    const lenderView: CaseFacts = { ...cl001, asset: { ...cl001.asset, verifications: [] } };
    const summary = presentCaseSummary(lenderView, viewer("lender-a-analyst"), pctx)!;
    expect(summary.verification).toMatchObject({ value: "ATTESTED" });
    expect(presentCaseDetail(lenderView, viewer("lender-a-analyst"), pctx)?.references.attestation?.ref).toBe("ATT-001");
    expect(presentAssetDetail(lenderView.asset, [lenderView], viewer("lender-a-analyst"), pctx)?.verification).toMatchObject({ value: "ATTESTED" });
    // Without an attestation there is nothing to show.
    const none: CaseFacts = { ...lenderView, asset: { ...lenderView.asset, attestations: [] } };
    expect(presentCaseSummary(none, viewer("lender-a-analyst"), pctx)?.verification).toBeNull();
  });

  it("never renders a stray separator for a missing equipment field", () => {
    expect(equipmentSummary({ equipmentClass: "CNC machining center", model: "DEMO-CNC-500" })).toBe("CNC machining center · DEMO-CNC-500");
    expect(equipmentSummary({ equipmentClass: "", model: "DEMO-CNC-500" })).toBe("DEMO-CNC-500");
    expect(equipmentSummary({ equipmentClass: "", model: "" })).toBe("");
  });

  it("names a viewer by the business role, not the governance seat", () => {
    expect(orderRoles(["GOVERNANCE_MEMBER", "LENDER_APPROVER"])).toEqual(["LENDER_APPROVER", "GOVERNANCE_MEMBER"]);
    expect(primaryRoleOf(["GOVERNANCE_MEMBER", "AUDITOR"])).toBe("AUDITOR");
    expect(primaryRoleOf(["GOVERNANCE_MEMBER"])).toBe("GOVERNANCE_MEMBER");
    expect(primaryRoleOf([])).toBeNull();
    expect(presentMe({ ...DEMO_PERSONAS["lender-a-approver"], roles: ["GOVERNANCE_MEMBER", "LENDER_APPROVER"] }, "LOCALNET").roleLabels).toEqual(["Lender Approver", "Governance Member"]);
  });

  it("keeps the verifier out of an asset-level case and terms", () => {
    const { world, cl001 } = advancedWorld();
    const verifier = viewer("verifier-inspector");
    expect(presentCaseDetail(cl001, verifier, pctx)).toBeNull();
    expect(presentProposal(cl001, verifier, pctx)).toBeNull();
    const passport = presentAssetDetail(cl001.asset, world.cases, verifier, pctx)!;
    expect(passport.cases).toEqual([]);
    expect(passport.control).toBeNull();
    expect(JSON.stringify(passport)).not.toContain("Demo Lender A");
    const vr = presentVerification(cl001.asset, cl001.asset.verifications[0]!, verifier, pctx)!;
    expect(VerificationRequestSchema.parse(vr).attestation?.ref).toBe("ATT-001");
  });

  it("returns internal notes only to the lender organization", () => {
    const { cl001 } = advancedWorld();
    expect(presentReview(cl001, viewer("lender-a-analyst"), pctx)?.internalNotes).toBe(INTERNAL_NOTE);
    const borrowerReview = presentReview(cl001, viewer("manufacturer-owner"), pctx)!;
    expect(borrowerReview.internalNotes).toBeNull();
    expect(borrowerReview.assessment).toBeNull();
    expect(borrowerReview.sharedFeedback).toBe("Eligible for this case.");
    expect(JSON.stringify(presentCaseDetail(cl001, viewer("manufacturer-owner"), pctx))).not.toContain(INTERNAL_NOTE);
  });

  it("computes principal / valuation for the lender view", () => {
    const { cl001 } = advancedWorld();
    expect(presentReview(cl001, viewer("lender-a-approver"), pctx)?.derived).toEqual({
      requestedPrincipal: money("100000.00", "USD"),
      principalToValuation: "66.7%",
      policyMaximum: "70.0%",
    });
  });

  it("limits the auditor to granted scopes", () => {
    const { cl001 } = advancedWorld();
    const auditor = viewer("auditor");
    expect(presentCaseSummary(cl001, auditor, pctx)).toBeNull();
    cl001.auditGrants = [
      {
        ref: "AG-002",
        grantorOrgId: "demo-manufacturer",
        grantorSide: "OWNER",
        grantedByUserId: "user-manufacturer-owner",
        auditorOrgId: "demo-auditor",
        scopes: ["EVIDENCE_MANIFEST", "PLEDGE_RELEASE_EVENTS"],
        permission: "VIEW_EXPORT",
        purpose: "Scoped audit",
        createdAt: now.toISOString(),
        expiresAt: "2027-01-01T00:00:00.000Z",
        revokedAt: null,
      },
    ];
    let detail = presentCaseDetail(cl001, auditor, pctx)!;
    expect(detail.allowedTabs).toEqual(["summary", "evidence", "activity"]);
    expect(detail.pledge).toBeNull();
    expect(presentProposal(cl001, auditor, pctx)).toBeNull();
    expect(presentReview(cl001, auditor, pctx)).toBeNull();
    cl001.auditGrants.push({
      ...cl001.auditGrants[0]!,
      ref: "AG-003",
      grantorOrgId: "demo-lender-a",
      grantorSide: "LENDER",
      grantedByUserId: "user-lender-a-approver",
      scopes: ["PLEDGE_RELEASE_EVENTS", "DECISION_OUTCOME"],
    });
    detail = presentCaseDetail(cl001, auditor, pctx)!;
    expect(detail.allowedTabs).toEqual(["summary", "evidence", "review", "pledge", "activity"]);
    expect(presentPledge(cl001, auditor, pctx)?.principalRef).toBeNull();
    const review = presentReview(cl001, auditor, pctx)!;
    expect(review.internalNotes).toBeNull();
    expect(review.assessment).toBeNull();
    const events = presentCaseActivity(cl001, auditor, pctx)!;
    expect(events.some((e) => e.type === "ASSESSMENT_SAVED")).toBe(false);
  });

  it("shows technical ids only to ledger stakeholders", () => {
    const { cl001 } = advancedWorld();
    expect(presentCaseDetail(cl001, viewer("lender-a-approver"), pctx)?.technical).toEqual({
      controlVersion: 4,
      packageVersion: 2,
      namespace: "collara-localnet",
    });
    expect(presentCaseDetail(cl001, viewer("dealer-contributor"), pctx)?.technical).toBeNull();
    expect(presentPledge(cl001, viewer("manufacturer-owner"), pctx)?.technical?.controlVersionLocked).toBe(4);
  });

  it("scopes dealer evidence to own contributions", () => {
    const { world, cl001 } = advancedWorld();
    const docs = presentCaseEvidence(cl001, world.cases, viewer("dealer-contributor"), pctx)!;
    expect(docs.map((d) => d.id)).toEqual(["DOC-003"]);
    expect(docs[0]?.scanStatus.value).toBe("NOT_SCANNED");
  });

  it("hides lender-internal events from the borrower", () => {
    const { cl001 } = advancedWorld();
    cl001.events.push({
      id: "EV-9999",
      occurredAt: now.toISOString(),
      ref: "CA-001",
      type: "ASSESSMENT_SAVED",
      detail: null,
      actor: { orgId: "demo-lender-a", userId: "user-lender-a-analyst", role: "LENDER_ANALYST", label: "Demo Lender A · Analyst" },
      stateChange: null,
      version: "draft",
      kind: "OPERATIONAL",
      commit: null,
    });
    expect(presentCaseActivity(cl001, viewer("manufacturer-owner"), pctx)!.some((e) => e.id === "EV-9999")).toBe(false);
    expect(presentCaseActivity(cl001, viewer("lender-a-analyst"), pctx)!.some((e) => e.id === "EV-9999")).toBe(true);
  });
});

describe("presenter output matches the wire schemas", () => {
  it("validates every DTO for every persona on the main seed", () => {
    const world = buildScenario({ now });
    for (const id of PERSONA_IDS) {
      const actor = personaActor(id);
      for (const c of world.cases) {
        const summary = presentCaseSummary(c, actor, pctx);
        if (summary) CaseSummarySchema.parse(summary);
        const detail = presentCaseDetail(c, actor, pctx);
        if (detail) CaseDetailSchema.parse(detail);
        presentCaseEvidence(c, world.cases, actor, pctx)?.forEach((d) => EvidenceDocumentSchema.parse(d));
        presentCaseActivity(c, actor, pctx)?.forEach((e) => AuditEventSchema.parse(e));
        presentAccessGrants(c, actor, pctx)?.forEach((g) => AccessGrantSchema.parse(g));
        const review = presentReview(c, actor, pctx);
        if (review) ReviewSchema.parse(review);
        const proposal = presentProposal(c, actor, pctx);
        if (proposal) ProposalSchema.parse(proposal);
        const pledge = presentPledge(c, actor, pctx);
        if (pledge) PledgeSchema.parse(pledge);
        const attestation = presentCaseAttestation(c, actor, pctx);
        if (attestation) AttestationSchema.parse(attestation);
        const passport = presentAssetDetail(c.asset, world.cases, actor, pctx);
        if (passport) AssetDetailSchema.parse(passport);
      }
      MeSchema.parse(presentMe(DEMO_PERSONAS[id], "UI_MOCK"));
      GovernanceStateSchema.parse(presentGovernanceState(world.governance, actor, pctx));
      for (const p of world.governance.proposals) GovernanceProposalSchema.parse(presentGovernanceProposal(p, world.governance, actor, pctx));
    }
    presentVerifierEntries(world.governance, world.assets, pctx).forEach((v) => VerifierEntrySchema.parse(v));
  });

  it("lists CL-001…CL-005 for Demo Lender A with server-side counts", () => {
    const world = buildScenario({ now });
    const list = presentCaseList(world.cases, viewer("lender-a-approver"), pctx);
    expect(list.items.map((s) => s.caseId).sort()).toEqual(["CL-001", "CL-002", "CL-003", "CL-004", "CL-005"]);
    expect(list.counts).toMatchObject({ all: 5, "ready-for-review": 1, "needs-evidence": 1, "awaiting-approval": 1, "release-requests": 0 });
    const cl001 = list.items.find((s) => s.caseId === "CL-001")!;
    expect(cl001.stage?.label).toBe("Lender review");
    expect(cl001.review?.label).toBe("Awaiting lender review");
    expect(cl001.nextActor?.label).toBe("Demo Lender A · Analyst");
  });

  it("returns the governance seat and allowed actions per viewer", () => {
    const world = buildScenario({ now: new Date("2026-10-01T14:32:05Z") });
    const p = world.governance.proposals.find((x) => x.ref === "GP-004")!;
    const fixed = { ...pctx, now: new Date("2026-10-01T14:32:05Z") };
    expect(presentGovernanceProposal(p, world.governance, viewer("lender-a-approver"), fixed).allowedActions).toEqual(["confirm"]);
    expect(presentGovernanceProposal(p, world.governance, viewer("lender-b-approver"), fixed).allowedActions).toEqual(["cancel"]);
    expect(presentGovernanceProposal(p, world.governance, viewer("lender-a-analyst"), fixed).allowedActions).toEqual([]);
    expect(presentGovernanceState(world.governance, viewer("lender-a-approver"), fixed)).toMatchObject({
      viewerSeat: 1,
      integration: { status: "SIMULATED", label: "Simulated" },
      counts: { activeVerifiers: 2, suspendedVerifiers: 1, openProposals: 1 },
    });
  });
});
