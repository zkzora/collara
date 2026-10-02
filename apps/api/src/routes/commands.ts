import { CommandStatusSchema } from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../errors";
import type { CommandService } from "../services/commands";

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
