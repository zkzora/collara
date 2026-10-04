// OIDC refresh-token ledger credentials (DEVNET: a shared participant whose JSON Ledger API trusts an external
// Keycloak). The first refresh token comes from a password grant run by the owner (scripts/devnet/login.mjs); every
// later access token comes from the refresh_token grant. The identity provider ROTATES refresh tokens: each one is
// valid for exactly one refresh, so the store serialises refreshes across processes and persists the new token
// before releasing its lock. Tokens are never logged, never put in errors and never sent to a browser.
import { createRemoteJWKSet, decodeJwt, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { LedgerUserIdSchema, type LedgerTokenProvider } from "./auth";

/**
 * Object keys that carry ledger or identity-provider credentials. Loggers (API, worker) redact them at the top level
 * and one level down; the token provider itself never logs.
 */
export const CREDENTIAL_LOG_KEYS = [
  "authorization",
  "password",
  "secret",
  "token",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "id_token",
  "idToken",
  "client_secret",
  "CANTON_JWT_HMAC_SECRET",
  "DATABASE_URL",
] as const;

/** Run this when the stored refresh token is missing or was rejected. */
export const DEVNET_LOGIN_COMMAND = "node scripts/devnet/login.mjs";

/** Asymmetric algorithms only: a token signed with a shared secret (HS*) is never accepted. */
export const ACCEPTED_TOKEN_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];

export const OidcLedgerSettingsSchema = z.object({
  /** OIDC issuer (the `iss` every access token must carry). */
  issuer: z.url(),
  /** Token endpoint; default `<issuer>/protocol/openid-connect/token` (Keycloak). */
  tokenEndpoint: z.url().optional(),
  /** JWKS endpoint; default `<issuer>/protocol/openid-connect/certs` (Keycloak). */
  jwksUri: z.url().optional(),
  /** Public client id (no client secret). */
  clientId: z.string().min(1),
  scope: z.string().min(1).default("openid daml_ledger_api offline_access"),
  /** Must be one of the token's `aud` values (the participant's target audience). */
  audience: z.string().min(1),
  /** Scope every access token must carry. */
  requiredScope: z.string().min(1).default("daml_ledger_api"),
  /** The ledger user id the tokens must be issued for (`sub`). */
  ledgerUserId: LedgerUserIdSchema,
  /** Refresh once the cached access token has less than this many seconds left. */
  refreshBeforeSeconds: z.number().int().min(0).max(3_600).default(300),
  clockToleranceSeconds: z.number().int().min(0).max(300).default(30),
  /** Token endpoint timeout. */
  timeoutMs: z.number().int().positive().default(15_000),
  /** Allows http:// endpoints (local mock issuers in tests only). */
  allowInsecureHttp: z.boolean().default(false),
});
export type OidcLedgerSettings = z.input<typeof OidcLedgerSettingsSchema>;
type Settings = z.output<typeof OidcLedgerSettingsSchema>;

export function parseOidcLedgerSettings(input: OidcLedgerSettings): Settings & { tokenEndpoint: string; jwksUri: string } {
  const settings = OidcLedgerSettingsSchema.parse(input);
  const base = settings.issuer.replace(/\/+$/, "");
  const resolved = {
    ...settings,
    tokenEndpoint: settings.tokenEndpoint ?? `${base}/protocol/openid-connect/token`,
    jwksUri: settings.jwksUri ?? `${base}/protocol/openid-connect/certs`,
  };
  if (!resolved.allowInsecureHttp) {
    for (const url of [resolved.issuer, resolved.tokenEndpoint, resolved.jwksUri]) {
      if (!url.startsWith("https://")) throw new Error(`OIDC endpoint must use https: ${url}`);
    }
  }
  return resolved;
}

export type LedgerCredentialErrorCode =
  /** Nothing stored yet: run the login script. */
  | "NO_REFRESH_TOKEN"
  /** The identity provider rejected the stored refresh token (revoked, expired, already used): run the login script. */
  | "REFRESH_REJECTED"
  /** The identity provider could not be reached or answered 5xx: retry later. */
  | "TOKEN_ENDPOINT_UNAVAILABLE"
  /** The identity provider answered, but not with a usable token response. */
  | "TOKEN_RESPONSE_INVALID"
  /** The access token failed validation (signature, iss, aud, scope, sub, exp). */
  | "TOKEN_INVALID";

/** Operator-facing credential error. Its message never contains a token. */
export class LedgerCredentialError extends Error {
  override readonly name = "LedgerCredentialError";
  readonly code: LedgerCredentialErrorCode;
  /** True when retrying later may succeed without a new login. */
  readonly retryable: boolean;

