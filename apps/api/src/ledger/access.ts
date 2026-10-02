// Ledger connections for the API: one LedgerClient per least-privilege ledger user (HMAC tokens minted
// per user), the participant each user lives on, and reset detection (party ids are only valid while
// the running participant id equals the one in the bootstrap state).
import { createHmacTokenProviders, LedgerClient, type HmacTokenSettings } from "@collara/canton";
import { loadLedgerState, namespaceOf, type LedgerState } from "./state";

/** Public dev placeholder of infra/canton/sandbox-auth.conf (also the default of scripts/localnet). */
export const DEV_HMAC_SECRET = "collara-local-dev-secret-change-me";

export interface LedgerAccessOptions {
  readonly state: LedgerState;
  /** HS256 secret of the sandbox's unsafe-jwt-hmac-256 auth (dev only). */
  readonly secret: string;
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
  readonly #tokens: ReturnType<typeof createHmacTokenProviders>;
  readonly #clients = new Map<string, LedgerClient>();
  readonly #options: LedgerAccessOptions;
  #checkedAt = new Map<string, number>();

  constructor(options: LedgerAccessOptions) {
    this.#options = options;
    this.state = options.state;
    this.namespace = namespaceOf(options.state);
    const settings: HmacTokenSettings = { secret: options.secret, audience: options.audience ?? options.state.audience };
    this.#tokens = createHmacTokenProviders(settings);
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

  /** Ledger user of an organisation party (role "org" in the bootstrap state), or null. */
  userOfParty(partyId: string): { id: string; participant: string } | null {
    const user = this.state.users.find((u) => u.role === "org" && u.primaryParty === partyId);
    return user ? { id: user.id, participant: user.participant } : null;
  }

  /** Party id of a logical hint ("DemoManufacturer"). */
  party(hint: string): string {
    const entry = this.state.parties[hint];
    if (!entry) throw new Error(`party ${hint} is not in the LocalNet state`);
    return entry.party;
  }

  /**
   * Throws LedgerResetError when the participant behind `ledgerUserId` is not the one the bootstrap state
   * was written for (party ids would be invalid). Cached for `participantCheckTtlMs`.
   */
  async assertSameLedger(ledgerUserId: string): Promise<void> {
    const source = this.sourceOf(ledgerUserId);
    const ttl = this.#options.participantCheckTtlMs ?? 30_000;
    const checked = this.#checkedAt.get(source);
    if (checked !== undefined && Date.now() - checked < ttl) return;
    const expected = this.state.participants[source]?.participantId;
    const actual = await this.client(ledgerUserId, source).participantId();
    if (expected !== actual) throw new LedgerResetError(source, expected ?? "(none)", actual);
    this.#checkedAt.set(source, Date.now());
  }
}
