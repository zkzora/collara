// Release requests: GET /release-requests/:id, POST /release-requests/:id/decision,
// /information-requests, /responses, /withdraw (API_ENDPOINTS "releaseRequests.*").
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

export const releaseRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async () => {};
