import { createServer, type Server } from "node:http";
import type { WorkerConfig } from "./config";

export interface HealthInfo {
  mode: WorkerConfig["COLLARA_MODE"];
  version: string;
  /**
   * LOCALNET: per-source projection state and loop status, merged into the body. Returning `degraded: true`
   * reports `status: "degraded"` (still HTTP 200: the process is alive; readers decide what degraded means).
   */
  details?: () => Promise<HealthDetails>;
}

export interface HealthDetails {
  readonly degraded: boolean;
  readonly [key: string]: unknown;
}

const DETAILS_TIMEOUT_MS = 2_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`health details timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** `GET /healthz`: liveness, plus (LOCALNET) per-source checkpoint, lag, last applied time and reset state. */
export function createHealthServer(info: HealthInfo): Server {
  return createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/healthz" || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const base = { service: "worker", mode: info.mode, version: info.version };
    const send = (body: Record<string, unknown>) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    };
    if (!info.details) {
      send({ status: "ok", ...base });
      return;
    }
    withTimeout(info.details(), DETAILS_TIMEOUT_MS).then(
      ({ degraded, ...details }) => send({ status: degraded ? "degraded" : "ok", ...base, ...details }),
      (error: unknown) => send({ status: "degraded", ...base, error: error instanceof Error ? error.message : String(error) }),
    );
  });
}
