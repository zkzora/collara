// Dealer consent routes over a projected daml-model §7 scenario (PGlite, no ledger): GET /consent-requests is
// presenter-scoped (the dealer's own requests, every dealer's for the owner, nothing for anyone else); the decision
// and withdrawal routes answer 404-shaped to anyone who cannot see the request, 403 to the owner, 409 for a request
// in the wrong state, 400 without an Idempotency-Key, and never simulate success without a ledger (503, FAILED).
import { cases, evidenceDocuments, importLocalnetState, projectOnce, TEMPLATES as T, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties } from "@collara/db/testing";
import { CONSENT_COPY, ConsentRequestSchema, ERROR_COPY, pageSchema, VERIFICATION_GRANT_PURPOSE, type PersonaId } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idem, loginAs, seededDb, testApp, type TestApp } from "../../test-support";

const NOW = new Date("2026-10-01T20:00:00Z");
const DAY = 86_400_000;
const P = scenarioParties();
const Page = pageSchema(ConsentRequestSchema);
/** Synthetic SHA-256 of the dealer's invoice (64 hex characters, as the evidence table requires). */
const INVOICE_SHA = "d".repeat(64);
let db: DbHandle;
let t: TestApp;
const cookies = new Map<PersonaId, string>();

async function as(persona: PersonaId, method: "GET" | "POST", url: string, payload?: unknown, headers: Record<string, string> = {}) {
  let cookie = cookies.get(persona);
  if (!cookie) {
    cookie = await loginAs(t.app, persona);
    cookies.set(persona, cookie);
  }
  return t.app.inject({
    method,
    url,
    headers: { cookie, ...(method === "POST" ? { ...idem(`k-${Math.random().toString(36).slice(2)}`), "sec-fetch-site": "same-origin" } : {}), ...headers },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

/** Problem body without the per-request instance. */
const shape = (body: unknown) => {
  const { instance: _i, ...rest } = body as Record<string, unknown>;
  return rest;
};

beforeAll(async () => {
  db = await seededDb();
  await importLocalnetState(db.db, scenarioBindingState());
  const { ledger } = buildScenario("main");
  // A pending verification consent request for the dealer's invoice (DOC-001 in the scenario).
  ledger.tx((tx) => {
    tx.create(
      T.PackageShareProposal,
      {
        owner: P.owner,
        dealer: P.dealer,
        recipient: P.verifier,
        shareRef: "VR-002-G2-D1",
        purpose: VERIFICATION_GRANT_PURPOSE,
        caseRef: "CL-001",
        evidence: { packageRef: "PKG-001", manifestVersion: "2", manifestHash: "hash-manifest-v2" },
        documents: [{ docRef: "DOC-001", docVersion: "1", sha256: INVOICE_SHA, source: P.dealer }],
        permission: "VIEW_DOWNLOAD",
        expiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(),
      },
      { signatories: [P.owner], observers: [P.dealer] },
    );
  });
  await projectOnce(db.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P) });
  await db.db.insert(cases).values({
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
  await db.db.insert(evidenceDocuments).values({
    docRef: "DOC-001",
    version: 1,
    assetRef: "ASSET-DEMO-001",
    caseRef: "CL-001",
    ownerOrgId: "demo-manufacturer",
    contributorOrgId: "demo-cnc-dealer",
    uploadedByUserId: "user-dealer-contributor",
    type: "DEALER_INVOICE",
    title: "Dealer invoice",
    fileName: "dealer-invoice.pdf",
    contentType: "application/pdf",
    declaredSizeBytes: 100,
    sizeBytes: 100,
    sha256: INVOICE_SHA,
    storageKey: "evidence/DOC-001/v1",
    status: "AVAILABLE",
    intentExpiresAt: NOW,
    uploadedAt: NOW,
    finalizedAt: NOW,
  });
  t = await testApp({ db, clock: () => NOW });
});

afterAll(async () => {
  await t?.close();
  await db?.close();
});

describe("GET /api/consent-requests", () => {
  it("lists the dealer's own requests with documents, versions, hashes, recipient, purpose, expiry and actions", async () => {
    const response = await as("dealer-contributor", "GET", "/api/consent-requests?caseId=CL-001");
    expect(response.statusCode, response.body).toBe(200);
    const page = Page.parse(response.json());
    expect(page.items.map((r) => [r.id, r.purpose, r.recipient.name, r.verificationRef, r.state.value, r.allowedActions])).toEqual([
      ["VR-002-G2-D1", "VERIFICATION", "Demo Verifier", "VR-002", "PENDING", ["consent.grant", "consent.decline"]],
      ["SHR-001", "LENDER_REVIEW", "Demo Lender A", null, "GRANTED", ["consent.withdraw"]],
    ]);
    expect(page.items[0]?.documents).toEqual([{ documentId: "DOC-001", type: "DEALER_INVOICE", title: "Dealer invoice", version: 1, sha256: INVOICE_SHA }]);
    expect(page.items[0]?.expiresAt).toBe(new Date(NOW.getTime() + 10 * DAY).toISOString());
    // Never the owner's documents, terms or another party's data.
    for (const hidden of ["DOC-002", "DOC-003", "DOC-004", "100000", "FP-"]) expect(response.body).not.toContain(hidden);
    // Without a case filter: the same requests (one case in the scenario).
    expect(Page.parse((await as("dealer-contributor", "GET", "/api/consent-requests")).json()).items).toHaveLength(2);
  });

  it("gives the owner the status per dealer document; nothing to the lender, the verifier or the auditor; 404 for Lender B's case filter", async () => {
    const owner = Page.parse((await as("manufacturer-owner", "GET", "/api/consent-requests?caseId=CL-001")).json());
    expect(owner.items.map((r) => [r.id, r.state.value, r.allowedActions])).toEqual([
      ["VR-002-G2-D1", "PENDING", []],
      ["SHR-001", "GRANTED", []],
    ]);
    for (const persona of ["lender-a-analyst", "verifier-inspector", "auditor", "lender-b-approver"] as const) {
      const all = await as(persona, "GET", "/api/consent-requests");
      expect(all.statusCode, persona).toBe(200);
      expect(Page.parse(all.json()).items, persona).toEqual([]);
    }
    expect(Page.parse((await as("lender-a-analyst", "GET", "/api/consent-requests?caseId=CL-001")).json()).items).toEqual([]);
    const lenderB = await as("lender-b-approver", "GET", "/api/consent-requests?caseId=CL-001");
    const unknown = await as("manufacturer-owner", "GET", "/api/consent-requests?caseId=CL-999");
    expect(lenderB.statusCode).toBe(404);
    expect(shape(lenderB.json())).toEqual(shape(unknown.json()));
  });
});

describe("POST /api/consent-requests/:id/decision and /withdraw", () => {
  it("answers 404-shaped (identical to an unknown id) to everyone who cannot see the request, and 403 to the owner", async () => {
    const unknown = await as("dealer-contributor", "POST", "/api/consent-requests/SHR-999/decision", { decision: "GRANT" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: "unavailable", detail: ERROR_COPY.UNAVAILABLE });
    for (const persona of ["lender-b-approver", "lender-a-approver", "verifier-inspector", "auditor"] as const) {
      for (const [url, body] of [
        ["/api/consent-requests/VR-002-G2-D1/decision", { decision: "GRANT" }],
        ["/api/consent-requests/SHR-001/withdraw", {}],
      ] as const) {
        const response = await as(persona, "POST", url, body);
        expect(response.statusCode, `${persona} ${url}`).toBe(404);
        expect(shape(response.json()), `${persona} ${url}`).toEqual(shape(unknown.json()));
      }
    }
    const owner = await as("manufacturer-owner", "POST", "/api/consent-requests/VR-002-G2-D1/decision", { decision: "GRANT" });
    expect(owner.statusCode).toBe(403);
    expect(owner.json()).toMatchObject({ code: "forbidden" });
    expect((await as("manufacturer-owner", "POST", "/api/consent-requests/SHR-001/withdraw", {})).statusCode).toBe(403);
  });

  it("refuses the wrong state with 409 and the request's copy", async () => {
    const grantAgain = await as("dealer-contributor", "POST", "/api/consent-requests/SHR-001/decision", { decision: "DECLINE" });
    expect(grantAgain.statusCode).toBe(409);
    expect(grantAgain.json()).toMatchObject({ code: "state_conflict", detail: CONSENT_COPY.NOT_PENDING });
    const withdrawPending = await as("dealer-contributor", "POST", "/api/consent-requests/VR-002-G2-D1/withdraw", {});
    expect(withdrawPending.statusCode).toBe(409);
    expect(withdrawPending.json()).toMatchObject({ detail: CONSENT_COPY.NOT_GRANTED });
  });

  it("needs an Idempotency-Key and a same-origin request; validates the decision", async () => {
    const cookie = await loginAs(t.app, "dealer-contributor");
    const noKey = await t.app.inject({
      method: "POST",
      url: "/api/consent-requests/VR-002-G2-D1/decision",
      headers: { cookie, "sec-fetch-site": "same-origin" },
      payload: { decision: "GRANT" },
    });
    expect(noKey.statusCode).toBe(400);
    const crossSite = await as("dealer-contributor", "POST", "/api/consent-requests/VR-002-G2-D1/decision", { decision: "GRANT" }, { "sec-fetch-site": "cross-site" });
    expect(crossSite.statusCode).toBe(403);
    expect((await as("dealer-contributor", "POST", "/api/consent-requests/VR-002-G2-D1/decision", { decision: "MAYBE" })).statusCode).toBe(400);
  });

  it("without a ledger the dealer's decision and withdrawal are recorded as FAILED (503), never as success", async () => {
    for (const [url, body] of [
      ["/api/consent-requests/VR-002-G2-D1/decision", { decision: "GRANT" }],
      ["/api/consent-requests/VR-002-G2-D1/decision", { decision: "DECLINE" }],
      ["/api/consent-requests/SHR-001/withdraw", {}],
    ] as const) {
      const response = await as("dealer-contributor", "POST", url, body);
      expect(response.statusCode, `${url}: ${response.body}`).toBe(503);
      expect(response.json()).toMatchObject({ code: "ledger_unavailable", command: { state: "FAILED", simulated: false } });
      expect(response.body).not.toContain("Confirmed on the ledger.");
    }
  });
});
