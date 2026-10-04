import { hostname } from "node:os";
import { DevnetEnvSchema, devnetGuardIssues, publicEnvKeyLeaks } from "@collara/canton";
import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const csv = z.string().transform((v) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);

/** Public dev placeholder of infra/canton/sandbox-auth.conf (unsafe-jwt-hmac-256). Never used in production. */
export const DEV_HMAC_SECRET = "collara-local-dev-secret-change-me";

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    COLLARA_MODE: z.enum(["UI_MOCK", "LOCALNET", "DEVNET"]).default("UI_MOCK"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    WORKER_HEALTH_HOST: z.string().min(1).default("127.0.0.1"),
    /** WORKER_PORT is accepted as an alias (and wins when both are set). */
    WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(4100),
    /** Identifies this worker in job leases (default host:pid). */
    WORKER_ID: z.string().min(1).max(200).default(`${hostname()}:${process.pid}`),

    // --- LOCALNET only ---------------------------------------------------------------------------
    DATABASE_URL: z.string().min(1).optional(),
    /** Apply the committed migrations on start (default false: the API owns migrations). */
    WORKER_MIGRATE: bool.default(false),
    /** Path of the bootstrap state (.local/localnet/state.json or state-<prefix>.json). */
    COLLARA_LOCALNET_STATE: z.string().min(1).optional(),
    /** Overrides the JSON API URL of a single-participant state. */
    CANTON_JSON_API_URL: z.url().optional(),
    CANTON_JWT_HMAC_SECRET: z.string().min(16).optional(),
    CANTON_JWT_AUDIENCE: z.string().min(1).optional(),
    /** Ledger user the projection reads with (default: the state's projector user of each participant). */
    PROJECTOR_USER: z.string().min(1).optional(),
    /** Participant sources to project (default: every participant in the state). */
    PROJECTION_SOURCES: csv.optional(),
    /** Parties to read as (default: the projector user's readAs from the state). */
    PROJECTION_PARTIES: csv.optional(),
    PROJECTION_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
    PROJECTION_PAGE_LIMIT: z.coerce.number().int().min(1).max(1_000).default(200),
    /** COMMITTED commands unprojected for longer than this become PROJECTION_DELAYED. */
    PROJECTION_DELAY_SECONDS: z.coerce.number().int().min(1).max(3_600).default(5),
    RECONCILE_INTERVAL_MS: z.coerce.number().int().min(100).max(600_000).default(5_000),
    JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(600_000).default(2_000),
    JOB_LEASE_SECONDS: z.coerce.number().int().min(5).max(3_600).default(120),
    JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),

    // --- DEVNET only (docs/devnet.md): the shared participant through the tenant user's OIDC refresh token ----------
    ...DevnetEnvSchema.shape,
    /** DEVNET: how often /healthz re-runs the read-only recovery diagnosis (rights, packages, pruning, reset). */
    DEVNET_RECOVERY_CHECK_INTERVAL_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(300_000),
  })
  .superRefine((config, ctx) => {
    if (config.COLLARA_MODE === "DEVNET") {
      for (const issue of devnetGuardIssues(config)) ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
      if (!config.DEVNET_LEDGER_USER_ID) ctx.addIssue({ code: "custom", path: ["DEVNET_LEDGER_USER_ID"], message: "DEVNET_LEDGER_USER_ID is required in DEVNET" });
      return;
    }
    if (config.COLLARA_MODE !== "LOCALNET") return;
    if (!config.DATABASE_URL) ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "DATABASE_URL is required in LOCALNET" });
    if (config.NODE_ENV === "production" && !config.CANTON_JWT_HMAC_SECRET) {
      ctx.addIssue({ code: "custom", path: ["CANTON_JWT_HMAC_SECRET"], message: "CANTON_JWT_HMAC_SECRET is required in production (no dev placeholder)" });
    }
  });

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const cleaned: Record<string, string> = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== ""),
  );
  // WORKER_PORT (the name used in the docs and briefs) wins over WORKER_HEALTH_PORT (the .env template's name).
  if (cleaned.WORKER_PORT) cleaned.WORKER_HEALTH_PORT = cleaned.WORKER_PORT;
  const result = ConfigSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid worker configuration:\n${z.prettifyError(result.error)}`);
  }
  const leaks = publicEnvKeyLeaks(cleaned);
  if (leaks.length) throw new Error(`Invalid worker configuration:\n${leaks.map((name) => `${name}: must not carry DEVNET_CREDENTIAL_KEY (server-only secret)`).join("\n")}`);
  return result.data;
}
