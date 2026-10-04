import { Writable } from "node:stream";
import pino from "pino";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { ApiProblemSchema, ERROR_COPY } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type CollaraApp } from "./app";
import { loadConfig } from "./config";
import { loggerOptions, redactUrl } from "./logger";
import { testApp, type TestApp } from "./test-support";

describe("api app without a database (UI_MOCK)", () => {
  let app: CollaraApp;

  beforeAll(async () => {
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), logger: false, storage: null });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports health with the configured mode and a private cache policy", async () => {
    const res = await app.inject({ method: "GET", url: "/api/system/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.json()).toEqual({ status: "ok", mode: "UI_MOCK", version: "0.0.0", checks: {} });
  });

  it("answers unknown routes with a 404-shaped problem", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(ApiProblemSchema.parse(res.json())).toMatchObject({ code: "unavailable", status: 404, detail: ERROR_COPY.UNAVAILABLE });
  });
});

describe("api app with a database (LOCALNET)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await testApp({ probeLedger: async () => ({ status: "ok", detail: "Canton 3.5.19 dpm sandbox, 1 participant (not Splice LocalNet)" }) });
  });

  afterAll(async () => {
    await t.close();
  });

  it("reports database, storage, ledger topology and worker checkpoint", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/system/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; checks: Record<string, { status: string; detail?: string }> }>();
    expect(body.checks.database?.status).toBe("ok");
    expect(body.checks.storage?.status).toBe("ok");
    expect(body.checks.ledger).toEqual({ status: "ok", detail: "Canton 3.5.19 dpm sandbox, 1 participant (not Splice LocalNet)" });
    // No worker has written a checkpoint in this database.
    expect(body.checks.worker?.status).toBe("unavailable");
    expect(body.status).toBe("degraded");
  });

  it("publishes the routes in the OpenAPI document", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/docs/json" });
    expect(res.statusCode).toBe(200);
    const paths = Object.keys(res.json<{ paths: Record<string, unknown> }>().paths);
    for (const path of [
      "/api/system/health",
      "/api/me",
      "/api/auth/login",
      "/api/auth/callback",
      "/api/auth/logout",
      "/api/demo/sessions",
      "/api/demo/personas",
      "/api/pilot-requests",
      "/api/commands/{id}",
      "/api/verifiers",
      "/api/evidence/upload-intents",
      "/api/evidence/{id}/content",
      "/api/evidence/{id}/finalize",
      "/api/evidence/{id}/download",
    ]) {
      expect(paths).toContain(path);
    }
  });

  it("serves the docs UI with helmet headers", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/docs" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["content-security-policy"]).not.toContain("upgrade-insecure-requests");
  });

  it("returns problem+json without stack traces for unexpected errors", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/pilot-requests", headers: { "content-type": "application/json" }, payload: "{not json" });
    expect(res.statusCode).toBe(400);
    const problem = ApiProblemSchema.parse(res.json());
    expect(problem.code).toBe("validation_error");
    expect(res.body).not.toMatch(/at .*\.ts:\d+/);
    expect(problem.instance).toMatch(/^urn:collara:request:/);
  });
});