  constructor(code: LedgerCredentialErrorCode, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function reloginMessage(reason: string): string {
  return `${reason}. Run ${DEVNET_LOGIN_COMMAND} again (in your own terminal) to store a new refresh token.`;
}

/** What the store holds for one credential. */
export interface StoredLedgerCredential {
  readonly refreshToken: string | null;
  /** ACTIVE, or REAUTH_REQUIRED after the identity provider rejected the refresh token. */
  readonly status: "ACTIVE" | "REAUTH_REQUIRED";
  readonly ledgerUserId: string;
}

export type LedgerCredentialUpdate =
  | { readonly kind: "unchanged" }
  | { readonly kind: "rotated"; readonly refreshToken: string; readonly accessTokenExpiresAt: Date }
  | { readonly kind: "rejected"; readonly reason: string };

/**
 * Server-side storage for the rotating refresh token (PostgreSQL in DEVNET: @collara/db `ledger_credentials`).
 * `withCredential` must hold an exclusive lock on the credential across processes for the whole callback and
 * apply the returned update before releasing it, so one refresh token is never sent twice.
 */
export interface RefreshTokenStore {
  withCredential<T>(
    credentialId: string,
    fn: (current: StoredLedgerCredential | null) => Promise<{ readonly update: LedgerCredentialUpdate; readonly value: T }>,
  ): Promise<T>;
}

/** In-memory store (tests and single-process tools). The lock is a promise chain. */
export class MemoryRefreshTokenStore implements RefreshTokenStore {
  readonly #rows = new Map<string, { refreshToken: string | null; status: StoredLedgerCredential["status"]; ledgerUserId: string; lastError?: string }>();
  #chain: Promise<unknown> = Promise.resolve();

  constructor(initial: Record<string, { refreshToken: string; ledgerUserId: string }> = {}) {
    for (const [id, row] of Object.entries(initial)) this.#rows.set(id, { ...row, status: "ACTIVE" });
  }

  withCredential<T>(
    credentialId: string,
    fn: (current: StoredLedgerCredential | null) => Promise<{ update: LedgerCredentialUpdate; value: T }>,
  ): Promise<T> {
    const run = this.#chain.then(async () => {
      const row = this.#rows.get(credentialId);
      const { update, value } = await fn(row ? { refreshToken: row.refreshToken, status: row.status, ledgerUserId: row.ledgerUserId } : null);
      if (row && update.kind === "rotated") this.#rows.set(credentialId, { ...row, refreshToken: update.refreshToken, status: "ACTIVE" });
      if (row && update.kind === "rejected") this.#rows.set(credentialId, { ...row, status: "REAUTH_REQUIRED", lastError: update.reason });
      return value;
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  /** Test helper: the stored token (never log it). */
  peek(credentialId: string): { refreshToken: string | null; status: StoredLedgerCredential["status"] } | undefined {
    const row = this.#rows.get(credentialId);
    return row ? { refreshToken: row.refreshToken, status: row.status } : undefined;
  }
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

const TokenErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });

/** Error text from a token endpoint, cut short; the endpoint's error fields never contain a token. */
function describeTokenError(status: number, body: unknown): string {
  const parsed = TokenErrorSchema.safeParse(body);
  if (!parsed.success) return `HTTP ${status}`;
  const description = parsed.data.error_description ? `: ${parsed.data.error_description.slice(0, 200)}` : "";
  return `${parsed.data.error}${description} (HTTP ${status})`;
}

/**
 * POSTs a grant to the token endpoint (form-encoded, public client). Returns the parsed response or throws
 * LedgerCredentialError. `invalid_grant` becomes REFRESH_REJECTED for refresh grants.
 */
export async function requestToken(
  settings: Pick<Settings, "clientId" | "scope" | "timeoutMs"> & { tokenEndpoint: string },
  grant: { grant_type: "password"; username: string; password: string } | { grant_type: "refresh_token"; refresh_token: string },
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<TokenResponse> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const form = new URLSearchParams({ client_id: settings.clientId, scope: settings.scope, ...grant });
  const timeout = AbortSignal.timeout(settings.timeoutMs);
  let response: Response;
  try {
    response = await doFetch(settings.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
      signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new LedgerCredentialError("TOKEN_ENDPOINT_UNAVAILABLE", `the identity provider's token endpoint is unreachable (${name || "network error"})`, true);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = describeTokenError(response.status, body);
    if (response.status >= 500 || response.status === 429) {
      throw new LedgerCredentialError("TOKEN_ENDPOINT_UNAVAILABLE", `the identity provider failed: ${detail}`, true);
    }
    const error = TokenErrorSchema.safeParse(body).data?.error;
    if (grant.grant_type === "refresh_token" && (error === "invalid_grant" || error === "invalid_token" || response.status === 401)) {
      throw new LedgerCredentialError("REFRESH_REJECTED", reloginMessage(`The identity provider rejected the stored refresh token (${detail})`));
    }
    throw new LedgerCredentialError("TOKEN_RESPONSE_INVALID", `the identity provider refused the ${grant.grant_type} grant: ${detail}`);
  }
  const parsed = TokenResponseSchema.safeParse(body);
  if (!parsed.success) throw new LedgerCredentialError("TOKEN_RESPONSE_INVALID", "the token response has no access_token");
  return parsed.data;
}

export interface ValidatedAccessToken {
  readonly ledgerUserId: string;
  readonly expiresAt: Date;
  readonly audience: readonly string[];
  readonly scopes: readonly string[];
}

/**
 * Verifies an access token before it is used: signature against the issuer's JWKS (asymmetric algorithms only),
 * `iss`, `aud` containing the configured audience, `scope` containing the required scope, `sub` equal to the
 * configured ledger user, and `exp` in the future.
 */
export async function validateLedgerAccessToken(
  token: string,
  settings: Pick<Settings, "issuer" | "audience" | "requiredScope" | "ledgerUserId" | "clockToleranceSeconds">,
  jwks: JWTVerifyGetKey,
): Promise<ValidatedAccessToken> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: settings.issuer,
      audience: settings.audience,
      algorithms: ACCEPTED_TOKEN_ALGORITHMS,
      clockTolerance: settings.clockToleranceSeconds,
      requiredClaims: ["exp", "sub", "aud", "iss"],
    }));
  } catch (error) {
    throw new LedgerCredentialError("TOKEN_INVALID", `the access token failed validation: ${joseReason(error)}`);
  }
  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(settings.requiredScope)) {
    throw new LedgerCredentialError("TOKEN_INVALID", `the access token failed validation: scope does not contain ${settings.requiredScope}`);
  }
  if (payload.sub !== settings.ledgerUserId) {
    throw new LedgerCredentialError(
      "TOKEN_INVALID",
      `the access token failed validation: sub is not the configured ledger user (expected ${settings.ledgerUserId}, got ${payload.sub ?? "none"})`,
    );
  }
  const audience = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  return { ledgerUserId: payload.sub, expiresAt: new Date((payload.exp ?? 0) * 1000), audience, scopes };
}

