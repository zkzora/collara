import {
  caseDisclosure,
  deriveCaseStage,
  personaActor,
  presentCaseDetail,
  presentCaseSummary,
  presentPledge,
  presentProposal,
  presentReview,
  type PersonaId,
  type PresentContext,
} from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase, type DbHandle } from "../client";
import { importLocalnetState } from "../bindings";
import { visibleContracts, visibleEvents } from "../queries";
import { cases } from "../schema";
import { seedDemoIdentities } from "../seed";
import { projectOnce, TEMPLATES as T } from "../projection";
import { buildScenario, scenarioBindingState, scenarioParties, type ScenarioParties } from "./scenario-fixture";
import {
  governanceState,
  listAssets,
  listAuditEvents,
  listPledges,
  listReviews,
  listVerifications,
  listVisibleCaseRefs,
  loadAsset,
  loadCaseFacts,
  loadLedgerView,
  loadReadWorld,
  loadReleaseRequest,
  loadVerification,
  verifierEntries,
  type ReadViewer,
} from "./index";

let handle: DbHandle;
const P: ScenarioParties = scenarioParties();
const NOW = new Date("2026-10-01T20:00:00Z");

const viewers = {
  borrower: { orgId: "demo-manufacturer", readableParties: [P.owner] },
  dealer: { orgId: "demo-cnc-dealer", readableParties: [P.dealer] },
  verifier: { orgId: "demo-verifier", readableParties: [P.verifier] },
  lenderA: { orgId: "demo-lender-a", readableParties: [P.lenderA] },
  lenderAApprover: { orgId: "demo-lender-a", readableParties: [P.lenderA, P.seat1, P.governance] },
  lenderB: { orgId: "demo-lender-b", readableParties: [P.lenderB] },
  lenderBWithSeat: { orgId: "demo-lender-b", readableParties: [P.lenderB, P.seat2, P.governance] },
  auditor: { orgId: "demo-auditor", readableParties: [P.auditor] },
  registrar: { orgId: "collara", readableParties: [P.registrar] },
} satisfies Record<string, ReadViewer>;

const pctx: PresentContext = { now: NOW, mode: "LOCALNET", sync: { offset: null, at: null } };
const actor = (id: PersonaId) => personaActor(id);
const opts = { now: NOW };

beforeAll(async () => {
  handle = await createPgliteDatabase();
  await seedDemoIdentities(handle.db);
  await importLocalnetState(handle.db, scenarioBindingState());
  const { ledger } = buildScenario("full");
  // A divulged contract: Lender B is a witness (as a fetch informee would be) but not a stakeholder.
  ledger.tx((tx) => {
    tx.create(
      T.RevokedAttestation,
      { verifier: P.verifier, owner: P.owner, attestationRef: "ATT-999", assetId: "ASSET-OTHER-999", reason: "witness test", revokedAt: "2026-10-01T12:00:00Z", revokedByRef: "mbr:verifier-inspector" },
      { signatories: [P.verifier], witnesses: [P.lenderB] },
    );
  });
  await projectOnce(handle.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P) });
  await handle.db.insert(cases).values({
    caseRef: "CL-001",
    title: "Used CNC financing",
    assetRef: "ASSET-DEMO-001",
    borrowerOrgId: "demo-manufacturer",
    dealerOrgId: "demo-cnc-dealer",
    selectedLenderOrgId: "demo-lender-a",
    requestedPrincipal: "100000.00",
    requestedCurrency: "USD",
    policyRef: "CP-2026-CNC-01",
    createdByUserId: "user-manufacturer-owner",
  });
});

afterAll(async () => {
  await handle.close();
});

