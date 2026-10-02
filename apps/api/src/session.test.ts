import { createHash } from "node:crypto";
import * as oidcClient from "openid-client";
import { importLocalnetState, loadUserAuthority, sessions, users } from "@collara/db";
import { ApiProblemSchema, MeSchema } from "@collara/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFromAuthority } from "./plugins/actor";
import { buildAuthorizationRedirect, createOidcService, safeReturnTo, type OidcIdentity, type OidcService } from "./services/oidc";
import { loginAs, sessionCookie, testApp, testConfig, type TestApp } from "./test-support";

const SUFFIX = "1220abcd";
const STATE = {
  topology: "sandbox-1-participant",
  participants: { sandbox: { jsonApiUrl: "http://127.0.0.1:7575", participantId: `sandbox::${SUFFIX}` } },
  parties: Object.fromEntries(
    ["DemoManufacturer", "DemoLenderA", "DemoLenderB", "DemoAuditor", "CollaraGovernance", "GovSeat1", "GovSeat2", "GovSeat3"].map((hint) => [
      hint,
      { party: `${hint}::${SUFFIX}`, participant: "sandbox", user: `${hint}-svc` },
    ]),
  ),
  users: [],
};

describe("demo sessions, /api/me and logout", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await testApp();
    await importLocalnetState(t.db.db, STATE);
  });

  afterAll(async () => {
    await t.close();
  });

  it("requires a session for /api/me (401 problem)", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
    expect(ApiProblemSchema.parse(res.json()).code).toBe("unauthenticated");
  });

  it("lists seeded personas", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/demo/personas" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }[]>().map((p) => p.id)).toContain("lender-a-approver");
  });

  it("creates an isolated demo session and returns the Me shape", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/demo/sessions", payload: { personaId: "lender-a-approver" } });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "collara_sid");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.path).toBe("/");
    const me = MeSchema.parse(res.json());
    expect(me).toMatchObject({
      user: { id: "user-lender-a-approver", displayName: "Morgan Hale", title: "Head of Credit" },
      org: { id: "demo-lender-a", name: "Demo Lender A", type: "LENDER" },
      roles: ["GOVERNANCE_MEMBER", "LENDER_APPROVER"],
      governanceSeat: 1,
      mode: "LOCALNET",
      personaId: "lender-a-approver",
    });
    expect(me.navigation).toContain("governance");

    const again = await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: sessionCookie(res) } });
    expect(MeSchema.parse(again.json()).user.id).toBe("user-lender-a-approver");
  });

  it("stores only a hash of the session id", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/demo/sessions", payload: { personaId: "auditor" } });
    const raw = sessionCookie(res).split("=")[1] ?? "";
    const rows = await t.db.db.select().from(sessions);
    expect(rows.some((row) => raw.includes(row.id))).toBe(false);
    expect(rows.find((row) => row.personaId === "auditor")?.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores organization, party and role values supplied by the browser", async () => {
    const cookie = await loginAs(t.app, "lender-a-analyst");
    const res = await t.app.inject({
      method: "GET",
      url: "/api/me?orgId=demo-lender-b&party=DemoLenderB::x&role=LENDER_APPROVER",
      headers: { cookie, "x-collara-org": "demo-lender-b", "x-org-id": "demo-lender-b", "x-party-id": `DemoLenderB::${SUFFIX}` },
    });
    const me = MeSchema.parse(res.json());
    expect(me.org.id).toBe("demo-lender-a");
    expect(me.roles).toEqual(["LENDER_ANALYST"]);
    expect(me.mandates.map((m) => m.code)).toEqual(["ANALYST"]);
  });

  it("resolves the actor's parties from bindings, never from the request", async () => {
    // A preferred organization without an active membership (here: Lender B) is ignored.
    const authority = await loadUserAuthority(t.db.db, "user-lender-a-approver", "demo-lender-b");
    const resolved = authority && actorFromAuthority(authority, { authMethod: "demo", personaId: "lender-a-approver" });
    expect(resolved?.orgId).toBe("demo-lender-a");
    expect(resolved?.parties).toEqual({
      business: `DemoLenderA::${SUFFIX}`,
      governanceSeat: `GovSeat1::${SUFFIX}`,
      governance: `CollaraGovernance::${SUFFIX}`,
      readAs: [`DemoLenderA::${SUFFIX}`, `GovSeat1::${SUFFIX}`, `CollaraGovernance::${SUFFIX}`],
    });
  });

  it("rotates the session id on every login and invalidates the old one", async () => {
    const first = await loginAs(t.app, "manufacturer-owner");
    const second = await t.app.inject({ method: "POST", url: "/api/demo/sessions", headers: { cookie: first }, payload: { personaId: "dealer-contributor" } });
    const secondCookie = sessionCookie(second);
    expect(secondCookie).not.toBe(first);
    expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: first } })).statusCode).toBe(401);
    expect(MeSchema.parse((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: secondCookie } })).json()).org.id).toBe("demo-cnc-dealer");
  });

  it("logout destroys the session and clears the cookie", async () => {
    const cookie = await loginAs(t.app, "verifier-inspector");
    const before = (await t.db.db.select().from(sessions).where(eq(sessions.userId, "user-verifier-inspector"))).length;
    const res = await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ loggedOut: true, endSessionUrl: null });
    expect(res.cookies.find((c) => c.name === "collara_sid")?.value).toBe("");
    const after = (await t.db.db.select().from(sessions).where(eq(sessions.userId, "user-verifier-inspector"))).length;
    expect(after).toBe(before - 1);
    expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("rejects unknown personas and cross-site mutations", async () => {
    const bad = await t.app.inject({ method: "POST", url: "/api/demo/sessions", payload: { personaId: "root" } });
    expect(bad.statusCode).toBe(400);
    expect(ApiProblemSchema.parse(bad.json()).code).toBe("validation_error");

    const crossSite = await t.app.inject({
      method: "POST",
      url: "/api/demo/sessions",
      headers: { "sec-fetch-site": "cross-site" },
      payload: { personaId: "lender-a-approver" },
    });
    expect(crossSite.statusCode).toBe(403);
    expect(ApiProblemSchema.parse(crossSite.json()).code).toBe("forbidden");

    const foreignOrigin = await t.app.inject({
      method: "POST",
      url: "/api/demo/sessions",
      headers: { origin: "https://evil.example" },
      payload: { personaId: "lender-a-approver" },
    });
    expect(foreignOrigin.statusCode).toBe(403);

    const sameOrigin = await t.app.inject({
      method: "POST",
      url: "/api/demo/sessions",
      headers: { "sec-fetch-site": "same-origin", origin: "http://localhost:3000" },
      payload: { personaId: "lender-a-approver" },
    });
    expect(sameOrigin.statusCode).toBe(200);
  });
});

