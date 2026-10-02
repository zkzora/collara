// LocalNet adversarial sweep (LOCALNET_IT=1) over EVERY route of the web client's route table (packages/api-client
// API_ENDPOINTS) that takes an id, with the real ids of CL-001 on a fresh "adv-<unique>" prefix: main seed, then the
// financing path through the API up to an open release request (CA-001 eligible, FP-001 accepted, PL-001 active,
// RR-001 requested), an owner audit grant, an auditor report and a governance proposal.
//
//   1. anonymous → 401 on every route (valid body and Idempotency-Key, so nothing else answers first);
//   2. the unrelated organisation → a 404 body byte-identical (modulo the request id) to the one for an unknown id
//      of the same shape: Demo Lender B for case records, the dealer (no governance seat) for governance proposals;
//   3. browser-supplied org / party / actAs / role headers, body fields and query parameters never change the outcome,
//      and unauthorised calls never create a command record;
//   4. a mutation without Idempotency-Key is rejected (400) before anything is recorded;
//   5. a second app whose gateway points at a dead port (7599): every ledger mutation answers 503 ledger_unavailable
//      with the approved copy and a FAILED (never simulated) command, and the ledger is unchanged;
//   6. the same Idempotency-Key with a different payload → 409 (idempotency_conflict once a record exists).
import { randomUUID } from "node:crypto";
import { commands as commandsTable } from "@collara/db";
import { COMMAND_COPY, DEMO_PERSONAS, ERROR_COPY, type PersonaId } from "@collara/domain";
import { and, count, eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_ENDPOINTS, endpointPath, type EndpointName } from "../../../../packages/api-client/src/client";
import { loadConfig as loadWorkerConfig } from "../../../worker/src/config";
import { createExportJobHandler } from "../../../worker/src/jobs/handlers/export";
import { runExportJobsOnce } from "../../../worker/src/jobs/registry";
import { buildApp, type CollaraApp } from "../../src/app";
import { CantonLedgerGateway, DEV_HMAC_SECRET, LedgerAccess } from "../../src/ledger";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type HttpMethod, type ItSession, type LocalnetHarness } from "./harness";

const CASE = "CL-001";
const ASSET = "ASSET-DEMO-001";
const DEAD_LEDGER = "http://127.0.0.1:7599";
const PRINCIPAL = { amount: "100000.00", currency: "USD" } as const;
const PDF = Buffer.from("%PDF-1.4\n% synthetic adversarial test\n%%EOF\n");

type Who = "borrower" | "analyst" | "approver" | "verifier" | "dealer" | "auditor" | "lenderB";
const PERSONA: Readonly<Record<Who, PersonaId>> = {
  borrower: "manufacturer-owner",
  analyst: "lender-a-analyst",
  approver: "lender-a-approver",
  verifier: "verifier-inspector",
  dealer: "dealer-contributor",
  auditor: "auditor",
  lenderB: "lender-b-approver",
};

interface Ids {
  doc: string;
  command: string;
  grant: string;
  report: string;
  proposal: string;
}

interface RouteSpec {
  /** Real id of a CL-001 record and an unknown id of the same shape. */
  readonly real: (ids: Ids) => string;
  readonly unknown: string;
  /** The organisation that may act (mutations) or read (GET) the record. */
  readonly actor: Who;
  /** Unrelated to the record (default Demo Lender B; governance: the dealer, which holds no seat). */
  readonly outsider?: Who;
  /** Valid body, and a different valid body for the idempotency check (undefined: the route has no payload). */
  readonly body?: (ids: Ids) => unknown;
  readonly otherBody?: (ids: Ids) => unknown;
  /** Raw (non-JSON) body with its content type. */
  readonly raw?: { readonly contentType: string; readonly bytes: Buffer };
  /** Application-only command (no ledger submission): excluded from the dead-ledger sweep. */
  readonly application?: boolean;
}

