#!/usr/bin/env node
// Fetches the JSON Ledger API OpenAPI spec from a running participant and stores it as
// openapi/canton-<version>.yaml. Run `pnpm --filter @collara/canton gen` afterwards.
//
//   node scripts/fetch-openapi.mjs [--url http://127.0.0.1:7575] [--check]
//
// --check compares the served spec with the committed file and exits 1 on drift.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: process.env.CANTON_JSON_API_URL ?? "http://127.0.0.1:7575" },
    check: { type: "boolean", default: false },
  },
});
const base = values.url.replace(/\/+$/, "");
const version = (await (await fetch(`${base}/v2/version`)).json()).version;
const response = await fetch(`${base}/docs/openapi`);
if (!response.ok) throw new Error(`GET /docs/openapi -> HTTP ${response.status}`);
const spec = (await response.text()).replace(/\r\n/g, "\n");
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "openapi", `canton-${version}.yaml`);

if (values.check) {
  const committed = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : null;
  if (committed !== spec) {
    console.error(`drift: the node serves a different spec than ${target}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${target} matches Canton ${version}`);
  }
} else {
  writeFileSync(target, spec);
  console.log(`wrote ${target} (Canton ${version}, ${spec.length} bytes)`);
}
