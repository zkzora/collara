// Audit: GET /audit/events (API_ENDPOINTS "audit.events"), plus the audit-grant ledger commands
// POST /audit/grants and POST /audit/grants/:id/revoke (AuditGrant create / Grant_Revoke). The route contract's
// "accessGrants.create" (POST /access-grants, body CreateAuditGrantRequest) and "accessGrants.revoke" live in
// access.ts; they should delegate audit grants to workflow/audit/grants.ts (createAuditGrant, revokeAuditGrant).
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import { AuditEventQuerySchema, AuditEventSchema, CreateAuditGrantRequestSchema, pageSchema } from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { IdempotencyHeadersSchema, replyWithOutcome, workflowResponseSchemas } from "../../workflow";
import { listAuditEvents } from "../../workflow/audit/events";
import { createAuditGrant, revokeAuditGrant } from "../../workflow/audit/grants";
import { commandOnly, EmptyBody, financeDeps, RefParams } from "../../workflow/financing/http";
import { submittedField } from "../../workflow/financing/common";
import type { WorkflowRouteOptions } from "./types";

export const auditRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.get(
    "/audit/events",
    {
      schema: {
        tags: ["audit"],
        summary: "Committed workflow events within the caller's scope (audit grants apply to auditors)",
        querystring: AuditEventQuerySchema,
        response: { 200: pageSchema(AuditEventSchema) },
      },
    },
    async (request) => {
      const member = await request.requireActor();
      return listAuditEvents(deps, member, request.query);
    },
  );

  app.post(
    "/audit/grants",
    {
      schema: {
        tags: ["audit"],
        summary: "Grant scoped audit access to an auditor (record owner: borrower or selected lender approver)",
        headers: IdempotencyHeadersSchema,
        body: CreateAuditGrantRequestSchema,
        response: workflowResponseSchemas(z.object({ grantId: z.string() })),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const outcome = await createAuditGrant(deps, member, request.body, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, outcome, { pendingResult: { grantId: submittedField(outcome.record, "grantRef") ?? "" } });
    },
  );

  app.post(
    "/audit/grants/:id/revoke",
    {
      schema: { tags: ["audit"], summary: "Revoke an audit grant (grantor only; limits future access)", params: RefParams, headers: IdempotencyHeadersSchema, body: EmptyBody, response: workflowResponseSchemas() },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const outcome = await revokeAuditGrant(deps, member, request.params.id, request.headers["idempotency-key"]);
      return replyWithOutcome(reply, commandOnly(outcome));
    },
  );
};
