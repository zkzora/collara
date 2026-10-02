// Access grants: GET|POST /access-grants, POST /access-grants/:id/revoke (API_ENDPOINTS "accessGrants.*").
//   GET    package shares (and pending dealer-consent requests), verification scopes and audit grants of the
//          cases the viewer may see (domain presentAccessGrants).
//   POST   audit grants (body CreateAuditGrantRequest): delegated to workflow/audit/grants.ts (AuditGrant, one per
//          record owner), the same code as POST /audit/grants.
//   revoke package shares: owner Share_Revoke (ShareProposal_Withdraw while the dealer has not consented); a
//          consenting dealer Share_WithdrawConsent / Consent_Decline (workflow/sharing/grants.ts); audit grants:
//          Grant_Revoke by the grantor (workflow/audit/grants.ts).
// Revocation limits future access only: "Future document access has been revoked. Previously shared copies may
// still exist." (STATUS_COPY.ACCESS_REVOKED, answered at download by workflow/sharing/evidence-access.ts).
import {
  AccessGrantQuerySchema,
  AccessGrantSchema,
  can,
  caseContext,
  checkCaseAction,
  CreateAuditGrantRequestSchema,
  pageSchema,
  paginate,
  presentAccessGrants,
  presentCaseSummary,
  isRelated,
  type AccessGrant,
} from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../../errors";
import { IdempotencyHeadersSchema, replyWithOutcome, workflowResponseSchemas } from "../../workflow";
import { createAuditGrant, revokeAuditGrant } from "../../workflow/audit/grants";
import { assertCheck, commandExists, loadViewerWorld } from "../../workflow/cases/read";
import { submittedField } from "../../workflow/financing/common";
import { revokeShare } from "../../workflow/sharing";
import { financeDeps } from "../../workflow/financing/http";
import type { WorkflowRouteOptions } from "./types";

/** Opaque grant ids (AG-###, SHR-### from the seed): any unknown or unauthorized id gets the same 404 body. */
const GrantParams = z.object({ id: z.string().trim().min(1).max(80) });
/** INFERRED copy, same string as the UI_MOCK client. */
const ALREADY_REVOKED = "This grant is already revoked.";

export const accessRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, opts) => {
  const { services, workflow, mode } = opts;
  const db = services.db.db;
  const now = services.clock;
  const deps = financeDeps(opts);

  app.get(
    "/access-grants",
    { schema: { tags: ["access"], summary: "Package shares, verification scopes and audit grants visible to the viewer", querystring: AccessGrantQuerySchema, response: { 200: pageSchema(AccessGrantSchema) } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const caseId = request.query.caseId;
      const scoped = caseId ? world.cases.filter((c) => c.ref === caseId) : world.cases;
      if (caseId && !scoped.some((c) => presentCaseSummary(c, member, pctx))) throw problems.unavailable();
      const items = scoped.flatMap((c): AccessGrant[] => presentAccessGrants(c, member, pctx) ?? []);
      return paginate(items, request.query);
    },
  );

  app.post(
    "/access-grants",
    {
      schema: {
        tags: ["access"],
        summary: "Grant an auditor scoped access to the caller's own records of a case (AuditGrant)",
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
    "/access-grants/:id/revoke",
    {
      schema: {
        tags: ["access"],
        summary: "Revoke a package share (owner) or an audit grant (its grantor); limits future access only",
        headers: IdempotencyHeadersSchema,
        params: GrantParams,
        body: z.object({}).optional(),
        response: workflowResponseSchemas(),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const grantId = request.params.id;
      const key = request.headers["idempotency-key"];
      const at = now();
      const { world, pctx } = await loadViewerWorld(db, member, mode, at);
      const facts = world.cases.find((c) => c.shares.some((s) => s.ref === grantId));
      if (!facts) {
        // Not a package share the viewer can see: an audit grant (or 404-shaped).
        const outcome = await revokeAuditGrant(deps, member, grantId, key);
        return replyWithOutcome(reply, { ...outcome, result: null });
      }
      // The owner revokes its shares; a consenting dealer withdraws its own consent. Anyone else: 404-shaped.
      if (!presentCaseSummary(facts, member, pctx) || !presentAccessGrants(facts, member, pctx)?.some((g) => g.id === grantId)) throw problems.unavailable();
      const replay = await commandExists(db, member, "accessGrant.revoke", key);
      if (member.orgId === facts.borrowerOrgId) assertCheck(checkCaseAction(facts, member, "sharing.revoke", at, pctx), { replay });
      else {
        const ctx = caseContext(facts, at, pctx);
        if (!can(member, "sharing.approve", ctx)) throw isRelated(member, ctx) ? problems.forbidden() : problems.unavailable();
      }
      const share = facts.shares.find((s) => s.ref === grantId);
      if (!replay && share?.state !== "GRANTED" && share?.state !== "REQUESTED") throw problems.stateConflict(ALREADY_REVOKED);
      const actor = await workflow.actorFor(member);
      const outcome = await revokeShare({ workflow, actor, caseRef: facts.ref, grantId, idempotencyKey: key });
      return replyWithOutcome(reply, { ...outcome, result: null });
    },
  );
};
