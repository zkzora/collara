// Shared helpers for the LocalNet scripts (plain Node 24, no dependencies, any shell).
// The ledger is a Canton 3.5.19 `dpm sandbox` (1, 3 or 5 participants), not Splice LocalNet.
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

export const IS_WINDOWS = process.platform === "win32";
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LOCAL_DIR = process.env.LOCALNET_DIR
  ? resolve(process.env.LOCALNET_DIR)
  : join(REPO_ROOT, ".local", "localnet");

export const FILES = {
  pid: join(LOCAL_DIR, "sandbox.pid.json"),
  ports: join(LOCAL_DIR, "ports.json"),
  state: join(LOCAL_DIR, "state.json"),
  stdout: join(LOCAL_DIR, "sandbox.out.log"),
  cantonLog: join(LOCAL_DIR, "canton.log"),
};

// --- Isolation prefixes ---------------------------------------------------------------------------
// Several builders and integration-test runs share one sandbox. A prefix gives each of them its own
// parties ("<p>-DemoManufacturer"), ledger users ("<p>-borrower-svc"), Collara namespace
// ("collara-localnet-<p>") and state file (.local/localnet/state-<p>.json). No prefix = the defaults,
// which are reserved for the final demo.

export const DEFAULT_NAMESPACE = "collara-localnet";
const PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** Validates a prefix; "" or undefined means "no prefix". */
export function normalizePrefix(prefix) {
  if (prefix === undefined || prefix === null || prefix === "") return "";
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(`invalid prefix ${JSON.stringify(prefix)}: use 1-31 lower-case letters, digits or '-', starting with a letter or digit`);
  }
  return prefix;
}

/** "<prefix>-<name>", or the name itself without a prefix. */
export const prefixed = (prefix, name) => (prefix ? `${prefix}-${name}` : name);

/** .local/localnet/state.json, or state-<prefix>.json. */
export function stateFileFor(prefix) {
  return prefix ? join(LOCAL_DIR, `state-${prefix}.json`) : FILES.state;
}

/** Default Collara namespace for a prefix. */
export function namespaceFor(prefix) {
  return prefix ? `${DEFAULT_NAMESPACE}-${prefix}` : DEFAULT_NAMESPACE;
}

export const CONFIG_FILES = {
  auth: join(REPO_ROOT, "infra", "canton", "sandbox-auth.conf"),
  extraParticipants: join(REPO_ROOT, "infra", "canton", "extra-participants.conf"),
  extraParticipants5: join(REPO_ROOT, "infra", "canton", "extra-participants-5.conf"),
  localnet: join(REPO_ROOT, "scripts", "localnet", "localnet.config.json"),
};

/** Ports reserved for the sandbox (the JSON API port is fixed by up.mjs). */
export const PORTS = {
  sandbox: { jsonApi: 7575, ledgerApi: 6865, adminApi: 6866 },
  participant2: { jsonApi: 7576, ledgerApi: 6875, adminApi: 6876 },
  participant3: { jsonApi: 7577, ledgerApi: 6885, adminApi: 6886 },
  participant4: { jsonApi: 7578, ledgerApi: 6895, adminApi: 6896 },
  participant5: { jsonApi: 7579, ledgerApi: 6905, adminApi: 6906 },
};

/** Supported participant counts and the Canton config files each one loads (after sandbox-auth.conf). */
export const TOPOLOGIES = {
  1: { participants: ["sandbox"], configs: [] },
  3: { participants: ["sandbox", "participant2", "participant3"], configs: [CONFIG_FILES.extraParticipants] },
  5: {
    participants: ["sandbox", "participant2", "participant3", "participant4", "participant5"],
    configs: [CONFIG_FILES.extraParticipants, CONFIG_FILES.extraParticipants5],
  },
};

/** State-file topology name for a participant count ("sandbox-1-participant", "sandbox-5-participants"). */
export const topologyName = (count) => (count === 1 ? "sandbox-1-participant" : `sandbox-${count}-participants`);

// Public placeholder, identical to infra/canton/sandbox-auth.conf. Dev only.
const DEFAULT_SECRET = "collara-local-dev-secret-change-me";
const DEFAULT_AUDIENCE = "https://collara.local/ledger-api";
export const ADMIN_USER = "participant_admin";

export function authSettings() {
  return {
    secret: process.env.CANTON_JWT_HMAC_SECRET || DEFAULT_SECRET,
    audience: process.env.CANTON_JWT_AUDIENCE || DEFAULT_AUDIENCE,
  };
}

/** HS256 ledger token: aud = target audience, sub = ledger user, lifetime <= 300 s. */
export function mintToken(userId, ttlSeconds = 120) {
  const { secret, audience } = authSettings();
  const b64u = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({
    aud: audience,
    sub: userId,
    iat: now,
    exp: now + Math.min(ttlSeconds, 300),
  })}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export const jsonApiUrl = (port) => `http://127.0.0.1:${port}`;

