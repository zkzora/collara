// Governance unit tests (no ledger): DM confirmation rules, staleness, the static "governance never touches
// collateral" guarantee, and the routes over a projected scenario (PGlite): seat-only access (404 for everyone
// else), the Tier A integration label, the verifier directory, non-member proposals never listed, and no
// simulated success without a ledger.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importLocalnetState, projectOnce, TEMPLATES as PT, type DbHandle } from "@collara/db";
import { buildScenario, FakeLedger, scenarioBindingState, scenarioParties } from "@collara/db/testing";
import { ApiProblemSchema, GOVERNANCE_INTEGRATION_LABELS, GovernanceProposalSchema, GovernanceStateSchema, VerifierEntrySchema, type PersonaId } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { idem, loginAs, seededDb, testApp, type TestApp } from "../../test-support";
import { executableConfirmations, governanceProposalRef, ledgerScopeOf, proposalStaleness } from "./rules";

const NOW = new Date("2026-10-02T12:00:00Z");
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000;

describe("DM confirmation rules (executable confirmations)", () => {
  const members = ["seat1", "seat2", "seat3"];
  const c = (contractId: string, confirmer: string, offset: number, expiresInMs: number, actionProposalCid = "prop") => ({ contractId, confirmer, actionProposalCid, offset, expiresAt: iso(expiresInMs) });

  it("keeps the newest live confirmation per member, so a seat that confirmed twice counts once", () => {
    const live = executableConfirmations([c("a", "seat1", 1, 20 * MIN), c("b", "seat1", 5, 25 * MIN), c("d", "seat2", 3, 20 * MIN)], { proposalCid: "prop", members, now: NOW });
    expect(live.map((x) => x.contractId)).toEqual(["d", "b"]);
    expect(executableConfirmations([c("a", "seat1", 1, 20 * MIN), c("b", "seat1", 5, 25 * MIN)], { proposalCid: "prop", members, now: NOW })).toHaveLength(1);
  });

  it("drops expired (or about to expire), non-member and other-proposal confirmations", () => {
    const live = executableConfirmations(
      [c("expired", "seat1", 1, -MIN), c("edge", "seat2", 2, 5_000), c("outsider", "lenderB", 3, 20 * MIN), c("other", "seat3", 4, 20 * MIN, "other-prop")],
      { proposalCid: "prop", members, now: NOW },
    );
    expect(live).toEqual([]);
  });

  it("a proposal is stale once its deadline passed or the pinned registry moved", () => {
    const proposal = { registryCid: "reg-1", expectedVersion: 1, proposalDeadline: iso(60 * MIN) };
    expect(proposalStaleness(proposal, { contractId: "reg-1", version: 1 }, NOW)).toBeNull();
    expect(proposalStaleness(proposal, { contractId: "reg-2", version: 2 }, NOW)).toBe("REGISTRY_MOVED");
    expect(proposalStaleness(proposal, { contractId: "reg-1", version: 2 }, NOW)).toBe("REGISTRY_MOVED");
    expect(proposalStaleness(proposal, null, NOW)).toBe("REGISTRY_MOVED");
    expect(proposalStaleness({ ...proposal, proposalDeadline: iso(-MIN) }, { contractId: "reg-1", version: 1 }, NOW)).toBe("DEADLINE_PASSED");
  });

  it("numbers proposals GP-001… and always pins the CNC scope checked at issuance", () => {
    expect(governanceProposalRef(0)).toBe("GP-001");
    expect(governanceProposalRef(11)).toBe("GP-012");
    expect(ledgerScopeOf("CNC_MACHINERY")).toEqual(["CNC_MACHINERY"]);
    expect(ledgerScopeOf(" Dimensional metrology · CNC equipment ")).toEqual(["CNC_MACHINERY", "Dimensional metrology · CNC equipment"]);
  });
});

