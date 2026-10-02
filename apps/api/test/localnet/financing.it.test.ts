// LocalNet (LOCALNET_IT=1): the financing path through the API on the real sandbox, from the main seed of a fresh
// "ep2-<unique>" prefix: review → eligible → proposal (exact version) → accept → authorize → activate (+ replay)
// → release request (lock ACTIVE) → information round → reject (lock ACTIVE) → second request → authorize
// (control recreated v5) → audit grants → auditor export (worker handler in-process) → download → revocation.
// Every step asserts on the LEDGER (ACS as the organisation's ledger user), not only on HTTP responses.
import { createHash, randomUUID } from "node:crypto";
import { exportJobs } from "@collara/db";
import { COMMAND_COPY, ERROR_COPY } from "@collara/domain";
import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig as loadWorkerConfig } from "../../../worker/src/config";
import { createExportJobHandler } from "../../../worker/src/jobs/handlers/export";
import { runExportJobsOnce } from "../../../worker/src/jobs/registry";
import { ledgerCommands as L } from "../../src/ledger";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type ItSession, type LocalnetHarness } from "./harness";

const CASE = "CL-001";
const ASSET = "ASSET-DEMO-001";
const NEWER_VERSION = "This proposal has a newer version. Review it before accepting.";

function committed(response: LightMyRequestResponse, label: string) {
  expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
  const body = response.json();
  expect(body.command, label).toMatchObject({ state: "COMMITTED", simulated: false, message: COMMAND_COPY.COMMITTED });
  expect(body.command.updateId, label).toBeTruthy();
  return body;
}

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet financing path (review → release → audit → export)", () => {
  let h: LocalnetHarness;
  let analyst: ItSession;
  let approver: ItSession;
  let borrower: ItSession;
  let lenderB: ItSession;
  let verifier: ItSession;
  let dealer: ItSession;
  let auditor: ItSession;
  const facts: Record<string, unknown> = {};
  const commandIds: string[] = [];

  const lockContracts = (role: "lenderA" | "borrower") => h.acsAs(role, "CollateralLock", (l) => l.namespace === h.namespace && l.assetId === ASSET);
  const assessment = async () => (await h.acsAs("lenderA", "CollateralAssessment", (a) => a.namespace === h.namespace && a.caseRef === CASE))[0]?.payload;
  const step = async (label: string, response: Promise<LightMyRequestResponse>) => {
    const body = committed(await response, label);
    commandIds.push(body.command.commandId);
    await h.project();
    return body;
  };

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "ep2" });
    const started = Date.now();
    const seed = await h.seed("main");
    facts.prefix = h.prefix;
    facts.seed = { ms: Date.now() - started, steps: seed.steps.length, documents: seed.documents.length };
    await h.project();
    analyst = await h.loginAs("lender-a-analyst");
    approver = await h.loginAs("lender-a-approver");
    borrower = await h.loginAs("manufacturer-owner");
    lenderB = await h.loginAs("lender-b-approver");
    verifier = await h.loginAs("verifier-inspector");
    dealer = await h.loginAs("dealer-contributor");
    auditor = await h.loginAs("auditor");
  });

  afterAll(async () => {
    console.log(`LocalNet financing facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("review: analyst saves (start + save), submits; approver decides ELIGIBLE; others are refused", async () => {
    expect((await lenderB.inject("GET", "/api/reviews/CA-001")).statusCode).toBe(404);
    expect((await lenderB.inject("GET", "/api/reviews")).json().items).toEqual([]);
    const lenderBSave = await lenderB.inject("POST", `/api/cases/${CASE}/assessments`, {
      body: { valuation: { amount: "1.00", currency: "USD" }, valuationSource: "x", valuationDate: "2026-10-01", limitations: "", outcome: "ELIGIBLE", policyRef: "CP-2026-CNC-01" },
    });
    expect(lenderBSave.statusCode).toBe(404);
    expect(lenderBSave.json().detail).toBe(ERROR_COPY.UNAVAILABLE);

    const saved = await step(
      "save assessment",
      analyst.inject("POST", `/api/cases/${CASE}/assessments`, {
        body: {
          valuation: { amount: "150000.00", currency: "USD" },
          valuationSource: "Synthetic desk valuation (demo)",
          valuationDate: new Date().toISOString().slice(0, 10),
          limitations: "Synthetic demo valuation; not an appraisal.",
          outcome: "ELIGIBLE",
          policyRef: "CP-2026-CNC-01",
        },
      }),
    );
    expect(saved.result).toMatchObject({ ref: "CA-001", state: { value: "IN_REVIEW" }, assessment: { valuation: { amount: "150000.00", currency: "USD" } } });
    expect(await assessment()).toMatchObject({ status: "IN_REVIEW", version: 3, valuation: { value: { amount: "150000.00", currency: "USD" } } });

    const analystDecide = await analyst.inject("POST", "/api/reviews/CA-001/decision", { body: { outcome: "ELIGIBLE" } });
    expect(analystDecide.statusCode).toBe(403);
    await step("submit for approval", analyst.inject("POST", "/api/reviews/CA-001/submit-for-approval", { body: {} }));
    expect((await assessment())?.status).toBe("PENDING_APPROVAL");
    expect((await verifier.inject("POST", "/api/reviews/CA-001/decision", { body: { outcome: "ELIGIBLE" } })).statusCode).toBe(404);

    await step("decide eligible", approver.inject("POST", "/api/reviews/CA-001/decision", { body: { outcome: "ELIGIBLE", sharedFeedback: "Eligible for this lender and case." } }));
    expect((await assessment())?.status).toBe("ELIGIBLE");
    const notices = await h.acsAs("borrower", "LenderDecisionNotice", (n) => n.caseRef === CASE);
    expect(notices.map((n) => n.payload.outcome)).toEqual(["ELIGIBLE"]);
    const borrowerView = (await borrower.inject("GET", "/api/reviews/CA-001")).json();
    expect(borrowerView).toMatchObject({ state: { value: "ELIGIBLE" }, assessment: null, sharedFeedback: "Eligible for this lender and case." });
    // Valuation is lender-only, terms never reach the verifier or the dealer.
    for (const s of [verifier, dealer, lenderB]) expect((await s.inject("GET", "/api/reviews/CA-001")).statusCode).toBe(404);
  });

  it("proposal: approver issues; acceptance is bound to the exact version (API and ledger)", async () => {
    const principal = { amount: "100000.00", currency: "USD" };
    expect((await analyst.inject("POST", `/api/cases/${CASE}/proposals`, { body: { intent: "ISSUE", principal } })).statusCode).toBe(403);
    const issued = await step("issue proposal", approver.inject("POST", `/api/cases/${CASE}/proposals`, { body: { intent: "ISSUE", principal, termMetadata: "36 months (synthetic)", expiresInDays: 14 } }));
    expect(issued.result).toEqual({ proposalRef: "FP-001", version: 1 });
    for (const s of [verifier, dealer, lenderB, auditor]) {
      const r = await s.inject("GET", "/api/proposals/FP-001");
      expect(r.statusCode).toBe(404);
      expect(r.body).not.toContain("100000");
    }

    // A terms change is a new version (Proposal_Revise, run directly: the API revises only expired versions).
    const v1 = (await h.acsAs("lenderA", "FinancingProposal", (p) => p.proposalRef === "FP-001"))[0]!;
    const revise = await h.workflow.run({
      actor: await h.actor("lender-a-approver"),
      operation: "it.proposal.revise",
      idempotencyKey: `it-revise-${randomUUID()}`,
      payload: {},
      prepare: async (ctx) => ({
        commands: [L.proposalRevise(v1.contractId, { newPrincipal: principal, newTermMetadata: "36 months (synthetic, v2)", newExternalLegalRef: "", newExpiresAt: new Date(Date.now() + 14 * 86_400_000), actorRef: ctx.actorRef })],
      }),
    });
    expect(revise.committed).toBe(true);
    await h.project();
    const v2 = (await h.acsAs("borrower", "FinancingProposal", (p) => p.proposalRef === "FP-001"))[0]!;
    expect(v2.payload.version).toBe(2);

    const stale = await borrower.inject("POST", "/api/proposals/FP-001/acceptance", { body: { expectedVersion: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().detail).toBe(NEWER_VERSION);
    // The ledger refuses a mismatched version on its own (Proposal_Accept checks ref and version).
    const ledgerStale = await h.workflow.run({
      actor: await h.actor("manufacturer-owner"),
      operation: "it.proposal.accept-stale",
      idempotencyKey: `it-accept-stale-${randomUUID()}`,
      payload: {},
      prepare: async (ctx) => ({ commands: [L.proposalAccept(v2.contractId, { expectedProposalRef: "FP-001", expectedVersion: 1, actorRef: ctx.actorRef })] }),
    });
    expect(ledgerStale.command.state).toBe("REJECTED");
    facts.staleAcceptLedgerError = ledgerStale.record.errorMessage?.slice(0, 160);

    await step("accept v2", borrower.inject("POST", "/api/proposals/FP-001/acceptance", { body: { expectedVersion: 2 } }));
    const agreements = await h.acsAs("borrower", "FinancingAgreement", (a) => a.agreementRef === "FP-001");
    expect(agreements.map((a) => a.payload.proposalVersion)).toEqual([2]);
    expect((await borrower.inject("GET", "/api/proposals/FP-001")).json()).toMatchObject({ version: 2, state: { value: "ACCEPTED" }, principal });
  });

  it("activation: borrower authorizes; analyst and Lender B are refused; approver activates once (replay = same command)", async () => {
    expect((await approver.inject("POST", "/api/proposals/FP-001/activation-authorization", { body: { expectedVersion: 2 } })).statusCode).toBe(403);
    await step("authorize activation", borrower.inject("POST", "/api/proposals/FP-001/activation-authorization", { body: { expectedVersion: 2 } }));
    const auths = await h.acsAs("lenderA", "PledgeActivationAuthorization", (a) => a.caseRef === CASE);
    expect(auths).toHaveLength(1);
    expect(auths[0]!.payload).toMatchObject({ agreementRef: "FP-001", agreementVersion: 2, expectedControlVersion: 3 });

    expect((await analyst.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} })).statusCode).toBe(403);
    expect((await lenderB.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} })).json()).toMatchObject({ status: 404, detail: ERROR_COPY.UNAVAILABLE });
    // Browser-supplied party/org fields are stripped and ignored.
    const key = `it-activate-${randomUUID()}`;
    const first = committed(
      await approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: { lender: h.party("lenderB"), orgId: "demo-lender-b" }, idempotencyKey: key, headers: { "x-collara-org": "demo-lender-b" } }),
      "activate",
    );
    expect(first.result).toEqual({ pledgeRef: "PL-001" });
    const replay = committed(await approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {}, idempotencyKey: key }), "activation replay");
    expect(replay.command.commandId).toBe(first.command.commandId);
    expect(replay.command.updateId).toBe(first.command.updateId);
    expect(replay.result).toEqual({ pledgeRef: "PL-001" });

    const locks = await lockContracts("lenderA");
    expect(locks).toHaveLength(1);
    expect(locks[0]!.payload).toMatchObject({ lockRef: "PL-001", controlVersion: 4, lender: h.party("lenderA"), owner: h.party("borrower") });
    expect(await lockContracts("borrower")).toHaveLength(1);
    expect(await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET)).toHaveLength(0);
    facts.lock = { cid: locks[0]!.contractId.slice(0, 16), updateId: first.command.updateId };
    await h.project();
    const command = (await approver.inject("GET", `/api/commands/${first.command.commandId}`)).json();
    expect(command).toMatchObject({ state: "PROJECTED", updateId: first.command.updateId });
    expect((await borrower.inject("GET", "/api/pledges/PL-001")).json()).toMatchObject({ lockState: { value: "ACTIVE" }, technical: { controlVersionConsumed: 3, controlVersionLocked: 4 } });
  });

  it("release: requests and rejection leave the lock ACTIVE; borrower and analyst cannot decide; authorize recreates control v5", async () => {
    const lockBefore = (await lockContracts("lenderA"))[0]!.contractId;
    const rr1 = await step("release request RR-001", borrower.inject("POST", "/api/pledges/PL-001/release-requests", { body: { reason: "EXTERNAL_LOAN_COMPLETION", note: "Synthetic payoff" } }));
    expect(rr1.result).toEqual({ releaseRequestRef: "RR-001" });
    expect((await lockContracts("lenderA")).map((l) => l.contractId)).toEqual([lockBefore]);
    expect((await borrower.inject("GET", "/api/pledges/PL-001")).json()).toMatchObject({ state: { value: "RELEASE_REQUESTED" }, lockState: { value: "ACTIVE" } });

    const byBorrower = await borrower.inject("POST", "/api/release-requests/RR-001/decision", { body: { decision: "AUTHORIZE" } });
    expect(byBorrower.statusCode).toBe(403);
    expect(byBorrower.json().detail).toBe(ERROR_COPY.RELEASE_UNAUTHORIZED);
    const byAnalyst = await analyst.inject("POST", "/api/release-requests/RR-001/decision", { body: { decision: "AUTHORIZE" } });
    expect(byAnalyst.statusCode).toBe(403);
    expect(byAnalyst.json().detail).toBe(ERROR_COPY.RELEASE_UNAUTHORIZED);
    expect((await lenderB.inject("POST", "/api/release-requests/RR-001/decision", { body: { decision: "AUTHORIZE" } })).statusCode).toBe(404);
    expect((await verifier.inject("GET", "/api/release-requests/RR-001")).statusCode).toBe(404);
    // Bypassing the API does not help: the ledger refuses the borrower's Release_Authorize (controller lender).
    const rr = (await h.acsAs("borrower", "ReleaseRequest", (r) => r.releaseRequestRef === "RR-001"))[0]!;
    const bypass = await h.workflow.run({
      actor: await h.actor("manufacturer-owner"),
      operation: "it.release.bypass",
      idempotencyKey: `it-bypass-${randomUUID()}`,
      payload: {},
      prepare: async (ctx) => ({ commands: [L.releaseAuthorize(rr.contractId, { decisionRef: "RD-BYPASS", actorRef: ctx.actorRef })] }),
    });
    expect(bypass.committed).toBe(false);
    expect(bypass.command.state).toBe("REJECTED");
    facts.borrowerBypass = { state: bypass.command.state, kind: bypass.record.errorKind };
    expect((await lockContracts("lenderA")).map((l) => l.contractId)).toEqual([lockBefore]);

    await step("request information", approver.inject("POST", "/api/release-requests/RR-001/information-requests", { body: { message: "Please confirm the payoff reference." } }));
    expect((await h.acsAs("borrower", "ReleaseRequest", (r) => r.releaseRequestRef === "RR-001"))[0]!.payload.status).toBe("INFORMATION_REQUESTED");
    await step("respond", borrower.inject("POST", "/api/release-requests/RR-001/responses", { body: { message: "Payoff reference sent (synthetic)." } }));
    expect((await h.acsAs("borrower", "ReleaseRequest", (r) => r.releaseRequestRef === "RR-001"))[0]!.payload.status).toBe("REQUESTED");

    await step("reject RR-001", approver.inject("POST", "/api/release-requests/RR-001/decision", { body: { decision: "REJECT", reason: "Payoff confirmation is pending." } }));
    expect((await lockContracts("lenderA")).map((l) => l.contractId)).toEqual([lockBefore]);
    expect(await lockContracts("borrower")).toHaveLength(1);
    const decisions = await h.acsAs("borrower", "ReleaseDecision", (d) => d.releaseRequestRef === "RR-001");
    expect(decisions.map((d) => d.payload.outcome)).toEqual(["REJECTED"]);
    expect((await borrower.inject("GET", "/api/release-requests/RR-001")).json()).toMatchObject({ state: { value: "REJECTED" }, decision: { reason: "Payoff confirmation is pending." } });
    expect((await borrower.inject("GET", "/api/pledges/PL-001")).json()).toMatchObject({ lockState: { value: "ACTIVE" } });

    const rr2 = await step("release request RR-002", borrower.inject("POST", "/api/pledges/PL-001/release-requests", { body: { reason: "EXTERNAL_LOAN_COMPLETION" } }));
    expect(rr2.result).toEqual({ releaseRequestRef: "RR-002" });
    expect(await lockContracts("lenderA")).toHaveLength(1);
    await step("authorize RR-002", approver.inject("POST", "/api/release-requests/RR-002/decision", { body: { decision: "AUTHORIZE" } }));

    expect(await lockContracts("lenderA")).toHaveLength(0);
    expect(await lockContracts("borrower")).toHaveLength(0);
    const controls = await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET && c.namespace === h.namespace);
    expect(controls.map((c) => [c.payload.controlVersion, c.payload.sharedLender])).toEqual([[5, null]]);
    expect(await h.acsAs("borrower", "CollateralLockReleased", (r) => r.lockRef === "PL-001")).toHaveLength(1);
    const pledge = (await borrower.inject("GET", "/api/pledges/PL-001")).json();
    expect(pledge).toMatchObject({ state: { value: "RELEASED" }, lockState: { value: "RELEASED" }, technical: { controlVersionAfterRelease: 5, controlState: "AVAILABLE" } });
    expect(pledge.releaseRequests.map((r: { ref: string; state: { value: string } }) => [r.ref, r.state.value])).toEqual([
      ["RR-002", "AUTHORIZED"],
      ["RR-001", "REJECTED"],
    ]);
  });

  it("audit grants per record owner, auditor export (worker), download with checksum, revocation blocks download", async () => {
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const grant = (scopes: string[]) => ({ caseId: CASE, auditorOrgId: "demo-auditor", scopes, permission: "VIEW_EXPORT", purpose: "Synthetic audit of case CL-001", expiresAt });
    expect((await borrower.inject("POST", "/api/audit/grants", { body: grant(["DECISION_OUTCOME"]) })).statusCode).toBe(400);
    expect((await analyst.inject("POST", "/api/audit/grants", { body: grant(["DECISION_OUTCOME"]) })).statusCode).toBe(403);
    expect((await lenderB.inject("POST", "/api/audit/grants", { body: grant(["DECISION_OUTCOME"]) })).statusCode).toBe(404);
    const g1 = await step("grant AG-001 (owner)", borrower.inject("POST", "/api/audit/grants", { body: grant(["EVIDENCE_MANIFEST", "ATTESTATION"]) }));
    const g2 = await step("grant AG-002 (lender)", approver.inject("POST", "/api/audit/grants", { body: grant(["DECISION_OUTCOME", "PLEDGE_RELEASE_EVENTS"]) }));
    expect([g1.result.grantId, g2.result.grantId]).toEqual(["AG-001", "AG-002"]);
    const grants = await h.acsAs("auditor", "AuditGrant", (g) => g.caseRef === CASE);
    expect(grants.map((g) => [g.payload.grantRef, g.payload.permission]).sort()).toEqual([
      ["AG-001", "EXPORT"],
      ["AG-002", "EXPORT"],
    ]);

    const auditorEvents = (await auditor.inject("GET", `/api/audit/events?caseId=${CASE}&limit=100`)).json();
    const auditorTypes: string[] = auditorEvents.items.map((e: { type: string }) => e.type);
    expect(auditorTypes).toContain("DECISION_RECORDED");
    expect(auditorTypes).not.toContain("PROPOSAL_ACCEPTED");
    expect((await lenderB.inject("GET", `/api/audit/events?caseId=${CASE}`)).statusCode).toBe(404);

    const json = await auditor.inject("POST", "/api/reports", { body: { caseId: CASE, format: "JSON" } });
    expect(json.statusCode).toBe(201);
    expect(json.json()).toMatchObject({ command: { target: "APPLICATION", simulated: false }, result: { ref: "RPT-0001", state: { value: "QUEUED" } } });
    expect((await auditor.inject("POST", "/api/reports", { body: { caseId: CASE, format: "CSV" } })).statusCode).toBe(201);
    expect((await borrower.inject("POST", "/api/reports", { body: { caseId: CASE, format: "JSON" } })).statusCode).toBe(201);
    expect((await lenderB.inject("POST", "/api/reports", { body: { caseId: CASE, format: "JSON" } })).statusCode).toBe(404);

    // The worker's export handler, in-process, against the IT database and the same private storage.
    const config = loadWorkerConfig({ COLLARA_MODE: "LOCALNET", DATABASE_URL: h.databaseUrl });
    const summary = await runExportJobsOnce(
      { db: h.db.db, log: pino({ level: "silent" }), workerId: "it-worker", config, signal: new AbortController().signal, now: () => new Date() },
      createExportJobHandler({ storage: h.storage }),
    );
    expect(summary).toEqual({ processed: 3, ready: 3, failed: 0 });
    facts.exports = summary;

    const reports = (await auditor.inject("GET", "/api/reports")).json().items;
    expect(reports.map((r: { ref: string; state: { value: string } }) => [r.ref, r.state.value])).toEqual([
      ["RPT-0002", "READY"],
      ["RPT-0001", "READY"],
    ]);
    expect((await lenderB.inject("GET", "/api/reports")).json().items).toEqual([]);
    expect((await lenderB.inject("GET", "/api/reports/RPT-0001/download")).statusCode).toBe(404);
    expect((await borrower.inject("GET", "/api/reports/RPT-0001/download")).statusCode).toBe(404);

    const link = await auditor.inject("GET", "/api/reports/RPT-0001/download");
    expect(link.statusCode).toBe(200);
    const { url } = link.json();
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const [job] = await h.db.db.select().from(exportJobs).where(eq(exportJobs.reportRef, "RPT-0001"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(job?.checksumSha256);
    const text = new TextDecoder().decode(bytes);
    const report = JSON.parse(text);
    expect(report).toMatchObject({ schemaVersion: "collara.case-report/v1", reportRef: "RPT-0001", watermark: "Synthetic demo data — Canton LocalNet.", proposal: null, pledge: null });
    expect(report.cutoff.offset).toBe(job?.cutoffOffset);
    expect(report.evidenceManifest.length).toBeGreaterThan(0);
    expect(text).not.toContain("100000");
    facts.auditorReport = { bytes: bytes.byteLength, checksum: job?.checksumSha256?.slice(0, 16), cutoffOffset: job?.cutoffOffset, manifestEntries: report.evidenceManifest.length, events: report.events.length };

    const csvLink = (await auditor.inject("GET", "/api/reports/RPT-0002/download")).json();
    const csv = await (await fetch(csvLink.url)).text();
    expect(csv.split("\n")[0]).toBe("# Case workflow report — not a legal title or lien certificate.");
    const borrowerReport = await (await fetch((await borrower.inject("GET", "/api/reports/RPT-0003/download")).json().url)).text();
    expect(JSON.parse(borrowerReport).proposal).toMatchObject({ ref: "FP-001", version: 2, principal: { amount: "100000.00", currency: "USD" } });

    // Revocation limits future access: the auditor's link is no longer issued.
    await step("revoke AG-001", borrower.inject("POST", "/api/audit/grants/AG-001/revoke", { body: {} }));
    expect(await h.acsAs("auditor", "AuditGrant", (g) => g.grantRef === "AG-001")).toHaveLength(0);
    expect((await auditor.inject("GET", "/api/reports/RPT-0001/download")).statusCode).toBe(404);
    const again = await borrower.inject("POST", "/api/audit/grants/AG-001/revoke", { body: {} });
    expect(again.statusCode).toBe(409);
  });

  it("audit events: committed lifecycle with update ids for the parties; every command projected", async () => {
    const events = (await borrower.inject("GET", `/api/audit/events?caseId=${CASE}&limit=100`)).json().items as { type: string; commit: { updateId: string } | null }[];
    const types = events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["DECISION_RECORDED", "PROPOSAL_ISSUED", "PROPOSAL_ACCEPTED", "ACTIVATION_AUTHORIZED", "PLEDGE_ACTIVATED", "RELEASE_REQUESTED", "RELEASE_REJECTED", "RELEASE_AUTHORIZED"]));
    expect(events.filter((e) => e.type === "PLEDGE_ACTIVATED").every((e) => !!e.commit?.updateId)).toBe(true);
    expect((await lenderB.inject("GET", "/api/audit/events")).json().items).toEqual([]);

    const states = await Promise.all(commandIds.map(async (id) => (await h.command(id))?.status));
    expect(states.every((s) => s === "PROJECTED")).toBe(true);
    facts.apiCommands = { committedAndProjected: states.length };
  });
});
