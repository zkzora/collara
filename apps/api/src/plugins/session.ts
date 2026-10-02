// Server-side sessions in PostgreSQL behind an HttpOnly, SameSite=Lax cookie. Tokens never reach the
// browser. The session id is rotated on every login (regenerate) and the row is deleted on logout.
import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import type { Db } from "@collara/db";
import type { PersonaId } from "@collara/domain";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { sessionCookieName, type Config } from "../config";
import type { PendingLogin } from "../services/oidc";
import { PgSessionStore } from "../services/session-store";

declare module "fastify" {
  interface Session {
    userId?: string;
    activeOrgId?: string;
    /** Demo sessions only. */
    personaId?: PersonaId;
    authMethod?: "oidc" | "demo";
    /** Between /api/auth/login and /api/auth/callback. */
    oidc?: PendingLogin;
    /** Kept server-side for RP-initiated logout (id_token_hint). */
    idToken?: string;
  }
}

export interface SessionPluginOptions {
  readonly config: Config;
  readonly db: Db;
  readonly clock?: () => Date;
}

async function sessionPlugin(app: FastifyInstance, { config, db, clock }: SessionPluginOptions) {
  let secret = config.SESSION_SECRET;
  if (!secret) {
    if (config.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
    secret = randomBytes(32).toString("base64url");
    if (config.NODE_ENV === "development") {
      app.log.warn("SESSION_SECRET is not set; using an ephemeral secret (sessions end when the API restarts)");
    }
  }
  const store = new PgSessionStore(db, config.SESSION_TTL_SECONDS, clock);
  app.decorate("pgSessionStore", store);
  // Expired rows are also removed lazily on read; this keeps abandoned ones from accumulating.
  const pruneTimer = setInterval(() => {
    store.prune().catch((err: unknown) => app.log.warn({ err }, "session prune failed"));
  }, 60 * 60_000);
  pruneTimer.unref();
  app.addHook("onClose", async () => clearInterval(pruneTimer));

  await app.register(cookie);
  await app.register(session, {
    secret,
    cookieName: sessionCookieName(config),
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.COOKIE_SECURE,
      maxAge: config.SESSION_TTL_SECONDS * 1000,
    },
    // No cookie until something is stored (login state or an authenticated session).
    saveUninitialized: false,
    // Absolute lifetime from login; avoids a store write on every request.
    rolling: false,
    store,
  });
}

declare module "fastify" {
  interface FastifyInstance {
    pgSessionStore: PgSessionStore;
  }
}

export const sessions = fp(sessionPlugin, { name: "collara-sessions" });