export class HttpError extends Error {
  constructor(method, path, status, body) {
    const detail = typeof body === "object" && body !== null ? `${body.code ?? ""} ${body.cause ?? ""}`.trim() : String(body ?? "");
    super(`${method} ${path} -> HTTP ${status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Minimal JSON API call. `token` is sent as a bearer token and never logged.
 * `body` may be a Buffer (sent as application/octet-stream) or a JSON value.
 */
export async function api(baseUrl, method, path, { token, body, timeoutMs = 30_000, allow = [] } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (Buffer.isBuffer(body)) {
    headers["content-type"] = "application/octet-stream";
    payload = body;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep the raw text (e.g. /readyz, plain-text 400s)
  }
  if (!response.ok && !allow.includes(response.status)) {
    throw new HttpError(method, path, response.status, parsed);
  }
  return { status: response.status, body: parsed };
}

/** GET /readyz: 200 only once the participant is connected to the synchronizer. */
export async function isReady(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(3_000) });
    await response.text();
    return response.status === 200;
  } catch {
    return false;
  }
}

export function isPortOpen(port, host = "127.0.0.1", timeoutMs = 1_000) {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host });
    const done = (open) => {
      socket.destroy();
      resolvePromise(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function removeFile(path) {
  rmSync(path, { force: true });
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Kills a process and all of its children (dpm.exe -> java.exe). */
export function killTree(pid) {
  if (!isProcessAlive(pid)) return;
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  }
}

/**
 * Finds the dpm launcher: DPM_HOME, then %APPDATA%\dpm (Windows default; not %APPDATA%\.dpm
 * as the docs claim), then ~/.dpm, then PATH. On Windows the `dpm.cmd` shim is resolved to the
 * `dpm.exe` it calls, so the process can be spawned without a shell.
 */
export function locateDpm() {
  const exeName = IS_WINDOWS ? "dpm.cmd" : "dpm";
  const homes = [
    process.env.DPM_HOME,
    IS_WINDOWS && process.env.APPDATA ? join(process.env.APPDATA, "dpm") : undefined,
    process.env.HOME ? join(process.env.HOME, ".dpm") : undefined,
  ].filter(Boolean);
  const candidates = homes.map((home) => join(home, "bin", exeName));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    const which = spawnSync(IS_WINDOWS ? "where" : "which", [IS_WINDOWS ? "dpm.cmd" : "dpm"], { encoding: "utf8" });
    const onPath = which.status === 0 ? which.stdout.split(/\r?\n/)[0]?.trim() : "";
    if (!onPath) return null;
    return shimTarget(onPath);
  }
  return shimTarget(found);
}

function shimTarget(launcher) {
  if (IS_WINDOWS && launcher.toLowerCase().endsWith(".cmd")) {
    const match = readFileSync(launcher, "utf8").match(/^\s*"?([A-Za-z]:\\[^"\r\n]*?dpm\.exe)"?\s+%\*/im);
    if (match && existsSync(match[1])) return { command: match[1], shell: false, launcher };
    return { command: launcher, shell: true, launcher };
  }
  return { command: launcher, shell: false, launcher };
}

/** Reads the Canton ports file: { participantName: { ledgerApi, adminApi, jsonApi } }. */
export function readPortsFile() {
  const ports = readJson(FILES.ports);
  if (!ports || typeof ports !== "object") return null;
  return ports;
}

/** Participants of the running sandbox as [{ name, jsonApiUrl }], "sandbox" first. */
export function participantsFromPorts(ports) {
  return Object.entries(ports)
    .filter(([, value]) => value && typeof value.jsonApi === "number")
    .map(([name, value]) => ({ name, jsonApiUrl: jsonApiUrl(value.jsonApi) }))
    .sort((a, b) => (a.name === "sandbox" ? -1 : b.name === "sandbox" ? 1 : a.name.localeCompare(b.name)));
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Reads one entry from a ZIP archive (DARs are plain ZIP files; no ZIP64). */
export function readZipEntry(buffer, entryName) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive (no end of central directory)");
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt ZIP central directory");
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString("utf8", p + 46, p + 46 + nameLength);
    if (name === entryName) {
      const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      const data = buffer.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported ZIP compression method ${method}`);
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** Name, version and main package id of a DAR, from META-INF/MANIFEST.MF. */
export function inspectDar(path) {
  const buffer = readFileSync(path);
  const manifest = readZipEntry(buffer, "META-INF/MANIFEST.MF");
  if (!manifest) throw new Error(`${path}: no META-INF/MANIFEST.MF`);
  // JAR manifests wrap long values onto continuation lines that start with one space.
  const text = manifest.toString("utf8").replace(/\r?\n /g, "");
  const field = (key) => text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
  const mainDalf = field("Main-Dalf");
  const mainPackageId = mainDalf?.match(/([0-9a-f]{64})\.dalf$/)?.[1];
  if (!mainPackageId) throw new Error(`${path}: cannot read the main package id from the manifest`);
  // `Name` is "<package-name>-<version>", e.g. "collara-contracts-0.1.0".
  const nameVersion = field("Name") ?? mainDalf.split("/").pop().replace(/-[0-9a-f]{64}\.dalf$/, "");
  const [, name = nameVersion, version = ""] = nameVersion.match(/^(.*)-(\d[\w.]*)$/) ?? [];
  return { buffer, sha256: sha256(buffer), name, version, sdkVersion: field("Sdk-Version"), mainPackageId };
}

/** Reports a fatal error. Sets the exit code instead of calling process.exit(), which can trip a
 * libuv assertion on Windows while fetch keep-alive sockets are still closing. */
export function fail(message) {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

/** True when the module is the script node was started with. */
export function isMain(importMetaUrl) {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}
