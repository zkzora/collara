// Collara worker entry point. UI_MOCK: health endpoint only. LOCALNET: projection of every participant source
// (ledger updates → ledger_* tables), command status advancement (PROJECTED / PROJECTION_DELAYED),
// UNKNOWN_OUTCOME reconciliation from command completions and the export job runner (runtime.ts).
// Restart-safe: all progress is in PostgreSQL; SIGINT/SIGTERM stop the loops, then close the pool.
import { createRequire } from "node:module";
import { once } from "node:events";
import { createPgDatabase, type DbHandle } from "@collara/db";
import pino, { type LoggerOptions } from "pino";
import packageJson from "../package.json" with { type: "json" };
import { loadConfig } from "./config";
import { createHealthServer, type HealthDetails } from "./health";
import { connectLedger, LedgerNotBootstrappedError, type WorkerLedger } from "./ledger";
import { startRuntime, type WorkerRuntime } from "./runtime";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const CONNECT_RETRY_MS = 10_000;

const config = loadConfig();

const logOptions: LoggerOptions = { level: config.LOG_LEVEL, base: { service: "worker" } };
if (config.NODE_ENV === "development" && process.stdout.isTTY) {
  logOptions.transport = { target: createRequire(import.meta.url).resolve("pino-pretty") };
}
const log = pino(logOptions);

const controller = new AbortController();
let dbHandle: DbHandle | null = null;
let runtime: WorkerRuntime | null = null;
let startupProblem: string | null = null;

const details =
  config.COLLARA_MODE === "LOCALNET"
    ? async (): Promise<HealthDetails> => (runtime ? runtime.health() : { degraded: true, phase: "starting", error: startupProblem })
    : undefined;
const server = createHealthServer({ mode: config.COLLARA_MODE, version: packageJson.version, ...(details ? { details } : {}) });

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals | "startup-failure", exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  const timer = setTimeout(() => {
    log.error("graceful shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();
  controller.abort();
  // In-flight database transactions finish or roll back; the checkpoint only moves with a committed update.
  if (runtime) await runtime.done;
  if (dbHandle) await dbHandle.close().catch((err: unknown) => log.error({ err }, "error closing database pool"));
  server.closeAllConnections();
  server.close((err) => {
    if (err) log.error({ err }, "error closing health server");
    process.exit(err ? 1 : exitCode);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

server.listen(config.WORKER_HEALTH_PORT, config.WORKER_HEALTH_HOST);
try {
  await once(server, "listening");
} catch (err) {
  log.fatal({ err }, "failed to start health server");
  process.exit(1);
}
const health = `http://${config.WORKER_HEALTH_HOST}:${config.WORKER_HEALTH_PORT}/healthz`;

/** Waits for the LocalNet bootstrap state (a worker started before `localnet:bootstrap` keeps polling). */
async function connectWithRetry(): Promise<WorkerLedger | null> {
  while (!controller.signal.aborted) {
    try {
      return await connectLedger(config);
    } catch (error) {
      if (!(error instanceof LedgerNotBootstrappedError)) throw error;
      startupProblem = error.message;
      log.warn({ retryInMs: CONNECT_RETRY_MS }, error.message);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, CONNECT_RETRY_MS);
        controller.signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
      });
    }
  }
  return null;
}

if (config.COLLARA_MODE === "LOCALNET") {
  try {
    // DATABASE_URL is required in LOCALNET (config validation).
    dbHandle = createPgDatabase({ url: config.DATABASE_URL ?? "", max: 5, applicationName: "collara-worker" });
    if (config.WORKER_MIGRATE) {
      await dbHandle.migrate();
      log.info("migrations applied");
    }
    const ledger = await connectWithRetry();
    if (ledger) {
      runtime = startRuntime({ config, db: dbHandle.db, ledger, log, signal: controller.signal });
      startupProblem = null;
      log.info(
        { mode: config.COLLARA_MODE, health, sources: ledger.sources.map((s) => s.config.source), workerId: config.WORKER_ID },
        "Collara worker ready: projection, reconciliation and export jobs running",
      );
    }
  } catch (err) {
    startupProblem = err instanceof Error ? err.message : String(err);
    log.fatal({ err }, "worker startup failed");
    void shutdown("startup-failure", 1);
  }
} else {
  log.info({ mode: config.COLLARA_MODE, health }, "Collara worker ready (UI_MOCK: no ledger jobs)");
}
