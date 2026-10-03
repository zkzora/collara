#!/usr/bin/env node
// Starts the local Canton ledger (`dpm sandbox`, Canton 3.5.19) in the background with HMAC JWT
// auth and waits until every participant's /readyz returns 200.
//
//   node scripts/localnet/up.mjs [--participants=1|3|5] [--timeout=240] [--bootstrap]
//
// Writes .local/localnet/{sandbox.pid.json, ports.json, sandbox.out.log, canton.log}.
// Stop it with `node scripts/localnet/down.mjs`. State is in memory and lost on stop.
import { mkdirSync, openSync, closeSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import {
  CONFIG_FILES,
  FILES,
  LOCAL_DIR,
  PORTS,
  TOPOLOGIES,
  fail,
  isMain,
  isPortOpen,
  isProcessAlive,
  isReady,
  killTree,
  locateDpm,
  participantsFromPorts,
  readJson,
  readPortsFile,
  removeFile,
  sleep,
  writeJsonAtomic,
} from "./lib.mjs";

export async function up({ participants = 1, timeoutSeconds = 240 } = {}) {
  const topology = TOPOLOGIES[participants];
  if (!topology) throw new Error(`--participants must be one of ${Object.keys(TOPOLOGIES).join(", ")}`);

  const previous = readJson(FILES.pid);
  if (previous && isProcessAlive(previous.pid)) {
    const ports = readPortsFile();
    const urls = ports ? participantsFromPorts(ports) : [];
    const ready = urls.length > 0 && (await Promise.all(urls.map((p) => isReady(p.jsonApiUrl)))).every(Boolean);
    if (previous.participants !== participants) {
      throw new Error(
        `a sandbox with ${previous.participants} participant(s) is already running (pid ${previous.pid}); run down.mjs first`,
      );
    }
    console.log(`sandbox already running (pid ${previous.pid}, ${ready ? "ready" : "not ready yet"})`);
    if (!ready) await waitUntilReady(previous.pid, participants, timeoutSeconds, Date.now());
    return previous;
  }
  if (previous) removeFile(FILES.pid);

  const wanted = topology.participants.map((name) => PORTS[name]);
  for (const p of wanted) {
    for (const port of [p.jsonApi, p.ledgerApi, p.adminApi]) {
      if (await isPortOpen(port)) {
        throw new Error(`port ${port} is already in use by a process not started by up.mjs; stop it first`);
      }
    }
  }

  const dpm = locateDpm();
  if (!dpm) {
    throw new Error(
      "dpm not found. Install the Daml SDK 3.5.12 (dpm 1.0.22) to %APPDATA%\\dpm, or set DPM_HOME to the dpm install directory.",
    );
  }

  mkdirSync(LOCAL_DIR, { recursive: true });
  removeFile(FILES.ports);
  const configs = ["-c", CONFIG_FILES.auth, ...topology.configs.flatMap((file) => ["-c", file])];
  const args = [
    "sandbox",
    ...configs,
    "--json-api-port",
    String(PORTS.sandbox.jsonApi),
    "--canton-port-file",
    FILES.ports,
    "--log-file-name",
    FILES.cantonLog,
  ];
  const javaOptions = process.env.LOCALNET_JDK_JAVA_OPTIONS || "-Xmx1g";
  const out = openSync(FILES.stdout, "w");
  const startedAt = Date.now();
  const child = spawn(dpm.command, args, {
    cwd: LOCAL_DIR,
    detached: true,
    shell: dpm.shell,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, JDK_JAVA_OPTIONS: javaOptions },
  });
  closeSync(out);
  if (!child.pid) throw new Error("failed to start dpm sandbox");
  child.unref();

  const record = {
    pid: child.pid,
    participants,
    startedAt: new Date(startedAt).toISOString(),
    command: `dpm sandbox ${args.join(" ")}`,
    javaOptions,
  };
  writeJsonAtomic(FILES.pid, record);
  console.log(`starting dpm sandbox (pid ${child.pid}, ${participants} participant(s), JDK_JAVA_OPTIONS=${javaOptions})`);
  console.log(`logs: ${FILES.stdout} and ${FILES.cantonLog}`);

  await waitUntilReady(child.pid, participants, timeoutSeconds, startedAt);
  return record;
}

async function waitUntilReady(pid, participants, timeoutSeconds, startedAt) {
  const deadline = startedAt + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      removeFile(FILES.pid);
      throw new Error(`sandbox exited during startup. Last output:\n${tail(FILES.stdout)}`);
    }
    const ports = readPortsFile();
    if (ports) {
      const urls = participantsFromPorts(ports);
      if (urls.length >= participants && (await Promise.all(urls.map((p) => isReady(p.jsonApiUrl)))).every(Boolean)) {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`ready after ${seconds} s`);
        for (const p of urls) console.log(`  ${p.name.padEnd(13)} JSON API ${p.jsonApiUrl}`);
        return;
      }
    }
    await sleep(1000);
  }
  killTree(pid);
  removeFile(FILES.pid);
  throw new Error(`sandbox not ready after ${timeoutSeconds} s (stopped it). Last output:\n${tail(FILES.stdout)}`);
}

function tail(path, lines = 20) {
  if (!existsSync(path)) return "(no output)";
  return readFileSync(path, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      participants: { type: "string", default: "1" },
      timeout: { type: "string", default: "240" },
      bootstrap: { type: "boolean", default: false },
    },
  });
  try {
    await up({ participants: Number(values.participants), timeoutSeconds: Number(values.timeout) });
    if (values.bootstrap) {
      const { bootstrap } = await import("./bootstrap.mjs");
      await bootstrap({});
    } else {
      console.log("next: node scripts/localnet/bootstrap.mjs");
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
