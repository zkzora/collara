#!/usr/bin/env node
// Seeds the LocalNet ledger and the application database through the API's own workflow runner
// (apps/api/src/seed/localnet.ts). Cross-shell wrapper: runs the TypeScript CLI with the API's tsx and
// the repo .env.
//
//   node scripts/localnet/seed.mjs [--profile main|clean-start] [--prefix <p>] [--database-url <url>]
//                                  [--state <file>] [--skip-documents] [--force-new-namespace] [--json]
//
// Without --prefix it seeds the default namespace and DATABASE_URL: that is the final demo's namespace.
// Builders and tests use --prefix (state-<p>.json; database collara_<p> unless --database-url is given).
// Re-running is safe: every step replays its stored outcome. A namespace seeded by another database is
// refused unless --force-new-namespace (which moves to a fresh namespace; nothing is wiped).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, fail, isMain } from "./lib.mjs";

export function seedCommand(args) {
  const require = createRequire(join(REPO_ROOT, "apps", "api", "package.json"));
  const tsxCli = require.resolve("tsx/cli");
  const envFile = join(REPO_ROOT, ".env");
  return {
    command: process.execPath,
    args: [tsxCli, ...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), join(REPO_ROOT, "apps", "api", "src", "seed", "cli.ts"), ...args],
  };
}

if (isMain(import.meta.url)) {
  const { command, args } = seedCommand(process.argv.slice(2));
  const child = spawn(command, args, { cwd: join(REPO_ROOT, "apps", "api"), stdio: "inherit", windowsHide: true });
  child.on("exit", (code, signal) => {
    if (signal) fail(`seed stopped by ${signal}`);
    else process.exitCode = code ?? 1;
  });
  child.on("error", (error) => fail(error.message));
}