function joseReason(error: unknown): string {
  if (error instanceof joseErrors.JWTExpired) return "token expired (exp)";
  if (error instanceof joseErrors.JWTClaimValidationFailed) return `claim ${error.claim} check failed (${error.reason})`;
  if (error instanceof joseErrors.JWSSignatureVerificationFailed) return "signature verification failed";
  if (error instanceof joseErrors.JOSEAlgNotAllowed) return "signing algorithm not allowed";
  if (error instanceof joseErrors.JWKSNoMatchingKey) return "no matching key in the issuer's JWKS";
  if (error instanceof joseErrors.JOSEError) return error.code;
  return error instanceof Error ? error.name : "unknown error";
}

/** The unverified `sub` of a JWT (to learn the ledger user id before validating with it), or null. */
export function decodeJwtSubject(token: string): string | null {
  try {
    return decodeJwt(token).sub ?? null;
  } catch {
    return null;
  }
}

/** The issuer's JWKS as a jose key getter (cached and rate-limited by jose). */
export function remoteJwks(jwksUri: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUri));
}

export interface OidcRefreshTokenProviderOptions {
  readonly settings: OidcLedgerSettings;
  readonly store: RefreshTokenStore;
  /** Row id in the store (default `devnet:<ledgerUserId>`). */
  readonly credentialId?: string;
  /** Key getter for validation (default: the issuer's remote JWKS). */
  readonly jwks?: JWTVerifyGetKey;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function devnetCredentialId(ledgerUserId: string): string {
  return `devnet:${ledgerUserId}`;
}

/**
 * LedgerTokenProvider for one ledger user, backed by a rotating OIDC refresh token. Access tokens are cached in
 * memory until `refreshBeforeSeconds` before `exp`; concurrent callers in one process share one refresh, and the
 * store's lock serialises refreshes across processes (API + worker).
 */
export class OidcRefreshTokenProvider implements LedgerTokenProvider {
  readonly userId: string;
  readonly credentialId: string;
  readonly #settings: ReturnType<typeof parseOidcLedgerSettings>;
  readonly #store: RefreshTokenStore;
  readonly #jwks: JWTVerifyGetKey;
  readonly #fetch: typeof fetch | undefined;
  readonly #now: () => number;
  #cached: { token: string; refreshAtMs: number } | undefined;
  #pending: Promise<string> | undefined;

