import { CASE_CREATE_COPY, COMMAND_COPY, OverviewSchema, type PersonaId } from "@collara/domain";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { createMockClient } from "./index";

const NOW = new Date("2026-10-02T08:00:00Z");

function newClient(personaId: PersonaId = "manufacturer-owner") {
  return createMockClient({ personaId, now: new Date(NOW), latencyMs: 0 });
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

/** The borrower's registered asset that no case holds (CL-005 released its pledge). */
async function freeAsset(client: ReturnType<typeof newClient>) {
  const { items } = await client.assets.list();
  const details = await Promise.all(items.map((a) => client.assets.get(a.ref)));
  const free = details.find((d) => d.allowedActions.includes("case.create"));
  if (!free) throw new Error("no asset accepts a new case");
  return free;
}

describe("UI_MOCK directory", () => {
  it("lists onboarded lenders and dealers with id and name only", async () => {
    const client = newClient();
    expect(await client.directory.lenders()).toEqual([
      { id: "demo-lender-a", name: "Demo Lender A" },
      { id: "demo-lender-b", name: "Demo Lender B" },
    ]);
    expect(await client.directory.dealers()).toEqual([{ id: "demo-cnc-dealer", name: "Demo CNC Dealer" }]);
  });
});

describe("UI_MOCK case creation", () => {
  it("creates a case on a free registered asset under a new server-allocated ref", async () => {
    const client = newClient();
    const asset = await freeAsset(client);
    expect(asset.ref).not.toBe("ASSET-DEMO-001");
    const created = await client.cases.create({
      title: "Second CNC financing",
      assetRef: asset.ref,
      selectedLenderOrgId: "demo-lender-a",
      dealerOrgId: "demo-cnc-dealer",
      requestedPrincipal: { amount: "100000", currency: "USD" },
    });
    expect(created.command).toMatchObject({ operation: "case.create", target: "APPLICATION", simulated: true });
    expect(created.command.message).not.toBe(COMMAND_COPY.COMMITTED);
    const caseId = created.result.caseId;
    expect(caseId).toMatch(/^CL-\d{3}$/);
    expect(caseId).not.toBe("CL-001");

    const detail = await client.cases.get(caseId);
    expect(detail).toMatchObject({ title: "Second CNC financing", requestedPrincipal: { amount: "100000.00", currency: "USD" }, selectedLender: { id: "demo-lender-a" } });
    expect(detail.nextAction?.code).toMatch(/REVIEW_SHARING|REQUEST_VERIFICATION|ADD_EVIDENCE/);
    expect((await client.cases.list()).items.map((c) => c.caseId)).toContain(caseId);
    // The asset is now held by the new case.
    expect((await client.assets.get(asset.ref)).allowedActions).not.toContain("case.create");

    // Nothing is shared by creating a case: the selected lender and Lender B do not see it.
    client.setPersona("lender-a-approver");
    expect((await rejection(client.cases.get(caseId))).code).toBe("unavailable");
    expect((await client.cases.list()).items.map((c) => c.caseId)).not.toContain(caseId);
    client.setPersona("lender-b-approver");
    expect((await rejection(client.cases.get(caseId))).code).toBe("unavailable");
  });

  it("validates counterparties against the directory and refuses a held asset", async () => {
    const client = newClient();
    const asset = await freeAsset(client);
    const wrongLender = await rejection(client.cases.create({ title: "x", assetRef: asset.ref, selectedLenderOrgId: "demo-cnc-dealer" }));
    expect(wrongLender).toMatchObject({ code: "validation_error" });
    expect(wrongLender.problem?.issues).toEqual([{ path: "body.selectedLenderOrgId", message: "Select a lender organization." }]);
    const wrongDealer = await rejection(client.cases.create({ title: "x", assetRef: asset.ref, selectedLenderOrgId: "demo-lender-a", dealerOrgId: "demo-lender-b" }));
    expect(wrongDealer.problem?.issues?.map((i) => i.path)).toEqual(["body.dealerOrgId"]);
    const badMoney = await rejection(client.cases.create({ title: "x", assetRef: asset.ref, selectedLenderOrgId: "demo-lender-a", requestedPrincipal: { amount: "1.005", currency: "USD" } }));
    expect(badMoney.code).toBe("validation_error");

    const held = await rejection(client.cases.create({ title: "x", assetRef: "ASSET-DEMO-001", selectedLenderOrgId: "demo-lender-a" }));
    expect(held).toMatchObject({ code: "state_conflict" });
    expect(held.message).toBe(CASE_CREATE_COPY.ACTIVE_CASE);
  });

  it("refuses non-borrowers (403 when related, 404-shaped when unrelated)", async () => {
    const client = newClient();
    const asset = await freeAsset(client);
    client.setPersona("lender-a-approver");
    expect((await rejection(client.cases.create({ title: "x", assetRef: asset.ref, selectedLenderOrgId: "demo-lender-a" }))).code).toBe("forbidden");
    client.setPersona("lender-b-approver");
    expect((await rejection(client.cases.create({ title: "x", assetRef: asset.ref, selectedLenderOrgId: "demo-lender-b" }))).code).toBe("unavailable");
  });
});

describe("UI_MOCK overview", () => {
  it("matches the domain figures: per currency, own scope only", async () => {
    const client = newClient("lender-a-analyst");
    const lender = OverviewSchema.parse(await client.overview.get());
    expect(lender.principal?.totals).toEqual([{ total: { amount: "180000.00", currency: "USD" }, count: 1 }]);
    expect(lender.valuation?.totals).toEqual([{ total: { amount: "260000.00", currency: "USD" }, count: 1 }]);
    expect(lender.lastSync).toEqual({ offset: null, at: null });

    client.setPersona("manufacturer-owner");
    const borrower = await client.overview.get();
    expect(borrower.principal).toMatchObject({ totals: [], coverage: { included: 0, of: 0 } });
    expect(borrower.valuation).toBeNull();

    client.setPersona("lender-b-approver");
    const unrelated = await client.overview.get();
    expect(unrelated.principal?.totals).toEqual([]);
    expect(unrelated.valuation?.totals).toEqual([]);

    client.setPersona("verifier-inspector");
    expect(await client.overview.get()).toMatchObject({ principal: null, valuation: null });
  });
});
