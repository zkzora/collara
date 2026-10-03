// Raw JSON Ledger API reads for the witness-level privacy test (PRIVACY_IT=1), and the analysis of what each
// party and each participant received. Reads use dedicated ledger users created for the run: one per party
// (CanReadAs that party only, on the party's own participant) and one per participant (CanReadAsAnyParty: the
// operator's view of everything the node stores). Raw responses are kept unchanged for the evidence files.
import { createHmacTokenProviders } from "@collara/canton";
import { z } from "zod";

export interface LedgerNode {
  readonly name: string;
  readonly jsonApiUrl: string;
}

/** Which events a read asks for: those witnessed by these parties, or by any party hosted on the node. */
export type EventScope = { readonly parties: readonly string[] } | { readonly anyParty: true };

type Right = { kind: Record<string, { value: Record<string, string> }> };
export const readAsRight = (party: string): Right => ({ kind: { CanReadAs: { value: { party } } } });
export const readAsAnyPartyRight = (): Right => ({ kind: { CanReadAsAnyParty: { value: {} } } });

const ADMIN_USER = "participant_admin";
const WILDCARD = [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }];

function eventFormat(scope: EventScope) {
  if ("anyParty" in scope) return { filtersForAnyParty: { cumulative: WILDCARD }, verbose: false };
  return { filtersByParty: Object.fromEntries(scope.parties.map((p) => [p, { cumulative: WILDCARD }])), verbose: false };
}

const updateFormat = (scope: EventScope) => ({
  includeTransactions: { transactionShape: "TRANSACTION_SHAPE_LEDGER_EFFECTS", eventFormat: eventFormat(scope) },
});

export class LedgerReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LedgerReadError";
  }
}

/** Minimal JSON API caller with per-user HMAC tokens (dev sandbox only). Tokens are never logged. */
export class LedgerProbe {
  readonly #tokens: ReturnType<typeof createHmacTokenProviders>;

  constructor(settings: { secret: string; audience: string }) {
    this.#tokens = createHmacTokenProviders(settings);
  }

  async call(node: LedgerNode, userId: string, method: "GET" | "POST", path: string, body?: unknown, allow: readonly number[] = []): Promise<{ status: number; body: unknown }> {
    const token = await this.#tokens(userId).getToken();
    const response = await fetch(`${node.jsonApiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // plain-text error bodies stay text
    }
    if (!response.ok && !allow.includes(response.status)) {
      throw new LedgerReadError(`${node.name} ${method} ${path} -> HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
    }
    return { status: response.status, body: parsed };
  }

  /** Creates a read-only ledger user with exactly these rights (fails if it exists with other rights). */
  async ensureReader(node: LedgerNode, id: string, rights: readonly Right[]): Promise<void> {
    const existing = await this.call(node, ADMIN_USER, "GET", `/v2/users/${encodeURIComponent(id)}`, undefined, [404]);
    if (existing.status === 404) {
      await this.call(node, ADMIN_USER, "POST", "/v2/users", { user: { id, primaryParty: "", isDeactivated: false, identityProviderId: "" }, rights });
      return;
    }
    const current = (await this.call(node, ADMIN_USER, "GET", `/v2/users/${encodeURIComponent(id)}/rights`)).body as { rights?: unknown[] };
    const key = (r: unknown) => JSON.stringify(r);
    const have = new Set((current.rights ?? []).map(key));
    const want = new Set(rights.map(key));
    if (have.size !== want.size || [...want].some((r) => !have.has(r))) throw new Error(`reader ${id} on ${node.name} exists with other rights`);
  }

  async ledgerEnd(node: LedgerNode, userId: string): Promise<number> {
    const body = (await this.call(node, userId, "GET", "/v2/state/ledger-end")).body as { offset?: number };
    return body.offset ?? 0;
  }

  /** Every update element (raw JsGetUpdatesResponse) in (beginExclusive, endInclusive], all pages. */
  async updates(node: LedgerNode, userId: string, scope: EventScope, beginExclusive: number, endInclusive: number): Promise<unknown[]> {
    const all: unknown[] = [];
    const limit = 500;
    let begin = beginExclusive;
    while (begin < endInclusive) {
      const page = (await this.call(node, userId, "POST", `/v2/updates?limit=${limit}&stream_idle_timeout_ms=1500`, { beginExclusive: begin, endInclusive, updateFormat: updateFormat(scope) }))
        .body as unknown[];
      all.push(...page);
      if (page.length < limit) break;
      const last = Math.max(...page.map(offsetOfElement));
      if (!(last > begin)) break;
      begin = last;
    }
    return all;
  }

