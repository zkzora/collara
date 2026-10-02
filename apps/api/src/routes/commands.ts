import { CommandStatusSchema, VerifierEntrySchema } from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../errors";
import type { CommandService } from "../services/commands";
import type { ProjectionReader } from "../services/ledger";

/** GET /api/commands/:id — visible only to the actor and organization that issued the command. */
export const commandRoutes: FastifyPluginAsyncZod<{ commands: CommandService }> = async (app, { commands }) => {
  app.get(
    "/:id",
    {
      schema: {
        tags: ["commands"],
        summary: "Command lifecycle status (submission, commit, projection)",
        params: z.object({ id: z.string().min(1).max(64) }),
        response: { 200: CommandStatusSchema },
      },
    },
    async (request) => {
      const actor = await request.requireActor();
      const id = request.params.id;
      // Ids are UUIDs; anything else is simply unavailable (same response as someone else's command).
      const record = z.uuid().safeParse(id).success ? await commands.findForActor(id, actor) : null;
      if (!record) throw problems.unavailable();
      return commands.toStatus(record);
    },
  );
};

/**
 * GET /api/verifiers — reads the verifier registry from projections. PLACEHOLDER in this stage: the
 * projection worker does not index the governance registry yet, so the list is empty and the response
 * carries `x-collara-projection: not-indexed`.
 */
export const verifierRoutes: FastifyPluginAsyncZod<{ projections: ProjectionReader; indexed: boolean }> = async (app, { projections, indexed }) => {
  app.get(
    "",
    {
      schema: {
        tags: ["governance"],
        summary: "Verifier registry entries visible to the caller",
        description:
          "Placeholder until the projection worker indexes the verifier registry: returns an empty list with header `x-collara-projection: not-indexed`.",
        response: { 200: z.array(VerifierEntrySchema) },
      },
    },
    async (request, reply) => {
      const actor = await request.requireActor();
      if (!indexed) reply.header("x-collara-projection", "not-indexed");
      return projections.verifierEntries(actor.parties.readAs);
    },
  );
};
