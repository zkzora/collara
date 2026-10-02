// Reviews: GET /reviews, GET /reviews/:id, POST /reviews/:id/submit-for-approval, /decision,
// /information-requests (API_ENDPOINTS "reviews.*").
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

export const reviewRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async () => {};
