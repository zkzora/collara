import { createRequire } from "node:module";
import type { LoggerOptions } from "pino";
import type { Config } from "./config";

const CENSOR = "[redacted]";

/** Object keys that must never reach logs, at the top level or one level down. */
const SENSITIVE_KEYS = [
  // credentials and tokens
  "authorization",
  "cookie",
  "password",
  "secret",
  "client_secret",
  "token",
  "access_token",
  "accessToken",
  "id_token",
  "idToken",
  "refresh_token",
  "refreshToken",
  "code_verifier",
  "codeVerifier",
  "SESSION_SECRET",
  "COLLARA_OIDC_CLIENT_SECRET",
  "COLLARA_S3_SECRET_KEY",
  // financing terms (borrower and selected lender only)
  "principal",
  "requestedPrincipal",
  "terms",
  "financingTerms",
];

/** Header values and sensitive fields that must never reach logs. */
export const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  "headers.authorization",
  "headers.cookie",
  'headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
];

/** Query parameters redacted from logged URLs (OIDC callback codes and state). */
const SENSITIVE_QUERY = new Set(["code", "state", "session_state", "token", "id_token_hint", "iss"]);

export function redactUrl(url: string): string {
  const index = url.indexOf("?");
  if (index === -1) return url;
  const params = new URLSearchParams(url.slice(index + 1));
  let changed = false;
  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY.has(key)) {
      params.set(key, CENSOR);
      changed = true;
    }
  }
  return changed ? `${url.slice(0, index)}?${params.toString()}` : url;
}

interface LoggedRequest {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
  id?: string;
}

export function loggerOptions(config: Pick<Config, "LOG_LEVEL" | "NODE_ENV">): LoggerOptions {
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: CENSOR },
    serializers: {
      // Fastify's default request serializer logs the raw URL, which would include OIDC codes.
      req: (req: LoggedRequest) => ({
        method: req.method,
        url: req.url ? redactUrl(req.url) : undefined,
        host: req.hostname,
        remoteAddress: req.ip,
      }),
    },
  };
  // Human-readable logs only in an interactive dev terminal; JSON everywhere else.
  if (config.NODE_ENV === "development" && process.stdout.isTTY) {
    const require = createRequire(import.meta.url);
    options.transport = { target: require.resolve("pino-pretty") };
  }
  return options;
}
