// Pledges: GET /pledges, GET /pledges/:id, POST /pledges/:id/release-requests (API_ENDPOINTS "pledges.*"), plus
// POST /cases/:id/pledge-activation ("cases.activatePledge", registered here because the pledge workflow owns
// it; cases.ts serves the other /cases routes).
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import { CreateReleaseRequestSchema, pageSchema, paginate, PledgeListQuerySchema, PledgeSchema, presentPledge, type Pledge } from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../../errors";
import { IdempotencyHeadersSchema, replyWithOutcome, workflowResponseSchemas } from "../../workflow";
import { findCase, readWorld, submittedField } from "../../workflow/financing/common";
import { EmptyBody, financeDeps, RefParams } from "../../workflow/financing/http";
import { activatePledge } from "../../workflow/pledge/activation";
import { findPledge, requestRelease } from "../../workflow/release/requests";
import type { WorkflowRouteOptions } from "./types";

export const pledgeRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.get(
    "/pledges",
    { schema: { tags: ["pledges"], summary: "Pledges (collateral locks) visible to the caller", querystring: PledgeListQuerySchema, response: { 200: pageSchema(PledgeSchema) } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await readWorld(deps, member);
      const filter = request.query.filter;
      const pledges = world.cases
        .map((c) => presentPledge(c, member, pctx))
        .filter((p): p is Pledge => p !== null)
        .filter((p) => {
          if (!filter) return true;
          if (filter === "released") return p.state.value === "RELEASED";
          if (filter === "release-requested") return p.state.value === "RELEASE_REQUESTED";
          return p.lockState.value === "ACTIVE" && p.state.value !== "RELEASE_REQUESTED";
        })
        .sort((a, b) => Date.parse(b.activatedAt) - Date.parse(a.activatedAt));
      return paginate(pledges, request.query);
    },
  );

  app.get(
    "/pledges/:id",
    { schema: { tags: ["pledges"], summary: "One pledge with its release requests", params: RefParams, response: { 200: PledgeSchema } } },
    async (request) => {
      const member = await request.requireActor();
      const scope = await findPledge(deps, member, request.params.id);
      const pledge = presentPledge(scope.facts, member, scope.pctx);
      if (!pledge) throw problems.unavailable();
      return pledge;
    },
  );

  app.post(
    "/cases/:id/pledge-activation",
    {
      schema: {
        tags: ["pledges"],
        summary: "Activate the pledge: consume the shared control and the borrower's authorization (lender approver)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: EmptyBody,
        response: workflowResponseSchemas(z.object({ pledgeRef: z.string() })),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findCase(deps, member, (c) => c.ref === request.params.id);
      const outcome = await activatePledge(deps, member, scope, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, outcome, { pendingResult: { pledgeRef: submittedField(outcome.record, "lockRef") ?? "" } });
    },
  );

  app.post(
    "/pledges/:id/release-requests",
    {
      schema: {
        tags: ["pledges"],
        summary: "Request release (the lock stays ACTIVE until the designated lender authorizes)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: CreateReleaseRequestSchema,
        response: workflowResponseSchemas(z.object({ releaseRequestRef: z.string() })),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findPledge(deps, member, request.params.id);
      const outcome = await requestRelease(deps, member, scope, request.params.id, request.body, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, outcome, { pendingResult: { releaseRequestRef: submittedField(outcome.record, "releaseRequestRef") ?? "" } });
    },
  );
};
