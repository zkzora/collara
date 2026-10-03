// Witness-level ledger privacy across five participants (opt-in: PRIVACY_IT=1; the sandbox must run with
// `node scripts/localnet/up.mjs --participants=5`). Run: `PRIVACY_IT=1 pnpm --filter @collara/api test:privacy`.
//
// Topology (scripts/localnet/localnet.config.json `placements["5"]`): sandbox = registrar + governance + 3 seats,
// participant2 = borrower, participant3 = Lender A, participant4 = Lender B, participant5 = verifier + dealer + auditor.
//
// 1. One isolated world (bootstrap --prefix) runs the §7 seed (B1–B8, M1–M18) and the walkthrough W1–W14 through the
//    API, so every command is submitted by the acting organisation's ledger user on its own participant.
// 2. Evidence is raw JSON Ledger API data (TRANSACTION_SHAPE_LEDGER_EFFECTS), never API/UI output:
//    a. per party: its update stream from its own participant, read by a user with CanReadAs that party only;
//    b. per node: everything the participant stores, read by a CanReadAsAnyParty user (the operator's view);
//    c. informees of the sensitive transactions on every node (update-by-id) and per-node ledger-end deltas;
//    d. what the registrar receives from the control → lock transition;
//    e. the auditor's stream (AuditGrant only); the export is off-ledger (ledger ends unchanged).
// 3. Revocation race (daml-model.md §8.2) in two more worlds: an AttestationDisclosure revocation committed between
//    the API's precheck and Control_Activate (deterministic interleaving), and an unsynchronised concurrent pair.
// Raw evidence: .local/privacy/<run>/ (git-ignored). Summary: docs/evidence/privacy-summary.json.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commands as commandsTable } from "@collara/db";
import { COMMAND_COPY } from "@collara/domain";
import { isNotNull } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig as loadWorkerConfig } from "../../../../worker/src/config";
import { createExportJobHandler } from "../../../../worker/src/jobs/handlers/export";
import { runExportJobsOnce } from "../../../../worker/src/jobs/registry";
import { DEV_HMAC_SECRET, ledgerCommands as L } from "../../../src/ledger";
import type { WorkflowRunner } from "../../../src/workflow/run";
import { authorizedWorld, type AuthorizedWorld } from "../financing-fixture";
import { LEDGER_ROLES, REPO_ROOT, startLocalnetHarness, type ItSession, type LedgerRole, type LocalnetHarness } from "../harness";
import {
  LedgerProbe,
  mentions,
  markerHits,
  readAsAnyPartyRight,
  readAsRight,
  summarize,
  transactionOf,
  transactionsOf,
  uniqueSorted,
  type LedgerNode,
  type StreamSummary,
  type TermMarkers,
  type WitnessedTransaction,
} from "./evidence";

export const PRIVACY_IT_ENABLED = process.env.PRIVACY_IT === "1";

const CASE = "CL-001";
const ASSET = "ASSET-DEMO-001";
const PRINCIPAL = { amount: "100000.00", currency: "USD" } as const;
// Synthetic markers (packages/db/src/read-model/scenario-fixture.ts): searched for in every payload.
const MARKERS: TermMarkers = { principal: "100000.00", termMetadata: "Synthetic 36-month terms", externalLegalRef: "LEGAL-DEMO-FP-001", valuation: "150000.00" };
const SENSITIVE_TEMPLATES = ["FinancingProposal", "FinancingAgreement", "PledgeActivationAuthorization"] as const;
const ROLES = Object.keys(LEDGER_ROLES) as LedgerRole[];
/** Parties that must never see terms: everyone but the borrower and the selected lender. */
const NO_TERMS: readonly LedgerRole[] = ["registrar", "governance", "seat1", "seat2", "seat3", "dealer", "verifier", "lenderB", "auditor"];
/** Participants that host no borrower and no selected lender. */
const NO_TERMS_NODES = ["sandbox", "participant4", "participant5"] as const;

interface StepRecord {
  readonly label: string;
  readonly daml: string;
  readonly actor: string;
  readonly commandId: string | null;
  readonly updateId: string | null;
  readonly before: Record<string, number>;
  readonly after: Record<string, number>;
}

