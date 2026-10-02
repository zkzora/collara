// Governance: GET /governance/state, GET /governance/proposals[/:id], POST /governance/proposals,
// POST /governance/proposals/:id/confirmations, /execute, /cancel (API_ENDPOINTS "governance.*").
// GET /verifiers is still served by the placeholder verifierRoutes (routes/commands.ts, registered in app.ts).
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

export const governanceRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async () => {};
