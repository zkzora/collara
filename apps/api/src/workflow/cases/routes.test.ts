// Case, asset, verification and access routes over a projected daml-model §7 scenario (PGlite, no ledger):
// stakeholder-scoped reads per persona, 404-shaped answers for the unrelated lender, field omission for the
// verifier and dealer, and mutations that never fall back to simulated success without a ledger.
import { cases, importLocalnetState, projectOnce, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties } from "@collara/db/testing";
import {
  AccessGrantSchema,
  AssetDetailSchema,
  AttestationSchema,
  CaseDetailSchema,
  CaseListSchema,
  ERROR_COPY,
  EvidenceDocumentSchema,
  pageSchema,
  VerificationRequestSchema,
  type PersonaId,
} from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { idem, loginAs, seededDb, testApp, type TestApp } from "../../test-support";

const NOW = new Date("2026-10-01T20:00:00Z");
let db: DbHandle;
let t: TestApp;
const cookies = new Map<PersonaId, string>();

async function as(persona: PersonaId, method: "GET" | "POST", url: string, payload?: unknown, key = `k-${Math.random().toString(36).slice(2)}`) {
  let cookie = cookies.get(persona);
  if (!cookie) {
    cookie = await loginAs(t.app, persona);
    cookies.set(persona, cookie);
  }
  return t.app.inject({
    method,
    url,
    headers: { cookie, ...(method === "POST" ? { ...idem(key), "sec-fetch-site": "same-origin" } : {}) },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

beforeAll(async () => {
  db = await seededDb();
  await importLocalnetState(db.db, scenarioBindingState());
  const { ledger } = buildScenario("main");
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

describe("cases (read model + presenters)", () => {
  it("lists CL-001 for its participants and nothing (zero counts) for Demo Lender B", async () => {
    for (const persona of ["manufacturer-owner", "lender-a-analyst", "dealer-contributor", "verifier-inspector"] as const) {
      const list = CaseListSchema.parse((await as(persona, "GET", "/api/cases")).json());
      expect(list.items.map((c) => c.caseId), persona).toEqual(["CL-001"]);
    }
    const lenderB = await as("lender-b-approver", "GET", "/api/cases");
    expect(lenderB.statusCode).toBe(200);
    const list = CaseListSchema.parse(lenderB.json());
    expect(list.items).toEqual([]);
    expect(Object.values(list.counts).every((n) => n === 0)).toBe(true);
  });

  it("answers 404-shaped for Demo Lender B and for an unknown case, with identical bodies", async () => {
    const unrelated = await as("lender-b-approver", "GET", "/api/cases/CL-001");
    const unknown = await as("manufacturer-owner", "GET", "/api/cases/CL-999");
    for (const response of [unrelated, unknown]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: "unavailable", detail: ERROR_COPY.UNAVAILABLE });
    }
    const { instance: _a, ...a } = unrelated.json() as Record<string, unknown>;
    const { instance: _b, ...b } = unknown.json() as Record<string, unknown>;
    expect(a).toEqual(b);
    expect((await as("lender-b-approver", "GET", "/api/cases/CL-001/evidence")).statusCode).toBe(404);
  });

  it("shows terms to the borrower and the selected lender only (verifier and dealer never receive them)", async () => {
    const owner = CaseDetailSchema.parse((await as("manufacturer-owner", "GET", "/api/cases/CL-001")).json());
    expect(owner.requestedPrincipal).toEqual({ amount: "100000.00", currency: "USD" });
    expect(owner.lastSync.offset).toBeGreaterThan(0);
    const lender = CaseDetailSchema.parse((await as("lender-a-analyst", "GET", "/api/cases/CL-001")).json());
    expect(lender.requestedPrincipal).toEqual({ amount: "100000.00", currency: "USD" });
    for (const persona of ["verifier-inspector", "dealer-contributor"] as const) {
      const response = await as(persona, "GET", "/api/cases/CL-001");
      expect(response.statusCode, persona).toBe(200);
      const detail = CaseDetailSchema.parse(response.json());
      expect(detail.requestedPrincipal, persona).toBeNull();
      expect(detail.references.proposal, persona).toBeNull();
      expect(response.body, persona).not.toContain("100000");
    }
  });

  it("presents the case evidence to the owner and the shared documents to the selected lender", async () => {
    const owner = z.array(EvidenceDocumentSchema).parse((await as("manufacturer-owner", "GET", "/api/cases/CL-001/evidence")).json());
    expect(owner.map((d) => d.id)).toEqual(["DOC-001", "DOC-002", "DOC-003", "DOC-004"]);
    const lender = z.array(EvidenceDocumentSchema).parse((await as("lender-a-analyst", "GET", "/api/cases/CL-001/evidence")).json());
    expect(lender.map((d) => d.id)).toEqual(["DOC-001", "DOC-002", "DOC-003", "DOC-004"]);
  });
});

describe("assets, verifications, attestations, access grants", () => {
  it("scopes assets: owner sees the passport, Demo Lender B sees nothing", async () => {
    const owner = pageSchema(AssetDetailSchema.pick({ ref: true })).parse((await as("manufacturer-owner", "GET", "/api/assets")).json());
    expect(owner.items.map((a) => a.ref)).toEqual(["ASSET-DEMO-001"]);
    const detail = AssetDetailSchema.parse((await as("manufacturer-owner", "GET", "/api/assets/ASSET-DEMO-001")).json());
    expect(detail).toMatchObject({ ref: "ASSET-DEMO-001", model: "DEMO-CNC-500", serialNumber: "SYNTH-CNC-001" });
    expect((await as("lender-b-approver", "GET", "/api/assets")).json()).toMatchObject({ items: [] });
    expect((await as("lender-b-approver", "GET", "/api/assets/ASSET-DEMO-001")).statusCode).toBe(404);
    expect((await as("lender-b-approver", "GET", "/api/assets/ASSET-DEMO-001/evidence")).statusCode).toBe(404);
  });

  it("names the registry reference for the owner and the verifier; Demo Lender B gets 404", async () => {
    for (const persona of ["manufacturer-owner", "verifier-inspector"] as const) {
      const list = pageSchema(VerificationRequestSchema).parse((await as(persona, "GET", "/api/verifications")).json());
      expect(list.items.map((v) => [v.ref, v.verifierRegistryRef, v.state.value]), persona).toEqual([["VR-001", "VER-001", "ATTESTED"]]);
    }
    expect((await as("lender-b-approver", "GET", "/api/verifications/VR-001")).statusCode).toBe(404);
    expect((await as("lender-b-approver", "GET", "/api/verifications")).json()).toMatchObject({ items: [] });
  });

  it("shows ATT-001 to the owner, the verifier and the selected lender only", async () => {
    for (const persona of ["manufacturer-owner", "verifier-inspector", "lender-a-analyst"] as const) {
      const response = await as(persona, "GET", "/api/attestations/ATT-001");
      expect(response.statusCode, persona).toBe(200);
      expect(AttestationSchema.parse(response.json())).toMatchObject({ ref: "ATT-001", verifierRegistryRef: "VER-001", evidencePackage: { ref: "PKG-001", version: 2 } });
    }
    for (const persona of ["lender-b-approver", "dealer-contributor", "auditor"] as const) {
      expect((await as(persona, "GET", "/api/attestations/ATT-001")).statusCode, persona).toBe(404);
    }
  });

  it("lists the package shares for the owner and the lender; 404 for Demo Lender B", async () => {
    const owner = pageSchema(AccessGrantSchema).parse((await as("manufacturer-owner", "GET", "/api/access-grants?caseId=CL-001")).json());
    expect(owner.items.filter((g) => g.kind === "PACKAGE_SHARE").map((g) => [g.id, g.state.value, g.canRevoke])).toEqual([
      ["SHR-001", "GRANTED", true],
      ["SHR-002", "GRANTED", true],
    ]);
    const lender = pageSchema(AccessGrantSchema).parse((await as("lender-a-approver", "GET", "/api/access-grants")).json());
    expect(lender.items.every((g) => g.kind === "PACKAGE_SHARE" && !g.canRevoke)).toBe(true);
    expect((await as("lender-b-approver", "GET", "/api/access-grants?caseId=CL-001")).statusCode).toBe(404);
    expect((await as("lender-b-approver", "GET", "/api/access-grants")).json()).toMatchObject({ items: [] });
  });
});

describe("mutations: authority first, never simulated", () => {
  it("answers 404 to Demo Lender B on every case, asset, verification and grant mutation", async () => {
    const calls: [string, unknown][] = [
      ["/api/cases/CL-001/sharing", { recipientOrgId: "demo-lender-b", permission: "VIEW" }],
      ["/api/cases/CL-001/verification-requests", { verifierRegistryRef: "VER-001", scope: ["Serial number consistency"], documentIds: ["DOC-001"] }],
      ["/api/assets/ASSET-DEMO-001/verification-requests", { verifierRegistryRef: "VER-001", scope: ["Serial number consistency"], documentIds: ["DOC-001"] }],
      ["/api/verifications/VR-001/assignment", { decision: "ACCEPT" }],
      ["/api/verifications/VR-001/change-requests", { message: "x" }],
      ["/api/verifications/VR-001/rejection", { reason: "x" }],
      ["/api/verifications/VR-001/evidence-submissions", {}],
      ["/api/access-grants/SHR-002/revoke", {}],
    ];
    for (const [url, body] of calls) {
      const response = await as("lender-b-approver", "POST", url, body);
      expect(response.statusCode, url).toBe(404);
      expect(response.json(), url).toMatchObject({ code: "unavailable" });
    }
  });

  it("refuses invalid transitions with 409 and the approved copy", async () => {
    // VR-001 is already attested: the verifier cannot accept or attest again.
    const accept = await as("verifier-inspector", "POST", "/api/verifications/VR-001/assignment", { decision: "ACCEPT" });
    expect(accept.statusCode).toBe(409);
    expect(accept.json()).toMatchObject({ code: "state_conflict", detail: "This action could not complete because the asset workflow state changed." });
    // The package is already shared with the selected lender.
    const share = await as("manufacturer-owner", "POST", "/api/cases/CL-001/sharing", { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" });
    expect(share.statusCode).toBe(409);
    // One active case per asset.
    const create = await as("manufacturer-owner", "POST", "/api/cases", { title: "Second case", assetRef: "ASSET-DEMO-001", selectedLenderOrgId: "demo-lender-a" });
    expect(create.statusCode).toBe(409);
    expect(create.json()).toMatchObject({ detail: "This asset already has an active case workflow." });
  });

  it("forbids related parties without the mandate (403) and ignores browser-supplied authority", async () => {
    // The analyst is related to CL-001 but only the owner may share.
    const analyst = await as("lender-a-analyst", "POST", "/api/cases/CL-001/sharing", { recipientOrgId: "demo-lender-a", permission: "VIEW", orgId: "demo-manufacturer", actAs: "DemoManufacturer" });
    expect(analyst.statusCode).toBe(403);
    // Registration needs the borrower mandate.
    const register = { intent: "REGISTER", equipmentClass: "CNC machining center", manufacturer: "Demo Machine Works (synthetic)", model: "DEMO-CNC-500", serialNumber: "SYNTH-CNC-777", locationScope: "Synthetic" };
    expect((await as("lender-b-approver", "POST", "/api/assets", register)).statusCode).toBe(403);
  });

  it("records a registration without a ledger as FAILED (503 ledger_unavailable), never as success", async () => {
    const register = { intent: "REGISTER", equipmentClass: "CNC machining center", manufacturer: "Demo Machine Works (synthetic)", model: "DEMO-CNC-500", serialNumber: "SYNTH-CNC-002", locationScope: "Synthetic" };
    const response = await as("manufacturer-owner", "POST", "/api/assets", register);
    expect(response.statusCode).toBe(503);
    const body = response.json() as { code: string; command: { state: string; simulated: boolean; updateId?: string; message: string } };
    expect(body.code).toBe("ledger_unavailable");
    expect(body.command).toMatchObject({ state: "FAILED", simulated: false, message: "The ledger is unavailable. No confirmed state change has been recorded." });
    expect(body.command.updateId).toBeUndefined();
    expect(response.body).not.toContain("Confirmed on the ledger.");
  });
});
