// LocalNet governance (LOCALNET_IT=1): Tier A DM GovernanceRules 2-of-3 + the verifier registry on a fresh "ep3-…"
// prefix of the shared sandbox (main seed, ledger-only). Every claim is checked on the LEDGER (ACS as the seat,
// registrar or verifier ledger user) and through the API (projection → read model → presenters).
// Direct ledger submissions (`ledgerAs`) bypass the API's pre-checks on purpose, to prove the ledger itself
// rejects: one confirmation, duplicate confirmers, a stale proposal, a suspended verifier's attestation, and a
// confirmation by Lender B's business party.
import { randomUUID } from "node:crypto";
import type { LedgerCommand } from "@collara/canton";
import { commands as commandsTable } from "@collara/db";
import { ApiProblemSchema, CommandStatusSchema, GovernanceProposalSchema, GovernanceStateSchema, VerifierEntrySchema, type PersonaId } from "@collara/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ledgerCommands as L } from "../../src/ledger";
import type { PrepareContext, WorkflowOutcome } from "../../src/workflow";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type HttpMethod, type InjectOptions, type ItSession, type LocalnetHarness } from "./harness";

const CommandBody = z.object({ command: CommandStatusSchema });
const ProposeBody = z.object({ command: CommandStatusSchema, result: z.object({ proposalRef: z.string() }) });
const DAY = 86_400_000;
const NON_SEATS = ["manufacturer-owner", "manufacturer-admin", "dealer-contributor", "verifier-inspector", "lender-a-analyst"] as const satisfies readonly PersonaId[];
const TIER_A_LABEL = "Partial — governance contracts on one local participant; decentralized party not demonstrated";

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet governance: Tier A 2-of-3 and the verifier registry", () => {
  let h: LocalnetHarness;
  let seat1: ItSession; // Demo Lender A approver (seat 1)
  let seat2: ItSession; // Demo Lender B approver (seat 2)
  let seat3: ItSession; // Demo Auditor (seat 3)
  let borrower: ItSession;
  const facts: Record<string, unknown> = {};
  const counts = { apiCalls: 0, ledgerRejections: 0, ledgerCommits: 0 };
  let ns = "";
  let oldAccreditationCid = "";
  let gp001Cid = "";

  // --- helpers -----------------------------------------------------------------------------------------
  const call = async (as: ItSession | null, method: HttpMethod, path: string, options: InjectOptions = {}) => {
    counts.apiCalls += 1;
    return h.inject(method, path, { ...options, as });
  };

  /** A submission straight through the runner (no API pre-checks). */
  const ledgerAs = async (persona: PersonaId, as: "seat" | "business", label: string, commands: (ctx: PrepareContext) => Promise<LedgerCommand[]>): Promise<WorkflowOutcome<null>> => {
    const actor = await h.actor(persona);
    const outcome = await h.workflow.run<null>({
      actor,
      operation: `it.governance.${label}`,
      idempotencyKey: `it-${randomUUID()}`,
      payload: { label },
      prepare: async (ctx) => ({ as, commands: await commands(ctx) }),
    });
    if (outcome.committed) counts.ledgerCommits += 1;
    else counts.ledgerRejections += 1;
    return outcome;
  };

  const rules = async () => (await h.acsAs("seat1", "GovernanceRules"))[0]!;
  const registry = async () => {
    const all = await h.acsAs("registrar", "VerifierRegistry", (r) => r.registryId === ns);
    expect(all).toHaveLength(1);
    return all[0]!;
  };
  const accreditations = () => h.acsAs("verifier", "VerifierAccreditation", (a) => a.registryId === ns && a.verifier === h.party("verifier"));
  const mirror = async () => (await h.acsAs("registrar", "VerifierStatusMirror", (m) => m.namespace === ns && m.verifier === h.party("verifier")))[0]!;
  const confirmationsOf = (proposalCid: string) => h.acsAs("seat1", "GovernanceConfirmation", (c) => c.actionProposalCid === proposalCid);
  const proposal = async (as: ItSession, ref: string) => {
    const res = await call(as, "GET", `/api/governance/proposals/${ref}`);
    expect(res.statusCode, res.body).toBe(200);
    return GovernanceProposalSchema.parse(res.json());
  };
  const verifiers = async (as: ItSession) => {
    const res = await call(as, "GET", "/api/verifiers");
    expect(res.statusCode, res.body).toBe(200);
    return z.array(VerifierEntrySchema).parse(res.json());
  };
  const expectProblem = (res: Awaited<ReturnType<typeof call>>, status: number, detail?: string) => {
    expect(res.statusCode, res.body).toBe(status);
    const problem = ApiProblemSchema.parse(res.json());
    if (detail) expect(problem.detail).toBe(detail);
    return problem;
  };

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "ep3" });
    ns = h.namespace;
    const started = Date.now();
    const seed = await h.seed("main", { skipDocuments: true });
    facts.prefix = h.prefix;
    facts.seed = { ms: Date.now() - started, steps: seed.steps.length };
    await h.project();
    [seat1, seat2, seat3, borrower] = await Promise.all([h.loginAs("lender-a-approver"), h.loginAs("lender-b-approver"), h.loginAs("auditor"), h.loginAs("manufacturer-owner")]);
  });

  afterAll(async () => {
    facts.counts = counts;
    console.log(`LocalNet governance facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("before any change: Tier A state for seat holders, VER-001 ACTIVE in the registry, 404 for everyone else", async () => {
    const res = await call(seat1, "GET", "/api/governance/state");
    expect(res.statusCode, res.body).toBe(200);
    const state = GovernanceStateSchema.parse(res.json());
    expect(state.integration).toMatchObject({ status: "PARTIAL_TIER_A", label: TIER_A_LABEL });
    expect(state.threshold).toBe(2);
    expect(state.seats.map((s) => [s.seat, s.org.id])).toEqual([
      [1, "demo-lender-a"],
      [2, "demo-lender-b"],
      [3, "demo-auditor"],
    ]);
    expect(state.viewerSeat).toBe(1);
    expect(state.registryVersion).toBe(0);
    expect(state.counts).toEqual({ activeVerifiers: 1, suspendedVerifiers: 0, openProposals: 0 });
    expect(GovernanceStateSchema.parse((await call(seat2, "GET", "/api/governance/state")).json()).viewerSeat).toBe(2);

    expect((await verifiers(borrower)).map((v) => [v.ref, v.orgName, v.status.value, v.pendingProposal])).toEqual([["VER-001", "Demo Verifier", "ACTIVE", null]]);

    for (const persona of NON_SEATS) {
      const session = await h.loginAs(persona);
      for (const path of ["/api/governance/state", "/api/governance/proposals", "/api/governance/proposals/GP-001"]) {
        expectProblem(await call(session, "GET", path, { headers: { "x-collara-org": "demo-lender-a" } }), 404, "This record is unavailable to your account.");
      }
    }
    expect((await call(null, "GET", "/api/governance/state")).statusCode).toBe(401);
  });

  it("setup: VR-002 for Demo Verifier is IN_REVIEW before the suspension", async () => {
    const requested = await ledgerAs("manufacturer-owner", "business", "vr002-request", async (ctx) => {
      const manifest = (await ctx.acs.list("EvidenceManifest", (m) => m.namespace === ns && m.packageRef === "PKG-001")).at(-1)!;
      const passport = (await ctx.acs.one("AssetPassport", (p) => p.assetId === "ASSET-DEMO-001" && p.namespace === ns))!;
      return [
        L.manifestRequestVerification(manifest.contractId, {
          verifier: h.party("verifier"),
          requestRef: "VR-002",
          passportVersion: passport.payload.passportVersion,
          caseRef: "CL-001",
          equipmentScope: "CNC_MACHINERY",
          checklist: ["Serial number consistency", "Inspected condition"],
          dueBy: new Date(ctx.now.getTime() + 10 * DAY),
          actorRef: ctx.actorRef,
        }),
      ];
    });
    expect(requested.committed, requested.record.errorMessage ?? "").toBe(true);
    const [accreditation] = await accreditations();
    oldAccreditationCid = accreditation!.contractId;
    const accepted = await ledgerAs("verifier-inspector", "business", "vr002-accept", async (ctx) => {
      const request = (await ctx.acs.one("VerificationRequest", (r) => r.requestRef === "VR-002" && r.namespace === ns))!;
      const config = (await ctx.acs.one("CollaraConfig", (c) => c.namespace === ns))!;
      return [L.vrAcceptAssignment(request.contractId, { configCid: config.contractId, accreditationCid: oldAccreditationCid, actorRef: ctx.actorRef })];
    });
    expect(accepted.committed, accepted.record.errorMessage ?? "").toBe(true);
    expect((await h.acsAs("verifier", "VerificationRequest", (r) => r.requestRef === "VR-002"))[0]?.payload.status).toBe("IN_REVIEW");
  });

  it("propose Suspend VER-001 (seat 1, auto-confirmed): one confirmation cannot execute — API 409 and ledger rejection", async () => {
    const res = await call(seat1, "POST", "/api/governance/proposals", {
      // proposer/seat/party fields are not part of the contract and are ignored (authority is server-side).
      body: { type: "SUSPEND_VERIFIER", verifierRef: "VER-001", rationale: "Synthetic test: accreditation under review.", proposer: h.party("lenderB"), seat: 3 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = ProposeBody.parse(res.json());
    expect(body.result.proposalRef).toBe("GP-001");
    expect(body.command).toMatchObject({ state: "COMMITTED", simulated: false, message: "Confirmed on the ledger." });
    expect(body.command.updateId).toBeTruthy();

    const [onLedger] = await h.acsAs("seat1", "SuspendVerifierProposal");
    gp001Cid = onLedger!.contractId;
    const reg = await registry();
    expect(onLedger!.payload).toMatchObject({ proposer: h.party("seat1"), governanceParty: h.party("governance"), registryCid: reg.contractId, expectedVersion: 0, verifier: h.party("verifier"), accreditationCid: oldAccreditationCid });
    const confirmations = await confirmationsOf(gp001Cid);
    expect(confirmations.map((c) => c.payload.confirmer)).toEqual([h.party("seat1")]);

    await h.project();
    const view = await proposal(seat1, "GP-001");
    expect([view.state.value, view.liveConfirmations, view.allowedActions]).toEqual(["OPEN", 1, ["cancel"]]);

    expectProblem(await call(seat1, "POST", "/api/governance/proposals/GP-001/execute"), 409, "Execution needs 2 live confirmations from distinct seats.");

    const direct = await ledgerAs("lender-a-approver", "seat", "execute-one", async () => [
      L.executeConfirmedAction((await rules()).contractId, { executor: h.party("seat1"), actionProposalCid: gp001Cid, confirmations: confirmations.map((c) => c.contractId) }),
    ]);
    expect(direct.record.status).toBe("REJECTED");
    facts.oneConfirmationRejection = direct.record.errorMessage;
    expect(direct.record.errorMessage).toMatch(/Enough confirmations/);
    expect((await registry()).payload.version).toBe(0);
  });

  it("a seat confirming twice does not count twice (API 409; the ledger accepts the duplicate but never counts it)", async () => {
    expectProblem(await call(seat1, "POST", "/api/governance/proposals/GP-001/confirmations"), 409, "This proposal cannot be confirmed by your seat in its current state.");

    const again = await ledgerAs("lender-a-approver", "seat", "confirm-twice", async () => [L.confirmAction((await rules()).contractId, { confirmer: h.party("seat1"), actionProposalCid: gp001Cid })]);
    expect(again.committed).toBe(true);
    const both = await confirmationsOf(gp001Cid);
    expect(both.map((c) => c.payload.confirmer)).toEqual([h.party("seat1"), h.party("seat1")]);

    const duplicate = await ledgerAs("lender-a-approver", "seat", "execute-duplicates", async () => [
      L.executeConfirmedAction((await rules()).contractId, { executor: h.party("seat1"), actionProposalCid: gp001Cid, confirmations: both.map((c) => c.contractId) }),
    ]);
    expect(duplicate.record.status).toBe("REJECTED");
    facts.duplicateConfirmersRejection = duplicate.record.errorMessage;
    expect(duplicate.record.errorMessage).toMatch(/No duplicate confirmers/);

    await h.project();
    const view = await proposal(seat1, "GP-001");
    expect([view.state.value, view.liveConfirmations]).toEqual(["OPEN", 1]);
    expectProblem(await call(seat1, "POST", "/api/governance/proposals/GP-001/execute"), 409, "Execution needs 2 live confirmations from distinct seats.");
    expect((await registry()).payload.version).toBe(0);
  });

  it("Lender B's business party cannot confirm, and users without a seat get 404 on every governance mutation", async () => {
    const asBusiness = await ledgerAs("lender-b-approver", "business", "confirm-as-business", async () => [
      L.confirmAction((await rules()).contractId, { confirmer: h.party("lenderB"), actionProposalCid: gp001Cid }),
    ]);
    expect(asBusiness.committed).toBe(false);
    expect(asBusiness.record.status).toBe("REJECTED");
    facts.lenderBBusinessConfirm = { status: asBusiness.record.status, errorKind: asBusiness.record.errorKind };
    expect((await confirmationsOf(gp001Cid)).some((c) => c.payload.confirmer === h.party("lenderB"))).toBe(false);

    for (const persona of NON_SEATS) {
      const session = await h.loginAs(persona);
      const spoof = { headers: { "x-collara-org": "demo-lender-a", "x-collara-party": h.party("seat1") }, body: { confirmer: h.party("seat1"), seat: 1 } };
      for (const action of ["confirmations", "execute", "cancel"]) {
        expectProblem(await call(session, "POST", `/api/governance/proposals/GP-001/${action}`, spoof), 404, "This record is unavailable to your account.");
      }
      expectProblem(await call(session, "POST", "/api/governance/proposals", { body: { type: "SUSPEND_VERIFIER", verifierRef: "VER-001", rationale: "x" } }), 404);
    }
    expect((await confirmationsOf(gp001Cid)).length).toBe(2);
  });

  it("two distinct seats execute the suspension: registry v1, accreditation SUSPENDED, mirror SUSPENDED, visible via GET /verifiers", async () => {
    const confirmed = await call(seat2, "POST", "/api/governance/proposals/GP-001/confirmations", { body: { confirmer: h.party("lenderB") } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(CommandBody.parse(confirmed.json()).command.state).toBe("COMMITTED");
    const seat2Confirmation = (await confirmationsOf(gp001Cid)).find((c) => c.payload.confirmer !== h.party("seat1"));
    // Lender B acts only through its separate governance seat party, never its business party.
    expect(seat2Confirmation?.payload.confirmer).toBe(h.party("seat2"));

    await h.project();
    const executable = await proposal(seat3, "GP-001");
    expect([executable.state.value, executable.liveConfirmations]).toEqual(["EXECUTABLE", 2]);
    expect(executable.allowedActions).toEqual(["confirm", "execute"]);

    const key = `it-execute-gp001-${h.prefix}`;
    const executed = await call(seat3, "POST", "/api/governance/proposals/GP-001/execute", { idempotencyKey: key });
    expect(executed.statusCode, executed.body).toBe(200);
    const command = CommandBody.parse(executed.json()).command;
    expect(command).toMatchObject({ state: "COMMITTED", simulated: false });
    const replay = await call(seat3, "POST", "/api/governance/proposals/GP-001/execute", { idempotencyKey: key });
    expect(replay.statusCode).toBe(200);
    expect(CommandBody.parse(replay.json()).command).toMatchObject({ commandId: command.commandId, updateId: command.updateId });

    // Ledger: the registry moved, the accreditation is SUSPENDED, the old accreditation id is archived.
    const reg = await registry();
    expect(reg.payload.version).toBe(1);
    expect(reg.payload.activeVerifiers).not.toContain(h.party("verifier"));
    const accs = await accreditations();
    expect(accs.map((a) => [a.payload.verifierRef, a.payload.status, a.payload.registryVersion])).toEqual([["VER-001", "SUSPENDED", 1]]);
    expect(accs.some((a) => a.contractId === oldAccreditationCid)).toBe(false);
    const results = await h.acsAs("seat3", "GovernanceExecutionResult", (r) => r.actionLabel === "CollaraSuspendVerifier");
    expect(results).toHaveLength(1);
    expect(results[0]!.payload.executor).toBe(h.party("seat3"));
    expect([...results[0]!.payload.confirmers].sort()).toEqual([h.party("seat1"), h.party("seat2")].sort());
    // The registrar service re-synced the mirror (attributed to system:registrar).
    const m = await mirror();
    expect([m.payload.status, m.payload.sourceRef, m.payload.registryVersion]).toEqual(["SUSPENDED", "GP-001", 1]);
    const [sync] = await h.db.db
      .select()
      .from(commandsTable)
      .where(and(eq(commandsTable.operation, "registrar.syncMirror"), eq(commandsTable.actorUserId, "system:registrar")));
    expect(sync?.status).toBe("COMMITTED");

    await h.project();
    expect((await verifiers(borrower)).map((v) => [v.ref, v.status.value])).toEqual([["VER-001", "SUSPENDED"]]);
    const done = await proposal(seat1, "GP-001");
    expect([done.state.value, done.executedBySeat, done.allowedActions]).toEqual(["EXECUTED", 3, []]);
    const state = GovernanceStateSchema.parse((await call(seat2, "GET", "/api/governance/state")).json());
    expect([state.registryVersion, state.counts.activeVerifiers, state.counts.suspendedVerifiers, state.counts.openProposals]).toEqual([1, 0, 1, 0]);
    facts.suspension = { updateId: command.updateId, registryVersion: reg.payload.version, mirror: m.payload.status };
  });

  it("the suspended verifier cannot issue an attestation (new accreditation: 'Verifier suspended'; old one: archived)", async () => {
    const issue = (accreditationCid: () => Promise<string>, label: string) =>
      ledgerAs("verifier-inspector", "business", label, async (ctx) => {
        const request = (await ctx.acs.one("VerificationRequest", (r) => r.requestRef === "VR-002" && r.namespace === ns))!;
        const config = (await ctx.acs.one("CollaraConfig", (c) => c.namespace === ns))!;
        return [
          L.vrIssueAttestation(request.contractId, {
            configCid: config.contractId,
            accreditationCid: await accreditationCid(),
            attestationRef: "ATT-002",
            checks: [{ item: "Inspected condition", finding: "Synthetic test", result: "CHECKED" }],
            limitations: "Synthetic test only.",
            method: "Document review",
            inspectedAt: ctx.now,
            validFrom: ctx.now,
            validUntil: new Date(ctx.now.getTime() + 180 * DAY),
            supersedes: null,
            actorRef: ctx.actorRef,
          }),
        ];
      });

    const withCurrent = await issue(async () => (await accreditations())[0]!.contractId, "issue-suspended");
    expect(withCurrent.record.status).toBe("REJECTED");
    facts.suspendedIssuance = withCurrent.record.errorMessage;
    expect(withCurrent.record.errorMessage).toMatch(/Verifier suspended/);

    const withOld = await issue(async () => oldAccreditationCid, "issue-archived-accreditation");
    expect(withOld.record.status).toBe("REJECTED");
    facts.archivedAccreditationIssuance = { errorKind: withOld.record.errorKind, code: withOld.record.errorCode };

    expect((await h.acsAs("verifier", "VerificationRequest", (r) => r.requestRef === "VR-002"))[0]?.payload.status).toBe("IN_REVIEW");
    expect(await h.acsAs("verifier", "VerificationAttestation", (a) => a.attestationRef === "ATT-002")).toHaveLength(0);
    expect((await mirror()).payload.status).toBe("SUSPENDED");
  });

  it("a stale proposal (registry moved by another executed proposal) fails to execute — API 409 and ledger rejection", async () => {
    // GP-002: seat 2 re-accredits Demo Verifier (keeps VER-001), pinned to registry v1.
    const added = await call(seat2, "POST", "/api/governance/proposals", {
      body: { type: "ADD_VERIFIER", orgName: "Demo Verifier", scope: "CNC machining centers", rationale: "Synthetic test: reinstatement after review." },
    });
    expect(added.statusCode, added.body).toBe(200);
    expect(ProposeBody.parse(added.json()).result.proposalRef).toBe("GP-002");
    const reg1 = await registry();
    const [add] = await h.acsAs("seat2", "AddVerifierProposal");
    expect(add!.payload).toMatchObject({ proposer: h.party("seat2"), verifier: h.party("verifier"), verifierRef: "VER-001", orgName: "Demo Verifier", expectedVersion: 1, registryCid: reg1.contractId });
    expect(add!.payload.scope).toEqual(["CNC_MACHINERY", "CNC machining centers"]);

    // The API refuses a second open proposal for the same verifier, and an organisation that is not onboarded.
    expectProblem(await call(seat3, "POST", "/api/governance/proposals", { body: { type: "ADD_VERIFIER", orgName: "Demo Verifier", scope: "CNC", rationale: "dup" } }), 409, "This verifier cannot be added in its current state.");
    expectProblem(await call(seat3, "POST", "/api/governance/proposals", { body: { type: "ADD_VERIFIER", orgName: "Demo Lender B", scope: "CNC", rationale: "x" } }), 400);

    // GP-003: a competing proposal pinned to the same registry v1, created straight on the ledger by seat 3.
    const competing = await ledgerAs("auditor", "seat", "competing-add", async (ctx) => [
      L.createAddVerifierProposal({
        governanceParty: h.party("governance"),
        proposer: h.party("seat3"),
        registryCid: reg1.contractId,
        expectedVersion: 1,
        verifier: h.party("verifier"),
        verifierRef: "VER-001",
        orgName: "Demo Verifier",
        scope: ["CNC_MACHINERY"],
        validUntil: new Date(ctx.now.getTime() + 365 * DAY),
        proposalDeadline: new Date(ctx.now.getTime() + 14 * DAY),
        reason: "Synthetic test: competing proposal on the same registry version.",
      }),
    ]);
    expect(competing.committed).toBe(true);
    for (const session of [seat3, seat1]) {
      const r = await call(session, "POST", "/api/governance/proposals/GP-003/confirmations");
      expect(r.statusCode, r.body).toBe(200);
    }
    expect((await call(seat1, "POST", "/api/governance/proposals/GP-002/confirmations")).statusCode).toBe(200);

    await h.project();
    expect((await proposal(seat3, "GP-003")).state.value).toBe("EXECUTABLE");
    const executed = await call(seat1, "POST", "/api/governance/proposals/GP-002/execute");
    expect(executed.statusCode, executed.body).toBe(200);
    const reg2 = await registry();
    expect(reg2.payload.version).toBe(2);
    expect(reg2.payload.activeVerifiers).toContain(h.party("verifier"));
    const active = (await accreditations()).filter((a) => a.payload.status === "ACTIVE");
    expect(active.map((a) => [a.payload.verifierRef, a.payload.registryVersion])).toEqual([["VER-001", 2]]);
    expect([(await mirror()).payload.status, (await mirror()).payload.sourceRef]).toEqual(["ACTIVE", "GP-002"]);

    await h.project();
    const stale = await proposal(seat3, "GP-003");
    expect([stale.state.value, stale.allowedActions]).toEqual(["STALE", []]);
    expectProblem(await call(seat3, "POST", "/api/governance/proposals/GP-003/execute"), 409);

    const [competingCid] = (await h.acsAs("seat3", "AddVerifierProposal", (p) => p.proposer === h.party("seat3"))).map((p) => p.contractId);
    const live = await confirmationsOf(competingCid!);
    expect(new Set(live.map((c) => c.payload.confirmer)).size).toBe(2);
    const direct = await ledgerAs("auditor", "seat", "execute-stale", async () => [
      L.executeConfirmedAction((await rules()).contractId, { executor: h.party("seat3"), actionProposalCid: competingCid!, confirmations: live.map((c) => c.contractId) }),
    ]);
    expect(direct.record.status).toBe("REJECTED");
    facts.staleRejection = { errorKind: direct.record.errorKind, code: direct.record.errorCode, message: direct.record.errorMessage?.slice(0, 200) };
    expect((await registry()).payload.version).toBe(2);
    expect((await verifiers(borrower)).map((v) => [v.ref, v.status.value])).toEqual([["VER-001", "ACTIVE"]]);
  });

  it("only the proposer withdraws its open proposal; a withdrawn proposal cannot be confirmed", async () => {
    const opened = await call(seat1, "POST", "/api/governance/proposals", { body: { type: "SUSPEND_VERIFIER", verifierRef: "VER-001", rationale: "Synthetic test: to be withdrawn." } });
    expect(opened.statusCode, opened.body).toBe(200);
    const ref = ProposeBody.parse(opened.json()).result.proposalRef;
    expect(ref).toBe("GP-004");
    expectProblem(await call(seat2, "POST", `/api/governance/proposals/${ref}/cancel`), 403);
    const cancelled = await call(seat1, "POST", `/api/governance/proposals/${ref}/cancel`);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(await h.acsAs("seat1", "SuspendVerifierProposal")).toHaveLength(0);
    expectProblem(await call(seat2, "POST", `/api/governance/proposals/${ref}/confirmations`), 409, "This proposal cannot be confirmed by your seat in its current state.");
    await h.project();
    expect((await proposal(seat2, ref)).state.value).toBe("CANCELLED");
    expectProblem(await call(seat1, "GET", "/api/governance/proposals/GP-099"), 404, "This record is unavailable to your account.");
  });

  it("governance command records carry the seat submission context (exact UNKNOWN_OUTCOME reconciliation)", async () => {
    // Refused requests (409 in prepare) never reached the ledger and stay PREPARED without a submission context.
    const rows = (await h.db.db.select().from(commandsTable).where(eq(commandsTable.operation, "governance.confirm"))).filter((r) => r.status !== "PREPARED");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const seatUsers = new Map(h.state.users.filter((u) => u.role === "org").map((u) => [u.primaryParty, u.id]));
    for (const row of rows) {
      expect(row.actAs).toHaveLength(1);
      const party = row.actAs![0]!;
      expect([h.party("seat1"), h.party("seat2"), h.party("seat3")]).toContain(party);
      expect(row.ledgerUserId).toBe(seatUsers.get(party));
      expect(row.ledgerSource).toBe("sandbox");
      expect(row.ledgerEndAtSubmit).not.toBeNull();
      if (row.completionOffset !== null) expect(row.ledgerEndAtSubmit!).toBeLessThan(row.completionOffset);
    }
    facts.confirmRecords = rows.length;
  });
});
