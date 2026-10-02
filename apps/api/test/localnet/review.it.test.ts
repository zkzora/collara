// LocalNet (LOCALNET_IT=1): the other review/proposal/release branches on a fresh prefix:
//   information round on the review (NEEDS_INFORMATION → the analyst's next save restarts the review),
//   a draft (application record only), borrower decline, lender withdraw, a new proposal accepted,
//   activation, and a release request withdrawn by its requester (lock stays ACTIVE).
import { COMMAND_COPY, SIMULATED_COPY } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSET, CASE, expectOk, ledgerTokens, PRINCIPAL } from "./financing-fixture";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type ItSession, type LocalnetHarness } from "./harness";

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet review, proposal and release branches", () => {
  let h: LocalnetHarness;
  let analyst: ItSession;
  let approver: ItSession;
  let borrower: ItSession;
  const facts: Record<string, unknown> = {};

  const save = () =>
    analyst.inject("POST", `/api/cases/${CASE}/assessments`, {
      body: { valuation: { amount: "150000.00", currency: "USD" }, valuationSource: "Synthetic desk valuation (demo)", valuationDate: new Date().toISOString().slice(0, 10), limitations: "", outcome: "ELIGIBLE", policyRef: "CP-2026-CNC-01" },
    });
  const status = async () => (await h.acsAs("lenderA", "CollateralAssessment", (a) => a.caseRef === CASE))[0]?.payload.status;
  const proposals = async () => (await h.acsAs("borrower", "FinancingProposal", (p) => p.caseRef === CASE)).map((p) => `${p.payload.proposalRef} v${p.payload.version}`);
  const ok = async (response: ReturnType<ItSession["inject"]>, label: string) => {
    const body = expectOk(await response, label);
    await h.project();
    return body;
  };

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "ep2r" });
    await h.seed("main", { skipDocuments: true });
    await h.project();
    analyst = await h.loginAs("lender-a-analyst");
    approver = await h.loginAs("lender-a-approver");
    borrower = await h.loginAs("manufacturer-owner");
    facts.prefix = h.prefix;
  });
  afterAll(async () => {
    console.log(`LocalNet review-branch facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("information round: NEEDS_INFORMATION is shared with the borrower; the next save restarts the review", async () => {
    await ok(save(), "save");
    await ok(approver.inject("POST", "/api/reviews/CA-001/information-requests", { body: { message: "Please add the latest maintenance log." } }), "request information");
    expect(await status()).toBe("NEEDS_INFORMATION");
    const notice = (await h.acsAs("borrower", "LenderDecisionNotice", (n) => n.caseRef === CASE))[0]!.payload;
    expect(notice).toMatchObject({ outcome: "NEEDS_INFORMATION", sharedFeedback: "Please add the latest maintenance log." });
    expect((await borrower.inject("GET", "/api/reviews/CA-001")).json()).toMatchObject({ state: { value: "NEEDS_INFORMATION" }, informationRequest: "Please add the latest maintenance log." });
    // Submitting for approval from NEEDS_INFORMATION is a state conflict (approved copy), nothing submitted.
    const early = await analyst.inject("POST", "/api/reviews/CA-001/submit-for-approval", { body: {} });
    expect(early.statusCode).toBe(409);
    expect(early.json().detail).toBe(COMMAND_COPY.STATE_CHANGED);
    await ok(save(), "save again (start + save)");
    expect(await status()).toBe("IN_REVIEW");
    await ok(approver.inject("POST", "/api/reviews/CA-001/decision", { body: { outcome: "ELIGIBLE" } }), "decide eligible");
    expect(await status()).toBe("ELIGIBLE");
  });

  it("proposals: draft is an application record; decline and withdraw archive the version; a new proposal is accepted", async () => {
    const draft = await analyst.inject("POST", `/api/cases/${CASE}/proposals`, { body: { intent: "DRAFT", principal: PRINCIPAL } });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().command).toMatchObject({ target: "APPLICATION", state: "COMMITTED", message: SIMULATED_COPY.APPLICATION_RECORD_SAVED });
    expect(draft.json().command.updateId).toBeUndefined();
    expect(await proposals()).toEqual([]);

    const first = await ok(approver.inject("POST", `/api/cases/${CASE}/proposals`, { body: { intent: "ISSUE", principal: PRINCIPAL } }), "issue FP-001");
    expect(first.result).toEqual({ proposalRef: "FP-001", version: 1 });
    // A second live proposal is refused while FP-001 is open.
    expect((await approver.inject("POST", `/api/cases/${CASE}/proposals`, { body: { intent: "ISSUE", principal: PRINCIPAL } })).statusCode).toBe(409);
    await ok(borrower.inject("POST", "/api/proposals/FP-001/decline", { body: { expectedVersion: 1, reason: "Terms under discussion (synthetic)." } }), "decline FP-001");
    expect(await proposals()).toEqual([]);
    expect((await borrower.inject("GET", "/api/proposals/FP-001")).json()).toMatchObject({ ref: "FP-001", state: { value: "DECLINED" } });

    const second = await ok(approver.inject("POST", `/api/cases/${CASE}/proposals`, { body: { intent: "ISSUE", principal: PRINCIPAL } }), "issue FP-002");
    expect(second.result).toEqual({ proposalRef: "FP-002", version: 1 });
    expect((await analyst.inject("POST", "/api/proposals/FP-002/withdraw", { body: {} })).statusCode).toBe(403);
    await ok(approver.inject("POST", "/api/proposals/FP-002/withdraw", { body: { reason: "Superseded (synthetic)." } }), "withdraw FP-002");
    expect(await proposals()).toEqual([]);
    expect((await approver.inject("GET", "/api/proposals/FP-002")).json()).toMatchObject({ state: { value: "WITHDRAWN" } });

    const third = await ok(approver.inject("POST", `/api/cases/${CASE}/proposals`, { body: { intent: "ISSUE", principal: PRINCIPAL } }), "issue FP-003");
    expect(third.result).toEqual({ proposalRef: "FP-003", version: 1 });
    await ok(borrower.inject("POST", "/api/proposals/FP-003/acceptance", { body: { expectedVersion: 1 } }), "accept FP-003");
    expect((await h.acsAs("borrower", "FinancingAgreement", (a) => a.caseRef === CASE)).map((a) => a.payload.agreementRef)).toEqual(["FP-003"]);
    facts.proposals = ["FP-001 declined", "FP-002 withdrawn", "FP-003 accepted"];
  });

  it("release request withdrawn by the requester: the lock stays ACTIVE; a new request is possible", async () => {
    await ok(borrower.inject("POST", "/api/proposals/FP-003/activation-authorization", { body: { expectedVersion: 1 } }), "authorize");
    const activated = await ok(approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} }), "activate");
    expect(activated.result).toEqual({ pledgeRef: "PL-001" });
    await ok(borrower.inject("POST", "/api/pledges/PL-001/release-requests", { body: { reason: "REFINANCING" } }), "request RR-001");
    // Only the requester withdraws.
    expect((await approver.inject("POST", "/api/release-requests/RR-001/withdraw", { body: {} })).statusCode).toBe(403);
    await ok(borrower.inject("POST", "/api/release-requests/RR-001/withdraw", { body: {} }), "withdraw RR-001");
    expect(await h.acsAs("borrower", "ReleaseRequest", (r) => r.lockRef === "PL-001")).toHaveLength(0);
    expect(await ledgerTokens(h)).toEqual({ locksLender: 1, locksBorrower: 1, controls: 0 });
    expect((await borrower.inject("GET", "/api/release-requests/RR-001")).json()).toMatchObject({ state: { value: "WITHDRAWN" } });
    const next = await ok(borrower.inject("POST", "/api/pledges/PL-001/release-requests", { body: { reason: "REFINANCING" } }), "request RR-002");
    expect(next.result).toEqual({ releaseRequestRef: "RR-002" });
    expect((await h.acsAs("lenderA", "CollateralLock", (l) => l.assetId === ASSET)).map((l) => l.payload.lockRef)).toEqual(["PL-001"]);
  });
});
