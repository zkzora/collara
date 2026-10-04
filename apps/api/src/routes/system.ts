import type { DbHandle } from "@collara/db";
import { ledgerCheckpoints } from "@collara/db";
import { isLedgerMode, SystemHealthSchema, type SystemHealth } from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { CollaraMode } from "../config";
import { databaseCheck, storageCheck, workerCheck, type HealthCheck } from "../services/health";
import type { StorageService } from "../services/storage";

export interface SystemRoutesOptions {
  mode: CollaraMode;
  version: string;
  db: DbHandle | null;
  storage: StorageService | null;
  /** Ledger reachability + exact topology (LOCALNET only). */
  probeLedger: () => Promise<HealthCheck>;
  workerStaleAfterSeconds: number;
  /** "on-request": no persistent worker; the embedded API projects around requests (reported in the worker check). */
  workerMode?: "process" | "on-request";
  clock: () => Date;
}

export const systemRoutes: FastifyPluginAsyncZod<SystemRoutesOptions> = async (app, opts) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Sanitized infrastructure status",
        description:
          "Always 200; `status` is `unavailable` when the database is down, `degraded` when storage, ledger or the projection worker is. In UI_MOCK without a database only the mode is reported.",
        response: { 200: SystemHealthSchema },
      },
    },
    async () => {
      const checks: Record<string, HealthCheck> = {};
      const localnet = isLedgerMode(opts.mode);
      if (opts.db) checks.database = await databaseCheck(opts.db);
      if (localnet || opts.storage) checks.storage = await storageCheck(opts.storage);
      if (localnet) {
        checks.ledger = await opts.probeLedger();
        if (opts.db && checks.database?.status === "ok") {
          const sources = await ledgerCheckpoints(opts.db.db);
          const check = workerCheck(sources, opts.clock(), opts.workerStaleAfterSeconds);
          checks.worker =
            opts.workerMode === "on-request"
              ? { ...check, detail: `On-request sync (no persistent worker; the projection advances only while the app is used). ${check.detail ?? ""}`.trim() }
              : check;
        } else {
          checks.worker = { status: "unavailable", detail: "Projection state needs the database." };
        }
      }
      const status: SystemHealth["status"] =
        checks.database?.status === "unavailable" || (localnet && !opts.db)
          ? "unavailable"
          : Object.values(checks).every((check) => check.status === "ok")
            ? "ok"
            : "degraded";
      return { status, mode: opts.mode, version: opts.version, checks };
    },
  );
};
