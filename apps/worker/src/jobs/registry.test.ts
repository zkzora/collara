import { createPgliteDatabase, exportJobs, seedDemoIdentities, type DbHandle } from "@collara/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimExportJob, finishExportJob } from "./registry";

describe("export job leasing", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createPgliteDatabase();
    await seedDemoIdentities(handle.db);
    // Same requested_at for all three (one statement): ties must still be claimed one at a time.
    await handle.db.insert(exportJobs).values(
      ["RPT-0001", "RPT-0002", "RPT-0003"].map((reportRef) => ({
        reportRef,
        caseRef: "CL-001",
        requestedByUserId: "user-manufacturer-owner",
        orgId: "demo-manufacturer",
        scope: {},
        schemaVersion: "collara.case-report/v1",
      })),
    );
  });

  afterAll(async () => {
    await handle.close();
  });

  it("claims exactly one job per call, re-claims an expired lease and fails a job out of attempts", async () => {
    const now = new Date();
    const options = { workerId: "w1", leaseSeconds: 60, maxAttempts: 2, now };
    const first = await claimExportJob(handle.db, options);
    const states = async () => (await handle.db.select().from(exportJobs)).map((j) => j.state).sort();
    expect(await states()).toEqual(["GENERATING", "QUEUED", "QUEUED"]);
    const second = await claimExportJob(handle.db, { ...options, workerId: "w2" });
    const third = await claimExportJob(handle.db, options);
    expect(new Set([first?.reportRef, second?.reportRef, third?.reportRef]).size).toBe(3);
    expect(await claimExportJob(handle.db, options)).toBeNull();

    // A lease that expired (crashed worker) is claimed again; the old holder can no longer record an outcome.
    if (!first) throw new Error("no job claimed");
    const later = new Date(now.getTime() + 61_000);
    const reclaimed = await claimExportJob(handle.db, { ...options, workerId: "w3", now: later });
    expect(reclaimed?.leaseOwner).toBe("w3");
    expect(reclaimed?.attempts).toBe(2);
    expect(await finishExportJob(handle.db, first, "w1", { state: "FAILED", errorMessage: "late" }, later)).toBe(false);

    // Out of attempts under an expired lease → FAILED instead of looping.
    const muchLater = new Date(now.getTime() + 200_000);
    expect(await claimExportJob(handle.db, { ...options, workerId: "w4", now: muchLater })).toMatchObject({ attempts: 2 });
    const [failed] = await handle.db.select().from(exportJobs).where(eq(exportJobs.reportRef, reclaimed?.reportRef ?? ""));
    expect(failed).toMatchObject({ state: "FAILED", errorMessage: "Export generation failed after 2 attempts" });
  });
});
