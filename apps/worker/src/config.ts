import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  COLLARA_MODE: z.enum(["UI_MOCK", "LOCALNET"]).default("UI_MOCK"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WORKER_HEALTH_HOST: z.string().min(1).default("127.0.0.1"),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(4100),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const result = ConfigSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid worker configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
