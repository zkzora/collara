// APPLICATION-only commands besides case creation (evidence intent/content/finalize, report requests, proposal
// drafts): the domain write and the command's completion commit in one transaction with the command row locked.
// Faults are injected into the running app's CommandService; PGlite with the production migrations.
import { cases, commands, exportJobs, evidenceDocuments, importLocalnetState, projectOnce, refCounters, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties } from "@collara/db/testing";
import { commandResultSchema, EvidenceDocumentSchema, ReportSchema, UploadIntentSchema } from "@collara/domain";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CommandService, IllegalCommandTransitionError } from "./services/commands";
import { unavailableLedgerGateway } from "./services/ledger";
import { idem, loginAs, seededDb, testApp, type TestApp } from "./test-support";

const NOW = new Date("2026-10-01T20:00:00Z");
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("synthetic evidence for ASSET-DEMO-001\n%%EOF\n")]);
const IntentResult = commandResultSchema(UploadIntentSchema);
const DocumentResult = commandResultSchema(EvidenceDocumentSchema);
const ReportResult = commandResultSchema(ReportSchema);
const CL001 = {
  caseRef: "CL-001",
  title: "Used CNC financing",
  assetRef: "ASSET-DEMO-001",
  borrowerOrgId: "demo-manufacturer",
  dealerOrgId: "demo-cnc-dealer",
  selectedLenderOrgId: "demo-lender-a",
  requestedPrincipal: "100000.00",
  requestedCurrency: "USD",
  policyRef: "CP-2026-CNC-01",
  createdByUserId: "user-manufacturer-owner",
} as const;

/** The next transition of `service` to `to` throws once: a crash before the command's transaction commits. */
function failTransitionOnce(service: CommandService, to: string) {
  const real = service.transition.bind(service);
  let armed = true;
  return vi.spyOn(service, "transition").mockImplementation(async (...args: Parameters<CommandService["transition"]>) => {
    if (armed && args[1] === to) {
      armed = false;
      throw new Error(`injected crash before the ${to} transition`);
    }
    return real(...args);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CommandService.runApplicationCommand", () => {
  let db: DbHandle;
  let service: CommandService;
  const actor = { userId: "user-lender-a-analyst", orgId: "demo-lender-a" };

  beforeAll(async () => {
    db = await seededDb();
    service = new CommandService(db.db, unavailableLedgerGateway, () => NOW);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("rolls the domain write back with a failed completion and leaves the command PREPARED", async () => {
    const { record } = await service.createOrGetCommand({ actor, operation: "t.app.rollback", idempotencyKey: "rollback-0001", payload: {}, target: "APPLICATION" });
    failTransitionOnce(service, "COMMITTED");
    const write = service.runApplicationCommand(record, async (tx) => {
      await tx.insert(refCounters).values({ kind: "t-rollback", value: 41 });
      return { kind: "commit", result: { ok: true } };
    });
    await expect(write).rejects.toThrow("injected crash");
    expect(await db.db.select().from(refCounters).where(eq(refCounters.kind, "t-rollback"))).toEqual([]);
    expect(await service.get(record.id)).toMatchObject({ status: "PREPARED", result: null });
  });

  it("completes a stale PREPARED record twice without an illegal transition; the first stored result wins", async () => {
    const { record } = await service.createOrGetCommand({ actor, operation: "proposal.draft", idempotencyKey: "stale-0001", payload: { caseId: "CL-001" }, target: "APPLICATION" });
    const [a, b] = await Promise.all([
      service.completeApplicationCommand(record, { proposalRef: "FP-001", version: 1 }, "CL-001"),
      service.completeApplicationCommand(record, { proposalRef: "FP-001", version: 2 }, "CL-001"),
    ]);
    expect(a.status).toBe("COMMITTED");
    expect(b.status).toBe("COMMITTED");
    expect(b.result).toEqual(a.result);
    // The guarded transition itself still refuses an out-of-order change.
    await expect(service.transition(record.id, "COMMITTED")).rejects.toBeInstanceOf(IllegalCommandTransitionError);
  });

  it("records a rejection together with its domain write", async () => {
    const { record } = await service.createOrGetCommand({ actor, operation: "t.app.reject", idempotencyKey: "reject-0001", payload: {}, target: "APPLICATION" });
    const outcome = await service.runApplicationCommand(record, async (tx) => {
      await tx.insert(refCounters).values({ kind: "t-reject", value: 1 });
      return { kind: "reject", error: { kind: "PRECONDITION", message: "refused" } };
    });
    expect(outcome).toMatchObject({ wrote: true, record: { status: "REJECTED", errorKind: "PRECONDITION" } });
    expect(await db.db.select().from(refCounters).where(eq(refCounters.kind, "t-reject"))).toHaveLength(1);
    const replay = await service.runApplicationCommand(record, () => Promise.reject(new Error("must not run")));
    expect(replay).toMatchObject({ wrote: false, record: { status: "REJECTED" } });
  });
});

describe("evidence commands: a crash before commit leaves nothing half-done; the retry completes", () => {
  let t: TestApp;
  let owner: string;
  let service: CommandService;

  beforeAll(async () => {
    t = await testApp();
    await t.db.db.insert(cases).values(CL001);
    owner = await loginAs(t.app, "manufacturer-owner");
    if (!t.app.services) throw new Error("the test app has no services");
    service = t.app.services.commands;
  });

  afterAll(async () => {
    await t?.close();
  });

  const intent = (key: string) =>
    t.app.inject({
      method: "POST",
      url: "/api/evidence/upload-intents",
      headers: { cookie: owner, ...idem(key) },
      payload: { assetRef: "ASSET-DEMO-001", caseId: "CL-001", type: "INSPECTION_REPORT", title: "Inspection report", fileName: "inspection.pdf", contentType: "application/pdf", sizeBytes: PDF.length },
    });
  const upload = (id: string, key: string) => t.app.inject({ method: "PUT", url: `/api/evidence/${id}/content`, headers: { cookie: owner, "content-type": "application/pdf", ...idem(key) }, payload: PDF });
  const finalize = (id: string, key: string) => t.app.inject({ method: "POST", url: `/api/evidence/${id}/finalize`, headers: { cookie: owner, ...idem(key) }, payload: {} });
  const versionsOf = (commandId: string) => t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.intentCommandId, commandId));
  const commandOf = async (key: string) => (await t.db.db.select().from(commands).where(eq(commands.idempotencyKey, key.padEnd(8, "0"))))[0];

  it("upload intent: no version row survives the crash; the retry creates exactly one", async () => {
    failTransitionOnce(service, "COMMITTED");
    expect((await intent("ev-intent-crash")).statusCode).toBe(500);
    const command = await commandOf("ev-intent-crash");
    expect(command?.status).toBe("PREPARED");
    expect(await versionsOf(command?.id ?? "")).toEqual([]);
    const retry = await intent("ev-intent-crash");
    expect(retry.statusCode, retry.body).toBe(200);
    const { result } = IntentResult.parse(retry.json());
    expect(await versionsOf(command?.id ?? "")).toHaveLength(1);
    expect(IntentResult.parse((await intent("ev-intent-crash")).json()).result.evidenceId).toBe(result.evidenceId);
  });

  it("concurrent intents with the same key store one version and answer the same evidence id", async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => intent("ev-intent-parallel")));
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 201]);
    const ids = new Set(responses.map((r) => IntentResult.parse(r.json()).result.evidenceId));
    expect(ids.size).toBe(1);
    const command = await commandOf("ev-intent-parallel");
    expect(await versionsOf(command?.id ?? "")).toHaveLength(1);
  });

  it("content and finalize: the retry after a crash answers the stored success, not a state conflict", async () => {
    const { evidenceId } = IntentResult.parse((await intent("ev-chain-intent")).json()).result;
    failTransitionOnce(service, "COMMITTED");
    expect((await upload(evidenceId, "ev-chain-content")).statusCode).toBe(500);
    const [pending] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, evidenceId));
    expect(pending?.status).toBe("UPLOAD_PENDING");
    const uploaded = await upload(evidenceId, "ev-chain-content");
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    expect(DocumentResult.parse(uploaded.json()).result.status.value).toBe("QUARANTINED");
    // The row points at the bytes of the committed attempt (the crashed attempt never became visible).
    const [stored] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, evidenceId));
    expect(stored?.storageKey && t.storage.objects.has(stored.storageKey)).toBe(true);

    vi.restoreAllMocks();
    failTransitionOnce(service, "COMMITTED");
    expect((await finalize(evidenceId, "ev-chain-final")).statusCode).toBe(500);
    const [quarantined] = await t.db.db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, evidenceId));
    expect(quarantined?.status).toBe("QUARANTINED");
    const done = await finalize(evidenceId, "ev-chain-final");
    expect(done.statusCode, done.body).toBe(200);
    expect(DocumentResult.parse(done.json()).result.status.value).toBe("AVAILABLE");
    expect((await finalize(evidenceId, "ev-chain-final")).statusCode).toBe(200);
    expect((await commandOf("ev-chain-final"))?.status).toBe("COMMITTED");
  });
});

