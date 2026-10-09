#!/usr/bin/env node
// LOCAL screen recording on DevNet: starts the worker, the API and the web app with demo persona sessions enabled
// for loopback requests only (apps/api/src/recording-personas.ts), so one operator can switch between the synthetic
// roles while recording. Never use it for hosting.
//
//   node scripts/devnet/record.mjs [--env-file <file>] [--state <file>] [--build] [--no-web]
//
// - Every server binds 127.0.0.1; the API refuses to start with the opt-in on any other HOST, behind a trusted
//   proxy, on Vercel or in production, and answers 404 to any request that is not loopback end to end.
// - DEVNET_RECORDING_PERSONAS is passed to the child processes only. It is never written to .env.devnet (which is
//   the file you copy to a host), and this script deletes it from the inherited environment first.
// - --env-file selects another DEVNET env file (default .env.devnet or COLLARA_DEVNET_ENV_FILE); --state selects the
//   DevNet state file (COLLARA_DEVNET_STATE) so a recording can replay a recorded run namespace.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ENV_FILE, REPO_ROOT } from "./lib.mjs";

const { values } = parseArgs({
  options: {
    "env-file": { type: "string" },
    state: { type: "string" },
    build: { type: "boolean", default: false },
    "no-web": { type: "boolean", default: false },
  },
});

const envFile = resolve(values["env-file"] ?? ENV_FILE);
if (!existsSync(envFile)) {
  console.error(`error: ${envFile} not found (copy infra/env/devnet.env.example to .env.devnet and fill it in).`);
  process.exit(2);
}

const WEB_PORT = 3000;
const API_PORT = 4000;
const WORKER_PORT = 4100;

/** The parent environment without anything the env file defines (Node's --env-file never overrides) and without LocalNet or hosting variables. */
function baseEnv() {
  const env = { ...process.env };
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key) delete env[key];
  }
  for (const key of ["COLLARA_LOCALNET_STATE", "CANTON_JWT_HMAC_SECRET", "TRUST_PROXY", "API_MODE", "VERCEL", "DEVNET_RECORDING_PERSONAS", "NODE_ENV"]) delete env[key];
  if (values.state) env.COLLARA_DEVNET_STATE = resolve(values.state);
  return env;
}

const serverEnv = {
  ...baseEnv(),
  COLLARA_MODE: "DEVNET",
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  PORT: String(API_PORT),
  WORKER_PORT: String(WORKER_PORT),
  PUBLIC_ORIGIN: `http://localhost:${WEB_PORT}`,
  API_INTERNAL_ORIGIN: `http://127.0.0.1:${API_PORT}`,
  PUBLIC_DEMO_STATUS: "off",
  DEVNET_RECORDING_PERSONAS: "true",
};

// Next must build and run with NODE_ENV=production; the API and worker run as development so session cookies work over http://localhost.
const webEnv = { ...serverEnv, NODE_ENV: "production" };

const requireFrom = (dir) => createRequire(join(REPO_ROOT, dir, "package.json"));
const tsxCli = requireFrom("apps/api").resolve("tsx/cli");
const children = [];

function start(name, args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (chunk) => String(chunk).split(/\r?\n/).filter(Boolean).forEach((line) => console.log(`[${name}] ${line.slice(0, 220)}`));
  child.stdout.on("data", tag);
  child.stderr.on("data", tag);
  child.on("exit", (code) => {
    console.log(`[${name}] exited (${code})`);
    shutdown(code === 0 ? 0 : 1);
  });
  children.push(child);
}

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 500).unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(0));

async function waitFor(url, label, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until && !closing) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  console.error(`error: ${label} did not come up at ${url}`);
  return false;
}

if (!values["no-web"]) {
  const webDir = join(REPO_ROOT, "apps", "web");
  const nextBin = requireFrom("apps/web").resolve("next/dist/bin/next");
  if (values.build || !existsSync(join(webDir, ".next", "BUILD_ID"))) {
    console.log("building the web app (COLLARA_MODE=DEVNET)…");
    const built = spawnSync(process.execPath, [nextBin, "build"], { cwd: webDir, env: webEnv, stdio: "inherit" });
    if (built.status !== 0) process.exit(built.status ?? 1);
  }
  start("web", [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(WEB_PORT)], webDir, webEnv);
}
start("worker", [tsxCli, `--env-file=${envFile}`, "src/main.ts"], join(REPO_ROOT, "apps", "worker"), serverEnv);
start("api", [tsxCli, `--env-file=${envFile}`, "src/main.ts"], join(REPO_ROOT, "apps", "api"), serverEnv);

const apiUp = await waitFor(`http://127.0.0.1:${API_PORT}/api/system/health`, "the API");
const personas = apiUp ? await fetch(`http://127.0.0.1:${API_PORT}/api/demo/personas`, { headers: { host: `localhost:${API_PORT}` } }).then((r) => r.status).catch(() => 0) : 0;
if (!apiUp || personas !== 200) {
  console.error(`error: the recording personas are not available (API ${apiUp ? `/api/demo/personas -> ${personas}` : "down"}). See the [api] lines above.`);
  shutdown(1);
} else {
  if (!values["no-web"] && !(await waitFor(`http://127.0.0.1:${WEB_PORT}/login`, "the web app"))) shutdown(1);
  else {
    console.log("");
    console.log("DevNet recording session is ready (loopback only):");
    console.log(`  open  http://localhost:${WEB_PORT}/login   (use localhost, not 127.0.0.1: the CSRF origin check expects PUBLIC_ORIGIN)`);
    console.log("  Stop with Ctrl+C. Do not expose these ports (no tunnels, no port forwarding): the API answers 404 to anything that is not loopback.");
  }
}
