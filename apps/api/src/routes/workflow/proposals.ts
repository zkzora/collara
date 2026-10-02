// Proposals: GET /proposals/:id, POST /proposals/:id/acceptance, /decline, /withdraw,
// /activation-authorization (API_ENDPOINTS "proposals.*").
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

export const proposalRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async () => {};
