// Release requests: GET /release-requests/:id, POST /release-requests/:id/decision,
// /information-requests, /responses, /withdraw (API_ENDPOINTS "releaseRequests.*").
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import { MessageRequestSchema, presentPledge, ReleaseDecisionRequestSchema, ReleaseRequestSchema } from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { problems } from "../../errors";
import { IdempotencyHeadersSchema, replyWithOutcome, workflowResponseSchemas } from "../../workflow";
import { commandOnly, EmptyBody, financeDeps, RefParams } from "../../workflow/financing/http";
import { decideRelease, findReleaseRequest, requestReleaseInformation, respondToRelease, withdrawRelease } from "../../workflow/release/requests";
import type { WorkflowRouteOptions } from "./types";

export const releaseRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.get(
    "/release-requests/:id",
    { schema: { tags: ["release"], summary: "One release request", params: RefParams, response: { 200: ReleaseRequestSchema } } },
    async (request) => {
      const member = await request.requireActor();
      const scope = await findReleaseRequest(deps, member, request.params.id);
      const found = presentPledge(scope.facts, member, scope.pctx)?.releaseRequests.find((r) => r.ref === request.params.id);
      if (!found) throw problems.unavailable();
      return found;
    },
  );

  app.post(
    "/release-requests/:id/decision",
    {
      schema: {
        tags: ["release"],
        summary: "Authorize or reject a release request (designated lender approver only)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: ReleaseDecisionRequestSchema,
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findReleaseRequest(deps, member, request.params.id);
      const outcome = await decideRelease(deps, member, scope, request.params.id, request.body, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, commandOnly(outcome));
    },
  );

  app.post(
    "/release-requests/:id/information-requests",
    {
      schema: {
        tags: ["release"],
        summary: "Ask the requester for information (designated lender approver only)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: MessageRequestSchema,
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findReleaseRequest(deps, member, request.params.id);
      const outcome = await requestReleaseInformation(deps, member, scope, request.params.id, request.body, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, commandOnly(outcome));
    },
  );

  app.post(
    "/release-requests/:id/responses",
    {
      schema: {
        tags: ["release"],
        summary: "Answer the lender's information request (borrower)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: MessageRequestSchema,
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findReleaseRequest(deps, member, request.params.id);
      const outcome = await respondToRelease(deps, member, scope, request.params.id, request.body, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, commandOnly(outcome));
    },
  );

  app.post(
    "/release-requests/:id/withdraw",
    {
      schema: { tags: ["release"], summary: "Withdraw an open release request (requester)", params: RefParams, headers: IdempotencyHeadersSchema, body: EmptyBody, response: workflowResponseSchemas() },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findReleaseRequest(deps, member, request.params.id);
      const outcome = await withdrawRelease(deps, member, scope, request.params.id, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, commandOnly(outcome));
    },
  );
};
