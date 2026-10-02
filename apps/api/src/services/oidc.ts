// OIDC Authorization Code + PKCE (S256) with openid-client 6 (verified against Keycloak 26.7.5, research
// notes §10.1). Tokens stay server-side; the browser only ever holds the session cookie.
import * as client from "openid-client";
import { z } from "zod";
import { oidcConfigured, oidcRedirectUri, type Config } from "../config";

/** Login state kept in the server-side session between /login and /callback. */
export const PendingLoginSchema = z.object({
  state: z.string().min(16),
  nonce: z.string().min(16),
  codeVerifier: z.string().min(43),
  returnTo: z.string(),
  startedAt: z.number(),
});
export type PendingLogin = z.infer<typeof PendingLoginSchema>;

export interface OidcIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly idToken: string | null;
}

export interface OidcService {
  /** Builds the authorization redirect and the state to keep in the session. */
  startLogin(returnTo: string): Promise<{ url: URL; pending: PendingLogin }>;
  /** Exchanges the code (PKCE + state + nonce checks) and returns the verified identity. */
  completeLogin(callbackUrl: URL, pending: PendingLogin): Promise<OidcIdentity>;
  /** RP-initiated logout URL, when the provider supports it. */
  endSessionUrl(idToken: string | null): Promise<URL | null>;
}

export interface AuthorizationRequest {
  readonly redirectUri: string;
  readonly scope: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}

/** Pure URL building (unit-tested): response_type=code with an S256 PKCE challenge, state and nonce. */
export function buildAuthorizationRedirect(configuration: client.Configuration, request: AuthorizationRequest): URL {
  return client.buildAuthorizationUrl(configuration, {
    redirect_uri: request.redirectUri,
    scope: request.scope,
    response_type: "code",
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    state: request.state,
    nonce: request.nonce,
  });
}

/** Relative in-app path only ("/app/cases"); anything else falls back to "/app". */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/app";
  return value.length > 512 ? "/app" : value;
}

export interface OidcServiceOptions {
  /** Pre-built configuration (tests); otherwise discovered from COLLARA_OIDC_ISSUER on first use. */
  readonly configuration?: client.Configuration;
}

export function createOidcService(config: Config, options: OidcServiceOptions = {}): OidcService | null {
  if (!oidcConfigured(config) && !options.configuration) return null;
  const redirectUri = oidcRedirectUri(config);
  const postLogoutRedirectUri = new URL("/", config.PUBLIC_ORIGIN).toString();
  const allowInsecure = config.COLLARA_OIDC_ALLOW_INSECURE_HTTP && config.NODE_ENV === "development";

  let discovered: Promise<client.Configuration> | null = options.configuration ? Promise.resolve(options.configuration) : null;
  function configuration(): Promise<client.Configuration> {
    if (!discovered) {
      if (!oidcConfigured(config)) throw new Error("OIDC is not configured");
      discovered = client
        .discovery(
          new URL(config.COLLARA_OIDC_ISSUER),
          config.COLLARA_OIDC_CLIENT_ID,
          config.COLLARA_OIDC_CLIENT_SECRET,
          undefined,
          // HTTP issuers (local Keycloak) only in development.
          allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
        )
        .catch((error: unknown) => {
          discovered = null; // retry discovery on the next login
          throw error;
        });
    }
    return discovered;
  }

  return {
    async startLogin(returnTo) {
      const codeVerifier = client.randomPKCECodeVerifier();
      const pending: PendingLogin = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        codeVerifier,
        returnTo: safeReturnTo(returnTo),
        startedAt: Date.now(),
      };
      const url = buildAuthorizationRedirect(await configuration(), {
        redirectUri,
        scope: config.COLLARA_OIDC_SCOPES,
        state: pending.state,
        nonce: pending.nonce,
        codeChallenge: await client.calculatePKCECodeChallenge(codeVerifier),
      });
      return { url, pending };
    },

    async completeLogin(callbackUrl, pending) {
      const cfg = await configuration();
      const tokens = await client.authorizationCodeGrant(cfg, callbackUrl, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error("the token response has no ID token");
      const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
      return {
        issuer: claims.iss,
        subject: claims.sub,
        email,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === "string" ? claims.name : null,
        idToken: tokens.id_token ?? null,
      };
    },

    async endSessionUrl(idToken) {
      const cfg = await configuration().catch(() => null);
      if (!cfg?.serverMetadata().end_session_endpoint) return null;
      return client.buildEndSessionUrl(cfg, {
        post_logout_redirect_uri: postLogoutRedirectUri,
        ...(idToken ? { id_token_hint: idToken } : {}),
      });
    },
  };
}
