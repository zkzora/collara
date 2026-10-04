#!/usr/bin/env node
// After bootstrap: prints the first committed command's update id and offset, and the AssetRegistry and CollaraConfig contract ids the registrar party sees in the active contract set (ids only, no secrets).
//
//   node scripts/devnet/verify-first-tx.mjs
//
// Reads .env.devnet (copy infra/env/devnet.env.example); see docs/devnet/owner-checklist.md.
import { isMain, runDevnetCli } from "./lib.mjs";

if (isMain(import.meta.url)) {
  process.exitCode = await runDevnetCli("verify-first-tx", process.argv.slice(2), { requireEnvFile: true });
}
