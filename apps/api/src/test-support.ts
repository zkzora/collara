// Test helpers (imported only by *.test.ts): PGlite database with migrations + demo seed, app factory,
// cookie handling for app.inject.
import { Writable } from "node:stream";
import { createPgliteDatabase, seedDemoIdentities, type DbHandle } from "@collara/db";
import type { PersonaId } from "@collara/domain";
import type { LightMyRequestResponse } from "fastify";
import { buildApp, type BuildAppOptions, type CollaraApp } from "./app";
import { loadConfig, type Config } from "./config";
import { loggerOptions } from "./logger";
import { createMemoryStorage } from "./services/storage";

export const TEST_SECRET = "test-session-secret-0123456789abcdef";

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ NODE_ENV: "test", COLLARA_MODE: "LOCALNET", SESSION_SECRET: TEST_SECRET, DEMO_SESSIONS_ENABLED: "true", LOG_LEVEL: "silent", ...env });
}

export async function seededDb(): Promise<DbHandle> {
  const handle = await createPgliteDatabase();
  await seedDemoIdentities(handle.db);
  return handle;
}

export interface TestApp {
  app: CollaraApp;
  db: DbHandle;
  storage: ReturnType<typeof createMemoryStorage>;
  logs: string[];
  close(): Promise<void>;
}

export async function testApp(options: Partial<BuildAppOptions> & { env?: Record<string, string>; db?: DbHandle } = {}): Promise<TestApp> {
  const db = options.db ?? (await seededDb());
  const storage = createMemoryStorage();
  const config = options.config ?? testConfig(options.env);
  const logs: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      logs.push(chunk.toString());
      callback();
    },
  });
  const app = await buildApp({
    oidc: null,
    probeLedger: async () => ({ status: "unavailable", detail: "not probed in tests" }),
    storage,
    ...options,
    config,
    db,
    logger: options.logger ?? { ...loggerOptions({ ...config, LOG_LEVEL: "info" }), stream: sink },
  });
  await app.ready();
  return {
    app,
    db,
    storage,
    logs,
    async close() {
      await app.close();
      if (!options.db) await db.close();
    },
  };
}

/** "name=value" cookie header from a response's Set-Cookie (session cookie only). */
export function sessionCookie(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.name === "collara_sid" || c.name === "__Host-collara_sid");
  if (!cookie) throw new Error(`no session cookie in response (status ${response.statusCode}): ${response.body}`);
  return `${cookie.name}=${cookie.value}`;
}

export async function loginAs(app: CollaraApp, personaId: PersonaId): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/demo/sessions", payload: { personaId } });
  if (response.statusCode !== 200) throw new Error(`demo login failed: ${response.statusCode} ${response.body}`);
  return sessionCookie(response);
}

export function idem(key: string): Record<string, string> {
  return { "idempotency-key": key.padEnd(8, "0") };
}

