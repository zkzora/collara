// Shared helpers for the local infrastructure scripts (plain Node 24, no dependencies, any shell).
// Runtime state lives under <repo>/.local (git-ignored).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const IS_WINDOWS = process.platform === "win32";
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LOCAL_DIR = join(REPO_ROOT, ".local");
export const DOWNLOADS_DIR = join(LOCAL_DIR, "downloads");

/** Loads <repo>/.env like `node --env-file-if-exists`: variables already set in the shell win. */
export function loadDotEnv() {
  const file = join(REPO_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Trimmed environment value; empty strings count as unset. */
export function env(name, fallback) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** Exits with a clear message when any of `names` is unset. Values are never printed. */
export function requireEnv(names) {
  const missing = names.filter((name) => !env(name));
  if (missing.length > 0) {
    fail(
      `missing ${missing.join(", ")}. Set them in the shell or in .env at the repo root ` +
        "(`node scripts/dev/init-env.mjs` creates .env with generated dev-only values).",
    );
  }
  return Object.fromEntries(names.map((name) => [name, env(name)]));
}

export const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * Downloads `url` to `dest` unless a file with the expected SHA-256 is already there.
 * The file is written to `<dest>.part` and only renamed after the checksum matches.
 */
export async function fetchVerified({ url, sha256, dest }) {
  if (existsSync(dest) && (await sha256File(dest)) === sha256) {
    console.log(`using cached ${dest} (sha256 ok)`);
    return dest;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  console.log(`downloading ${url}${total ? ` (${(total / 1e6).toFixed(1)} MB)` : ""}`);
  const hash = createHash("sha256");
  let received = 0;
  let nextReport = 0.25;
  const part = `${dest}.part`;
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        received += chunk.length;
        if (total && received / total >= nextReport) {
          console.log(`  ${Math.round((received / total) * 100)}%`);
          nextReport += 0.25;
        }
        yield chunk;
      }
    },
    createWriteStream(part),
  );
  const actual = hash.digest("hex");
  if (actual !== sha256) {
    rmSync(part, { force: true });
    throw new Error(`checksum mismatch for ${url}: expected sha256 ${sha256}, got ${actual}`);
  }
  renameSync(part, dest);
  console.log(`sha256 verified: ${actual}`);
  return dest;
}

/** Extracts a zip with the OS tool: bsdtar (System32\tar.exe) on Windows, `unzip` elsewhere. */
export function extractZip(zipFile, destDir) {
  mkdirSync(destDir, { recursive: true });
  const result = IS_WINDOWS
    ? spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zipFile, "-C", destDir], {
        stdio: "inherit",
      })
    : spawnSync("unzip", ["-q", "-o", zipFile, "-d", destDir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`could not extract ${zipFile} (exit ${result.status ?? result.error?.message})`);
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Command line of a running process, or null. Used to make sure a pid file still points at our process. */
export function processCommandLine(pid) {
  if (!Number.isInteger(pid) || !isAlive(pid)) return null;
  const result = IS_WINDOWS
    ? spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { encoding: "utf8", windowsHide: true },
      )
    : spawnSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" });
  const text = result.stdout?.trim();
  return result.status === 0 && text ? text : null;
}

/** Kills a process and its children (taskkill /T /F on Windows, the process group elsewhere). */
export function killTree(pid) {
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

/**
 * Pid-file record of a detached service. `marker` is a substring of the expected command line;
 * a pid whose command line does not contain it belongs to someone else (pid reuse) and is ignored.
 */
export function runningService(pidFile, marker) {
  const record = readJson(pidFile);
  if (!record || !Number.isInteger(record.pid)) return null;
  const commandLine = processCommandLine(record.pid);
  if (!commandLine || !commandLine.toLowerCase().includes(marker.toLowerCase())) return null;
  return record;
}

/**
 * Kills the recorded process tree and waits (up to 15 s) until the process is gone and its
 * loopback `ports` stop accepting (Windows keeps a dead listener open for a second or two).
 */
export async function stopService(pidFile, marker, name, { ports = [] } = {}) {
  const record = runningService(pidFile, marker);
  if (record) {
    killTree(record.pid);
    const closed = async () => !isAlive(record.pid) && !(await Promise.all(ports.map((p) => tcpOpen("127.0.0.1", p, 500)))).includes(true);
    const gone = await waitFor(closed, { timeoutMs: 15_000, intervalMs: 250 });
    console.log(gone ? `${name} stopped (pid ${record.pid})` : `${name}: pid ${record.pid} is still shutting down`);
  } else {
    console.log(`${name} is not running`);
  }
  rmSync(pidFile, { force: true });
}

/**
 * Starts a detached background process with stdout/stderr in `logFile`.
 * Returns the pid and a function telling whether the process has already exited.
 * `hiddenConsole` (Windows): run through supervise.mjs so the command gets a hidden console;
 * needed for batch files that pipe into findstr (kc.bat). The pid is then the supervisor's.
 */
export function spawnDetached(command, args, { logFile, env: childEnv, cwd, verbatim = false, hiddenConsole = false }) {
  if (hiddenConsole && IS_WINDOWS) {
    const supervisor = join(REPO_ROOT, "scripts", "infra", "supervise.mjs");
    const spec = JSON.stringify({ command, args, verbatim });
    return spawnDetached(process.execPath, [supervisor, spec], { logFile, env: childEnv, cwd });
  }
  mkdirSync(dirname(logFile), { recursive: true });
  const out = openSync(logFile, "w");
  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
    env: childEnv,
    cwd,
  });
  closeSync(out);
  let exitCode;
  child.on("exit", (code) => {
    exitCode = code ?? -1;
  });
  child.unref();
  return { pid: child.pid, exited: () => exitCode !== undefined, exitCode: () => exitCode };
}

export function tailFile(path, lines = 25) {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** Polls `check` until it returns a truthy value; gives up after `timeoutMs` or when `abort()` is true. */
export async function waitFor(check, { timeoutMs, intervalMs = 1000, abort = () => false }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    if (abort()) return null;
    await sleep(intervalMs);
  }
  return null;
}

export function tcpOpen(host, port, timeoutMs = 2000) {
  return new Promise((resolveOpen) => {
    const socket = connect({ host, port });
    const done = (open) => {
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

/** GET (or `init.method`) returning { status, text }, or null when the server cannot be reached. */
export async function httpRequest(url, init = {}) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000), ...init });
    return { status: response.status, headers: response.headers, text: await response.text() };
  } catch {
    return null;
  }
}

/** Loads a dependency installed in a workspace package (e.g. "apps/api"), or returns null. */
export function requireFromWorkspace(packageDir, id) {
  try {
    return createRequire(join(REPO_ROOT, packageDir, "package.json"))(id);
  } catch {
    return null;
  }
}

/** Parses `<script> <command> [--flag[=value]]...`. */
export function parseCommand(argv, commands, fallback) {
  const [first, ...rest] = argv;
  const command = first && !first.startsWith("--") ? first : fallback;
  const flags = Object.fromEntries(
    [...(first?.startsWith("--") ? [first] : []), ...rest].map((arg) => {
      const [key, ...value] = arg.replace(/^--/, "").split("=");
      return [key, value.length ? value.join("=") : true];
    }),
  );
  if (!commands.includes(command)) fail(`unknown command "${command}". Use one of: ${commands.join(", ")}`);
  return { command, flags };
}