describe("config", () => {
  it("applies defaults and rejects an invalid mode", () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(4000);
    expect(config.DEMO_SESSIONS_ENABLED).toBe(false);
    expect(config.COOKIE_SECURE).toBe(false);
    expect(loadConfig({ DATABASE_URL: "" }).DATABASE_URL).toBeUndefined();
    expect(() => loadConfig({ COLLARA_MODE: "SIMULATED" })).toThrow(/COLLARA_MODE/);
  });

  it("requires a session secret in production and credentials with S3", () => {
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db" })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ COLLARA_S3_ENDPOINT: "http://127.0.0.1:8333" })).toThrow(/S3 credentials/);
  });

  it("refuses demo sessions in production unless explicitly allowed for a synthetic demo", () => {
    expect(() => loadConfig({ NODE_ENV: "production", DEMO_SESSIONS_ENABLED: "true" })).toThrow(/DEMO_SESSIONS_ENABLED is refused in production/);
    expect(loadConfig({ NODE_ENV: "production", DEMO_SESSIONS_ENABLED: "true", DEMO_SESSIONS_ALLOW_IN_PRODUCTION: "true" }).DEMO_SESSIONS_ENABLED).toBe(true);
    expect(loadConfig({ NODE_ENV: "development", DEMO_SESSIONS_ENABLED: "true" }).DEMO_SESSIONS_ENABLED).toBe(true);
  });

  it("DEVNET: own database and state, tenant user required, no HMAC, no LocalNet state", () => {
    const devnet = { COLLARA_MODE: "DEVNET", DATABASE_URL: "postgres://collara:p@127.0.0.1:5432/collara_devnet", DEVNET_LEDGER_USER_ID: "c2ede6f6-team" };
    const config = loadConfig(devnet);
    expect(config.COLLARA_MODE).toBe("DEVNET");
    expect(config.DEVNET_OIDC_CLIENT_ID).toBe("web-app-ui-hackcanton-01-devnet");
    expect(config.DEVNET_LEDGER_AUDIENCE).toBe("https://hackcanton-01.devnet.naas.noders.services");
    expect(() => loadConfig({ ...devnet, DATABASE_URL: "postgres://collara:p@127.0.0.1:5432/collara" })).toThrow(/refuses database "collara"/);
    expect(() => loadConfig({ ...devnet, COLLARA_LOCALNET_STATE: ".local/localnet/state.json" })).toThrow(/COLLARA_LOCALNET_STATE/);
    expect(() => loadConfig({ ...devnet, CANTON_JWT_HMAC_SECRET: "collara-local-dev-secret-change-me" })).toThrow(/refuses HMAC/);
    expect(() => loadConfig({ ...devnet, DEVNET_LEDGER_USER_ID: "" })).toThrow(/DEVNET_LEDGER_USER_ID is required/);
    // LOCALNET is unaffected by the DEVNET guards.
    expect(loadConfig({ COLLARA_MODE: "LOCALNET", DATABASE_URL: "postgres://collara:p@127.0.0.1:5432/collara" }).COLLARA_MODE).toBe("LOCALNET");
  });
});

describe("logger", () => {
  it("redacts credentials, cookies, tokens, terms and OIDC codes", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const log = pino(loggerOptions({ LOG_LEVEL: "info", NODE_ENV: "test" }), sink);
    log.info({
      req: { method: "GET", url: "/api/auth/callback?code=secret-code&state=secret-state", headers: { authorization: "Bearer secret-token", cookie: "__Host-collara_sid=abc" } },
      res: { headers: { "set-cookie": ["__Host-collara_sid=def"] } },
    });
    log.info({ tokens: { id_token: "eyJhbGciOi.secret.sig", access_token: "secret-access" }, proposal: { principal: "100000.00" } });
    log.info({ credential: { refresh_token: "rt-secret-refresh", refreshToken: "rt-secret-camel" }, DATABASE_URL: "postgres://collara:db-password@h/collara_devnet" });
    const output = lines.join("");
    expect(output).not.toMatch(/secret-token|collara_sid=|secret-code|secret-state|eyJhbGciOi|secret-access|100000\.00|rt-secret|db-password/);
    expect(output).toContain("[redacted]");
  });

  it("logs database errors without bound parameters or row values", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const log = pino(loggerOptions({ LOG_LEVEL: "info", NODE_ENV: "test" }), sink);
    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      severity: "ERROR",
      detail: "Key (email)=(person@example.test) already exists.",
      constraint: "pilot_requests_email_key",
    });
    log.error({ err: new DrizzleQueryError('insert into "pilot_requests" ("email") values ($1)', ["person@example.test"], pgError) }, "request failed");
    const output = lines.join("");
    expect(output).not.toContain("person@example.test");
    expect(output).toContain("23505");
    expect(output).toContain("pilot_requests_email_key");
  });

  it("redacts sensitive query parameters only", () => {
    expect(redactUrl("/api/auth/callback?code=abc&state=def&x=1")).toBe("/api/auth/callback?code=%5Bredacted%5D&state=%5Bredacted%5D&x=1");
    expect(redactUrl("/api/cases?view=all")).toBe("/api/cases?view=all");
  });
});
