// POST /api/cases under real concurrency on PostgreSQL (opt-in): CASE_PG_IT_DATABASE_URL names a throw-away
// database (created, migrated, seeded, projected with the "full" scenario, and dropped afterwards unless
// KEEP_IT_DB=1), e.g. postgres://collara:collara_dev@127.0.0.1:5432/collara_case_atomic. Parallel requests with
// the same key and with different keys for one asset must produce exactly one case, and every successful response
// must name that case. Also: parallel report requests with one key queue one export job.
import { cases, commands, createPgDatabase, exportJobs, importLocalnetState, projectOnce, refCounters, seedDemoIdentities, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties } from "@collara/db/testing";
import { CASE_CREATE_COPY } from "@collara/domain";
import { eq, ne, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dropDatabase, ensureDatabase } from "../../seed/database";
import { idem, loginAs, testApp, type TestApp } from "../../test-support";

const URL_ENV = process.env.CASE_PG_IT_DATABASE_URL;
const NOW = new Date("2026-10-01T20:00:00Z");
const ASSET = "ASSET-DEMO-001";
const BODY = { title: "Used CNC financing", assetRef: ASSET, selectedLenderOrgId: "demo-lender-a", requestedPrincipal: { amount: "100000.00", currency: "USD" } } as const;
const N = 12;

describe.skipIf(!URL_ENV)("POST /api/cases concurrency on PostgreSQL", () => {
  const url = URL_ENV ?? "";
  let handle: DbHandle;
  let t: TestApp;
  let owner: string;
  const facts: Record<string, unknown> = {};

  const post = (key: string, payload: unknown = BODY) =>
    t.app.inject({ method: "POST", url: "/api/cases", headers: { cookie: owner, ...idem(key), "sec-fetch-site": "same-origin" }, payload: payload as object });
  const createdCases = () => handle.db.select({ caseRef: cases.caseRef }).from(cases).where(ne(cases.caseRef, "CL-001"));

  /** Fires the requests together and checks the outcome: one case, every success naming it. */
  async function fire(keys: readonly string[]) {
    const responses = await Promise.all(keys.map((key) => post(key)));
    const ok = responses.filter((r) => r.statusCode === 200 || r.statusCode === 201);
    const refused = responses.filter((r) => r.statusCode === 409);
    const other = responses.filter((r) => !ok.includes(r) && !refused.includes(r));
    expect(other.map((r) => `${r.statusCode} ${r.body}`)).toEqual([]);
    for (const r of refused) expect(r.json()).toMatchObject({ code: "state_conflict", detail: CASE_CREATE_COPY.ACTIVE_CASE });
    const caseIds = new Set(ok.map((r) => (r.json() as { result: { caseId: string } }).result.caseId));
    const rows = await createdCases();
    expect(rows).toHaveLength(1);
    expect([...caseIds]).toEqual([rows[0]?.caseRef]);
    expect(ok.filter((r) => r.statusCode === 201)).toHaveLength(1);
    return { ok: ok.length, refused: refused.length, caseId: rows[0]?.caseRef };
  }

  beforeAll(async () => {
    const name = new URL(url).pathname.slice(1);
    if (["collara", "collara_test", "postgres"].includes(name)) throw new Error(`refusing to use the shared database ${name}`);
    facts.created = await ensureDatabase(url);
    handle = createPgDatabase({ url, max: 20, applicationName: "collara-case-atomic-it" });
    await handle.migrate();
    await seedDemoIdentities(handle.db);
    await importLocalnetState(handle.db, scenarioBindingState());
    const { ledger } = buildScenario("full");
    await projectOnce(handle.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(scenarioParties()) });
    t = await testApp({ db: handle, clock: () => NOW });
    owner = await loginAs(t.app, "manufacturer-owner");
  });

  beforeEach(async () => {
    await handle.db.delete(cases);
    await handle.db.delete(commands).where(eq(commands.operation, "case.create"));
    await handle.db.insert(cases).values({
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
    });
    await handle.db.insert(refCounters).values({ kind: "case", value: 1 }).onConflictDoUpdate({ target: refCounters.kind, set: { value: 1 } });
  });

  afterAll(async () => {
    console.log(`case-create PG concurrency facts: ${JSON.stringify(facts)}`);
    await t?.close();
    await handle?.close();
    if (process.env.KEEP_IT_DB !== "1" && url) await dropDatabase(url);
  });

  it(`${N} parallel requests with the same key: one case, every response names it`, async () => {
    const outcome = await fire(Array.from({ length: N }, () => "pg-same-key"));
    expect(outcome.ok).toBe(N);
    const rows = await handle.db.select({ status: commands.status, result: commands.result }).from(commands).where(eq(commands.operation, "case.create"));
    expect(rows).toEqual([{ status: "COMMITTED", result: { caseId: outcome.caseId } }]);
    facts.sameKey = outcome;
  });

  it(`${N} parallel requests with different keys for one asset: one case, the others 409`, async () => {
    const outcome = await fire(Array.from({ length: N }, (_, i) => `pg-key-${i}`));
    expect(outcome).toMatchObject({ ok: 1, refused: N - 1 });
    facts.differentKeys = outcome;
  });

  it("mixed same and different keys, several rounds: always exactly one case", async () => {
    const rounds: unknown[] = [];
    for (let round = 0; round < 5; round++) {
      if (round > 0) {
        await handle.db.delete(cases).where(ne(cases.caseRef, "CL-001"));
        await handle.db.update(cases).set({ supersededAt: null });
        await handle.db.delete(commands).where(eq(commands.operation, "case.create"));
      }
      const keys = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? `pg-mixed-${round}` : `pg-mixed-${round}-${i}`));
      const outcome = await fire(keys);
      // Every request sharing a key gets the same answer: all succeed or all are refused.
      expect([N / 2, 1]).toContain(outcome.ok);
      rounds.push(outcome);
    }
    facts.mixed = rounds;
  });

  it(`${N} parallel report requests with one key queue one export job`, async () => {
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        t.app.inject({ method: "POST", url: "/api/reports", headers: { cookie: owner, ...idem("pg-report-key"), "sec-fetch-site": "same-origin" }, payload: { caseId: "CL-001", format: "JSON" } }),
      ),
    );
    const statuses = responses.map((r) => r.statusCode);
    facts.reports = { statuses: [...new Set(statuses)] };
    expect(statuses.every((s) => s === 200 || s === 201), responses.map((r) => r.body).join("\n")).toBe(true);
    const refs = new Set(responses.map((r) => (r.json() as { result: { ref: string } }).result.ref));
    expect(refs.size).toBe(1);
    const [command] = await handle.db.select().from(commands).where(eq(commands.operation, "report.create"));
    const jobs = await handle.db.select().from(exportJobs).where(sql`${exportJobs.scope}->>'commandId' = ${command?.id ?? ""}`);
    expect(jobs).toHaveLength(1);
  });
});
