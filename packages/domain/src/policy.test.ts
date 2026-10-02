import { describe, expect, it } from "vitest";
import { buildScenario } from "./fixtures";
import {
  can,
  caseContext,
  PERMISSION_MATRIX,
  permissionMatrixView,
  POLICY_ACTIONS,
  POLICY_COLUMNS,
  type PolicyAction,
} from "./policy";
import { personaActor } from "./roles";
import { checkCaseAction } from "./workflow";

const now = new Date("2026-11-15T12:00:00Z");
const world = () => buildScenario({ now });
const cl001 = () => world().cases.find((c) => c.ref === "CL-001")!;

const CASE_SCOPED: PolicyAction[] = POLICY_ACTIONS.filter(
  (a) => !["passport.register", "governance.act", "members.manage"].includes(a),
);

describe("permission matrix data", () => {
  it("has exactly one row per policy action and a cell for every column", () => {
    expect(PERMISSION_MATRIX.map((r) => r.action).sort()).toEqual([...POLICY_ACTIONS].sort());
    for (const row of PERMISSION_MATRIX) expect(Object.keys(row.cells).sort()).toEqual([...POLICY_COLUMNS].sort());
  });

  it("denies the unrelated lender column on every row (Lender B)", () => {
    for (const row of PERMISSION_MATRIX) {
      expect(row.cells.UNRELATED_LENDER).toEqual({ text: "—", requirement: null });
    }
  });

  it("never lets a governance member release collateral", () => {
    const row = PERMISSION_MATRIX.find((r) => r.action === "release.decide")!;
    expect(row.cells.GOVERNANCE_MEMBER).toEqual({ text: "Never", requirement: null });
  });

  it("renders the Docs view from the same rows, marking unenforced cells", () => {
    const view = permissionMatrixView();
    expect(view.columns).toHaveLength(POLICY_COLUMNS.length);
    const terms = view.rows.find((r) => r.action === "terms.view")!;
    expect(terms.cells.find((c) => c.column === "BORROWER")).toMatchObject({ text: "Own agreement", access: "SCOPED", enforced: true });
    expect(terms.cells.find((c) => c.column === "VERIFIER")).toMatchObject({ text: "—", access: "DENIED", enforced: false });
    const register = view.rows.find((r) => r.action === "passport.register")!;
    expect(register.cells.find((c) => c.column === "BORROWER")).toMatchObject({ access: "ALLOWED" });
    expect(register.cells.find((c) => c.column === "DEALER")).toMatchObject({ access: "SCOPED", enforced: false });
  });
});

