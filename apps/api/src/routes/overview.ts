// GET /api/overview: the Overview's recorded figures (S §9.1) from the viewer's stakeholder-filtered read model
// only, per currency, with coverage (never a cross-currency sum; unavailable ≠ 0). Figures the viewer may not see
// are null (loan terms: borrower and selected lender; valuations: the lender's own assessments).
import type { Db } from "@collara/db";
import { OverviewSchema, presentOverview } from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { CollaraMode } from "../config";
import { loadViewerWorld } from "../workflow/cases/read";

export const overviewRoutes: FastifyPluginAsyncZod<{ db: Db; mode: CollaraMode; clock: () => Date }> = async (app, { db, mode, clock }) => {
  app.get(
    "/",
    {
      schema: {
        tags: ["overview"],
        summary: "Recorded financing principal and collateral valuation per currency, for the signed-in organisation's own scope",
        response: { 200: OverviewSchema },
      },
    },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, clock());
      return presentOverview(world.cases, member, pctx);
    },
  );
};
