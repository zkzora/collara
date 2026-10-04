// Test support (import "@collara/canton/testing"): a local OIDC issuer on 127.0.0.1 with an RS256 JWKS and a
// token endpoint that ROTATES refresh tokens like the DevNet Keycloak (each refresh token works once; a reused or
// revoked one gets `invalid_grant`). Never imported by production code.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";

export interface MockIssuerClaims {
  sub: string;
  aud: string | string[];
  scope: string;
  /** Seconds from now (negative = already expired). */
  expiresIn: number;
  /** Overrides the signing key (e.g. a key the JWKS does not list). */
  signWith?: CryptoKey;
  /** Overrides `iss`. */
  iss?: string;
}

export interface MockOidcIssuer {
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly clientId: string;
  /** Claims of the next access tokens (mutable between calls). */
  claims: MockIssuerClaims;
  /** Number of successful refresh_token grants. */
  readonly refreshCount: () => number;
  /** Number of refresh_token grants that presented an already-used refresh token. */
  readonly reuseCount: () => number;
  /** Issues a fresh refresh token, as a password grant would (test setup). */
  issueRefreshToken(): string;
  /** Revokes every outstanding refresh token (the session ended). */
  revokeAll(): void;
  /** Delay before each token response, to widen race windows. */
  delayMs: number;
  /** A key pair the JWKS does not list. */
  readonly foreignKey: CryptoKey;
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startMockOidcIssuer(options: { clientId?: string; claims: MockIssuerClaims; users?: Record<string, string> }): Promise<MockOidcIssuer> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const foreign = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "mock-1", alg: "RS256", use: "sig" };
  const clientId = options.clientId ?? "mock-public-client";
  const live = new Set<string>();
  const spent = new Set<string>();
  let refreshes = 0;
  let reuses = 0;
  let server: Server | null = null;
  let issuerUrl = "";

  const issueRefresh = () => {
    const token = `rt-${randomUUID()}`;
    live.add(token);
    return token;
  };

  const state = {
    claims: options.claims,
    delayMs: 0,
  };

  const accessToken = async () => {
    const c = state.claims;
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ scope: c.scope, azp: clientId })
      .setProtectedHeader({ alg: "RS256", kid: "mock-1", typ: "JWT" })
      .setIssuer(c.iss ?? issuerUrl)
      .setSubject(c.sub)
      .setAudience(c.aud)
      .setIssuedAt(now)
      .setExpirationTime(now + c.expiresIn)
      .sign(c.signWith ?? privateKey);
  };

  server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", issuerUrl);
      if (request.method === "GET" && url.pathname === "/realm/protocol/openid-connect/certs") return json(response, 200, { keys: [jwk] });
      if (request.method === "POST" && url.pathname === "/realm/protocol/openid-connect/token") {
        const form = new URLSearchParams(await readBody(request));
        if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
        if (form.get("client_id") !== clientId) return json(response, 401, { error: "invalid_client" });
        const grant = form.get("grant_type");
        if (grant === "refresh_token") {
          const presented = form.get("refresh_token") ?? "";
          if (!live.has(presented)) {
            if (spent.has(presented)) reuses++;
            return json(response, 400, { error: "invalid_grant", error_description: "Token is not active" });
          }
          live.delete(presented);
          spent.add(presented);
          refreshes++;
          return json(response, 200, { access_token: await accessToken(), token_type: "Bearer", expires_in: state.claims.expiresIn, refresh_token: issueRefresh(), scope: state.claims.scope });
        }
        if (grant === "password") {
          const users = options.users ?? {};
          if (users[form.get("username") ?? ""] !== form.get("password")) return json(response, 401, { error: "invalid_grant", error_description: "Invalid user credentials" });
          return json(response, 200, { access_token: await accessToken(), token_type: "Bearer", expires_in: state.claims.expiresIn, refresh_token: issueRefresh(), scope: state.claims.scope });
        }
        return json(response, 400, { error: "unsupported_grant_type" });
      }
      json(response, 404, { error: "not_found" });
    })().catch(() => json(response, 500, { error: "server_error" }));
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  issuerUrl = `http://127.0.0.1:${port}/realm`;

  return {
    issuer: issuerUrl,
    tokenEndpoint: `${issuerUrl}/protocol/openid-connect/token`,
    jwksUri: `${issuerUrl}/protocol/openid-connect/certs`,
    clientId,
    get claims() {
      return state.claims;
    },
    set claims(value) {
      state.claims = value;
    },
    get delayMs() {
      return state.delayMs;
    },
    set delayMs(value) {
      state.delayMs = value;
    },
    refreshCount: () => refreshes,
    reuseCount: () => reuses,
    issueRefreshToken: issueRefresh,
    revokeAll: () => live.clear(),
    foreignKey: foreign.privateKey,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server?.closeAllConnections();
        server?.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
