// Cases: GET|POST /cases, GET /cases/:id, GET /cases/:id/evidence, POST /cases/:id/sharing,
// POST /cases/:id/verification-requests (API_ENDPOINTS "cases.*"). The lender-side case routes
// (/assessments, /proposals, /pledge-activation) belong to the review/financing modules.
// Reads: projections → read model (stakeholder-filtered) → domain presenters. Unrelated or unknown → 404-shaped.
// Writes: policy + preconditions on the viewer's facts, then the ledger runner (fresh ACS reads in prepare).
// Case creation is an application record (cases table); it never claims a ledger confirmation.
import { allocateRef, cases as casesTable } from "@collara/db";
import {
  caseContext,
  CaseDetailSchema,
  CaseListQuerySchema,
  CaseListSchema,
  CaseRefSchema,
  checkCaseAction,
  commandResultSchema,
  CreateCaseRequestSchema,
  CreateVerificationRequestSchema,
  CREDIT_POLICY_REF,
  DEMO_ORGANIZATIONS,
  EvidenceDocumentSchema,
  can,
  hasMandate,
  isRelated,
  paginate,
  presentAssetSummary,
  presentCaseDetail,
  presentCaseEvidence,
  presentCaseList,
  presentCaseSummary,
  ShareCaseRequestSchema,
} from "@collara/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { problems } from "../../errors";
import { recordAudit } from "../../services/audit";
import {
  businessPartyOfOrg,
  IdempotencyHeadersSchema,
  replyWithOutcome,
  workflowProblems,
  workflowResponseSchemas,
} from "../../workflow";
import { assertCheck, commandExists, findAsset, findCase, loadViewerWorld } from "../../workflow/cases/read";
import { dealerConsent, DEFAULT_SHARE_DAYS, ensureLenderAssessment, shareWithLender } from "../../workflow/sharing";
import { requestVerification } from "../../workflow/verification/request";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

const CaseParams = z.object({ id: CaseRefSchema });
/** INFERRED copy, same strings as the UI_MOCK client. */
const ACTIVE_CASE = "This asset already has an active case workflow.";
const DAY = 86_400_000;