describe("demo sessions disabled", () => {
  it("answers 404 for every demo route", async () => {
    const t = await testApp({ env: { DEMO_SESSIONS_ENABLED: "false" } });
    try {
      expect((await t.app.inject({ method: "GET", url: "/api/demo/personas" })).statusCode).toBe(404);
      const res = await t.app.inject({ method: "POST", url: "/api/demo/sessions", payload: { personaId: "lender-a-approver" } });
      expect(res.statusCode).toBe(404);
      expect(ApiProblemSchema.parse(res.json()).code).toBe("unavailable");
    } finally {
      await t.close();
    }
  });
});

describe("OIDC", () => {
  const issuer = "https://idp.collara.test/realms/collara";
  const configuration = new oidcClient.Configuration(
    { issuer, authorization_endpoint: `${issuer}/protocol/openid-connect/auth`, token_endpoint: `${issuer}/protocol/openid-connect/token` },
    "collara-api",
    "client-secret",
  );

  it("builds an authorization URL with PKCE S256, state and nonce", () => {
    const verifier = "v".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = buildAuthorizationRedirect(configuration, {
      redirectUri: "http://localhost:3000/api/auth/callback",
      scope: "openid email profile",
      state: "s".repeat(22),
      nonce: "n".repeat(22),
      codeChallenge: challenge,
    });
    expect(url.origin + url.pathname).toBe(`${issuer}/protocol/openid-connect/auth`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "collara-api",
      redirect_uri: "http://localhost:3000/api/auth/callback",
      scope: "openid email profile",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "s".repeat(22),
      nonce: "n".repeat(22),
    });
  });

  it("only accepts relative in-app return paths", () => {
    expect(safeReturnTo("/app/cases")).toBe("/app/cases");
    expect(safeReturnTo("https://evil.example")).toBe("/app");
    expect(safeReturnTo("//evil.example")).toBe("/app");
    expect(safeReturnTo(undefined)).toBe("/app");
  });

  it("GET /api/auth/login redirects with PKCE and keeps the verifier server-side", async () => {
    const config = testConfig();
    const t = await testApp({ config, oidc: createOidcService(config, { configuration }) });
    try {
      const res = await t.app.inject({ method: "GET", url: "/api/auth/login?returnTo=/app/cases" });
      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.searchParams.get("code_challenge_method")).toBe("S256");
      expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback");
      expect(location.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
      const state = location.searchParams.get("state");
      expect(state).toBeTruthy();
      // The verifier never leaves the server: it is not in the redirect, only in the stored session.
      const [row] = await t.db.db.select().from(sessions);
      const data = row?.data as { oidc?: { state: string; codeVerifier: string; returnTo: string } };
      expect(data.oidc?.state).toBe(state);
      expect(data.oidc?.returnTo).toBe("/app/cases");
      expect(location.toString()).not.toContain(data.oidc?.codeVerifier ?? "missing");
      expect(res.cookies.find((c) => c.name === "collara_sid")).toBeTruthy();
    } finally {
      await t.close();
    }
  });

  it("redirects to /login?error=oidc_unavailable when OIDC is not configured", async () => {
    const t = await testApp();
    try {
      const res = await t.app.inject({ method: "GET", url: "/api/auth/login" });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/login?error=oidc_unavailable");
    } finally {
      await t.close();
    }
  });

  describe("callback", () => {
    function fakeOidc(identity: OidcIdentity): OidcService {
      return {
        startLogin: async (returnTo) => ({
          url: new URL(`${issuer}/auth?state=fixed`),
          pending: { state: "s".repeat(22), nonce: "n".repeat(22), codeVerifier: "v".repeat(43), returnTo, startedAt: Date.now() },
        }),
        completeLogin: async () => identity,
        endSessionUrl: async () => new URL(`${issuer}/logout`),
      };
    }

    async function flow(t: TestApp) {
      const login = await t.app.inject({ method: "GET", url: "/api/auth/login?returnTo=/app/pledges" });
      const preLogin = sessionCookie(login);
      const callback = await t.app.inject({ method: "GET", url: "/api/auth/callback?code=abc&state=fixed", headers: { cookie: preLogin } });
      return { preLogin, callback };
    }

    it("links a verified email once, rotates the session and redirects into the app", async () => {
      const t = await testApp({
        oidc: fakeOidc({ issuer, subject: "kc-sub-1", email: "lender-a.analyst@demo.test", emailVerified: true, name: "Dana Reyes", idToken: "id.token.value" }),
      });
      try {
        const { preLogin, callback } = await flow(t);
        expect(callback.statusCode).toBe(302);
        expect(callback.headers.location).toBe("/app/pledges");
        const session = sessionCookie(callback);
        expect(session).not.toBe(preLogin);
        const me = MeSchema.parse((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: session } })).json());
        expect(me).toMatchObject({ user: { id: "user-lender-a-analyst" }, personaId: null });
        const [user] = await t.db.db.select().from(users).where(eq(users.id, "user-lender-a-analyst"));
        expect(user).toMatchObject({ oidcIssuer: issuer, oidcSubject: "kc-sub-1" });
        // The pre-login session (with the PKCE state) is gone.
        expect((await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: preLogin } })).statusCode).toBe(401);
        const logout = await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: session } });
        expect(logout.json()).toEqual({ loggedOut: true, endSessionUrl: `${issuer}/logout` });
      } finally {
        await t.close();
      }
    });

    it("sends unknown or unverified identities to /access-pending without a user session", async () => {
      for (const identity of [
        { issuer, subject: "kc-unknown", email: "stranger@example.test", emailVerified: true, name: null, idToken: null },
        { issuer, subject: "kc-unverified", email: "lender-b.approver@demo.test", emailVerified: false, name: null, idToken: null },
      ]) {
        const t = await testApp({ oidc: fakeOidc(identity) });
        try {
          const { callback } = await flow(t);
          expect(callback.statusCode).toBe(302);
          expect(callback.headers.location).toBe("/access-pending");
          // The pre-login session (PKCE state) is deleted and no user session is created.
          expect(await t.db.db.select().from(sessions)).toHaveLength(0);
          expect(callback.cookies.find((c) => c.name === "collara_sid")?.value).toBe("");
        } finally {
          await t.close();
        }
      }
    });

    it("fails closed when the callback has no pending login", async () => {
      const t = await testApp({ oidc: fakeOidc({ issuer, subject: "x", email: null, emailVerified: false, name: null, idToken: null }) });
      try {
        const res = await t.app.inject({ method: "GET", url: "/api/auth/callback?code=abc&state=fixed" });
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/login?error=callback_failed");
      } finally {
        await t.close();
      }
    });
  });
});
