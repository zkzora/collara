// Migration 0003: one active case per asset and one case per case.create command, enforced by the database
// (the API decides first; these indexes are the backstop). PGlite with the committed migrations.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase, type DbHandle } from "./client";
import { cases } from "./schema";
import { seedDemoIdentities } from "./seed";

const base = {
  title: "Synthetic",
  borrowerOrgId: "demo-manufacturer",
  policyRef: "CP-2026-CNC-01",
  createdByUserId: "user-manufacturer-owner",
} as const;

/** The PostgreSQL error behind a (possibly Drizzle-wrapped) failure. */
async function pgError(promise: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  for (let e = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ("code" in e) return e as { code?: string; constraint?: string };
  }
  throw new Error(`expected a database error, got ${String(error)}`);
}

describe("cases: database invariants (migration 0003)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createPgliteDatabase();
    await seedDemoIdentities(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("creates the partial unique index on the asset for cases that are not cancelled, closed or superseded", async () => {
    const result = await handle.db.execute(sql`select indexdef from pg_indexes where tablename = 'cases' and indexname = 'cases_active_asset_key'`);
    const [row] = (result as unknown as { rows: { indexdef: string }[] }).rows;
    expect(row?.indexdef).toMatch(/UNIQUE INDEX cases_active_asset_key ON public\.cases USING btree \(asset_ref\) WHERE/);
    expect(row?.indexdef).toMatch(/cancelled_at IS NULL/);
    expect(row?.indexdef).toMatch(/closed_at IS NULL/);
    expect(row?.indexdef).toMatch(/superseded_at IS NULL/);
  });

  it("refuses a second active case for the same asset", async () => {
    await handle.db.insert(cases).values({ ...base, caseRef: "CL-801", assetRef: "ASSET-DEMO-801" });
    const error = await pgError(handle.db.insert(cases).values({ ...base, caseRef: "CL-802", assetRef: "ASSET-DEMO-801" }));
    expect(error).toMatchObject({ code: "23505", constraint: "cases_active_asset_key" });
  });

  it("admits a new active case beside cancelled, closed and superseded ones", async () => {
    const at = new Date();
    await handle.db.insert(cases).values([
      { ...base, caseRef: "CL-811", assetRef: "ASSET-DEMO-811", cancelledAt: at },
      { ...base, caseRef: "CL-812", assetRef: "ASSET-DEMO-811", closedAt: at },
      { ...base, caseRef: "CL-813", assetRef: "ASSET-DEMO-811", supersededAt: at },
      { ...base, caseRef: "CL-814", assetRef: "ASSET-DEMO-811" },
    ]);
    const error = await pgError(handle.db.insert(cases).values({ ...base, caseRef: "CL-815", assetRef: "ASSET-DEMO-811" }));
    expect(error.constraint).toBe("cases_active_asset_key");
  });

  it("links at most one case to a case.create command", async () => {
    const commandId = randomUUID();
    await handle.db.insert(cases).values({ ...base, caseRef: "CL-821", assetRef: "ASSET-DEMO-821", createCommandId: commandId });
    const error = await pgError(handle.db.insert(cases).values({ ...base, caseRef: "CL-822", assetRef: "ASSET-DEMO-822", createCommandId: commandId }));
    expect(error).toMatchObject({ code: "23505", constraint: "cases_create_command_key" });
    // Rows without a command (seeded or legacy) are unconstrained by that index.
    await handle.db.insert(cases).values([
      { ...base, caseRef: "CL-823", assetRef: "ASSET-DEMO-823" },
      { ...base, caseRef: "CL-824", assetRef: "ASSET-DEMO-824" },
    ]);
  });
});
