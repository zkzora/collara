#!/usr/bin/env node
// Builds the integration-test DAR (test/fixtures/it-daml) with `dpm build`.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { locateDpm } from "../../../scripts/localnet/lib.mjs";

export const IT_DAML_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "it-daml");
export const IT_DAR = join(IT_DAML_DIR, ".daml", "dist", "collara-canton-it-0.1.0.dar");

export function buildItDar() {
  const dpm = locateDpm();
  if (!dpm) throw new Error("dpm not found (install the Daml SDK or set DPM_HOME)");
  const result = spawnSync(dpm.command, ["build"], { cwd: IT_DAML_DIR, stdio: "inherit", shell: dpm.shell });
  if (result.status !== 0) throw new Error(`dpm build failed with exit code ${result.status}`);
  return IT_DAR;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(`built ${buildItDar()}`);
}
