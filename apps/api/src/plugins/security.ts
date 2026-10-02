// Response hardening and cross-site request protection.
//
// CSRF approach (cookie-authenticated API, same-origin through the Next proxy):
//   1. The session cookie is SameSite=Lax, so browsers do not attach it to cross-site POST/PUT/DELETE.
//   2. Every unsafe method is checked with Fetch Metadata: `Sec-Fetch-Site` must be `same-origin` (or
//      `none`, a user-initiated navigation). Browsers set this header and pages cannot forge it.
//   3. Older browsers without Fetch Metadata: if an `Origin` header is present it must be PUBLIC_ORIGIN,
//      one of CSRF_TRUSTED_ORIGINS, or the request's own host. Requests with neither header are not from a
//      browser page (curl, server-side fetch) and carry no ambient browser credentials, so they pass.
// This is the same scheme as Go's net/http CrossOriginProtection; no token round trip is needed and the
// typed API client works unchanged. The Next proxy forwards Sec-Fetch-* and Origin headers as received.
import helmet from "@fastify/helmet";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "../config";
import { problems } from "../errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function crossOriginRejection(request: Pick<FastifyRequest, "method" | "headers">, trustedOrigins: ReadonlySet<string>): string | null {
  if (SAFE_METHODS.has(request.method)) return null;
  const site = request.headers["sec-fetch-site"];
  if (typeof site === "string") {
    return site === "same-origin" || site === "none" ? null : `cross-site request (sec-fetch-site: ${site})`;
  }
  const origin = request.headers.origin;
  if (typeof origin !== "string") return null;
  if (trustedOrigins.has(origin)) return null;
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  try {
    if (typeof host === "string" && new URL(origin).host === host) return null;
  } catch {
    // An unparseable Origin (including "null") is treated as cross-site.
  }
  return `untrusted origin ${origin}`;
}

async function securityPlugin(app: FastifyInstance, { config }: { config: Config }) {
  await app.register(helmet, {
    // JSON API: nothing may be framed or embedded; the docs UI sets its own CSP on its static routes.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    // Helmet's default HSTS only matters over HTTPS; keep it on when cookies are secure.
    strictTransportSecurity: config.COOKIE_SECURE ? undefined : false,
  });

  const trusted = new Set([new URL(config.PUBLIC_ORIGIN).origin, ...config.CSRF_TRUSTED_ORIGINS]);
  app.addHook("onRequest", async (request) => {
    const reason = crossOriginRejection(request, trusted);
    if (reason) {
      request.log.warn({ reason }, "rejected cross-site request");
      throw problems.forbidden("Cross-site requests are not accepted.");
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    // Every API response is private unless a route explicitly says otherwise.
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "private, no-store");
    reply.header("vary", "Cookie");
    return payload;
  });
}

export const security = fp(securityPlugin, { name: "collara-security" });
