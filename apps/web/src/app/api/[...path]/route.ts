import type { NextRequest } from "next/server";

/**
 * Same-origin `/api/*` proxy to the Fastify API (ADR-0001 §2.9, research-webstack §7.3).
 * The upstream origin is read per request, so one build works in every environment.
 * Bodies are streamed in both directions (no 10 MB rewrite cap).
 */
export const dynamic = "force-dynamic";

const DEFAULT_API_ORIGIN = "http://127.0.0.1:4000";
const UPSTREAM_TIMEOUT_MS = 60_000;

// Hop-by-hop headers (RFC 9110 §7.6.1), plus headers fetch must set itself or rejects (`expect`).
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
  "host",
  "content-length",
  "expect",
]);
// Browser credentials travel only as the session cookie; never forward a browser-supplied bearer.
const DROP_REQUEST = new Set(["authorization"]);
// fetch() already decoded the body, so the upstream encoding/length no longer apply.
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "set-cookie"]);

function connectionTokens(headers: Headers): Set<string> {
  return new Set(
    (headers.get("connection") ?? "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "private, no-store" } });
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const origin = process.env.API_INTERNAL_ORIGIN || DEFAULT_API_ORIGIN;
  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, origin);

  const skip = connectionTokens(request.headers);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key) && !DROP_REQUEST.has(key) && !skip.has(key)) headers.set(key, value);
  });
  // x-forwarded-for: Next fills it from the socket only when absent and otherwise keeps the
  // client's value, so it is client-controlled here. The API ignores it unless TRUST_PROXY is set.
  headers.set("x-forwarded-host", request.headers.get("host") ?? request.nextUrl.host);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));

  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    duplex: hasBody ? "half" : undefined,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
  };

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return jsonError(504, "upstream_timeout");
    }
    return jsonError(502, "upstream_unavailable");
  }

  const responseSkip = connectionTokens(upstream.headers);
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key) && !DROP_RESPONSE.has(key) && !responseSkip.has(key)) {
      responseHeaders.set(key, value);
    }
  });
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie);
  if (!responseHeaders.has("cache-control")) responseHeaders.set("cache-control", "private, no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export {
  proxy as DELETE,
  proxy as GET,
  proxy as HEAD,
  proxy as OPTIONS,
  proxy as PATCH,
  proxy as POST,
  proxy as PUT,
};
