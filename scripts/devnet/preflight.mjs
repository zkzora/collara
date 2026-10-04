#!/usr/bin/env node
// Public checks (node, readyz/livez, Canton version, OpenAPI hash vs the committed spec, OIDC discovery); with a stored credential also the ledger user, its CanActAs/CanReadAs parties, the connected synchronizers and whether every package of the upload manifest is present and vetted. Never prints a secret; works without .env.devnet.
//
//   node scripts/devnet/preflight.mjs [--json]
//
// Reads .env.devnet (copy infra/env/devnet.env.example); see docs/devnet/owner-checklist.md.
import { isMain, runDevnetCli } from "./lib.mjs";

if (isMain(import.meta.url)) {
  process.exitCode = await runDevnetCli("preflight", process.argv.slice(2), { requireEnvFile: false });
}
