// POST /api/pilot-requests (S §6.1): public, rate-limited, stored before anything else.
// Email notification is NOT implemented yet: requests stay RECEIVED (notify_attempts = 0) until a
// notifier exists; a failed notification would never turn a stored request into a failure.
import { pilotRequests, type Db } from "@collara/db";
import { IdempotencyKeySchema, PilotRequestReceiptSchema, PilotRequestSchema, pilotRequestStates, type PilotRequestState } from "@collara/domain";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export interface PilotRoutesOptions {
  readonly db: Db;
  readonly rateLimit: { readonly max: number; readonly timeWindowMs: number };
  readonly clock: () => Date;
}

// The honeypot is accepted here (any short string) so a filled one can be discarded silently.
const PilotBodySchema = PilotRequestSchema.extend({ website: z.string().max(500).optional() });

export const pilotRoutes: FastifyPluginAsyncZod<PilotRoutesOptions> = async (app, { db, rateLimit, clock }) => {
  app.post(
    "",
    {
      config: { rateLimit: { max: rateLimit.max, timeWindow: rateLimit.timeWindowMs } },
      schema: {
        tags: ["public"],
        summary: "Request a pilot conversation (public, rate-limited)",
        description:
          "Stored before any notification. Email notification is not implemented yet, so the state stays RECEIVED. A non-empty honeypot field is discarded without storing.",
        headers: z.object({ "idempotency-key": IdempotencyKeySchema.optional() }),
        body: PilotBodySchema,
        response: { 201: PilotRequestReceiptSchema },
      },
    },
    async (request, reply) => {
      const { website, consent: _consent, ...fields } = request.body;
      const now = clock();
      if (website) {
        // Bots get the normal-looking receipt; nothing is stored.
        request.log.info("pilot request honeypot triggered; discarded");
        return reply.code(201).send({ id: randomUUID(), state: pilotRequestStates.badge("RECEIVED"), receivedAt: now.toISOString() });
      }
      const idempotencyKey = request.headers["idempotency-key"] ?? null;
      const [inserted] = await db
        .insert(pilotRequests)
        .values({ ...fields, currentSystems: fields.currentSystems || null, consentAt: now, idempotencyKey, receivedAt: now })
        .onConflictDoNothing({ target: pilotRequests.idempotencyKey })
        .returning();
      const row =
        inserted ??
        (idempotencyKey ? (await db.select().from(pilotRequests).where(eq(pilotRequests.idempotencyKey, idempotencyKey)).limit(1))[0] : undefined);
      if (!row) throw new Error("pilot request was neither stored nor found");
      return reply.code(201).send({
        id: row.id,
        state: pilotRequestStates.badge(row.status as PilotRequestState),
        receivedAt: row.receivedAt.toISOString(),
      });
    },
  );
};
