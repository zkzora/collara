import {
  caseDisclosure,
  deriveCaseStage,
  latestProposal,
  personaActor,
  pledgeDisplayState,
  presentCaseDetail,
  presentCaseSummary,
  presentPledge,
  presentProposal,
  presentReview,
  type CaseStage,
  type PersonaId,
  type PresentContext,
} from "@collara/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase, type DbHandle } from "../client";
import { importLocalnetState } from "../bindings";
import { visibleContracts, visibleEvents } from "../queries";
import { cases } from "../schema";
import { seedDemoIdentities } from "../seed";
import { projectOnce, TEMPLATES as T } from "../projection";
import { equipmentEntitlements } from "./disclosure";
import type { LedgerView, VisibleContract } from "./ledger-view";
import { buildScenario, scenarioBindingState, scenarioParties, type ScenarioParties, type ScenarioStage } from "./scenario-fixture";
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
    // Timeline detail uses the reason's wording, never the raw ledger code.
    expect(facts.events.filter((e) => e.type === "RELEASE_REQUESTED").map((e) => e.detail)).toEqual(["external loan completion", "external loan completion"]);
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
    // No passport on the verifier's ledger view; the identity comes from the assignment disclosure (disclosure.ts).
    expect(world.view.contracts.some((c) => c.templateRef === T.AssetPassport)).toBe(false);
    expect(facts.asset).toMatchObject({ equipmentClass: "CNC machining center", model: "DEMO-CNC-500", serialNumber: "SYNTH-CNC-001" });
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

