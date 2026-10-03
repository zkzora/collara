// Verification evidence grants in the read model (daml-model.md §4.6): the assigned verifier's verification facts
// list exactly its live VERIFICATION grants of the request (exact versions), its document metadata is limited to
// those versions, the grants never become case shares, and attestations point at the reviewed versions.
import { createHash } from "node:crypto";
import { personaActor, presentCaseDetail, presentEvidenceList, presentVerification, VERIFICATION_GRANT_PURPOSE, type PresentContext } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase, type DbHandle } from "../client";
import { importLocalnetState } from "../bindings";
import { projectOnce, TEMPLATES as T } from "../projection";
import type { FakeLedger } from "../projection/fake-ledger";
import { cases, evidenceDocuments } from "../schema";
import { seedDemoIdentities } from "../seed";
import { buildScenario, scenarioBindingState, scenarioParties } from "./scenario-fixture";
import { loadCaseFacts, loadReadWorld, loadVerification, type ReadViewer } from "./index";

const P = scenarioParties();
const NOW = new Date("2026-10-01T20:00:00Z");
const DAY = 86_400_000;
const opts = { now: NOW };
const pctx: PresentContext = { now: NOW, mode: "LOCALNET", sync: { offset: null, at: null } };
const viewers = {
  borrower: { orgId: "demo-manufacturer", readableParties: [P.owner] },
  dealer: { orgId: "demo-cnc-dealer", readableParties: [P.dealer] },
  verifier: { orgId: "demo-verifier", readableParties: [P.verifier] },
  lenderA: { orgId: "demo-lender-a", readableParties: [P.lenderA] },
  lenderB: { orgId: "demo-lender-b", readableParties: [P.lenderB] },
  auditor: { orgId: "demo-auditor", readableParties: [P.auditor] },
} satisfies Record<string, ReadViewer>;

const anchor = (version: number) => ({ packageRef: "PKG-001", manifestVersion: String(version), manifestHash: `hash-manifest-v${version}` });
const sha = (docRef: string, version: number) => createHash("sha256").update(`synthetic:${docRef}:v${version}`).digest("hex");
const doc = (docRef: string, docVersion: number, source: string) => ({ docRef, docVersion: String(docVersion), sha256: sha(docRef, docVersion), source });

let handle: DbHandle;
let ledger: FakeLedger;
let grantCid = "";
let requestCid = "";

const project = () => projectOnce(handle.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P) });

