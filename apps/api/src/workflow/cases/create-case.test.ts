// POST /api/cases retry and idempotency semantics on PGlite with the production migrations, over the projected
// "full" scenario (CL-001: pledge released, so ASSET-DEMO-001 is free for a new case). Faults are injected into the
// real CommandService of the running app: a crash while the command is completed must persist nothing, a crash after
// the commit must replay the stored case, and no retry may ever create a second case.
import { cases, commands, importLocalnetState, projectOnce, refCounters, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties } from "@collara/db/testing";
import { CASE_CREATE_COPY, CaseDetailSchema, ERROR_COPY, type PersonaId } from "@collara/domain";
import { eq, ne } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandService } from "../../services/commands";
import { idem, loginAs, seededDb, testApp, type TestApp } from "../../test-support";
import { insertActiveCase } from "./create";

const NOW = new Date("2026-10-01T20:00:00Z");
const ASSET = "ASSET-DEMO-001";
const BODY = { title: "Used CNC financing", assetRef: ASSET, selectedLenderOrgId: "demo-lender-a", requestedPrincipal: { amount: "100000.00", currency: "USD" } } as const;
const CL001 = {
  caseRef: "CL-001",
  title: "Used CNC financing",
  assetRef: ASSET,
  borrowerOrgId: "demo-manufacturer",
  dealerOrgId: "demo-cnc-dealer",
  selectedLenderOrgId: "demo-lender-a",
  requestedPrincipal: "100000.00",
  requestedCurrency: "USD",
  policyRef: "CP-2026-CNC-01",
  createdByUserId: "user-manufacturer-owner",
} as const;

let db: DbHandle;
let t: TestApp;
let service: CommandService;
const cookies = new Map<PersonaId, string>();

async function cookieOf(persona: PersonaId) {
  let cookie = cookies.get(persona);
  if (!cookie) {
    cookie = await loginAs(t.app, persona);
    cookies.set(persona, cookie);
  }
  return cookie;
}

async function post(key: string, payload: unknown = BODY) {
  const cookie = await cookieOf("manufacturer-owner");
  return t.app.inject({ method: "POST", url: "/api/cases", headers: { cookie, ...idem(key), "sec-fetch-site": "same-origin" }, payload: payload as object });
}

/** Case rows created through the API (CL-001 is the scenario's released case). */
async function createdCases() {
  return db.db.select({ caseRef: cases.caseRef, title: cases.title }).from(cases).where(ne(cases.caseRef, "CL-001")).orderBy(cases.caseRef);
}

async function caseCommands() {
  return db.db.select({ id: commands.id, status: commands.status, result: commands.result, key: commands.idempotencyKey }).from(commands).where(eq(commands.operation, "case.create")).orderBy(commands.idempotencyKey);
}

/** The next transition to `to` throws once (a crash at that point); later calls run the real method. */
function failTransitionOnce(to: string) {
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

/** The next response serialisation throws once: a crash after the transaction committed, before the reply. */
function failReplyOnce() {
  const real = service.toStatus.bind(service);
  let armed = true;
  return vi.spyOn(service, "toStatus").mockImplementation((...args: Parameters<CommandService["toStatus"]>) => {
    if (armed) {
      armed = false;
      throw new Error("injected crash after commit");
    }
    return real(...args);
  });
}

beforeAll(async () => {
  db = await seededDb();
  await importLocalnetState(db.db, scenarioBindingState());
  const { ledger } = buildScenario("full");
  await projectOnce(db.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(scenarioParties()) });
  t = await testApp({ db, clock: () => NOW });
  if (!t.app.services) throw new Error("the test app has no services");
  service = t.app.services.commands;
});

