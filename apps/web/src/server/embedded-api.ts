import "server-only";
import { createEmbeddedApi, type EmbeddedApi } from "@collara/api/embedded";
import { connectOnRequestSync, type OnRequestSync } from "@collara/worker/on-request";

/**
 * API_MODE=embedded (docs/devnet/deploy-free.md): the Fastify API runs inside this Next server (one build per cold
 * start, reused across requests of the same function instance). With WORKER_MODE=on-request it also owns the bounded
 * projection pass that a persistent worker would otherwise run.
 */
interface Embedded {
  readonly api: EmbeddedApi;
  readonly sync: OnRequestSync | null;
}

type SyncLog = Parameters<typeof connectOnRequestSync>[0]["log"];

const globalKey = Symbol.for("collara.embeddedApi");
type GlobalWithApi = typeof globalThis & { [globalKey]?: Promise<Embedded> };

async function build(): Promise<Embedded> {
  const api = await createEmbeddedApi();
  let sync: OnRequestSync | null = null;
  if (api.config.WORKER_MODE === "on-request" && api.db && api.config.COLLARA_MODE !== "UI_MOCK") {
    sync = await connectOnRequestSync({
      env: process.env,
      db: api.db.db,
      // Fastify's logger is the API's redacting pino instance.
      log: api.app.log as unknown as SyncLog,
      budgetMs: positiveInt(process.env.ON_REQUEST_SYNC_BUDGET_MS, 8_000),
      minIntervalMs: positiveInt(process.env.ON_REQUEST_SYNC_MIN_INTERVAL_MS, 3_000),
    });
  }
  return { api, sync };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function embeddedApi(): Promise<Embedded> {
  const holder = globalThis as GlobalWithApi;
  if (!holder[globalKey]) {
    holder[globalKey] = build().catch((error: unknown) => {
      // A failed build (bad config, unreachable database) is retried on the next request, not cached.
      delete holder[globalKey];
      throw error;
    });
  }
  return holder[globalKey];
}

const NO_SYNC_PREFIXES = ["/api/system/", "/api/auth/", "/api/demo/", "/api/pilot-requests", "/api/cron/"];

/** Workspace reads are served after a bounded sync; health, auth and public endpoints never wait for the ledger. */
export function syncBeforeRead(method: string, pathname: string): boolean {
  return (method === "GET" || method === "HEAD") && !NO_SYNC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Mutations trigger a pass after the response (command states, projection), within the function's lifetime. */
export function syncAfterMutation(method: string, pathname: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !NO_SYNC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