describe("governance can never release collateral (static)", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const repo = join(here, "../../../../..");
  const files = [
    ...readdirSync(here)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(here, f)),
    join(here, "../../routes/workflow/governance.ts"),
    ...readdirSync(join(repo, "daml/collara/governance/daml/Collara/Governance")).map((f) => join(repo, "daml/collara/governance/daml/Collara/Governance", f)),
  ];
  const COLLATERAL = /CollateralLock|AssetControl|Lock_Release|Control_Activate|Release_Authorize|ReleaseRequest|ReleaseDecision|PledgeActivationAuthorization|controlActivate|lockRelease|releaseAuthorize|Collara\.Control|Collara\.Release|Collara\.Financing/;

  it("no governance source references collateral templates or choices", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    const offenders = files.filter((f) => COLLATERAL.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("every governance submission acts as the seat party, never as the organisation's business party", () => {
    const service = readFileSync(join(here, "service.ts"), "utf8");
    expect(service).not.toMatch(/as:\s*"business"/);
    expect((service.match(/as:\s*"seat"/g) ?? []).length).toBe((service.match(/commands:\s*\[/g) ?? []).length);
  });
});

describe("governance routes over a projected scenario (no ledger)", () => {
  let handle: DbHandle;
  let t: TestApp;
  const P = scenarioParties();
  const ledger = new FakeLedger();

  beforeAll(async () => {
    buildScenario("main", ledger, P);
    // A seat-1 Suspend VER-001 (pinned to registry v0) with its proposer's confirmation …
    let proposal = "";
    ledger.tx((tx) => {
      proposal = tx.create(
        PT.SuspendVerifierProposal,
        {
          governanceParty: P.governance,
          proposer: P.seat1,
          registryCid: "00registry",
          expectedVersion: "0",
          accreditationCid: "00accreditation",
          verifier: P.verifier,
          proposalDeadline: new Date(ledger.now().getTime() + 14 * 86_400_000).toISOString(),
          reason: "Synthetic test suspension",
        },
        { signatories: [P.seat1], observers: [P.governance] },
      );
    });
    ledger.tx((tx) => {
      tx.create(
        PT.GovernanceConfirmation,
        { governanceParty: P.governance, confirmer: P.seat1, actionProposalCid: proposal, actionLabel: "CollaraSuspendVerifier", expiresAt: new Date(ledger.now().getTime() + 30 * MIN).toISOString() },
        { signatories: [P.seat1, P.governance] },
      );
    });
    // … and a proposal "for" the governance party created by Lender B's business party (not a member).
    ledger.tx((tx) => {
      tx.create(
        PT.AddVerifierProposal,
        {
          governanceParty: P.governance,
          proposer: P.lenderB,
          registryCid: "00registry",
          expectedVersion: "0",
          verifier: P.lenderB,
          verifierRef: "VER-009",
          orgName: "Demo Lender B",
          scope: ["CNC_MACHINERY"],
          validUntil: null,
          proposalDeadline: new Date(ledger.now().getTime() + 14 * 86_400_000).toISOString(),
          reason: "Not a member",
        },
        { signatories: [P.lenderB], observers: [P.governance] },
      );
    });

    handle = await seededDb();
    await importLocalnetState(handle.db, scenarioBindingState());
    await projectOnce(handle.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P) });
    const clock = () => new Date(ledger.now().getTime() + MIN);
    t = await testApp({ db: handle, clock });
  });

  afterAll(async () => {
    await t?.close();
    await handle?.close();
  });

  const get = async (persona: PersonaId | null, url: string) =>
    t.app.inject({ method: "GET", url, headers: persona ? { cookie: await loginAs(t.app, persona) } : {} });
  const post = async (persona: PersonaId, url: string, body: unknown = {}, key: string | null = "gov-unit-key-0001") =>
    t.app.inject({ method: "POST", url, payload: body as object, headers: { cookie: await loginAs(t.app, persona), ...(key ? idem(key) : {}) } });

  it("seat holders get the Tier A state with the exact integration label", async () => {
    const res = await get("lender-a-approver", "/api/governance/state");
    expect(res.statusCode).toBe(200);
    const state = GovernanceStateSchema.parse(res.json());
    expect(state.integration.status).toBe("PARTIAL_TIER_A");
    expect(state.integration.label).toBe("Partial — governance contracts on one local participant; decentralized party not demonstrated");
    expect(state.integration.label).toBe(GOVERNANCE_INTEGRATION_LABELS.PARTIAL_TIER_A);
    expect(state.threshold).toBe(2);
    expect(state.seats.map((s) => [s.seat, s.org.id])).toEqual([
      [1, "demo-lender-a"],
      [2, "demo-lender-b"],
      [3, "demo-auditor"],
    ]);
    expect(state.viewerSeat).toBe(1);
    expect(state.registryVersion).toBe(0);
    expect(state.confirmationTimeoutHours).toBe(0.5);
    expect(state.counts).toEqual({ activeVerifiers: 1, suspendedVerifiers: 0, openProposals: 1 });
  });

  it("lists only seat proposals, with live confirmations and the viewer's allowed actions", async () => {
    const asSeat1 = z.array(GovernanceProposalSchema).parse((await get("lender-a-approver", "/api/governance/proposals")).json());
    expect(asSeat1.map((p) => [p.ref, p.type, p.state.value, p.liveConfirmations])).toEqual([["GP-001", "SUSPEND_VERIFIER", "OPEN", 1]]);
    expect(asSeat1[0]?.allowedActions).toEqual(["cancel"]);
    expect(asSeat1[0]?.target.verifierRef).toBe("VER-001");
    const asSeat3 = GovernanceProposalSchema.parse((await get("auditor", "/api/governance/proposals/GP-001")).json());
    expect(asSeat3.allowedActions).toEqual(["confirm"]);
    expect((await get("lender-a-approver", "/api/governance/proposals/GP-002")).statusCode).toBe(404);
  });

  it("everyone without a seat gets the 404-shaped response on every governance route (401 when signed out)", async () => {
    const unknown = await get("lender-a-approver", "/api/governance/proposals/GP-999");
    for (const persona of ["manufacturer-owner", "manufacturer-admin", "dealer-contributor", "verifier-inspector", "lender-a-analyst"] as const) {
      for (const url of ["/api/governance/state", "/api/governance/proposals", "/api/governance/proposals/GP-001"]) {
        const res = await get(persona, url);
        expect(res.statusCode, `${persona} GET ${url}`).toBe(404);
        expect(ApiProblemSchema.parse(res.json())).toMatchObject({ code: "unavailable", detail: "This record is unavailable to your account." });
        expect(res.json().detail).toBe(unknown.json().detail);
      }
      for (const url of ["/api/governance/proposals/GP-001/confirmations", "/api/governance/proposals/GP-001/execute", "/api/governance/proposals/GP-001/cancel"]) {
        expect((await post(persona, url, { confirmer: P.seat1, seat: 1 })).statusCode, `${persona} POST ${url}`).toBe(404);
      }
      expect((await post(persona, "/api/governance/proposals", { type: "SUSPEND_VERIFIER", verifierRef: "VER-001", rationale: "x" })).statusCode).toBe(404);
    }
    expect((await get(null, "/api/governance/state")).statusCode).toBe(401);
  });

  it("GET /verifiers: the registry for every member, open proposals only for seat holders", async () => {
    const borrower = z.array(VerifierEntrySchema).parse((await get("manufacturer-owner", "/api/verifiers")).json());
    expect(borrower.map((v) => [v.ref, v.status.value, v.pendingProposal])).toEqual([["VER-001", "ACTIVE", null]]);
    const seat = z.array(VerifierEntrySchema).parse((await get("lender-a-approver", "/api/verifiers")).json());
    expect(seat.map((v) => [v.ref, v.status.value, v.pendingProposal?.ref ?? null, v.pendingProposal?.confirmations ?? null])).toEqual([["VER-001", "ACTIVE", "GP-001", 1]]);
    // The non-member's proposal never shows up as a proposed verifier.
    expect(seat.some((v) => v.ref === "VER-009")).toBe(false);
  });

  it("seat mutations without a ledger fail as ledger unavailable (never simulated); the Idempotency-Key is required", async () => {
    const res = await post("lender-a-approver", "/api/governance/proposals/GP-001/execute");
    expect(res.statusCode).toBe(503);
    expect(ApiProblemSchema.parse(res.json())).toMatchObject({ code: "ledger_unavailable", detail: "The ledger is unavailable. No confirmed state change has been recorded." });
    expect((await post("lender-a-approver", "/api/governance/proposals/GP-001/confirmations", {}, null)).statusCode).toBe(400);
    // The action endpoints take no body: an absent body is fine (it is not a validation error).
    const bare = await t.app.inject({ method: "POST", url: "/api/governance/proposals/GP-001/confirmations", headers: { cookie: await loginAs(t.app, "auditor"), ...idem("gov-unit-key-0002") } });
    expect(bare.statusCode, bare.body).toBe(503);
  });
});
