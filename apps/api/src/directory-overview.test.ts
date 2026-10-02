// GET /api/directory/* and GET /api/overview over a projected daml-model §7 scenario (PGlite, no ledger), and the
// create-case counterparty validation against the directory: authenticated only, id + name only, per-currency
// figures from the viewer's stakeholder-filtered facts (Demo Lender B sees nothing), unavailable ≠ 0.
import { cases, importLocalnetState, organizations, projectOnce, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties } from "@collara/db/testing";
import { OverviewSchema, type PersonaId } from "@collara/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idem, loginAs, seededDb, testApp, type TestApp } from "./test-support";

const NOW = new Date("2026-10-01T20:00:00Z");
let db: DbHandle;
let t: TestApp;
const cookies = new Map<PersonaId, string>();

async function as(persona: PersonaId, method: "GET" | "POST", url: string, payload?: unknown) {
  let cookie = cookies.get(persona);
  if (!cookie) {
    cookie = await loginAs(t.app, persona);
    cookies.set(persona, cookie);
  }
  return t.app.inject({
    method,
    url,
    headers: { cookie, ...(method === "POST" ? { ...idem(`k-${Math.random().toString(36).slice(2)}`), "sec-fetch-site": "same-origin" } : {}) },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

beforeAll(async () => {
  db = await seededDb();
  await importLocalnetState(db.db, scenarioBindingState());
  const { ledger } = buildScenario("pledged");
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
  t = await testApp({ db, clock: () => NOW });
});

afterAll(async () => {
  await t?.close();
  await db?.close();
});

describe("GET /api/directory/*", () => {
  it("needs a session", async () => {
    for (const url of ["/api/directory/lenders", "/api/directory/dealers"]) {
      expect((await t.app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
  });

  it("lists onboarded lenders and dealers with id and display name only", async () => {
    const lenders = await as("manufacturer-owner", "GET", "/api/directory/lenders");
    expect(lenders.statusCode).toBe(200);
    expect(lenders.json()).toEqual([
      { id: "demo-lender-a", name: "Demo Lender A" },
      { id: "demo-lender-b", name: "Demo Lender B" },
    ]);
    expect((await as("manufacturer-owner", "GET", "/api/directory/dealers")).json()).toEqual([{ id: "demo-cnc-dealer", name: "Demo CNC Dealer" }]);
  });

  it("drops organizations that are not onboarded, and POST /api/cases refuses them", async () => {
    await db.db.update(organizations).set({ state: "SUSPENDED" }).where(eq(organizations.id, "demo-lender-b"));
    try {
      expect((await as("manufacturer-owner", "GET", "/api/directory/lenders")).json()).toEqual([{ id: "demo-lender-a", name: "Demo Lender A" }]);
      const refused = await as("manufacturer-owner", "POST", "/api/cases", { title: "Second case", assetRef: "ASSET-DEMO-001", selectedLenderOrgId: "demo-lender-b" });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ code: "validation_error", issues: [{ path: "body.selectedLenderOrgId", message: "Select a lender organization." }] });
    } finally {
      await db.db.update(organizations).set({ state: "ACTIVE" }).where(eq(organizations.id, "demo-lender-b"));
    }
  });
});

describe("POST /api/cases counterparty and state checks", () => {
  it("validates lender and dealer against the directory before the one-case-per-asset conflict", async () => {
    const wrong = await as("manufacturer-owner", "POST", "/api/cases", { title: "x", assetRef: "ASSET-DEMO-001", selectedLenderOrgId: "demo-cnc-dealer", dealerOrgId: "demo-lender-a" });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json<{ issues: { path: string }[] }>().issues.map((i) => i.path)).toEqual(["body.selectedLenderOrgId", "body.dealerOrgId"]);
    const held = await as("manufacturer-owner", "POST", "/api/cases", { title: "x", assetRef: "ASSET-DEMO-001", selectedLenderOrgId: "demo-lender-a" });
    expect(held.statusCode).toBe(409);
    expect(held.json()).toMatchObject({ detail: "This asset already has an active case workflow." });
  });

  it("answers 403 to a related lender and 404-shaped to Demo Lender B", async () => {
    const body = { title: "x", assetRef: "ASSET-DEMO-001", selectedLenderOrgId: "demo-lender-a" };
    expect((await as("lender-a-approver", "POST", "/api/cases", body)).statusCode).toBe(403);
    expect((await as("lender-b-approver", "POST", "/api/cases", body)).statusCode).toBe(404);
  });
});

describe("GET /api/overview", () => {
  it("needs a session", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/overview" })).statusCode).toBe(401);
  });

  it("gives the selected lender per-currency principal and its own valuation, with coverage and the watermark", async () => {
    const res = await as("lender-a-approver", "GET", "/api/overview");
    expect(res.statusCode, res.body).toBe(200);
    const overview = OverviewSchema.parse(res.json());
    expect(overview.principal).toMatchObject({ totals: [{ total: { amount: "100000.00", currency: "USD" }, count: 1 }], coverage: { included: 1, of: 1 } });
    expect(overview.valuation).toMatchObject({ totals: [{ total: { amount: "150000.00", currency: "USD" }, count: 1 }], coverage: { included: 1, of: 1 } });
    expect(overview.lastSync.offset).not.toBeNull();
  });

  it("gives the borrower its principal and no valuation; Demo Lender B and other roles see nothing", async () => {
    const borrower = OverviewSchema.parse((await as("manufacturer-owner", "GET", "/api/overview")).json());
    expect(borrower.principal?.totals).toEqual([{ total: { amount: "100000.00", currency: "USD" }, count: 1 }]);
    expect(borrower.valuation).toBeNull();

    const lenderB = OverviewSchema.parse((await as("lender-b-approver", "GET", "/api/overview")).json());
    expect(lenderB.principal).toMatchObject({ totals: [], coverage: { included: 0, of: 0 }, dates: null });
    expect(lenderB.valuation).toMatchObject({ totals: [], coverage: { included: 0, of: 0 }, dates: null });
    expect(JSON.stringify(lenderB)).not.toMatch(/100000|150000|CL-001/);

    for (const persona of ["dealer-contributor", "verifier-inspector"] as const) {
      expect(OverviewSchema.parse((await as(persona, "GET", "/api/overview")).json()), persona).toMatchObject({ principal: null, valuation: null });
    }
  });
});
