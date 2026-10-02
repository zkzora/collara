// Pledges: GET /pledges, GET /pledges/:id, POST /pledges/:id/release-requests
// (API_ENDPOINTS "pledges.*").
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

export const pledgeRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async () => {};
