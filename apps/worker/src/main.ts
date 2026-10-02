import { createRequire } from "node:module";
import { once } from "node:events";
import pino, { type LoggerOptions } from "pino";
import packageJson from "../package.json" with { type: "json" };
import { loadConfig } from "./config";
import { createHealthServer } from "./health";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();

const logOptions: LoggerOptions = { level: config.LOG_LEVEL, base: { service: "worker" } };
if (config.NODE_ENV === "development" && process.stdout.isTTY) {
  logOptions.transport = { target: createRequire(import.meta.url).resolve("pino-pretty") };
}
const log = pino(logOptions);

const server = createHealthServer({ mode: config.COLLARA_MODE, version: packageJson.version });

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  const timer = setTimeout(() => {
    log.error("graceful shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();
  // Job loops (projection, reconciliation, exports) will be stopped here before the server closes.
  server.closeAllConnections();
  server.close((err) => {
    if (err) log.error({ err }, "error closing health server");
    process.exit(err ? 1 : 0);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

server.listen(config.WORKER_HEALTH_PORT, config.WORKER_HEALTH_HOST);
try {
  await once(server, "listening");
  log.info(
    { mode: config.COLLARA_MODE, health: `http://${config.WORKER_HEALTH_HOST}:${config.WORKER_HEALTH_PORT}/healthz` },
    "Collara worker ready (no jobs registered yet)",
  );
} catch (err) {
  log.fatal({ err }, "failed to start health server");
  process.exit(1);
}
