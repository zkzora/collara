import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LedgerClient } from "./client";
import { LedgerError } from "./errors";
import {
  DEVNET_LOGIN_COMMAND,
  devnetCredentialId,
  LedgerCredentialError,
  MemoryRefreshTokenStore,
  OidcRefreshTokenProvider,
  parseOidcLedgerSettings,
  remoteJwks,
  requestToken,
  validateLedgerAccessToken,
  type OidcLedgerSettings,
} from "./oidc";
import { startMockOidcIssuer, type MockIssuerClaims, type MockOidcIssuer } from "./testing/mock-oidc-issuer";

const USER = "c2ede6f6-0000-4000-8000-000000000001";
const AUDIENCE = "https://hackcanton-01.devnet.naas.noders.services";
const GOOD: MockIssuerClaims = { sub: USER, aud: ["account", AUDIENCE], scope: "openid daml_ledger_api offline_access", expiresIn: 10_800 };

let issuer: MockOidcIssuer;

beforeAll(async () => {
  issuer = await startMockOidcIssuer({ claims: GOOD, users: { team: "team-password" } });
});
afterAll(async () => {
  await issuer.close();
});
beforeEach(() => {
  issuer.claims = GOOD;
  issuer.delayMs = 0;
});

function settings(overrides: Partial<OidcLedgerSettings> = {}): OidcLedgerSettings {
  return {
    issuer: issuer.issuer,
    tokenEndpoint: issuer.tokenEndpoint,
    jwksUri: issuer.jwksUri,
    clientId: issuer.clientId,
    audience: AUDIENCE,
    ledgerUserId: USER,
    allowInsecureHttp: true,
    ...overrides,
  };
}

function setup(overrides: Partial<OidcLedgerSettings> = {}) {
  const id = devnetCredentialId(USER);
  const store = new MemoryRefreshTokenStore({ [id]: { refreshToken: issuer.issueRefreshToken(), ledgerUserId: USER } });
  const jwks = remoteJwks(issuer.jwksUri);
  const provider = (now?: () => number) => new OidcRefreshTokenProvider({ settings: settings(overrides), store, jwks, ...(now ? { now } : {}) });
  return { id, store, provider };
}

async function rejection(promise: Promise<unknown>): Promise<LedgerCredentialError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LedgerCredentialError);
  return error as LedgerCredentialError;
}

describe("OIDC settings", () => {
  it("derives the Keycloak endpoints and refuses plain http unless allowed", () => {
    const parsed = parseOidcLedgerSettings({ issuer: "https://idp.example/realms/r", clientId: "c", audience: "a", ledgerUserId: USER });
    expect(parsed.tokenEndpoint).toBe("https://idp.example/realms/r/protocol/openid-connect/token");
    expect(parsed.jwksUri).toBe("https://idp.example/realms/r/protocol/openid-connect/certs");
    expect(parsed.scope).toBe("openid daml_ledger_api offline_access");
    expect(() => parseOidcLedgerSettings({ issuer: "http://idp.example/r", clientId: "c", audience: "a", ledgerUserId: USER })).toThrow(/https/);
  });
});

