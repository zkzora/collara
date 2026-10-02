// OIDC login (Authorization Code + PKCE S256). Browser navigations: errors redirect to /login?error=…
// rather than returning JSON. Users are matched by (issuer, subject), or once by a verified email of a
// pre-provisioned user; unknown users go to /access-pending (invite-only pilot).
import { loadUserAuthority, users, type Db, type UserRow } from "@collara/db";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { oidcRedirectUri, sessionCookieName, type Config } from "../config";
import { recordAudit } from "../services/audit";
import { PendingLoginSchema, safeReturnTo, type OidcIdentity, type OidcService } from "../services/oidc";

/** Login error codes passed to the web app as /login?error=<code>. */
export const LOGIN_ERRORS = ["oidc_unavailable", "callback_failed"] as const;

const PENDING_LOGIN_MAX_AGE_MS = 10 * 60_000;

export interface AuthRoutesOptions {
  readonly config: Config;
  readonly db: Db;
  readonly oidc: OidcService | null;
  readonly clock: () => Date;
}

/** (issuer, subject) first; otherwise link a verified email to a pre-provisioned user with no OIDC identity yet. */
export async function matchOidcUser(db: Db, identity: OidcIdentity, now: Date): Promise<UserRow | null> {
  const [bySubject] = await db
    .select()
    .from(users)
    .where(and(eq(users.oidcIssuer, identity.issuer), eq(users.oidcSubject, identity.subject)))
    .limit(1);
  if (bySubject) return bySubject.disabledAt ? null : bySubject;
  if (!identity.email || !identity.emailVerified) return null;
  const [linked] = await db
    .update(users)
    .set({ oidcIssuer: identity.issuer, oidcSubject: identity.subject, emailVerified: true, updatedAt: now })
    .where(and(eq(users.email, identity.email), isNull(users.oidcSubject), isNull(users.disabledAt)))
    .returning();
  return linked ?? null;
}

function redirect(reply: FastifyReply, path: string) {
  return reply.code(302).header("location", path).send();
}

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, { config, db, oidc, clock }) => {
  app.get(
    "/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Start OIDC login (302 to the identity provider)",
        querystring: z.object({ returnTo: z.string().max(512).optional() }),
      },
    },
    async (request, reply) => {
      if (!oidc) return redirect(reply, "/login?error=oidc_unavailable");
      try {
        const { url, pending } = await oidc.startLogin(safeReturnTo(request.query.returnTo));
        request.session.set("oidc", pending);
        return redirect(reply, url.toString());
      } catch (err) {
        request.log.error({ err }, "OIDC login could not start");
        return redirect(reply, "/login?error=oidc_unavailable");
      }
    },
  );

  app.get(
    "/callback",
    {
      schema: {
        tags: ["auth"],
        summary: "OIDC redirect target: exchanges the code, rotates the session, redirects into the app",
        querystring: z.record(z.string(), z.string()),
      },
    },
    async (request, reply) => {
      const pending = PendingLoginSchema.safeParse(request.session.get("oidc"));
      if (!oidc || !pending.success || clock().getTime() - pending.data.startedAt > PENDING_LOGIN_MAX_AGE_MS) {
        return redirect(reply, "/login?error=callback_failed");
      }
      // The provider redirected the browser to the registered redirect URI (on the Next proxy's origin).
      const callbackUrl = new URL(oidcRedirectUri(config));
      callbackUrl.search = request.raw.url?.split("?")[1] ?? "";
      let identity: OidcIdentity;
      try {
        identity = await oidc.completeLogin(callbackUrl, pending.data);
      } catch (err) {
        request.log.warn({ errName: err instanceof Error ? err.name : "unknown" }, "OIDC callback rejected");
        await endSession(request, reply);
        return redirect(reply, "/login?error=callback_failed");
      }
      return finishLogin(request, reply, identity, pending.data.returnTo);
    },
  );

  /** Deletes the session row and clears the cookie (@fastify/session does not clear it on destroy). */
  async function endSession(request: FastifyRequest, reply: FastifyReply) {
    await request.session.destroy();
    reply.clearCookie(sessionCookieName(config), { path: "/" });
  }

  async function finishLogin(request: FastifyRequest, reply: FastifyReply, identity: OidcIdentity, returnTo: string) {
    const now = clock();
    const user = await matchOidcUser(db, identity, now);
    const authority = user ? await loadUserAuthority(db, user.id) : null;
    if (!user || !authority?.org || authority.roles.length === 0) {
      // No session for unknown or unapproved accounts; the pending PKCE state is dropped with it.
      await endSession(request, reply);
      await recordAudit(db, { action: "auth.login", outcome: "DENIED", requestId: request.id, detail: { reason: user ? "no_active_membership" : "unknown_user" } }, request.log);
      return redirect(reply, "/access-pending");
    }
    // Rotate the session id on login; the pending PKCE state is dropped with the old id.
    await request.session.regenerate();
    request.session.set("userId", user.id);
    request.session.set("activeOrgId", authority.org.id);
    request.session.set("authMethod", "oidc");
    if (identity.idToken) request.session.set("idToken", identity.idToken);
    await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
    await recordAudit(db, { actor: { userId: user.id, orgId: authority.org.id }, action: "auth.login", outcome: "SUCCEEDED", requestId: request.id }, request.log);
    return redirect(reply, safeReturnTo(returnTo));
  }

  app.post(
    "/logout",
    {
      schema: {
        tags: ["auth"],
        summary: "End the session (and return the provider's end-session URL for OIDC sessions)",
        response: { 200: z.object({ loggedOut: z.literal(true), endSessionUrl: z.string().nullable() }) },
      },
    },
    async (request, reply) => {
      const session = request.session;
      const wasOidc = session.get("authMethod") === "oidc";
      const idToken = session.get("idToken") ?? null;
      const userId = session.get("userId");
      const orgId = session.get("activeOrgId");
      const endSessionUrl = wasOidc && oidc ? await oidc.endSessionUrl(idToken).catch(() => null) : null;
      await endSession(request, reply);
      if (userId && orgId) {
        await recordAudit(db, { actor: { userId, orgId }, action: "auth.logout", outcome: "SUCCEEDED", requestId: request.id }, request.log);
      }
      return { loggedOut: true as const, endSessionUrl: endSessionUrl?.toString() ?? null };
    },
  );
};