beforeAll(async () => {
  handle = await createPgliteDatabase();
  await seedDemoIdentities(handle.db);
  await importLocalnetState(handle.db, scenarioBindingState());
  ledger = buildScenario("main").ledger;
  // VR-002 on manifest v2, accepted; the owner's grant VR-002-G2 lists two of the four documents. The dealer's
  // invoice is only requested from the dealer (no Consent_Grant yet), so it is not granted.
  const vr = (version: number, status: string) => ({
    owner: P.owner,
    verifier: P.verifier,
    registrar: P.registrar,
    namespace: "collara-localnet",
    requestRef: "VR-002",
    assetId: "ASSET-DEMO-001",
    passportVersion: "1",
    caseRef: "CL-001",
    evidence: anchor(2),
    equipmentScope: "CNC_MACHINERY",
    checklist: ["Photos", "Inspected condition"],
    dueBy: new Date(NOW.getTime() + 10 * DAY).toISOString(),
    status,
    version: String(version),
    changeNote: "",
  });
  const grant = (shareRef: string, documents: object[]) => ({
    owner: P.owner,
    recipient: P.verifier,
    shareRef,
    purpose: VERIFICATION_GRANT_PURPOSE,
    caseRef: "CL-001",
    evidence: anchor(2),
    documents,
    permission: "VIEW_DOWNLOAD",
    expiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(),
  });
  let first = "";
  ledger.tx((tx) => {
    first = tx.create(T.VerificationRequest, vr(1, "REQUESTED"), { signatories: [P.owner], observers: [P.verifier] });
    grantCid = tx.create(T.PackageShare, { ...grant("VR-002-G2", [doc("DOC-002", 1, P.owner), doc("DOC-003", 2, P.owner)]), consenters: [] }, { signatories: [P.owner], observers: [P.verifier] });
    tx.create(T.PackageShareProposal, { ...grant("VR-002-G2-D1", [doc("DOC-001", 1, P.dealer)]), dealer: P.dealer }, { signatories: [P.owner], observers: [P.dealer] });
  });
  ledger.tx((tx) => {
    tx.exercise(first, "VR_AcceptAssignment", { actorRef: "mbr:verifier-inspector" }, { actingParties: [P.verifier] });
    requestCid = tx.create(T.VerificationRequest, vr(2, "IN_REVIEW"), { signatories: [P.owner], observers: [P.verifier] });
  });
  await project();
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
  // The owner's application rows (bytes stay in storage): DOC-003 has two versions.
  const row = (docRef: string, version: number, type: string, fileName: string, contributorOrgId = "demo-manufacturer") => ({
    docRef,
    version,
    assetRef: "ASSET-DEMO-001",
    caseRef: "CL-001",
    ownerOrgId: "demo-manufacturer",
    contributorOrgId,
    uploadedByUserId: contributorOrgId === "demo-manufacturer" ? "user-manufacturer-owner" : "user-dealer-contributor",
    type,
    title: fileName,
    fileName,
    contentType: "application/pdf",
    declaredSizeBytes: 100,
    sizeBytes: 100,
    sha256: sha(docRef, version),
    storageKey: `evidence/${docRef}/v${version}`,
    status: "AVAILABLE",
    intentExpiresAt: NOW,
    uploadedAt: NOW,
    finalizedAt: NOW,
  });
  await handle.db
    .insert(evidenceDocuments)
    .values([
      row("DOC-001", 1, "DEALER_INVOICE", "invoice-v1.pdf", "demo-cnc-dealer"),
      row("DOC-002", 1, "EQUIPMENT_PHOTOS", "photos-v1.pdf"),
      row("DOC-003", 1, "INSPECTION_REPORT", "inspection-v1.pdf"),
      row("DOC-003", 2, "INSPECTION_REPORT", "inspection-v2.pdf"),
      row("DOC-004", 1, "MAINTENANCE_SUMMARY", "maintenance-v1.pdf"),
    ]);
});

afterAll(async () => {
  await handle?.close();
});

describe("verification grants: the assigned verifier", () => {
  it("lists exactly the granted documents at the granted versions, with the owner's file metadata, and nothing else", async () => {
    const found = await loadVerification(handle.db, viewers.verifier, "VR-002", opts);
    expect(found?.verification).toMatchObject({
      ref: "VR-002",
      state: "IN_REVIEW",
      documentRefs: ["DOC-002", "DOC-003"],
      documentVersions: [
        { documentRef: "DOC-002", version: 1 },
        { documentRef: "DOC-003", version: 2 },
      ],
    });
    const asset = found!.asset;
    const inspection = asset.documents.find((d) => d.ref === "DOC-003");
    expect(inspection?.versions.map((v) => [v.version, v.fileName, v.sha256])).toEqual([[2, "inspection-v2.pdf", sha("DOC-003", 2)]]);
    // Neither the ungranted owner document nor the dealer's (consent pending) document has a row for the verifier.
    expect(asset.documents.find((d) => d.ref === "DOC-004")?.versions.some((v) => v.fileName)).toBeFalsy();
    expect(asset.documents.find((d) => d.ref === "DOC-001")?.versions.some((v) => v.fileName)).toBeFalsy();

    const world = await loadReadWorld(handle.db, viewers.verifier, opts);
    const presented = presentEvidenceList(asset, world.cases, personaActor("verifier-inspector"), pctx);
    expect(presented?.map((d) => [d.id, d.version, d.canDownload])).toEqual([
      ["DOC-002", 1, true],
      ["DOC-003", 2, true],
    ]);
    const dto = presentVerification(asset, found!.verification, personaActor("verifier-inspector"), pctx);
    expect(dto?.documentIds).toEqual(["DOC-002", "DOC-003"]);
    expect(dto?.assignedVersions).toEqual([
      { documentId: "DOC-002", version: 1 },
      { documentId: "DOC-003", version: 2 },
    ]);
    // The grant is not a case share; the verifier gets no loan terms.
    const facts = world.cases.find((c) => c.ref === "CL-001");
    expect(facts?.shares).toEqual([]);
    expect(facts?.proposals).toEqual([]);
    // Facts carry the case row; the presenters omit the terms for the verifier.
    expect(JSON.stringify(presentCaseDetail(facts!, personaActor("verifier-inspector"), pctx))).not.toContain("100000");
  });
});

