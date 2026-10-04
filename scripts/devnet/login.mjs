#!/usr/bin/env node
// Owner only, in your own terminal: prompts for the team login (password hidden), runs one password grant, validates the token and stores ONLY the refresh token in the DEVNET database (ledger_credentials). Prints the ledger user id and the access-token expiry, never a secret.
//
//   node scripts/devnet/login.mjs
//
// Reads .env.devnet (copy infra/env/devnet.env.example); see docs/devnet/owner-checklist.md.
import { isMain, runDevnetCli } from "./lib.mjs";

if (isMain(import.meta.url)) {
  process.exitCode = await runDevnetCli("login", process.argv.slice(2), { requireEnvFile: true });
}