interface Check {
  readonly section: string;
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: unknown;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const RUN = `${new Date().toISOString().replace(/[:.]/g, "-")}`;
const OUT_DIR = join(REPO_ROOT, ".local", "privacy", RUN);
const SUMMARY_FILE = join(REPO_ROOT, "docs", "evidence", "privacy-summary.json");

/**
 * docs/evidence/privacy-summary.json: the full summary minus the per-node detail of the informee views (kept in
 * .local/privacy/<run>/summary.json): for each key transaction, the nodes that received it, the widest view's events
 * with their informees, and the number of events each node shows.
 */
function writeSummaryFile(full: Record<string, unknown>): void {
  const informees = full.informees as Record<string, { receivedBy: string[]; nodes: Record<string, InformeeView> }> | undefined;
  const compactInformees = informees
    ? Object.fromEntries(
        Object.entries(informees).map(([label, v]) => {
          const views = Object.values(v.nodes).filter((n): n is Extract<InformeeView, { received: true }> => n.received);
          const widest = views.sort((a, b) => b.events.length - a.events.length)[0];
          return [
            label,
            {
              receivedBy: v.receivedBy,
              eventsPerNode: Object.fromEntries(Object.entries(v.nodes).map(([n, x]) => [n, x.received ? x.events.length : 0])),
              widestView: (widest?.events ?? []).map((e) => `${e.kind} ${e.template}${e.choice ? ` ${e.choice}` : ""} [${e.witnesses.join(",")}]${e.markers.length ? ` markers: ${e.markers.join(",")}` : ""}`),
            },
          ];
        }),
      )
    : undefined;
  const { informees: _omit, ...rest } = full;
  mkdirSync(join(REPO_ROOT, "docs", "evidence"), { recursive: true });
  writeFileSync(SUMMARY_FILE, `${JSON.stringify({ ...rest, ...(compactInformees ? { informees: compactInformees } : {}) }, null, 2)}\n`);
}

function writeJson(name: string, value: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function committed(response: LightMyRequestResponse, label: string) {
  expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
  const body = response.json();
  expect(body.command, label).toMatchObject({ state: "COMMITTED", simulated: false, message: COMMAND_COPY.COMMITTED });
  expect(body.command.updateId, label).toBeTruthy();
  return body as { command: { commandId: string; updateId: string }; result?: unknown };
}

/** Per-world ledger readers: one CanReadAs user per party (on its own node) and one CanReadAsAnyParty user per node. */
class WorldReaders {
  readonly nodes: LedgerNode[];
  readonly probe: LedgerProbe;
  readonly nodeReader: string;
  readonly hintOfParty = new Map<string, string>();

  constructor(readonly h: LocalnetHarness) {
    this.nodes = Object.entries(h.state.participants).map(([name, p]) => ({ name, jsonApiUrl: p.jsonApiUrl }));
    this.probe = new LedgerProbe({ secret: h.config.CANTON_JWT_HMAC_SECRET ?? DEV_HMAC_SECRET, audience: h.config.CANTON_JWT_AUDIENCE ?? h.state.audience });
    this.nodeReader = `${h.prefix}-pv-node`;
    for (const [hint, entry] of Object.entries(h.state.parties)) this.hintOfParty.set(entry.party, hint);
  }

  node(name: string): LedgerNode {
    const node = this.nodes.find((n) => n.name === name);
    if (!node) throw new Error(`unknown participant ${name}`);
    return node;
  }

  nodeOf(role: LedgerRole): LedgerNode {
    return this.node(this.h.state.parties[LEDGER_ROLES[role]]!.participant);
  }

  partyReader(role: LedgerRole): string {
    return `${this.h.prefix}-pv-${LEDGER_ROLES[role]}`;
  }

  async create(): Promise<void> {
    for (const role of ROLES) await this.probe.ensureReader(this.nodeOf(role), this.partyReader(role), [readAsRight(this.h.party(role))]);
    for (const node of this.nodes) await this.probe.ensureReader(node, this.nodeReader, [readAsAnyPartyRight()]);
  }

  async ends(): Promise<Record<string, number>> {
    const entries = await Promise.all(this.nodes.map(async (n) => [n.name, await this.probe.ledgerEnd(n, this.nodeReader)] as const));
    return Object.fromEntries(entries);
  }

  /** Ledger ends once every node has stopped moving (other participants index a commit slightly later). */
  async settledEnds(): Promise<Record<string, number>> {
    let previous = await this.ends();
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      const current = await this.ends();
      if (Object.keys(current).every((k) => current[k] === previous[k])) return current;
      previous = current;
    }
    return previous;
  }

  /** Hint of a party id ("DemoVerifier"), or "other" for parties of other worlds. */
  label(party: string): string {
    return this.hintOfParty.get(party) ?? "other";
  }

  async partyStream(role: LedgerRole, end: number): Promise<unknown[]> {
    return this.probe.updates(this.nodeOf(role), this.partyReader(role), { parties: [this.h.party(role)] }, 0, end);
  }

  async nodeStream(node: LedgerNode, end: number): Promise<unknown[]> {
    return this.probe.updates(node, this.nodeReader, { anyParty: true }, 0, end);
  }

  /** How every node sees one update: absent, or its events with the witnessing parties (hints). */
  async informees(updateId: string): Promise<{ raw: Record<string, unknown>; view: Record<string, InformeeView> }> {
    const raw: Record<string, unknown> = {};
    const view: Record<string, InformeeView> = {};
    for (const node of this.nodes) {
      const response = await this.probe.updateById(node, this.nodeReader, { anyParty: true }, updateId);
      raw[node.name] = response;
      const tx = response ? transactionOf(response) : null;
      view[node.name] = tx
        ? {
            received: true,
            offset: tx.offset,
            events: tx.events.map((e) => ({
              kind: e.kind,
              template: e.template,
              ...(e.choice ? { choice: e.choice } : {}),
              witnesses: uniqueSorted(e.witnesses.map((p) => this.label(p))),
              markers: markerHits(e, MARKERS),
            })),
          }
        : { received: false };
    }
    return { raw, view };
  }
}

type InformeeView =
  | { received: false }
  | { received: true; offset: number; events: { kind: string; template: string; choice?: string; witnesses: string[]; markers: string[] }[] };

describe.skipIf(!PRIVACY_IT_ENABLED)("Ledger privacy across five participants (witness level)", () => {
  let h: LocalnetHarness;
  let r: WorldReaders;
  const steps: StepRecord[] = [];
  const checks: Check[] = [];
  const summary: Record<string, unknown> = { run: RUN, generatedBy: "apps/api/test/localnet/privacy/witness.privacy.test.ts" };
  let seedEnds: { before: Record<string, number>; after: Record<string, number> } | null = null;
  let finalEnds: Record<string, number> = {};
  const partyTxs: Record<string, WitnessedTransaction[]> = {};
  const nodeTxs: Record<string, WitnessedTransaction[]> = {};
  const nodeOffsets: Record<string, number[]> = {};
  /** Update id → operation of the command record that produced it (seed step or API operation). */
  const operations = new Map<string, string>();

  const check = (section: string, name: string, ok: boolean, detail?: unknown) => {
    checks.push({ section, name, ok, ...(detail === undefined ? {} : { detail }) });
  };
  const failed = (section: string) => checks.filter((c) => c.section === section && !c.ok);

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "pv" });
    r = new WorldReaders(h);
    if (r.nodes.length !== 5) throw new Error(`the privacy test needs the 5-participant sandbox (node scripts/localnet/up.mjs --participants=5); this sandbox has ${r.nodes.length}`);
    await r.create();
    summary.topology = {
      sandbox: h.state.topology,
      cantonVersion: h.state.cantonVersion,
      participants: Object.fromEntries(r.nodes.map((n) => [n.name, { jsonApiUrl: n.jsonApiUrl, parties: Object.entries(h.state.parties).filter(([, p]) => p.participant === n.name).map(([hint]) => hint) }])),
      readers: { perParty: "CanReadAs <party> only, on the party's participant", perNode: "CanReadAsAnyParty (filtersForAnyParty)" },
    };
    writeJson("topology.json", { prefix: h.prefix, namespace: h.namespace, participants: h.state.participants, parties: h.state.parties, users: h.state.users });
  });

  afterAll(async () => {
    summary.checks = { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).map((c) => ({ section: c.section, name: c.name, detail: c.detail })) };
    writeJson("checks.json", checks);
    writeJson("summary.json", summary);
    writeSummaryFile(summary);
    console.log(`privacy evidence: ${OUT_DIR}; summary: ${SUMMARY_FILE}; checks ${checks.filter((c) => c.ok).length}/${checks.length} passed`);
    await h?.close();
  });

  it("runs the §7 seed and the walkthrough, each command through the acting organisation's own participant", async () => {
    const started = Date.now();
    const before = await r.settledEnds();
    const seed = await h.seed("main");
    seedEnds = { before, after: await r.settledEnds() };
    await h.project();
    const seedMs = Date.now() - started;

    const analyst = await h.loginAs("lender-a-analyst");
    const approver = await h.loginAs("lender-a-approver");
    const borrower = await h.loginAs("manufacturer-owner");
    const auditor = await h.loginAs("auditor");
    let ends = seedEnds.after;
    const step = async (label: string, daml: string, session: ItSession, method: "POST", path: string, body: unknown) => {
      const response = await session.inject(method, path, { body });
      const result = committed(response, label);
      const after = await r.settledEnds();
      steps.push({ label, daml, actor: session.personaId, commandId: result.command.commandId, updateId: result.command.updateId, before: ends, after });
      ends = after;
      await h.project();
      return result;
    };

    await step("W1-W2 save assessment", "Assessment_StartReview + Assessment_Save", analyst, "POST", `/api/cases/${CASE}/assessments`, {
      valuation: { amount: MARKERS.valuation, currency: "USD" },
      valuationSource: "Synthetic desk valuation (demo)",
      valuationDate: new Date().toISOString().slice(0, 10),
      limitations: "Synthetic demo valuation; not an appraisal.",
      outcome: "ELIGIBLE",
      policyRef: "CP-2026-CNC-01",
    });
    await step("W3 submit for approval", "Assessment_SubmitForApproval", analyst, "POST", "/api/reviews/CA-001/submit-for-approval", {});
    await step("W4 approve", "Assessment_Approve", approver, "POST", "/api/reviews/CA-001/decision", { outcome: "ELIGIBLE", sharedFeedback: "Eligible for this lender and case." });
    await step("W5 issue proposal", "Assessment_IssueProposal", approver, "POST", `/api/cases/${CASE}/proposals`, {
      intent: "ISSUE",
      principal: PRINCIPAL,
      termMetadata: MARKERS.termMetadata,
      externalLegalRef: MARKERS.externalLegalRef,
      expiresInDays: 14,
    });
    await step("W6 accept", "Proposal_Accept", borrower, "POST", "/api/proposals/FP-001/acceptance", { expectedVersion: 1 });
    await step("W7 authorize activation", "Agreement_AuthorizeActivation", borrower, "POST", "/api/proposals/FP-001/activation-authorization", { expectedVersion: 1 });
    await step("W8 activate", "Control_Activate", approver, "POST", `/api/cases/${CASE}/pledge-activation`, {});
    await step("W9 release request RR-001", "create ReleaseRequest", borrower, "POST", "/api/pledges/PL-001/release-requests", { reason: "EXTERNAL_LOAN_COMPLETION", note: "Synthetic payoff" });
    await step("W10 reject RR-001", "Release_Reject", approver, "POST", "/api/release-requests/RR-001/decision", { decision: "REJECT", reason: "Payoff confirmation is pending." });
    await step("W11 release request RR-002", "create ReleaseRequest", borrower, "POST", "/api/pledges/PL-001/release-requests", { reason: "EXTERNAL_LOAN_COMPLETION" });
    await step("W12 authorize RR-002", "Release_Authorize", approver, "POST", "/api/release-requests/RR-002/decision", { decision: "AUTHORIZE" });
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const grant = (scopes: string[]) => ({ caseId: CASE, auditorOrgId: "demo-auditor", scopes, permission: "VIEW_EXPORT", purpose: "Synthetic audit of case CL-001", expiresAt });
    await step("W13 audit grant AG-001 (owner)", "create AuditGrant", borrower, "POST", "/api/audit/grants", grant(["EVIDENCE_MANIFEST", "ATTESTATION"]));
    await step("W14 audit grant AG-002 (lender)", "create AuditGrant", approver, "POST", "/api/audit/grants", grant(["DECISION_OUTCOME", "PLEDGE_RELEASE_EVENTS"]));

    // The ledger state the walkthrough must reach (read as the organisations' own users).
    const controls = await h.acsAs("borrower", "AssetControl", (c) => c.namespace === h.namespace && c.assetId === ASSET);
    check("run", "control recreated v5 AVAILABLE after release", controls.length === 1 && controls[0]?.payload.controlVersion === 5 && controls[0]?.payload.sharedLender === null);
    check("run", "no active lock after release", (await h.acsAs("lenderA", "CollateralLock", (l) => l.namespace === h.namespace)).length === 0);
    check("run", "auditor holds AG-001 and AG-002", uniqueSorted((await h.acsAs("auditor", "AuditGrant", (g) => g.caseRef === CASE)).map((g) => g.payload.grantRef)).join(",") === "AG-001,AG-002");

    // Auditor export: produced off-ledger by the worker's handler. No participant's ledger end moves.
    const exportBefore = await r.settledEnds();
    const queued = await auditor.inject("POST", "/api/reports", { body: { caseId: CASE, format: "JSON" } });
    check("run", "auditor export queued (201)", queued.statusCode === 201, queued.statusCode);
    const workerConfig = loadWorkerConfig({ COLLARA_MODE: "LOCALNET", DATABASE_URL: h.databaseUrl });
    const exported = await runExportJobsOnce(
      { db: h.db.db, log: pino({ level: "silent" }), workerId: "privacy-it", config: workerConfig, signal: new AbortController().signal, now: () => new Date() },
      createExportJobHandler({ storage: h.storage }),
    );
    const exportAfter = await r.settledEnds();
    check("run", "auditor export ran (1 ready)", exported.ready === 1, exported);
    check("run", "auditor export moved no participant's ledger end (off-ledger)", JSON.stringify(exportBefore) === JSON.stringify(exportAfter), { exportBefore, exportAfter });

    // Fetch-only informees, measured step by step: a second, asset-level verification round (VR-002). VR_AcceptAssignment
    // and VR_IssueAttestation fetch the registrar's CollaraConfig and the governance party's VerifierAccreditation.
    ends = exportAfter;
    const owner = await h.actor("manufacturer-owner");
    const verifier = await h.actor("verifier-inspector");
    type Prepare = Parameters<LocalnetHarness["workflow"]["run"]>[0]["prepare"];
    const runStep = async (label: string, daml: string, actor: Awaited<ReturnType<LocalnetHarness["actor"]>>, prepare: Prepare) => {
      const outcome = await h.workflow.run({ actor, operation: `it.privacy.${label.split(" ")[0]}`, idempotencyKey: `it-privacy-${randomUUID()}`, payload: {}, prepare });
      check("run", `${label} ${daml} committed`, outcome.committed, outcome.record.errorMessage);
      const after = await r.settledEnds();
      steps.push({ label, daml, actor: actor.userId, commandId: outcome.record.id, updateId: outcome.record.updateId, before: ends, after });
      ends = after;
    };
    const DAY = 86_400_000;
    await runStep("X1 request verification VR-002", "Manifest_RequestVerification", owner, async (ctx) => {
      const manifests = await ctx.acs.list("EvidenceManifest", (m) => m.namespace === ctx.namespace && m.assetId === ASSET);
      const manifest = manifests.sort((a, b) => a.payload.version - b.payload.version).at(-1)!;
      const passport = (await ctx.acs.one("AssetPassport", (p) => p.namespace === ctx.namespace && p.assetId === ASSET))!;
      return {
        commands: [
          L.manifestRequestVerification(manifest.contractId, {
            verifier: h.party("verifier"),
            requestRef: "VR-002",
            passportVersion: passport.payload.passportVersion,
            caseRef: null,
            equipmentScope: "CNC_MACHINERY",
            checklist: ["Serial plate"],
            dueBy: new Date(ctx.now.getTime() + 10 * DAY),
            actorRef: ctx.actorRef,
          }),
        ],
      };
    });
    const inputsOf = async (acs: ReturnType<LocalnetHarness["acs"]>, namespace: string, status: string) => ({
      request: (await acs.one("VerificationRequest", (q) => q.namespace === namespace && q.requestRef === "VR-002" && q.status === status))!,
      config: (await acs.one("CollaraConfig", (c) => c.namespace === namespace))!,
      accreditation: (await acs.one("VerifierAccreditation", (a) => a.registryId === namespace && a.verifierRef === "VER-001" && a.status === "ACTIVE"))!,
    });
    await runStep("X2 accept assignment VR-002", "VR_AcceptAssignment", verifier, async (ctx) => {
      const i = await inputsOf(ctx.acs, ctx.namespace, "REQUESTED");
      return { commands: [L.vrAcceptAssignment(i.request.contractId, { configCid: i.config.contractId, accreditationCid: i.accreditation.contractId, actorRef: ctx.actorRef })] };
    });
    await runStep("X3 issue attestation ATT-002", "VR_IssueAttestation", verifier, async (ctx) => {
      const i = await inputsOf(ctx.acs, ctx.namespace, "IN_REVIEW");
      return {
        commands: [
          L.vrIssueAttestation(i.request.contractId, {
            configCid: i.config.contractId,
            accreditationCid: i.accreditation.contractId,
            attestationRef: "ATT-002",
            checks: [{ item: "Serial plate", finding: "Synthetic check", result: "CHECKED" }],
            limitations: "Synthetic demo attestation.",
            method: "Document review",
            inspectedAt: ctx.now,
            validFrom: ctx.now,
            validUntil: new Date(ctx.now.getTime() + 180 * DAY),
            supersedes: null,
            actorRef: ctx.actorRef,
          }),
        ],
      };
    });
    finalEnds = ends;

    // Routing: every ledger command was submitted by the acting org's ledger user on that user's participant.
    const rows = await h.db.db
      .select({ ledgerUserId: commandsTable.ledgerUserId, ledgerSource: commandsTable.ledgerSource, operation: commandsTable.operation, updateId: commandsTable.updateId, status: commandsTable.status })
      .from(commandsTable)
      .where(isNotNull(commandsTable.ledgerSource));
    const routing: Record<string, { participant: string; commands: number; committed: number }> = {};
    const misrouted: string[] = [];
    for (const row of rows) {
      if (row.updateId) operations.set(row.updateId, row.operation);
      const user = h.state.users.find((u) => u.id === row.ledgerUserId && u.role === "org");
      const hint = user?.party ?? "?";
      if (!user || user.participant !== row.ledgerSource) misrouted.push(`${row.operation}: ${row.ledgerUserId}@${row.ledgerSource}`);
      const entry = (routing[hint] ??= { participant: row.ledgerSource ?? "?", commands: 0, committed: 0 });
      entry.commands += 1;
      if (row.updateId) entry.committed += 1;
    }
    check("routing", "every submission went through the submitting user's own participant", misrouted.length === 0, misrouted);
    // Lender B and the auditor never submit; every other organisation submits from its own participant.
    check("routing", "submissions came from sandbox, participant2, participant3 and participant5", uniqueSorted(Object.values(routing).map((x) => x.participant)).join(",") === "participant2,participant3,participant5,sandbox", routing);
    summary.run = { run: RUN, prefix: h.prefix, namespace: h.namespace, seedSteps: seed.steps.length, seedMs, walkthroughSteps: steps.map((s) => `${s.label} (${s.daml})`), ledgerCommands: rows.length };
    summary.routing = routing;
    writeJson("steps.json", { seedEnds, steps, routing: rows });
    expect(failed("run")).toEqual([]);
    expect(failed("routing")).toEqual([]);
  });

  it("collects every party's and every participant's LEDGER_EFFECTS stream (raw)", async () => {
    expect(Object.keys(finalEnds)).toHaveLength(5);
    for (const role of ROLES) {
      const node = r.nodeOf(role);
      const raw = await r.partyStream(role, finalEnds[node.name]!);
      writeJson(`party-${LEDGER_ROLES[role]}.json`, { party: h.party(role), participant: node.name, reader: r.partyReader(role), elements: raw });
      partyTxs[role] = transactionsOf(raw);
    }
    for (const node of r.nodes) {
      const raw = await r.nodeStream(node, finalEnds[node.name]!);
      writeJson(`node-${node.name}.json`, { participant: node.name, reader: r.nodeReader, elements: raw });
      // This run only: offsets after the seed started (a sandbox that was not restarted also holds earlier runs).
      const own = transactionsOf(raw).filter((tx) => tx.offset > seedEnds!.before[node.name]!);
      nodeTxs[node.name] = own;
      nodeOffsets[node.name] = own.map((tx) => tx.offset);
    }
    expect(Object.keys(partyTxs)).toHaveLength(ROLES.length);
  });

  it("a. per party: no terms, no proposal/agreement/authorization outside borrower and Lender A; Lender B and the auditor get only what they should", () => {
    const S = "per-party";
    const perParty: Record<string, unknown> = {};
    for (const role of ROLES) {
      const txs = partyTxs[role] ?? [];
      const s = summarize(txs, MARKERS);
      const sensitive = txs.flatMap((tx) =>
        tx.events.filter((e) => (SENSITIVE_TEMPLATES as readonly string[]).includes(e.template)).map((e) => ({ updateId: tx.updateId, template: e.template, kind: e.kind, ...(e.choice ? { choice: e.choice } : {}), markers: markerHits(e, MARKERS) })),
      );
      perParty[LEDGER_ROLES[role]] = { participant: r.nodeOf(role).name, ...compact(s), sensitiveTemplateEvents: sensitive };
    }
    summary.perParty = perParty;

    for (const role of NO_TERMS) {
      const s = summarize(partyTxs[role] ?? [], MARKERS);
      check(S, `${LEDGER_ROLES[role]}: no principal, termMetadata, externalLegalRef or valuation in any payload`, totalHits(s) === 0, s.markerEvents);
    }
    for (const role of ["dealer", "verifier", "lenderB", "auditor", "governance", "seat1", "seat2", "seat3"] as const) {
      const sensitive = (partyTxs[role] ?? []).flatMap((tx) => tx.events.filter((e) => (SENSITIVE_TEMPLATES as readonly string[]).includes(e.template)));
      check(S, `${LEDGER_ROLES[role]}: no FinancingProposal / FinancingAgreement / PledgeActivationAuthorization event`, sensitive.length === 0, sensitive.map((e) => `${e.kind} ${e.template}`));
    }
    // The registrar co-signs the control and the lock, so it witnesses Control_Activate and its consequences.
    const registrarSensitive = (partyTxs.registrar ?? []).flatMap((tx) => tx.events.filter((e) => (SENSITIVE_TEMPLATES as readonly string[]).includes(e.template)).map((e) => ({ tx, e })));
    const activateUpdate = steps.find((s) => s.daml === "Control_Activate")?.updateId;
    check(
      S,
      "registrar: the only proposal/agreement/authorization event is the Archive of PledgeActivationAuthorization inside Control_Activate (no create argument, no terms)",
      registrarSensitive.length === 1 &&
        registrarSensitive[0]!.e.template === "PledgeActivationAuthorization" &&
        registrarSensitive[0]!.e.kind === "exercised" &&
        registrarSensitive[0]!.e.choice === "Archive" &&
        registrarSensitive[0]!.tx.updateId === activateUpdate &&
        markerHits(registrarSensitive[0]!.e, MARKERS).length === 0,
      registrarSensitive.map(({ tx, e }) => ({ updateId: tx.updateId, kind: e.kind, template: e.template, choice: e.choice, payload: e.payload })),
    );

    // Lender B: only the directory contracts it is an observer of.
    const lenderB = partyTxs.lenderB ?? [];
    const lenderBEvents = lenderB.flatMap((tx) => tx.events.map((e) => ({ kind: e.kind, template: e.template, ...(e.choice ? { choice: e.choice } : {}), mentionsCase: mentions(e, CASE), mentionsAsset: mentions(e, ASSET) })));
    check(S, "Lender B: only CollaraConfig and VerifierStatusMirror events", lenderBEvents.every((e) => e.template === "CollaraConfig" || e.template === "VerifierStatusMirror"), lenderBEvents);
    check(S, "Lender B: no payload mentions CL-001 or ASSET-DEMO-001", lenderBEvents.every((e) => !e.mentionsCase && !e.mentionsAsset), lenderBEvents);
    summary.lenderBReceived = lenderBEvents;

    // Auditor: AuditGrant only, and exactly the two grants.
    const auditorEvents = (partyTxs.auditor ?? []).flatMap((tx) => tx.events);
    check(S, "auditor: only AuditGrant events", auditorEvents.length > 0 && auditorEvents.every((e) => e.template === "AuditGrant"), auditorEvents.map((e) => `${e.kind} ${e.template}`));
    const grantRefs = auditorEvents.filter((e) => e.kind === "created").map((e) => (e.payload as { grantRef?: string; scopes?: string[] }) ?? {});
    summary.auditorReceived = grantRefs.map((g) => ({ grantRef: g.grantRef, scopes: g.scopes }));
    check(S, "auditor: AG-001 (owner) and AG-002 (lender) created", uniqueSorted(grantRefs.map((g) => g.grantRef ?? "")).join(",") === "AG-001,AG-002");

    // Positive controls: the scan finds terms where they belong; valuation stays with Lender A.
    const borrower = summarize(partyTxs.borrower ?? [], MARKERS);
    const lenderA = summarize(partyTxs.lenderA ?? [], MARKERS);
    check(S, "positive control: borrower stream carries principal, termMetadata and externalLegalRef", borrower.markerHits.principal > 0 && borrower.markerHits.termMetadata > 0 && borrower.markerHits.externalLegalRef > 0, borrower.markerHits);
    check(S, "positive control: Lender A stream carries principal, terms and the valuation", lenderA.markerHits.principal > 0 && lenderA.markerHits.termMetadata > 0 && lenderA.markerHits.valuation > 0, lenderA.markerHits);
    check(S, "valuation (CollateralAssessment) reaches Lender A only, not the borrower", borrower.markerHits.valuation === 0, borrower.markerHits);
    expect(failed(S)).toEqual([]);
  });

  it("b. per node: participants that host no borrower or selected lender store no terms (operator view)", () => {
    const S = "per-node";
    const perNode: Record<string, unknown> = {};
    for (const node of r.nodes) {
      const txs = nodeTxs[node.name] ?? [];
      const s = summarize(txs, MARKERS);
      const witnesses = uniqueSorted(txs.flatMap((tx) => tx.events.flatMap((e) => e.witnesses.map((p) => r.label(p)))));
      const sensitive = txs.flatMap((tx) => tx.events.filter((e) => (SENSITIVE_TEMPLATES as readonly string[]).includes(e.template)).map((e) => `${e.kind} ${e.template}${e.choice ? ` ${e.choice}` : ""}`));
      perNode[node.name] = { hosted: Object.entries(h.state.parties).filter(([, p]) => p.participant === node.name).map(([hint]) => hint), witnesses, ...compact(s), sensitiveTemplateEvents: sensitive };
    }
    summary.perNode = perNode;
    for (const name of NO_TERMS_NODES) {
      const s = summarize(nodeTxs[name] ?? [], MARKERS);
      check(S, `${name}: no principal, termMetadata, externalLegalRef or valuation in anything it stores`, totalHits(s) === 0, s.markerEvents);
    }
    for (const name of ["participant4", "participant5"]) {
      const sensitive = (nodeTxs[name] ?? []).flatMap((tx) => tx.events.filter((e) => (SENSITIVE_TEMPLATES as readonly string[]).includes(e.template)));
      check(S, `${name}: no FinancingProposal / FinancingAgreement / PledgeActivationAuthorization event`, sensitive.length === 0);
    }
    const p2 = summarize(nodeTxs.participant2 ?? [], MARKERS);
    const p3 = summarize(nodeTxs.participant3 ?? [], MARKERS);
    check(S, "positive control: participant2 (borrower) and participant3 (Lender A) store the terms", p2.markerHits.principal > 0 && p3.markerHits.principal > 0);
    check(S, "valuation is stored on participant3 (Lender A) only", p3.markerHits.valuation > 0 && ["sandbox", "participant2", "participant4", "participant5"].every((n) => summarize(nodeTxs[n] ?? [], MARKERS).markerHits.valuation === 0));
    // A node stores only events that one of its own parties witnessed. Its operator view (CanReadAsAnyParty) lists every
    // informee of such an event as a witness, including parties hosted elsewhere: recorded, not a failure.
    const foreignWitnesses: Record<string, string[]> = {};
    for (const node of r.nodes) {
      const hosted = new Set(Object.entries(h.state.parties).filter(([, p]) => p.participant === node.name).map(([hint]) => hint));
      const orphans = (nodeTxs[node.name] ?? []).flatMap((tx) => tx.events.filter((e) => !e.witnesses.some((p) => hosted.has(r.label(p)))).map((e) => `${tx.updateId.slice(0, 12)} ${e.kind} ${e.template}`));
      check(S, `${node.name}: every stored event is witnessed by a party it hosts`, orphans.length === 0, orphans);
      foreignWitnesses[node.name] = (perNode[node.name] as { witnesses: string[] }).witnesses.filter((w) => w !== "other" && !hosted.has(w));
    }
    summary.operatorViewWitnessesHostedElsewhere = foreignWitnesses;
    expect(failed(S)).toEqual([]);
  });

  it("c/d. informees of the sensitive transactions on every node, ledger-end deltas, and what the registrar sees of control → lock", async () => {
    const S = "informees";
    const seedUpdate = async (stepId: string) => (await h.seedCommand(stepId))?.updateId ?? null;
    const key: { label: string; daml: string; updateId: string | null }[] = [
      { label: "M12", daml: "VR_IssueAttestation", updateId: await seedUpdate("M12") },
      { label: "M16", daml: "Control_ShareWithLender", updateId: await seedUpdate("M16") },
      { label: "M17", daml: "Att_DiscloseTo", updateId: await seedUpdate("M17") },
      ...steps.map((s) => ({ label: s.label.split(" ")[0]!, daml: s.daml, updateId: s.updateId })),
    ];
    const informees: Record<string, unknown> = {};
    const rawInformees: Record<string, unknown> = {};
    for (const k of key) {
      if (!k.updateId) {
        check(S, `${k.label} ${k.daml}: update id recorded`, false);
        continue;
      }
      const { raw, view } = await r.informees(k.updateId);
      rawInformees[`${k.label} ${k.daml}`] = { updateId: k.updateId, nodes: raw };
      informees[`${k.label} ${k.daml}`] = { receivedBy: Object.entries(view).filter(([, v]) => v.received).map(([n]) => n), nodes: view };
    }
    writeJson("informees.json", rawInformees);
    summary.informees = informees;

    // Per-step ledger-end deltas vs. updates visible to any hosted party (an offset with nothing visible would be a
    // transaction a node stores without any event for its parties).
    const deltas: Record<string, Record<string, { delta: number; visibleUpdates: number }>> = {};
    const windows = [{ label: "seed (B1-B8, M1-M18)", before: seedEnds!.before, after: seedEnds!.after }, ...steps];
    for (const w of windows) {
      deltas[w.label] = {};
      for (const node of r.nodes) {
        const lo = w.before[node.name]!;
        const hi = w.after[node.name]!;
        const visible = (nodeOffsets[node.name] ?? []).filter((o) => o > lo && o <= hi).length;
        deltas[w.label]![node.name] = { delta: hi - lo, visibleUpdates: visible };
      }
    }
    summary.ledgerEndDeltas = deltas;
    const table = transactionTable(r.nodes.map((n) => n.name), nodeTxs, operations, (p) => r.label(p));
    summary.transactions = table.map((t) => `${t.operation} | ${t.root} | ${t.nodes.join(",")} | informees ${t.informees.join(",")}`);
    writeJson("transactions.json", table);
    // Nodes none of whose parties is an informee of a walkthrough step assign no offset during it.
    const silentButMoved = steps
      .filter((s) => s.label.startsWith("W"))
      .flatMap((s) => Object.entries(deltas[s.label] ?? {}).filter(([, d]) => d.visibleUpdates === 0 && d.delta !== 0).map(([n, d]) => `${s.label} @ ${n}: delta ${d.delta}`));
    check(S, "walkthrough: a node with no visible update for a step assigns no ledger offset during it", silentButMoved.length === 0, silentButMoved);
    // Offsets a node assigned without a visible transaction: what can any reader (CanReadAsAnyParty, with
    // reassignments and topology events) get there?
    const probes: { step: string; node: string; offset: number; found: boolean }[] = [];
    for (const s of steps) {
      for (const node of r.nodes) {
        const visible = new Set(nodeOffsets[node.name] ?? []);
        for (let o = s.before[node.name]! + 1; o <= s.after[node.name]!; o++) {
          if (visible.has(o)) continue;
          probes.push({ step: s.label, node: node.name, offset: o, found: (await r.probe.updateByOffset(node, r.nodeReader, o)) !== null });
        }
      }
    }
    summary.nonVisibleOffsets = {
      probed: probes.length,
      readable: probes.filter((p) => p.found).length,
      perStep: Object.fromEntries(steps.map((s) => [s.label, Object.fromEntries(r.nodes.map((n) => [n.name, probes.filter((p) => p.step === s.label && p.node === n.name).length]))])),
    };
    check(S, "offsets without a visible transaction expose nothing to any reader (UPDATE_NOT_FOUND)", probes.every((p) => !p.found), probes.filter((p) => p.found));

    const view = (label: string) => informees[label] as { receivedBy: string[]; nodes: Record<string, InformeeView> } | undefined;
    const receivedBy = (label: string) => uniqueSorted(view(label)?.receivedBy ?? []).join(",");
    // Expected per daml-model.md §5 (stakeholders + actors; consequences go to the parent's informees).
    check(S, "Control_Activate reaches sandbox (registrar), participant2 (borrower), participant3 (Lender A) only", receivedBy("W8 Control_Activate") === "participant2,participant3,sandbox", view("W8 Control_Activate"));
    check(S, "Proposal_Accept reaches participant2 and participant3 only", receivedBy("W6 Proposal_Accept") === "participant2,participant3", view("W6 Proposal_Accept"));
    check(S, "Agreement_AuthorizeActivation reaches participant2 and participant3 only", receivedBy("W7 Agreement_AuthorizeActivation") === "participant2,participant3", view("W7 Agreement_AuthorizeActivation"));
    check(S, "Release_Reject reaches participant2 and participant3 only (registrar not informed)", receivedBy("W10 Release_Reject") === "participant2,participant3", view("W10 Release_Reject"));
    check(S, "Release_Authorize reaches sandbox (registrar, lock signatory), participant2 and participant3 only", receivedBy("W12 Release_Authorize") === "participant2,participant3,sandbox", view("W12 Release_Authorize"));
    check(S, "VR_IssueAttestation shows events on participant2 (owner) and participant5 (verifier) only", receivedBy("M12 VR_IssueAttestation") === "participant2,participant5", view("M12 VR_IssueAttestation"));
    for (const [prefix, label] of [["X2", "X2 VR_AcceptAssignment"], ["X3", "X3 VR_IssueAttestation"]] as const) {
      check(S, `${label}: events on participant2 (owner) and participant5 (verifier) only; the registrar and governance (fetch informees) see no event`, receivedBy(label) === "participant2,participant5", view(label));
      const d = deltas[steps.find((s) => s.label.startsWith(prefix))?.label ?? ""] ?? {};
      check(S, `${label}: Lender B's participant (an observer of the fetched config) assigns no offset`, d.participant4?.delta === 0, d);
    }
    for (const [label, v] of Object.entries(informees) as [string, { nodes: Record<string, InformeeView> }][]) {
      for (const name of NO_TERMS_NODES) {
        const n = v.nodes[name];
        if (n?.received) check(S, `${label} on ${name}: no terms in any event`, n.events.every((e) => e.markers.length === 0), n.events);
      }
    }

    // d. Control → lock: everything the registrar's own stream holds from the activation and the release.
    const registrarOf = (updateId: string | null) => (partyTxs.registrar ?? []).find((tx) => tx.updateId === updateId);
    const activation = registrarOf(steps.find((s) => s.daml === "Control_Activate")?.updateId ?? null);
    const release = registrarOf(steps.find((s) => s.daml === "Release_Authorize")?.updateId ?? null);
    const eventsOf = (tx: WitnessedTransaction | undefined) =>
      (tx?.events ?? []).map((e) => ({ kind: e.kind, template: e.template, ...(e.choice ? { choice: e.choice, consuming: e.consuming } : {}), fields: fieldsOf(e.payload), markers: markerHits(e, MARKERS) }));
    summary.registrarControlToLock = { Control_Activate: eventsOf(activation), Release_Authorize: eventsOf(release) };
    check(S, "registrar receives the Control_Activate update", activation !== undefined);
    check(S, "registrar: no terms in any event of Control_Activate (consumed control, archived authorization, created lock)", (activation?.events ?? []).every((e) => markerHits(e, MARKERS).length === 0), eventsOf(activation));
    check(S, "registrar: no terms in any event of Release_Authorize (Lock_Release, recreated control, released record)", (release?.events ?? []).every((e) => markerHits(e, MARKERS).length === 0), eventsOf(release));
    check(S, "registrar does not see the Release_Authorize root or the ReleaseDecision", !(release?.events ?? []).some((e) => e.choice === "Release_Authorize" || e.template === "ReleaseDecision"), eventsOf(release));
    expect(failed(S)).toEqual([]);
  });
});

