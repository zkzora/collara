// Case report generation (export_jobs QUEUED → GENERATING → READY | FAILED; leasing in ../registry.ts).
// A report contains only what the requester may see at generation time:
//   requester (session-independent: users → active membership in the job's organisation → mandates → party
//   bindings) → stakeholder-filtered read model (auditors: the grantor's view of the granted case only) →
//   domain presenters (buildCaseReport) → JSON or CSV.
// Access is re-checked here (report.export policy; an auditor's recorded audit scopes must still be granted) and
// again by the API at every download. The document carries the schema version, the cut-off (projection
// checkpoint offset + time), the per-source sync watermark, the mode banner as a watermark and the report label;
// the stored bytes' SHA-256 is recorded on the job. Bytes go to private object storage only.
import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ledgerCheckpoints, loadReadWorld, loadUserAuthority, type Db, type ExportJobRow, type ReadViewer } from "@collara/db";
import {
  AUDIT_SCOPES,
  buildCaseReport,
  checkCaseAction,
  CONFIRMATION_COPY,
  exportAuditScopes,
  MandateSchema,
  MODE_BANNERS,
  orgName,
  primaryRole,
  REPORT_SCHEMA_VERSION,
  RoleSchema,
  STATUS_COPY,
  verifierActiveLookup,
  type Actor,
  type AuditEvent,
  type AuditScope,
  type Mandate,
  type PresentContext,
  type Role,
  type RuntimeMode,
} from "@collara/domain";
import { z } from "zod";
import type { ExportJobHandler } from "../registry";