describe("verification grants: other parties", () => {
  it("the owner sees what was granted (not the pending dealer request); the legacy VR-001 keeps the manifest listing", async () => {
    const vr2 = await loadVerification(handle.db, viewers.borrower, "VR-002", opts);
    expect(vr2?.verification.documentRefs).toEqual(["DOC-002", "DOC-003"]);
    const vr1 = await loadVerification(handle.db, viewers.borrower, "VR-001", opts);
    expect(vr1?.verification.documentRefs).toEqual(["DOC-001", "DOC-002", "DOC-003", "DOC-004"]);
    expect(vr1?.verification.documentVersions).toBeUndefined();
    // The owner's case shares are still the lender shares only.
    const facts = await loadCaseFacts(handle.db, viewers.borrower, "CL-001", opts);
    expect(facts?.shares.map((s) => s.ref).sort()).toEqual(["SHR-001", "SHR-002"]);
  });

  it("the selected lender, Lender B, the dealer and the auditor never see the grant or VR-002", async () => {
    for (const viewer of [viewers.lenderA, viewers.lenderB, viewers.dealer, viewers.auditor]) {
      expect(await loadVerification(handle.db, viewer, "VR-002", opts), viewer.orgId).toBeNull();
      const world = await loadReadWorld(handle.db, viewer, opts);
      expect(world.view.contracts.some((c) => c.templateRef === T.PackageShare && String(c.payload.purpose) === VERIFICATION_GRANT_PURPOSE), viewer.orgId).toBe(false);
    }
    const lender = await loadCaseFacts(handle.db, viewers.lenderA, "CL-001", opts);
    expect(lender?.shares.map((s) => s.ref).sort()).toEqual(["SHR-001", "SHR-002"]);
    // The dealer observes only the request for its own document, and it is not listed as a case share.
    const dealerWorld = await loadReadWorld(handle.db, viewers.dealer, opts);
    expect(dealerWorld.view.contracts.filter((c) => c.templateRef === T.PackageShareProposal && String(c.payload.purpose) === VERIFICATION_GRANT_PURPOSE).map((c) => c.businessRef)).toEqual(["VR-002-G2-D1"]);
    const dealerCase = dealerWorld.cases.find((c) => c.ref === "CL-001");
    expect(dealerCase?.shares.some((s) => s.ref === "VR-002-G2-D1")).toBe(false);
  });
});

