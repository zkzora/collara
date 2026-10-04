// Evidence upload pipeline (ADR-0001 §2.8):
//   POST /upload-intents   → version row UPLOAD_PENDING (owner or invited dealer of the asset)
//   PUT  /:id/content      → streamed bytes (20 MB cap, PDF/JPEG/PNG by magic bytes) → quarantine/ → QUARANTINED
//   POST /:id/finalize     → server re-reads + SHA-256 + checks → evidence/ → AVAILABLE (scan: NOT_SCANNED)
//   STORAGE_UPLOAD_MODE=presigned: the intent also carries a short-lived presigned PUT URL for quarantine/; the browser
//   sends the bytes straight to storage (no API body limit) and finalize hashes and validates them as above.
//   GET  /:id, /:id/download → owner or contributing organization; package-share recipients through the read model
//                              (metadata) and a fresh ledger check of an active share at every download
// Each mutation is an APPLICATION command (Idempotency-Key required); none claims a ledger confirmation.
import { randomUUID } from "node:crypto";
import { allocateRef, cases, evidenceDocuments, users, type CommandRow, type Db, type DbOrTx, type EvidenceDocumentRow } from "@collara/db";
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
import type { FastifyBaseLogger } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { isProblemError, problems, type ProblemError } from "../errors";
import { assertPermitted, type ResolvedActor } from "../plugins/actor";
import { presentEvidenceRows } from "../presenters";
import { recordAudit } from "../services/audit";
import type { CommandService } from "../services/commands";
import { detectContentType, EVIDENCE_ERRORS, isAsyncIterable, readCapped } from "../services/evidence";
import type { ProjectionReader } from "../services/ledger";
import type { StorageService } from "../services/storage";
import { presentSharedEvidence, sharedDownloadVersion } from "../workflow/sharing/evidence-access";

export const INTENT_TTL_MS = 15 * 60_000;
export const DOWNLOAD_URL_TTL_SECONDS = 60;
/** Upper bound of a presigned upload URL's lifetime (also capped by the intent's expiry). */
export const DIRECT_UPLOAD_URL_TTL_SECONDS = 10 * 60;
const UPLOAD_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "application/octet-stream"];

export interface EvidenceRoutesOptions {
  readonly db: Db;
  readonly storage: StorageService | null;
  readonly commands: CommandService;
  readonly projections: ProjectionReader;
  readonly clock: () => Date;
  /** "presigned": upload intents carry a direct-to-storage PUT URL (default "proxied"). */
  readonly uploadMode?: "proxied" | "presigned";
}

/** Quarantine key of a direct (presigned) upload: one per version row, so finalize finds it without extra state. */
export function directUploadKey(row: Pick<EvidenceDocumentRow, "docRef" | "version" | "id">): string {
  return `quarantine/${row.docRef}/v${row.version}/direct-${row.id}`;
}

function isMissingObject(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404 || (typeof e?.message === "string" && e.message.endsWith("not found"));
}

const IdempotencyHeaders = z.object({ "idempotency-key": IdempotencyKeySchema });
const DocParams = z.object({ id: DocumentRefSchema });

