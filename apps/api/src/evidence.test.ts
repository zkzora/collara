import { createHash } from "node:crypto";
import { cases, evidenceDocuments } from "@collara/db";
import { ApiProblemSchema, commandResultSchema, ERROR_COPY, EvidenceDocumentSchema, EvidenceDownloadSchema, UploadIntentSchema } from "@collara/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idem, loginAs, testApp, type TestApp } from "./test-support";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("synthetic evidence for ASSET-DEMO-001\n%%EOF\n")]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const IntentResult = commandResultSchema(UploadIntentSchema);
const DocumentResult = commandResultSchema(EvidenceDocumentSchema);

describe("evidence pipeline", () => {
  let t: TestApp;
  let owner: string;
  let dealer: string;
  let lenderB: string;

  beforeAll(async () => {
    t = await testApp();
    await t.db.db.insert(cases).values({
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
    owner = await loginAs(t.app, "manufacturer-owner");
    dealer = await loginAs(t.app, "dealer-contributor");
    lenderB = await loginAs(t.app, "lender-b-approver");
  });

  afterAll(async () => {
    await t.close();
  });

  function intent(cookie: string, key: string, body: Record<string, unknown> = {}) {
    return t.app.inject({
      method: "POST",
      url: "/api/evidence/upload-intents",
      headers: { cookie, ...idem(key) },
      payload: { assetRef: "ASSET-DEMO-001", caseId: "CL-001", type: "INSPECTION_REPORT", title: "Inspection report", fileName: "inspection.pdf", contentType: "application/pdf", sizeBytes: PDF.length, ...body },
    });
  }

  function upload(cookie: string, id: string, key: string, payload: Buffer, contentType = "application/pdf") {
    return t.app.inject({ method: "PUT", url: `/api/evidence/${id}/content`, headers: { cookie, "content-type": contentType, ...idem(key) }, payload });
  }

  function finalize(cookie: string, id: string, key: string) {
    return t.app.inject({ method: "POST", url: `/api/evidence/${id}/finalize`, headers: { cookie, ...idem(key) }, payload: {} });
  }

  it("uploads, hashes, validates and promotes a PDF; replays are idempotent", async () => {
    const created = await intent(owner, "intent-0001");
    expect(created.statusCode).toBe(201);
    const { command, result } = IntentResult.parse(created.json());
    expect(command).toMatchObject({ target: "APPLICATION", state: "COMMITTED", simulated: false });
    expect(command.updateId).toBeUndefined();
    expect(command.message).not.toBe("Confirmed on the ledger.");
    expect(result).toMatchObject({ evidenceId: expect.stringMatching(/^DOC-\d{3}$/), version: 1, maxBytes: 20 * 1024 * 1024 });
    expect(result.uploadPath).toBe(`/api/evidence/${result.evidenceId}/content`);

    const replay = await intent(owner, "intent-0001");
    expect(replay.statusCode).toBe(200);
    expect(IntentResult.parse(replay.json()).result.evidenceId).toBe(result.evidenceId);
    expect(await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, result.evidenceId))).toHaveLength(1);

    const uploaded = await upload(owner, result.evidenceId, "content-0001", PDF);
    expect(uploaded.statusCode).toBe(200);
    const quarantined = DocumentResult.parse(uploaded.json()).result;
    expect(quarantined.status.value).toBe("QUARANTINED");
    expect(quarantined.canDownload).toBe(false);
    expect([...t.storage.objects.keys()].some((key) => key.startsWith(`quarantine/${result.evidenceId}/v1/`))).toBe(true);

    const done = await finalize(owner, result.evidenceId, "final-0001");
    expect(done.statusCode).toBe(200);
    const available = DocumentResult.parse(done.json()).result;
    const sha256 = createHash("sha256").update(PDF).digest("hex");
    expect(available).toMatchObject({
      id: result.evidenceId,
      status: { value: "AVAILABLE" },
      scanStatus: { value: "NOT_SCANNED", label: "Not scanned" },
      integrity: { algorithm: "SHA-256", hash: sha256, state: { value: "VERIFIED" } },
      ledger: { value: "UNCOMMITTED" },
      mediaSummary: "PDF",
      source: { id: "demo-manufacturer", name: "Demo Manufacturer" },
      canDownload: true,
    });
    const keys = [...t.storage.objects.keys()];
    expect(keys).toContain(`evidence/${result.evidenceId}/v1/${sha256}`);
    expect(keys.some((key) => key.startsWith(`quarantine/${result.evidenceId}/`))).toBe(false);

    const again = await finalize(owner, result.evidenceId, "final-0001");
    expect(again.statusCode).toBe(200);
    expect(DocumentResult.parse(again.json()).command.commandId).toBe(DocumentResult.parse(done.json()).command.commandId);

    const download = await t.app.inject({ method: "GET", url: `/api/evidence/${result.evidenceId}/download`, headers: { cookie: owner } });
    expect(download.statusCode).toBe(200);
    const link = EvidenceDownloadSchema.parse(download.json());
    expect(link.url).toContain(encodeURIComponent(`evidence/${result.evidenceId}/v1/${sha256}`));
    const ttl = Date.parse(link.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it("returns 404-shaped problems to unrelated organizations", async () => {
    const created = IntentResult.parse((await intent(owner, "intent-0002")).json()).result;
    await upload(owner, created.evidenceId, "content-0002", PDF);
    await finalize(owner, created.evidenceId, "final-0002");

    for (const request of [
      { method: "GET" as const, url: `/api/evidence/${created.evidenceId}/download` },
      { method: "GET" as const, url: `/api/evidence/${created.evidenceId}` },
      { method: "GET" as const, url: "/api/evidence/DOC-999/download" },
    ]) {
      const res = await t.app.inject({ ...request, headers: { cookie: lenderB } });
      expect(res.statusCode).toBe(404);
      expect(ApiProblemSchema.parse(res.json())).toMatchObject({ code: "unavailable", detail: ERROR_COPY.UNAVAILABLE });
    }
    // Lender B cannot create intents for the asset either (unrelated → 404, not 403).
    const denied = await intent(lenderB, "intent-0003");
    expect(denied.statusCode).toBe(404);
    // Nor upload into someone else's pending document.
    const pending = IntentResult.parse((await intent(owner, "intent-0004")).json()).result;
    expect((await upload(lenderB, pending.evidenceId, "content-0004", PDF)).statusCode).toBe(404);
  });

  it("lets the invited dealer contribute and read its own contribution, owned by the borrower", async () => {
    const created = await intent(dealer, "intent-0010", { type: "DEALER_INVOICE", title: "Dealer invoice", fileName: "invoice.pdf", ownerOrgId: "demo-dealer-hack" });
    expect(created.statusCode).toBe(201);
    const { evidenceId } = IntentResult.parse(created.json()).result;
    const [row] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, evidenceId));
    // The browser-supplied ownerOrgId is ignored: the owner comes from the asset's case.
    expect(row).toMatchObject({ ownerOrgId: "demo-manufacturer", contributorOrgId: "demo-cnc-dealer" });
    await upload(dealer, evidenceId, "content-0010", PDF);
    expect((await finalize(dealer, evidenceId, "final-0010")).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: `/api/evidence/${evidenceId}/download`, headers: { cookie: dealer } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: `/api/evidence/${evidenceId}/download`, headers: { cookie: owner } })).statusCode).toBe(200);
  });

  it("rejects content whose magic bytes do not match the declared type", async () => {
    const { evidenceId } = IntentResult.parse((await intent(owner, "intent-0020")).json()).result;
    const res = await upload(owner, evidenceId, "content-0020", PNG);
    expect(res.statusCode).toBe(400);
    expect(ApiProblemSchema.parse(res.json())).toMatchObject({ code: "validation_error", detail: "The file content does not match its declared type." });
    const [row] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, evidenceId));
    expect(row?.status).toBe("REJECTED");
    // Replaying the same request returns the same outcome.
    expect((await upload(owner, evidenceId, "content-0020", PNG)).statusCode).toBe(400);

    const header = IntentResult.parse((await intent(owner, "intent-0021")).json()).result;
    const wrongHeader = await upload(owner, header.evidenceId, "content-0021", PDF, "image/png");
    expect(ApiProblemSchema.parse(wrongHeader.json()).detail).toBe("The file type does not match the upload request.");
  });

  it("enforces the 20 MB cap while streaming", async () => {
    const tooLargeIntent = await intent(owner, "intent-0030", { sizeBytes: 21 * 1024 * 1024 });
    expect(tooLargeIntent.statusCode).toBe(400);

    const { evidenceId } = IntentResult.parse((await intent(owner, "intent-0031")).json()).result;
    const big = Buffer.alloc(20 * 1024 * 1024 + 1, 0x20);
    PDF.copy(big);
    const res = await upload(owner, evidenceId, "content-0031", big);
    expect(res.statusCode).toBe(413);
    expect(ApiProblemSchema.parse(res.json())).toMatchObject({ code: "validation_error", detail: "Files are limited to 20 MB." });
    const [row] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, evidenceId));
    expect(row?.status).toBe("REJECTED");
    expect([...t.storage.objects.keys()].some((key) => key.includes(`/${evidenceId}/`))).toBe(false);
  });

  it("marks HASH_MISMATCH when the quarantined bytes changed before finalize", async () => {
    const { evidenceId } = IntentResult.parse((await intent(owner, "intent-0040")).json()).result;
    await upload(owner, evidenceId, "content-0040", PDF);
    const key = [...t.storage.objects.keys()].find((k) => k.startsWith(`quarantine/${evidenceId}/`));
    if (!key) throw new Error("quarantine object missing");
    const tampered = Buffer.from(PDF);
    tampered[tampered.length - 2] = 0x41;
    t.storage.objects.set(key, { body: tampered, contentType: "application/pdf" });

    const res = await finalize(owner, evidenceId, "final-0040");
    expect(res.statusCode).toBe(409);
    expect(ApiProblemSchema.parse(res.json())).toMatchObject({ code: "state_conflict", detail: ERROR_COPY.HASH_MISMATCH });
    const [row] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, evidenceId));
    expect(row?.status).toBe("HASH_MISMATCH");
    const meta = await t.app.inject({ method: "GET", url: `/api/evidence/${evidenceId}`, headers: { cookie: owner } });
    expect(EvidenceDocumentSchema.parse(meta.json())).toMatchObject({ status: { value: "HASH_MISMATCH" }, integrity: { state: { value: "MISMATCH" } }, canDownload: false });
  });

  it("requires uploaded content before finalize and an Idempotency-Key on every mutation", async () => {
    const { evidenceId } = IntentResult.parse((await intent(owner, "intent-0050")).json()).result;
    const early = await finalize(owner, evidenceId, "final-0050");
    expect(early.statusCode).toBe(409);
    expect(ApiProblemSchema.parse(early.json()).detail).toBe("Upload the file content before finalizing.");

    const noKey = await t.app.inject({ method: "POST", url: `/api/evidence/${evidenceId}/finalize`, headers: { cookie: owner }, payload: {} });
    expect(noKey.statusCode).toBe(400);
    expect(ApiProblemSchema.parse(noKey.json()).issues?.[0]?.path).toBe("headers.idempotency-key");
  });

  it("adds a new version to an existing document", async () => {
    const first = IntentResult.parse((await intent(owner, "intent-0060")).json()).result;
    await upload(owner, first.evidenceId, "content-0060", PDF);
    await finalize(owner, first.evidenceId, "final-0060");
    const second = await intent(owner, "intent-0061", { replacesDocumentId: first.evidenceId });
    expect(IntentResult.parse(second.json()).result).toMatchObject({ evidenceId: first.evidenceId, version: 2 });
    // Replaying the version intent returns the same version instead of a conflict with itself.
    const replay = await intent(owner, "intent-0061", { replacesDocumentId: first.evidenceId });
    expect(replay.statusCode).toBe(200);
    expect(IntentResult.parse(replay.json()).result.version).toBe(2);
    // A different request for a third version while v2 is pending conflicts.
    expect((await intent(owner, "intent-0062", { replacesDocumentId: first.evidenceId })).statusCode).toBe(409);
    await upload(owner, first.evidenceId, "content-0061", PDF);
    const done = DocumentResult.parse((await finalize(owner, first.evidenceId, "final-0061")).json()).result;
    expect(done.version).toBe(2);
    expect(done.versions.map((v) => v.version)).toEqual([1, 2]);
  });
});

describe("evidence without object storage", () => {
  it("answers 503 problems and keeps the API up", async () => {
    const t = await testApp({ storage: null });
    try {
      const cookie = await loginAs(t.app, "manufacturer-owner");
      const res = await t.app.inject({
        method: "POST",
        url: "/api/evidence/upload-intents",
        headers: { cookie, ...idem("intent-9000") },
        payload: { assetRef: "ASSET-DEMO-001", type: "OTHER", title: "x", fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 10 },
      });
      expect(res.statusCode).toBe(503);
      expect(ApiProblemSchema.parse(res.json()).detail).toBe("Document storage is unavailable. No file was stored.");
      const health = await t.app.inject({ method: "GET", url: "/api/system/health" });
      expect(health.json<{ checks: Record<string, { status: string }> }>().checks.storage?.status).toBe("unavailable");
    } finally {
      await t.close();
    }
  });
});
