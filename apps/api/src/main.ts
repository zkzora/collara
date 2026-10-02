import { createPgDatabase, type DbHandle } from "@collara/db";
import { buildApp } from "./app";
import { loadConfig } from "./config";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
if (config.COLLARA_MODE === "LOCALNET" && !config.DATABASE_URL) {
  console.error("COLLARA_MODE=LOCALNET needs DATABASE_URL (PostgreSQL). See .env.example.");
  process.exit(1);
}

// Migrations are applied explicitly (pnpm --filter @collara/api db:migrate), never on boot.
const db: DbHandle | null = config.DATABASE_URL ? createPgDatabase({ url: config.DATABASE_URL, applicationName: "collara-api" }) : null;
const app = await buildApp({ config, db });
if (!db) app.log.warn("DATABASE_URL is not set: serving health and docs only (UI_MOCK)");

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  const timer = setTimeout(() => {
    app.log.error("graceful shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();
  try {
    await app.close();
    await db?.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ mode: config.COLLARA_MODE }, "Collara API ready");
} catch (err) {
  app.log.fatal({ err }, "failed to start");
  await db?.close().catch(() => undefined);
  process.exit(1);
}