  /**
   * What any reader can get at one offset of this node (transactions and reassignments for any party, and topology
   * events), or null when the node answers UPDATE_NOT_FOUND.
   */
  async updateByOffset(node: LedgerNode, userId: string, offset: number): Promise<unknown | null> {
    const updateFormat = {
      includeTransactions: { transactionShape: "TRANSACTION_SHAPE_LEDGER_EFFECTS", eventFormat: eventFormat({ anyParty: true }) },
      includeReassignments: eventFormat({ anyParty: true }),
      includeTopologyEvents: { includeParticipantAuthorizationEvents: { parties: [] } },
    };
    const response = await this.call(node, userId, "POST", "/v2/updates/update-by-offset", { offset, updateFormat }, [404]);
    return response.status === 404 ? null : response.body;
  }

  /** The transaction with this update id as the scope sees it on this node (raw), or null when the node shows none. */
  async updateById(node: LedgerNode, userId: string, scope: EventScope, updateId: string): Promise<unknown | null> {
    const response = await this.call(node, userId, "POST", "/v2/updates/update-by-id", { updateId, updateFormat: updateFormat(scope) }, [404]);
    return response.status === 404 ? null : response.body;
  }
}

// --- Parsing ---------------------------------------------------------------------------------------------

const Parties = z.array(z.string());
const CreatedSchema = z.object({ contractId: z.string(), templateId: z.string(), nodeId: z.number(), createArgument: z.unknown(), witnessParties: Parties, signatories: Parties, observers: Parties.nullish() }).loose();
const ArchivedSchema = z.object({ contractId: z.string(), templateId: z.string(), nodeId: z.number(), witnessParties: Parties }).loose();
const ExercisedSchema = z
  .object({
    contractId: z.string(),
    templateId: z.string(),
    nodeId: z.number(),
    choice: z.string(),
    choiceArgument: z.unknown(),
    actingParties: Parties,
    consuming: z.boolean(),
    witnessParties: Parties,
    exerciseResult: z.unknown(),
    interfaceId: z.string().nullish(),
  })
  .loose();
const TransactionSchema = z
  .object({ updateId: z.string(), offset: z.number(), recordTime: z.string(), effectiveAt: z.string(), commandId: z.string().nullish(), events: z.array(z.record(z.string(), z.unknown())) })
  .loose();

export interface WitnessedEvent {
  readonly kind: "created" | "exercised" | "archived";
  /** Entity name of the template ("AssetControl"). */
  readonly template: string;
  /** "Module:Entity" ("Collara.Control:AssetControl"). */
  readonly qualifiedTemplate: string;
  readonly contractId: string;
  readonly nodeId: number;
  readonly choice?: string;
  readonly consuming?: boolean;
  readonly actingParties?: readonly string[];
  readonly signatories?: readonly string[];
  readonly observers?: readonly string[];
  readonly witnesses: readonly string[];
  /** createArgument, or { choiceArgument, exerciseResult }; nothing for archived events. */
  readonly payload: unknown;
}

export interface WitnessedTransaction {
  readonly updateId: string;
  readonly offset: number;
  readonly recordTime: string;
  readonly commandId: string;
  readonly events: readonly WitnessedEvent[];
}

/** Offset of a raw update element (transaction, checkpoint, topology), or 0. */
export function offsetOfElement(element: unknown): number {
  const update = (element as { update?: Record<string, { value?: { offset?: number } }> }).update ?? {};
  const [, wrapped] = Object.entries(update)[0] ?? [];
  return wrapped?.value?.offset ?? 0;
}

function qualified(templateId: string): string {
  const [, module = "", entity = ""] = templateId.split(":");
  return `${module}:${entity}`;
}

export function parseEvent(raw: Record<string, unknown>): WitnessedEvent {
  if ("CreatedEvent" in raw) {
    const e = CreatedSchema.parse(raw.CreatedEvent);
    const q = qualified(e.templateId);
    return { kind: "created", template: q.split(":")[1] ?? q, qualifiedTemplate: q, contractId: e.contractId, nodeId: e.nodeId, witnesses: e.witnessParties, signatories: e.signatories, observers: e.observers ?? [], payload: e.createArgument };
  }
  if ("ExercisedEvent" in raw) {
    const e = ExercisedSchema.parse(raw.ExercisedEvent);
    const q = qualified(e.templateId);
    return {
      kind: "exercised",
      template: q.split(":")[1] ?? q,
      qualifiedTemplate: q,
      contractId: e.contractId,
      nodeId: e.nodeId,
      choice: e.choice,
      consuming: e.consuming,
      actingParties: e.actingParties,
      witnesses: e.witnessParties,
      payload: { choiceArgument: e.choiceArgument, exerciseResult: e.exerciseResult },
    };
  }
  const e = ArchivedSchema.parse(raw.ArchivedEvent);
  const q = qualified(e.templateId);
  return { kind: "archived", template: q.split(":")[1] ?? q, qualifiedTemplate: q, contractId: e.contractId, nodeId: e.nodeId, witnesses: e.witnessParties, payload: null };
}

