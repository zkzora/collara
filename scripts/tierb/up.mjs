#!/usr/bin/env node
// Starts Tier B inside WSL: Canton (fresh, in-memory: 1 sequencer, 1 mediator, 3 participants) and three
// dec-party-manager v1.12.0 nodes. Also starts a WSL keepalive so the distro is not shut down while idle.
//   node scripts/tierb/up.mjs
import { join } from "node:path";
import { runningService, spawnDetached, writeJson } from "../infra/lib.mjs";
import { DISTRO, IS_WINDOWS, TIERB_DIR, fail, writeState, wslScript } from "./lib.mjs";

const KEEPALIVE_PID = join(TIERB_DIR, "keepalive.pid.json");

if (IS_WINDOWS && !runningService(KEEPALIVE_PID, "sleep infinity")) {
  const child = spawnDetached("wsl.exe", ["-d", DISTRO, "--exec", "sleep", "infinity"], {
    logFile: join(TIERB_DIR, "keepalive.log"),
    env: { ...process.env, WSL_UTF8: "1" },
  });
  writeJson(KEEPALIVE_PID, { pid: child.pid, distro: DISTRO, startedAt: new Date().toISOString() });
  console.log(`WSL keepalive started (pid ${child.pid})`);
}

const result = wslScript("infra/tierb/ctl.sh", { args: ["up"], timeoutMs: 15 * 60_000 });
if (result.status !== 0) fail(`tierb up failed (exit ${result.status})`);
// A fresh Canton means fresh participant ids: forget everything from the previous topology.
writeState({ startedAt: new Date().toISOString(), participants: undefined, decParty: undefined, decPartyEntry: undefined, members: undefined, governance: undefined, scenario: undefined });
console.log("Tier B up. Next: node scripts/tierb/onboard.mjs");
