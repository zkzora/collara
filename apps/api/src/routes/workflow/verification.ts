// Verification: GET /verifications, GET /verifications/:id, POST /verifications/:id/assignment,
// /change-requests, /evidence-submissions, /attestations, /rejection; GET /attestations/:id
// (API_ENDPOINTS "verifications.*", "attestations.get").
// Registered once under the /api prefix by ./index.ts: declare full paths here ("/cases/:id", not "/:id").
// Write path: workflow.run()/sequence() + replyWithOutcome(); read path: projections → domain facts → presenters.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WorkflowRouteOptions } from "./types";

export const verificationRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async () => {};
