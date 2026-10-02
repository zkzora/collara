import { describe, expect, it } from "vitest";
import type { CaseFacts } from "./facts";
import { buildScenario } from "./fixtures";
import { money } from "./money";
import { OverviewSchema, presentOverview } from "./overview";
import { presentAssetDetail, type PresentContext } from "./presenters";
import { personaActor, type PersonaId } from "./roles";
import { CASE_CREATE_COPY, checkAssetAction } from "./workflow";

const NOW = new Date("2026-10-02T08:00:00Z");
const pctx: PresentContext = { now: NOW, mode: "UI_MOCK", sync: { offset: null, at: null } };

function world() {
  return buildScenario({ now: NOW });
}

function overview(cases: readonly CaseFacts[], persona: PersonaId) {
  return OverviewSchema.parse(presentOverview(cases, personaActor(persona), pctx));
}

/** A copy of an active-pledge case under new refs, with its own principal and valuation (or none). */
function pledgedCopy(source: CaseFacts, n: number, principal: ReturnType<typeof money>, valuation: ReturnType<typeof money> | null): CaseFacts {
  const copy = structuredClone(source);
  const ref = `CL-${String(n).padStart(3, "0")}`;
  copy.ref = ref;
  copy.lock = { ...copy.lock!, ref: `PL-${String(n).padStart(3, "0")}` };
  copy.proposals = copy.proposals.map((p) => ({ ...p, principal }));
  copy.review = { ...copy.review, assessment: valuation && copy.review.assessment ? { ...copy.review.assessment, valuation } : null };
  return copy;
}

describe("presentOverview", () => {
  it("gives the selected lender per-currency principal and its own valuation for active pledges only", () => {
    const { cases } = world();
    for (const persona of ["lender-a-approver", "lender-a-analyst"] as const) {
      const result = overview(cases, persona);
      // CL-003 is the only active pledge of Demo Lender A (CL-005 was released).
      expect(result.principal).toMatchObject({
        label: "Recorded financing principal",
        totals: [{ total: { amount: "180000.00", currency: "USD" }, count: 1 }],
        coverage: { included: 1, of: 1 },
      });
      expect(result.valuation).toMatchObject({
        label: "Recorded collateral valuation",
        totals: [{ total: { amount: "260000.00", currency: "USD" }, count: 1 }],
        coverage: { included: 1, of: 1 },
      });
      expect(result.principal?.dates).not.toBeNull();
    }
  });

  it("never sums across currencies and counts missing values as unavailable, not 0", () => {
    const { cases } = world();
    const cl003 = cases.find((c) => c.lock?.state === "ACTIVE")!;
    const extended = [
      ...cases,
      pledgedCopy(cl003, 91, money("50000.00", "EUR"), money("70000.00", "EUR")),
      pledgedCopy(cl003, 92, money("20000.50", "USD"), null),
    ];
    const result = overview(extended, "lender-a-approver");
    expect(result.principal?.totals).toEqual([
      { total: { amount: "50000.00", currency: "EUR" }, count: 1 },
      { total: { amount: "200000.50", currency: "USD" }, count: 2 },
    ]);
    expect(result.principal?.coverage).toEqual({ included: 3, of: 3 });
    expect(result.valuation?.totals).toEqual([
      { total: { amount: "70000.00", currency: "EUR" }, count: 1 },
      { total: { amount: "260000.00", currency: "USD" }, count: 1 },
    ]);
    // The third pledge has no recorded valuation: excluded from the totals and reported in the coverage.
    expect(result.valuation?.coverage).toEqual({ included: 2, of: 3 });
  });

  it("shows the borrower only its own pledges' principal and never a valuation", () => {
    const { cases } = world();
    const manufacturer = overview(cases, "manufacturer-owner");
    // Demo Manufacturer has no active pledge in the main seed (CL-005 was released): nothing, not 0.
    expect(manufacturer.principal).toMatchObject({ totals: [], coverage: { included: 0, of: 0 }, dates: null });
    expect(manufacturer.valuation).toBeNull();
  });

  it("reveals nothing to unrelated or non-financial viewers", () => {
    const { cases } = world();
    const lenderB = overview(cases, "lender-b-approver");
    expect(lenderB.principal).toMatchObject({ totals: [], coverage: { of: 0 } });
    expect(lenderB.valuation).toMatchObject({ totals: [], coverage: { of: 0 } });
    for (const persona of ["dealer-contributor", "verifier-inspector", "auditor", "operator", "manufacturer-admin"] as const) {
      expect(overview(cases, persona), persona).toMatchObject({ principal: null, valuation: null });
    }
  });

  it("treats an agreement version that is not accepted as unavailable", () => {
    const { cases } = world();
    const cl003 = structuredClone(cases.find((c) => c.lock?.state === "ACTIVE")!);
    cl003.proposals = cl003.proposals.map((p) => ({ ...p, state: "ISSUED" as const }));
    const result = overview([cl003], "lender-a-approver");
    expect(result.principal).toMatchObject({ totals: [], coverage: { included: 0, of: 1 }, dates: null });
  });
});

describe("case.create asset action", () => {
  it("is allowed for the owner's registered asset only when no case holds it", () => {
    const { assets, cases } = world();
    const owner = personaActor("manufacturer-owner");
    const held = assets.find((a) => a.ref === "ASSET-DEMO-001")!;
    // CL-001 holds ASSET-DEMO-001; CL-005 (released) no longer holds its asset.
    expect(checkAssetAction(held, cases, owner, "case.create", NOW)).toEqual({ ok: false, reason: "CONFLICT", message: CASE_CREATE_COPY.ACTIVE_CASE });
    const released = cases.find((c) => c.borrowerOrgId === owner.orgId && c.lock?.state === "RELEASED")!.asset;
    expect(checkAssetAction(released, cases, owner, "case.create", NOW)).toEqual({ ok: true });
    expect(presentAssetDetail(released, cases, owner, pctx)?.allowedActions).toContain("case.create");
    expect(presentAssetDetail(held, cases, owner, pctx)?.allowedActions).not.toContain("case.create");

    const draft = { ...structuredClone(released), lifecycle: "DRAFT" as const };
    expect(checkAssetAction(draft, cases, owner, "case.create", NOW)).toMatchObject({ reason: "CONFLICT", message: CASE_CREATE_COPY.NOT_REGISTERED });
  });

  it("is forbidden without the borrower mandate and unavailable to unrelated organizations", () => {
    const { cases } = world();
    const released = cases.find((c) => c.lock?.state === "RELEASED")!.asset;
    // Demo Lender A is related to the asset (selected lender of its case) but cannot create a case for it.
    expect(checkAssetAction(released, cases, personaActor("lender-a-approver"), "case.create", NOW)).toMatchObject({ ok: false, reason: "FORBIDDEN" });
    expect(checkAssetAction(released, cases, personaActor("lender-b-approver"), "case.create", NOW)).toMatchObject({ ok: false, reason: "UNAVAILABLE" });
    expect(checkAssetAction(released, cases, personaActor("manufacturer-admin"), "case.create", NOW)).toMatchObject({ ok: false });
  });
});
