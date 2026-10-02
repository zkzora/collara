import { decodeProtectedHeader, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { createHmacTokenProviders, HmacTokenProvider, MAX_TOKEN_LIFETIME_SECONDS, StaticTokenProvider } from "./auth";

const settings = { secret: "unit-test-secret-not-for-use", audience: "https://collara.local/ledger-api" };
const key = new TextEncoder().encode(settings.secret);

describe("HmacTokenProvider", () => {
  it("mints HS256 tokens with aud, sub, iat and exp <= 300 s", async () => {
    const now = Date.UTC(2026, 9, 2, 8, 0, 0);
    const provider = new HmacTokenProvider("borrower-svc", settings, () => now);
    const token = await provider.getToken();

    expect(decodeProtectedHeader(token)).toEqual({ alg: "HS256", typ: "JWT" });
    const { payload } = await jwtVerify(token, key, {
      audience: settings.audience,
      subject: "borrower-svc",
      currentDate: new Date(now),
    });
    expect(payload.iat).toBe(now / 1000);
    expect(payload.exp! - payload.iat!).toBe(240);
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(MAX_TOKEN_LIFETIME_SECONDS);
    expect(payload.iss).toBeUndefined();
  });

  it("caches the token and refreshes it before expiry", async () => {
    let now = Date.UTC(2026, 9, 2, 8, 0, 0);
    const provider = new HmacTokenProvider("lender-a-svc", { ...settings, ttlSeconds: 120, refreshBeforeSeconds: 20 }, () => now);
    const first = await provider.getToken();

    now += 99_000; // 21 s left: still cached
    expect(await provider.getToken()).toBe(first);

    now += 2_000; // 19 s left: refresh
    const second = await provider.getToken();
    expect(second).not.toBe(first);
    const { payload } = await jwtVerify(second, key, { currentDate: new Date(now) });
    expect(payload.iat).toBe(Math.floor(now / 1000));
  });

  it("shares one mint between concurrent callers and re-mints after invalidate()", async () => {
    let now = Date.UTC(2026, 9, 2, 8, 0, 0);
    const provider = new HmacTokenProvider("auditor-svc", settings, () => now);
    const [a, b] = await Promise.all([provider.getToken(), provider.getToken()]);
    expect(a).toBe(b);
    provider.invalidate();
    now += 1_000;
    expect(await provider.getToken()).not.toBe(a);
  });

  it("rejects lifetimes above the Canton cap and weak settings", () => {
    expect(() => new HmacTokenProvider("u", { ...settings, ttlSeconds: 301 })).toThrow();
    expect(() => new HmacTokenProvider("u", { ...settings, secret: "short" })).toThrow();
    expect(() => new HmacTokenProvider("u", { ...settings, ttlSeconds: 60, refreshBeforeSeconds: 60 })).toThrow();
    expect(() => new HmacTokenProvider("not a user id", settings)).toThrow();
  });

  it("never serializes the secret or the token", async () => {
    const provider = new HmacTokenProvider("dealer-svc", settings);
    const token = await provider.getToken();
    const serialized = JSON.stringify({ provider });
    expect(serialized).not.toContain(settings.secret);
    expect(serialized).not.toContain(token);
    expect(JSON.stringify(new StaticTokenProvider(token))).not.toContain(token);
  });
});

describe("createHmacTokenProviders", () => {
  it("returns one cached provider per ledger user", () => {
    const providers = createHmacTokenProviders(settings);
    expect(providers("borrower-svc")).toBe(providers("borrower-svc"));
    expect(providers("borrower-svc")).not.toBe(providers("lender-a-svc"));
    expect(providers("lender-a-svc").userId).toBe("lender-a-svc");
  });
});
