import { SignJWT } from "jose";
import { z } from "zod";

/**
 * Supplies bearer tokens for one ledger user. Implementations must never log tokens.
 * HMAC (local sandbox) is implemented here; a JWKS-backed OAuth client-credentials provider
 * (Keycloak) can implement the same interface later.
 */
export interface LedgerTokenProvider {
  /** Ledger user id the tokens are issued for (the JWT `sub`), when known. */
  readonly userId?: string;
  getToken(signal?: AbortSignal): Promise<string>;
  /** Drops any cached token; the client calls it after an HTTP 401 before retrying once. */
  invalidate?(): void;
}

/** Canton's default `max-token-lifetime`: tokens living longer than this are rejected (401). */
export const MAX_TOKEN_LIFETIME_SECONDS = 300;

export const HmacTokenSettingsSchema = z
  .object({
    /** Shared HS256 secret (`unsafe-jwt-hmac-256`; dev only). */
    secret: z.string().min(16, "the HMAC secret must be at least 16 characters"),
    /** Must equal the participant's `target-audience`. */
    audience: z.string().min(1),
    ttlSeconds: z.number().int().min(30).max(MAX_TOKEN_LIFETIME_SECONDS).default(240),
    /** Mint a new token once the cached one has less than this many seconds left. */
    refreshBeforeSeconds: z.number().int().min(0).default(30),
    /** Optional `iss`; leave unset for the default identity provider. */
    issuer: z.string().min(1).optional(),
  })
  .refine((s) => s.refreshBeforeSeconds < s.ttlSeconds, {
    message: "refreshBeforeSeconds must be smaller than ttlSeconds",
    path: ["refreshBeforeSeconds"],
  });
export type HmacTokenSettings = z.input<typeof HmacTokenSettingsSchema>;

/** Ledger user ids: 1-128 chars of [a-zA-Z0-9@^$.!`-#+'~_|:]. */
export const LedgerUserIdSchema = z.string().regex(/^[A-Za-z0-9@^$.!`\-#+'~_|:]{1,128}$/, "invalid ledger user id");

/**
 * HS256 tokens for the local sandbox: `aud` = target audience, `sub` = ledger user id,
 * `exp` - `iat` <= 300 s. Tokens are cached and re-minted `refreshBeforeSeconds` before expiry;
 * concurrent callers share one mint.
 */
export class HmacTokenProvider implements LedgerTokenProvider {
  readonly userId: string;
  readonly #settings: z.output<typeof HmacTokenSettingsSchema>;
  readonly #key: Uint8Array;
  readonly #now: () => number;
  #cached: { token: string; expiresAtMs: number } | undefined;
  #pending: Promise<string> | undefined;

  constructor(userId: string, settings: HmacTokenSettings, now: () => number = Date.now) {
    this.userId = LedgerUserIdSchema.parse(userId);
    this.#settings = HmacTokenSettingsSchema.parse(settings);
    this.#key = new TextEncoder().encode(this.#settings.secret);
    this.#now = now;
  }

  getToken(): Promise<string> {
    const now = this.#now();
    if (this.#cached && now < this.#cached.expiresAtMs - this.#settings.refreshBeforeSeconds * 1000) {
      return Promise.resolve(this.#cached.token);
    }
    this.#pending ??= this.#mint(now).finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  invalidate(): void {
    this.#cached = undefined;
  }

  async #mint(nowMs: number): Promise<string> {
    const iat = Math.floor(nowMs / 1000);
    const exp = iat + this.#settings.ttlSeconds;
    const jwt = new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setAudience(this.#settings.audience)
      .setSubject(this.userId)
      .setIssuedAt(iat)
      .setExpirationTime(exp);
    if (this.#settings.issuer) jwt.setIssuer(this.#settings.issuer);
    const token = await jwt.sign(this.#key);
    this.#cached = { token, expiresAtMs: exp * 1000 };
    return token;
  }

  toJSON(): { type: "hmac"; userId: string } {
    return { type: "hmac", userId: this.userId };
  }
}

/** One cached HmacTokenProvider per ledger user, sharing the same settings. */
export function createHmacTokenProviders(settings: HmacTokenSettings, now?: () => number) {
  HmacTokenSettingsSchema.parse(settings);
  const providers = new Map<string, HmacTokenProvider>();
  return (userId: string): HmacTokenProvider => {
    let provider = providers.get(userId);
    if (!provider) {
      provider = new HmacTokenProvider(userId, settings, now);
      providers.set(userId, provider);
    }
    return provider;
  };
}

/** A fixed token, e.g. one minted elsewhere. It cannot be refreshed. */
export class StaticTokenProvider implements LedgerTokenProvider {
  readonly #token: string;

  constructor(token: string) {
    this.#token = z.string().min(1).parse(token);
  }

  getToken(): Promise<string> {
    return Promise.resolve(this.#token);
  }

  toJSON(): { type: "static" } {
    return { type: "static" };
  }
}
