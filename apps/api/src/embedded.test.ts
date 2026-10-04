import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmbeddedApi, dispatch } from "./embedded";
import { seededDb, testApp, TEST_SECRET, type TestApp } from "./test-support";

const ORIGIN = "http://localhost:3000";

describe("embedded API adapter (Web Request → Fastify inject → Web Response)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await testApp();
  });

  afterAll(async () => {
    await t.close();
  });

  async function login(): Promise<{ response: Response; cookie: string }> {
    const response = await dispatch(
      t.app,
      new Request(`${ORIGIN}/api/demo/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ personaId: "manufacturer-owner" }),
      }),
    );
    const setCookie = response.headers.getSetCookie();
    const cookie = setCookie.map((c) => c.split(";")[0]).find((c) => c?.startsWith("collara_sid="));
    return { response, cookie: cookie ?? "" };
  }

  it("passes status, JSON body and Set-Cookie back; the cookie authenticates the next request", async () => {
    const { response, cookie } = await login();
    expect(response.status).toBe(200);
    expect(cookie).toMatch(/^collara_sid=/);
    expect(response.headers.getSetCookie().some((c) => /HttpOnly/i.test(c))).toBe(true);
    expect(((await response.json()) as { user?: unknown }).user).toBeDefined();

    const me = await dispatch(t.app, new Request(`${ORIGIN}/api/me`, { headers: { cookie } }));
    expect(me.status).toBe(200);
    expect(me.headers.get("cache-control")).toContain("no-store");
    expect(me.headers.get("transfer-encoding")).toBeNull();
  });

  it("returns problem+json errors with their status and ignores a browser-supplied bearer token", async () => {
    const anonymous = await dispatch(t.app, new Request(`${ORIGIN}/api/me`, { headers: { authorization: "Bearer forged" } }));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("content-type")).toContain("application/problem+json");

    const missing = await dispatch(t.app, new Request(`${ORIGIN}/api/does-not-exist?x=1`));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { instance?: string }).instance).toMatch(/^urn:collara:request:/);
  });

  it("serves HEAD without a body and keeps query strings", async () => {
    const head = await dispatch(t.app, new Request(`${ORIGIN}/api/system/health`, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("keeps the CSRF origin check: a cross-site mutation with the session cookie is refused", async () => {
    const { cookie } = await login();
    const response = await dispatch(
      t.app,
      new Request(`${ORIGIN}/api/auth/logout`, { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }),
    );
    expect(response.status).toBe(403);
  });
});

describe("createEmbeddedApi", () => {
  it("builds the app once from the environment, without the Swagger UI", async () => {
    const db = await seededDb();
    const api = await createEmbeddedApi({
      env: { NODE_ENV: "test", COLLARA_MODE: "LOCALNET", SESSION_SECRET: TEST_SECRET, LOG_LEVEL: "silent", WORKER_MODE: "on-request" },
      db,
      build: { oidc: null, storage: null, probeLedger: async () => ({ status: "unavailable", detail: "not probed" }) },
    });
    try {
      expect(api.config.WORKER_MODE).toBe("on-request");
      expect((await api.handle(new Request(`${ORIGIN}/api/docs`))).status).toBe(404);
      const health = await api.handle(new Request(`${ORIGIN}/api/system/health`));
      const body = (await health.json()) as { checks: { worker?: { detail?: string } } };
      expect(body.checks.worker?.detail).toContain("On-request sync (no persistent worker");
    } finally {
      await api.close();
      await db.close();
    }
  });
});
