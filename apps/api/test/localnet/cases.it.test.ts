// LocalNet IT (LOCALNET_IT=1): the asset → evidence → verification → sharing journey driven ONLY through the
// API (no main seed), on a fresh "ep1-<unique>" prefix after the clean-start seed (registry, Tier A governance,
// VER-001, config, mirror). Every step is asserted on the LEDGER (ACS as each organisation's ledger user) and,
// after a synchronous projection pass, through the read endpoints. Negative cases: Demo Lender B gets 404-shaped
// answers everywhere, invalid transitions get 409 with the approved copy, mandates are enforced (403), browser-
// supplied authority is ignored, replays with the same Idempotency-Key never submit twice.
import { cases as casesTable } from "@collara/db";
import {
  AccessGrantSchema,
  AssetDetailSchema,
  AttestationSchema,
  CaseDetailSchema,
  CL001_CHECKS,
  COMMAND_COPY,
  CommandStatusSchema,
  ERROR_COPY,
  EvidenceDocumentSchema,
  pageSchema,
  STATUS_COPY,
  VerificationRequestSchema,
} from "@collara/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { cl001Files, type SyntheticFile } from "../../src/seed/documents";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type ItSession, type LocalnetHarness } from "./harness";

const DAY = 86_400_000;
const ASSET = "ASSET-DEMO-001";
const CommandBody = z.object({ command: CommandStatusSchema, result: z.unknown().optional() });

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet: assets, evidence, verification and sharing through the API", () => {
  let h: LocalnetHarness;
  let owner: ItSession;
  let dealer: ItSession;
  let verifier: ItSession;
  let analyst: ItSession;
  let approver: ItSession;
  let lenderB: ItSession;
  const facts: Record<string, unknown> = {};
  const docs: Record<string, { docRef: string; version: number }> = {};
  let caseId = "";
  let verificationRef = "";
  let ownerShareRef = "";
  let dealerShareRef = "";

  /** A committed command: 200, an update id, `Confirmed on the ledger.` (never simulated). */
  function committed(response: { statusCode: number; body: string; json(): unknown }, label: string) {
    expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
    const body = CommandBody.parse(response.json());
    expect(body.command, label).toMatchObject({ state: "COMMITTED", simulated: false, message: COMMAND_COPY.COMMITTED });
    expect(body.command.updateId, label).toBeTruthy();
    return body;
  }

  async function upload(session: ItSession, file: SyntheticFile, replaces?: string) {
    const intent = await session.inject("POST", "/api/evidence/upload-intents", {
      body: { assetRef: ASSET, caseId, type: file.type, title: file.title, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.bytes.length, ...(replaces ? { replacesDocumentId: replaces } : {}) },
    });
    expect([200, 201], intent.body).toContain(intent.statusCode);
    const { evidenceId, version } = (intent.json() as { result: { evidenceId: string; version: number } }).result;
    const content = await session.inject("PUT", `/api/evidence/${evidenceId}/content`, { body: file.bytes, headers: { "content-type": file.contentType } });
    expect(content.statusCode, content.body).toBe(200);
    const finalize = await session.inject("POST", `/api/evidence/${evidenceId}/finalize`, { body: {} });
    expect(finalize.statusCode, finalize.body).toBe(200);
    return { docRef: evidenceId, version };
  }

  async function expectUnavailable(session: ItSession, method: "GET" | "POST", path: string, body?: unknown) {
    const response = await session.inject(method, path, body === undefined ? {} : { body });
    expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(404);
    const { instance: _instance, ...problem } = response.json() as Record<string, unknown>;
    expect(problem, path).toEqual({ type: "urn:collara:problem:unavailable", title: expect.any(String), status: 404, code: "unavailable", detail: ERROR_COPY.UNAVAILABLE });
    return problem;
  }

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "ep1" });
    facts.prefix = h.prefix;
    const seed = await h.seed("clean-start");
    facts.cleanStartMs = seed.totalMs;
    [owner, dealer, verifier, analyst, approver, lenderB] = await Promise.all([
      h.loginAs("manufacturer-owner"),
      h.loginAs("dealer-contributor"),
      h.loginAs("verifier-inspector"),
      h.loginAs("lender-a-analyst"),
      h.loginAs("lender-a-approver"),
      h.loginAs("lender-b-approver"),
    ]);
  });

  afterAll(async () => {
    console.log(`LocalNet cases IT facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("registers ASSET-DEMO-001 through the registrar service; replay and duplicates do not create a second passport", async () => {
    const body = {
      intent: "REGISTER",
      equipmentClass: "CNC machining center",
      manufacturer: "Demo Machine Works (synthetic)",
      model: "DEMO-CNC-500",
      serialNumber: "SYNTH-CNC-001",
      yearOfManufacture: 2019,
      locationScope: "Demo Manufacturer facility · Ohio, US (declared)",
    };
    const first = committed(await owner.inject("POST", "/api/assets", { body, idempotencyKey: "ep1-register-0001" }), "register");
    expect(first.result).toEqual({ assetRef: ASSET });
    const replay = committed(await owner.inject("POST", "/api/assets", { body, idempotencyKey: "ep1-register-0001" }), "register replay");
    expect(replay.command.commandId).toBe(first.command.commandId);
    expect(replay.command.updateId).toBe(first.command.updateId);
    // Same organisation, same identity, new key: refused before anything is submitted.
    const duplicate = await owner.inject("POST", "/api/assets", { body: { ...body, serialNumber: " synth-cnc-001 " } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ detail: "This equipment is already registered by your organization." });
    // Lender B has no borrower mandate.
    expect((await lenderB.inject("POST", "/api/assets", { body: { ...body, serialNumber: "SYNTH-CNC-099" } })).statusCode).toBe(403);

    const passports = await h.acsAs("borrower", "AssetPassport", (p) => p.assetId === ASSET && p.namespace === h.namespace);
    expect(passports).toHaveLength(1);
    expect(passports[0]!.payload.equipment.serialNumber).toBe("SYNTH-CNC-001");
    const controls = await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET);
    expect(controls.map((c) => c.payload.controlVersion)).toEqual([1]);
    expect(await h.acsAs("lenderB", "AssetControl")).toHaveLength(0);

    await h.project();
    const detail = AssetDetailSchema.parse((await owner.inject("GET", `/api/assets/${ASSET}`)).json());
    expect(detail).toMatchObject({ ref: ASSET, lifecycle: { value: "REGISTERED" }, serialNumber: "SYNTH-CNC-001", model: "DEMO-CNC-500" });
    expect((await lenderB.inject("GET", "/api/assets")).json()).toMatchObject({ items: [] });
    await expectUnavailable(lenderB, "GET", `/api/assets/${ASSET}`);
  });

  it("creates the case (application record) and collects evidence from the owner and the invited dealer", async () => {
    const created = await owner.inject("POST", "/api/cases", {
      body: { title: "Used CNC financing", assetRef: ASSET, selectedLenderOrgId: "demo-lender-a", dealerOrgId: "demo-cnc-dealer", requestedPrincipal: { amount: "100000", currency: "USD" } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = CommandBody.parse(created.json());
    expect(body.command).toMatchObject({ target: "APPLICATION", state: "COMMITTED", simulated: false });
    expect(body.command.updateId).toBeUndefined();
    caseId = (body.result as { caseId: string }).caseId;
    expect(caseId).toBe("CL-001");
    const [row] = await h.db.db.select().from(casesTable).where(eq(casesTable.caseRef, caseId));
    expect(row).toMatchObject({ dealerOrgId: "demo-cnc-dealer", selectedLenderOrgId: "demo-lender-a", requestedPrincipal: "100000.00", requestedCurrency: "USD" });
    const second = await owner.inject("POST", "/api/cases", { body: { title: "Again", assetRef: ASSET, selectedLenderOrgId: "demo-lender-a" } });
    expect(second.statusCode).toBe(409);

    const files = cl001Files();
    docs.invoice = await upload(dealer, files.invoice);
    docs.photos = await upload(owner, files.photos);
    docs.inspection = await upload(owner, files.inspectionV1);
    docs.maintenance = await upload(owner, files.maintenance);
    facts.documents = docs;

    // Before any share the lender does not see the case at all.
    await expectUnavailable(analyst, "GET", `/api/cases/${caseId}`);
  });

  it("requests verification: commits manifest v1 (anchored on the control) and VR (REQUESTED) for the registry verifier", async () => {
    const body = { verifierRegistryRef: "VER-001", scope: ["Serial number consistency", "Equipment photos"], documentIds: Object.values(docs).map((d) => d.docRef), dueAt: new Date(Date.now() + 10 * DAY).toISOString() };
    // Browser-supplied authority is ignored (zod strips unknown fields; headers are not read).
    const response = await owner.inject("POST", `/api/cases/${caseId}/verification-requests`, {
      body: { ...body, actAs: h.party("lenderB"), orgId: "demo-lender-b" },
      headers: { "x-collara-org": "demo-lender-b" },
      idempotencyKey: "ep1-verification-0001",
    });
    const result = committed(response, "verification request");
    verificationRef = (result.result as { verificationRef: string }).verificationRef;
    expect(verificationRef).toBe("VR-001");
    const replay = committed(await owner.inject("POST", `/api/cases/${caseId}/verification-requests`, { body: { ...body, actAs: h.party("lenderB"), orgId: "demo-lender-b" }, idempotencyKey: "ep1-verification-0001" }), "replay");
    expect(replay.command.commandId).toBe(result.command.commandId);

    const manifests = await h.acsAs("borrower", "EvidenceManifest", (m) => m.assetId === ASSET);
    expect(manifests.map((m) => m.payload.version)).toEqual([1]);
    expect(manifests[0]!.payload.entries.map((e) => [e.docRef, e.source === h.party("dealer") ? "dealer" : "owner"])).toEqual([
      [docs.invoice!.docRef, "dealer"],
      [docs.photos!.docRef, "owner"],
      [docs.inspection!.docRef, "owner"],
      [docs.maintenance!.docRef, "owner"],
    ]);
    const [control] = await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET);
    expect(control!.payload.controlVersion).toBe(2);
    expect(control!.payload.evidence).toMatchObject({ packageRef: manifests[0]!.payload.packageRef, manifestVersion: 1 });
    const requests = await h.acsAs("verifier", "VerificationRequest", (r) => r.requestRef === verificationRef);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.payload).toMatchObject({ status: "REQUESTED", caseRef: caseId, owner: h.party("borrower") });
    expect(await h.acsAs("lenderB", "VerificationRequest")).toHaveLength(0);
  });

  it("verifier: invalid transition 409, Lender B 404, then accept and request changes", async () => {
    await h.project();
    const list = pageSchema(VerificationRequestSchema).parse((await verifier.inject("GET", "/api/verifications")).json());
    expect(list.items.map((v) => [v.ref, v.verifierRegistryRef, v.state.value])).toEqual([[verificationRef, "VER-001", "REQUESTED"]]);
    expect(list.items[0]!.allowedActions).toEqual(expect.arrayContaining(["verification.acceptAssignment", "verification.declineAssignment"]));
    const ownerView = VerificationRequestSchema.parse((await owner.inject("GET", `/api/verifications/${verificationRef}`)).json());
    expect(ownerView.verifierRegistryRef).toBe("VER-001");

    const early = await verifier.inject("POST", `/api/verifications/${verificationRef}/attestations`, {
      body: { method: "On-site inspection", inspectedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 180 * DAY).toISOString(), checks: CL001_CHECKS.map((c) => ({ item: c.item, finding: c.finding, result: c.result })), limitations: "Synthetic." },
    });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ code: "state_conflict", detail: COMMAND_COPY.STATE_CHANGED });
    await expectUnavailable(lenderB, "POST", `/api/verifications/${verificationRef}/assignment`, { decision: "ACCEPT" });
    // The owner is related but only the assigned verifier may act.
    expect((await owner.inject("POST", `/api/verifications/${verificationRef}/assignment`, { body: { decision: "ACCEPT" } })).statusCode).toBe(403);

    committed(await verifier.inject("POST", `/api/verifications/${verificationRef}/assignment`, { body: { decision: "ACCEPT" } }), "accept");
    await h.project();
    committed(await verifier.inject("POST", `/api/verifications/${verificationRef}/change-requests`, { body: { message: "Please upload the full scoped inspection report." } }), "changes");
    const [request] = await h.acsAs("verifier", "VerificationRequest", (r) => r.requestRef === verificationRef);
    expect(request!.payload).toMatchObject({ status: "CHANGES_REQUESTED", changeNote: "Please upload the full scoped inspection report." });
  });

  it("owner resubmits a new evidence version (manifest v2, control v3); the verifier issues the attestation", async () => {
    await h.project();
    const nothingNew = await owner.inject("POST", `/api/verifications/${verificationRef}/evidence-submissions`, { body: {} });
    expect(nothingNew.statusCode).toBe(409);
    docs.inspectionV2 = await upload(owner, cl001Files().inspectionV2, docs.inspection!.docRef);
    expect(docs.inspectionV2).toEqual({ docRef: docs.inspection!.docRef, version: 2 });
    committed(await owner.inject("POST", `/api/verifications/${verificationRef}/evidence-submissions`, { body: {} }), "resubmit");
    const manifests = await h.acsAs("borrower", "EvidenceManifest", (m) => m.assetId === ASSET);
    expect(manifests.map((m) => m.payload.version)).toEqual([2]);
    expect(manifests[0]!.payload.entries.find((e) => e.docRef === docs.inspection!.docRef)?.docVersion).toBe(2);
    const [control] = await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET);
    expect(control!.payload.controlVersion).toBe(3);
    const [request] = await h.acsAs("verifier", "VerificationRequest", (r) => r.requestRef === verificationRef);
    expect(request!.payload).toMatchObject({ status: "IN_REVIEW", evidence: { manifestVersion: 2 } });

    await h.project();
    const issued = committed(
      await verifier.inject("POST", `/api/verifications/${verificationRef}/attestations`, {
        body: {
          method: "On-site inspection + document review",
          inspectedAt: new Date(Date.now() - 60_000).toISOString(),
          validUntil: new Date(Date.now() + 180 * DAY).toISOString(),
          checks: CL001_CHECKS.map((c) => ({ item: c.item, finding: c.finding, result: c.result })),
          limitations: "Ownership and lien status were reviewed from submitted documents only.",
        },
      }),
      "attest",
    );
    expect(issued.result).toEqual({ attestationRef: "ATT-001" });
    const attestations = await h.acsAs("borrower", "VerificationAttestation", (a) => a.assetId === ASSET);
    expect(attestations.map((a) => [a.payload.attestationRef, a.payload.verifierRef, a.payload.evidence.manifestVersion])).toEqual([["ATT-001", "VER-001", 2]]);

    await h.project();
    const attestation = AttestationSchema.parse((await owner.inject("GET", "/api/attestations/ATT-001")).json());
    expect(attestation).toMatchObject({ ref: "ATT-001", verificationRef, validity: { value: "VALID" }, evidencePackage: { version: 2 } });
    await expectUnavailable(lenderB, "GET", "/api/attestations/ATT-001");
    await expectUnavailable(analyst, "GET", "/api/attestations/ATT-001");
  });

  it("shares with the selected lender: dealer request + owner share + control view + disclosure, one correlation id", async () => {
    await h.project();
    // Only the selected lender can receive the package; the analyst (related later, not now) cannot share.
    const wrong = await owner.inject("POST", `/api/cases/${caseId}/sharing`, { body: { recipientOrgId: "demo-lender-b", permission: "VIEW_DOWNLOAD" } });
    expect(wrong.statusCode).toBe(400);
    await expectUnavailable(lenderB, "POST", `/api/cases/${caseId}/sharing`, { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" });

    const share = committed(await owner.inject("POST", `/api/cases/${caseId}/sharing`, { body: { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" }, idempotencyKey: "ep1-share-0001" }), "share");
    ownerShareRef = (share.result as { grantId: string }).grantId;
    const parent = await h.command(share.command.commandId);
    const steps = (parent?.result as { steps: { step: string; state: string; updateId: string | null }[] }).steps;
    expect(steps.map((s) => s.step)).toEqual(["dealer-request-1", "share", "control", "disclose"]);
    expect(steps.every((s) => s.state === "COMMITTED" && s.updateId)).toBe(true);
    expect(new Set(steps.map((s) => s.updateId)).size).toBe(4);
    facts.shareSteps = steps;
    const again = await owner.inject("POST", `/api/cases/${caseId}/sharing`, { body: { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" } });
    expect(again.statusCode).toBe(409);

    const lenderA = h.party("lenderA");
    const [control] = await h.acsAs("lenderA", "AssetControl", (c) => c.assetId === ASSET);
    expect(control!.payload).toMatchObject({ sharedLender: lenderA, controlVersion: 3 });
    const lenderShares = await h.acsAs("lenderA", "PackageShare", (s) => s.caseRef === caseId);
    expect(lenderShares.map((s) => [s.payload.shareRef, s.payload.consenters.length, s.payload.documents.length])).toEqual([[ownerShareRef, 0, 3]]);
    const proposals = await h.acsAs("dealer", "PackageShareProposal", (p) => p.caseRef === caseId);
    expect(proposals).toHaveLength(1);
    dealerShareRef = proposals[0]!.payload.shareRef;
    // The dealer's request lists only the dealer's own document.
    expect(proposals[0]!.payload.documents.map((d) => d.docRef)).toEqual([docs.invoice!.docRef]);
    expect(await h.acsAs("lenderA", "AttestationDisclosure", (d) => d.caseRef === caseId)).toHaveLength(1);
    for (const template of ["AssetControl", "PackageShare", "AttestationDisclosure", "CollateralAssessment"] as const) {
      expect(await h.acsAs("lenderB", template), template).toHaveLength(0);
    }
    // Not created by the owner's share: the lender opens its own review.
    expect(await h.acsAs("lenderA", "CollateralAssessment")).toHaveLength(0);
  });

  it("the lender's first open of the case creates its CollateralAssessment (SUBMITTED) under its own authority, once", async () => {
    await h.project();
    const first = await analyst.inject("GET", `/api/cases/${caseId}`);
    expect(first.statusCode, first.body).toBe(200);
    const detail = CaseDetailSchema.parse(first.json());
    expect(detail.review?.value).toBe("SUBMITTED");
    expect(detail.requestedPrincipal).toEqual({ amount: "100000.00", currency: "USD" });
    await Promise.all([analyst.inject("GET", `/api/cases/${caseId}`), approver.inject("GET", `/api/cases/${caseId}`)]);
    const assessments = await h.acsAs("lenderA", "CollateralAssessment", (a) => a.caseRef === caseId);
    expect(assessments).toHaveLength(1);
    expect(assessments[0]!.payload).toMatchObject({ status: "SUBMITTED", version: 1, borrower: h.party("borrower"), lender: h.party("lenderA"), snapshot: { attestationRef: "ATT-001", evidence: { manifestVersion: 2 } } });
    expect(assessments[0]!.signatories).toEqual([h.party("lenderA")]);
    expect(await h.acsAs("verifier", "CollateralAssessment")).toHaveLength(0);
    facts.assessmentRef = assessments[0]!.payload.assessmentRef;
  });

  it("the invited dealer consents to sharing its own record (DealerContribution + Consent_Grant)", async () => {
    await h.project();
    // The verifier has no say in sharing.
    expect((await verifier.inject("POST", `/api/cases/${caseId}/sharing`, { body: { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" } })).statusCode).toBe(403);
    const consent = committed(await dealer.inject("POST", `/api/cases/${caseId}/sharing`, { body: { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" } }), "consent");
    expect(consent.result).toEqual({ grantId: dealerShareRef });
    const contributions = await h.acsAs("dealer", "DealerContribution", (c) => c.caseRef === caseId);
    expect(contributions.map((c) => [c.payload.docRef, c.payload.docType])).toEqual([[docs.invoice!.docRef, "INVOICE"]]);
    const shares = await h.acsAs("lenderA", "PackageShare", (s) => s.caseRef === caseId);
    expect(shares.map((s) => [s.payload.shareRef, s.payload.consenters]).sort()).toEqual(
      [
        [ownerShareRef, []],
        [dealerShareRef, [h.party("dealer")]],
      ].sort(),
    );
    expect(await h.acsAs("dealer", "PackageShareProposal", (p) => p.caseRef === caseId)).toHaveLength(0);
  });

  it("serves shared evidence to the lender (fresh share check at download), never to Lender B or the dealer", async () => {
    await h.project();
    const lenderDocs = z.array(EvidenceDocumentSchema).parse((await analyst.inject("GET", `/api/cases/${caseId}/evidence`)).json());
    expect(lenderDocs.map((d) => [d.id, d.version]).sort()).toEqual(
      [
        [docs.invoice!.docRef, 1],
        [docs.photos!.docRef, 1],
        [docs.inspection!.docRef, 2],
        [docs.maintenance!.docRef, 1],
      ].sort(),
    );
    const meta = EvidenceDocumentSchema.parse((await analyst.inject("GET", `/api/evidence/${docs.photos!.docRef}`)).json());
    expect(meta).toMatchObject({ id: docs.photos!.docRef, canDownload: true });
    const download = await analyst.inject("GET", `/api/evidence/${docs.photos!.docRef}/download`);
    expect(download.statusCode, download.body).toBe(200);
    expect((download.json() as { url: string }).url).toMatch(/^https?:\/\//);
    // The lender only ever sees the shared version of the inspection report (v2), not v1.
    expect((await analyst.inject("GET", `/api/evidence/${docs.inspection!.docRef}/download?version=1`)).statusCode).toBe(403);

    const unknown = await expectUnavailable(lenderB, "GET", "/api/evidence/DOC-999");
    for (const path of [`/api/evidence/${docs.photos!.docRef}`, `/api/evidence/${docs.photos!.docRef}/download`, `/api/cases/${caseId}`, `/api/cases/${caseId}/evidence`, `/api/verifications/${verificationRef}`, `/api/access-grants?caseId=${caseId}`]) {
      expect(await expectUnavailable(lenderB, "GET", path)).toEqual(unknown);
    }
    // The dealer sees its own contribution, never the owner's documents or the terms.
    await expectUnavailable(dealer, "GET", `/api/evidence/${docs.photos!.docRef}/download`);
    const dealerCase = await dealer.inject("GET", `/api/cases/${caseId}`);
    expect(dealerCase.statusCode).toBe(200);
    expect(dealerCase.body).not.toContain("100000");
    expect(CaseDetailSchema.parse(dealerCase.json()).requestedPrincipal).toBeNull();
    const verifierCase = await verifier.inject("GET", `/api/cases/${caseId}`);
    expect(verifierCase.statusCode).toBe(200);
    expect(verifierCase.body).not.toContain("100000");
  });

  it("lists and revokes access: owner revokes its share; the lender's later download gets the revocation copy", async () => {
    const grants = pageSchema(AccessGrantSchema).parse((await owner.inject("GET", `/api/access-grants?caseId=${caseId}`)).json());
    expect(grants.items.filter((g) => g.kind === "PACKAGE_SHARE").map((g) => [g.id, g.state.value, g.canRevoke]).sort()).toEqual(
      [
        [ownerShareRef, "GRANTED", true],
        [dealerShareRef, "GRANTED", true],
      ].sort(),
    );
    // Approver-only (lender records): the analyst may not grant audit access.
    const auditByAnalyst = await analyst.inject("POST", "/api/access-grants", {
      body: { caseId, auditorOrgId: "demo-auditor", scopes: ["DECISION_OUTCOME"], permission: "VIEW", purpose: "Synthetic audit", expiresAt: new Date(Date.now() + 30 * DAY).toISOString() },
    });
    expect(auditByAnalyst.statusCode).toBe(403);
    await expectUnavailable(lenderB, "POST", `/api/access-grants/${ownerShareRef}/revoke`, {});
    // The lender cannot revoke the owner's grant (it sees it, it is not the record owner).
    expect((await analyst.inject("POST", `/api/access-grants/${ownerShareRef}/revoke`, { body: {} })).statusCode).toBe(403);

    committed(await owner.inject("POST", `/api/access-grants/${ownerShareRef}/revoke`, { body: {}, idempotencyKey: "ep1-revoke-0001" }), "revoke");
    expect((await h.acsAs("lenderA", "PackageShare", (s) => s.shareRef === ownerShareRef))).toHaveLength(0);
    const replay = committed(await owner.inject("POST", `/api/access-grants/${ownerShareRef}/revoke`, { body: {}, idempotencyKey: "ep1-revoke-0001" }), "revoke replay");
    expect(replay.command.state).toBe("COMMITTED");

    await h.project();
    const revoked = await analyst.inject("GET", `/api/evidence/${docs.photos!.docRef}/download`);
    expect(revoked.statusCode).toBe(409);
    expect(revoked.json()).toMatchObject({ code: "state_conflict", detail: STATUS_COPY.ACCESS_REVOKED });
    // The dealer's consented share is untouched.
    expect((await analyst.inject("GET", `/api/evidence/${docs.invoice!.docRef}/download`)).statusCode).toBe(200);
    const after = pageSchema(AccessGrantSchema).parse((await owner.inject("GET", `/api/access-grants?caseId=${caseId}`)).json());
    expect(after.items.find((g) => g.id === ownerShareRef)?.state.value).toBe("REVOKED");
    const again = await owner.inject("POST", `/api/access-grants/${ownerShareRef}/revoke`, { body: {} });
    expect(again.statusCode).toBe(409);
  });
});
