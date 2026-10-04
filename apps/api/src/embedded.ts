// Embedded API (API_MODE=embedded; docs/devnet/deploy-free.md): the same Fastify app, built once per cold start inside
// the Next `/api/[...path]` Route Handler, with Web Requests dispatched through Fastify's in-process injection
// (light-my-request) instead of a network hop. Routes, sessions, CSRF, idempotency and authority derivation are
// unchanged: the request goes through the full Fastify pipeline. Bodies are buffered in both directions (Vercel caps
// request bodies at 4.5 MB anyway; evidence uses presigned uploads there).
import { createPgDatabase, type DbHandle } from "@collara/db";
import type { InjectOptions } from "fastify";
import { buildApp, type BuildAppOptions, type CollaraApp } from "./app";
import { loadConfig, type Config } from "./config";

// Hop-by-hop headers (RFC 9110 §7.6.1) and headers recomputed for the injected request/response.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "expect",
]);
// Browser credentials travel only as the session cookie; never forward a browser-supplied bearer.
const DROP_REQUEST = new Set(["authorization"]);
const NO_BODY_STATUS = new Set([101, 204, 205, 304]);

/** Address the injected request appears to come from; TRUST_PROXY=loopback trusts the adapter's X-Forwarded-*. */
export const EMBEDDED_REMOTE_ADDRESS = "127.0.0.1";

/** Dispatches one Web Request through the Fastify app and returns a Web Response (cookies, status, headers, body). */
export async function dispatch(app: CollaraApp, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key) && !DROP_REQUEST.has(key)) headers[key] = value;
  });
  // The API sees the browser-facing host and scheme (Secure cookies, CSRF origin check, OIDC redirects).
  headers["x-forwarded-host"] = request.headers.get("x-forwarded-host") ?? url.host;
  headers["x-forwarded-proto"] = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");

  const method = request.method.toUpperCase() as NonNullable<InjectOptions["method"]>;
  const hasBody = method !== "GET" && method !== "HEAD" && request.body !== null;
  const payload = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;

  const response = await app.inject({
    method,
    url: url.pathname + url.search,
    headers,
    remoteAddress: EMBEDDED_REMOTE_ADDRESS,
    ...(payload && payload.byteLength > 0 ? { payload } : {}),
  });

  const out = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    const name = key.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(name)) continue;
    if (name === "set-cookie") {
      for (const cookie of Array.isArray(value) ? value : [String(value)]) out.append("set-cookie", cookie);
    } else {
      out.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    }
  }
  if (!out.has("cache-control")) out.set("cache-control", "private, no-store");
  const body = method === "HEAD" || NO_BODY_STATUS.has(response.statusCode) ? null : new Uint8Array(response.rawPayload);
  return new Response(body, { status: response.statusCode, headers: out });
}

export interface EmbeddedApi {
  readonly app: CollaraApp;
  readonly config: Config;
  readonly db: DbHandle | null;
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}

/**
 * Builds the API for in-process use. Pool size: DATABASE_POOL_MAX (default 2: one function instance serves one
 * request at a time; Supabase's transaction pooler multiplexes the rest).
 */
export async function createEmbeddedApi(
  options: { readonly env?: NodeJS.ProcessEnv; readonly db?: DbHandle | null; readonly build?: Partial<Omit<BuildAppOptions, "config" | "db">> } = {},
): Promise<EmbeddedApi> {
  const config = loadConfig(options.env ?? process.env);
  if (config.COLLARA_MODE !== "UI_MOCK" && !config.DATABASE_URL && options.db === undefined) {
    throw new Error(`COLLARA_MODE=${config.COLLARA_MODE} needs DATABASE_URL (PostgreSQL)`);
  }
  const db =
    options.db !== undefined
      ? options.db
      : config.DATABASE_URL
        ? createPgDatabase({ url: config.DATABASE_URL, max: config.DATABASE_POOL_MAX ?? 2, applicationName: "collara-api-embedded" })
        : null;
  const app = await buildApp({ apiDocs: false, ...options.build, config, db });
  await app.ready();
  return {
    app,
    config,
    db,
    handle: (request) => dispatch(app, request),
    async close() {
      await app.close();
      if (options.db === undefined) await db?.close();
    },
  };
}
