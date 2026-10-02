// Authoritative reads for the write path: the active-contract set as one organisation's ledger user sees it
// right now (not the projections). Every read is filtered by template on the ledger and decoded with the
// template's Zod schema; predicates run on the decoded payload.
import type { ActiveContract, LedgerClient } from "@collara/canton";
import { PAYLOAD_SCHEMAS, type Payload, type PayloadTemplate } from "./contracts";
import { TEMPLATES } from "./templates";

export interface AcsContract<P> {
  readonly contractId: string;
  readonly templateRef: string;
  readonly payload: P;
  readonly signatories: readonly string[];
  readonly observers: readonly string[];
  /** Ledger effective time of the creating transaction. */
  readonly createdAt: string;
  /** Offset of the creating event. */
  readonly offset: number;
}

export class AcsReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcsReadError";
  }
}

/** ACS reads bound to one ledger user and the parties it reads as. */
export class AcsReader {
  readonly client: LedgerClient;
  readonly parties: readonly string[];

  constructor(client: LedgerClient, parties: readonly string[]) {
    if (parties.length === 0) throw new AcsReadError("an ACS reader needs at least one party");
    this.client = client;
    this.parties = parties;
  }

  /** Active contracts of a template visible to the reader's parties, optionally filtered. Oldest first. */
  async list<N extends PayloadTemplate>(name: N, where?: (payload: Payload<N>, contract: AcsContract<Payload<N>>) => boolean): Promise<AcsContract<Payload<N>>[]> {
    const { contracts } = await this.client.activeContracts({ parties: [...this.parties], templateIds: [TEMPLATES[name]] });
    const schema = PAYLOAD_SCHEMAS[name];
    const decoded = contracts.map((contract) => decode(contract, (raw) => schema.parse(raw) as Payload<N>));
    const filtered = where ? decoded.filter((c) => where(c.payload, c)) : decoded;
    return filtered.sort((a, b) => a.offset - b.offset);
  }

  /**
   * The single matching contract, or null when none matches (callers turn null into a 404/409 problem).
   * Throws AcsReadError when several match: that is an invariant breach, never something to pick from.
   */
  async one<N extends PayloadTemplate>(name: N, where?: (payload: Payload<N>) => boolean): Promise<AcsContract<Payload<N>> | null> {
    const rows = await this.list(name, where);
    if (rows.length > 1) throw new AcsReadError(`expected at most one active ${name}, found ${rows.length}`);
    return rows[0] ?? null;
  }

  /** The newest matching contract (e.g. the latest manifest version), or null. */
  async latest<N extends PayloadTemplate>(name: N, where?: (payload: Payload<N>) => boolean): Promise<AcsContract<Payload<N>> | null> {
    const rows = await this.list(name, where);
    return rows.at(-1) ?? null;
  }

  /** An active contract by id (null when archived or not visible to the reader). */
  async get<N extends PayloadTemplate>(name: N, contractId: string): Promise<AcsContract<Payload<N>> | null> {
    const rows = await this.list(name, (_payload, contract) => contract.contractId === contractId);
    return rows[0] ?? null;
  }

  /** Number of active contracts of a template (diagnostics, tests). */
  async count(name: PayloadTemplate): Promise<number> {
    return (await this.list(name)).length;
  }
}

function decode<P>(contract: ActiveContract, parse: (raw: unknown) => P): AcsContract<P> {
  const event = contract.event;
  return {
    contractId: event.contractId,
    templateRef: event.templateRef,
    payload: parse(event.createArgument),
    signatories: event.signatories,
    observers: event.observers,
    createdAt: event.createdAt,
    offset: event.offset,
  };
}
