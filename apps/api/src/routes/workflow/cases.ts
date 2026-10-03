// Cases: GET|POST /cases, GET /cases/:id, GET /cases/:id/evidence, POST /cases/:id/sharing,
// POST /cases/:id/verification-requests (API_ENDPOINTS "cases.*"). The lender-side case routes
// (/assessments, /proposals, /pledge-activation) belong to the review/financing modules.
// Reads: projections → read model (stakeholder-filtered) → domain presenters. Unrelated or unknown → 404-shaped.
// Writes: policy + preconditions on the viewer's facts, then the ledger runner (fresh ACS reads in prepare).
// Case creation is an application record (cases table); it never claims a ledger confirmation.
import type { CommandRow } from "@collara/db";
import {
  caseContext,
  CASE_CREATE_COPY,
  caseHoldsAsset,
  CaseDetailSchema,
  CaseListQuerySchema,
  CaseListSchema,
  CaseRefSchema,
  checkAssetAction,
  checkCaseAction,
  commandResultSchema,
  CreateCaseRequestSchema,
  CreateVerificationRequestSchema,
  CREDIT_POLICY_REF,
  EvidenceDocumentSchema,
  can,
  isRelated,
  paginate,
  presentAssetSummary,
  presentCaseDetail,
  presentCaseEvidence,
  presentCaseList,
  presentCaseSummary,
  ShareCaseRequestSchema,
} from "@collara/domain";
import { z } from "zod";
import { problems } from "../../errors";
import { inDirectory } from "../directory";
import { recordAudit } from "../../services/audit";
import {
  businessPartyOfOrg,
  IdempotencyHeadersSchema,
  replyWithOutcome,
  workflowProblems,
  workflowResponseSchemas,
} from "../../workflow";
import { caseOfCommand, createCaseForAsset } from "../../workflow/cases/create";
import { assertCheck, commandExists, findAsset, findCase, loadViewerWorld } from "../../workflow/cases/read";
import { dealerConsent, DEFAULT_SHARE_DAYS, ensureLenderAssessment, shareWithLender } from "../../workflow/sharing";
import { requestVerification } from "../../workflow/verification/request";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

const CaseParams = z.object({ id: CaseRefSchema });
/** INFERRED copy, same strings as the UI_MOCK client. */
const ACTIVE_CASE = CASE_CREATE_COPY.ACTIVE_CASE;
const CREATE_REFUSALS: readonly string[] = Object.values(CASE_CREATE_COPY);
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
      const commandInput = { actor: member, operation: "case.create", idempotencyKey: request.headers["idempotency-key"], payload: input, target: "APPLICATION" } as const;
      /** A settled command answers what it stored: the same case, or the same refusal. Never a second case. */
      const stored = (record: CommandRow) => {
        if (record.status === "REJECTED") throw problems.stateConflict(record.errorMessage && CREATE_REFUSALS.includes(record.errorMessage) ? record.errorMessage : undefined);
        const result = CaseCreated.safeParse(record.result);
        if (!result.success) throw problems.stateConflict();
        return { command: services.commands.toStatus(record), result: result.data };
      };

      // Same key, already settled: the stored outcome (409 idempotency conflict for another payload).
      const prior = await services.commands.findCommand(commandInput);
      if (prior && prior.status !== "PREPARED") return reply.code(200).send(stored(prior));

      // A new or unfinished command always runs the full checks; an existing command never skips them.
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const asset = findAsset(world, input.assetRef);
      if (!asset || !presentAssetSummary(asset, world.cases, member, pctx)) throw problems.unavailable();
      // Owner organization + borrower mandate (S §9.3), registered, no case holding the asset: the same domain
      // check as the passport's allowed actions and the UI_MOCK client. Policy first (403), state after validation.
      const check = checkAssetAction(asset, world.cases, member, "case.create", pctx.now, pctx);
      if (!check.ok && check.reason !== "CONFLICT") assertCheck(check);
      // Counterparties come from the onboarded directory (GET /api/directory/*), never from a static list.
      const issues: { path: string; message: string }[] = [];
      if (!(await inDirectory(db, "LENDER", input.selectedLenderOrgId))) issues.push({ path: "body.selectedLenderOrgId", message: "Select a lender organization." });
      if (input.dealerOrgId !== undefined && !(await inDirectory(db, "DEALER", input.dealerOrgId))) {
        issues.push({ path: "body.dealerOrgId", message: "Select a dealer organization." });
      }
      if (issues.length > 0) throw problems.validation(issues);
      // The asset is held (or not registered). Without a command record the request is refused as is; with one (a
      // retry, or a concurrent request with the same key) the command's transaction below decides: its stored or
      // already-inserted case wins, otherwise the refusal is recorded.
      const conflict = check.ok ? null : check.message;
      if (conflict !== null && !(await services.commands.findCommand(commandInput))) throw problems.stateConflict(conflict);
      // Cases of this asset that no longer hold it (released pledge or rejected review, per the viewer's ledger facts).
      const finished = new Set(world.cases.filter((c) => c.asset.ref === asset.ref && !caseHoldsAsset(c)).map((c) => c.ref));

      const { record } = await services.commands.createOrGetCommand(commandInput);
      let inserted = false;
      // The case row and the command's COMMITTED result commit in one transaction, with the command row locked.
      const outcome = await services.commands.runApplicationCommand(record, async (tx, locked) => {
        const refuse = (message: string) => ({ kind: "reject", error: { kind: "PRECONDITION", message } }) as const;
        // A case this command inserted earlier (rows from before this transaction was atomic) completes the command.
        const linked = await caseOfCommand(tx, locked.id);
        if (linked) return { kind: "commit", result: { caseId: linked }, resourceRef: linked };
        if (conflict !== null) return refuse(conflict);
        const caseId = await createCaseForAsset(
          tx,
          {
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
            createCommandId: locked.id,
          },
          finished,
          now(),
        );
        if (!caseId) return refuse(ACTIVE_CASE);
        inserted = true;
        return { kind: "commit", result: { caseId }, resourceRef: caseId };
      });
      const body = stored(outcome.record);
      if (outcome.wrote) {
        await recordAudit(db, { actor: member, action: "case.create", resourceType: "case", resourceRef: body.result.caseId, outcome: "SUCCEEDED", requestId: request.id }, request.log);
      }
      return reply.code(inserted ? 201 : 200).send(body);
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