describe.skipIf(!PRIVACY_IT_ENABLED)("Revocation race on five participants: AttestationDisclosure revoked vs. Control_Activate (daml-model.md §8.2)", () => {
  const race: Record<string, unknown> = {};
  const raceChecks: Check[] = [];
  const rcheck = (name: string, ok: boolean, detail?: unknown) => raceChecks.push({ section: "race", name, ok, ...(detail === undefined ? {} : { detail }) });

  afterAll(() => {
    writeJson("race.json", { race, checks: raceChecks });
    // Merge into the summary written by the first describe block (same run).
    try {
      const file = join(OUT_DIR, "summary.json");
      const current = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      current.race = race;
      const prior = current.checks as { total: number; passed: number; failed: unknown[] };
      current.checks = { total: prior.total + raceChecks.length, passed: prior.passed + raceChecks.filter((c) => c.ok).length, failed: [...prior.failed, ...raceChecks.filter((c) => !c.ok)] };
      writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
      writeSummaryFile(current);
    } catch (error) {
      console.log(`race: could not merge into the summary: ${String(error)}`);
    }
  });

  const disclosuresOfLender = (w: AuthorizedWorld) => w.h.acsAs("lenderA", "AttestationDisclosure", (d) => d.caseRef === CASE && d.attestation.attestationRef === "ATT-001");
  const revoke = async (w: AuthorizedWorld, operation: string) => {
    const disclosure = (await w.h.acsAs("borrower", "AttestationDisclosure", (d) => d.recipient === w.h.party("lenderA") && d.caseRef === CASE))[0];
    if (!disclosure) throw new Error("no disclosure to revoke");
    return w.h.workflow.run({
      actor: await w.h.actor("manufacturer-owner"),
      operation,
      idempotencyKey: `${operation}-${randomUUID()}`,
      payload: {},
      prepare: async (ctx) => ({ commands: [L.attDiscRevoke(disclosure.contractId, { actorRef: ctx.actorRef })] }),
    });
  };
  const locks = (w: AuthorizedWorld) => w.h.acsAs("lenderA", "CollateralLock", (l) => l.namespace === w.h.namespace && l.assetId === ASSET);

  it("deterministic interleaving: the revocation commits after the API's disclosure precheck and before Control_Activate", async () => {
    const w = await authorizedWorld("pvr");
    try {
      const readers = new WorldReaders(w.h);
      if (readers.nodes.length !== 5) throw new Error("needs the 5-participant sandbox");
      await readers.create();
      expect(await disclosuresOfLender(w)).toHaveLength(1);
      const runner = w.h.workflow.runner as WorkflowRunner & { run: WorkflowRunner["run"] };
      const original = runner.run.bind(runner);
      let revocation: Awaited<ReturnType<typeof revoke>> | null = null;
      let disclosuresAtSubmit = -1;
      // Wrap the runner: once the activation's prepare() has passed (it includes requireActiveAttestationDisclosure),
      // the owner revokes the disclosure; then the runner submits the prepared Control_Activate.
      runner.run = ((input: Parameters<WorkflowRunner["run"]>[0]) =>
        original(
          input.operation !== "pledge.activate"
            ? input
            : {
                ...input,
                prepare: async (ctx) => {
                  const plan = await input.prepare(ctx);
                  revocation = await revoke(w, "it.privacy.race.revoke");
                  disclosuresAtSubmit = (await disclosuresOfLender(w)).length;
                  return plan;
                },
              },
        )) as WorkflowRunner["run"];
      let response: LightMyRequestResponse;
      try {
        response = await w.approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} });
      } finally {
        delete (runner as { run?: unknown }).run;
      }
      const body = response.json();
      const activationUpdate: string | null = body.command?.updateId ?? null;
      const revokeUpdate = (revocation as Awaited<ReturnType<typeof revoke>> | null)?.record.updateId ?? null;
      const lockCount = (await locks(w)).length;
      const informed = {
        revocation: revokeUpdate ? (await readers.informees(revokeUpdate)).view : null,
        activation: activationUpdate ? (await readers.informees(activationUpdate)).view : null,
      };
      const offsetsOnLender = { revocation: (informed.revocation?.participant3 as { offset?: number } | undefined)?.offset ?? null, activation: (informed.activation?.participant3 as { offset?: number } | undefined)?.offset ?? null };
      race.deterministic = {
        prefix: w.h.prefix,
        revocationCommitted: (revocation as Awaited<ReturnType<typeof revoke>> | null)?.committed ?? false,
        lenderDisclosuresWhenActivationWasSubmitted: disclosuresAtSubmit,
        activation: { httpStatus: response.statusCode, state: body.command?.state ?? null, pledgeRef: body.result?.pledgeRef ?? null },
        activeLocksAfter: lockCount,
        lenderDisclosuresAfter: (await disclosuresOfLender(w)).length,
        orderOnLenderParticipant: offsetsOnLender,
        informees: { revocation: summarizeInformees(informed.revocation), activation: summarizeInformees(informed.activation) },
      };
      rcheck("deterministic: the revocation committed before the activation was submitted", disclosuresAtSubmit === 0 && revokeUpdate !== null);
      rcheck("deterministic: the ledger committed Control_Activate anyway (it does not read the disclosure)", response.statusCode === 200 && body.command?.state === "COMMITTED" && lockCount === 1, race.deterministic);
      rcheck("deterministic: on the lender's participant the revocation precedes the activation", offsetsOnLender.revocation !== null && offsetsOnLender.activation !== null && offsetsOnLender.revocation < offsetsOnLender.activation, offsetsOnLender);
      rcheck("deterministic: the verifier's participant receives the revocation (verifier signs the disclosure) but not the activation", (informed.revocation?.participant5 as { received?: boolean } | undefined)?.received === true && (informed.activation?.participant5 as { received?: boolean } | undefined)?.received === false, race.deterministic);
    } finally {
      await w.h.close();
    }
    expect(raceChecks.filter((c) => !c.ok)).toEqual([]);
  });

  it("unsynchronised: activation through the API and revocation submitted concurrently (outcome recorded, not asserted)", async () => {
    const w = await authorizedWorld("pvc");
    try {
      const readers = new WorldReaders(w.h);
      await readers.create();
      const [activation, revocation] = await Promise.all([w.approver.inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} }), revoke(w, "it.privacy.race.concurrent-revoke")]);
      const body = activation.json();
      const activationUpdate: string | null = body.command?.updateId ?? null;
      const revokeUpdate = revocation.record.updateId ?? null;
      const lenderOffsets = {
        revocation: revokeUpdate ? ((await readers.informees(revokeUpdate)).view.participant3 as { offset?: number }).offset ?? null : null,
        activation: activationUpdate ? ((await readers.informees(activationUpdate)).view.participant3 as { offset?: number }).offset ?? null : null,
      };
      const lockCount = (await locks(w)).length;
      race.concurrent = {
        prefix: w.h.prefix,
        activation: { httpStatus: activation.statusCode, state: body.command?.state ?? null, detail: body.detail ?? null },
        revocation: { state: revocation.command.state },
        activeLocksAfter: lockCount,
        lenderDisclosuresAfter: (await disclosuresOfLender(w)).length,
        orderOnLenderParticipant: lenderOffsets,
        outcome:
          activation.statusCode !== 200
            ? "API refused the activation (the revocation was visible at the precheck)"
            : lenderOffsets.revocation !== null && lenderOffsets.activation !== null && lenderOffsets.revocation < lenderOffsets.activation
              ? "both committed; the revocation was committed first, so the lock was created without an active disclosure"
              : "both committed; the activation was committed first",
      };
      rcheck("concurrent: the revocation committed", revocation.committed);
      rcheck("concurrent: at most one lock, and a lock only when the activation committed", lockCount === (activation.statusCode === 200 ? 1 : 0), race.concurrent);
    } finally {
      await w.h.close();
    }
    expect(raceChecks.filter((c) => !c.ok)).toEqual([]);
  });
});

