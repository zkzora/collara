import { randomUUID } from "node:crypto";
import createClient, { type Client } from "openapi-fetch";
import { z } from "zod";
import type { LedgerTokenProvider } from "./auth";
import type { DeduplicationPeriod, DisclosedContract, LedgerCommand, TemplateId } from "./commands";
import { classifyLedgerError, LedgerError } from "./errors";
import {
  normalizeActiveContract,
  normalizeTransaction,
  normalizeUpdate,
  type ActiveContract,
  type LedgerTransaction,
  type LedgerUpdate,
} from "./events";
import type { components, paths } from "./generated/ledger-api";

type Schemas = components["schemas"];
export type PartyDetails = Schemas["PartyDetails"];
export type LedgerUser = Schemas["User"];
export type LedgerRight = Schemas["Right"];
export type LedgerVersion = Schemas["GetLedgerApiVersionResponse"];

export type TransactionShape = "ACS_DELTA" | "LEDGER_EFFECTS";

export const LedgerClientOptionsSchema = z.object({
  /** JSON Ledger API base URL, e.g. http://127.0.0.1:7575 */
  baseUrl: z.url().transform((url) => url.replace(/\/+$/, "")),
  /** Timeout for reads and admin calls. */
  timeoutMs: z.number().int().positive().default(30_000),
  /** Timeout for submit-and-wait calls. A timeout is UNKNOWN_OUTCOME, never a failure. */
  submitTimeoutMs: z.number().int().positive().default(60_000),
});

export interface LedgerClientOptions extends z.input<typeof LedgerClientOptionsSchema> {
  /** Supplies the bearer token. Omit only for unauthenticated sandboxes. */
  tokenProvider?: LedgerTokenProvider;
  /** Custom fetch (tests). */
  fetch?: typeof fetch;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const SubmitRequestSchema = z.object({
  /** Deterministic per idempotency record; resubmitting it deduplicates (change id = user, actAs, commandId). */
  commandId: z.string().min(1).max(255),
  /** New per attempt; defaults to a random UUID. */
  submissionId: z.string().min(1).max(255).optional(),
  actAs: z.array(z.string().min(1)).min(1),
  readAs: z.array(z.string().min(1)).optional(),
  commands: z.array(z.custom<LedgerCommand>((v) => typeof v === "object" && v !== null)).min(1),
  /** Defaults to the token's user (`sub`). */
  userId: z.string().min(1).optional(),
  workflowId: z.string().optional(),
  deduplicationPeriod: z.custom<DeduplicationPeriod>().optional(),
  disclosedContracts: z.array(z.custom<DisclosedContract>()).optional(),
  synchronizerId: z.string().optional(),
});
export type SubmitRequest = z.input<typeof SubmitRequestSchema>;

export interface PartyFilter {
  parties: string[];
  /** Restrict to these templates (package-name ids); all templates when omitted. */
  templateIds?: TemplateId[];
  includeCreatedEventBlob?: boolean;
}

export interface UpdatesRequest extends PartyFilter {
  beginExclusive: number;
  /** Defaults to the current ledger end, so the call terminates. */
  endInclusive?: number;
  shape?: TransactionShape;
  /** Maximum number of elements per call (transactions and checkpoints). */
  limit?: number;
}

export interface UpdatesPage {
  updates: LedgerUpdate[];
  endInclusive: number;
  /** Offset to pass as `beginExclusive` on the next call. */
  nextBeginExclusive: number;
  /** True when every update up to `endInclusive` was returned. */
  complete: boolean;
}

export interface CommandCompletion {
  commandId: string;
  submissionId: string;
  updateId: string;
  offset: number;
  userId: string;
  actAs: string[];
  /** gRPC status: 0 = committed. */
  status: { code: number; message: string };
}

const CompletionSchema = z.object({
  commandId: z.string(),
  submissionId: z.string().nullish(),
  updateId: z.string().nullish(),
  offset: z.number(),
  userId: z.string(),
  actAs: z.array(z.string()),
  status: z.object({ code: z.number(), message: z.string().nullish() }).nullish(),
});

const SHAPES: Record<TransactionShape, Schemas["TransactionFormat"]["transactionShape"]> = {
  ACS_DELTA: "TRANSACTION_SHAPE_ACS_DELTA",
  LEDGER_EFFECTS: "TRANSACTION_SHAPE_LEDGER_EFFECTS",
};

function eventFormat({ parties, templateIds, includeCreatedEventBlob = false }: PartyFilter): Schemas["EventFormat"] {
  const cumulative: Schemas["CumulativeFilter"][] = templateIds?.length
    ? templateIds.map((templateId) => ({
        identifierFilter: { TemplateFilter: { value: { templateId, includeCreatedEventBlob } } },
      }))
    : [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob } } } }];
  return { filtersByParty: Object.fromEntries(parties.map((p) => [p, { cumulative }])), verbose: false };
}