export const caseRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, { services, workflow, mode }) => {
  const db = services.db.db;
  const now = services.clock;

  app.get(
    "/cases",
    { schema: { tags: ["cases"], summary: "Cases visible to the signed-in organisation", querystring: CaseListQuerySchema, response: { 200: CaseListSchema } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const { items, counts } = presentCaseList(world.cases, member, pctx, request.query.view ?? "all");
      return { ...paginate(items, request.query), counts };
    },
  );

  app.get(
    "/cases/:id",
    { schema: { tags: ["cases"], summary: "Case detail (fields omitted by role and mandate)", params: CaseParams, response: { 200: CaseDetailSchema } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const facts = findCase(world, request.params.id);
      const detail = facts ? presentCaseDetail(facts, member, pctx) : null;
      if (!facts || !detail) throw problems.unavailable();
      // M18 trigger: the selected lender's first open of a shared case creates its CollateralAssessment under the
      // lender's own authority (workflow/sharing/assessment.ts). A failure never blocks the read.
      if (facts.review.ref === "" && facts.review.state === "SUBMITTED" && facts.selectedLenderOrgId === member.orgId) {
        await ensureLenderAssessment({ db, workflow, member, caseRef: facts.ref, facts, now: pctx.now }).catch((err: unknown) =>
          request.log.warn({ err, caseRef: facts.ref }, "lender review could not be opened on the ledger"),
        );
      }
      return detail;
    },
  );

  app.get(
    "/cases/:id/evidence",
    { schema: { tags: ["cases"], summary: "Evidence documents of the case asset visible to the viewer", params: CaseParams, response: { 200: z.array(EvidenceDocumentSchema) } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const facts = findCase(world, request.params.id);
      const documents = facts ? presentCaseEvidence(facts, world.cases, member, pctx) : null;
      if (!documents) throw problems.unavailable();
      return documents;
    },
  );

  // --- POST /cases (application record) -------------------------------------------------------------

  const CaseCreated = z.object({ caseId: CaseRefSchema });
  app.post(
    "/cases",
    {
      schema: {
        tags: ["cases"],
        summary: "Create a case for a registered asset (application record; no ledger transaction)",
        headers: IdempotencyHeadersSchema,
        body: CreateCaseRequestSchema,
        response: { 200: commandResultSchema(CaseCreated), 201: commandResultSchema(CaseCreated) },
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const input = request.body;
      const key = request.headers["idempotency-key"];
      const replay = await commandExists(db, member, "case.create", key);
      // Cases of this asset that no longer block a new one (released pledge or rejected review).
      const finished = new Set<string>();
      if (!replay) {
        const { world, pctx } = await loadViewerWorld(db, member, mode, now());
        const asset = findAsset(world, input.assetRef);
        if (!asset || !presentAssetSummary(asset, world.cases, member, pctx)) throw problems.unavailable();
        // Creating a case needs the borrower mandate on the asset owner organization (S §9.3).
        if (asset.ownerOrgId !== member.orgId || !member.roles.includes("BORROWER") || !hasMandate(member, "BORROWER")) throw problems.forbidden();
        if (DEMO_ORGANIZATIONS[input.selectedLenderOrgId]?.type !== "LENDER") {
          throw problems.validation([{ path: "body.selectedLenderOrgId", message: "Select a lender organization." }]);
        }
        if (input.dealerOrgId !== undefined && DEMO_ORGANIZATIONS[input.dealerOrgId]?.type !== "DEALER") {
          throw problems.validation([{ path: "body.dealerOrgId", message: "Select a dealer organization." }]);
        }
        if (asset.lifecycle !== "REGISTERED") throw problems.stateConflict("Register the asset before creating a case.");
        for (const c of world.cases) if (c.asset.ref === asset.ref && (c.lock?.state === "RELEASED" || c.review.state === "REJECTED")) finished.add(c.ref);
      }

      const { record, created } = await services.commands.createOrGetCommand({ actor: member, operation: "case.create", idempotencyKey: key, payload: input, target: "APPLICATION" });
      if (record.status !== "PREPARED") {
        const stored = CaseCreated.safeParse(record.result);
        if (!stored.success) throw problems.stateConflict();
        return reply.code(200).send({ command: services.commands.toStatus(record), result: stored.data });
      }
      const caseId = await db.transaction(async (tx) => {
        // One active case per asset: concurrent creations for the same asset are serialised.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`case:${input.assetRef}`}))`);
        const open = await tx
          .select({ caseRef: casesTable.caseRef })
          .from(casesTable)
          .where(and(eq(casesTable.assetRef, input.assetRef), eq(casesTable.borrowerOrgId, member.orgId), isNull(casesTable.cancelledAt), isNull(casesTable.closedAt)));
        if (!replay && open.some((row) => !finished.has(row.caseRef))) return null;
        const caseRef = await allocateRef(tx, "case");
        await tx.insert(casesTable).values({
          caseRef,
          title: input.title,
          purpose: input.purpose ?? null,
          assetRef: input.assetRef,
          borrowerOrgId: member.orgId,
          dealerOrgId: input.dealerOrgId ?? null,
          selectedLenderOrgId: input.selectedLenderOrgId,
          requestedPrincipal: input.requestedPrincipal?.amount ?? null,
          requestedCurrency: input.requestedPrincipal?.currency ?? null,
          policyRef: CREDIT_POLICY_REF,
          createdByUserId: member.userId,
        });
        return caseRef;
      });
      if (!caseId) {
        // Recorded, so a retry with the same key answers the same conflict instead of creating a case.
        await services.commands.transition(record.id, "REJECTED", { error: { kind: "PRECONDITION", message: ACTIVE_CASE } });
        throw problems.stateConflict(ACTIVE_CASE);
      }
      const committed = await services.commands.completeApplicationCommand(record, { caseId }, caseId);
      await recordAudit(db, { actor: member, action: "case.create", resourceType: "case", resourceRef: caseId, outcome: "SUCCEEDED", requestId: request.id }, request.log);
      return reply.code(created ? 201 : 200).send({ command: services.commands.toStatus(committed), result: { caseId } });
    },
  );

  // --- POST /cases/:id/sharing ----------------------------------------------------------------------

  app.post(
    "/cases/:id/sharing",
    {
      schema: {
        tags: ["cases"],
        summary: "Share the case package with the selected lender (owner), or consent to sharing own records (invited dealer)",
        headers: IdempotencyHeadersSchema,
        params: CaseParams,
        body: ShareCaseRequestSchema,
        response: workflowResponseSchemas(z.object({ grantId: z.string() })),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const input = request.body;
      const key = request.headers["idempotency-key"];
      const at = now();
      const { world, pctx } = await loadViewerWorld(db, member, mode, at);
      const facts = findCase(world, request.params.id);
      if (!facts || !presentCaseSummary(facts, member, pctx)) throw problems.unavailable();
      const isDealer = member.roles.includes("DEALER") && facts.dealerOrgId === member.orgId && facts.borrowerOrgId !== member.orgId;
      if (isDealer) {
        const ctx = caseContext(facts, at, pctx);
        if (!can(member, "sharing.approve", ctx)) throw isRelated(member, ctx) ? problems.forbidden() : problems.unavailable();
      } else {
        assertCheck(checkCaseAction(facts, member, "sharing.share", at, pctx), { replay: await commandExists(db, member, "case.share", key) });
      }
      if (input.recipientOrgId !== facts.selectedLenderOrgId) {
        throw problems.validation([{ path: "body.recipientOrgId", message: "Only the selected lender can receive this package." }]);
      }
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(at.getTime() + DEFAULT_SHARE_DAYS * DAY);
      if (expiresAt.getTime() <= at.getTime()) throw problems.validation([{ path: "body.expiresAt", message: "The share must expire in the future." }]);
      const lenderParty = await businessPartyOfOrg(db, input.recipientOrgId);
      if (!lenderParty) throw workflowProblems.ledgerUnavailable();
      const actor = await workflow.actorFor(member);
      const shareInput = { db, workflow, facts, lenderParty, permission: input.permission, expiresAt, idempotencyKey: key, payload: { caseId: facts.ref, input } };
      const outcome = isDealer ? await dealerConsent({ ...shareInput, dealer: actor }) : await shareWithLender({ ...shareInput, owner: actor });
      return replyWithOutcome(reply, outcome);
    },
  );

  // --- POST /cases/:id/verification-requests --------------------------------------------------------

  app.post(
    "/cases/:id/verification-requests",
    {
      schema: {
        tags: ["cases"],
        summary: "Request verification of the case asset (owner); the verifier becomes a case participant",
        headers: IdempotencyHeadersSchema,
        params: CaseParams,
        body: CreateVerificationRequestSchema,
        response: workflowResponseSchemas(z.object({ verificationRef: z.string() })),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const key = request.headers["idempotency-key"];
      const at = now();
      const { world, pctx } = await loadViewerWorld(db, member, mode, at);
      const facts = findCase(world, request.params.id);
      if (!facts) throw problems.unavailable();
      assertCheck(checkCaseAction(facts, member, "verification.request", at, pctx), { replay: await commandExists(db, member, "verification.request", key) });
      const owner = await workflow.actorFor(member);
      const outcome = await requestVerification({ db, workflow, owner, asset: facts.asset, caseRef: facts.ref, body: request.body, idempotencyKey: key, now: at });
      return replyWithOutcome(reply, outcome);
    },
  );
};
