// Cases: GET|POST /cases, GET /cases/:id, GET /cases/:id/evidence, POST /cases/:id/sharing,
// POST /cases/:id/verification-requests, /assessments, /proposals, /pledge-activation (API_ENDPOINTS "cases.*").
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

export const caseRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async () => {};
