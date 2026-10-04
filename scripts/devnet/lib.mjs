// Shared helpers of scripts/devnet/*.mjs (plain Node 24, no dependencies; PowerShell, cmd and Git Bash).
// The credentialed steps run the TypeScript CLI apps/api/src/devnet/cli.ts with the API's tsx, COLLARA_MODE=DEVNET
// and the DEVNET env file (.env.devnet at the repo root, never .env, so LocalNet settings are not picked up).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEVNET_DIR = join(REPO_ROOT, ".local", "devnet");
export const DARS_DIR = join(DEVNET_DIR, "dars");
export const MANIFEST_JSON = join(REPO_ROOT, "docs", "devnet", "upload-manifest.json");
/** The DEVNET env file (gitignored; copy infra/env/devnet.env.example). Override with COLLARA_DEVNET_ENV_FILE. */
export const ENV_FILE = process.env.COLLARA_DEVNET_ENV_FILE ?? join(REPO_ROOT, ".env.devnet");

/** Lists the entry names of a ZIP archive (DARs are plain ZIP files; no ZIP64). */
export function listZipEntries(buffer) {
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
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt ZIP central directory");
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    names.push(buffer.toString("utf8", p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** Non-SDK packages embedded in a DAR ({ name, version, packageId }), from its .dalf entry names. */
export function embeddedPackages(buffer) {
  const result = [];
  for (const entry of listZipEntries(buffer)) {
    const file = entry.split("/").pop() ?? "";
    const match = file.match(/^(.+)-(\d[\w.]*)-([0-9a-f]{64})\.dalf$/);
    if (!match) continue;
    const [, name, version, packageId] = match;
    if (name.startsWith("daml-prim") || name.startsWith("daml-stdlib")) continue;
    result.push({ name, version, packageId });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** The committed upload manifest (docs/devnet/upload-manifest.json), or null. */
export function readManifest() {
  return existsSync(MANIFEST_JSON) ? JSON.parse(readFileSync(MANIFEST_JSON, "utf8")) : null;
}

/** Runs `apps/api/src/devnet/cli.ts <command> [args]` with tsx in DEVNET mode; resolves with the exit code. */
export function runDevnetCli(command, args = [], { requireEnvFile = true } = {}) {
  const require = createRequire(join(REPO_ROOT, "apps", "api", "package.json"));
  const tsxCli = require.resolve("tsx/cli");
  const hasEnv = existsSync(ENV_FILE);
  if (requireEnvFile && !hasEnv) {
    console.error(`error: ${ENV_FILE} not found. Copy infra/env/devnet.env.example to .env.devnet and fill it in (docs/devnet/owner-checklist.md).`);
    return Promise.resolve(2);
  }
  // COLLARA_MODE is forced; LocalNet-only variables from the parent shell are dropped so they can never leak in.
  const env = { ...process.env, COLLARA_MODE: "DEVNET" };
  delete env.COLLARA_LOCALNET_STATE;
  delete env.CANTON_JWT_HMAC_SECRET;
  // Node's --env-file never overrides variables already in the environment: drop the ones the file defines, so the
  // DEVNET file wins over a LocalNet DATABASE_URL exported in the shell.
  if (hasEnv) {
    for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
      if (key && key !== "COLLARA_MODE") delete env[key];
    }
  }
  const child = spawn(
    process.execPath,
    [tsxCli, ...(hasEnv ? [`--env-file=${ENV_FILE}`] : []), join(REPO_ROOT, "apps", "api", "src", "devnet", "cli.ts"), command, ...args],
    { cwd: join(REPO_ROOT, "apps", "api"), stdio: "inherit", env, windowsHide: false },
  );
  return new Promise((resolvePromise) => {
    child.on("exit", (code, signal) => resolvePromise(signal ? 1 : (code ?? 1)));
    child.on("error", (error) => {
      console.error(`error: ${error.message}`);
      resolvePromise(1);
    });
  });
}

/** True when the module is the script node was started with. */
export function isMain(importMetaUrl) {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}
