#!/usr/bin/env node
// Installs the Tier B runtime inside WSL (see infra/tierb/install.sh): JRE 21, Canton OSS 3.5.19 (sha256 checked)
// and dec-party-manager v1.12.0 from the public ECR image (index, manifest and layer digests checked).
//   node scripts/tierb/install.mjs [--keep-downloads]
import { REPO_WSL, TIERB_DIR, fail, wslScript } from "./lib.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

mkdirSync(join(TIERB_DIR, "downloads"), { recursive: true });
const keep = process.argv.includes("--keep-downloads");
const result = wslScript("infra/tierb/install.sh", {
  env: { TIERB_DOWNLOADS: `${REPO_WSL}/.local/tierb/downloads`, KEEP_DOWNLOADS: keep ? "1" : "0" },
});
if (result.status !== 0) fail(`install failed (exit ${result.status})`);
