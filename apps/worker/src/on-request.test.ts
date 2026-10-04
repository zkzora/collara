import { createPgliteDatabase, importLocalnetState, ledgerSources, seedDemoIdentities, type DbHandle, type ProjectionLedgerClient } from "@collara/db";
import { buildScenario, scenarioBindingState, type FakeLedger, type ScenarioParties } from "@collara/db/testing";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { createOnRequestSync, type OnRequestSyncOptions } from "./on-request";

const config = loadConfig({ COLLARA_MODE: "LOCALNET", DATABASE_URL: "postgres://unused", WORKER_ID: "test-on-request", PROJECTION_PAGE_LIMIT: "3" });
const log = pino({ level: "silent" });
const noExports: OnRequestSyncOptions["exportHandler"] = async () => ({ state: "FAILED", errorMessage: "not used" });

describe("on-request sync (PGlite + in-memory ledger)", () => {
  let handle: DbHandle;
  let ledger: FakeLedger;
  let P: ScenarioParties;

  beforeEach(async () => {
    handle = await createPgliteDatabase();
    await seedDemoIdentities(handle.db);
    await importLocalnetState(handle.db, scenarioBindingState());
    ({ ledger, parties: P } = buildScenario("main"));
  });

  afterEach(async () => {
    await handle.close();
  });

  const sync = (client: ProjectionLedgerClient, overrides: Partial<OnRequestSyncOptions> = {}) =>
    createOnRequestSync({
      db: handle.db,
      ledger: { sources: [{ config: { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(P), ledgerUserId: "projector-svc" }, client }], completionClient: () => ledger },
      config,
      log,
      budgetMs: 10_000,
      minIntervalMs: 60_000,
      exportHandler: noExports,
      ...overrides,
    });

  const checkpoint = async () => (await handle.db.select().from(ledgerSources))[0]?.checkpointOffset ?? 0;

  it("projects to the ledger end inside the advisory-locked transaction, then skips while fresh", async () => {
    const s = sync(ledger);
    const first = await s.sync();
    expect(first.status).toBe("RAN");
    expect(first.partial).toBe(false);
    expect(await checkpoint()).toBe(await ledger.ledgerEnd());
    expect((await s.sync()).status).toBe("SKIPPED_FRESH");
    expect((await s.sync({ force: true })).status).toBe("RAN");
  });

  it("is single-flight: concurrent callers share one pass", async () => {
    let calls = 0;
    const counting: ProjectionLedgerClient = {
      participantId: () => ledger.participantId(),
      ledgerEnd: () => ledger.ledgerEnd(),
      latestPrunedOffset: () => ledger.latestPrunedOffset(),
      updates: (q) => {
        calls++;
        return ledger.updates(q);
      },
    };
    const s = sync(counting);
    const results = await Promise.all([s.sync({ force: true }), s.sync({ force: true }), s.sync({ force: true })]);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    const pagesForOnePass = calls;
    expect(pagesForOnePass).toBeGreaterThan(0);
    // A second instance holding the lock: this one skips without touching the ledger.
    const locked = sync(counting, { tryLock: async () => false });
    expect((await locked.sync({ force: true })).status).toBe("SKIPPED_LOCKED");
    expect(calls).toBe(pagesForOnePass);
  });

  it("takes the transaction-scoped advisory lock (pg_try_advisory_xact_lock) on PostgreSQL", async () => {
    let seen: boolean | null = null;
    const s = sync(ledger, {
      tryLock: async (tx) => {
        const result = await tx.execute(`select pg_try_advisory_xact_lock(hashtext('collara:on-request-sync')) as locked`);
        seen = ((result as unknown as { rows: { locked: boolean }[] }).rows[0]?.locked ?? null);
        return seen === true;
      },
    });
    expect((await s.sync({ force: true })).status).toBe("RAN");
    expect(seen).toBe(true);
  });

  it("stops at the time budget and commits the progress made so far", async () => {
    const slow: ProjectionLedgerClient = {
      participantId: () => ledger.participantId(),
      ledgerEnd: () => ledger.ledgerEnd(),
      latestPrunedOffset: () => ledger.latestPrunedOffset(),
      updates: async (q, o) => {
        // First page answers at once; later pages wait past the budget (aborted through the signal).
        if (q.beginExclusive > 0) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 5_000);
            o?.signal?.addEventListener("abort", () => (clearTimeout(timer), reject(o.signal?.reason)), { once: true });
          });
        }
        return ledger.updates(q);
      },
    };
    const started = Date.now();
    const result = await sync(slow, { budgetMs: 300 }).sync({ force: true });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.status).toBe("RAN");
    expect(result.partial).toBe(true);
    const reached = await checkpoint();
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(await ledger.ledgerEnd());
  });
});
