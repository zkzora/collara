// LocalNet IT (LOCALNET_IT=1): the assigned verifier receives exactly the evidence it is assigned (daml-model.md
// §4.6 "Verification evidence grants"), on the MAIN seed world (CL-001, PKG-001 v2, ATT-001 shared with Demo Lender
// A, documents in S3 storage when COLLARA_S3_* is configured) on a fresh "vev-<unique>" prefix:
//   1. the owner requests verification of CL-001 selecting 2 of the 5 documents → one correlated sequence
//      (manifest, request, grant): an owner-signed VERIFICATION PackageShare for the verifier only, exact versions;
//   2. the verifier lists and downloads exactly those 2 (bytes match the SHA-256), and gets 404 for an unselected
//      document and 403 for an ungranted version; dealer, Lender B and the auditor are refused;
//   3. change request → the owner uploads a new version and resubmits (adding the dealer's invoice): a new grant for
//      the new versions, the superseded grant revoked (old version 403, new version 200), the invoice withheld
//      until the dealer's own Consent_Grant (POST /cases/:id/verification-consent);
//   4. the attestation references the reviewed evidence version and the granted document versions; access ends.
import { createHash } from "node:crypto";
import { evidenceDocuments } from "@collara/db";
import {
  AttestationSchema,
  CL001_CHECKS,
  COMMAND_COPY,
  CommandStatusSchema,
  EvidenceDocumentSchema,
  VERIFICATION_GRANT_PURPOSE,
  VerificationRequestSchema,
} from "@collara/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { syntheticPdf } from "../../src/seed/documents";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type ItSession, type LedgerRole, type LocalnetHarness } from "./harness";

