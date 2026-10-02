// Evidence upload pipeline (ADR-0001 §2.8):
//   POST /upload-intents   → version row UPLOAD_PENDING (owner or invited dealer of the asset)
//   PUT  /:id/content      → streamed bytes (20 MB cap, PDF/JPEG/PNG by magic bytes) → quarantine/ → QUARANTINED
//   POST /:id/finalize     → server re-reads + SHA-256 + checks → evidence/ → AVAILABLE (scan: NOT_SCANNED)
//   GET  /:id, /:id/download → owner or contributing organization (share-based access arrives with projections)
// Each mutation is an APPLICATION command (Idempotency-Key required); none claims a ledger confirmation.
import { randomUUID } from "node:crypto";
import { allocateRef, cases, evidenceDocuments, users, type CommandRow, type Db, type EvidenceDocumentRow } from "@collara/db";
import {
  commandResultSchema,
  DocumentRefSchema,
  ERROR_COPY,
  EVIDENCE_MAX_BYTES,
  EvidenceDocumentSchema,
  EvidenceDownloadSchema,
  IdempotencyKeySchema,
  UploadIntentRequestSchema,
  UploadIntentSchema,
  can,
  type EvidenceContentType,
  type PolicyContext,
  type UploadIntent,
} from "@collara/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems, type ProblemError } from "../errors";
import { assertPermitted, type ResolvedActor } from "../plugins/actor";
import { presentEvidenceRows } from "../presenters";
import { recordAudit } from "../services/audit";
import type { CommandService } from "../services/commands";
import { detectContentType, EVIDENCE_ERRORS, isAsyncIterable, readCapped } from "../services/evidence";
import type { ProjectionReader } from "../services/ledger";
import type { StorageService } from "../services/storage";

export const INTENT_TTL_MS = 15 * 60_000;
export const DOWNLOAD_URL_TTL_SECONDS = 60;
const UPLOAD_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "application/octet-stream"];

export interface EvidenceRoutesOptions {
  readonly db: Db;
  readonly storage: StorageService | null;
  readonly commands: CommandService;
  readonly projections: ProjectionReader;
  readonly clock: () => Date;
}

const IdempotencyHeaders = z.object({ "idempotency-key": IdempotencyKeySchema });
const DocParams = z.object({ id: DocumentRefSchema });