describe("read model: selected lender (Demo Lender A)", () => {
  it("builds the full CL-001 history from the lender's stakeholder view", async () => {
    const facts = await loadCaseFacts(handle.db, viewers.lenderA, "CL-001", opts);
    expect(facts).not.toBeNull();
    if (!facts) return;
    expect(facts.selectedLenderOrgId).toBe("demo-lender-a");
    expect(facts.review).toMatchObject({ ref: "CA-001", state: "ELIGIBLE", lenderOrgId: "demo-lender-a", analystUserId: "user-lender-a-analyst", approverUserId: "user-lender-a-approver" });
    expect(facts.review.assessment?.valuation).toEqual({ amount: "150000.00", currency: "USD" });
    expect(facts.review.decision?.outcome).toBe("ELIGIBLE");
    expect(facts.review.snapshotPackageVersion).toBe(2);
    expect(facts.proposals).toHaveLength(1);
    expect(facts.proposals[0]).toMatchObject({ ref: "FP-001", version: 1, state: "ACCEPTED", principal: { amount: "100000.00", currency: "USD" }, respondedByUserId: "user-manufacturer-owner" });
    expect(facts.activation).toMatchObject({ state: "CONSUMED", proposalRef: "FP-001", controlVersion: 3, attestationRef: "ATT-001" });
    expect(facts.lock).toMatchObject({ ref: "PL-001", state: "RELEASED", controlVersionConsumed: 3, controlVersionLocked: 4, controlVersionAfterRelease: 5, lenderOrgId: "demo-lender-a", borrowerOrgId: "demo-manufacturer" });
    expect(facts.releaseRequests.map((r) => [r.ref, r.state])).toEqual([
      ["RR-001", "REJECTED"],
      ["RR-002", "AUTHORIZED"],
    ]);
    expect(facts.releaseRequests[0]?.decisionReason).toBe("Repayment confirmation has not been received.");
    expect(facts.shares.map((s) => [s.ref, s.state, s.entries.length])).toEqual([
      ["SHR-001", "GRANTED", 1],
      ["SHR-002", "GRANTED", 3],
    ]);
    expect(facts.asset.attestations.map((a) => a.ref)).toEqual(["ATT-001"]);
    expect(facts.asset.package).toMatchObject({ ref: "PKG-001", version: 2 });
    expect(facts.asset.package.entries).toHaveLength(4);
    expect(deriveCaseStage(facts, NOW)).toBe("CLOSED");
    // Lender-only ledger events are present with their commit reference.
    const activated = facts.events.find((e) => e.type === "PLEDGE_ACTIVATED");
    expect(activated?.commit?.offset).toBeGreaterThan(0);
    expect(facts.events.map((e) => e.type)).toEqual(expect.arrayContaining(["REVIEW_STARTED", "ASSESSMENT_SAVED", "DECISION_RECORDED", "PROPOSAL_ISSUED", "PROPOSAL_ACCEPTED", "RELEASE_REJECTED", "RELEASE_AUTHORIZED"]));
    // Presenters accept the facts: terms are visible to the selected lender.
    expect(presentProposal(facts, actor("lender-a-approver"), pctx)).not.toBeNull();
    expect(presentCaseDetail(facts, actor("lender-a-analyst"), pctx)).not.toBeNull();
  });

  it("lists reviews, pledges and release requests within the lender's scope", async () => {
    expect((await listReviews(handle.db, viewers.lenderA, opts)).map((c) => c.review.ref)).toEqual(["CA-001"]);
    expect((await listPledges(handle.db, viewers.lenderA, opts)).map((c) => c.lock?.ref)).toEqual(["PL-001"]);
    expect((await loadReleaseRequest(handle.db, viewers.lenderA, "RR-002", opts))?.request.state).toBe("AUTHORIZED");
  });
});

describe("read model: borrower (Demo Manufacturer)", () => {
  it("sees its asset, verification, decision notice and terms, but not the lender's assessment", async () => {
    const facts = await loadCaseFacts(handle.db, viewers.borrower, "CL-001", opts);
    expect(facts).not.toBeNull();
    if (!facts) return;
    expect(facts.asset).toMatchObject({ ref: "ASSET-DEMO-001", manufacturer: "Demo Machine Works (synthetic)", serialNumber: "SYNTH-CNC-001", lifecycle: "REGISTERED", ownerOrgId: "demo-manufacturer" });
    expect(facts.asset.control).toEqual({ version: 5, state: "AVAILABLE", lockRef: null });
    expect(facts.asset.package.history.map((h) => h.version)).toEqual([1, 2]);
    expect(facts.asset.verifications[0]).toMatchObject({ ref: "VR-001", state: "ATTESTED", attestationRef: "ATT-001", verifierRegistryRef: "VER-001", packageVersion: 2 });
    expect(facts.asset.documents.map((d) => [d.ref, d.type, d.ledgerState])).toEqual([
      ["DOC-001", "DEALER_INVOICE", "COMMITTED"],
      ["DOC-002", "EQUIPMENT_PHOTOS", "COMMITTED"],
      ["DOC-003", "INSPECTION_REPORT", "COMMITTED"],
      ["DOC-004", "MAINTENANCE_SUMMARY", "COMMITTED"],
    ]);
    expect(facts.review).toMatchObject({ ref: "CA-001", state: "ELIGIBLE", assessment: null });
    expect(facts.proposals[0]?.state).toBe("ACCEPTED");
    expect(facts.requestedPrincipal).toEqual({ amount: "100000.00", currency: "USD" });
    expect(facts.events.map((e) => e.type)).not.toContain("REVIEW_STARTED");
    expect(facts.events.map((e) => e.type)).toContain("DECISION_RECORDED");
    expect(presentPledge(facts, actor("manufacturer-owner"), pctx)).not.toBeNull();
    const assets = await listAssets(handle.db, viewers.borrower, opts);
    expect(assets.map((a) => a.ref)).toEqual(["ASSET-DEMO-001"]);
  });
});

