// Registers every workflow route module once, under the /api prefix (see app.ts). Each module declares
// full paths ("/cases/:id"). Builders fill their own module; this file and the registration stay as is.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { caseRoutes } from "./cases";
import { assetRoutes } from "./assets";
import { verificationRoutes } from "./verification";
import { reviewRoutes } from "./reviews";
import { proposalRoutes } from "./proposals";
import { pledgeRoutes } from "./pledges";
import { releaseRoutes } from "./release";
import { accessRoutes } from "./access";
import { auditRoutes } from "./audit";
import { reportRoutes } from "./reports";
import { governanceRoutes } from "./governance";
import type { WorkflowRouteOptions } from "./types";

export type { WorkflowRouteOptions } from "./types";

export const workflowRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, opts) => {
  // Pass only the module options (the parent's `prefix` must not be applied twice).
  const options: WorkflowRouteOptions = { services: opts.services, workflow: opts.workflow, mode: opts.mode };
  await app.register(caseRoutes, options);
  await app.register(assetRoutes, options);
  await app.register(verificationRoutes, options);
  await app.register(reviewRoutes, options);
  await app.register(proposalRoutes, options);
  await app.register(pledgeRoutes, options);
  await app.register(releaseRoutes, options);
  await app.register(accessRoutes, options);
  await app.register(auditRoutes, options);
  await app.register(reportRoutes, options);
  await app.register(governanceRoutes, options);
};
