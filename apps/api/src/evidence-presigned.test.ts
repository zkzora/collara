import { createHash } from "node:crypto";
import { cases, evidenceDocuments } from "@collara/db";
import { commandResultSchema, EvidenceDocumentSchema, UploadIntentSchema } from "@collara/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directUploadKey } from "./routes/evidence";
import { idem, loginAs, testApp, type TestApp } from "./test-support";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("synthetic evidence for ASSET-DEMO-001\n%%EOF\n")]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const IntentResult = commandResultSchema(UploadIntentSchema);
const DocumentResult = commandResultSchema(EvidenceDocumentSchema);

describe("evidence pipeline, STORAGE_UPLOAD_MODE=presigned", () => {
  let t: TestApp;
  let owner: string;
  let lenderB: string;

  beforeAll(async () => {
    t = await testApp({ env: { STORAGE_UPLOAD_MODE: "presigned", COLLARA_S3_ENDPOINT: "https://storage.invalid", COLLARA_S3_ACCESS_KEY: "test", COLLARA_S3_SECRET_KEY: "test" } });
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
    lenderB = await loginAs(t.app, "lender-b-approver");
  });

  afterAll(async () => {
    await t.close();
  });

  const intent = (cookie: string, key: string, body: Record<string, unknown> = {}) =>
    t.app.inject({
      method: "POST",
      url: "/api/evidence/upload-intents",
      headers: { cookie, ...idem(key) },
      payload: { assetRef: "ASSET-DEMO-001", caseId: "CL-001", type: "INSPECTION_REPORT", title: "Inspection report", fileName: "inspection.pdf", contentType: "application/pdf", sizeBytes: PDF.length, ...body },
    });
  const finalize = (cookie: string, id: string, key: string) =>
    t.app.inject({ method: "POST", url: `/api/evidence/${id}/finalize`, headers: { cookie, ...idem(key) }, payload: {} });

  /** What the browser's PUT to the presigned URL does: the object lands at the version's quarantine key. */
  async function browserPut(evidenceId: string, bytes: Buffer, contentType = "application/pdf") {
    const [row] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, evidenceId));
    if (!row) throw new Error("no version row");
    await t.storage.putObject(directUploadKey(row), bytes, contentType);
    return directUploadKey(row);
  }

  it("returns a short-lived presigned PUT for quarantine, then finalize hashes and promotes the stored bytes", async () => {
    const created = await intent(owner, "p-intent-0001");
    expect(created.statusCode).toBe(201);
    const { result } = IntentResult.parse(created.json());
    expect(result.directUpload).toMatchObject({ method: "PUT", headers: { "content-type": "application/pdf" } });
    expect(result.directUpload?.url).toContain(encodeURIComponent(`quarantine/${result.evidenceId}/v1/direct-`));
    const ttl = Date.parse(result.directUpload?.expiresAt ?? "") - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 1000);

    // Replay: same intent, fresh URL; the stored command result never holds the URL.
    const replay = await intent(owner, "p-intent-0001");
    expect(IntentResult.parse(replay.json()).result.directUpload?.url).toBeDefined();
    const [row] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, result.evidenceId));
    expect(row?.status).toBe("UPLOAD_PENDING");

    // Finalize before the PUT: not uploaded yet, retryable with a new key.
    expect((await finalize(owner, result.evidenceId, "p-final-early")).statusCode).toBe(409);

    const quarantineKey = await browserPut(result.evidenceId, PDF);
    const done = await finalize(owner, result.evidenceId, "p-final-0001");
    expect(done.statusCode).toBe(200);
    const doc = DocumentResult.parse(done.json()).result;
    expect(doc.status.value).toBe("AVAILABLE");
    const sha = createHash("sha256").update(PDF).digest("hex");
    const [promoted] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, result.evidenceId));
    expect(promoted).toMatchObject({ status: "AVAILABLE", sha256: sha, uploadSha256: sha, sizeBytes: PDF.length, storageKey: `evidence/${result.evidenceId}/v1/${sha}` });
    expect(t.storage.objects.has(quarantineKey)).toBe(false);

    // Replayed finalize returns the recorded outcome.
    expect((await finalize(owner, result.evidenceId, "p-final-0001")).statusCode).toBe(200);
    // A settled version gets no new upload URL.
    expect(IntentResult.parse((await intent(owner, "p-intent-0001")).json()).result.directUpload).toBeUndefined();
  });

  it("rejects stored bytes whose magic bytes do not match the declared type and deletes them", async () => {
    const { result } = IntentResult.parse((await intent(owner, "p-intent-0002")).json());
    const key = await browserPut(result.evidenceId, PNG, "image/png");
    const refused = await finalize(owner, result.evidenceId, "p-final-0002");
    expect(refused.statusCode).toBe(400);
    expect(t.storage.objects.has(key)).toBe(false);
    const [row] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, result.evidenceId));
    expect(row?.status).toBe("REJECTED");
    // The same key replays the refusal.
    expect((await finalize(owner, result.evidenceId, "p-final-0002")).statusCode).toBe(400);
  });

  it("never issues an upload URL to an unrelated organization", async () => {
    const refused = await intent(lenderB, "p-intent-0003");
    expect(refused.statusCode).toBe(404);
    expect(refused.body).not.toContain("storage.invalid");
  });
});
