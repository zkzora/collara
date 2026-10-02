// Financing routes over projected scenario data (PGlite, no ledger connection): read paths and presenters,
// 404-shaped responses for unrelated parties, policy/mandate refusals before anything is submitted, and writes
// recorded as FAILED (503) because there is no ledger — never simulated.
import { cases, importLocalnetState, projectOnce, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties, type ScenarioStage } from "@collara/db/testing";
import { COMMAND_COPY, ERROR_COPY, type PersonaId } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idem, loginAs, seededDb, testApp, type TestApp } from "../../test-support";

async function scenarioApp(stage: ScenarioStage): Promise<{ t: TestApp; db: DbHandle }> {
  const db = await seededDb();
  await importLocalnetState(db.db, scenarioBindingState());
  const { ledger } = buildScenario(stage);
  await projectOnce(db.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(scenarioParties()) });
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
  return { t: await testApp({ db }), db };
}

function client(t: TestApp) {
  const cookies = new Map<PersonaId, string>();
  const as = async (persona: PersonaId) => {
    let cookie = cookies.get(persona);
    if (!cookie) {
      cookie = await loginAs(t.app, persona);
      cookies.set(persona, cookie);
    }
    return cookie;
  };
  return {
    get: async (persona: PersonaId, url: string) => t.app.inject({ method: "GET", url, headers: { cookie: await as(persona) } }),
    post: async (persona: PersonaId, url: string, payload: object = {}, key: string | null = `k-${Math.random()}`) =>
      t.app.inject({ method: "POST", url, payload, headers: { cookie: await as(persona), ...(key ? idem(key) : {}) } }),
  };
}

const UNAVAILABLE = { status: 404, code: "unavailable", detail: ERROR_COPY.UNAVAILABLE };