  constructor(options: OidcRefreshTokenProviderOptions) {
    this.#settings = parseOidcLedgerSettings(options.settings);
    this.userId = this.#settings.ledgerUserId;
    this.credentialId = options.credentialId ?? devnetCredentialId(this.userId);
    this.#store = options.store;
    this.#jwks = options.jwks ?? remoteJwks(this.#settings.jwksUri);
    this.#fetch = options.fetch;
    this.#now = options.now ?? Date.now;
  }

  getToken(signal?: AbortSignal): Promise<string> {
    const cached = this.#cached;
    if (cached && this.#now() < cached.refreshAtMs) return Promise.resolve(cached.token);
    this.#pending ??= this.#refresh(signal).finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  invalidate(): void {
    this.#cached = undefined;
  }

  async #refresh(signal?: AbortSignal): Promise<string> {
    const settings = this.#settings;
    const result = await this.#store.withCredential<{ token: string; expiresAtMs: number } | LedgerCredentialError>(this.credentialId, async (current) => {
      if (!current?.refreshToken) {
        return { update: { kind: "unchanged" }, value: new LedgerCredentialError("NO_REFRESH_TOKEN", reloginMessage("No DevNet refresh token is stored")) };
      }
      if (current.status !== "ACTIVE") {
        return {
          update: { kind: "unchanged" },
          value: new LedgerCredentialError("REFRESH_REJECTED", reloginMessage("The stored DevNet refresh token was rejected earlier")),
        };
      }
      if (current.ledgerUserId !== settings.ledgerUserId) {
        return {
          update: { kind: "unchanged" },
          value: new LedgerCredentialError(
            "TOKEN_INVALID",
            reloginMessage(`The stored credential belongs to ledger user ${current.ledgerUserId}, not ${settings.ledgerUserId}`),
          ),
        };
      }
      let response: TokenResponse;
      try {
        response = await requestToken(settings, { grant_type: "refresh_token", refresh_token: current.refreshToken }, { ...(this.#fetch ? { fetch: this.#fetch } : {}), ...(signal ? { signal } : {}) });
      } catch (error) {
        const credentialError = error instanceof LedgerCredentialError ? error : new LedgerCredentialError("TOKEN_ENDPOINT_UNAVAILABLE", "token refresh failed", true);
        // A rejected refresh token is dead: record it so other processes stop trying it.
        const update: LedgerCredentialUpdate = credentialError.code === "REFRESH_REJECTED" ? { kind: "rejected", reason: credentialError.message } : { kind: "unchanged" };
        return { update, value: credentialError };
      }
      // The old refresh token is spent once the provider answered: persist the new one even if the access token
      // fails validation below. A provider that does not rotate keeps the current one.
      const nextRefreshToken = response.refresh_token ?? current.refreshToken;
      try {
        const validated = await validateLedgerAccessToken(response.access_token, settings, this.#jwks);
        return {
          update: { kind: "rotated", refreshToken: nextRefreshToken, accessTokenExpiresAt: validated.expiresAt },
          value: { token: response.access_token, expiresAtMs: validated.expiresAt.getTime() },
        };
      } catch (error) {
        const credentialError = error instanceof LedgerCredentialError ? error : new LedgerCredentialError("TOKEN_INVALID", "the access token failed validation");
        return { update: { kind: "rotated", refreshToken: nextRefreshToken, accessTokenExpiresAt: new Date(0) }, value: credentialError };
      }
    });
    if (result instanceof LedgerCredentialError) throw result;
    // Refresh `refreshBeforeSeconds` before exp, or halfway through a token that lives shorter than twice that.
    const lifetimeMs = Math.max(0, result.expiresAtMs - this.#now());
    this.#cached = { token: result.token, refreshAtMs: result.expiresAtMs - Math.min(settings.refreshBeforeSeconds * 1000, lifetimeMs / 2) };
    return result.token;
  }

  toJSON(): { type: "oidc-refresh"; userId: string } {
    return { type: "oidc-refresh", userId: this.userId };
  }
}