beforeEach(async () => {
  // CL-001 is the scenario's case (released on the ledger); new cases are allocated from CL-002.
  await db.db.delete(cases);
  await db.db.delete(commands).where(eq(commands.operation, "case.create"));
  await db.db.insert(cases).values(CL001);
  await db.db.insert(refCounters).values({ kind: "case", value: 1 }).onConflictDoUpdate({ target: refCounters.kind, set: { value: 1 } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await t?.close();
  await db?.close();
});

describe("POST /api/cases: retries never create a second case", () => {
  it("a crash before the transaction commits persists nothing; the retry creates exactly one case", async () => {
    // The reviewer's interleaving: the failure hits while the command moves PREPARED → COMMITTED.
    const fault = failTransitionOnce("COMMITTED");
    const first = await post("retry-crash-before-commit");
    expect(fault).toHaveBeenCalled();
    expect(first.statusCode, first.body).toBe(500);
    expect(first.json()).toMatchObject({ code: "internal_error" });
    // The case insert rolled back with the completion; the command is still PREPARED without a result.
    expect(await createdCases()).toEqual([]);
    expect(await caseCommands()).toEqual([expect.objectContaining({ status: "PREPARED", result: null })]);

    const retry = await post("retry-crash-before-commit");
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.json()).toMatchObject({ command: { operation: "case.create", target: "APPLICATION", state: "COMMITTED", simulated: false }, result: { caseId: "CL-002" } });
    expect(retry.json().command.updateId).toBeUndefined();
    expect(await createdCases()).toEqual([{ caseRef: "CL-002", title: BODY.title }]);
    expect(await caseCommands()).toEqual([expect.objectContaining({ status: "COMMITTED", result: { caseId: "CL-002" } })]);

    const replay = await post("retry-crash-before-commit");
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ result: { caseId: "CL-002" } });
    expect(await createdCases()).toHaveLength(1);
  });

  it("a crash after the commit, before the response: the retry returns the same caseId and creates nothing", async () => {
    failReplyOnce();
    const first = await post("retry-crash-after-commit");
    expect(first.statusCode, first.body).toBe(500);
    // Case and command result committed together.
    expect(await createdCases()).toEqual([{ caseRef: "CL-002", title: BODY.title }]);
    expect(await caseCommands()).toEqual([expect.objectContaining({ status: "COMMITTED", result: { caseId: "CL-002" } })]);

    const retry = await post("retry-crash-after-commit");
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toMatchObject({ command: { state: "COMMITTED" }, result: { caseId: "CL-002" } });
    expect(await createdCases()).toHaveLength(1);
  });

  it("the same key with a different payload is a 409 idempotency conflict (after success and after a crash)", async () => {
    expect((await post("same-key-other-body")).statusCode).toBe(201);
    const conflict = await post("same-key-other-body", { ...BODY, title: "Another title" });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "idempotency_conflict", detail: ERROR_COPY.IDEMPOTENCY_CONFLICT });

    await db.db.delete(cases).where(ne(cases.caseRef, "CL-001"));
    await db.db.update(cases).set({ supersededAt: null });
    failTransitionOnce("COMMITTED");
    expect((await post("crashed-key-other-body")).statusCode).toBe(500);
    const afterCrash = await post("crashed-key-other-body", { ...BODY, selectedLenderOrgId: "demo-lender-b" });
    expect(afterCrash.statusCode).toBe(409);
    expect(afterCrash.json()).toMatchObject({ code: "idempotency_conflict" });
    expect(await createdCases()).toEqual([]);
  });

  it("two different keys for the same asset: the second is 409 with the approved copy", async () => {
    const first = await post("asset-key-one");
    expect(first.statusCode, first.body).toBe(201);
    const second = await post("asset-key-two", { ...BODY, title: "Second case" });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "state_conflict", detail: CASE_CREATE_COPY.ACTIVE_CASE });
    expect(await createdCases()).toEqual([{ caseRef: "CL-002", title: BODY.title }]);
  });

  it("a crashed request retried after another key took the asset is refused, and stays refused", async () => {
    failTransitionOnce("COMMITTED");
    expect((await post("crashed-then-late")).statusCode).toBe(500);
    expect((await post("winner-key", { ...BODY, title: "Winner" })).statusCode).toBe(201);
    for (let i = 0; i < 2; i++) {
      const late = await post("crashed-then-late");
      expect(late.statusCode).toBe(409);
      expect(late.json()).toMatchObject({ code: "state_conflict", detail: CASE_CREATE_COPY.ACTIVE_CASE });
    }
    expect(await createdCases()).toEqual([{ caseRef: "CL-002", title: "Winner" }]);
    expect(await caseCommands()).toEqual([
      expect.objectContaining({ key: expect.stringMatching(/^crashed-then-late/), status: "REJECTED", result: null }),
      expect.objectContaining({ key: expect.stringMatching(/^winner-key/), status: "COMMITTED", result: { caseId: "CL-002" } }),
    ]);
  });

  it("a PREPARED command whose case is already linked completes with that case instead of creating another", async () => {
    // A case inserted for the command but never completed (rows written before creation and completion were atomic).
    failTransitionOnce("COMMITTED");
    expect((await post("linked-key")).statusCode).toBe(500);
    const [record] = await caseCommands();
    if (!record) throw new Error("no command recorded");
    await db.db.update(cases).set({ supersededAt: NOW }).where(eq(cases.caseRef, "CL-001"));
    await db.db.insert(cases).values({ ...CL001, caseRef: "CL-007", createCommandId: record.id });
    const retry = await post("linked-key");
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toMatchObject({ command: { commandId: record.id, state: "COMMITTED" }, result: { caseId: "CL-007" } });
    expect(await createdCases()).toEqual([{ caseRef: "CL-007", title: CL001.title }]);
    expect(await caseCommands()).toEqual([expect.objectContaining({ status: "COMMITTED", result: { caseId: "CL-007" } })]);
  });

  it("marks the released case superseded without changing its displayed stage", async () => {
    const cookie = await cookieOf("manufacturer-owner");
    const detail = async () => CaseDetailSchema.parse((await t.app.inject({ method: "GET", url: "/api/cases/CL-001", headers: { cookie } })).json());
    const before = await detail();
    expect((await post("supersede-key")).statusCode).toBe(201);
    const rows = await db.db.select({ caseRef: cases.caseRef, supersededAt: cases.supersededAt }).from(cases).orderBy(cases.caseRef);
    expect(rows).toEqual([
      { caseRef: "CL-001", supersededAt: NOW },
      { caseRef: "CL-002", supersededAt: null },
    ]);
    expect((await detail()).stage).toEqual(before.stage);
  });
});

describe("one active case per asset in the database", () => {
  it("maps the partial unique index to a refusal inside a savepoint: nothing kept, the transaction stays usable", async () => {
    const values = { ...CL001, title: "Bypassing writer" } as const;
    const { caseRef: _ref, ...rest } = values;
    const outcome = await db.db.transaction(async (tx) => {
      const refused = await insertActiveCase(tx, rest, [], NOW);
      // The outer transaction continues after the savepoint rollback.
      const [counter] = await tx.select({ value: refCounters.value }).from(refCounters).where(eq(refCounters.kind, "case"));
      return { refused, counter: counter?.value };
    });
    expect(outcome).toEqual({ refused: null, counter: 1 });
    expect(await createdCases()).toEqual([]);
    // Once CL-001 no longer holds the asset, the same insert passes.
    const created = await db.db.transaction((tx) => insertActiveCase(tx, rest, ["CL-001"], NOW));
    expect(created).toBe("CL-002");
  });
});