export const evidenceRoutes: FastifyPluginAsyncZod<EvidenceRoutesOptions> = async (app, { db, storage, commands, projections, clock }) => {
  // Raw bodies for PUT /:id/content are passed through as streams (scoped to this plugin only).
  app.addContentTypeParser(UPLOAD_CONTENT_TYPES, (_request, payload, done) => done(null, payload));

  function requireStorage(): StorageService {
    if (!storage) throw problems.serviceUnavailable(EVIDENCE_ERRORS.STORAGE_UNAVAILABLE);
    return storage;
  }

  async function versionsOf(docRef: string): Promise<EvidenceDocumentRow[]> {
    return db.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, docRef)).orderBy(asc(evidenceDocuments.version));
  }

  /** Owner (borrower) or the contributing organization; everyone else is unrelated (404). */
  function documentContext(row: EvidenceDocumentRow): PolicyContext {
    return { ownerOrgIds: [row.ownerOrgId], dealerOrgIds: row.contributorOrgId === row.ownerOrgId ? [] : [row.contributorOrgId] };
  }

  async function present(rows: EvidenceDocumentRow[], actor: ResolvedActor) {
    const uploaderIds = [...new Set(rows.map((r) => r.uploadedByUserId))];
    const names = new Map(
      (await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, uploaderIds))).map((u) => [u.id, u.name]),
    );
    const latest = rows.at(-1);
    const canDownload = !!latest && rows.some((r) => r.status === "AVAILABLE") && can(actor, "evidence.view", documentContext(latest));
    return presentEvidenceRows(rows, { uploaderName: (id) => names.get(id) ?? null, canDownload });
  }

  /** Latest version of a document the actor's organization contributed (uploads are per contributor). */
  async function contributedLatest(docRef: string, actor: ResolvedActor): Promise<EvidenceDocumentRow> {
    const latest = (await versionsOf(docRef)).at(-1);
    if (!latest || latest.contributorOrgId !== actor.orgId) throw problems.unavailable();
    return latest;
  }

  /** Re-throws the original validation outcome when a rejected command is replayed. */
  function replayedRejection(record: CommandRow): ProblemError {
    if (record.errorKind === "HASH_MISMATCH") return problems.stateConflict(record.errorMessage ?? undefined);
    if (record.errorKind === "TOO_LARGE") return problems.validation([{ path: "body", message: EVIDENCE_ERRORS.TOO_LARGE }], EVIDENCE_ERRORS.TOO_LARGE, 413);
    return problems.validation([{ path: "body", message: record.errorMessage ?? EVIDENCE_ERRORS.TYPE_MISMATCH }], record.errorMessage ?? undefined);
  }

  async function reject(row: EvidenceDocumentRow, record: CommandRow, kind: "VALIDATION" | "TOO_LARGE" | "HASH_MISMATCH", message: string) {
    await db
      .update(evidenceDocuments)
      .set({ status: kind === "HASH_MISMATCH" ? "HASH_MISMATCH" : "REJECTED", rejectionReason: message, updatedAt: clock() })
      .where(eq(evidenceDocuments.id, row.id));
    await commands.transition(record.id, "REJECTED", { error: { kind, message } });
  }

  // --- POST /upload-intents ------------------------------------------------------------------------

  app.post(
    "/upload-intents",
    {
      schema: {
        tags: ["evidence"],
        summary: "Authorize a private upload (new document or new version)",
        headers: IdempotencyHeaders,
        body: UploadIntentRequestSchema,
        response: { 200: commandResultSchema(UploadIntentSchema), 201: commandResultSchema(UploadIntentSchema) },
      },
    },
    async (request, reply) => {
      const actor = await request.requireActor();
      requireStorage();
      const body = request.body;

      // Asset relations from application records (cases) and, once projected, the registry.
      const caseRows = await db.select().from(cases).where(eq(cases.assetRef, body.assetRef));
      const scoped = body.caseId ? caseRows.filter((c) => c.caseRef === body.caseId) : caseRows;
      if (body.caseId && scoped.length === 0) throw problems.unavailable();
      const projectedOwner = await projections.assetOwnerOrgId(body.assetRef, actor.parties.readAs);
      const ownerOrgIds = [...new Set([...(projectedOwner ? [projectedOwner] : []), ...caseRows.map((c) => c.borrowerOrgId)])];
      const dealerOrgIds = [...new Set(scoped.flatMap((c) => (c.dealerOrgId ? [c.dealerOrgId] : [])))];
      assertPermitted(actor, "evidence.upload", { ownerOrgIds, dealerOrgIds });
      const ownerOrgId = ownerOrgIds[0];
      if (!ownerOrgId) throw problems.unavailable();

      const { record, created } = await commands.createOrGetCommand({
        actor,
        operation: "evidence.uploadIntent",
        idempotencyKey: request.headers["idempotency-key"],
        payload: body,
        target: "APPLICATION",
      });
      const respond = (row: CommandRow, intent: UploadIntent) => reply.code(created ? 201 : 200).send({ command: commands.toStatus(row), result: intent });
      if (record.status !== "PREPARED") return respond(record, UploadIntentSchema.parse(record.result));

      // Replay-safe: a version row created by this command before a crash is reused.
      const [existing] = await db.select().from(evidenceDocuments).where(eq(evidenceDocuments.intentCommandId, record.id)).limit(1);
      let previous: EvidenceDocumentRow | undefined;
      if (!existing && body.replacesDocumentId) {
        previous = (await versionsOf(body.replacesDocumentId)).at(-1);
        if (!previous || previous.assetRef !== body.assetRef || (previous.contributorOrgId !== actor.orgId && previous.ownerOrgId !== actor.orgId)) {
          throw problems.unavailable();
        }
        if (previous.status === "UPLOAD_PENDING" || previous.status === "QUARANTINED") throw problems.stateConflict(EVIDENCE_ERRORS.NOT_UPLOADED);
      }

      const now = clock();
      const row =
        existing ??
        (await db.transaction(async (tx) => {
          const docRef = previous?.docRef ?? (await allocateRef(tx, "document"));
          const [inserted] = await tx
            .insert(evidenceDocuments)
            .values({
              docRef,
              version: (previous?.version ?? 0) + 1,
              assetRef: body.assetRef,
              caseRef: body.caseId ?? previous?.caseRef ?? null,
              ownerOrgId,
              contributorOrgId: actor.orgId,
              uploadedByUserId: actor.userId,
              type: body.type,
              title: body.title,
              fileName: body.fileName,
              contentType: body.contentType,
              declaredSizeBytes: body.sizeBytes,
              intentExpiresAt: new Date(now.getTime() + INTENT_TTL_MS),
              intentCommandId: record.id,
            })
            .returning();
          if (!inserted) throw new Error("evidence version insert returned no row");
          return inserted;
        }));
      const intent: UploadIntent = {
        evidenceId: row.docRef,
        version: row.version,
        uploadPath: `/api/evidence/${row.docRef}/content`,
        maxBytes: EVIDENCE_MAX_BYTES,
        expiresAt: row.intentExpiresAt.toISOString(),
      };
      const committed = await commands.completeApplicationCommand(record, intent, row.docRef);
      await recordAudit(db, { actor, action: "evidence.upload_intent", resourceType: "evidence", resourceRef: row.docRef, outcome: "SUCCEEDED", requestId: request.id, detail: { version: row.version } }, request.log);
      return respond(committed, intent);
    },
  );

  // --- PUT /:id/content ----------------------------------------------------------------------------

  app.put(
    "/:id/content",
    {
      schema: {
        tags: ["evidence"],
        summary: "Upload the file bytes into quarantine (raw body: application/pdf, image/jpeg or image/png; max 20 MB)",
        headers: IdempotencyHeaders,
        params: DocParams,
        response: { 200: commandResultSchema(EvidenceDocumentSchema) },
      },
    },
    async (request, reply) => {
      const actor = await request.requireActor();
      const store = requireStorage();
      const row = await contributedLatest(request.params.id, actor);
      const { record } = await commands.createOrGetCommand({
        actor,
        operation: "evidence.uploadContent",
        idempotencyKey: request.headers["idempotency-key"],
        payload: { evidenceId: row.docRef, version: row.version },
        target: "APPLICATION",
        resourceRef: row.docRef,
      });
      if (record.status === "REJECTED") throw replayedRejection(record);
      if (record.status !== "PREPARED") return { command: commands.toStatus(record), result: await present(await versionsOf(row.docRef), actor) };

      if (row.status !== "UPLOAD_PENDING") throw problems.stateConflict(EVIDENCE_ERRORS.ALREADY_UPLOADED);
      if (row.intentExpiresAt.getTime() < clock().getTime()) throw problems.stateConflict(EVIDENCE_ERRORS.INTENT_EXPIRED);
      const declaredHeader = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
      if (declaredHeader && declaredHeader !== "application/octet-stream" && declaredHeader !== row.contentType) {
        throw problems.validation([{ path: "headers.content-type", message: EVIDENCE_ERRORS.HEADER_MISMATCH }], EVIDENCE_ERRORS.HEADER_MISMATCH);
      }
      if (!isAsyncIterable(request.body)) {
        throw problems.validation([{ path: "body", message: EVIDENCE_ERRORS.HEADER_MISMATCH }], EVIDENCE_ERRORS.HEADER_MISMATCH, 415);
      }

      const read = await readCapped(request.body, EVIDENCE_MAX_BYTES);
      if (!read.ok) {
        await reject(row, record, "TOO_LARGE", EVIDENCE_ERRORS.TOO_LARGE);
        reply.header("connection", "close");
        throw problems.validation([{ path: "body", message: EVIDENCE_ERRORS.TOO_LARGE }], EVIDENCE_ERRORS.TOO_LARGE, 413);
      }
      const failure = read.size === 0 ? EVIDENCE_ERRORS.EMPTY : detectContentType(read.bytes) !== row.contentType ? EVIDENCE_ERRORS.TYPE_MISMATCH : null;
      if (failure) {
        await reject(row, record, "VALIDATION", failure);
        throw problems.validation([{ path: "body", message: failure }], failure);
      }

      const key = `quarantine/${row.docRef}/v${row.version}/${randomUUID()}`;
      await store.putObject(key, read.bytes, row.contentType);
      const [updated] = await db
        .update(evidenceDocuments)
        .set({ status: "QUARANTINED", uploadSha256: read.sha256, sizeBytes: read.size, storageKey: key, uploadedAt: clock(), updatedAt: clock() })
        .where(and(eq(evidenceDocuments.id, row.id), eq(evidenceDocuments.status, "UPLOAD_PENDING")))
        .returning();
      if (!updated) {
        await store.deleteObject(key).catch(() => undefined);
        throw problems.stateConflict(EVIDENCE_ERRORS.ALREADY_UPLOADED);
      }
      const committed = await commands.completeApplicationCommand(record, { evidenceId: row.docRef, version: row.version });
      await recordAudit(db, { actor, action: "evidence.upload_content", resourceType: "evidence", resourceRef: row.docRef, outcome: "SUCCEEDED", requestId: request.id, detail: { version: row.version, sizeBytes: read.size } }, request.log);
      return { command: commands.toStatus(committed), result: await present(await versionsOf(row.docRef), actor) };
    },
  );

  // --- POST /:id/finalize --------------------------------------------------------------------------

  app.post(
    "/:id/finalize",
    {
      schema: {
        tags: ["evidence"],
        summary: "Server-side SHA-256 and validation; promotes the bytes from quarantine to evidence storage",
        headers: IdempotencyHeaders,
        params: DocParams,
        body: z.object({}).optional(),
        response: { 200: commandResultSchema(EvidenceDocumentSchema) },
      },
    },
    async (request) => {
      const actor = await request.requireActor();
      const store = requireStorage();
      const row = await contributedLatest(request.params.id, actor);
      const { record } = await commands.createOrGetCommand({
        actor,
        operation: "evidence.finalize",
        idempotencyKey: request.headers["idempotency-key"],
        payload: { evidenceId: row.docRef, version: row.version },
        target: "APPLICATION",
        resourceRef: row.docRef,
      });
      if (record.status === "REJECTED") throw replayedRejection(record);
      if (record.status !== "PREPARED") return { command: commands.toStatus(record), result: await present(await versionsOf(row.docRef), actor) };
      if (row.status !== "QUARANTINED" || !row.storageKey) throw problems.stateConflict(EVIDENCE_ERRORS.NOT_UPLOADED);

      // Hash what storage actually holds, independently of what was computed while receiving.
      const read = await readCapped(await store.getObject(row.storageKey), EVIDENCE_MAX_BYTES);
      if (!read.ok) {
        await reject(row, record, "TOO_LARGE", EVIDENCE_ERRORS.TOO_LARGE);
        throw problems.validation([{ path: "body", message: EVIDENCE_ERRORS.TOO_LARGE }], EVIDENCE_ERRORS.TOO_LARGE, 413);
      }
      if (read.sha256 !== row.uploadSha256 || read.size !== row.sizeBytes) {
        await reject(row, record, "HASH_MISMATCH", ERROR_COPY.HASH_MISMATCH);
        throw problems.stateConflict(ERROR_COPY.HASH_MISMATCH);
      }
      if (detectContentType(read.bytes) !== (row.contentType as EvidenceContentType)) {
        await reject(row, record, "VALIDATION", EVIDENCE_ERRORS.TYPE_MISMATCH);
        throw problems.validation([{ path: "body", message: EVIDENCE_ERRORS.TYPE_MISMATCH }], EVIDENCE_ERRORS.TYPE_MISMATCH);
      }

      const evidenceKey = `evidence/${row.docRef}/v${row.version}/${read.sha256}`;
      await store.putObject(evidenceKey, read.bytes, row.contentType);
      const now = clock();
      const [promoted] = await db
        .update(evidenceDocuments)
        .set({ status: "AVAILABLE", scanStatus: "NOT_SCANNED", sha256: read.sha256, sizeBytes: read.size, storageKey: evidenceKey, finalizedAt: now, updatedAt: now })
        .where(and(eq(evidenceDocuments.id, row.id), eq(evidenceDocuments.status, "QUARANTINED")))
        .returning();
      if (!promoted) throw problems.stateConflict(EVIDENCE_ERRORS.NOT_UPLOADED);
      await store.deleteObject(row.storageKey).catch((err: unknown) => request.log.warn({ err }, "quarantine object not deleted"));
      const committed = await commands.completeApplicationCommand(record, { evidenceId: row.docRef, version: row.version });
      await recordAudit(db, { actor, action: "evidence.finalize", resourceType: "evidence", resourceRef: row.docRef, outcome: "SUCCEEDED", requestId: request.id, detail: { version: row.version, sha256: read.sha256 } }, request.log);
      return { command: commands.toStatus(committed), result: await present(await versionsOf(row.docRef), actor) };
    },
  );

  // --- GET /:id, GET /:id/download -----------------------------------------------------------------

  async function authorizedVersions(docRef: string, actor: ResolvedActor, requestId: string): Promise<EvidenceDocumentRow[]> {
    const rows = await versionsOf(docRef);
    const latest = rows.at(-1);
    if (!latest || !can(actor, "evidence.view", documentContext(latest))) {
      if (latest) await recordAudit(db, { actor, action: "evidence.view", resourceType: "evidence", resourceRef: docRef, outcome: "DENIED", requestId });
      throw problems.unavailable();
    }
    return rows;
  }

  app.get(
    "/:id",
    {
      schema: { tags: ["evidence"], summary: "Evidence document metadata", params: DocParams, response: { 200: EvidenceDocumentSchema } },
    },
    async (request) => {
      const actor = await request.requireActor();
      return present(await authorizedVersions(request.params.id, actor, request.id), actor);
    },
  );

  app.get(
    "/:id/download",
    {
      schema: {
        tags: ["evidence"],
        summary: "Short-lived (60 s) download link, issued after a server-side access check",
        params: DocParams,
        querystring: z.object({ version: z.coerce.number().int().positive().optional() }),
        response: { 200: EvidenceDownloadSchema },
      },
    },
    async (request) => {
      const actor = await request.requireActor();
      const store = requireStorage();
      const rows = await authorizedVersions(request.params.id, actor, request.id);
      const available = rows.filter((r) => r.status === "AVAILABLE" && r.storageKey);
      const target = request.query.version ? available.find((r) => r.version === request.query.version) : available.at(-1);
      if (!target?.storageKey) throw problems.unavailable();
      const url = await store.presignGet(target.storageKey, {
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
        fileName: target.fileName,
        contentType: target.contentType,
      });
      await recordAudit(db, { actor, action: "evidence.download", resourceType: "evidence", resourceRef: target.docRef, outcome: "SUCCEEDED", requestId: request.id, detail: { version: target.version } }, request.log);
      return { url, expiresAt: new Date(clock().getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
    },
  );
};
