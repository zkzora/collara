import { createHash } from "node:crypto";
import { cases, createPgliteDatabase, exportJobs, importLocalnetState, projectOnce, seedDemoIdentities, type DbHandle } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties } from "@collara/db/testing";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../config";
import { runExportJobsOnce, type JobContext } from "../registry";
import { createExportJobHandler, type ExportStorage } from "./export";

const NOW = new Date();
const AUDITOR_SCOPES = ["EVIDENCE_MANIFEST", "ATTESTATION", "DECISION_OUTCOME"];
let handle: DbHandle;
const stored = new Map<string, { body: Uint8Array; contentType: string }>();
const storage: ExportStorage = {
  async putObject(key, body, contentType) {
    stored.set(key, { body: new Uint8Array(body), contentType });
  },
};

const job = (reportRef: string, user: string, orgId: string, format: "JSON" | "CSV", auditScopes: string[] | null) => ({
  reportRef,
  caseRef: "CL-001",
  requestedByUserId: user,
  orgId,
  format,
  scope: { auditScopes, requestedRole: auditScopes ? "AUDITOR" : "BORROWER", scopeLabel: auditScopes ? "Granted subset · Demo Auditor" : "Own scope · Demo Manufacturer" },
  schemaVersion: "collara.case-report/v1",
  requestedAt: new Date(NOW.getTime() - 60_000),
});

beforeAll(async () => {
  handle = await createPgliteDatabase();
  await seedDemoIdentities(handle.db);
  await importLocalnetState(handle.db, scenarioBindingState());
  const { ledger } = buildScenario("full");
  await projectOnce(handle.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(scenarioParties()) });
  await handle.db.insert(cases).values({
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
  });
  await handle.db.insert(exportJobs).values([
    job("RPT-0001", "user-auditor", "demo-auditor", "JSON", AUDITOR_SCOPES),
    job("RPT-0002", "user-auditor", "demo-auditor", "CSV", AUDITOR_SCOPES),
    job("RPT-0003", "user-manufacturer-owner", "demo-manufacturer", "JSON", null),
    // Lender B is unrelated to CL-001: nothing to export, never an empty "success".
    job("RPT-0004", "user-lender-b-approver", "demo-lender-b", "JSON", null),
    // Proposal terms were never granted by both record owners: the request no longer matches the grants.
    job("RPT-0005", "user-auditor", "demo-auditor", "JSON", [...AUDITOR_SCOPES, "PROPOSAL_TERMS"]),
  ]);
});

afterAll(async () => {
  await handle.close();
});

describe("export job handler (scenario 'full')", () => {
  it("generates scoped JSON and CSV reports with checksum, cut-off and watermark; refuses out-of-scope jobs", async () => {
    const config = loadConfig({ COLLARA_MODE: "LOCALNET", DATABASE_URL: "postgres://unused" });
    const ctx: JobContext = { db: handle.db, log: pino({ level: "silent" }), workerId: "test", config, signal: new AbortController().signal, now: () => NOW };
    const summary = await runExportJobsOnce(ctx, createExportJobHandler({ storage }));
    expect(summary).toEqual({ processed: 5, ready: 3, failed: 2 });

    const rows = new Map((await handle.db.select().from(exportJobs)).map((r) => [r.reportRef, r]));
    expect(rows.get("RPT-0004")).toMatchObject({ state: "FAILED", storageKey: null, checksumSha256: null });
    expect(rows.get("RPT-0005")).toMatchObject({ state: "FAILED", storageKey: null });

    for (const ref of ["RPT-0001", "RPT-0002", "RPT-0003"]) {
      const row = rows.get(ref);
      expect(row).toMatchObject({ state: "READY", schemaVersion: "collara.case-report/v1" });
      const object = stored.get(row?.storageKey ?? "");
      expect(object).toBeDefined();
      expect(createHash("sha256").update(object!.body).digest("hex")).toBe(row?.checksumSha256);
      expect(row?.sizeBytes).toBe(object!.body.byteLength);
      expect(row?.cutoffOffset).toBeGreaterThan(0);
      expect(row?.expiresAt?.getTime()).toBe(NOW.getTime() + 7 * 86_400_000);
    }

    const text = (ref: string) => new TextDecoder().decode(stored.get(rows.get(ref)?.storageKey ?? "")?.body);
    const auditorJson = JSON.parse(text("RPT-0001"));
    expect(auditorJson).toMatchObject({
      schemaVersion: "collara.case-report/v1",
      reportRef: "RPT-0001",
      caseId: "CL-001",
      label: "Case workflow report — not a legal title or lien certificate.",
      watermark: "Synthetic demo data — Canton LocalNet.",
      cutoff: { offset: rows.get("RPT-0001")?.cutoffOffset },
      scope: { auditScopes: AUDITOR_SCOPES },
      proposal: null,
      pledge: null,
    });
    expect(auditorJson.evidenceManifest.length).toBeGreaterThan(0);
    // No terms for the auditor (PROPOSAL_TERMS was not granted by both record owners).
    expect(text("RPT-0001")).not.toContain("100000");

    const borrowerJson = JSON.parse(text("RPT-0003"));
    expect(borrowerJson.proposal).toMatchObject({ ref: "FP-001", principal: { amount: "100000.00", currency: "USD" } });
    expect(borrowerJson.pledge).toMatchObject({ ref: "PL-001", state: "RELEASED" });

    const csv = text("RPT-0002").split("\n");
    expect(csv[0]).toBe("# Case workflow report — not a legal title or lien certificate.");
    expect(csv[1]).toBe("# Synthetic demo data — Canton LocalNet.");
    expect(csv).toContain("occurredAt,ref,event,actor,stateChange,version,kind,updateId,offset");
    expect(stored.get(rows.get("RPT-0002")?.storageKey ?? "")?.contentType).toBe("text/csv; charset=utf-8");

    const [lenderB] = await handle.db.select().from(exportJobs).where(eq(exportJobs.reportRef, "RPT-0004"));
    expect(lenderB?.errorMessage).toBe("The case is unavailable to the requester.");
  });
});
