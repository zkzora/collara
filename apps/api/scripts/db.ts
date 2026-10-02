// Database operations for local environments (run through tsx, see package.json):
//   pnpm --filter @collara/api db:migrate         apply committed SQL migrations
//   pnpm --filter @collara/api db:seed            demo organizations, users, memberships, mandates
//   pnpm --filter @collara/api db:bind-localnet   party bindings, ledger users and sources from
//                                                 .local/localnet/state.json (after each LocalNet bootstrap)
// Options: --database-url <postgres://…> (default DATABASE_URL), --state <path> (bind-localnet only).
import { parseArgs } from "node:util";
import { loadLocalnetState } from "@collara/canton";
import { createPgDatabase, importLocalnetState, seedDemoIdentities } from "@collara/db";

const COMMANDS = ["migrate", "seed", "bind-localnet"] as const;
type Command = (typeof COMMANDS)[number];

const { positionals, values } = parseArgs({
  // pnpm forwards a literal "--" separator; drop it so options after it still parse.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  allowPositionals: true,
  options: { "database-url": { type: "string" }, state: { type: "string" } },
});
const command = positionals[0] as Command | undefined;
if (!command || !COMMANDS.includes(command)) {
  console.error(`usage: db.ts <${COMMANDS.join("|")}> [--database-url postgres://…] [--state path]`);
  process.exit(2);
}
const url = values["database-url"] ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (or pass --database-url).");
  process.exit(2);
}

const handle = createPgDatabase({ url, max: 1, applicationName: `collara-${command}` });
try {
  switch (command) {
    case "migrate":
      await handle.migrate();
      console.log("migrations applied");
      break;
    case "seed":
      console.log("seeded", await seedDemoIdentities(handle.db));
      break;
    case "bind-localnet": {
      const state = await loadLocalnetState(values.state);
      if (!state) throw new Error("no LocalNet bootstrap state found; run node scripts/localnet/bootstrap.mjs first");
      const summary = await importLocalnetState(handle.db, state);
      console.log(JSON.stringify(summary, null, 2));
      if (summary.sources.some((s) => s.reset)) console.warn("ledger reset detected: the worker must rebuild projections for the flagged sources");
      break;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