describe("verification grants: attestation and end of access", () => {
  it("the attestation points at the reviewed evidence version and the granted document versions", async () => {
    ledger.tx((tx) => {
      tx.exercise(requestCid, "VR_IssueAttestation", { attestationRef: "ATT-002", actorRef: "mbr:verifier-inspector" }, { actingParties: [P.verifier] });
      tx.create(
        T.VerificationAttestation,
        {
          verifier: P.verifier,
          owner: P.owner,
          registrar: P.registrar,
          namespace: "collara-localnet",
          governanceParty: P.governance,
          attestationRef: "ATT-002",
          requestRef: "VR-002",
          verifierRef: "VER-001",
          assetId: "ASSET-DEMO-001",
          passportVersion: "1",
          caseRef: "CL-001",
          evidence: anchor(2),
          equipmentScope: "CNC_MACHINERY",
          checks: [{ item: "Photos", finding: "Consistent", result: "CHECKED" }],
          limitations: "Synthetic.",
          method: "Document review",
          inspectedAt: NOW.toISOString(),
          validFrom: NOW.toISOString(),
          validUntil: new Date(NOW.getTime() + 90 * DAY).toISOString(),
          supersedesRef: "ATT-001",
          issuedAt: NOW.toISOString(),
          issuedByRef: "mbr:verifier-inspector",
        },
        { signatories: [P.verifier], observers: [P.owner] },
      );
    });
    await project();
    for (const viewer of [viewers.verifier, viewers.borrower]) {
      const found = await loadVerification(handle.db, viewer, "VR-002", opts);
      const attestation = found?.asset.attestations.find((a) => a.ref === "ATT-002");
      expect(attestation, viewer.orgId).toMatchObject({
        verificationRef: "VR-002",
        packageRef: "PKG-001",
        packageVersion: 2,
        supportingVersions: [
          { documentRef: "DOC-002", version: 1 },
          { documentRef: "DOC-003", version: 2 },
        ],
      });
      expect(found?.verification.state).toBe("ATTESTED");
    }
  });

  it("a revoked grant no longer lists or exposes the documents to the verifier; the attestation keeps its reviewed versions", async () => {
    ledger.tx((tx) => {
      tx.exercise(grantCid, "Share_Revoke", { actorRef: "mbr:manufacturer-owner" }, { actingParties: [P.owner] });
    });
    await project();
    const found = await loadVerification(handle.db, viewers.verifier, "VR-002", opts);
    expect(found?.verification.documentRefs).toEqual([]);
    expect(found?.verification.documentVersions).toEqual([]);
    expect(found?.asset.documents.some((d) => d.versions.some((v) => v.fileName))).toBe(false);
    expect(found?.asset.attestations.find((a) => a.ref === "ATT-002")?.supportingVersions.map((e) => e.documentRef)).toEqual(["DOC-002", "DOC-003"]);
  });

  it("the lender's disclosed copy lists the reviewed versions, not every entry of the package version", async () => {
    const owner = await loadReadWorld(handle.db, viewers.borrower, opts);
    const original = owner.view.contracts.find((c) => c.templateRef === T.VerificationAttestation && c.payload.attestationRef === "ATT-002");
    expect(original).toBeDefined();
    ledger.tx((tx) => {
      tx.create(
        T.AttestationDisclosure,
        { verifier: P.verifier, owner: P.owner, recipient: P.lenderA, purpose: "LENDER_REVIEW", caseRef: "CL-001", attestationCid: original!.contractId, attestation: original!.payload, disclosedAt: NOW.toISOString() },
        { signatories: [P.verifier, P.owner], observers: [P.lenderA] },
      );
    });
    await project();
    const lender = await loadCaseFacts(handle.db, viewers.lenderA, "CL-001", opts);
    const supporting = (ref: string) => lender?.asset.attestations.find((a) => a.ref === ref)?.supportingVersions;
    // The grant (revoked since) named DOC-002 v1 and DOC-003 v2; package v2 also holds DOC-001 and DOC-004.
    expect(supporting("ATT-002")).toEqual([
      { documentRef: "DOC-002", version: 1 },
      { documentRef: "DOC-003", version: 2 },
    ]);
    // An attestation issued without a grant (the legacy ATT-001) keeps the package entries.
    expect(supporting("ATT-001")?.map((e) => e.documentRef)).toEqual(["DOC-001", "DOC-002", "DOC-003", "DOC-004"]);
    // The lender still sees no grant contract, and Lender B nothing at all.
    const lenderWorld = await loadReadWorld(handle.db, viewers.lenderA, opts);
    expect(lenderWorld.view.contracts.some((c) => c.templateRef === T.PackageShare && String(c.payload.purpose) === VERIFICATION_GRANT_PURPOSE)).toBe(false);
    expect(await loadCaseFacts(handle.db, viewers.lenderB, "CL-001", opts)).toBeNull();
  });

  it("an expired grant counts as gone", async () => {
    ledger.tx((tx) => {
      tx.create(
        T.PackageShare,
        {
          owner: P.owner,
          consenters: [],
          recipient: P.verifier,
          shareRef: "VR-002-G2",
          purpose: VERIFICATION_GRANT_PURPOSE,
          caseRef: "CL-001",
          evidence: anchor(2),
          documents: [doc("DOC-004", 1, P.owner)],
          permission: "VIEW_DOWNLOAD",
          expiresAt: new Date(NOW.getTime() - 60_000).toISOString(),
        },
        { signatories: [P.owner], observers: [P.verifier] },
      );
    });
    await project();
    const found = await loadVerification(handle.db, viewers.verifier, "VR-002", opts);
    expect(found?.verification.documentRefs).toEqual([]);
    expect(found?.asset.documents.find((d) => d.ref === "DOC-004")?.versions.some((v) => v.fileName)).toBeFalsy();
  });
});
