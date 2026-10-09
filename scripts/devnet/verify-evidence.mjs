#!/usr/bin/env node
// Read-only: checks every recorded command receipt of this DEVNET database against the participant's own update
// stream and reads the final contracts (pledge released, no active lock). Optional: --out docs/devnet/evidence/receipts.json
// writes the non-secret receipts (update ids, offsets, template names, record times).
//
//   node scripts/devnet/verify-evidence.mjs [--out <file>]
import { resolve } from "node:path";
import { isMain, runDevnetCli } from "./lib.mjs";

/** The CLI runs from apps/api; resolve --out against the caller's directory instead. */
function absoluteOut(args) {
  return args.map((arg, i) => (args[i - 1] === "--out" ? resolve(process.cwd(), arg) : arg));
}

if (isMain(import.meta.url)) {
  process.exitCode = await runDevnetCli("verify-evidence", absoluteOut(process.argv.slice(2)), { requireEnvFile: true });
}
