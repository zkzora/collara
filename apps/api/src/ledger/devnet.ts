// DEVNET ledger access: the shared DevNet participant through ONE tenant ledger user (the team's Keycloak user,
// CanActAs/CanReadAs on every Collara party it was granted). The API still derives authority server-side
// (session → membership → mandate → party binding) and submits with exactly that organisation's party in
// actAs/readAs; the tenant credential is a privileged project-operator credential, not inter-organisation
// credential isolation (docs/devnet.md §3). Tokens come from the rotating OIDC refresh token stored encrypted in
// ledger_credentials (PostgreSQL; key DEVNET_CREDENTIAL_KEY from the environment), never from HMAC.
import {
  devnetCredentialId,
  devnetOidcSettings,
  devnetStatePath,
  OidcRefreshTokenProvider,
  parseCredentialKeyring,
  type CredentialKeyEnv,
  type DevnetEnv,
  type LedgerTokenProvider,
} from "@collara/canton";
import { CredentialCipher, PgRefreshTokenStore, type Db } from "@collara/db";
import { LedgerAccess } from "./access";
import { loadLedgerState, type LedgerState } from "./state";

export type DevnetLedgerEnv = DevnetEnv & { readonly DEVNET_LEDGER_USER_ID?: string | undefined };

export class DevnetStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevnetStateError";
  }
}

/** The tenant user entry of a DevNet state (role "tenant"). */
export function tenantUserOf(state: LedgerState): LedgerState["users"][number] {
  const tenants = state.users.filter((u) => u.role === "tenant");
  const [tenant] = tenants;
  if (tenants.length !== 1 || !tenant) throw new DevnetStateError(`the DevNet state must list exactly one tenant ledger user (found ${tenants.length})`);
  return tenant;
}

/** Checks that a DevNet state matches the configuration (topology, tenant user, endpoint). */
export function assertDevnetState(state: LedgerState, env: DevnetLedgerEnv): void {
  if (state.topology !== "devnet-shared-participant") {
    throw new DevnetStateError(`expected a DevNet state (topology devnet-shared-participant), got ${state.topology}: never point DEVNET at a LocalNet state`);
  }
  const tenant = tenantUserOf(state);
  if (env.DEVNET_LEDGER_USER_ID && tenant.id !== env.DEVNET_LEDGER_USER_ID) {
    throw new DevnetStateError(`the DevNet state was imported for ledger user ${tenant.id}, but DEVNET_LEDGER_USER_ID is ${env.DEVNET_LEDGER_USER_ID}: re-run scripts/devnet/import-bindings.mjs`);
  }
  const urls = Object.values(state.participants).map((p) => p.jsonApiUrl.replace(/\/+$/, ""));
  if (!urls.includes(env.CANTON_DEVNET_JSON_API_URL.replace(/\/+$/, ""))) {
    throw new DevnetStateError("the DevNet state names another JSON Ledger API than CANTON_DEVNET_JSON_API_URL: re-run scripts/devnet/import-bindings.mjs");
  }
}

/** The cipher of the stored refresh token (throws CredentialKeyConfigError, without key material, when unusable). */
export function devnetCredentialCipher(env: CredentialKeyEnv): CredentialCipher {
  return new CredentialCipher(parseCredentialKeyring(env));
}

/** The credential store with this process's key. */
export function devnetCredentialStore(env: CredentialKeyEnv, db: Db): PgRefreshTokenStore {
  return new PgRefreshTokenStore(db, { cipher: devnetCredentialCipher(env) });
}

/** One OIDC refresh-token provider for the tenant user, backed by ledger_credentials. */
export function devnetTokenProvider(env: DevnetLedgerEnv, db: Db, options: { fetch?: typeof fetch } = {}): OidcRefreshTokenProvider {
  if (!env.DEVNET_LEDGER_USER_ID) throw new DevnetStateError("DEVNET_LEDGER_USER_ID is not set");
  const settings = devnetOidcSettings({ ...env, DEVNET_LEDGER_USER_ID: env.DEVNET_LEDGER_USER_ID });
  return new OidcRefreshTokenProvider({
    settings,
    store: devnetCredentialStore(env, db),
    credentialId: devnetCredentialId(env.DEVNET_LEDGER_USER_ID),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/** Token providers keyed by ledger user: only the tenant user exists in DEVNET. */
export function tenantOnly(provider: LedgerTokenProvider & { userId: string }): (ledgerUserId: string) => LedgerTokenProvider {
  return (ledgerUserId) => {
    if (ledgerUserId !== provider.userId) throw new DevnetStateError(`ledger user ${ledgerUserId} is not the DevNet tenant user`);
    return provider;
  };
}

/** LedgerAccess for DEVNET, or null when scripts/devnet/import-bindings.mjs has not written the state yet. */
export async function devnetLedgerAccess(options: {
  readonly env: DevnetLedgerEnv;
  readonly db: Db;
  readonly submitTimeoutMs?: number;
  readonly statePath?: string;
  readonly fetch?: typeof fetch;
}): Promise<LedgerAccess | null> {
  const state = await loadLedgerState(options.statePath ?? devnetStatePath(options.env));
  if (!state) return null;
  assertDevnetState(state, options.env);
  // `fetch` is the JSON API's (tests); the token provider talks to the identity provider with the global fetch.
  const provider = devnetTokenProvider(options.env, options.db);
  return new LedgerAccess({
    state,
    tokenProviderFor: tenantOnly(provider),
    ...(options.submitTimeoutMs ? { submitTimeoutMs: options.submitTimeoutMs } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
