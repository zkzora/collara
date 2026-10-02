// Assets: GET|POST /assets, GET /assets/:id, GET /assets/:id/evidence,
// POST /assets/:id/verification-requests (API_ENDPOINTS "assets.*"). Registration: workflow.registrar.registerAsset().
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

export const assetRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async () => {};
