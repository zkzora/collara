// Case reports (exports). Off-ledger by design (daml-model.md §4.9): POST /reports records an APPLICATION command
// and a QUEUED export_jobs row; the worker (apps/worker/src/jobs/handlers/export.ts) generates it from the
// requester's own visible facts (auditors: only the scopes every record owner granted), cut at the projection
// checkpoint, stores it privately and records the SHA-256 checksum. Access is checked at request, again at
// generation, and again at every download (grants revoked or expired since then block the link).
import { allocateRef, exportJobs, type ExportJobRow } from "@collara/db";
import {
  AUDIT_SCOPES,
  canDownloadReport,
  exportAuditScopes,
  orgName,
  paginate,
  presentReport,
  primaryRole,
  REPORT_SCHEMA_VERSION,
  ReportSchema,
  type Actor,
  type AuditScope,
  type CommandStatus,
  type CreateReportRequest,
  type ExportFacts,
  type ExportJobState,
  type Page,
  type PageQuery,
  type Report,
  type ReportFormat,
  type Role,
} from "@collara/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import { problems } from "../../errors";
import type { ResolvedActor } from "../../plugins/actor";
import { recordAudit } from "../../services/audit";
import { EVIDENCE_ERRORS } from "../../services/evidence";
import type { StorageService } from "../../services/storage";
import { findCase, guardCase, presentContextOf, readWorld, type FinanceDeps } from "../financing/common";

/** Short-lived download links, as for evidence. */
export const REPORT_URL_TTL_SECONDS = 60;
const EXPORT_STATES: readonly ExportJobState[] = ["QUEUED", "GENERATING", "READY", "EXPIRED", "FAILED"];

/** Scope label recorded on the job (same wording as the UI_MOCK client). */
export function exportScopeLabel(actor: Actor): string {
  const role = primaryRole(actor);
  if (role === "AUDITOR" || role === "DEALER") return `Granted subset · ${orgName(actor.orgId)}`;
  if (role === "VERIFIER") return `Assigned subset · ${orgName(actor.orgId)}`;
  return `Own scope · ${orgName(actor.orgId)}`;
}

interface JobScope {
  readonly commandId?: string;
  readonly auditScopes?: readonly string[] | null;
  readonly requestedRole?: string;
  readonly scopeLabel?: string;
}

/** export_jobs row → ExportFacts (the read model maps the same columns for case facts). */
export function exportFactsOf(row: ExportJobRow): ExportFacts {
  const scope = (row.scope ?? {}) as JobScope;
  const watermark = (row.watermark ?? {}) as { at?: unknown };
  const auditScopes = Array.isArray(scope.auditScopes) ? scope.auditScopes.filter((s): s is AuditScope => (AUDIT_SCOPES as readonly string[]).includes(s)) : null;
  return {
    ref: row.reportRef,
    caseRef: row.caseRef,
    format: (row.format === "CSV" ? "CSV" : "JSON") as ReportFormat,
    state: EXPORT_STATES.find((s) => s === row.state) ?? "QUEUED",
    requestedByOrgId: row.orgId,
    requestedByUserId: row.requestedByUserId,
    requestedRole: (scope.requestedRole ?? "BORROWER") as Role,
    requestedAt: row.requestedAt.toISOString(),
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    cutoff: { offset: row.cutoffOffset, at: typeof watermark.at === "string" ? watermark.at : (row.generatedAt ?? row.requestedAt).toISOString() },
    checksum: row.checksumSha256,
    scopeLabel: scope.scopeLabel ?? `Own scope · ${orgName(row.orgId)}`,
    schemaVersion: row.schemaVersion,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    auditScopes,
  };
}

// --- POST /reports ------------------------------------------------------------------------------------------

