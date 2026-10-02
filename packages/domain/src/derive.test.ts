import { describe, expect, it } from "vitest";
import {
  activationPrerequisites,
  attestationValidity,
  deriveCaseStage,
  deriveNextAction,
  evidenceCompleteness,
  pledgeDisplayState,
} from "./derive";
import { buildScenario, clock } from "./fixtures";
import { governanceProposalState, liveConfirmationSeats, verifierActiveLookup } from "./governance";

const now = new Date("2026-11-15T12:00:00Z");
const scenario = () => buildScenario({ now });
const byRef = (ref: string) => {
  const found = scenario().cases.find((c) => c.ref === ref);
  if (!found) throw new Error(ref);
  return found;
};

describe("fixture rows → case stage and next actor (§1.5.1)", () => {
  it.each([
    ["CL-001", "LENDER_REVIEW", { orgId: "demo-lender-a", role: "LENDER_ANALYST" }, "REVIEW_EVIDENCE"],
    ["CL-002", "LENDER_REVIEW", { orgId: "demo-machining", role: "BORROWER" }, "PROVIDE_INFORMATION"],
    ["CL-003", "PLEDGE_ACTIVE", null, null],
    ["CL-004", "LENDER_REVIEW", { orgId: "demo-lender-a", role: "LENDER_APPROVER" }, "DECIDE_ELIGIBILITY"],
    ["CL-005", "CLOSED", null, "EXPORT_CASE_HISTORY"],
  ] as const)("%s is %s", (ref, stage, actor, action) => {
    const facts = byRef(ref);
    expect(deriveCaseStage(facts, now)).toBe(stage);
    const next = deriveNextAction(facts, now);
    expect(next.nextActor).toEqual(actor);
    expect(next.action).toBe(action);
  });

  it("keeps the main seed free of proposals and locks", () => {
    const facts = byRef("CL-001");
    expect(facts.review.state).toBe("SUBMITTED");
    expect(facts.proposals).toEqual([]);
    expect(facts.lock).toBeNull();
    expect(pledgeDisplayState(facts)).toBe("AVAILABLE");
    expect(evidenceCompleteness(facts.asset).complete).toBe(true);
  });

  it("derives the pledge composite for active and released rows", () => {
    expect(pledgeDisplayState(byRef("CL-003"))).toBe("ACTIVE");
    expect(pledgeDisplayState(byRef("CL-005"))).toBe("RELEASED");
  });
});

describe("stage rules evaluated top-down", () => {
  it("CANCELLED only before a lock; a cancelled case with an active lock stays PLEDGE_ACTIVE", () => {
    const draft = byRef("CL-001");
    draft.cancelledAt = now.toISOString();
    expect(deriveCaseStage(draft, now)).toBe("CANCELLED");
    const locked = byRef("CL-003");
    locked.cancelledAt = now.toISOString();
    expect(deriveCaseStage(locked, now)).toBe("PLEDGE_ACTIVE");
  });

  it("RELEASE_REVIEW while a release request is open; the lock stays active", () => {
    const facts = byRef("CL-003");
    facts.releaseRequests.push({
      ref: "RR-001",
      lockRef: facts.lock!.ref,
      state: "REQUESTED",
      reason: "EXTERNAL_LOAN_COMPLETION",
      note: null,
      servicingRef: null,
      requestedByOrgId: facts.borrowerOrgId,
      requestedByUserId: "user-demo-fabrication",
      requestedAt: now.toISOString(),
      informationRequest: null,
      decidedAt: null,
      decidedByUserId: null,
      decisionReason: null,
    });
    expect(deriveCaseStage(facts, now)).toBe("RELEASE_REVIEW");
    expect(pledgeDisplayState(facts)).toBe("RELEASE_REQUESTED");
    expect(deriveNextAction(facts, now).nextActor).toEqual({ orgId: "demo-lender-a", role: "LENDER_APPROVER" });
    facts.releaseRequests[0]!.state = "REJECTED";
    expect(deriveCaseStage(facts, now)).toBe("PLEDGE_ACTIVE");
    expect(pledgeDisplayState(facts)).toBe("RELEASE_REJECTED");
    expect(facts.lock?.state).toBe("ACTIVE");
  });

  it("PROPOSAL after eligibility, then sub-steps issue → accept → authorize → activate", () => {
    const facts = byRef("CL-003");
    facts.lock = null;
    facts.activation = null;
    facts.asset.control = { version: 1, state: "AVAILABLE", lockRef: null };
    facts.proposals = [];
    expect(deriveCaseStage(facts, now)).toBe("PROPOSAL");
    expect(deriveNextAction(facts, now).action).toBe("ISSUE_PROPOSAL");
  });

  it("REJECTED, VERIFICATION, EVIDENCE_COLLECTION and DRAFT", () => {
    const rejected = byRef("CL-001");
    rejected.review.state = "REJECTED";
    expect(deriveCaseStage(rejected, now)).toBe("REJECTED");

    const verifying = byRef("CL-001");
    verifying.review.state = "NOT_SUBMITTED";
    verifying.asset.verifications[0]!.state = "IN_REVIEW";
    expect(deriveCaseStage(verifying, now)).toBe("VERIFICATION");
    expect(deriveNextAction(verifying, now).nextActor).toEqual({ orgId: "demo-verifier", role: "VERIFIER" });

    const missing = byRef("CL-001");
    missing.review.state = "NOT_SUBMITTED";
    missing.asset.documents = missing.asset.documents.filter((d) => d.type !== "DEALER_INVOICE");
    expect(deriveCaseStage(missing, now)).toBe("EVIDENCE_COLLECTION");
    expect(deriveNextAction(missing, now).blockers[0]?.message).toBe(
      "Required evidence is missing. Review the checklist before submitting.",
    );

    const draft = byRef("CL-001");
    draft.review.state = "NOT_SUBMITTED";
    expect(deriveCaseStage(draft, now)).toBe("DRAFT");
    expect(deriveNextAction(draft, now).action).toBe("REVIEW_SHARING");
  });
});

