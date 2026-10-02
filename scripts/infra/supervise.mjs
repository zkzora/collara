#!/usr/bin/env node
// Internal helper for spawnDetached({ hiddenConsole: true }) in lib.mjs (Windows).
//
// Node's `detached: true` starts a process without any console (DETACHED_PROCESS). Batch files
// such as Keycloak's kc.bat run `echo ... | findstr`, which hangs without a console. This
// supervisor is the detached process; it runs the real command non-detached with windowsHide
// (CREATE_NO_WINDOW, i.e. a hidden console), passes the output through and exits with the
// command's exit code. Non-detached children sit in libuv's kill-on-close job object, so the
// command also ends if the supervisor is killed.
import { spawn } from "node:child_process";

const { command, args, verbatim } = JSON.parse(process.argv[2] ?? "{}");
if (!command) {
  console.error("usage: supervise.mjs '{\"command\":\"...\",\"args\":[...],\"verbatim\":false}'");
  process.exit(2);
}
const child = spawn(command, args ?? [], {
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
  windowsVerbatimArguments: Boolean(verbatim),
});
child.on("error", (error) => {
  console.error(`supervise: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