export async function createReport(
  deps: FinanceDeps,
  member: ResolvedActor,
  input: { readonly caseId: string; readonly format: ReportFormat },
  idempotencyKey: string,
  request: { readonly id: string; readonly log?: Parameters<typeof recordAudit>[2] },
): Promise<{ command: CommandStatus; result: Report; created: boolean }> {
  const operation = "report.create";
  const scope = await findCase(deps, member, (c) => c.ref === input.caseId);
  const service = deps.workflow.runner.commands;
  const { record, created } = await service.createOrGetCommand({
    actor: member,
    operation,
    idempotencyKey,
    payload: input satisfies CreateReportRequest,
    target: "APPLICATION",
    resourceRef: input.caseId,
  });
  if (record.status !== "PREPARED") {
    const stored = ReportSchema.safeParse(record.result);
    if (stored.success) return { command: service.toStatus(record), result: stored.data, created: false };
  }
  guardCase(scope, member, "report.export");

  // Replay-safe: a job inserted by this command before a crash is reused (scope.commandId).
  const [existing] = await deps.db
    .select()
    .from(exportJobs)
    .where(and(eq(exportJobs.orgId, member.orgId), sql`${exportJobs.scope}->>'commandId' = ${record.id}`))
    .limit(1);
  const row =
    existing ??
    (await deps.db.transaction(async (tx) => {
      const reportRef = await allocateRef(tx, "report");
      const [inserted] = await tx
        .insert(exportJobs)
        .values({
          reportRef,
          caseRef: input.caseId,
          requestedByUserId: member.userId,
          orgId: member.orgId,
          format: input.format,
          scope: {
            commandId: record.id,
            auditScopes: exportAuditScopes(scope.facts, member, scope.now, scope.pctx),
            requestedRole: primaryRole(member),
            scopeLabel: exportScopeLabel(member),
          },
          state: "QUEUED",
          schemaVersion: REPORT_SCHEMA_VERSION,
          requestedAt: scope.now,
        })
        .returning();
      if (!inserted) throw new Error("export job insert returned no row");
      return inserted;
    }));
  const report = presentReport(exportFactsOf(row), member, scope.pctx);
  if (!report) throw problems.unavailable();
  const committed = await service.completeApplicationCommand(record, report, row.reportRef);
  await recordAudit(deps.db, { actor: member, action: "report.request", resourceType: "report", resourceRef: row.reportRef, outcome: "SUCCEEDED", requestId: request.id, detail: { caseRef: input.caseId, format: input.format } }, request.log);
  return { command: service.toStatus(committed), result: report, created };
}

// --- GET /reports ------------------------------------------------------------------------------------------

/** The member's organisation's own report jobs (newest first). Downloads re-check access separately. */
export async function listReports(deps: FinanceDeps, member: ResolvedActor, query: PageQuery): Promise<Page<Report>> {
  const { world } = await readWorld(deps, member);
  const pctx = presentContextOf(world, deps.mode);
  const rows = await deps.db.select().from(exportJobs).where(eq(exportJobs.orgId, member.orgId)).orderBy(desc(exportJobs.requestedAt));
  const reports = rows.map((row) => presentReport(exportFactsOf(row), member, pctx)).filter((r): r is Report => r !== null);
  return paginate(reports, query);
}

// --- GET /reports/:id/download -------------------------------------------------------------------------------

export async function downloadReport(
  deps: FinanceDeps,
  storage: StorageService | null,
  member: ResolvedActor,
  reportRef: string,
  request: { readonly id: string; readonly log?: Parameters<typeof recordAudit>[2] },
): Promise<{ url: string; expiresAt: string }> {
  const [row] = await deps.db.select().from(exportJobs).where(and(eq(exportJobs.reportRef, reportRef), eq(exportJobs.orgId, member.orgId))).limit(1);
  if (!row) throw problems.unavailable();
  const { world, pctx, now } = await readWorld(deps, member);
  const facts = world.cases.find((c) => c.ref === row.caseRef);
  const allowed = !!facts && !!row.storageKey && canDownloadReport(facts, exportFactsOf(row), member, now, pctx);
  if (!allowed || !row.storageKey) {
    await recordAudit(deps.db, { actor: member, action: "report.download", resourceType: "report", resourceRef: reportRef, outcome: "DENIED", requestId: request.id }, request.log);
    throw problems.unavailable();
  }
  if (!storage) throw problems.serviceUnavailable(EVIDENCE_ERRORS.STORAGE_UNAVAILABLE);
  const format = row.format === "CSV" ? "CSV" : "JSON";
  const url = await storage.presignGet(row.storageKey, {
    expiresInSeconds: REPORT_URL_TTL_SECONDS,
    fileName: `${row.reportRef}-${row.caseRef}.${format === "CSV" ? "csv" : "json"}`,
    contentType: format === "CSV" ? "text/csv" : "application/json",
  });
  await recordAudit(deps.db, { actor: member, action: "report.download", resourceType: "report", resourceRef: reportRef, outcome: "SUCCEEDED", requestId: request.id }, request.log);
  return { url, expiresAt: new Date(deps.clock().getTime() + REPORT_URL_TTL_SECONDS * 1000).toISOString() };
}