const assessment = (valuation: string) => ({
  valuation: { amount: valuation, currency: "USD" },
  valuationSource: "Synthetic desk valuation (demo)",
  valuationDate: new Date().toISOString().slice(0, 10),
  limitations: "",
  outcome: "ELIGIBLE",
  policyRef: "CP-2026-CNC-01",
});
const verificationBody = (ids: Ids, scope: string) => ({ verifierRegistryRef: "VER-001", scope: [scope], documentIds: [ids.doc] });
const attestationBody = (method: string) => ({
  method,
  inspectedAt: new Date().toISOString(),
  validUntil: new Date(Date.now() + 180 * 86_400_000).toISOString(),
  checks: [{ item: "Serial consistency", finding: "SYNTH-CNC-001 matches", result: "CHECKED" }],
  limitations: "Synthetic test attestation.",
});

/** Every API_ENDPOINTS entry with ":id". The test fails if the table gains an id route that is not listed here. */
const ROUTES: Readonly<Partial<Record<EndpointName, RouteSpec>>> = {
  "cases.get": { real: () => CASE, unknown: "CL-999", actor: "borrower" },
  "cases.evidence": { real: () => CASE, unknown: "CL-999", actor: "borrower" },
  "cases.share": {
    real: () => CASE,
    unknown: "CL-999",
    actor: "borrower",
    body: () => ({ recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" }),
    otherBody: () => ({ recipientOrgId: "demo-lender-a", permission: "VIEW" }),
  },
  "cases.requestVerification": {
    real: () => CASE,
    unknown: "CL-999",
    actor: "borrower",
    body: (ids) => verificationBody(ids, "Serial number consistency"),
    otherBody: (ids) => verificationBody(ids, "Equipment photos"),
  },
  "cases.saveAssessment": { real: () => CASE, unknown: "CL-999", actor: "analyst", body: () => assessment("150000.00"), otherBody: () => assessment("140000.00") },
  "cases.createProposal": {
    real: () => CASE,
    unknown: "CL-999",
    actor: "approver",
    body: () => ({ intent: "ISSUE", principal: PRINCIPAL }),
    otherBody: () => ({ intent: "ISSUE", principal: { amount: "90000.00", currency: "USD" } }),
  },
  "cases.activatePledge": { real: () => CASE, unknown: "CL-999", actor: "approver", body: () => ({}) },
  "assets.get": { real: () => ASSET, unknown: "ASSET-DEMO-999", actor: "borrower" },
  "assets.evidence": { real: () => ASSET, unknown: "ASSET-DEMO-999", actor: "borrower" },
  "assets.requestVerification": {
    real: () => ASSET,
    unknown: "ASSET-DEMO-999",
    actor: "borrower",
    body: (ids) => verificationBody(ids, "Serial number consistency"),
    otherBody: (ids) => verificationBody(ids, "Equipment photos"),
  },
  "evidence.uploadContent": { real: (ids) => ids.doc, unknown: "DOC-999", actor: "borrower", raw: { contentType: "application/pdf", bytes: PDF }, application: true },
  "evidence.finalize": { real: (ids) => ids.doc, unknown: "DOC-999", actor: "borrower", body: () => ({}), application: true },
  "evidence.get": { real: (ids) => ids.doc, unknown: "DOC-999", actor: "borrower" },
  "evidence.download": { real: (ids) => ids.doc, unknown: "DOC-999", actor: "borrower" },
  "verifications.get": { real: () => "VR-001", unknown: "VR-999", actor: "verifier" },
  "verifications.decideAssignment": {
    real: () => "VR-001",
    unknown: "VR-999",
    actor: "verifier",
    body: () => ({ decision: "ACCEPT" }),
    otherBody: () => ({ decision: "DECLINE", reason: "Synthetic decline" }),
  },
  "verifications.requestChanges": { real: () => "VR-001", unknown: "VR-999", actor: "verifier", body: () => ({ message: "Please add photos." }), otherBody: () => ({ message: "Please add the invoice." }) },
  "verifications.submitEvidence": { real: () => "VR-001", unknown: "VR-999", actor: "borrower" },
  "verifications.issueAttestation": {
    real: () => "VR-001",
    unknown: "VR-999",
    actor: "verifier",
    body: () => attestationBody("On-site inspection"),
    otherBody: () => attestationBody("Desktop review"),
  },
  "verifications.reject": { real: () => "VR-001", unknown: "VR-999", actor: "verifier", body: () => ({ reason: "Synthetic rejection" }), otherBody: () => ({ reason: "Another reason" }) },
  "attestations.get": { real: () => "ATT-001", unknown: "ATT-999", actor: "borrower" },
  "reviews.get": { real: () => "CA-001", unknown: "CA-999", actor: "analyst" },
  "reviews.submitForApproval": { real: () => "CA-001", unknown: "CA-999", actor: "analyst", body: () => ({}) },
  "reviews.decide": {
    real: () => "CA-001",
    unknown: "CA-999",
    actor: "approver",
    body: () => ({ outcome: "ELIGIBLE" }),
    otherBody: () => ({ outcome: "REJECTED" }),
  },
  "reviews.requestInformation": { real: () => "CA-001", unknown: "CA-999", actor: "approver", body: () => ({ message: "Please confirm the hours." }), otherBody: () => ({ message: "Please confirm the site." }) },
  "proposals.get": { real: () => "FP-001", unknown: "FP-999", actor: "borrower" },
  "proposals.accept": { real: () => "FP-001", unknown: "FP-999", actor: "borrower", body: () => ({ expectedVersion: 1 }), otherBody: () => ({ expectedVersion: 2 }) },
  "proposals.decline": { real: () => "FP-001", unknown: "FP-999", actor: "borrower", body: () => ({ expectedVersion: 1 }), otherBody: () => ({ expectedVersion: 1, reason: "Synthetic" }) },
  "proposals.withdraw": { real: () => "FP-001", unknown: "FP-999", actor: "approver", body: () => ({}), otherBody: () => ({ reason: "Synthetic" }) },
  "proposals.authorizeActivation": { real: () => "FP-001", unknown: "FP-999", actor: "borrower", body: () => ({ expectedVersion: 1 }), otherBody: () => ({ expectedVersion: 2 }) },
  "pledges.get": { real: () => "PL-001", unknown: "PL-999", actor: "borrower" },
  "pledges.requestRelease": {
    real: () => "PL-001",
    unknown: "PL-999",
    actor: "borrower",
    body: () => ({ reason: "EXTERNAL_LOAN_COMPLETION" }),
    otherBody: () => ({ reason: "REFINANCING" }),
  },
  "releaseRequests.get": { real: () => "RR-001", unknown: "RR-999", actor: "borrower" },
  "releaseRequests.decide": {
    real: () => "RR-001",
    unknown: "RR-999",
    actor: "approver",
    body: () => ({ decision: "AUTHORIZE" }),
    otherBody: () => ({ decision: "REJECT", reason: "Synthetic" }),
  },
  "releaseRequests.requestInformation": { real: () => "RR-001", unknown: "RR-999", actor: "approver", body: () => ({ message: "Payoff reference?" }), otherBody: () => ({ message: "Servicing reference?" }) },
  "releaseRequests.respond": { real: () => "RR-001", unknown: "RR-999", actor: "borrower", body: () => ({ message: "Sent (synthetic)." }), otherBody: () => ({ message: "Resent (synthetic)." }) },
  "releaseRequests.withdraw": { real: () => "RR-001", unknown: "RR-999", actor: "borrower", body: () => ({}) },
  "accessGrants.revoke": { real: (ids) => ids.grant, unknown: "AG-999", actor: "borrower", body: () => ({}) },
  "reports.download": { real: (ids) => ids.report, unknown: "RPT-9999", actor: "auditor" },
  "governance.proposal": { real: (ids) => ids.proposal, unknown: "GP-999", actor: "approver", outsider: "dealer" },
  "governance.confirm": { real: (ids) => ids.proposal, unknown: "GP-999", actor: "auditor", outsider: "dealer", body: () => ({}) },
  "governance.execute": { real: (ids) => ids.proposal, unknown: "GP-999", actor: "approver", outsider: "dealer", body: () => ({}) },
  "governance.cancel": { real: (ids) => ids.proposal, unknown: "GP-999", actor: "approver", outsider: "dealer", body: () => ({}) },
  "commands.get": { real: (ids) => ids.command, unknown: "00000000-0000-4000-8000-000000000000", actor: "approver" },
};

const ID_ROUTES = (Object.keys(API_ENDPOINTS) as EndpointName[]).filter((name) => API_ENDPOINTS[name].path.includes(":id"));
const isMutation = (name: EndpointName) => API_ENDPOINTS[name].method !== "GET";
const spec = (name: EndpointName): RouteSpec => {
  const s = ROUTES[name];
  if (!s) throw new Error(`no adversarial spec for ${name}`);
  return s;
};

/** Status, content type and body with the request id removed (the only per-request part of a problem). */
function shape(response: LightMyRequestResponse) {
  return {
    status: response.statusCode,
    type: String(response.headers["content-type"] ?? ""),
    body: response.body.replace(/urn:collara:request:[^"]+/g, "urn:collara:request:<id>"),
  };
}

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet adversarial sweep over every id route of API_ENDPOINTS", () => {
  let h: LocalnetHarness;
  const sessions = {} as Record<Who, ItSession>;
  const ids = {} as Ids;
  const facts: Record<string, unknown> = {};
  let deadApp: CollaraApp | null = null;

  const as = (who: Who) => sessions[who];
  const url = (name: EndpointName, id: string, query = "") => `/api${endpointPath(name, id)}${query}`;
  /** One call of a route as a session (null = anonymous). */
  const call = (name: EndpointName, id: string, who: Who | null, options: { key?: string | null; body?: unknown; headers?: Record<string, string>; query?: string } = {}) => {
    const s = spec(name);
    const method = API_ENDPOINTS[name].method as HttpMethod;
    const body = options.body !== undefined ? options.body : s.raw ? s.raw.bytes : isMutation(name) ? (s.body?.(ids) ?? {}) : undefined;
    const headers = { ...(s.raw ? { "content-type": s.raw.contentType } : {}), ...options.headers };
    return h.inject(method, url(name, id, options.query), {
      as: who ? as(who) : null,
      ...(body !== undefined ? { body } : {}),
      ...(options.key !== undefined ? { idempotencyKey: options.key } : {}),
      headers,
    });
  };
  const commandCount = async (who: Who, key?: string) => {
    const userId = DEMO_PERSONAS[PERSONA[who]].userId;
    const [row] = await h.db.db
      .select({ n: count() })
      .from(commandsTable)
      .where(key ? and(eq(commandsTable.actorUserId, userId), eq(commandsTable.idempotencyKey, key)) : eq(commandsTable.actorUserId, userId));
    return row?.n ?? 0;
  };
  const ok = async (label: string, response: Promise<LightMyRequestResponse>) => {
    const r = await response;
    expect([200, 201], `${label}: ${r.statusCode} ${r.body}`).toContain(r.statusCode);
    await h.project();
    return r.json();
  };
  /** Active contracts the main organisations see right now (the ledger, not projections). */
  const ledgerSnapshot = async () => {
    const counts: Record<string, number> = {};
    for (const [role, template] of [
      ["borrower", "CollateralLock"],
      ["borrower", "ReleaseRequest"],
      ["borrower", "FinancingAgreement"],
      ["borrower", "PackageShare"],
      ["borrower", "VerificationRequest"],
      ["borrower", "AuditGrant"],
      ["lenderA", "CollateralAssessment"],
      ["lenderA", "FinancingProposal"],
      ["lenderA", "PledgeActivationAuthorization"],
      ["verifier", "VerificationAttestation"],
      ["seat1", "SuspendVerifierProposal"],
    ] as const) {
      counts[`${role}:${template}`] = (await h.acsAs(role, template)).length;
    }
    return counts;
  };

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "adv" });
    const started = Date.now();
    await h.seed("main");
    await h.project();
    for (const who of Object.keys(PERSONA) as Who[]) sessions[who] = await h.loginAs(PERSONA[who]);

    const evidence = (await as("borrower").inject("GET", `/api/cases/${CASE}/evidence`)).json() as { id: string }[];
    ids.doc = evidence[0]!.id;
    await ok("save assessment", as("approver").inject("POST", `/api/cases/${CASE}/assessments`, { body: assessment("150000.00") }));
    await ok("decide eligible", as("approver").inject("POST", "/api/reviews/CA-001/decision", { body: { outcome: "ELIGIBLE" } }));
    await ok("issue FP-001", as("approver").inject("POST", `/api/cases/${CASE}/proposals`, { body: { intent: "ISSUE", principal: PRINCIPAL } }));
    await ok("accept v1", as("borrower").inject("POST", "/api/proposals/FP-001/acceptance", { body: { expectedVersion: 1 } }));
    await ok("authorize activation", as("borrower").inject("POST", "/api/proposals/FP-001/activation-authorization", { body: { expectedVersion: 1 } }));
    const activated = await ok("activate", as("approver").inject("POST", `/api/cases/${CASE}/pledge-activation`, { body: {} }));
    ids.command = activated.command.commandId;
    await ok("request release", as("borrower").inject("POST", "/api/pledges/PL-001/release-requests", { body: { reason: "EXTERNAL_LOAN_COMPLETION" } }));
    const grant = await ok(
      "owner audit grant",
      as("borrower").inject("POST", "/api/access-grants", {
        body: { caseId: CASE, auditorOrgId: "demo-auditor", scopes: ["EVIDENCE_MANIFEST", "ATTESTATION"], permission: "VIEW_EXPORT", purpose: "Synthetic audit", expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
      }),
    );
    ids.grant = grant.result.grantId;
    const report = await ok("auditor report", as("auditor").inject("POST", "/api/reports", { body: { caseId: CASE, format: "JSON" } }));
    ids.report = report.result.ref;
    const config = loadWorkerConfig({ COLLARA_MODE: "LOCALNET", DATABASE_URL: h.databaseUrl });
    await runExportJobsOnce(
      { db: h.db.db, log: pino({ level: "silent" }), workerId: "adv-worker", config, signal: new AbortController().signal, now: () => new Date() },
      createExportJobHandler({ storage: h.storage }),
    );
    const proposal = await ok(
      "governance proposal",
      as("approver").inject("POST", "/api/governance/proposals", { body: { type: "SUSPEND_VERIFIER", verifierRef: "VER-001", rationale: "Synthetic adversarial test (never executed)." } }),
    );
    ids.proposal = proposal.result.proposalRef;
    await h.project();
    facts.prefix = h.prefix;
    facts.setupMs = Date.now() - started;
    facts.ids = { ...ids };
  });

  afterAll(async () => {
    console.log(`LocalNet adversarial facts: ${JSON.stringify(facts, null, 2)}`);
    await deadApp?.close();
    await h?.close();
  });

  it("covers every id route of API_ENDPOINTS", () => {
    expect(ID_ROUTES.filter((name) => !ROUTES[name])).toEqual([]);
    facts.idRoutes = { total: ID_ROUTES.length, mutations: ID_ROUTES.filter(isMutation).length, reads: ID_ROUTES.filter((n) => !isMutation(n)).length };
  });

  it("the legitimate actor reaches every record (the ids are real)", async () => {
    for (const name of ID_ROUTES.filter((n) => !isMutation(n))) {
      const r = await call(name, spec(name).real(ids), spec(name).actor);
      expect(r.statusCode, `${name}: ${r.body}`).toBe(200);
    }
  });

  it("anonymous → 401 on every id route", async () => {
    for (const name of ID_ROUTES) {
      for (const id of [spec(name).real(ids), spec(name).unknown]) {
        const r = await call(name, id, null);
        expect(r.statusCode, `${name} ${id}: ${r.body}`).toBe(401);
      }
    }
    facts.anonymous401 = ID_ROUTES.length * 2;
  });

  it("an unrelated organisation gets a 404 byte-identical to an unknown id, and no command record", async () => {
    const before = { lenderB: await commandCount("lenderB"), dealer: await commandCount("dealer") };
    let compared = 0;
    for (const name of ID_ROUTES) {
      const s = spec(name);
      const outsider = s.outsider ?? "lenderB";
      const real = await call(name, s.real(ids), outsider);
      const unknown = await call(name, s.unknown, outsider);
      expect(real.statusCode, `${name} as ${outsider}: ${real.body}`).toBe(404);
      expect(real.json().detail, name).toBe(ERROR_COPY.UNAVAILABLE);
      expect(shape(real), name).toEqual(shape(unknown));
      expect(real.body).not.toMatch(/Demo Manufacturer|100000|SYNTH-CNC/);
      compared += 1;
    }
    expect(await commandCount("lenderB")).toBe(before.lenderB);
    expect(await commandCount("dealer")).toBe(before.dealer);
    facts.outsider404Identical = compared;
  });

  it("browser-supplied org, party, actAs and role values never change the outcome", async () => {
    const spoofHeaders = {
      "x-collara-org": "demo-lender-a",
      "x-collara-org-id": "demo-lender-a",
      "x-collara-party": h.party("lenderA"),
      "x-collara-act-as": h.party("lenderA"),
      "x-collara-role": "LENDER_APPROVER",
      "x-collara-user": DEMO_PERSONAS["lender-a-approver"].userId,
      "x-forwarded-user": DEMO_PERSONAS["lender-a-approver"].userId,
    };
    const spoofBody = { orgId: "demo-lender-a", party: h.party("lenderA"), actAs: [h.party("lenderA")], readAs: [h.party("lenderA")], lender: h.party("lenderA"), userId: DEMO_PERSONAS["lender-a-approver"].userId, role: "LENDER_APPROVER" };
    const spoofQuery = `?orgId=demo-lender-a&party=${encodeURIComponent(h.party("lenderA"))}&actAs=${encodeURIComponent(h.party("lenderA"))}`;
    const before = await commandCount("lenderB");
    const outcomes: Record<string, number> = {};
    for (const name of ID_ROUTES) {
      const s = spec(name);
      const outsider = s.outsider ?? "lenderB";
      const plain = await call(name, s.real(ids), outsider);
      const body = isMutation(name) && !s.raw ? { ...((s.body?.(ids) as object | undefined) ?? {}), ...spoofBody } : undefined;
      const spoofed = await call(name, s.real(ids), outsider, { headers: spoofHeaders, query: isMutation(name) ? "" : spoofQuery, ...(body ? { body } : {}) });
      // The same 404 as without the spoofed values (a strict body schema may refuse unknown fields: still no access).
      if (spoofed.statusCode === 400) outcomes.rejectedAsInvalid = (outcomes.rejectedAsInvalid ?? 0) + 1;
      else {
        expect(shape(spoofed), name).toEqual(shape(plain));
        outcomes.identical404 = (outcomes.identical404 ?? 0) + 1;
      }
    }
    expect(await commandCount("lenderB")).toBe(before);

    // A legitimate reader with spoofed values sees exactly its own view.
    const own = await call("cases.get", CASE, "approver");
    const spoofedOwn = await call("cases.get", CASE, "approver", { headers: { ...spoofHeaders, "x-collara-org": "demo-lender-b", "x-collara-party": h.party("lenderB") }, query: "?orgId=demo-lender-b" });
    expect(spoofedOwn.statusCode).toBe(200);
    const strip = (r: LightMyRequestResponse) => {
      const { lastSync: _lastSync, ...rest } = r.json() as Record<string, unknown>;
      return rest;
    };
    expect(strip(spoofedOwn)).toEqual(strip(own));
    // The verifier claiming to be the lender still cannot read the proposal.
    expect((await call("proposals.get", "FP-001", "verifier", { headers: spoofHeaders, query: spoofQuery })).statusCode).toBe(404);
    facts.spoofing = outcomes;
  });

  it("a mutation without Idempotency-Key is rejected before anything is recorded", async () => {
    let rejected = 0;
    for (const name of ID_ROUTES.filter(isMutation)) {
      const s = spec(name);
      const before = await commandCount(s.actor);
      const r = await call(name, s.real(ids), s.actor, { key: null });
      expect(r.statusCode, `${name}: ${r.body}`).toBe(400);
      expect(r.json().code, name).toBe("validation_error");
      expect(await commandCount(s.actor), name).toBe(before);
      rejected += 1;
    }
    facts.missingKeyRejected = rejected;
  });

  it("with the ledger down (gateway on a dead port): 503 ledger_unavailable with a FAILED command, never a simulated success", async () => {
    const deadState = {
      ...h.state,
      participants: Object.fromEntries(Object.entries(h.state.participants).map(([source, p]) => [source, { ...p, jsonApiUrl: DEAD_LEDGER }])),
    };
    const deadAccess = new LedgerAccess({ state: deadState, secret: h.config.CANTON_JWT_HMAC_SECRET ?? DEV_HMAC_SECRET, submitTimeoutMs: 5_000, timeoutMs: 5_000 });
    deadApp = await buildApp({ config: h.config, db: h.db, storage: h.storage, ledger: new CantonLedgerGateway(deadAccess), ledgerAccess: deadAccess, oidc: null, logger: false });
    await deadApp.ready();
    const origin = new URL(h.config.PUBLIC_ORIGIN).origin;
    const ledgerBefore = await ledgerSnapshot();

    const outcomes: Record<string, string[]> = { unavailable503: [], refusedBeforeLedger: [] };
    for (const name of ID_ROUTES.filter((n) => isMutation(n) && !spec(n).application)) {
      const s = spec(name);
      const response = await deadApp.inject({
        method: API_ENDPOINTS[name].method,
        url: url(name, s.real(ids)),
        headers: { cookie: as(s.actor).cookieHeader(), "sec-fetch-site": "same-origin", origin, "idempotency-key": `adv-dead-${randomUUID()}` },
        payload: (s.body?.(ids) ?? {}) as object,
      });
      const body = response.json() as { status?: number; code?: string; detail?: string; command?: { state: string; simulated: boolean; message: string } };
      expect(response.statusCode, `${name}: ${response.body}`).not.toBeLessThan(400);
      expect(JSON.stringify(body)).not.toContain(COMMAND_COPY.COMMITTED);
      expect(body.command?.simulated ?? false, name).toBe(false);
      if (response.statusCode === 503) {
        expect(body.code, name).toBe("ledger_unavailable");
        expect(body.detail, name).toBe(COMMAND_COPY.LEDGER_UNAVAILABLE);
        if (body.command) expect(body.command.state, name).toBe("FAILED");
        outcomes.unavailable503!.push(body.command ? `${name}:FAILED` : `${name}:no-command`);
      } else {
        // A precondition answered from the projections before any ledger call (e.g. 409 for a decided proposal).
        expect([403, 404, 409], `${name}: ${response.body}`).toContain(response.statusCode);
        outcomes.refusedBeforeLedger!.push(`${name}:${response.statusCode}`);
      }
    }
    // The routes that reach the ledger in this state must report it unavailable.
    for (const name of ["releaseRequests.decide", "releaseRequests.requestInformation", "releaseRequests.withdraw", "accessGrants.revoke", "governance.confirm", "governance.cancel"] as EndpointName[]) {
      expect(outcomes.unavailable503!.some((o) => o.startsWith(`${name}:`)), name).toBe(true);
    }
    expect(await ledgerSnapshot()).toEqual(ledgerBefore);
    // Reads still answer from the projections while the ledger is down.
    const read = await deadApp.inject({ method: "GET", url: `/api/pledges/PL-001`, headers: { cookie: as("borrower").cookieHeader() } });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ lockState: { value: "ACTIVE" } });
    facts.ledgerDown = { unavailable503: outcomes.unavailable503, refusedBeforeLedger: outcomes.refusedBeforeLedger, ledgerUnchanged: true };
  });

  it("the same Idempotency-Key with a different payload → 409 (idempotency_conflict once a record exists)", async () => {
    const results: Record<string, string> = {};
    for (const name of ID_ROUTES.filter(isMutation)) {
      const s = spec(name);
      const key = `adv-conflict-${randomUUID()}`;
      const first = await call(name, s.real(ids), s.actor, { key });
      if (!s.otherBody) {
        // No payload to vary: the same key replays the stored outcome (same status, same command).
        const replay = await call(name, s.real(ids), s.actor, { key });
        expect(replay.statusCode, `${name}: ${replay.body}`).toBe(first.statusCode);
        const firstCommand = (first.json() as { command?: { commandId: string } }).command?.commandId;
        if (firstCommand) expect((replay.json() as { command?: { commandId: string } }).command?.commandId, name).toBe(firstCommand);
        results[name] = `replay ${replay.statusCode}`;
        continue;
      }
      const second = await call(name, s.real(ids), s.actor, { key, body: s.otherBody(ids) });
      expect(second.statusCode, `${name}: first ${first.statusCode} ${first.body} / second ${second.body}`).toBe(409);
      const recorded = (await commandCount(s.actor, key)) > 0;
      if (recorded) expect(second.json().code, `${name}: ${second.body}`).toBe("idempotency_conflict");
      results[name] = `${first.statusCode} → 409 ${second.json().code}`;
    }
    facts.idempotency = results;
    expect(Object.values(results).filter((r) => r.endsWith("idempotency_conflict")).length).toBeGreaterThan(0);
  });
});