/** Where report bytes are stored (the API's StorageService satisfies it). */
export interface ExportStorage {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export interface ExportHandlerOptions {
  /** Storage for the bytes; default: S3 from COLLARA_S3_* (null → jobs fail, nothing is simulated). */
  readonly storage?: ExportStorage | null;
  /** Days a READY report stays downloadable (default 7, as in the UI_MOCK client). */
  readonly ttlDays?: number;
}

export interface RenderedReport {
  readonly format: "JSON" | "CSV";
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly checksumSha256: string;
  readonly cutoffOffset: number | null;
  readonly cutoffAt: string;
  readonly watermark: Record<string, unknown>;
  readonly auditScopes: AuditScope[] | null;
}

export type GenerationResult = { readonly ok: true; readonly report: RenderedReport } | { readonly ok: false; readonly reason: string };

interface JobScope {
  readonly auditScopes?: unknown;
  readonly scopeLabel?: unknown;
}

/** The requester's authority as of now (the same derivation as the API's actor resolution). */
async function requesterOf(db: Db, job: ExportJobRow): Promise<{ actor: Actor; viewer: ReadViewer } | null> {
  const authority = await loadUserAuthority(db, job.requestedByUserId, job.orgId);
  if (!authority?.org || authority.org.id !== job.orgId) return null;
  const roles: Role[] = authority.roles.flatMap((r) => {
    const parsed = RoleSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
  const mandates: Mandate[] = authority.mandates.flatMap((m) => {
    const parsed = MandateSchema.safeParse(m.code === "GOVERNANCE_SEAT" ? { code: m.code, label: m.label, seat: m.seat } : { code: m.code, label: m.label });
    return parsed.success ? [parsed.data] : [];
  });
  if (roles.length === 0) return null;
  const seat = mandates.find((m) => m.code === "GOVERNANCE_SEAT")?.seat ?? null;
  const business = authority.bindings.find((b) => b.kind === "business" && b.orgId === job.orgId)?.partyId ?? null;
  const seatParty = seat === null ? null : (authority.bindings.find((b) => b.kind === "governance-member" && b.orgId === job.orgId && b.governanceSeat === seat)?.partyId ?? null);
  const governance = seat === null ? null : (authority.bindings.find((b) => b.kind === "governance")?.partyId ?? null);
  const readableParties = [business, seatParty, governance].filter((p): p is string => p !== null);
  return {
    actor: { userId: job.requestedByUserId, orgId: job.orgId, roles, mandates },
    viewer: { orgId: job.orgId, readableParties, roles, mandates: mandates.map((m) => (m.code === "GOVERNANCE_SEAT" ? { code: m.code, seat: m.seat } : { code: m.code })) },
  };
}

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** CSV cell: quoted, with formula-like leading characters neutralised. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function eventsCsv(events: readonly AuditEvent[], preamble: readonly string[]): string {
  const header = "occurredAt,ref,event,actor,stateChange,version,kind,updateId,offset";
  const rows = events.map((e) =>
    [
      e.occurredAt,
      e.ref,
      e.label,
      e.actor,
      e.stateChange ? `${e.stateChange.from ?? "—"} → ${e.stateChange.to}` : "",
      e.version ?? "",
      e.kind.label,
      e.commit?.updateId ?? "",
      e.commit ? String(e.commit.offset) : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [...preamble.map((line) => `# ${line}`), header, ...rows].join("\n");
}

/**
 * Builds the report bytes for one job, or the reason it cannot be generated. Pure with respect to storage: it
 * reads the database (authority, projections, checkpoints) and returns the bytes and their metadata.
 */
export async function generateCaseReport(db: Db, job: ExportJobRow, options: { now: Date; mode: RuntimeMode }): Promise<GenerationResult> {
  const { now, mode } = options;
  const requester = await requesterOf(db, job);
  if (!requester) return { ok: false, reason: "The requester no longer has an active membership in the organization." };
  const { actor, viewer } = requester;
  const world = await loadReadWorld(db, viewer, { now });
  const facts = world.cases.find((c) => c.ref === job.caseRef);
  if (!facts) return { ok: false, reason: "The case is unavailable to the requester." };
  const pctx: PresentContext = {
    now,
    mode,
    sync: { offset: world.lastSync.offset, at: world.lastSync.at },
    ...(world.governance ? { isVerifierActive: verifierActiveLookup(world.governance) } : {}),
  };
  if (!checkCaseAction(facts, actor, "report.export", now, pctx).ok) return { ok: false, reason: "The requester may no longer export this case." };

  // Auditors: the scopes recorded at request time must all still be granted by every record owner.
  const scope = (job.scope ?? {}) as JobScope;
  const requested = Array.isArray(scope.auditScopes) ? scope.auditScopes.filter((s): s is AuditScope => (AUDIT_SCOPES as readonly unknown[]).includes(s)) : null;
  const current = exportAuditScopes(facts, actor, now, pctx);
  if (requested && !requested.every((s) => current?.includes(s))) return { ok: false, reason: "The audit grant changed since the report was requested." };

  const content = buildCaseReport(facts, world.cases, actor, pctx);
  if (!content) return { ok: false, reason: "The case is unavailable to the requester." };

  const sources = Object.fromEntries(
    (await ledgerCheckpoints(db)).map((s) => [s.source, { offset: s.lastAppliedAt ? s.checkpointOffset : null, at: s.lastAppliedAt?.toISOString() ?? null, status: s.status }]),
  );
  const cutoffOffset = world.lastSync.offset;
  const cutoffAt = world.lastSync.at ?? now.toISOString();
  const watermark = { offset: cutoffOffset, at: cutoffAt, sources };
  const scopeLabel = typeof scope.scopeLabel === "string" ? scope.scopeLabel : `Own scope · ${orgName(job.orgId)}`;
  const format = job.format === "CSV" ? "CSV" : "JSON";

  let text: string;
  if (format === "JSON") {
    const document = {
      ...content,
      schemaVersion: REPORT_SCHEMA_VERSION,
      reportRef: job.reportRef,
      caseId: job.caseRef,
      format,
      label: CONFIRMATION_COPY.REPORT_LABEL,
      watermark: MODE_BANNERS[mode],
      scopeNotice: STATUS_COPY.SCOPED_EXPORT,
      scope: { label: scopeLabel, auditScopes: current },
      requestedBy: { org: { id: job.orgId, name: orgName(job.orgId) }, role: primaryRole(actor) },
      generatedAt: now.toISOString(),
      cutoff: { offset: cutoffOffset, at: cutoffAt },
      sync: sources,
    };
    text = `${JSON.stringify(document, null, 2)}\n`;
  } else {
    const preamble = [
      CONFIRMATION_COPY.REPORT_LABEL,
      MODE_BANNERS[mode],
      STATUS_COPY.SCOPED_EXPORT,
      `schemaVersion=${REPORT_SCHEMA_VERSION}; report=${job.reportRef}; case=${job.caseRef}; scope=${scopeLabel}; cutoffOffset=${cutoffOffset ?? ""}; cutoffAt=${cutoffAt}; generatedAt=${now.toISOString()}`,
    ];
    text = `${eventsCsv(content.events ?? [], preamble)}\n`;
  }
  const body = new TextEncoder().encode(text);
  return {
    ok: true,
    report: {
      format,
      body,
      contentType: format === "CSV" ? "text/csv; charset=utf-8" : "application/json",
      checksumSha256: sha256Hex(body),
      cutoffOffset,
      cutoffAt,
      watermark,
      auditScopes: current,
    },
  };
}

// --- storage ---------------------------------------------------------------------------------------------

const S3EnvSchema = z.object({
  COLLARA_S3_ENDPOINT: z.url(),
  COLLARA_S3_ACCESS_KEY: z.string().min(1),
  COLLARA_S3_SECRET_KEY: z.string().min(1),
  COLLARA_S3_BUCKET: z.string().min(3).default("collara-evidence"),
  COLLARA_S3_REGION: z.string().min(1).default("us-east-1"),
});

/** Private S3-compatible storage from COLLARA_S3_* (same names and settings as the API), or null. */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): ExportStorage | null {
  const parsed = S3EnvSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== "")));
  if (!parsed.success) return null;
  const s3 = parsed.data;
  const client = new S3Client({
    endpoint: s3.COLLARA_S3_ENDPOINT,
    region: s3.COLLARA_S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: s3.COLLARA_S3_ACCESS_KEY, secretAccessKey: s3.COLLARA_S3_SECRET_KEY },
    // SeaweedFS (and other S3-compatibles) reject the SDK's default flexible checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    async putObject(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: s3.COLLARA_S3_BUCKET, Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
    },
  };
}

