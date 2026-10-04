#!/usr/bin/env node
// Runs the seed (clean-start = B1-B8, or main = also M1-M18) through the API's workflow runner on the DevNet state: idempotent per run namespace collara-devnet-<runRef>, never allocates parties. Re-running replays the stored outcomes.
//
//   node scripts/devnet/bootstrap.mjs [--profile clean-start|main] [--skip-documents] [--json]
//
// Reads .env.devnet (copy infra/env/devnet.env.example); see docs/devnet/owner-checklist.md.
import { isMain, runDevnetCli } from "./lib.mjs";

if (isMain(import.meta.url)) {
  process.exitCode = await runDevnetCli("bootstrap", process.argv.slice(2), { requireEnvFile: true });
}
