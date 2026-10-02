#!/usr/bin/env node
// Creates <repo>/.env from .env.example and fills the empty dev secrets with random values.
//
//   node scripts/dev/init-env.mjs [--file=<path>]
//
// Safe to re-run: existing values are never changed. A secret that is empty gets a value; a secret
// missing from an existing file is appended. Only variable names are printed, never values.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT, parseCommand } from "../infra/lib.mjs";

// base64url values need no quoting in .env files, URLs or the Keycloak realm JSON.
const SECRETS = {
  SESSION_SECRET: 32,
  COLLARA_OIDC_CLIENT_SECRET: 24,
  KC_BOOTSTRAP_ADMIN_PASSWORD: 18,
  COLLARA_S3_SECRET_KEY: 24,
};
const generate = (bytes) => randomBytes(bytes).toString("base64url");

const { flags } = parseCommand(process.argv.slice(2), ["init"], "init");
const target = typeof flags.file === "string" ? resolve(flags.file) : join(REPO_ROOT, ".env");
const created = !existsSync(target);
const lines = readFileSync(created ? join(REPO_ROOT, ".env.example") : target, "utf8").split(/\r?\n/);

const filled = [];
const present = new Set();
const updated = lines.map((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match || !(match[1] in SECRETS)) return line;
  present.add(match[1]);
  if (match[2].trim() !== "") return line;
  filled.push(match[1]);
  return `${match[1]}=${generate(SECRETS[match[1]])}`;
});
const missing = Object.keys(SECRETS).filter((name) => !present.has(name));
if (missing.length > 0) {
  if (updated.at(-1) === "") updated.pop();
  updated.push("", "# Added by scripts/dev/init-env.mjs (random, dev-only).");
  for (const name of missing) updated.push(`${name}=${generate(SECRETS[name])}`);
  updated.push("");
  filled.push(...missing);
}

if (created || filled.length > 0) writeFileSync(target, updated.join("\n"), { mode: 0o600 });
console.log(created ? `created ${target} from .env.example` : `using existing ${target}`);
console.log(filled.length > 0 ? `generated: ${filled.join(", ")}` : "all dev secrets already set; nothing changed");
