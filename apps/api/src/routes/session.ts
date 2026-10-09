// GET /api/me and the demo-environment persona sessions.
import { loadUserAuthority, users, type Db } from "@collara/db";
import {
  DEMO_PERSONAS,
  DemoPersonaSchema,
  DemoSessionRequestSchema,
  MeSchema,
  PersonaIdSchema,
  personaSummary,
  type RuntimeMode,
} from "@collara/domain";
import { eq, isNotNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../errors";
import { actorFromAuthority } from "../plugins/actor";
import { presentMe } from "../presenters";
import { isLoopbackRequest } from "../recording-personas";
import { recordAudit } from "../services/audit";

export interface SessionRoutesOptions {
  readonly db: Db;
  readonly mode: RuntimeMode;
  readonly demoSessionsEnabled: boolean;
  /** DevNet recording personas: only requests that provably came from this machine (recording-personas.ts). */
  readonly loopbackOnly?: boolean;
}

/** GET /api/me */
export const meRoutes: FastifyPluginAsyncZod<{ mode: RuntimeMode }> = async (app, { mode }) => {
  app.get(
    "",
    {
      schema: {
        tags: ["session"],
        summary: "The signed-in user, active organization, roles, mandates and navigation",
        description: "Derived server-side from the session; organization or party values sent by the browser are ignored.",
        response: { 200: MeSchema },
      },
    },
    async (request) => presentMe(await request.requireActor(), mode),
  );
};

/** /api/demo/* — 404 unless DEMO_SESSIONS_ENABLED=true. Not a production authorization path. */
export const demoRoutes: FastifyPluginAsyncZod<SessionRoutesOptions> = async (app, { db, mode, demoSessionsEnabled, loopbackOnly = false }) => {
  app.addHook("onRequest", async (request) => {
    if (!demoSessionsEnabled) throw problems.unavailable();
    if (loopbackOnly && !isLoopbackRequest(request)) throw problems.unavailable();
  });

  app.get(
    "/personas",
    {
      schema: {
        tags: ["demo"],
        summary: "Seeded synthetic demo personas (demo environment only)",
        response: { 200: z.array(DemoPersonaSchema) },
      },
    },
    async () => {
      const rows = await db.select({ personaId: users.personaId }).from(users).where(isNotNull(users.personaId));
      const seeded = new Set(rows.map((row) => row.personaId));
      return Object.values(DEMO_PERSONAS)
        .filter((persona) => seeded.has(persona.id))
        .map(personaSummary);
    },
  );

  app.post(
    "/sessions",
    {
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      schema: {
        tags: ["demo"],
        summary: "Start an isolated demo session as a seeded persona (demo environment only)",
        body: DemoSessionRequestSchema,
        response: { 200: MeSchema },
      },
    },
    async (request) => {
      const personaId = PersonaIdSchema.parse(request.body.personaId);
      const [user] = await db.select().from(users).where(eq(users.personaId, personaId)).limit(1);
      if (!user || !user.isDemo) throw problems.unavailable();
      const authority = await loadUserAuthority(db, user.id);
      const actor = authority ? actorFromAuthority(authority, { personaId, authMethod: "demo" }) : null;
      if (!actor) throw problems.unavailable();
      // A fresh session id for every persona switch: nothing from the previous session carries over.
      await request.session.regenerate();
      request.session.set("userId", actor.userId);
      request.session.set("activeOrgId", actor.orgId);
      request.session.set("personaId", personaId);
      request.session.set("authMethod", "demo");
      await recordAudit(db, { actor, action: "auth.demo_session", outcome: "SUCCEEDED", requestId: request.id, detail: { personaId } }, request.log);
      return presentMe(actor, mode);
    },
  );
};