/** Storage key of a report (private bucket; never served without a presigned, access-checked link). */
export function reportStorageKey(job: Pick<ExportJobRow, "orgId" | "reportRef" | "format">): string {
  return `exports/${job.orgId}/${job.reportRef}.${job.format === "CSV" ? "csv" : "json"}`;
}

export function createExportJobHandler(options: ExportHandlerOptions = {}): ExportJobHandler {
  let storage: ExportStorage | null | undefined = options.storage;
  const ttlDays = options.ttlDays ?? 7;
  return async (job, ctx) => {
    if (storage === undefined) storage = storageFromEnv();
    if (!storage) return { state: "FAILED", errorMessage: "Report storage is not configured (COLLARA_S3_*)." };
    const now = ctx.now();
    const generated = await generateCaseReport(ctx.db, job, { now, mode: ctx.config.COLLARA_MODE });
    if (!generated.ok) {
      ctx.log.warn({ job: job.reportRef, reason: generated.reason }, "export not generated");
      return { state: "FAILED", errorMessage: generated.reason };
    }
    const { report } = generated;
    const storageKey = reportStorageKey(job);
    await storage.putObject(storageKey, report.body, report.contentType);
    ctx.log.info({ job: job.reportRef, bytes: report.body.byteLength, cutoffOffset: report.cutoffOffset }, "export generated");
    return {
      state: "READY",
      storageKey,
      checksumSha256: report.checksumSha256,
      sizeBytes: report.body.byteLength,
      cutoffOffset: report.cutoffOffset,
      watermark: report.watermark,
      expiresAt: new Date(now.getTime() + ttlDays * 86_400_000),
      generatedAt: now,
    };
  };
}

/** The handler the worker runs (JOB_HANDLERS.export): S3 storage from the environment. */
export const exportJobHandler: ExportJobHandler = createExportJobHandler();