export const evidenceRoutes: FastifyPluginAsyncZod<EvidenceRoutesOptions> = async (app, { db, storage, commands, projections, clock, uploadMode = "proxied" }) => {
  // Raw bodies for PUT /:id/content are passed through as streams (scoped to this plugin only).
  app.addContentTypeParser(UPLOAD_CONTENT_TYPES, (_request, payload, done) => done(null, payload));

  function requireStorage(): StorageService {
    if (!storage) throw problems.serviceUnavailable(EVIDENCE_ERRORS.STORAGE_UNAVAILABLE);
    return storage;
  }

  async function versionsOf(docRef: string, executor: DbOrTx = db): Promise<EvidenceDocumentRow[]> {
    return executor.select().from(evidenceDocuments).where(eq(evidenceDocuments.docRef, docRef)).orderBy(asc(evidenceDocuments.version));
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

  /**
   * Adds the presigned PUT URL (presigned mode, version still UPLOAD_PENDING). Never stored in the command result: a
   * replayed intent gets a fresh URL, valid at most until the intent expires.
   */
  async function withDirectUpload(intent: UploadIntent): Promise<UploadIntent> {
    if (uploadMode !== "presigned" || !storage) return intent;
    const [row] = await db
      .select()
      .from(evidenceDocuments)
      .where(and(eq(evidenceDocuments.docRef, intent.evidenceId), eq(evidenceDocuments.version, intent.version)))
      .limit(1);
    if (!row || row.status !== "UPLOAD_PENDING") return intent;
    const now = clock().getTime();
    const seconds = Math.min(DIRECT_UPLOAD_URL_TTL_SECONDS, Math.floor((row.intentExpiresAt.getTime() - now) / 1000));
    if (seconds < 1) return intent;
    const url = await storage.presignPut(directUploadKey(row), { expiresInSeconds: seconds, contentType: row.contentType });
    return { ...intent, directUpload: { url, method: "PUT", headers: { "content-type": row.contentType }, expiresAt: new Date(now + seconds * 1000).toISOString() } };
  }

  /** Re-throws the original validation outcome when a rejected command is replayed. */
  function replayedRejection(record: CommandRow): ProblemError {
    if (record.errorKind === "HASH_MISMATCH") return problems.stateConflict(record.errorMessage ?? undefined);
    if (record.errorKind === "TOO_LARGE") return problems.validation([{ path: "body", message: EVIDENCE_ERRORS.TOO_LARGE }], EVIDENCE_ERRORS.TOO_LARGE, 413);
    return problems.validation([{ path: "body", message: record.errorMessage ?? EVIDENCE_ERRORS.TYPE_MISMATCH }], record.errorMessage ?? undefined);
  }

  /**
   * Rejects the version (only from the state this request validated) and the command in one transaction, so a retry
   * replays the same refusal. A command another request with the same key settled meanwhile is left as it is.
   */
  async function reject(row: EvidenceDocumentRow, record: CommandRow, kind: "VALIDATION" | "TOO_LARGE" | "HASH_MISMATCH", message: string) {
    await commands.runApplicationCommand(record, async (tx) => {
      await tx
        .update(evidenceDocuments)
        .set({ status: kind === "HASH_MISMATCH" ? "HASH_MISMATCH" : "REJECTED", rejectionReason: message, updatedAt: clock() })
        .where(and(eq(evidenceDocuments.id, row.id), eq(evidenceDocuments.status, row.status)));
      return { kind: "reject", error: { kind, message } };
    });
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
      const respond = async (row: CommandRow, stored: UploadIntent) => {
        const intent = row.status === "COMMITTED" ? await withDirectUpload(stored) : stored;
        return reply.code(created ? 201 : 200).send({ command: commands.toStatus(row), result: intent });
      };
      if (record.status !== "PREPARED") return respond(record, UploadIntentSchema.parse(record.result));

      const now = clock();
      // The version row and the command's COMMITTED result commit together, with the command row locked: a retry or
      // a concurrent request with the same key gets the stored intent, never a second version.
      const outcome = await commands.runApplicationCommand(record, async (tx, locked) => {
        // A version row this command inserted before row and completion were atomic is reused.
        let [row] = await tx.select().from(evidenceDocuments).where(eq(evidenceDocuments.intentCommandId, locked.id)).limit(1);
        if (!row) {
          let previous: EvidenceDocumentRow | undefined;
          if (body.replacesDocumentId) {
            previous = (await versionsOf(body.replacesDocumentId, tx)).at(-1);
            if (!previous || previous.assetRef !== body.assetRef || (previous.contributorOrgId !== actor.orgId && previous.ownerOrgId !== actor.orgId)) {
              throw problems.unavailable();
            }
            if (previous.status === "UPLOAD_PENDING" || previous.status === "QUARANTINED") throw problems.stateConflict(EVIDENCE_ERRORS.NOT_UPLOADED);
          }
          const docRef = previous?.docRef ?? (await allocateRef(tx, "document"));
          [row] = await tx
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
              intentCommandId: locked.id,
            })
            .returning();
          if (!row) throw new Error("evidence version insert returned no row");
        }
        const intent: UploadIntent = {
          evidenceId: row.docRef,
          version: row.version,
          uploadPath: `/api/evidence/${row.docRef}/content`,
          maxBytes: EVIDENCE_MAX_BYTES,
          expiresAt: row.intentExpiresAt.toISOString(),
        };
        return { kind: "commit", result: intent, resourceRef: row.docRef };
      });
      const intent = UploadIntentSchema.parse(outcome.record.result);
      if (outcome.wrote) {
        await recordAudit(db, { actor, action: "evidence.upload_intent", resourceType: "evidence", resourceRef: intent.evidenceId, outcome: "SUCCEEDED", requestId: request.id, detail: { version: intent.version } }, request.log);
      }
      return respond(outcome.record, intent);
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
      // QUARANTINED and the command's COMMITTED result commit together (a retry never finds one without the other).
      const outcome = await commands
        .runApplicationCommand(record, async (tx) => {
          const [updated] = await tx
            .update(evidenceDocuments)
            .set({ status: "QUARANTINED", uploadSha256: read.sha256, sizeBytes: read.size, storageKey: key, uploadedAt: clock(), updatedAt: clock() })
            .where(and(eq(evidenceDocuments.id, row.id), eq(evidenceDocuments.status, "UPLOAD_PENDING")))
            .returning();
          if (!updated) throw problems.stateConflict(EVIDENCE_ERRORS.ALREADY_UPLOADED);
          return { kind: "commit", result: { evidenceId: row.docRef, version: row.version } };
        })
        .catch(async (error: unknown) => {
          // Refused (nothing recorded): the new object is not referenced. Other errors keep it (outcome not proven).
          if (isProblemError(error)) await store.deleteObject(key).catch(() => undefined);
          throw error;
        });
      if (outcome.wrote) {
        await recordAudit(db, { actor, action: "evidence.upload_content", resourceType: "evidence", resourceRef: row.docRef, outcome: "SUCCEEDED", requestId: request.id, detail: { version: row.version, sizeBytes: read.size } }, request.log);
      } else {
        // Settled meanwhile by a request with the same key: its bytes were recorded, not these.
        await store.deleteObject(key).catch(() => undefined);
        if (outcome.record.status === "REJECTED") throw replayedRejection(outcome.record);
      }
      return { command: commands.toStatus(outcome.record), result: await present(await versionsOf(row.docRef), actor) };
    },
  );

  /**
   * Presigned mode: the bytes were PUT straight to storage, so the API sees them for the first time here. Same checks
   * as the proxied path (20 MB cap, non-empty, magic bytes = declared type), SHA-256 of what storage holds, then
   * evidence/ and AVAILABLE in one command. A missing object is NOT_UPLOADED (retryable after the PUT).
   */
  async function finalizeDirect(store: StorageService, row: EvidenceDocumentRow, record: CommandRow, actor: ResolvedActor, request: { id: string; log: FastifyBaseLogger }): Promise<CommandRow> {
    const quarantineKey = directUploadKey(row);
    let body: AsyncIterable<Uint8Array>;
    try {
      body = await store.getObject(quarantineKey);
    } catch (error) {
      if (isMissingObject(error)) throw problems.stateConflict(EVIDENCE_ERRORS.NOT_UPLOADED);
      throw error;
    }
    const read = await readCapped(body, EVIDENCE_MAX_BYTES);
    const discard = () => store.deleteObject(quarantineKey).catch(() => undefined);
    if (!read.ok) {
      await reject(row, record, "TOO_LARGE", EVIDENCE_ERRORS.TOO_LARGE);
      await discard();
      throw problems.validation([{ path: "body", message: EVIDENCE_ERRORS.TOO_LARGE }], EVIDENCE_ERRORS.TOO_LARGE, 413);
    }
    const failure = read.size === 0 ? EVIDENCE_ERRORS.EMPTY : detectContentType(read.bytes) !== row.contentType ? EVIDENCE_ERRORS.TYPE_MISMATCH : null;
    if (failure) {
      await reject(row, record, "VALIDATION", failure);
      await discard();
      throw problems.validation([{ path: "body", message: failure }], failure);
    }
    const evidenceKey = `evidence/${row.docRef}/v${row.version}/${read.sha256}`;
    await store.putObject(evidenceKey, read.bytes, row.contentType);
    const now = clock();
    const outcome = await commands.runApplicationCommand(record, async (tx) => {
      const [promoted] = await tx
        .update(evidenceDocuments)
        .set({
          status: "AVAILABLE",
          scanStatus: "NOT_SCANNED",
          uploadSha256: read.sha256,
          sha256: read.sha256,
          sizeBytes: read.size,
          storageKey: evidenceKey,
          uploadedAt: now,
          finalizedAt: now,
          updatedAt: now,
        })
        .where(and(eq(evidenceDocuments.id, row.id), eq(evidenceDocuments.status, "UPLOAD_PENDING")))
        .returning();
      if (!promoted) throw problems.stateConflict(EVIDENCE_ERRORS.NOT_UPLOADED);
      return { kind: "commit", result: { evidenceId: row.docRef, version: row.version } };
    });
    if (outcome.wrote) {
      await discard();
      await recordAudit(db, { actor, action: "evidence.finalize", resourceType: "evidence", resourceRef: row.docRef, outcome: "SUCCEEDED", requestId: request.id, detail: { version: row.version, sha256: read.sha256, sizeBytes: read.size, upload: "presigned" } }, request.log);
    } else if (outcome.record.status === "REJECTED") {
      throw replayedRejection(outcome.record);
    }
    return outcome.record;
  }

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
      if (uploadMode === "presigned" && row.status === "UPLOAD_PENDING") {
        return { command: commands.toStatus(await finalizeDirect(store, row, record, actor, request)), result: await present(await versionsOf(row.docRef), actor) };
      }
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
      const quarantineKey = row.storageKey;
      // AVAILABLE and the command's COMMITTED result commit together (a retry never finds one without the other).
      const outcome = await commands.runApplicationCommand(record, async (tx) => {
        const [promoted] = await tx
          .update(evidenceDocuments)
          .set({ status: "AVAILABLE", scanStatus: "NOT_SCANNED", sha256: read.sha256, sizeBytes: read.size, storageKey: evidenceKey, finalizedAt: now, updatedAt: now })
          .where(and(eq(evidenceDocuments.id, row.id), eq(evidenceDocuments.status, "QUARANTINED")))
          .returning();
        if (!promoted) throw problems.stateConflict(EVIDENCE_ERRORS.NOT_UPLOADED);
        return { kind: "commit", result: { evidenceId: row.docRef, version: row.version } };
      });
      if (outcome.wrote) {
        await store.deleteObject(quarantineKey).catch((err: unknown) => request.log.warn({ err }, "quarantine object not deleted"));
        await recordAudit(db, { actor, action: "evidence.finalize", resourceType: "evidence", resourceRef: row.docRef, outcome: "SUCCEEDED", requestId: request.id, detail: { version: row.version, sha256: read.sha256 } }, request.log);
      } else if (outcome.record.status === "REJECTED") {
        throw replayedRejection(outcome.record);
      }
      return { command: commands.toStatus(outcome.record), result: await present(await versionsOf(row.docRef), actor) };
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
      const rows = await versionsOf(request.params.id);
      const latest = rows.at(-1);
      if (latest && can(actor, "evidence.view", documentContext(latest))) return present(rows, actor);
      // Package-share recipients and other related parties: the read model decides which documents and versions
      // they may see (workflow/sharing/evidence-access.ts). The evidence DTO does not depend on the runtime mode.
      const shared = latest ? await presentSharedEvidence(db, actor, request.params.id, "LOCALNET", clock()) : null;
      if (shared) return shared.doc;
      return authorizedVersions(request.params.id, actor, request.id).then((r) => present(r, actor));
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
      const docRef = request.params.id;
      const rows = await versionsOf(docRef);
      const latest = rows.at(-1);
      const available = rows.filter((r) => r.status === "AVAILABLE" && r.storageKey);
      let target: EvidenceDocumentRow | undefined;
      if (latest && !can(actor, "evidence.view", documentContext(latest))) {
        // Not the owner or contributor: an active, unexpired package share covering the exact version, re-checked
        // against the recipient's fresh ledger view at every download (daml-model.md §4.6).
        const decision = await sharedDownloadVersion({ db, workflow: app.workflow, member: actor, docRef, requested: request.query.version, mode: "LOCALNET", now: clock() });
        if ("problem" in decision) {
          await recordAudit(db, { actor, action: "evidence.download", resourceType: "evidence", resourceRef: docRef, outcome: "DENIED", requestId: request.id });
          throw decision.problem;
        }
        target = available.find((r) => r.version === decision.version);
      } else {
        await authorizedVersions(docRef, actor, request.id);
        target = request.query.version ? available.find((r) => r.version === request.query.version) : available.at(-1);
      }
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
