// DEVNET configuration shared by the API, the worker and scripts/devnet: the shared participant's JSON Ledger API,
// the OIDC public client of the tenant, the tenant ledger user, and the guards that keep DEVNET apart from
// LOCALNET (its own database, its own state file, no HMAC secret). Nothing here is a secret: the refresh token lives
// only in the ledger_credentials table.
import { z } from "zod";
import { LedgerUserIdSchema } from "./auth";
import { defaultDevnetStatePath, isLocalnetStatePath } from "./localnet-state";
import { devnetCredentialId, type OidcLedgerSettings } from "./oidc";

/** HackCanton DevNet tenant defaults (organisers' NODERS guide). The ledger user id has no default. */
export const DEVNET_DEFAULTS = {
  jsonApiUrl: "https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services",
  issuer: "https://keycloak.naas.noders.services/realms/noders-appsfactory",
  clientId: "web-app-ui-hackcanton-01-devnet",
  scope: "openid daml_ledger_api offline_access",
  audience: "https://hackcanton-01.devnet.naas.noders.services",
} as const;

/** Database names DEVNET must never use (the LocalNet demo and test databases). */
export const LOCALNET_DATABASE_NAMES = ["collara", "collara_test"] as const;

export const DevnetEnvSchema = z.object({
  CANTON_DEVNET_JSON_API_URL: z.url({ protocol: /^https$/ }).default(DEVNET_DEFAULTS.jsonApiUrl),
  DEVNET_OIDC_ISSUER: z.url({ protocol: /^https$/ }).default(DEVNET_DEFAULTS.issuer),
  /** Default `<issuer>/protocol/openid-connect/token`. */
  DEVNET_OIDC_TOKEN_ENDPOINT: z.url({ protocol: /^https$/ }).optional(),
  /** Default `<issuer>/protocol/openid-connect/certs`. */
  DEVNET_OIDC_JWKS_URI: z.url({ protocol: /^https$/ }).optional(),
  DEVNET_OIDC_CLIENT_ID: z.string().min(1).default(DEVNET_DEFAULTS.clientId),
  DEVNET_OIDC_SCOPE: z.string().min(1).default(DEVNET_DEFAULTS.scope),
  /** Must be one of the access token's `aud` values. */
  DEVNET_LEDGER_AUDIENCE: z.string().min(1).default(DEVNET_DEFAULTS.audience),
  /** The tenant's ledger user id (the JWT `sub`), printed by scripts/devnet/login.mjs. */
  DEVNET_LEDGER_USER_ID: LedgerUserIdSchema.optional(),
  /** Default <repo>/.local/devnet/state.json. */
  COLLARA_DEVNET_STATE: z.string().min(1).optional(),
});
export type DevnetEnv = z.output<typeof DevnetEnvSchema>;

export interface DevnetGuardInput {
  readonly DATABASE_URL?: string | undefined;
  readonly COLLARA_LOCALNET_STATE?: string | undefined;
  readonly COLLARA_DEVNET_STATE?: string | undefined;
  readonly CANTON_JWT_HMAC_SECRET?: string | undefined;
}

/**
 * Reasons DEVNET must refuse to start (empty = fine): a LocalNet database or state file, or an HMAC secret.
 * DEVNET's database name must contain "devnet" (e.g. collara_devnet) so it can never be the LocalNet demo database.
 */
export function devnetGuardIssues(env: DevnetGuardInput): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (!env.DATABASE_URL) {
    issues.push({ path: "DATABASE_URL", message: "DEVNET needs its own PostgreSQL database (e.g. …/collara_devnet)" });
  } else {
    let name = "";
    try {
      name = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ""));
    } catch {
      issues.push({ path: "DATABASE_URL", message: "DATABASE_URL is not a URL" });
    }
    if (name && ((LOCALNET_DATABASE_NAMES as readonly string[]).includes(name) || !name.includes("devnet"))) {
      issues.push({
        path: "DATABASE_URL",
        message: `DEVNET refuses database "${name}": use a dedicated database whose name contains "devnet" (never the LocalNet demo database)`,
      });
    }
  }
  if (env.COLLARA_LOCALNET_STATE) {
    issues.push({ path: "COLLARA_LOCALNET_STATE", message: "DEVNET never reads a LocalNet state file: unset COLLARA_LOCALNET_STATE (DEVNET uses COLLARA_DEVNET_STATE)" });
  }
  if (env.COLLARA_DEVNET_STATE && isLocalnetStatePath(env.COLLARA_DEVNET_STATE)) {
    issues.push({ path: "COLLARA_DEVNET_STATE", message: "COLLARA_DEVNET_STATE points at a LocalNet state file (.local/localnet/state*.json)" });
  }
  if (env.CANTON_JWT_HMAC_SECRET) {
    issues.push({ path: "CANTON_JWT_HMAC_SECRET", message: "DEVNET refuses HMAC ledger tokens: unset CANTON_JWT_HMAC_SECRET (LOCALNET only)" });
  }
  return issues;
}

/** Token provider settings for the tenant ledger user. */
export function devnetOidcSettings(env: DevnetEnv & { DEVNET_LEDGER_USER_ID: string }): OidcLedgerSettings {
  return {
    issuer: env.DEVNET_OIDC_ISSUER,
    ...(env.DEVNET_OIDC_TOKEN_ENDPOINT ? { tokenEndpoint: env.DEVNET_OIDC_TOKEN_ENDPOINT } : {}),
    ...(env.DEVNET_OIDC_JWKS_URI ? { jwksUri: env.DEVNET_OIDC_JWKS_URI } : {}),
    clientId: env.DEVNET_OIDC_CLIENT_ID,
    scope: env.DEVNET_OIDC_SCOPE,
    audience: env.DEVNET_LEDGER_AUDIENCE,
    ledgerUserId: env.DEVNET_LEDGER_USER_ID,
  };
}

export function devnetStatePath(env: Pick<DevnetEnv, "COLLARA_DEVNET_STATE">): string {
  return env.COLLARA_DEVNET_STATE ?? defaultDevnetStatePath();
}

export { devnetCredentialId };
