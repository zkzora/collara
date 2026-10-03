// Shared helpers for the Tier B scripts (plain Node 24, no dependencies). Tier B runs inside WSL Ubuntu:
// Canton open-source (1 sequencer, 1 mediator, 3 participants in one JVM) plus three DLC-link
// Decentralization Manager (`dec-party-manager` v1.12.0) nodes, one per participant. One local operator runs
// every node; this demonstrates the mechanism, not independent operators.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const IS_WINDOWS = process.platform === "win32";
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TIERB_DIR = join(REPO_ROOT, ".local", "tierb");
export const RECEIPTS_DIR = join(TIERB_DIR, "receipts");
export const STATE_FILE = join(TIERB_DIR, "state.json");
export const DISTRO = process.env.COLLARA_WSL_DISTRO || "Ubuntu";
/** Extracted runtime on the WSL ext4 disk (Canton jar, DM binary, node data, logs). */
export const RUNTIME = process.env.TIERB_RUNTIME || "/opt/collara-tierb";

/** synthesis §4.2 port map. Host ports are reachable from Windows through WSL localhost forwarding. */
export const NODES = [
  { name: "p1", ledger: 5001, admin: 5002, json: 7585, dmHttp: 8081, dmNoise: 9001, dmMetrics: 9464 },
  { name: "p2", ledger: 5011, admin: 5012, json: 7586, dmHttp: 8082, dmNoise: 9002, dmMetrics: 9465 },
  { name: "p3", ledger: 5021, admin: 5022, json: 7587, dmHttp: 8083, dmNoise: 9003, dmMetrics: 9466 },
];

/** Windows path -> /mnt/<drive>/... for WSL. Leaves POSIX paths alone. */
export function toWslPath(path) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  if (!m) return path;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replaceAll("\\", "/")}`;
}

export const REPO_WSL = toWslPath(REPO_ROOT);

export function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

/**
 * Runs a bash script from the repo inside WSL as root. `env` values are passed through `env` so nothing depends
 * on WSLENV. Output is inherited unless `capture` is set.
 */
export function wslScript(scriptRel, { args = [], env = {}, capture = false, timeoutMs = 30 * 60_000 } = {}) {
  const script = `${REPO_WSL}/${scriptRel}`;
  const envArgs = Object.entries({ REPO_WSL, TIERB_RUNTIME: RUNTIME, ...env }).map(([k, v]) => `${k}=${v}`);
  const cmd = IS_WINDOWS ? "wsl.exe" : "env";
  const cmdArgs = IS_WINDOWS
    ? ["-d", DISTRO, "-u", "root", "--cd", "/", "--exec", "env", ...envArgs, "bash", script, ...args]
    : [...envArgs, "bash", script, ...args];
  const result = spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, WSL_UTF8: "1", MSYS_NO_PATHCONV: "1" },
    windowsHide: true,
    timeout: timeoutMs,
  });
  if (result.error) throw result.error;
  return result;
}

export function readState() {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
}

export function writeState(patch) {
  mkdirSync(TIERB_DIR, { recursive: true });
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function writeReceipt(name, data) {
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  const file = join(RECEIPTS_DIR, name.endsWith(".json") ? name : `${name}.json`);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