function totalHits(s: StreamSummary): number {
  return s.markerHits.principal + s.markerHits.termMetadata + s.markerHits.externalLegalRef + s.markerHits.valuation;
}

/** Summary without the per-event marker list (kept in the raw files). */
function compact(s: StreamSummary) {
  return { transactions: s.transactions, events: s.events, templates: s.templates, markerHits: s.markerHits };
}

/** Top-level field names of a payload (create argument, or the choice argument of an exercise). */
function fieldsOf(payload: unknown): string[] {
  if (payload === null || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const target = "choiceArgument" in p ? p.choiceArgument : p;
  return target && typeof target === "object" ? Object.keys(target as object).sort() : [];
}

function summarizeInformees(view: Record<string, InformeeView> | null) {
  if (!view) return null;
  return Object.fromEntries(Object.entries(view).map(([node, v]) => [node, v.received ? v.events.map((e) => `${e.kind} ${e.template}${e.choice ? ` ${e.choice}` : ""} [${e.witnesses.join(",")}]`) : "not received"]));
}

/**
 * Every transaction any node shows, oldest first: the command operation that produced it, the root event of the widest
 * projection (the submitter's view), the nodes that store it and its informees (union of the operator views' witnesses).
 */
function transactionTable(nodes: readonly string[], nodeTxs: Record<string, WitnessedTransaction[]>, operations: ReadonlyMap<string, string>, label: (party: string) => string) {
  const all = new Map<string, { recordTime: string; operation: string; root: string; size: number; nodes: string[]; informees: Set<string> }>();
  for (const node of nodes) {
    for (const tx of nodeTxs[node] ?? []) {
      const first = [...tx.events].sort((a, b) => a.nodeId - b.nodeId)[0];
      const root = first ? `${first.kind} ${first.template}${first.choice ? ` ${first.choice}` : ""}` : "(no events)";
      const entry = all.get(tx.updateId) ?? { recordTime: tx.recordTime, operation: operations.get(tx.updateId) ?? "?", root, size: tx.events.length, nodes: [], informees: new Set<string>() };
      entry.nodes.push(node);
      if (tx.events.length > entry.size) {
        entry.root = root;
        entry.size = tx.events.length;
      }
      for (const e of tx.events) for (const w of e.witnesses) entry.informees.add(label(w));
      all.set(tx.updateId, entry);
    }
  }
  return [...all.entries()]
    .sort(([, a], [, b]) => a.recordTime.localeCompare(b.recordTime))
    .map(([updateId, t]) => ({ updateId, recordTime: t.recordTime, operation: t.operation, root: t.root, nodes: [...t.nodes].sort(), informees: uniqueSorted(t.informees) }));
}
