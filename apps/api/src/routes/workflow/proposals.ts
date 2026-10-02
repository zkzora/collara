// Proposals: GET /proposals/:id, POST /proposals/:id/acceptance, /decline, /withdraw,
// /activation-authorization (API_ENDPOINTS "proposals.*"), plus POST /cases/:id/proposals ("cases.createProposal",
// registered here because the financing workflow owns it; cases.ts serves the other /cases routes).
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import {
  CreateProposalRequestSchema,
  DeclineProposalRequestSchema,
  ExpectedVersionRequestSchema,
  presentProposal,
  ProposalSchema,
} from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../../errors";
import { IdempotencyHeadersSchema, replyWithOutcome, workflowResponseSchemas } from "../../workflow";
import { findCase, submittedField } from "../../workflow/financing/common";
import { commandOnly, financeDeps, RefParams } from "../../workflow/financing/http";
import { authorizeActivation, createProposal, findProposal, respondToProposal, withdrawProposal } from "../../workflow/financing/proposals";
import type { WorkflowRouteOptions } from "./types";

const ProposalRefResult = z.object({ proposalRef: z.string(), version: z.number().int() });
const WithdrawBody = z.object({ reason: z.string().trim().max(1000).optional() }).optional();

export const proposalRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.get(
    "/proposals/:id",
    { schema: { tags: ["proposals"], summary: "Financing proposal (borrower and selected lender only)", params: RefParams, response: { 200: ProposalSchema } } },
    async (request) => {
      const member = await request.requireActor();
      const scope = await findProposal(deps, member, request.params.id);
      // As in the UI_MOCK client: the case's current visible proposal (drafts and other versions in `versions`).
      const proposal = presentProposal(scope.facts, member, scope.pctx);
      if (!proposal) throw problems.unavailable();
      return proposal;
    },
  );

  app.post(
    "/cases/:id/proposals",
    {
      schema: {
        tags: ["proposals"],
        summary: "Issue a financing proposal (approver) or record a draft (analyst or approver; application record only)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: CreateProposalRequestSchema,
        response: workflowResponseSchemas(ProposalRefResult),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findCase(deps, member, (c) => c.ref === request.params.id);
      const created = await createProposal(deps, member, scope, request.body, request.headers["idempotency-key"]);
      if (created.kind === "application") {
        reply.code(200);
        return { command: created.command, result: created.result };
      }
      const { outcome } = created;
      const pendingRef = submittedField(outcome.record, "proposalRef");
      const pending = pendingRef ? { proposalRef: pendingRef, version: 1 } : created.pending;
      return replyWithOutcome(reply, outcome, { pendingResult: pending });
    },
  );

  app.post(
    "/proposals/:id/acceptance",
    {
      schema: {
        tags: ["proposals"],
        summary: "Accept the exact proposal version (borrower)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: ExpectedVersionRequestSchema,
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findProposal(deps, member, request.params.id);
      const outcome = await respondToProposal(deps, member, scope, request.params.id, { decision: "ACCEPT", expectedVersion: request.body.expectedVersion }, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, commandOnly(outcome));
    },
  );

  app.post(
    "/proposals/:id/decline",
    {
      schema: {
        tags: ["proposals"],
        summary: "Decline the exact proposal version (borrower)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: DeclineProposalRequestSchema,
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findProposal(deps, member, request.params.id);
      const { expectedVersion, reason } = request.body;
      const outcome = await respondToProposal(
        deps,
        member,
        scope,
        request.params.id,
        { decision: "DECLINE", expectedVersion, ...(reason ? { reason } : {}) },
        request.headers["idempotency-key"],
      );
      return replyWithOutcome(reply, commandOnly(outcome));
    },
  );

  app.post(
    "/proposals/:id/withdraw",
    {
      schema: {
        tags: ["proposals"],
        summary: "Withdraw an issued proposal before acceptance (approver)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: WithdrawBody,
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findProposal(deps, member, request.params.id);
      const outcome = await withdrawProposal(deps, member, scope, request.params.id, { reason: request.body?.reason }, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, commandOnly(outcome));
    },
  );

  app.post(
    "/proposals/:id/activation-authorization",
    {
      schema: {
        tags: ["proposals"],
        summary: "Authorize pledge activation for the accepted version (borrower)",
        params: RefParams,
        headers: IdempotencyHeadersSchema,
        body: ExpectedVersionRequestSchema,
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const scope = await findProposal(deps, member, request.params.id);
      const outcome = await authorizeActivation(deps, member, scope, request.params.id, request.body, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, commandOnly(outcome));
    },
  );
};
