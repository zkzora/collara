import { z } from "zod";

export const CollaraModeSchema = z.enum(["UI_MOCK", "LOCALNET"]);
export type CollaraMode = z.infer<typeof CollaraModeSchema>;

/** "true"/"false"/"1"/"0" (env vars are strings). */
const envBool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => (value === undefined ? fallback : value === "true" || value === "1"));

const commaList = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(",").map((item) => item.trim()).filter(Boolean) : []));

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // UI_MOCK never claims ledger confirmation, so it is the safe default.
    COLLARA_MODE: CollaraModeSchema.default("UI_MOCK"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // postgres://user:pass@host:5432/db. Required in LOCALNET (checked in main.ts); optional for UI_MOCK.
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    // Comma-separated proxy addresses whose X-Forwarded-* headers are trusted. Unset = trust none.
    // Next.js passes a client-supplied X-Forwarded-For through unchanged (verified on 16.3.8),
    // so set this (e.g. "127.0.0.1,::1") only when a reverse proxy in front of Next rewrites it.
    // Secure cookies need it: @fastify/session only saves a Secure session when request.protocol is https.
    TRUST_PROXY: z.string().min(1).optional(),

    // Browser-facing origin (the Next app). OIDC redirect URI, post-logout target and CSRF origin check.
    PUBLIC_ORIGIN: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
    // Extra origins allowed to send cookie-authenticated mutations (comma-separated, exact match).
    CSRF_TRUSTED_ORIGINS: commaList,

    // Session cookie signing secret, >= 32 chars. Required in production; development generates an
    // ephemeral one (sessions then end on every restart).
    SESSION_SECRET: z.string().min(32).optional(),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(7 * 24 * 3600).default(8 * 3600),
    // Secure cookie → name "__Host-collara_sid"; otherwise "collara_sid" (plain-http local dev).
    COOKIE_SECURE: envBool(false),

    // Isolated demo sessions (POST /api/demo/sessions). Demo environments only, never production auth.
    DEMO_SESSIONS_ENABLED: envBool(false),

    // OIDC (Keycloak in dev; same names as scripts/infra/keycloak.mjs). Login is unavailable unless the
    // issuer and the client secret are set.
    COLLARA_OIDC_ISSUER: z.url().optional(),
    COLLARA_OIDC_CLIENT_ID: z.string().min(1).default("collara-web"),
    COLLARA_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
    // Must match the client's registered redirect URI; defaults to PUBLIC_ORIGIN + /api/auth/callback.
    COLLARA_OIDC_REDIRECT_URI: z.url().optional(),
    COLLARA_OIDC_SCOPES: z.string().min(1).default("openid email profile"),
    // Allows an http:// issuer (local Keycloak). Honoured only when NODE_ENV=development.
    COLLARA_OIDC_ALLOW_INSECURE_HTTP: envBool(false),

    // Private S3-compatible storage (SeaweedFS locally; same names as scripts/infra/seaweedfs.mjs).
    // Evidence endpoints answer 503 without it.
    COLLARA_S3_ENDPOINT: z.url().optional(),
    // Endpoint used in presigned download URLs when browsers reach storage on another host name.
    COLLARA_S3_PUBLIC_ENDPOINT: z.url().optional(),
    COLLARA_S3_REGION: z.string().min(1).default("us-east-1"),
    COLLARA_S3_BUCKET: z.string().min(3).default("collara-evidence"),
    COLLARA_S3_ACCESS_KEY: z.string().min(1).optional(),
    COLLARA_S3_SECRET_KEY: z.string().min(1).optional(),

    // LocalNet bootstrap state (party ids, topology). Defaults to <repo>/.local/localnet/state.json.
    COLLARA_LOCALNET_STATE: z.string().min(1).optional(),
    // Health: a projection checkpoint older than this is reported as degraded.
    WORKER_STALE_AFTER_SECONDS: z.coerce.number().int().min(5).default(120),

    // POST /api/pilot-requests limit per client IP (see TRUST_PROXY: behind the Next proxy alone, all
    // clients share the proxy's address and therefore one bucket).
    PILOT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
    PILOT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(10 * 60_000),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === "production" && config.DATABASE_URL && !config.SESSION_SECRET) {
      ctx.addIssue({ code: "custom", path: ["SESSION_SECRET"], message: "SESSION_SECRET is required in production" });
    }
    if (config.COLLARA_S3_ENDPOINT && !(config.COLLARA_S3_ACCESS_KEY && config.COLLARA_S3_SECRET_KEY)) {
      // SeaweedFS without credentials serves the bucket anonymously; never run storage that way.
      ctx.addIssue({ code: "custom", path: ["COLLARA_S3_ACCESS_KEY"], message: "S3 credentials are required when COLLARA_S3_ENDPOINT is set" });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `DATABASE_URL=` in .env) as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const result = ConfigSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid API configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function oidcConfigured(config: Config): config is Config & { COLLARA_OIDC_ISSUER: string; COLLARA_OIDC_CLIENT_SECRET: string } {
  return !!(config.COLLARA_OIDC_ISSUER && config.COLLARA_OIDC_CLIENT_SECRET);
}

export function oidcRedirectUri(config: Pick<Config, "COLLARA_OIDC_REDIRECT_URI" | "PUBLIC_ORIGIN">): string {
  return config.COLLARA_OIDC_REDIRECT_URI ?? new URL("/api/auth/callback", config.PUBLIC_ORIGIN).toString();
}

export function sessionCookieName(config: Pick<Config, "COOKIE_SECURE">): string {
  return config.COOKIE_SECURE ? "__Host-collara_sid" : "collara_sid";
}
