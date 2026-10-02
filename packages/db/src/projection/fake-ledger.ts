// In-memory ledger for projection and read-model tests: builds normalized transactions (the shape
// @collara/canton produces) and serves them through the ProjectionLedgerClient interface with the same paging
// semantics as LedgerClient.updates. Test support only; never used by production code.
import type {
  CompletionLedgerClient,
  ProjectionCommandCompletion,
  ProjectionEvent,
  ProjectionLedgerClient,
  ProjectionTransaction,
  ProjectionUpdate,
  ProjectionUpdatesPage,
} from "./types";

const PACKAGE_IDS: Readonly<Record<string, string>> = {
  "collara-contracts": "66efe1ca7ce256e5f534503aabb094492627b1a9a53bc583f82819fb7e754c68",
  "collara-governance": "16cb6e82174e020290c7eba779951d25309fd2a23009f09d1ef4154b9bac2d7b",
  "governance-core-v1": "361d1f2800000000000000000000000000000000000000000000000000d488",
};

function parseRef(templateRef: string): { packageName: string; templateId: string } {
  const [pkg, module, entity] = templateRef.replace(/^#/, "").split(":");
  if (!pkg || !module || !entity) throw new Error(`bad template ref ${templateRef}`);
  return { packageName: pkg, templateId: `${PACKAGE_IDS[pkg] ?? "00ff"}:${module}:${entity}` };
}

interface ContractInfo {
  readonly templateRef: string;
  readonly signatories: readonly string[];
  readonly observers: readonly string[];
}

export class TxBuilder {
  readonly events: ProjectionEvent[] = [];
  constructor(
    private readonly ledger: FakeLedger,
    readonly effectiveAt: string,
  ) {}

  create(
    templateRef: string,
    payload: Record<string, unknown>,
    parties: { signatories: readonly string[]; observers?: readonly string[]; witnesses?: readonly string[] },
  ): string {
    const contractId = this.ledger.nextContractId();
    const { packageName, templateId } = parseRef(templateRef);
    const observers = parties.observers ?? [];
    const stakeholders = [...new Set([...parties.signatories, ...observers])];
    this.ledger.contracts.set(contractId, { templateRef, signatories: parties.signatories, observers });
    this.events.push({
      kind: "created",
      offset: 0,
      nodeId: this.events.length,
      contractId,
      templateId,
      templateRef,
      packageName,
      witnessParties: [...new Set([...stakeholders, ...(parties.witnesses ?? [])])],
      createArgument: payload,
      signatories: [...parties.signatories],
      observers: [...observers],
      createdAt: this.effectiveAt,
    });
    return contractId;
  }

  exercise(
    contractId: string,
    choice: string,
    argument: Record<string, unknown>,
    options: { actingParties: readonly string[]; consuming?: boolean; result?: unknown; witnesses?: readonly string[] },
  ): void {
    const info = this.ledger.contracts.get(contractId);
    if (!info) throw new Error(`unknown contract ${contractId}`);
    const { packageName, templateId } = parseRef(info.templateRef);
    this.events.push({
      kind: "exercised",
      offset: 0,
      nodeId: this.events.length,
      contractId,
      templateId,
      templateRef: info.templateRef,
      packageName,
      witnessParties: [...new Set([...info.signatories, ...info.observers, ...options.actingParties, ...(options.witnesses ?? [])])],
      choice,
      choiceArgument: argument,
      actingParties: [...options.actingParties],
      consuming: options.consuming ?? true,
      exerciseResult: options.result ?? null,
      lastDescendantNodeId: this.events.length,
    });
  }

  /** An event of a package the projection does not keep (counted, never stored). */
  foreign(witness: string): void {
    this.events.push({
      kind: "created",
      offset: 0,
      nodeId: this.events.length,
      contractId: this.ledger.nextContractId(),
      templateId: "deadbeef:Other.Module:Thing",
      templateRef: "#other-package:Other.Module:Thing",
      packageName: "other-package",
      witnessParties: [witness],
      createArgument: {},
      signatories: [witness],
      observers: [],
      createdAt: this.effectiveAt,
    });
  }
}

export class FakeLedger implements ProjectionLedgerClient, CompletionLedgerClient {
  participant = "sandbox::1220fake";
  readonly transactions: ProjectionTransaction[] = [];
  readonly contracts = new Map<string, ContractInfo>();
  readonly completions: ProjectionCommandCompletion[] = [];
  /** Offsets consumed by things the projector cannot see (other parties' transactions). */
  private end = 0;
  private cid = 0;
  private clock: number;
  /** Calls to updates() (tests assert paging). */
  updateCalls = 0;
  /** When set, updates() ignores beginExclusive and re-delivers everything (duplicate delivery). */
  redeliverAll = false;

  constructor(start = Date.parse("2026-10-01T08:00:00Z")) {
    this.clock = start;
  }

  nextContractId(): string {
    this.cid += 1;
    return `00${this.cid.toString(16).padStart(8, "0")}cafe`;
  }

  /** Builds and commits one transaction; `build` receives a TxBuilder. Returns the transaction. */
  tx(build: (tx: TxBuilder) => void, options: { commandId?: string; advanceMinutes?: number } = {}): ProjectionTransaction {
    this.clock += (options.advanceMinutes ?? 5) * 60_000;
    const at = new Date(this.clock).toISOString();
    const builder = new TxBuilder(this, at);
    build(builder);
    this.end += 1;
    const offset = this.end;
    const transaction: ProjectionTransaction = {
      updateId: `1220upd${offset.toString().padStart(6, "0")}`,
      offset,
      commandId: options.commandId ?? "",
      workflowId: "",
      effectiveAt: at,
      recordTime: at,
      synchronizerId: "sync::1220",
      events: builder.events.map((e) => ({ ...e, offset })),
    };
    this.transactions.push(transaction);
    return transaction;
  }

  /** A ledger offset with no transaction visible to the projector. */
  invisibleOffset(): void {
    this.end += 1;
  }

  now(): Date {
    return new Date(this.clock);
  }

  async participantId(): Promise<string> {
    return this.participant;
  }

  async ledgerEnd(): Promise<number> {
    return this.end;
  }

  async updates(request: {
    beginExclusive: number;
    endInclusive?: number;
    parties: string[];
    limit?: number;
  }): Promise<ProjectionUpdatesPage> {
    this.updateCalls += 1;
    const endInclusive = request.endInclusive ?? this.end;
    const begin = this.redeliverAll ? 0 : request.beginExclusive;
    if (endInclusive <= begin) return { updates: [], endInclusive, nextBeginExclusive: request.beginExclusive, complete: true };
    const limit = request.limit ?? 200;
    const visible = this.transactions.filter(
      (t) => t.offset > begin && t.offset <= endInclusive && t.events.some((e) => e.witnessParties.some((p) => request.parties.includes(p))),
    );
    const updates: ProjectionUpdate[] = visible
      .slice(0, limit)
      .map((t) => ({ kind: "transaction", offset: t.offset, transaction: filterWitnesses(t, request.parties) }));
    const complete = updates.length < limit;
    const last = updates.reduce((max, u) => (u.offset !== undefined && u.offset > max ? u.offset : max), request.beginExclusive);
    return { updates, endInclusive, nextBeginExclusive: complete ? endInclusive : last, complete };
  }

  async commandCompletions(request: { parties: string[]; beginExclusive: number; limit?: number }) {
    const limit = request.limit ?? 200;
    const completions = this.completions
      .filter((c) => c.offset > request.beginExclusive && c.actAs.some((p) => request.parties.includes(p)))
      .slice(0, limit);
    return { completions };
  }
}

/** Like the ledger: witnessParties lists only the requesting parties that witnessed the event. */
function filterWitnesses(t: ProjectionTransaction, parties: readonly string[]): ProjectionTransaction {
  return {
    ...t,
    events: t.events
      .map((e) => ({ ...e, witnessParties: e.witnessParties.filter((p) => parties.includes(p)) }))
      .filter((e) => e.witnessParties.length > 0),
  };
}