describe("attestation validity and prerequisites", () => {
  it("computes EXPIRED from validUntil at read time", () => {
    const att = byRef("CL-001").asset.attestations[0]!;
    expect(attestationValidity(att, now)).toBe("VALID");
    expect(attestationValidity(att, new Date(Date.parse(att.validUntil) + 1000))).toBe("EXPIRED");
    expect(attestationValidity({ ...att, revokedAt: now.toISOString() }, now)).toBe("REVOKED");
  });

  it("lists activation prerequisites, pending for the main seed", () => {
    const prereqs = activationPrerequisites(byRef("CL-001"), now);
    expect(prereqs.map((p) => [p.code, p.done])).toEqual([
      ["DECISION", false],
      ["PROPOSAL_ACCEPTED", false],
      ["ACTIVATION_AUTHORIZED", false],
      ["ATTESTATION_VALID", true],
      ["EVIDENCE_MATCHES", true],
      ["CONTROL_AVAILABLE", true],
    ]);
  });
});

describe("fixtures are relative to now", () => {
  it("shifts every date with the injected clock", () => {
    const a = buildScenario({ now: new Date("2026-10-01T14:32:05Z") });
    const b = buildScenario({ now: new Date("2027-06-01T14:32:05Z") });
    const shift = Date.parse("2027-06-01T14:32:05Z") - Date.parse("2026-10-01T14:32:05Z");
    const attA = a.assets[0]!.attestations[0]!;
    const attB = b.assets[0]!.attestations[0]!;
    expect(Date.parse(attB.validUntil) - Date.parse(attA.validUntil)).toBe(shift);
    expect(attA.issuedAt).toBe("2026-09-10T17:02:00.000Z");
  });

  it("keeps every fixture timestamp in the past except validity and expiry dates", () => {
    const world = scenario();
    const events = [...world.cases.flatMap((c) => c.events), ...world.assets.flatMap((a) => a.events)];
    for (const e of events) expect(Date.parse(e.occurredAt)).toBeLessThanOrEqual(now.getTime());
  });

  it("clean-start has orgs and the registry only", () => {
    const clean = buildScenario({ now, profile: "clean-start" });
    expect(clean.cases).toEqual([]);
    expect(clean.assets).toEqual([]);
    expect(clean.governance.verifiers.map((v) => v.ref)).toEqual(["VER-001", "VER-002", "VER-003"]);
  });

  it("exposes CL-001 dates with the clock helper", () => {
    expect(clock(now).daysAgo(1)).toBe("2026-11-14T12:00:00.000Z");
  });
});

describe("governance (DM semantics)", () => {
  it("derives proposal states from confirmations, registry version and deadline", () => {
    const fixedNow = new Date("2026-10-01T14:32:05Z");
    const gov = buildScenario({ now: fixedNow }).governance;
    const state = (ref: string) => governanceProposalState(gov.proposals.find((p) => p.ref === ref)!, gov, fixedNow);
    expect(state("GP-001")).toBe("EXECUTED");
    expect(state("GP-002")).toBe("EXECUTED");
    expect(state("GP-003")).toBe("CANCELLED");
    expect(state("GP-004")).toBe("OPEN");
    expect(liveConfirmationSeats(gov.proposals[3]!, gov, fixedNow)).toEqual([2]);
    expect(verifierActiveLookup(gov)("VER-001")).toBe(true);
    expect(verifierActiveLookup(gov)("VER-003")).toBe(false);
  });

  it("does not count duplicate confirmations from one seat", () => {
    const fixedNow = new Date("2026-10-01T14:32:05Z");
    const gov = buildScenario({ now: fixedNow }).governance;
    const gp4 = gov.proposals[3]!;
    gp4.confirmations.push({ seat: 2, confirmedAt: fixedNow.toISOString() });
    expect(governanceProposalState(gp4, gov, fixedNow)).toBe("OPEN");
    gp4.confirmations.push({ seat: 1, confirmedAt: fixedNow.toISOString() });
    expect(governanceProposalState(gp4, gov, fixedNow)).toBe("EXECUTABLE");
    gov.registryVersion += 1;
    expect(governanceProposalState(gp4, gov, fixedNow)).toBe("STALE");
  });
});
