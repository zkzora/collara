// Writes the OpenAPI document generated from the route Zod schemas to apps/api/openapi.json.
//   pnpm --filter @collara/api openapi:export
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { DbHandle } from "@collara/db";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

// Route registration never queries the database; any query here is a bug, so fail loudly.
const fail = (property: PropertyKey): never => {
  throw new Error(`the OpenAPI export must not use the database (accessed ${String(property)})`);
};
const unusedDb: DbHandle = {
  kind: "pg",
  db: new Proxy({} as DbHandle["db"], { get: (_target, property) => fail(property) }),
  migrate: async () => fail("migrate"),
  ping: async () => fail("ping"),
  close: async () => undefined,
};

const config = loadConfig({ NODE_ENV: "test", COLLARA_MODE: "LOCALNET", SESSION_SECRET: "openapi-export-only-secret-0123456789", LOG_LEVEL: "silent" });
const app = await buildApp({ config, db: unusedDb, storage: null, oidc: null, logger: false });
await app.ready();
const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
await writeFile(target, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`wrote ${target}`);
