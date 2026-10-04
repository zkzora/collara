// Ledger connections of the worker: one projector client per participant source (read-only, CanReadAs the
// Collara parties: a documented privileged operator credential, ADR-0001 §2.5) and on-demand completion clients
// for the ledger users whose UNKNOWN_OUTCOME commands are reconciled. DEVNET: one source ("devnet") read through
// the tenant user's OIDC refresh token, with readAs = exactly the bound Collara parties (never any-party).
import {
  createHmacTokenProviders,
  devnetCredentialId,
  devnetOidcSettings,
  devnetStatePath,
  LedgerClient,
  loadLocalnetState,
  OidcRefreshTokenProvider,
  type LocalnetState,
  type OidcLedgerSettings,
} from "@collara/canton";
import { PgRefreshTokenStore, type CompletionLedgerClient, type Db, type ProjectionLedgerClient, type ProjectionSourceConfig } from "@collara/db";
import { DEV_HMAC_SECRET, type WorkerConfig } from "./config";

export interface ProjectionSource {
  readonly config: ProjectionSourceConfig;
  readonly client: ProjectionLedgerClient;
}

export interface WorkerLedger {
  readonly state: LocalnetState;
  readonly sources: readonly ProjectionSource[];
  /** Completions client for a ledger user (null when the user is not in the bootstrap state). */
  completionClient(ledgerUserId: string, source: string | null): CompletionLedgerClient | null;
}

export class LedgerNotBootstrappedError extends Error {
  constructor(path: string | undefined, devnet = false) {
    super(
      devnet
        ? `DevNet state not found${path ? ` at ${path}` : ""}; run node scripts/devnet/import-bindings.mjs`
        : `LocalNet bootstrap state not found${path ? ` at ${path}` : ""}; run node scripts/localnet/bootstrap.mjs`,
    );
    this.name = "LedgerNotBootstrappedError";
  }
}

/**
 * DEVNET: the tenant user projects the shared participant (source "devnet") as exactly the parties bound in the
 * DevNet state. PROJECTION_PARTIES may narrow that set, never widen it.
 */
export async function connectDevnetLedger(
  config: WorkerConfig,
  db: Db,
  // Tests: a local mock issuer (http) and a fake JSON API.
  options: { fetch?: typeof fetch; oidc?: Partial<OidcLedgerSettings> } = {},
): Promise<WorkerLedger> {
  const path = devnetStatePath(config);
  const state = await loadLocalnetState(path);
  if (!state) throw new LedgerNotBootstrappedError(path, true);
  if (state.topology !== "devnet-shared-participant") throw new Error(`${path} is not a DevNet state (topology ${state.topology})`);
  const tenant = state.users.find((u) => u.role === "tenant");
  if (!tenant || tenant.id !== config.DEVNET_LEDGER_USER_ID) {
    throw new Error(`the DevNet state's tenant user (${tenant?.id ?? "none"}) is not DEVNET_LEDGER_USER_ID; re-run scripts/devnet/import-bindings.mjs`);
  }
  const bound = new Set(Object.values(state.parties).map((p) => p.party));
  const parties = config.PROJECTION_PARTIES ?? tenant.readAs.filter((party) => bound.has(party));
  const extra = parties.filter((party) => !bound.has(party));
  if (extra.length) throw new Error(`PROJECTION_PARTIES names parties that are not bound Collara parties: ${extra.join(", ")}`);
  if (parties.length === 0) throw new Error("the DevNet projector reads no parties");
  const provider = new OidcRefreshTokenProvider({
    settings: { ...devnetOidcSettings({ ...config, DEVNET_LEDGER_USER_ID: tenant.id }), ...options.oidc },
    store: new PgRefreshTokenStore(db),
    credentialId: devnetCredentialId(tenant.id),
  });
  const sources: ProjectionSource[] = Object.entries(state.participants).map(([source, participant]) => ({
    config: { source, jsonApiUrl: participant.jsonApiUrl, parties, ledgerUserId: tenant.id },
    client: new LedgerClient({ baseUrl: participant.jsonApiUrl, tokenProvider: provider, timeoutMs: 30_000, ...(options.fetch ? { fetch: options.fetch } : {}) }),
  }));
  const completion = new Map<string, LedgerClient>();
  return {
    state,
    sources,
    completionClient(ledgerUserId, source) {
      const participant = state.participants[source ?? tenant.participant];
      if (ledgerUserId !== tenant.id || !participant) return null;
      let client = completion.get(participant.jsonApiUrl);
      if (!client) {
        client = new LedgerClient({ baseUrl: participant.jsonApiUrl, tokenProvider: provider, timeoutMs: 15_000, ...(options.fetch ? { fetch: options.fetch } : {}) });
        completion.set(participant.jsonApiUrl, client);
      }
      return client;
    },
  };
}

export async function connectLedger(config: WorkerConfig, db?: Db): Promise<WorkerLedger> {
  if (config.COLLARA_MODE === "DEVNET") {
    if (!db) throw new Error("DEVNET needs the database (the refresh token lives in ledger_credentials)");
    return connectDevnetLedger(config, db);
  }
  const state = await loadLocalnetState(config.COLLARA_LOCALNET_STATE);
  if (!state) throw new LedgerNotBootstrappedError(config.COLLARA_LOCALNET_STATE);
  const tokens = createHmacTokenProviders({
    secret: config.CANTON_JWT_HMAC_SECRET ?? DEV_HMAC_SECRET,
    audience: config.CANTON_JWT_AUDIENCE ?? state.audience,
  });
  const single = Object.keys(state.participants).length === 1;
  const urlOf = (participant: string) => {
    const p = state.participants[participant];
    if (!p) throw new Error(`participant ${participant} is not in the bootstrap state`);
    return single && config.CANTON_JSON_API_URL ? config.CANTON_JSON_API_URL : p.jsonApiUrl;
  };

  const wanted = config.PROJECTION_SOURCES ?? Object.keys(state.participants);
  const sources: ProjectionSource[] = wanted.map((source) => {
    const projector = state.users.find(
      (u) => u.participant === source && (config.PROJECTOR_USER ? u.id === config.PROJECTOR_USER : u.role === "projector"),
    );
    const userId = projector?.id ?? config.PROJECTOR_USER;
    if (!userId) throw new Error(`no projector user for participant ${source} in the bootstrap state`);
    const parties = config.PROJECTION_PARTIES ?? projector?.readAs ?? [];
    if (parties.length === 0) throw new Error(`projector user ${userId} on ${source} reads no parties`);
    const jsonApiUrl = urlOf(source);
    return {
      config: { source, jsonApiUrl, parties, ledgerUserId: userId },
      client: new LedgerClient({ baseUrl: jsonApiUrl, tokenProvider: tokens(userId), timeoutMs: 30_000 }),
    };
  });

  const completionClients = new Map<string, LedgerClient>();
  return {
    state,
    sources,
    completionClient(ledgerUserId, source) {
      const user = state.users.find((u) => u.id === ledgerUserId);
      const participant = source ?? user?.participant;
      if (!user || !participant || !state.participants[participant]) return null;
      const key = `${participant}/${ledgerUserId}`;
      let client = completionClients.get(key);
      if (!client) {
        client = new LedgerClient({ baseUrl: urlOf(participant), tokenProvider: tokens(ledgerUserId), timeoutMs: 15_000 });
        completionClients.set(key, client);
      }
      return client;
    },
  };
}
