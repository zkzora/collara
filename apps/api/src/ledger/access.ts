// Ledger connections for the API: one LedgerClient per ledger user, the participant each user lives on, and reset
// detection (party ids are only valid while the running participant id equals the one in the bootstrap state).
// Tokens: LOCALNET mints HS256 tokens per least-privilege user (sandbox only); DEVNET passes `tokenProviderFor`
// (the tenant user's OIDC refresh-token provider) and never uses HMAC.
import { createHmacTokenProviders, LedgerClient, type HmacTokenSettings, type LedgerTokenProvider } from "@collara/canton";
import { loadLedgerState, namespaceOf, type LedgerState } from "./state";

/** Public dev placeholder of infra/canton/sandbox-auth.conf (also the default of scripts/localnet). */
export const DEV_HMAC_SECRET = "collara-local-dev-secret-change-me";

export interface LedgerAccessOptions {
  readonly state: LedgerState;
  /** HS256 secret of the sandbox's unsafe-jwt-hmac-256 auth (LOCALNET dev only; refused for a DevNet state). */
  readonly secret?: string;
  /** Token provider per ledger user (DEVNET: the tenant's OIDC provider). Takes precedence over `secret`. */
  readonly tokenProviderFor?: (ledgerUserId: string) => LedgerTokenProvider;
  /** Token audience; defaults to the one recorded in the bootstrap state. */
  readonly audience?: string;
  readonly timeoutMs?: number;
  /** submit-and-wait timeout. A timeout is UNKNOWN_OUTCOME, never a failure. */
  readonly submitTimeoutMs?: number;
  readonly fetch?: typeof fetch;
  /** How long a successful participant check is trusted (default 30 s). */
  readonly participantCheckTtlMs?: number;
}

export class LedgerResetError extends Error {
  constructor(source: string, expected: string, actual: string) {
    super(`ledger reset detected on ${source}: bootstrap state has participant ${expected}, the node reports ${actual}; re-run bootstrap and db:bind-localnet`);
    this.name = "LedgerResetError";
  }
}

export class LedgerAccess {
  readonly state: LedgerState;
  readonly namespace: string;
  readonly #tokens: (ledgerUserId: string) => LedgerTokenProvider;
  readonly #clients = new Map<string, LedgerClient>();
  readonly #options: LedgerAccessOptions;
  #checkedAt = new Map<string, number>();

  constructor(options: LedgerAccessOptions) {
    this.#options = options;
    this.state = options.state;
    this.namespace = namespaceOf(options.state);
    if (options.tokenProviderFor) {
      this.#tokens = options.tokenProviderFor;
    } else {
      if (options.state.topology === "devnet-shared-participant") throw new Error("a DevNet state needs the OIDC token provider; HMAC tokens are LOCALNET only");
      if (!options.secret) throw new Error("LedgerAccess needs an HMAC secret (LOCALNET) or tokenProviderFor");
      const settings: HmacTokenSettings = { secret: options.secret, audience: options.audience ?? options.state.audience };
      this.#tokens = createHmacTokenProviders(settings);
    }
  }

  /** Loads the bootstrap state file; null when it does not exist (no LocalNet bootstrap yet). */
  static async fromStateFile(options: Omit<LedgerAccessOptions, "state"> & { path?: string }): Promise<LedgerAccess | null> {
    const state = await loadLedgerState(options.path);
    return state ? new LedgerAccess({ ...options, state }) : null;
  }

  /** Participant source (e.g. "sandbox") hosting a ledger user, per the bootstrap state. */
  sourceOf(ledgerUserId: string): string {
    const user = this.state.users.find((u) => u.id === ledgerUserId);
    return user?.participant ?? Object.keys(this.state.participants)[0] ?? "sandbox";
  }

  /** JSON API client authenticated as one ledger user. */
  client(ledgerUserId: string, source: string = this.sourceOf(ledgerUserId)): LedgerClient {
    const key = `${source}\n${ledgerUserId}`;
    let client = this.#clients.get(key);
    if (!client) {
      const participant = this.state.participants[source];
      if (!participant) throw new Error(`unknown ledger source ${source}`);
      client = new LedgerClient({
        baseUrl: participant.jsonApiUrl,
        tokenProvider: this.#tokens(ledgerUserId),
        ...(this.#options.timeoutMs ? { timeoutMs: this.#options.timeoutMs } : {}),
        ...(this.#options.submitTimeoutMs ? { submitTimeoutMs: this.#options.submitTimeoutMs } : {}),
        ...(this.#options.fetch ? { fetch: this.#options.fetch } : {}),
      });
      this.#clients.set(key, client);
    }
    return client;
  }

  /**
   * Ledger user that acts for an organisation party, or null: the party's own org user (LOCALNET), else the DEVNET
   * tenant user when it holds CanActAs for the party.
   */
  userOfParty(partyId: string): { id: string; participant: string } | null {
    const user =
      this.state.users.find((u) => u.role === "org" && u.primaryParty === partyId) ??
      this.state.users.find((u) => u.role === "tenant" && u.actAs.includes(partyId));
    return user ? { id: user.id, participant: user.participant } : null;
  }

  /** Party id of a logical hint ("DemoManufacturer"). */
  party(hint: string): string {
    const entry = this.state.parties[hint];
    if (!entry) throw new Error(`party ${hint} is not in the LocalNet state`);
    return entry.party;
  }

  /**
   * Throws LedgerResetError when the participant behind `ledgerUserId` (on `source`, default: the user's
   * participant per the bootstrap state) is not the one the bootstrap state was written for (party ids would
   * be invalid). Cached per participant for `participantCheckTtlMs`.
   */
  async assertSameLedger(ledgerUserId: string, source: string = this.sourceOf(ledgerUserId)): Promise<void> {
    const ttl = this.#options.participantCheckTtlMs ?? 30_000;
    const checked = this.#checkedAt.get(source);
    if (checked !== undefined && Date.now() - checked < ttl) return;
    const expected = this.state.participants[source]?.participantId;
    const actual = await this.client(ledgerUserId, source).participantId();
    if (expected !== actual) throw new LedgerResetError(source, expected ?? "(none)", actual);
    this.#checkedAt.set(source, Date.now());
  }
}
