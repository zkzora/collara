// Reviews: GET /reviews, GET /reviews/:id, POST /reviews/:id/submit-for-approval, /decision,
// /information-requests (API_ENDPOINTS "reviews.*"), plus POST /cases/:id/assessments ("cases.saveAssessment",
// registered here because the lender review owns it; cases.ts serves the other /cases routes).
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import {
  MessageRequestSchema,
  pageSchema,
  PageQuerySchema,
  paginate,
  presentReview,
  presentReviewSummary,
  ReviewDecisionRequestSchema,
  ReviewSchema,
  ReviewSummarySchema,
  SaveAssessmentRequestSchema,
  type Review,
  type ReviewSummary,
} from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { problems } from "../../errors";
import type { ResolvedActor } from "../../plugins/actor";
import { IdempotencyHeadersSchema, replyWithOutcome, workflowResponseSchemas } from "../../workflow";
import { findCase, readWorld, type FinanceDeps } from "../../workflow/financing/common";
import { commandOnly, EmptyBody, financeDeps, RefParams, withResult } from "../../workflow/financing/http";
import {
  decideReview,
  findReview,
  requestReviewInformation,
  saveAssessment,
  submitForApproval,
  type AssessmentState,
  type SaveAssessmentInput,
} from "../../workflow/review/assessment";
import type { WorkflowRouteOptions } from "./types";

/**
 * The review as the member sees it after a committed save: the projection may still lag, so the committed
 * assessment version (decoded from the transaction) is applied to the projected facts before presenting.
 */
async function reviewAfterSave(deps: FinanceDeps, member: ResolvedActor, caseRef: string, state: AssessmentState | null, input: SaveAssessmentInput): Promise<Review> {
  const scope = await findCase(deps, member, (c) => c.ref === caseRef);
  const facts = structuredClone(scope.facts);
  if (state && state.assessmentRef) {
    const review = facts.review;
    review.ref = state.assessmentRef;
    review.state = state.status;
    review.startedAt ??= scope.now.toISOString();
    if (member.roles.includes("LENDER_ANALYST")) review.analystUserId = member.userId;
    review.assessment = {
      valuation: input.valuation,
      valuationSource: input.valuationSource,
      valuationDate: input.valuationDate,
      limitations: input.limitations,
      outcome: input.outcome,
      policyRef: input.policyRef,
      version: state.version,
      savedAt: scope.now.toISOString(),
      savedByUserId: member.userId,
      requiredExternalChecks: review.assessment?.requiredExternalChecks ?? [],
    };
  }
  const presented = presentReview(facts, member, scope.pctx);
  if (!presented) throw problems.unavailable();
  return presented;
}

export const reviewRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.get(
    "/reviews",
    { schema: { tags: ["reviews"], summary: "Lender reviews visible to the caller", querystring: PageQuerySchema, response: { 200: pageSchema(ReviewSummarySchema) } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await readWorld(deps, member);
      const items = world.cases
        .filter((c) => c.review.ref !== "")
        .map((c) => presentReviewSummary(c, member, pctx))
        .filter((x): x is ReviewSummary => x !== null);
      return paginate(items, request.query);
    },
  );

  app.get(
    "/reviews/:id",
    { schema: { tags: ["reviews"], summary: "One lender review (fields omitted by role and mandate)", params: RefParams, response: { 200: ReviewSchema } } },
    async (request) => {
      const member = await request.requireActor();
      const scope = await findReview(deps, member, request.params.id);
      const review = presentReview(scope.facts, member, scope.pctx);
      if (!review) throw problems.unavailable();
      return review;
    },
  );

  app.post(
    "/cases/:id/assessments",
    {
      schema: {
        tags: ["reviews"],
        summary: "Save the lender's collateral assessment (opens and starts the review when needed)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: SaveAssessmentRequestSchema,
        response: workflowResponseSchemas(ReviewSchema),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const input = request.body;
      if (/^0+(\.0+)?$/.test(input.valuation.amount)) {
        throw problems.validation([{ path: "body.valuation.amount", message: "The valuation must be greater than zero." }]);
      }
      const scope = await findCase(deps, member, (c) => c.ref === request.params.id);
      const outcome = await saveAssessment(deps, member, scope, input, request.headers["idempotency-key"]);
      const review = await reviewAfterSave(deps, member, scope.facts.ref, outcome.committed ? outcome.result : null, input);
      return replyWithOutcome(reply, withResult(outcome, review), { pendingResult: review });
    },
  );

  app.post(
    "/reviews/:id/submit-for-approval",
    {
      schema: { tags: ["reviews"], summary: "Submit the assessment for approval", params: RefParams, headers: IdempotencyHeadersSchema, body: EmptyBody, response: workflowResponseSchemas() },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findReview(deps, member, request.params.id);
      return replyWithOutcome(reply, commandOnly(await submitForApproval(deps, member, scope, request.headers["idempotency-key"])));
    },
  );

  app.post(
    "/reviews/:id/decision",
    {
      schema: {
        tags: ["reviews"],
        summary: "Record the collateral decision (approver mandate)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: ReviewDecisionRequestSchema,
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findReview(deps, member, request.params.id);
      return replyWithOutcome(reply, commandOnly(await decideReview(deps, member, scope, request.body, request.headers["idempotency-key"])));
    },
  );

  app.post(
    "/reviews/:id/information-requests",
    {
      schema: {
        tags: ["reviews"],
        summary: "Request information from the borrower",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: MessageRequestSchema,
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findReview(deps, member, request.params.id);
      return replyWithOutcome(reply, commandOnly(await requestReviewInformation(deps, member, scope, request.body, request.headers["idempotency-key"])));
    },
  );
};