describe("financing read paths (scenario 'full')", () => {
  let t: TestApp;
  let db: DbHandle;
  let c: ReturnType<typeof client>;

  beforeAll(async () => {
    ({ t, db } = await scenarioApp("full"));
    c = client(t);
  });
  afterAll(async () => {
    await t?.close();
    await db?.close();
  });

  it("reviews: the selected lender sees the assessment; the borrower sees the outcome only; others get nothing", async () => {
    const list = await c.get("lender-a-analyst", "/api/reviews");
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toMatchObject([{ ref: "CA-001", caseId: "CL-001", state: { value: "ELIGIBLE" } }]);
    for (const persona of ["lender-b-approver", "verifier-inspector", "dealer-contributor", "auditor"] as const) {
      expect((await c.get(persona, "/api/reviews")).json().items).toEqual([]);
    }

    const lender = (await c.get("lender-a-approver", "/api/reviews/CA-001")).json();
    expect(lender.assessment.valuation).toEqual({ amount: "150000.00", currency: "USD" });
    const borrower = await c.get("manufacturer-owner", "/api/reviews/CA-001");
    expect(borrower.statusCode).toBe(200);
    expect(borrower.json()).toMatchObject({ state: { value: "ELIGIBLE" }, assessment: null, internalNotes: null });
    for (const persona of ["lender-b-approver", "verifier-inspector", "dealer-contributor"] as const) {
      const response = await c.get(persona, "/api/reviews/CA-001");
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject(UNAVAILABLE);
    }
    // Unknown and unauthorized ids are indistinguishable.
    const unknown = (await c.get("lender-b-approver", "/api/reviews/CA-999")).json();
    const unauthorized = (await c.get("lender-b-approver", "/api/reviews/CA-001")).json();
    expect({ ...unknown, instance: null }).toEqual({ ...unauthorized, instance: null });
  });

  it("proposals: terms for the borrower and the selected lender only", async () => {
    const borrower = await c.get("manufacturer-owner", "/api/proposals/FP-001");
    expect(borrower.statusCode).toBe(200);
    expect(borrower.json()).toMatchObject({ ref: "FP-001", principal: { amount: "100000.00", currency: "USD" }, state: { value: "ACCEPTED" } });
    expect((await c.get("lender-a-analyst", "/api/proposals/FP-001")).statusCode).toBe(200);
    for (const persona of ["lender-b-approver", "verifier-inspector", "dealer-contributor", "auditor"] as const) {
      const response = await c.get(persona, "/api/proposals/FP-001");
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("100000");
    }
  });

  it("pledges and release requests: history for the parties, 404 for Lender B", async () => {
    const pledges = (await c.get("manufacturer-owner", "/api/pledges")).json();
    expect(pledges.items).toMatchObject([{ ref: "PL-001", state: { value: "RELEASED" }, technical: { controlVersionConsumed: 3, controlVersionLocked: 4, controlVersionAfterRelease: 5 } }]);
    expect((await c.get("manufacturer-owner", "/api/pledges?filter=active")).json().items).toEqual([]);
    expect((await c.get("lender-b-approver", "/api/pledges")).json().items).toEqual([]);
    expect((await c.get("lender-b-approver", "/api/pledges/PL-001")).statusCode).toBe(404);
    const rr1 = await c.get("lender-a-approver", "/api/release-requests/RR-001");
    expect(rr1.json()).toMatchObject({ ref: "RR-001", state: { value: "REJECTED" } });
    expect((await c.get("lender-b-approver", "/api/release-requests/RR-001")).statusCode).toBe(404);
    expect((await c.get("verifier-inspector", "/api/release-requests/RR-001")).statusCode).toBe(404);
  });

  it("audit events: scoped per viewer; Lender B gets a 404 for the case and an empty feed", async () => {
    const borrower = (await c.get("manufacturer-owner", "/api/audit/events?caseId=CL-001&limit=100")).json();
    const types = borrower.items.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["PLEDGE_ACTIVATED", "RELEASE_REJECTED", "RELEASE_AUTHORIZED"]));
    expect(borrower.items.every((e: { commit: unknown }) => e.commit !== null)).toBe(true);
    expect((await c.get("lender-b-approver", "/api/audit/events?caseId=CL-001")).json()).toMatchObject(UNAVAILABLE);
    expect((await c.get("lender-b-approver", "/api/audit/events")).json().items).toEqual([]);
    // The auditor sees only events within the effective grants (no proposal terms, no pledge/release events).
    const auditor = (await c.get("auditor", "/api/audit/events?caseId=CL-001&limit=100")).json();
    const auditorTypes = auditor.items.map((e: { type: string }) => e.type);
    expect(auditorTypes).toContain("DECISION_RECORDED");
    expect(auditorTypes).not.toContain("PROPOSAL_ACCEPTED");
    expect(auditorTypes).not.toContain("PLEDGE_ACTIVATED");
  });

  it("mutations: policy and mandate refusals come before any submission", async () => {
    expect((await c.post("lender-b-approver", "/api/cases/CL-001/pledge-activation")).json()).toMatchObject(UNAVAILABLE);
    expect((await c.post("lender-b-approver", "/api/release-requests/RR-002/decision", { decision: "AUTHORIZE" })).statusCode).toBe(404);
    expect((await c.post("lender-b-approver", "/api/audit/grants", { caseId: "CL-001", auditorOrgId: "demo-auditor", scopes: ["DECISION_OUTCOME"], permission: "VIEW", purpose: "x", expiresAt: new Date(Date.now() + 86_400_000).toISOString() })).statusCode).toBe(404);
    const analyst = await c.post("lender-a-analyst", "/api/reviews/CA-001/decision", { outcome: "ELIGIBLE" });
    expect(analyst.statusCode).toBe(403);
    const borrower = await c.post("manufacturer-owner", "/api/release-requests/RR-001/decision", { decision: "AUTHORIZE" });
    expect(borrower.statusCode).toBe(403);
    expect(borrower.json().detail).toBe(ERROR_COPY.RELEASE_UNAUTHORIZED);
    const noKey = await c.post("lender-a-approver", "/api/cases/CL-001/pledge-activation", {}, null);
    expect(noKey.statusCode).toBe(400);
    // Borrower granting a lender-owned scope is refused with the mock's copy.
    const notOwned = await c.post("manufacturer-owner", "/api/audit/grants", {
      caseId: "CL-001",
      auditorOrgId: "demo-auditor",
      scopes: ["DECISION_OUTCOME"],
      permission: "VIEW",
      purpose: "Synthetic audit",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(notOwned.statusCode).toBe(400);
    expect(notOwned.json().detail).toBe("Only the record owner can grant: DECISION_OUTCOME.");
  });
});

describe("financing writes without a ledger (scenario 'authorized')", () => {
  let t: TestApp;
  let db: DbHandle;
  let c: ReturnType<typeof client>;

  beforeAll(async () => {
    ({ t, db } = await scenarioApp("authorized"));
    c = client(t);
  });
  afterAll(async () => {
    await t?.close();
    await db?.close();
  });

  it("activation passes policy and preconditions, then is recorded FAILED (503) — nothing is simulated", async () => {
    // Browser-supplied party/org fields are ignored (stripped), not trusted.
    const response = await c.post("lender-a-approver", "/api/cases/CL-001/pledge-activation", { lender: "DemoLenderB::evil", orgId: "demo-lender-b" }, "activation-0001");
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body).toMatchObject({ code: "ledger_unavailable", detail: COMMAND_COPY.LEDGER_UNAVAILABLE, command: { state: "FAILED", simulated: false } });
    expect(body.command.updateId).toBeUndefined();
    // Analyst cannot activate (approver mandate).
    expect((await c.post("lender-a-analyst", "/api/cases/CL-001/pledge-activation")).statusCode).toBe(403);
    // Pledge GETs: no lock projected yet.
    expect((await c.get("lender-a-approver", "/api/pledges")).json().items).toEqual([]);
  });
});