/**
 * Typed client for the Canton JSON Ledger API v2 (3.5.19 spec in openapi/). Every failure is
 * thrown as LedgerError with a classification (see errors.ts). Tokens are only placed in the
 * Authorization header and never appear in errors.
 */
export class LedgerClient {
  readonly baseUrl: string;
  readonly #options: z.output<typeof LedgerClientOptionsSchema>;
  readonly #tokens: LedgerTokenProvider | undefined;
  readonly #fetch: typeof fetch;
  readonly #http: Client<paths>;

  constructor(options: LedgerClientOptions) {
    this.#options = LedgerClientOptionsSchema.parse(options);
    this.baseUrl = this.#options.baseUrl;
    this.#tokens = options.tokenProvider;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#http = createClient<paths>({ baseUrl: this.baseUrl, fetch: (request) => this.#fetch(request) });
  }

  /** Same endpoint and settings, different ledger user. */
  withTokenProvider(tokenProvider: LedgerTokenProvider): LedgerClient {
    return new LedgerClient({ ...this.#options, tokenProvider, fetch: this.#fetch });
  }

  get userId(): string | undefined {
    return this.#tokens?.userId;
  }

  async #call<T>(
    operation: string,
    options: CallOptions | undefined,
    defaultTimeoutMs: number,
    run: (init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
      data?: unknown;
      error?: unknown;
      response: Response;
    }>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(options?.timeoutMs ?? defaultTimeoutMs);
      const signal = options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
      let result: Awaited<ReturnType<typeof run>>;
      try {
        const headers: Record<string, string> = {};
        if (this.#tokens) headers.Authorization = `Bearer ${await this.#tokens.getToken(signal)}`;
        result = await run({ headers, signal });
      } catch (error) {
        throw new LedgerError(operation, classifyLedgerError({ error: signal.reason ?? error }));
      }
      if (result.response.ok) return result.data as T;
      // 401 means the request was not processed; retry once with a fresh token.
      if (result.response.status === 401 && attempt === 0 && this.#tokens?.invalidate) {
        this.#tokens.invalidate();
        continue;
      }
      throw new LedgerError(operation, classifyLedgerError({ status: result.response.status, body: result.error }));
    }
  }

  // Health and metadata ---------------------------------------------------------------------

  /** GET /readyz: 200 once the participant is connected to a synchronizer. Never throws. */
  async readyz(options?: CallOptions): Promise<{ ready: boolean; status: number; detail: string }> {
    try {
      const response = await this.#fetch(`${this.baseUrl}/readyz`, {
        signal: options?.signal ?? AbortSignal.timeout(options?.timeoutMs ?? 5_000),
      });
      return { ready: response.status === 200, status: response.status, detail: (await response.text()).trim() };
    } catch (error) {
      return { ready: false, status: 0, detail: classifyLedgerError({ error }).message };
    }
  }

  version(options?: CallOptions): Promise<LedgerVersion> {
    return this.#call("version", options, this.#options.timeoutMs, (init) => this.#http.GET("/v2/version", init));
  }

  async participantId(options?: CallOptions): Promise<string> {
    const body = await this.#call<Schemas["GetParticipantIdResponse"]>(
      "participantId",
      options,
      this.#options.timeoutMs,
      (init) => this.#http.GET("/v2/parties/participant-id", init),
    );
    return body.participantId;
  }

  async ledgerEnd(options?: CallOptions): Promise<number> {
    const body = await this.#call<Schemas["GetLedgerEndResponse"]>("ledgerEnd", options, this.#options.timeoutMs, (init) =>
      this.#http.GET("/v2/state/ledger-end", init),
    );
    return body.offset ?? 0;
  }

  // Parties, users, packages (admin) ----------------------------------------------------------

  async allocateParty(
    request: { partyIdHint: string; userId?: string; synchronizerId?: string },
    options?: CallOptions,
  ): Promise<PartyDetails> {
    const body = await this.#call<Schemas["AllocatePartyResponse"]>(
      "allocateParty",
      options,
      this.#options.timeoutMs,
      (init) => this.#http.POST("/v2/parties", { ...init, body: { identityProviderId: "", ...request } }),
    );
    return body.partyDetails;
  }

  async listParties(
    page: { pageSize?: number; pageToken?: string } = {},
    options?: CallOptions,
  ): Promise<{ parties: PartyDetails[]; nextPageToken?: string }> {
    const body = await this.#call<Schemas["ListKnownPartiesResponse"]>(
      "listParties",
      options,
      this.#options.timeoutMs,
      (init) => this.#http.GET("/v2/parties", { ...init, params: { query: page } }),
    );
    return { parties: body.partyDetails, ...(body.nextPageToken ? { nextPageToken: body.nextPageToken } : {}) };
  }

  async createUser(
    user: { id: string; primaryParty?: string; rights: LedgerRight[] },
    options?: CallOptions,
  ): Promise<LedgerUser> {
    const body = await this.#call<Schemas["CreateUserResponse"]>("createUser", options, this.#options.timeoutMs, (init) =>
      this.#http.POST("/v2/users", {
        ...init,
        body: {
          user: { id: user.id, primaryParty: user.primaryParty ?? "", isDeactivated: false, identityProviderId: "" },
          rights: user.rights,
        },
      }),
    );
    return body.user;
  }

  /** Returns null when the user does not exist. */
  async getUser(userId: string, options?: CallOptions): Promise<LedgerUser | null> {
    try {
      const body = await this.#call<Schemas["GetUserResponse"]>("getUser", options, this.#options.timeoutMs, (init) =>
        this.#http.GET("/v2/users/{user-id}", { ...init, params: { path: { "user-id": userId } } }),
      );
      return body.user;
    } catch (error) {
      if (error instanceof LedgerError && error.info.code === "USER_NOT_FOUND") return null;
      throw error;
    }
  }

  async listUserRights(userId: string, options?: CallOptions): Promise<LedgerRight[]> {
    const body = await this.#call<Schemas["ListUserRightsResponse"]>(
      "listUserRights",
      options,
      this.#options.timeoutMs,
      (init) => this.#http.GET("/v2/users/{user-id}/rights", { ...init, params: { path: { "user-id": userId } } }),
    );
    return body.rights ?? [];
  }

  /** Grants rights; returns the ones that were not already granted. */
  async grantUserRights(userId: string, rightsToGrant: LedgerRight[], options?: CallOptions): Promise<LedgerRight[]> {
    const body = await this.#call<Schemas["GrantUserRightsResponse"]>(
      "grantUserRights",
      options,
      this.#options.timeoutMs,
      (init) =>
        this.#http.POST("/v2/users/{user-id}/rights", {
          ...init,
          params: { path: { "user-id": userId } },
          body: { userId, rights: rightsToGrant, identityProviderId: "" },
        }),
    );
    return body.newlyGrantedRights ?? [];
  }

  /** POST /v2/dars (binary body). Uploading the same DAR again is a no-op. */
  async uploadDar(dar: Uint8Array, { vetAllPackages = true } = {}, options?: CallOptions): Promise<void> {
    await this.#call("uploadDar", options, Math.max(this.#options.timeoutMs, 120_000), (init) =>
      this.#http.POST("/v2/dars", {
        ...init,
        params: { query: { vetAllPackages } },
        headers: { ...init.headers, "Content-Type": "application/octet-stream" },
        // The spec types the binary body as string; send the bytes unchanged.
        body: dar as unknown as string,
        bodySerializer: (body: unknown) => body as NonNullable<RequestInit["body"]>,
      }),
    );
  }

  // Commands ------------------------------------------------------------------------------------

  #commands(request: SubmitRequest): Schemas["JsCommands"] {
    const r = SubmitRequestSchema.parse(request);
    return {
      commands: r.commands,
      commandId: r.commandId,
      submissionId: r.submissionId ?? randomUUID(),
      actAs: r.actAs,
      ...(r.readAs ? { readAs: r.readAs } : {}),
      ...(r.userId ? { userId: r.userId } : {}),
      ...(r.workflowId ? { workflowId: r.workflowId } : {}),
      ...(r.deduplicationPeriod ? { deduplicationPeriod: r.deduplicationPeriod } : {}),
      ...(r.disclosedContracts ? { disclosedContracts: r.disclosedContracts } : {}),
      ...(r.synchronizerId ? { synchronizerId: r.synchronizerId } : {}),
    };
  }

  /** POST /v2/commands/submit-and-wait: returns the update id and completion offset. */
  submitAndWait(request: SubmitRequest, options?: CallOptions): Promise<{ updateId: string; completionOffset: number }> {
    const body = this.#commands(request);
    return this.#call("submitAndWait", options, this.#options.submitTimeoutMs, (init) =>
      this.#http.POST("/v2/commands/submit-and-wait", { ...init, body }),
    );
  }

  /**
   * POST /v2/commands/submit-and-wait-for-transaction. The returned events are those visible to
   * the actAs/readAs parties, in the requested shape (default ACS_DELTA).
   */
  async submitAndWaitForTransaction(
    request: SubmitRequest & { shape?: TransactionShape },
    options?: CallOptions,
  ): Promise<LedgerTransaction> {
    const commands = this.#commands(request);
    const visible = [...commands.actAs, ...(commands.readAs ?? [])];
    const body = await this.#call<Schemas["JsSubmitAndWaitForTransactionResponse"]>(
      "submitAndWaitForTransaction",
      options,
      this.#options.submitTimeoutMs,
      (init) =>
        this.#http.POST("/v2/commands/submit-and-wait-for-transaction", {
          ...init,
          body: {
            commands,
            transactionFormat: {
              transactionShape: SHAPES[request.shape ?? "ACS_DELTA"],
              eventFormat: eventFormat({ parties: visible }),
            },
          },
        }),
    );
    return normalizeTransaction(body.transaction);
  }

  // Reads ---------------------------------------------------------------------------------------

  /** Active contracts visible to the parties at `activeAtOffset` (default: current ledger end), all pages. */
  async activeContracts(
    request: PartyFilter & { activeAtOffset?: number; pageSize?: number },
    options?: CallOptions,
  ): Promise<{ activeAtOffset: number; contracts: ActiveContract[] }> {
    const activeAtOffset = request.activeAtOffset ?? (await this.ledgerEnd(options));
    const contracts: ActiveContract[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.#call<Schemas["JsGetActiveContractsPageResponse"]>(
        "activeContracts",
        options,
        this.#options.timeoutMs,
        (init) =>
          this.#http.POST("/v2/state/active-contracts-page", {
            ...init,
            body: {
              activeAtOffset,
              eventFormat: eventFormat(request),
              maxPageSize: request.pageSize ?? 500,
              ...(pageToken ? { pageToken } : {}),
            },
          }),
      );
      for (const entry of page.activeContracts) {
        const contract = normalizeActiveContract(entry);
        if (contract) contracts.push(contract);
      }
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
    return { activeAtOffset, contracts };
  }

  /**
   * One bounded poll of POST /v2/updates for the given parties. Loop with
   * `beginExclusive = page.nextBeginExclusive` until `complete`, and persist that offset.
   */
  async updates(request: UpdatesRequest, options?: CallOptions): Promise<UpdatesPage> {
    const endInclusive = request.endInclusive ?? (await this.ledgerEnd(options));
    if (endInclusive <= request.beginExclusive) {
      return { updates: [], endInclusive, nextBeginExclusive: request.beginExclusive, complete: true };
    }
    const limit = request.limit ?? 200;
    const raw = await this.#call<Schemas["JsGetUpdatesResponse"][]>("updates", options, this.#options.timeoutMs, (init) =>
      this.#http.POST("/v2/updates", {
        ...init,
        params: { query: { limit, stream_idle_timeout_ms: 1_000 } },
        body: {
          beginExclusive: request.beginExclusive,
          endInclusive,
          updateFormat: {
            includeTransactions: {
              transactionShape: SHAPES[request.shape ?? "ACS_DELTA"],
              eventFormat: eventFormat(request),
            },
          },
        },
      }),
    );
    const updates = raw.map(normalizeUpdate);
    const complete = updates.length < limit;
    const lastOffset = updates.reduce((max, u) => (u.offset !== undefined && u.offset > max ? u.offset : max), request.beginExclusive);
    return { updates, endInclusive, nextBeginExclusive: complete ? endInclusive : lastOffset, complete };
  }

  /**
   * Completions of the token's user for the given parties after `beginExclusive`
   * (POST /v2/commands/command-completions). Interpretation failures emit no completion;
   * dedup rejections do. Used to reconcile UNKNOWN_OUTCOME commands.
   */
  async commandCompletions(
    request: { parties: string[]; beginExclusive: number; limit?: number; idleTimeoutMs?: number },
    options?: CallOptions,
  ): Promise<{ completions: CommandCompletion[]; checkpointOffset?: number }> {
    const raw = await this.#call<Schemas["CompletionStreamResponse"][]>(
      "commandCompletions",
      options,
      this.#options.timeoutMs,
      (init) =>
        this.#http.POST("/v2/commands/command-completions", {
          ...init,
          params: { query: { limit: request.limit ?? 200, stream_idle_timeout_ms: request.idleTimeoutMs ?? 1_000 } },
          body: { parties: request.parties, beginExclusive: request.beginExclusive },
        }),
    );
    const completions: CommandCompletion[] = [];
    let checkpointOffset: number | undefined;
    for (const item of raw) {
      const response = item.completionResponse;
      if (response && "Completion" in response) {
        const c = CompletionSchema.parse(response.Completion.value);
        completions.push({
          commandId: c.commandId,
          submissionId: c.submissionId ?? "",
          updateId: c.updateId ?? "",
          offset: c.offset,
          userId: c.userId,
          actAs: c.actAs,
          status: { code: c.status?.code ?? 0, message: c.status?.message ?? "" },
        });
      } else if (response && "OffsetCheckpoint" in response) {
        checkpointOffset = response.OffsetCheckpoint.value.offset;
      }
    }
    return { completions, ...(checkpointOffset !== undefined ? { checkpointOffset } : {}) };
  }
}