describe("can() against the CL-001 main seed", () => {
  it("denies Lender B every case-scoped action, including views", () => {
    const ctx = caseContext(cl001(), now);
    const lenderB = personaActor("lender-b-approver");
    for (const action of CASE_SCOPED) expect(can(lenderB, action, ctx), action).toBe(false);
  });

  it("gives verifier and dealer no loan terms and no internal notes", () => {
    const ctx = caseContext(cl001(), now);
    for (const id of ["verifier-inspector", "dealer-contributor"] as const) {
      expect(can(personaActor(id), "terms.view", ctx)).toBe(false);
      expect(can(personaActor(id), "lenderInternal.view", ctx)).toBe(false);
    }
  });

  it("separates analyst and approver mandates", () => {
    const ctx = caseContext(cl001(), now);
    const analyst = personaActor("lender-a-analyst");
    const approver = personaActor("lender-a-approver");
    expect(can(analyst, "review.assess", ctx)).toBe(true);
    expect(can(analyst, "review.decide", ctx)).toBe(false);
    expect(can(analyst, "proposal.issue", ctx)).toBe(false);
    expect(can(analyst, "proposal.draft", ctx)).toBe(true);
    expect(can(approver, "review.decide", ctx)).toBe(true);
    expect(can(approver, "proposal.issue", ctx)).toBe(true);
  });

  it("requires the approver mandate, not just the role", () => {
    const ctx = caseContext(cl001(), now);
    const noMandate = { ...personaActor("lender-a-approver"), mandates: [] };
    expect(can(noMandate, "review.decide", ctx)).toBe(false);
  });

  it("lets the borrower request but never decide a release", () => {
    const facts = cl001();
    facts.lock = {
      ref: "PL-001",
      state: "ACTIVE",
      lenderOrgId: "demo-lender-a",
      borrowerOrgId: "demo-manufacturer",
      activatedAt: now.toISOString(),
      activatedByUserId: "user-lender-a-approver",
      proposalRef: "FP-001",
      proposalVersion: 1,
      attestationRef: "ATT-001",
      packageRef: "PKG-001",
      packageVersion: 2,
      controlVersionConsumed: 3,
      controlVersionLocked: 4,
      releasedAt: null,
      releasedByUserId: null,
      controlVersionAfterRelease: null,
    };
    const ctx = caseContext(facts, now);
    const borrower = personaActor("manufacturer-owner");
    expect(can(borrower, "release.request", ctx)).toBe(true);
    expect(can(borrower, "release.decide", ctx)).toBe(false);
    expect(can(personaActor("lender-a-approver"), "release.decide", ctx)).toBe(true);
    expect(can(personaActor("lender-a-analyst"), "release.decide", ctx)).toBe(false);
    expect(can(personaActor("auditor"), "release.decide", ctx)).toBe(false);
  });

  it("does not let an invitation alone expose the case to the selected lender", () => {
    const facts = cl001();
    facts.shares = [];
    const ctx = caseContext(facts, now);
    expect(can(personaActor("lender-a-analyst"), "equipment.view", ctx)).toBe(false);
    expect(checkCaseAction(facts, personaActor("lender-a-analyst"), "review.saveAssessment", now)).toMatchObject({
      ok: false,
      reason: "UNAVAILABLE",
    });
  });

  it("restricts governance actions to seat mandates", () => {
    expect(can(personaActor("lender-a-approver"), "governance.act")).toBe(true);
    expect(can(personaActor("lender-b-approver"), "governance.act")).toBe(true);
    expect(can(personaActor("auditor"), "governance.act")).toBe(true);
    expect(can(personaActor("lender-a-analyst"), "governance.act")).toBe(false);
    expect(can(personaActor("operator"), "governance.act")).toBe(false);
  });
});

describe("auditor scope", () => {
  const grant = (side: "OWNER" | "LENDER", scopes: ("EVIDENCE_MANIFEST" | "PROPOSAL_TERMS" | "DECISION_OUTCOME")[]) => ({
    ref: side === "OWNER" ? "AG-002" : "AG-003",
    grantorOrgId: side === "OWNER" ? "demo-manufacturer" : "demo-lender-a",
    grantorSide: side,
    grantedByUserId: side === "OWNER" ? "user-manufacturer-owner" : "user-lender-a-approver",
    auditorOrgId: "demo-auditor",
    scopes,
    permission: "VIEW_EXPORT" as const,
    purpose: "Scoped audit",
    createdAt: now.toISOString(),
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: null,
  });

  it("sees nothing without a grant", () => {
    const ctx = caseContext(cl001(), now);
    for (const action of CASE_SCOPED) expect(can(personaActor("auditor"), action, ctx), action).toBe(false);
  });

  it("needs every record owner's consent for jointly owned scopes", () => {
    const facts = cl001();
    facts.auditGrants = [grant("OWNER", ["EVIDENCE_MANIFEST", "PROPOSAL_TERMS"])];
    let ctx = caseContext(facts, now);
    const auditor = personaActor("auditor");
    expect(can(auditor, "evidence.view", ctx)).toBe(true);
    expect(can(auditor, "terms.view", ctx)).toBe(false);
    facts.auditGrants.push(grant("LENDER", ["PROPOSAL_TERMS", "DECISION_OUTCOME"]));
    ctx = caseContext(facts, now);
    expect(can(auditor, "terms.view", ctx)).toBe(true);
    expect(can(auditor, "lenderInternal.view", ctx)).toBe(false);
    expect(can(auditor, "report.export", ctx)).toBe(true);
  });

  it("loses access when grants expire or are revoked", () => {
    const facts = cl001();
    facts.auditGrants = [{ ...grant("OWNER", ["EVIDENCE_MANIFEST"]), expiresAt: "2026-11-01T00:00:00.000Z" }];
    expect(can(personaActor("auditor"), "evidence.view", caseContext(facts, now))).toBe(false);
    facts.auditGrants = [{ ...grant("OWNER", ["EVIDENCE_MANIFEST"]), revokedAt: now.toISOString() }];
    expect(can(personaActor("auditor"), "evidence.view", caseContext(facts, now))).toBe(false);
  });
});
