#!/usr/bin/env node
// After a DevNet reset or pruning, a lost/revoked credential, a lost key or a lost database: read-only diagnosis that prints which case applies and the exact next commands (exit 0 = nothing to recover, 2 = a case applies, 1 = error). With --new-run --yes (worker and API stopped): new run namespace collara-devnet-<runRef>, reset of the DEVNET database's "devnet" projection source only, bindings re-imported, clean-start bootstrap. Idempotent; never allocates parties, never touches other teams' data.
//
//   node scripts/devnet/recover.mjs [--json]
//   node scripts/devnet/recover.mjs --new-run --yes [--run-ref <ref>]
//
// Reads .env.devnet (copy infra/env/devnet.env.example); see docs/devnet/recovery.md.
import { isMain, runDevnetCli } from "./lib.mjs";

if (isMain(import.meta.url)) {
  process.exitCode = await runDevnetCli("recover", process.argv.slice(2), { requireEnvFile: true });
}