describe("OidcRefreshTokenProvider", () => {
  it("refreshes, validates and persists the rotated refresh token", async () => {
    const { id, store, provider } = setup();
    const before = store.peek(id)?.refreshToken;
    const p = provider();
    const token = await p.getToken();
    expect(token.split(".")).toHaveLength(3);
    const after = store.peek(id);
    expect(after?.status).toBe("ACTIVE");
    expect(after?.refreshToken).toBeTruthy();
    expect(after?.refreshToken).not.toBe(before);
    // Cached until shortly before exp: no second refresh.
    const refreshes = issuer.refreshCount();
    expect(await p.getToken()).toBe(token);
    expect(issuer.refreshCount()).toBe(refreshes);
    // invalidate() (after a 401) forces a refresh with the rotated token, which the issuer accepts.
    p.invalidate();
    await p.getToken();
    expect(issuer.refreshCount()).toBe(refreshes + 1);
    expect(issuer.reuseCount()).toBe(0);
    expect(JSON.stringify(p)).not.toContain(token);
  });

  it("refreshes again once the token is within refreshBeforeSeconds of exp", async () => {
    const { provider } = setup({ refreshBeforeSeconds: 300 });
    let now = Date.now();
    const p = provider(() => now);
    await p.getToken();
    const refreshes = issuer.refreshCount();
    now += (10_800 - 299) * 1000;
    await p.getToken();
    expect(issuer.refreshCount()).toBe(refreshes + 1);
  });

  it("concurrent callers in one process share one refresh", async () => {
    const { provider } = setup();
    issuer.delayMs = 50;
    const refreshes = issuer.refreshCount();
    const p = provider();
    const tokens = await Promise.all(Array.from({ length: 8 }, () => p.getToken()));
    expect(new Set(tokens).size).toBe(1);
    expect(issuer.refreshCount()).toBe(refreshes + 1);
  });

  it("two clients sharing the store (API + worker) never send one refresh token twice", async () => {
    const { id, store, provider } = setup();
    issuer.delayMs = 40;
    const refreshes = issuer.refreshCount();
    const api = provider();
    const worker = provider();
    const [a, b] = await Promise.all([api.getToken(), worker.getToken()]);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // Serialised by the store's lock: each refresh used the token the previous one stored.
    expect(issuer.refreshCount()).toBe(refreshes + 2);
    expect(issuer.reuseCount()).toBe(0);
    expect(store.peek(id)?.status).toBe("ACTIVE");
  });

  it.each([
    ["wrong audience", { aud: "https://other.example" }, /aud/],
    ["wrong subject", { sub: "someone-else" }, /sub is not the configured ledger user/],
    ["missing daml_ledger_api scope", { scope: "openid offline_access" }, /scope does not contain daml_ledger_api/],
    ["expired", { expiresIn: -120 }, /expired/],
    ["wrong issuer", { iss: "https://evil.example/realm" }, /iss/],
  ] as const)("rejects an access token with %s", async (_label, claims, message) => {
    const { id, store, provider } = setup();
    issuer.claims = { ...GOOD, ...claims };
    const error = await rejection(provider().getToken());
    expect(error.code).toBe("TOKEN_INVALID");
    expect(error.message).toMatch(message);
    // The spent refresh token was replaced by the rotated one, so the next valid token works without a login.
    issuer.claims = GOOD;
    expect(store.peek(id)?.status).toBe("ACTIVE");
    await expect(provider().getToken()).resolves.toBeTruthy();
  });

  it("rejects a token signed by a key outside the issuer's JWKS", async () => {
    const { provider } = setup();
    issuer.claims = { ...GOOD, signWith: issuer.foreignKey };
    const error = await rejection(provider().getToken());
    expect(error.code).toBe("TOKEN_INVALID");
  });

  it("a revoked refresh token gives a clear operator error and marks the credential", async () => {
    const { id, store, provider } = setup();
    issuer.revokeAll();
    const error = await rejection(provider().getToken());
    expect(error.code).toBe("REFRESH_REJECTED");
    expect(error.message).toContain(DEVNET_LOGIN_COMMAND);
    expect(error.message).toContain("invalid_grant");
    expect(error.message).not.toMatch(/rt-[0-9a-f-]{36}/);
    expect(store.peek(id)?.status).toBe("REAUTH_REQUIRED");
    // Other processes stop trying the dead token.
    const refreshes = issuer.refreshCount();
    const again = await rejection(provider().getToken());
    expect(again.code).toBe("REFRESH_REJECTED");
    expect(issuer.refreshCount()).toBe(refreshes);
  });

  it("without a stored refresh token it asks for the login script", async () => {
    const provider = new OidcRefreshTokenProvider({ settings: settings(), store: new MemoryRefreshTokenStore(), jwks: remoteJwks(issuer.jwksUri) });
    const error = await rejection(provider.getToken());
    expect(error.code).toBe("NO_REFRESH_TOKEN");
    expect(error.message).toContain(DEVNET_LOGIN_COMMAND);
  });

  it("an unreachable token endpoint is retryable and leaves the stored token alone", async () => {
    const { id, store } = setup();
    const before = store.peek(id)?.refreshToken;
    const provider = new OidcRefreshTokenProvider({
      settings: settings({ tokenEndpoint: "http://127.0.0.1:9/token" }),
      store,
      jwks: remoteJwks(issuer.jwksUri),
    });
    const error = await rejection(provider.getToken());
    expect(error.code).toBe("TOKEN_ENDPOINT_UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(store.peek(id)?.refreshToken).toBe(before);
  });

  it("LedgerClient reports a credential failure as FAILED (nothing sent)", async () => {
    const provider = new OidcRefreshTokenProvider({ settings: settings(), store: new MemoryRefreshTokenStore(), jwks: remoteJwks(issuer.jwksUri) });
    let sent = 0;
    const client = new LedgerClient({
      baseUrl: "http://127.0.0.1:1",
      tokenProvider: provider,
      fetch: async () => {
        sent++;
        return new Response("{}");
      },
    });
    const error = await client.ledgerEnd().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LedgerError);
    expect((error as LedgerError).info).toMatchObject({ kind: "UNAUTHENTICATED", commandState: "FAILED" });
    expect((error as LedgerError).message).toContain(DEVNET_LOGIN_COMMAND);
    expect(sent).toBe(0);
  });
});

describe("password grant (login script)", () => {
  it("returns a validated token and a refresh token; wrong credentials are refused", async () => {
    const parsed = parseOidcLedgerSettings(settings());
    const response = await requestToken(parsed, { grant_type: "password", username: "team", password: "team-password" });
    expect(response.refresh_token).toBeTruthy();
    const validated = await validateLedgerAccessToken(response.access_token, parsed, remoteJwks(issuer.jwksUri));
    expect(validated.ledgerUserId).toBe(USER);
    expect(validated.audience).toContain(AUDIENCE);
    await expect(requestToken(parsed, { grant_type: "password", username: "team", password: "wrong" })).rejects.toMatchObject({ code: "TOKEN_RESPONSE_INVALID" });
  });
});