describe("read model: verifier (Demo Verifier)", () => {
  it("sees the case-scoped verification and its attestation, and no financing, review or pledge facts", async () => {
    const world = await loadReadWorld(handle.db, viewers.verifier, opts);
    const templates = new Set(world.view.contracts.map((c) => c.templateRef));
    for (const forbidden of [T.FinancingProposal, T.FinancingAgreement, T.CollateralAssessment, T.LenderDecisionNotice, T.CollateralLock, T.PledgeActivationAuthorization, T.AssetPassport, T.EvidenceManifest]) {
      expect(templates.has(forbidden)).toBe(false);
    }
    const facts = world.cases.find((c) => c.ref === "CL-001");
    expect(facts).toBeDefined();
    if (!facts) return;
    expect(facts.proposals).toEqual([]);
    expect(facts.lock).toBeNull();
    expect(facts.activation).toBeNull();
    expect(facts.releaseRequests).toEqual([]);
    expect(facts.review.state).toBe("NOT_SUBMITTED");
    expect(facts.asset.serialNumber).toBe("");
    expect(facts.asset.verifications[0]).toMatchObject({ ref: "VR-001", state: "ATTESTED", caseRef: "CL-001", lastMessage: expect.stringContaining("spindle") });
    expect(facts.asset.events.map((e) => e.type)).toEqual(["VERIFICATION_REQUESTED", "ASSIGNMENT_ACCEPTED", "CHANGES_REQUESTED", "EVIDENCE_RESUBMITTED", "ATTESTATION_ISSUED"]);
    expect(presentProposal(facts, actor("verifier-inspector"), pctx)).toBeNull();
    expect(presentReview(facts, actor("verifier-inspector"), pctx)).toBeNull();
    const v = await loadVerification(handle.db, viewers.verifier, "VR-001", opts);
    expect(v?.verification.state).toBe("ATTESTED");
    expect((await listVerifications(handle.db, viewers.verifier, opts)).length).toBe(1);
  });
});

describe("read model: unrelated lender (Demo Lender B)", () => {
  it("sees no case, asset, verification, review, pledge or event of CL-001", async () => {
    for (const viewer of [viewers.lenderB, viewers.lenderBWithSeat]) {
      expect(await listVisibleCaseRefs(handle.db, viewer, opts)).toEqual([]);
      expect(await loadCaseFacts(handle.db, viewer, "CL-001", opts)).toBeNull();
      expect(await listAssets(handle.db, viewer, opts)).toEqual([]);
      expect(await loadAsset(handle.db, viewer, "ASSET-DEMO-001", opts)).toBeNull();
      expect(await listVerifications(handle.db, viewer, opts)).toEqual([]);
      expect(await listReviews(handle.db, viewer, opts)).toEqual([]);
      expect(await listPledges(handle.db, viewer, opts)).toEqual([]);
      expect(await loadReleaseRequest(handle.db, viewer, "RR-001", opts)).toBeNull();
      const audit = await listAuditEvents(handle.db, viewer, opts);
      expect(audit.ledger.filter((e) => e.caseRef === "CL-001" || e.assetRef === "ASSET-DEMO-001")).toEqual([]);
    }
    // Only the non-sensitive directory (config, verifier status) reaches the business party.
    const world = await loadReadWorld(handle.db, viewers.lenderB, opts);
    expect([...new Set(world.view.contracts.map((c) => c.templateRef))].sort()).toEqual([T.CollaraConfig, T.VerifierStatusMirror].sort());
  });

  it("filters by stakeholder membership, never by witness parties", async () => {
    // The divulged grant and the attestation issuance were witnessed by parties that are not stakeholders.
    const witnessed = await visibleContracts(handle.db, { parties: [P.lenderB], templateRefs: [T.RevokedAttestation] });
    expect(witnessed.map((c) => c.businessRef)).toEqual(["ATT-999"]);
    const lenderBView = await loadLedgerView(handle.db, viewers.lenderB);
    expect(lenderBView.contracts.some((c) => c.templateRef === T.RevokedAttestation)).toBe(false);

    const registrarWitness = await visibleEvents(handle.db, { parties: [P.registrar], templateRefs: [T.VerificationRequest] });
    expect(registrarWitness.some((e) => e.choice === "VR_IssueAttestation")).toBe(true);
    const registrarView = await loadLedgerView(handle.db, viewers.registrar);
    expect(registrarView.contracts.some((c) => c.templateRef === T.VerificationRequest)).toBe(false);
    expect(registrarView.events.some((e) => e.choice === "VR_IssueAttestation")).toBe(false);
  });
});

