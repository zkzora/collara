#!/usr/bin/env node
// Generates the key that encrypts the stored DevNet refresh token (AES-256-GCM in ledger_credentials): 32 random
// bytes, base64, printed ONCE to this terminal together with a key id. Put both lines into .env.devnet (git-ignored)
// or the host's secret manager; never into the database, a NEXT_PUBLIC_* variable, chat, an issue or a commit.
// Nothing is written to disk and nothing is sent anywhere.
//
//   node scripts/devnet/gen-key.mjs [--id <key id>]
//
// Rotation: keep the old pair as DEVNET_CREDENTIAL_KEY_PREVIOUS=<old id>:<old key>, put the new pair in place, restart
// the API and worker; the next refresh re-encrypts the row (docs/devnet/recovery.md §5).
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { isMain } from "./lib.mjs";

export function generateKey(now = new Date(), id) {
  const keyId = id ?? `k${now.toISOString().slice(0, 10).replace(/-/g, "")}`;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error("--id: 1-64 characters of A-Z a-z 0-9 . _ -");
  return { keyId, key: randomBytes(32).toString("base64") };
}

if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: { id: { type: "string" } } });
    const { keyId, key } = generateKey(new Date(), values.id);
    console.error("DevNet credential key (shown once; copy both lines into .env.devnet or your secret manager):\n");
    console.log(`DEVNET_CREDENTIAL_KEY_ID=${keyId}`);
    console.log(`DEVNET_CREDENTIAL_KEY=${key}`);
    console.error(
      "\nLosing this key means running node scripts/devnet/login.mjs again (the stored token cannot be decrypted).\n" +
        "Rotating: move the current pair to DEVNET_CREDENTIAL_KEY_PREVIOUS=<old id>:<old key> first (docs/devnet/recovery.md).",
    );
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