describe("read model: equipment identity disclosure (synthesis §1.4.1)", () => {
  it("gives the selected lender, the invited dealer and the assigned verifier the owner's passport identity", async () => {
    const identity = { equipmentClass: "CNC machining center", manufacturer: "Demo Machine Works (synthetic)", model: "DEMO-CNC-500", serialNumber: "SYNTH-CNC-001" };
    for (const viewer of [viewers.lenderA, viewers.lenderAApprover, viewers.dealer, viewers.verifier]) {
      const world = await loadReadWorld(handle.db, viewer, opts);
      // The passport itself stays owner-only on the ledger and in the viewer's raw view.
      expect(world.view.contracts.some((c) => c.templateRef === T.AssetPassport)).toBe(false);
      expect(world.cases.find((c) => c.ref === "CL-001")?.asset).toMatchObject(identity);
      expect(world.assets.find((a) => a.ref === "ASSET-DEMO-001")).toMatchObject(identity);
      // Identity only: no location, documents or registration details.
      expect(world.assets.find((a) => a.ref === "ASSET-DEMO-001")?.locationScope).toBe("");
    }
    const summary = presentCaseSummary((await loadCaseFacts(handle.db, viewers.lenderA, "CL-001", opts))!, actor("lender-a-analyst"), pctx);
    expect(summary?.asset).toEqual({ ref: "ASSET-DEMO-001", equipmentClass: "CNC machining center", model: "DEMO-CNC-500" });
  });

  it("never discloses it to Demo Lender B or to an auditor through the lender's grant alone", async () => {
    for (const viewer of [viewers.lenderB, viewers.lenderBWithSeat]) expect(await listAssets(handle.db, viewer, opts)).toEqual([]);
    const lenderBWorld = await loadReadWorld(handle.db, viewers.lenderB, opts);
    expect(equipmentEntitlements(lenderBWorld.view, viewers.lenderB, new Map([["CL-001", "ASSET-DEMO-001"]]), NOW).size).toBe(0);
    const auditorWorld = await loadReadWorld(handle.db, { ...viewers.auditor, roles: ["AUDITOR"] }, opts);
    expect(equipmentEntitlements(auditorWorld.view, viewers.auditor, new Map([["CL-001", "ASSET-DEMO-001"]]), NOW).size).toBe(0);
  });

  it("entitles only active, unexpired shares and assignments that were not declined or cancelled", () => {
    const contract = (templateRef: string, payload: Record<string, unknown>, archived: string | null = null): VisibleContract => ({
      source: "sandbox",
      contractId: `${templateRef}-${Math.random()}`,
      templateRef,
      payload,
      signatories: [],
      observers: [],
      businessRef: null,
      caseRef: typeof payload.caseRef === "string" ? payload.caseRef : null,
      assetRef: typeof payload.assetId === "string" ? payload.assetId : null,
      createdAt: "2026-10-01T00:00:00Z",
      createdOffset: 1,
      createdNodeId: 0,
      createdUpdateId: "u",
      archived: archived ? { at: "2026-10-01T01:00:00Z", offset: 2, updateId: "u2", choice: archived, argument: {}, actingParties: [] } : null,
    });
    const view = (contracts: VisibleContract[]): LedgerView => ({ contracts, events: [], byId: new Map(contracts.map((c) => [c.contractId, c])) });
    const caseAssets = new Map([["CL-001", "ASSET-DEMO-001"]]);
    const share = (extra: Record<string, unknown>) => ({ owner: P.owner, consenters: [], recipient: P.lenderA, caseRef: "CL-001", shareRef: "SHR-9", documents: [], ...extra });
    const lender = { orgId: "demo-lender-a", readableParties: [P.lenderA] };
    const entitled = (contracts: VisibleContract[], viewer: ReadViewer = lender) => [...equipmentEntitlements(view(contracts), viewer, caseAssets, NOW).keys()];

    expect(entitled([contract(T.PackageShare, share({ expiresAt: "2026-12-31T00:00:00Z" }))])).toEqual(["ASSET-DEMO-001"]);
    expect(entitled([contract(T.PackageShare, share({ expiresAt: "2026-12-31T00:00:00Z" }), "Share_Revoke")])).toEqual([]);
    expect(entitled([contract(T.PackageShare, share({ expiresAt: "2026-09-30T00:00:00Z" }))])).toEqual([]);
    // Another lender's share entitles nobody else.
    expect(entitled([contract(T.PackageShare, share({ recipient: P.lenderB, expiresAt: "2026-12-31T00:00:00Z" }))])).toEqual([]);
    expect(entitled([contract(T.AssetControl, { owner: P.owner, assetId: "ASSET-DEMO-001", sharedLender: P.lenderA })])).toEqual(["ASSET-DEMO-001"]);
    expect(entitled([contract(T.AssetControl, { owner: P.owner, assetId: "ASSET-DEMO-001", sharedLender: null })])).toEqual([]);

    const verifier = { orgId: "demo-verifier", readableParties: [P.verifier] };
    const vr = (version: number) => ({ owner: P.owner, verifier: P.verifier, requestRef: "VR-9", assetId: "ASSET-DEMO-001", version });
    expect(entitled([contract(T.VerificationRequest, vr(1))], verifier)).toEqual(["ASSET-DEMO-001"]);
    expect(entitled([contract(T.VerificationRequest, vr(1), "VR_DeclineAssignment")], verifier)).toEqual([]);
    expect(entitled([contract(T.VerificationRequest, vr(1), "VR_AcceptAssignment"), contract(T.VerificationRequest, vr(2), "VR_Cancel")], verifier)).toEqual([]);
    expect(entitled([contract(T.VerificationRequest, vr(1), "VR_AcceptAssignment"), contract(T.VerificationRequest, vr(2), "VR_IssueAttestation")], verifier)).toEqual(["ASSET-DEMO-001"]);
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

  it("shows the invited dealer its case before it holds any contract of it (application record), without terms", async () => {
    // CL-002: invited dealer, no ledger contract yet (the dealer has not contributed); a fresh asset.
    await handle.db.insert(cases).values({
      caseRef: "CL-002",
      title: "Invited dealer case",
      assetRef: "ASSET-DEMO-002",
      borrowerOrgId: "demo-manufacturer",
      dealerOrgId: "demo-cnc-dealer",
      selectedLenderOrgId: "demo-lender-a",
      requestedPrincipal: "100000.00",
      requestedCurrency: "USD",
      policyRef: "CP-2026-CNC-01",
      createdByUserId: "user-manufacturer-owner",
    });
    try {
      const dealer = { ...viewers.dealer, roles: ["DEALER"] };
      const facts = await loadCaseFacts(handle.db, dealer, "CL-002", opts);
      expect(facts).not.toBeNull();
      if (!facts) return;
      expect(facts).toMatchObject({ ref: "CL-002", dealerOrgId: "demo-cnc-dealer", borrowerOrgId: "demo-manufacturer", proposals: [], lock: null });
      // No passport in the dealer's view, but a case exists only for a registered asset; the identity stays undisclosed.
      expect(facts.asset).toMatchObject({ ref: "ASSET-DEMO-002", lifecycle: "REGISTERED", equipmentClass: "", serialNumber: "", registeredAt: null });
      const detail = presentCaseDetail(facts, actor("dealer-contributor"), pctx);
      expect(detail?.requestedPrincipal).toBeNull();
      expect(detail?.allowedActions).toContain("evidence.upload");
      expect(JSON.stringify(detail)).not.toContain("100000");
      // Only the invited dealer: not the selected lender before a share, not Lender B, not the verifier, and not a
      // viewer of the dealer organization without the dealer role.
      for (const viewer of [{ ...viewers.lenderA, roles: ["LENDER_ANALYST"] }, { ...viewers.lenderB, roles: ["LENDER_APPROVER"] }, { ...viewers.verifier, roles: ["VERIFIER"] }, { ...viewers.dealer, roles: ["AUDITOR"] }]) {
        expect(await loadCaseFacts(handle.db, viewer, "CL-002", opts), viewer.orgId).toBeNull();
      }
    } finally {
      await handle.db.delete(cases).where(eq(cases.caseRef, "CL-002"));
    }
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

// Stage derivation (synthesis §1.5.1) over the projected fixture, one fresh database per stop of the walkthrough,
// with the privacy filters re-checked at every stop.
interface StageExpectation {
  readonly stage: CaseStage;
  readonly review: string;
  readonly proposal: string | null;
  readonly activation: string | null;
  readonly lock: string | null;
  readonly control: { version: number; state: string; lockRef: string | null };
  readonly releases: readonly (readonly [string, string])[];
  readonly pledgeDisplay: string;
}
const STAGES: readonly (readonly [ScenarioStage, StageExpectation])[] = [
  ["main", { stage: "LENDER_REVIEW", review: "SUBMITTED", proposal: null, activation: null, lock: null, control: { version: 3, state: "AVAILABLE", lockRef: null }, releases: [], pledgeDisplay: "AVAILABLE" }],
  ["eligible", { stage: "PROPOSAL", review: "ELIGIBLE", proposal: null, activation: null, lock: null, control: { version: 3, state: "AVAILABLE", lockRef: null }, releases: [], pledgeDisplay: "AVAILABLE" }],
  ["proposal", { stage: "PROPOSAL", review: "ELIGIBLE", proposal: "ISSUED", activation: null, lock: null, control: { version: 3, state: "AVAILABLE", lockRef: null }, releases: [], pledgeDisplay: "AVAILABLE" }],
  ["authorized", { stage: "PROPOSAL", review: "ELIGIBLE", proposal: "ACCEPTED", activation: "AUTHORIZED", lock: null, control: { version: 3, state: "AVAILABLE", lockRef: null }, releases: [], pledgeDisplay: "AVAILABLE" }],
  ["pledged", { stage: "PLEDGE_ACTIVE", review: "ELIGIBLE", proposal: "ACCEPTED", activation: "CONSUMED", lock: "ACTIVE", control: { version: 4, state: "LOCKED", lockRef: "PL-001" }, releases: [], pledgeDisplay: "ACTIVE" }],
  ["release-requested", { stage: "RELEASE_REVIEW", review: "ELIGIBLE", proposal: "ACCEPTED", activation: "CONSUMED", lock: "ACTIVE", control: { version: 4, state: "LOCKED", lockRef: "PL-001" }, releases: [["RR-001", "REQUESTED"]], pledgeDisplay: "RELEASE_REQUESTED" }],
  ["release-rejected", { stage: "PLEDGE_ACTIVE", review: "ELIGIBLE", proposal: "ACCEPTED", activation: "CONSUMED", lock: "ACTIVE", control: { version: 4, state: "LOCKED", lockRef: "PL-001" }, releases: [["RR-001", "REJECTED"]], pledgeDisplay: "RELEASE_REJECTED" }],
  ["full", { stage: "CLOSED", review: "ELIGIBLE", proposal: "ACCEPTED", activation: "CONSUMED", lock: "RELEASED", control: { version: 5, state: "AVAILABLE", lockRef: null }, releases: [["RR-001", "REJECTED"], ["RR-002", "AUTHORIZED"]], pledgeDisplay: "RELEASED" }],
];

const FINANCING_TEMPLATES = [T.FinancingProposal, T.FinancingAgreement, T.PledgeActivationAuthorization, T.CollateralAssessment, T.LenderDecisionNotice, T.CollateralLock, T.CollateralLockReleased, T.ReleaseRequest, T.ReleaseDecision];

describe("read model: stage derivation across the walkthrough", () => {
  it.each(STAGES)("after %s", async (stop, expected) => {
    const db = await createPgliteDatabase();
    try {
      await seedDemoIdentities(db.db);
      await importLocalnetState(db.db, scenarioBindingState());
      const { ledger } = buildScenario(stop);
      await projectOnce(db.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P) });

      // The selected lender and the borrower derive the same stage from their own stakeholder views.
      for (const viewer of [viewers.lenderA, viewers.borrower]) {
        const facts = await loadCaseFacts(db.db, viewer, "CL-001", opts);
        expect(facts, `${stop}: ${viewer.orgId}`).not.toBeNull();
        if (!facts) continue;
        expect(deriveCaseStage(facts, NOW), `${stop}: ${viewer.orgId}`).toBe(expected.stage);
        expect(facts.review.state).toBe(expected.review);
        expect(latestProposal(facts)?.state ?? null).toBe(expected.proposal);
        expect(facts.activation?.state ?? null).toBe(expected.activation);
        expect(facts.lock?.state ?? null).toBe(expected.lock);
        expect(facts.asset.control).toEqual(expected.control);
        expect(facts.releaseRequests.map((r) => [r.ref, r.state])).toEqual(expected.releases);
        expect(pledgeDisplayState(facts)).toBe(expected.pledgeDisplay);
        if (expected.proposal === "ACCEPTED") {
          // Acceptance comes from the FinancingAgreement both parties sign.
          expect(latestProposal(facts)).toMatchObject({ respondedByUserId: "user-manufacturer-owner", principal: { amount: "100000.00", currency: "USD" } });
          expect(latestProposal(facts)?.respondedAt).toBeTruthy();
        }
      }

      // Lender B (with and without a governance seat): nothing about the case, at any stage.
      for (const viewer of [viewers.lenderB, viewers.lenderBWithSeat]) {
        expect(await listVisibleCaseRefs(db.db, viewer, opts)).toEqual([]);
        expect(await loadCaseFacts(db.db, viewer, "CL-001", opts)).toBeNull();
        expect(await listAssets(db.db, viewer, opts)).toEqual([]);
      }
      // Verifier and dealer: no financing contract in their view, no proposal/agreement/lock facts.
      for (const viewer of [viewers.verifier, viewers.dealer]) {
        const world = await loadReadWorld(db.db, viewer, opts);
        expect(world.view.contracts.filter((c) => FINANCING_TEMPLATES.includes(c.templateRef as (typeof FINANCING_TEMPLATES)[number]))).toEqual([]);
        const facts = world.cases.find((c) => c.ref === "CL-001");
        expect(facts?.proposals ?? []).toEqual([]);
        expect(facts?.activation ?? null).toBeNull();
        expect(facts?.lock ?? null).toBeNull();
        expect(facts?.releaseRequests ?? []).toEqual([]);
        expect(facts?.review.assessment ?? null).toBeNull();
      }
      // Auditor: nothing before the audit grants exist (W13–W14 only run in "full").
      const auditorFacts = await loadCaseFacts(db.db, viewers.auditor, "CL-001", opts);
      if (stop === "full") expect(auditorFacts?.auditGrants.map((g) => g.ref)).toEqual(["AG-001", "AG-002"]);
      else expect(auditorFacts).toBeNull();
    } finally {
      await db.close();
    }
  });
});