const DAY = 86_400_000;
const CASE = "CL-001";
const ASSET = "ASSET-DEMO-001";
const CommandBody = z.object({ command: CommandStatusSchema, result: z.unknown().optional() });
const Steps = z.object({ steps: z.array(z.object({ step: z.string(), state: z.string(), updateId: z.string().nullable() })) });

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet: the assigned verifier receives exactly its assigned evidence", () => {
  let h: LocalnetHarness;
  let owner: ItSession;
  let dealer: ItSession;
  let verifier: ItSession;
  let lenderB: ItSession;
  let auditor: ItSession;
  const facts: Record<string, unknown> = {};
  const doc: Record<"invoice" | "photos" | "inspection" | "maintenance" | "agreement", string> = { invoice: "", photos: "", inspection: "", maintenance: "", agreement: "" };
  let verificationRef = "";
  let firstGrantRef = "";
  let dueAt = "";

  function committed(response: { statusCode: number; body: string; json(): unknown }, label: string) {
    expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
    const body = CommandBody.parse(response.json());
    expect(body.command, label).toMatchObject({ state: "COMMITTED", simulated: false, message: COMMAND_COPY.COMMITTED });
    expect(body.command.updateId, label).toBeTruthy();
    return body;
  }

  async function stepsOf(commandId: string): Promise<string[]> {
    const parent = await h.command(commandId);
    return Steps.parse(parent?.result).steps.map((s) => s.step);
  }

  async function storedSha(docRef: string, version: number): Promise<string> {
    const [row] = await h.db.db
      .select({ sha256: evidenceDocuments.sha256 })
      .from(evidenceDocuments)
      .where(and(eq(evidenceDocuments.docRef, docRef), eq(evidenceDocuments.version, version)));
    return row?.sha256 ?? "";
  }

  /** Downloads through the API's short-lived link; returns the SHA-256 of the bytes served by the object store. */
  async function download(session: ItSession, docRef: string, version?: number): Promise<{ status: number; sha256?: string }> {
    const response = await session.inject("GET", `/api/evidence/${docRef}/download${version ? `?version=${version}` : ""}`);
    if (response.statusCode !== 200) return { status: response.statusCode };
    const { url } = z.object({ url: z.string() }).parse(response.json());
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    return { status: 200, sha256: createHash("sha256").update(bytes).digest("hex") };
  }

  const verificationGrants = (role: LedgerRole) => h.acsAs(role, "PackageShare", (s) => s.purpose === VERIFICATION_GRANT_PURPOSE);

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "vev" });
    facts.prefix = h.prefix;
    facts.storage = h.config.COLLARA_S3_ENDPOINT ? "s3" : "memory";
    const seed = await h.seed("main");
    const byFile = (fileName: string) => seed.documents.find((d) => d.fileName === fileName)?.docRef ?? "";
    doc.invoice = byFile("dealer-invoice.pdf");
    doc.photos = byFile("equipment-photos.png");
    doc.inspection = byFile("inspection-report-v1.pdf");
    doc.maintenance = byFile("maintenance-summary.pdf");
    doc.agreement = byFile("purchase-agreement.pdf");
    facts.documents = doc;
    await h.project();
    [owner, dealer, verifier, lenderB, auditor] = await Promise.all([
      h.loginAs("manufacturer-owner"),
      h.loginAs("dealer-contributor"),
      h.loginAs("verifier-inspector"),
      h.loginAs("lender-b-approver"),
      h.loginAs("auditor"),
    ]);
  });

  afterAll(async () => {
    console.log(`LocalNet verifier evidence IT facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("requests verification with 2 of 5 documents: request + VERIFICATION grant for the verifier only, in one sequence", async () => {
    expect(Object.values(doc).every((ref) => /^DOC-\d+$/.test(ref))).toBe(true);
    dueAt = new Date(Date.now() + 10 * DAY).toISOString();
    const body = { verifierRegistryRef: "VER-001", scope: ["Photos", "Inspected condition"], documentIds: [doc.photos, doc.inspection], dueAt };
    // A selection with an unknown document is refused before anything is submitted.
    expect((await owner.inject("POST", `/api/cases/${CASE}/verification-requests`, { body: { ...body, documentIds: [doc.photos, "DOC-999"] } })).statusCode).toBe(400);

    const response = committed(await owner.inject("POST", `/api/cases/${CASE}/verification-requests`, { body, idempotencyKey: "vev-request-0001" }), "request");
    verificationRef = (response.result as { verificationRef: string }).verificationRef;
    expect(verificationRef).toBe("VR-002");
    // Same correlation id: manifest v3 (the purchase agreement was not committed yet), the request, the grant.
    expect(await stepsOf(response.command.commandId)).toEqual(["manifest", "request", "grant"]);
    const replay = committed(await owner.inject("POST", `/api/cases/${CASE}/verification-requests`, { body, idempotencyKey: "vev-request-0001" }), "replay");
    expect(replay.command.commandId).toBe(response.command.commandId);

    const [request] = await h.acsAs("verifier", "VerificationRequest", (r) => r.requestRef === verificationRef);
    expect(request?.payload.evidence.manifestVersion).toBe(3);
    const grants = await verificationGrants("verifier");
    expect(grants).toHaveLength(1);
    const grant = grants[0]!.payload;
    firstGrantRef = grant.shareRef;
    expect(grant).toMatchObject({
      shareRef: "VR-002-G3",
      owner: h.party("borrower"),
      recipient: h.party("verifier"),
      consenters: [],
      caseRef: CASE,
      permission: "VIEW_DOWNLOAD",
      evidence: request!.payload.evidence,
    });
    expect(Date.parse(grant.expiresAt)).toBe(Date.parse(dueAt));
    expect(grant.documents.map((d) => [d.docRef, d.docVersion])).toEqual([
      [doc.photos, 1],
      [doc.inspection, 2],
    ]);
    for (const d of grant.documents) expect(d.sha256).toBe(await storedSha(d.docRef, d.docVersion));
    for (const role of ["lenderA", "lenderB", "dealer", "auditor"] as const) expect(await verificationGrants(role), role).toHaveLength(0);
    // Not a lender share: the owner's access list shows it only as the verification scope.
    expect((await h.acsAs("lenderA", "PackageShare")).every((s) => s.payload.purpose !== VERIFICATION_GRANT_PURPOSE)).toBe(true);
  });

  it("the verifier lists and downloads exactly the 2 documents (checksums match); 404 unselected, 403 ungranted version", async () => {
    await h.project();
    const vr = VerificationRequestSchema.parse((await verifier.inject("GET", `/api/verifications/${verificationRef}`)).json());
    expect(vr.documentIds).toEqual([doc.photos, doc.inspection].sort());
    expect(vr.assignedVersions).toEqual([
      { documentId: doc.photos, version: 1 },
      { documentId: doc.inspection, version: 2 },
    ]);
    expect(vr.evidencePackage.version).toBe(3);
    const listed = z.array(EvidenceDocumentSchema).parse((await verifier.inject("GET", `/api/assets/${ASSET}/evidence`)).json());
    expect(listed.map((d) => [d.id, d.version, d.canDownload])).toEqual([
      [doc.photos, 1, true],
      [doc.inspection, 2, true],
    ]);
    expect(listed.find((d) => d.id === doc.inspection)?.versions.map((v) => v.version)).toEqual([2]);
    expect(JSON.stringify(listed)).not.toContain(doc.maintenance);

    for (const [ref, version] of [
      [doc.photos, 1],
      [doc.inspection, 2],
    ] as const) {
      const got = await download(verifier, ref);
      expect(got.status, ref).toBe(200);
      expect(got.sha256, ref).toBe(await storedSha(ref, version));
    }
    facts.downloadedChecksumsMatch = true;
    for (const ref of [doc.maintenance, doc.agreement, doc.invoice]) {
      expect((await download(verifier, ref)).status, ref).toBe(404);
      expect((await verifier.inject("GET", `/api/evidence/${ref}`)).statusCode, ref).toBe(404);
    }
    expect((await download(verifier, doc.inspection, 1)).status).toBe(403);
  });

  it("refuses the dealer (owner documents), Lender B and the auditor", async () => {
    for (const session of [dealer, lenderB, auditor]) {
      for (const ref of [doc.photos, doc.inspection]) {
        expect((await download(session, ref)).status, `${session.personaId} ${ref}`).toBe(404);
        expect((await session.inject("GET", `/api/evidence/${ref}`)).statusCode, `${session.personaId} ${ref}`).toBe(404);
      }
      expect((await session.inject("GET", `/api/verifications/${verificationRef}`)).statusCode, session.personaId).toBe(404);
    }
  });

  it("resubmission: a new grant for the new versions, the superseded grant revoked, the dealer's invoice only after its consent", async () => {
    committed(await verifier.inject("POST", `/api/verifications/${verificationRef}/assignment`, { body: { decision: "ACCEPT" } }), "accept");
    await h.project();
    committed(await verifier.inject("POST", `/api/verifications/${verificationRef}/change-requests`, { body: { message: "Please add the spindle photos to the inspection report." } }), "changes");
    await h.project();

    // Inspection report v3 (synthetic bytes), uploaded by the owner.
    const bytes = syntheticPdf("Scoped inspection report v3 (synthetic)", ["Asset ASSET-DEMO-001", "Spindle photos added (synthetic)."]);
    const intent = await owner.inject("POST", "/api/evidence/upload-intents", {
      body: { assetRef: ASSET, caseId: CASE, type: "INSPECTION_REPORT", title: "Inspection report", fileName: "inspection-report-v3.pdf", contentType: "application/pdf", sizeBytes: bytes.length, replacesDocumentId: doc.inspection },
    });
    expect([200, 201], intent.body).toContain(intent.statusCode);
    const { evidenceId, version } = (intent.json() as { result: { evidenceId: string; version: number } }).result;
    expect([evidenceId, version]).toEqual([doc.inspection, 3]);
    expect((await owner.inject("PUT", `/api/evidence/${evidenceId}/content`, { body: bytes, headers: { "content-type": "application/pdf" } })).statusCode).toBe(200);
    expect((await owner.inject("POST", `/api/evidence/${evidenceId}/finalize`, { body: {} })).statusCode).toBe(200);
    // Not resubmitted yet: the verifier keeps v2 only.
    expect((await download(verifier, doc.inspection, 3)).status).toBe(403);

    const response = committed(
      await owner.inject("POST", `/api/verifications/${verificationRef}/evidence-submissions`, { body: { documentIds: [doc.photos, doc.inspection, doc.invoice] } }),
      "resubmit",
    );
    expect(await stepsOf(response.command.commandId)).toEqual(["manifest", "submit", "grant", "dealer-grant-1", `revoke-${firstGrantRef.toLowerCase()}`]);
    const [request] = await h.acsAs("verifier", "VerificationRequest", (r) => r.requestRef === verificationRef);
    expect(request?.payload).toMatchObject({ status: "IN_REVIEW", evidence: { manifestVersion: 4 } });
    const grants = await verificationGrants("verifier");
    expect(grants.map((g) => [g.payload.shareRef, g.payload.evidence.manifestVersion, g.payload.documents.map((d) => `${d.docRef}#${d.docVersion}`)])).toEqual([
      ["VR-002-G4", 4, [`${doc.photos}#1`, `${doc.inspection}#3`]],
    ]);
    // The dealer's invoice is requested from the dealer (its own document only), not granted.
    const proposals = await h.acsAs("dealer", "PackageShareProposal", (p) => p.purpose === VERIFICATION_GRANT_PURPOSE);
    expect(proposals.map((p) => [p.payload.shareRef, p.payload.recipient, p.payload.documents.map((d) => d.docRef)])).toEqual([["VR-002-G4-D1", h.party("verifier"), [doc.invoice]]]);

    await h.project();
    const vr = VerificationRequestSchema.parse((await verifier.inject("GET", `/api/verifications/${verificationRef}`)).json());
    expect(vr.assignedVersions).toEqual([
      { documentId: doc.photos, version: 1 },
      { documentId: doc.inspection, version: 3 },
    ]);
    const newest = await download(verifier, doc.inspection);
    expect(newest).toEqual({ status: 200, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect((await download(verifier, doc.inspection, 2)).status).toBe(403);
    expect((await download(verifier, doc.invoice)).status).toBe(404);

    // The dealer's consent path: only the invited dealer; Lender B 404, the verifier (related, not the dealer) 403.
    expect((await lenderB.inject("POST", `/api/cases/${CASE}/verification-consent`, { body: {} })).statusCode).toBe(404);
    expect((await verifier.inject("POST", `/api/cases/${CASE}/verification-consent`, { body: {} })).statusCode).toBe(403);
    const consent = committed(await dealer.inject("POST", `/api/cases/${CASE}/verification-consent`, { body: {} }), "dealer consent");
    expect(consent.result).toEqual({ grantIds: ["VR-002-G4-D1"] });
    expect((await dealer.inject("POST", `/api/cases/${CASE}/verification-consent`, { body: {} })).statusCode).toBe(409);
    const consented = (await verificationGrants("verifier")).find((g) => g.payload.shareRef === "VR-002-G4-D1");
    expect(consented?.payload.consenters).toEqual([h.party("dealer")]);

    await h.project();
    const afterConsent = VerificationRequestSchema.parse((await verifier.inject("GET", `/api/verifications/${verificationRef}`)).json());
    expect(afterConsent.documentIds).toEqual([doc.invoice, doc.photos, doc.inspection].sort());
    const invoice = await download(verifier, doc.invoice);
    expect(invoice).toEqual({ status: 200, sha256: await storedSha(doc.invoice, 1) });
  });

  it("the attestation references the reviewed evidence version and the granted versions; access then ends", async () => {
    const issued = committed(
      await verifier.inject("POST", `/api/verifications/${verificationRef}/attestations`, {
        body: {
          method: "Document review",
          inspectedAt: new Date(Date.now() - 60_000).toISOString(),
          validUntil: new Date(Date.now() + 90 * DAY).toISOString(),
          checks: CL001_CHECKS.slice(0, 2).map((c) => ({ item: c.item, finding: c.finding, result: c.result })),
          limitations: "Synthetic document review only.",
        },
      }),
      "attest",
    );
    const attestationRef = (issued.result as { attestationRef: string }).attestationRef;
    expect(attestationRef).toBe("ATT-002");
    const [onLedger] = await h.acsAs("verifier", "VerificationAttestation", (a) => a.attestationRef === attestationRef);
    expect(onLedger?.payload.evidence.manifestVersion).toBe(4);

    await h.project();
    const reviewed = [
      [doc.invoice, 1],
      [doc.photos, 1],
      [doc.inspection, 3],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const session of [verifier, owner]) {
      const attestation = AttestationSchema.parse((await session.inject("GET", `/api/attestations/${attestationRef}`)).json());
      expect(attestation.evidencePackage, session.personaId).toEqual({ ref: "PKG-001", version: 4 });
      expect(attestation.supportingVersions.map((v) => [v.documentId, v.version]), session.personaId).toEqual(reviewed);
      const vr = VerificationRequestSchema.parse((await session.inject("GET", `/api/verifications/${verificationRef}`)).json());
      expect(vr.state.value, session.personaId).toBe("ATTESTED");
      expect(vr.attestation?.supportingVersions.map((v) => [v.documentId, v.version]), session.personaId).toEqual(reviewed);
    }
    facts.attestation = { ref: attestationRef, package: "PKG-001 v4", reviewed };
    // The grant lasts until the attestation is issued: the request is closed, downloads stop (metadata stays).
    expect((await download(verifier, doc.photos)).status).toBe(403);
    for (const session of [dealer, lenderB, auditor]) expect((await download(session, doc.inspection)).status, session.personaId).toBe(404);
  });
});
