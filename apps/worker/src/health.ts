import { createServer, type Server } from "node:http";
import type { WorkerConfig } from "./config";

export interface HealthInfo {
  mode: WorkerConfig["COLLARA_MODE"];
  version: string;
}

/** Liveness endpoint: `GET /healthz`. It reports that the process is up, nothing more yet. */
export function createHealthServer(info: HealthInfo): Server {
  return createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/healthz" || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const body = JSON.stringify({ status: "ok", service: "worker", mode: info.mode, version: info.version });
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  });
}
