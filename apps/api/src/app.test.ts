import { Writable } from "node:stream";
import pino from "pino";
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
    const output = lines.join("");
    expect(output).not.toMatch(/secret-token|collara_sid=|secret-code|secret-state|eyJhbGciOi|secret-access|100000\.00/);
    expect(output).toContain("[redacted]");
  });

  it("redacts sensitive query parameters only", () => {
    expect(redactUrl("/api/auth/callback?code=abc&state=def&x=1")).toBe("/api/auth/callback?code=%5Bredacted%5D&state=%5Bredacted%5D&x=1");
    expect(redactUrl("/api/cases?view=all")).toBe("/api/cases?view=all");
  });
});
