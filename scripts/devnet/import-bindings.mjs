#!/usr/bin/env node
// Matches the parties created in the DevNet Console to the eleven Collara hints (tenant prefix tolerated), refuses on a missing, ambiguous or read-only party with the exact list, then writes .local/devnet/state.json and the DEVNET database bindings. Never allocates parties.
//
//   node scripts/devnet/import-bindings.mjs [--run-ref <ref>]
//
// Reads .env.devnet (copy infra/env/devnet.env.example); see docs/devnet/owner-checklist.md.
import { isMain, runDevnetCli } from "./lib.mjs";

if (isMain(import.meta.url)) {
  process.exitCode = await runDevnetCli("import-bindings", process.argv.slice(2), { requireEnvFile: true });
}