describe("report requests: one export job per command", () => {
  let db: DbHandle;
  let t: TestApp;
  let service: CommandService;
  let borrower: string;

  beforeAll(async () => {
    db = await seededDb();
    await importLocalnetState(db.db, scenarioBindingState());
    const { ledger } = buildScenario("pledged");
    await projectOnce(db.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(scenarioParties()) });
    await db.db.insert(cases).values(CL001);
    t = await testApp({ db, clock: () => NOW });
    // Report requests run through the workflow runner's command service.
    if (!t.app.workflow) throw new Error("the test app has no workflow services");
    service = t.app.workflow.runner.commands;
    borrower = await loginAs(t.app, "manufacturer-owner");
  });

  afterAll(async () => {
    await t?.close();
    await db?.close();
  });

  const request = (key: string) =>
    t.app.inject({ method: "POST", url: "/api/reports", headers: { cookie: borrower, ...idem(key), "sec-fetch-site": "same-origin" }, payload: { caseId: "CL-001", format: "JSON" } });
  const jobsOf = async (key: string) => {
    const [command] = await db.db.select().from(commands).where(eq(commands.idempotencyKey, key.padEnd(8, "0")));
    if (!command) return [];
    return db.db.select().from(exportJobs).where(sql`${exportJobs.scope}->>'commandId' = ${command.id}`);
  };

  it("a crash before commit queues nothing; the retry queues exactly one job", async () => {
    failTransitionOnce(service, "COMMITTED");
    const first = await request("report-crash");
    expect(first.statusCode, first.body).toBe(500);
    expect(await jobsOf("report-crash")).toEqual([]);
    const retry = await request("report-crash");
    expect(retry.statusCode, retry.body).toBe(200);
    const { result } = ReportResult.parse(retry.json());
    expect((await jobsOf("report-crash")).map((j) => j.reportRef)).toEqual([result.ref]);
  });

  it("concurrent requests with the same key queue one job and answer the same report", async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => request("report-parallel")));
    for (const r of responses) expect([200, 201], r.body).toContain(r.statusCode);
    const refs = new Set(responses.map((r) => ReportResult.parse(r.json()).result.ref));
    expect(refs.size).toBe(1);
    expect(await jobsOf("report-parallel")).toHaveLength(1);
  });
});
