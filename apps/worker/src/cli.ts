// Operator commands for the projection (LOCALNET). Same env as the worker (DATABASE_URL,
// COLLARA_LOCALNET_STATE, CANTON_JSON_API_URL, …).
//
//   pnpm --filter @collara/worker projection:status                    per-source checkpoint, ledger end, lag, reset state
//   pnpm --filter @collara/worker projection:once [-- --source s]      one synchronous projection pass per source
//   pnpm --filter @collara/worker projection:reset -- --source s --yes  rebuild a source from offset 0 (after a ledger reset)
//
// A reset deletes the source's projected contracts/events/updates (command records are kept) and re-points the
// source at the participant id the ledger reports now. Never needed for a normal restart.
import { parseArgs } from "node:util";
import { createPgDatabase, ledgerCheckpoints, projectOnce, resetProjectionSource } from "@collara/db";
import { loadConfig } from "./config";
import { connectLedger } from "./ledger";

const USAGE = "usage: cli.ts <status | once | reset> [--source <alias>] [--yes]";

async function main() {
  const { positionals, values } = parseArgs({
    // `pnpm run <script> -- --flag` forwards the separator itself.
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    allowPositionals: true,
    options: { source: { type: "string" }, yes: { type: "boolean", default: false } },
  });
  const command = positionals[0];
  if (!command || !["status", "once", "reset"].includes(command)) throw new Error(USAGE);
  const config = loadConfig({ ...process.env, COLLARA_MODE: process.env.COLLARA_MODE === "DEVNET" ? "DEVNET" : "LOCALNET" });
  const handle = createPgDatabase({ url: config.DATABASE_URL ?? "", max: 2, applicationName: "collara-worker-cli" });
  try {
    const ledger = await connectLedger(config, handle.db);
    const wanted = ledger.sources.filter((s) => !values.source || s.config.source === values.source);
    if (values.source && wanted.length === 0) throw new Error(`unknown source ${values.source}; known: ${ledger.sources.map((s) => s.config.source).join(", ")}`);

    if (command === "status") {
      const rows = await ledgerCheckpoints(handle.db);
      for (const { config: source, client } of wanted) {
        const row = rows.find((r) => r.source === source.source);
        const [end, participant] = await Promise.all([client.ledgerEnd().catch(() => null), client.participantId().catch(() => null)]);
        console.log(
          JSON.stringify({
            source: source.source,
            status: row?.status ?? "NOT_STARTED",
            checkpoint: row?.checkpointOffset ?? 0,
            ledgerEnd: end,
            lag: end === null ? null : Math.max(0, end - (row?.checkpointOffset ?? 0)),
            lastAppliedAt: row?.lastAppliedAt ?? null,
            projectedParticipant: row?.participantId ?? null,
            ledgerParticipant: participant,
            resetReason: row?.resetReason ?? null,
            lastError: row?.lastError ?? null,
          }),
        );
      }
      return;
    }

    if (command === "once") {
      for (const { config: source, client } of wanted) {
        const result = await projectOnce(handle.db, client, source, {
          pageLimit: config.PROJECTION_PAGE_LIMIT,
          projectionDelaySeconds: config.PROJECTION_DELAY_SECONDS,
        });
        console.log(JSON.stringify(result));
      }
      return;
    }

    if (!values.source) throw new Error("reset needs --source <alias>");
    if (!values.yes) throw new Error(`reset deletes the projection of ${values.source} and rebuilds it from offset 0; add --yes to confirm`);
    const target = wanted[0];
    if (!target) throw new Error(`unknown source ${values.source}`);
    const participantId = await target.client.participantId();
    const summary = await resetProjectionSource(handle.db, target.config.source, { participantId, jsonApiUrl: target.config.jsonApiUrl });
    console.log(JSON.stringify({ ...summary, participantId, next: "the running worker (or `projection:once`) rebuilds it from offset 0" }));
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
