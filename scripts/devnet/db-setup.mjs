#!/usr/bin/env node
// Creates the DEVNET database if it is missing (its name must contain "devnet"; the LocalNet databases are refused), applies the committed migrations (0000-0004, incl. ledger_credentials) and seeds the synthetic demo identities. Idempotent.
//
//   node scripts/devnet/db-setup.mjs
//
// Reads .env.devnet (copy infra/env/devnet.env.example); see docs/devnet/owner-checklist.md.
import { isMain, runDevnetCli } from "./lib.mjs";

if (isMain(import.meta.url)) {
  process.exitCode = await runDevnetCli("db-setup", process.argv.slice(2), { requireEnvFile: true });
}