/** The transaction inside a raw update element or update-by-id response, or null (checkpoint, topology). */
export function transactionOf(element: unknown): WitnessedTransaction | null {
  const update = (element as { update?: Record<string, { value?: unknown }> } | null)?.update;
  const tx = update?.Transaction?.value;
  if (!tx) return null;
  const t = TransactionSchema.parse(tx);
  return { updateId: t.updateId, offset: t.offset, recordTime: t.recordTime, commandId: t.commandId ?? "", events: t.events.map(parseEvent) };
}

export const transactionsOf = (elements: readonly unknown[]): WitnessedTransaction[] =>
  elements.map(transactionOf).filter((t): t is WitnessedTransaction => t !== null);

// --- Analysis --------------------------------------------------------------------------------------------

/** Values that must never reach a party outside the borrower/lender pair (and valuation: Lender A only). */
export interface TermMarkers {
  readonly principal: string;
  readonly termMetadata: string;
  readonly externalLegalRef: string;
  readonly valuation: string;
}

export type MarkerName = keyof TermMarkers;

function leaves(value: unknown, out: string[]): string[] {
  if (value === null || value === undefined) return out;
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number" || typeof value === "boolean") out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (typeof value === "object") for (const v of Object.values(value)) leaves(v, out);
  return out;
}

const amountPattern = (amount: string) => new RegExp(`^${amount.replace(/\.0+$/, "").replace(".", "\\.")}(\\.0+)?$`);

/** Which markers appear in an event's payload: exact decimal match for amounts, substring for texts. */
export function markerHits(event: WitnessedEvent, markers: TermMarkers): MarkerName[] {
  const values = leaves(event.payload, []);
  const hits: MarkerName[] = [];
  if (values.some((v) => amountPattern(markers.principal).test(v))) hits.push("principal");
  if (values.some((v) => v.includes(markers.termMetadata))) hits.push("termMetadata");
  if (values.some((v) => v.includes(markers.externalLegalRef))) hits.push("externalLegalRef");
  if (values.some((v) => amountPattern(markers.valuation).test(v))) hits.push("valuation");
  return hits;
}

/** True when any payload value contains the text (e.g. "CL-001"). */
export const mentions = (event: WitnessedEvent, text: string): boolean => leaves(event.payload, []).some((v) => v.includes(text));

export interface TemplateCounts {
  created: number;
  exercised: number;
  archived: number;
  choices: Record<string, number>;
}

export interface StreamSummary {
  transactions: number;
  events: { created: number; exercised: number; archived: number };
  templates: Record<string, TemplateCounts>;
  markerHits: Record<MarkerName, number>;
  /** Events carrying a marker: update id, template, kind/choice, markers. */
  markerEvents: { updateId: string; template: string; kind: string; choice?: string; markers: MarkerName[] }[];
}

export function summarize(txs: readonly WitnessedTransaction[], markers: TermMarkers): StreamSummary {
  const summary: StreamSummary = { transactions: txs.length, events: { created: 0, exercised: 0, archived: 0 }, templates: {}, markerHits: { principal: 0, termMetadata: 0, externalLegalRef: 0, valuation: 0 }, markerEvents: [] };
  for (const tx of txs) {
    for (const e of tx.events) {
      summary.events[e.kind] += 1;
      const t = (summary.templates[e.template] ??= { created: 0, exercised: 0, archived: 0, choices: {} });
      t[e.kind] += 1;
      if (e.choice) t.choices[e.choice] = (t.choices[e.choice] ?? 0) + 1;
      const hits = markerHits(e, markers);
      for (const m of hits) summary.markerHits[m] += 1;
      if (hits.length > 0) summary.markerEvents.push({ updateId: tx.updateId, template: e.template, kind: e.kind, ...(e.choice ? { choice: e.choice } : {}), markers: hits });
    }
  }
  return summary;
}

/** Sorted, de-duplicated labels. */
export const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