describe("read model: dealer and auditor", () => {
  it("gives the dealer its own contribution and the share it consented to, without terms", async () => {
    const facts = await loadCaseFacts(handle.db, viewers.dealer, "CL-001", opts);
    expect(facts).not.toBeNull();
    if (!facts) return;
    expect(facts.dealerOrgId).toBe("demo-cnc-dealer");
    expect(facts.shares.map((s) => s.ref)).toEqual(["SHR-001"]);
    expect(facts.proposals).toEqual([]);
    expect(facts.asset.documents.map((d) => d.ref)).toEqual(["DOC-001"]);
    expect(presentProposal(facts, actor("dealer-contributor"), pctx)).toBeNull();
  });

  it("gives the auditor the grantors' facts for the granted case; presenters keep only scopes every owner granted", async () => {
    const facts = await loadCaseFacts(handle.db, viewers.auditor, "CL-001", opts);
    expect(facts).not.toBeNull();
    if (!facts) return;
    expect(facts.auditGrants.map((g) => [g.ref, g.grantorSide, g.permission])).toEqual([
      ["AG-001", "OWNER", "VIEW_EXPORT"],
      ["AG-002", "LENDER", "VIEW_EXPORT"],
    ]);
    const disclosure = caseDisclosure(facts, actor("auditor"), pctx);
    expect(disclosure.audit?.scopes).toEqual(["EVIDENCE_MANIFEST", "ATTESTATION", "DECISION_OUTCOME"]);
    // PROPOSAL_TERMS needs both owners: not granted, so no terms.
    expect(presentProposal(facts, actor("auditor"), pctx)).toBeNull();
    expect(presentCaseSummary(facts, actor("auditor"), pctx)).not.toBeNull();
  });
});

describe("read model: governance and sync", () => {
  it("shows seat holders the Tier A governance state and directory members the verifier status", async () => {
    const gov = await governanceState(handle.db, viewers.lenderAApprover, opts);
    expect(gov).toMatchObject({ integration: "PARTIAL_TIER_A", threshold: 2, registryVersion: 0, confirmationTimeoutHours: 0.5 });
    expect(gov?.seats.map((s) => [s.seat, s.orgId])).toEqual([
      [1, "demo-lender-a"],
      [2, "demo-lender-b"],
      [3, "demo-auditor"],
    ]);
    expect(gov?.verifiers).toEqual([expect.objectContaining({ ref: "VER-001", status: "ACTIVE", orgId: "demo-verifier", via: "genesis" })]);
    expect(await governanceState(handle.db, viewers.borrower, opts)).toBeNull();
    const entries = await verifierEntries(handle.db, viewers.lenderB, opts);
    expect(entries.map((e) => [e.ref, e.status.value])).toEqual([["VER-001", "ACTIVE"]]);
  });

  it("reports the projection checkpoint as lastSync", async () => {
    const world = await loadReadWorld(handle.db, viewers.lenderA, opts);
    expect(world.lastSync.offset).toBeGreaterThan(40);
    expect(world.lastSync.at).not.toBeNull();
  });
});

describe("read model: main fixture (review submitted, no proposal)", () => {
  it("derives LENDER_REVIEW for lender and borrower", async () => {
    const db = await createPgliteDatabase();
    try {
      await seedDemoIdentities(db.db);
      await importLocalnetState(db.db, scenarioBindingState());
      const { ledger } = buildScenario("main");
      await projectOnce(db.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P) });
      const lender = await loadCaseFacts(db.db, viewers.lenderA, "CL-001", opts);
      const borrower = await loadCaseFacts(db.db, viewers.borrower, "CL-001", opts);
      expect(lender?.review.state).toBe("SUBMITTED");
      expect(borrower?.review.state).toBe("SUBMITTED");
      expect(lender && deriveCaseStage(lender, NOW)).toBe("LENDER_REVIEW");
      expect(borrower && deriveCaseStage(borrower, NOW)).toBe("LENDER_REVIEW");
      expect(lender?.asset.control).toEqual({ version: 3, state: "AVAILABLE", lockRef: null });
    } finally {
      await db.close();
    }
  });
});
