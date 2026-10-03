// Ports to the ledger. The API never talks to Canton directly from route handlers: commands go through a
// LedgerGateway (CantonLedgerGateway in src/ledger/gateway.ts in LOCALNET; the unavailable gateway
// otherwise) via the workflow runner (src/workflow/run.ts), and reads go through a ProjectionReader over
// the worker's projections (ledger_contracts / ledger_events).
import type { LedgerCommand, LedgerTransaction } from "@collara/canton";
import {
  ledgerCheckpoints,
  ledgerContracts,
  loadPartyDirectory,
  payloads,
  TEMPLATES,
  visibleContracts,
  visibleEvents,
  type CommandRow,
  type Db,
  type LedgerContractRow,
  type LedgerEventRow,
  type LedgerSourceRow,
  type VisibleContractsQuery,
  type VisibleEventsQuery,
} from "@collara/db";
import { COMMAND_COPY, type VerifierEntry } from "@collara/domain";
import { and, arrayOverlaps, desc, eq, isNull } from "drizzle-orm";

export interface LedgerSubmitRequest {
  /** Deterministic per command record; reused on every resubmission (Canton deduplication). */
  readonly commandId: string;
  /** New per attempt. */
  readonly submissionId: string;
  /** The organization's least-privilege ledger user. */
  readonly ledgerUserId: string;
  readonly actAs: readonly string[];
  readonly readAs: readonly string[];
  readonly commands: readonly LedgerCommand[];
  /** Participant source to submit through (default: the actor's business party's participant). */
  readonly source?: string;
}

export type LedgerSubmitOutcome =
  | {
      readonly kind: "committed";
      readonly updateId: string;
      readonly offset: number;
      /**
       * The committed transaction as seen by actAs ∪ readAs (LEDGER_EFFECTS shape: created and exercised
       * events, including exercise results), for chaining created contract ids. Optional: a gateway may omit it.
       */
      readonly transaction?: LedgerTransaction;
      /** True when the ledger reported this command id as already committed (DUPLICATE_COMMAND, accepted). */
      readonly deduplicated?: boolean;
    }
  | {
      /** rejected = definitely not committed; failed = never reached the ledger; unknown = may have committed. */
      readonly kind: "rejected" | "failed" | "unknown";
      /** LedgerErrorKind from @collara/canton (e.g. CONTRACT_NOT_FOUND, AUTHORIZATION, UNAVAILABLE, TIMEOUT). */
      readonly errorKind: string;
      readonly code?: string;
      readonly message: string;
      readonly retryAfterMs?: number;
    };

export interface LedgerGateway {
  submit(command: CommandRow, request: LedgerSubmitRequest): Promise<LedgerSubmitOutcome>;
  /**
   * Current ledger end as seen by a ledger user (optional). The runner records it on the command row before
   * the first submission, so the worker reads that user's completions only after it (UNKNOWN_OUTCOME
   * reconciliation, packages/db projection/commands.ts).
   */
  ledgerEnd?(request: { readonly ledgerUserId: string; readonly source?: string }): Promise<number>;
}

/** UI_MOCK, or LOCALNET without a bootstrap state: every submission fails before reaching a ledger (never simulated). */
export const unavailableLedgerGateway: LedgerGateway = {
  async submit() {
    return { kind: "failed", errorKind: "UNAVAILABLE", message: COMMAND_COPY.LEDGER_UNAVAILABLE };
  },
};

/** Party-scoped reads over the projections. Every method takes the caller's parties; none is unscoped. */
export interface ProjectionReader {
  contracts(query: VisibleContractsQuery): Promise<LedgerContractRow[]>;
  events(query: VisibleEventsQuery): Promise<LedgerEventRow[]>;
  checkpoints(): Promise<LedgerSourceRow[]>;
  /** Asset owner organization from projected registry state, or null when not (yet) projected. */
  assetOwnerOrgId(assetRef: string, parties: readonly string[]): Promise<string | null>;
  /**
   * Verifier registry entries visible to the caller. Returns an empty list until the worker projects the
   * Collara governance registry (not implemented in this stage).
   */
  verifierEntries(parties: readonly string[]): Promise<VerifierEntry[]>;
}

export function createDbProjectionReader(db: Db): ProjectionReader {
  return {
    contracts: (query) => visibleContracts(db, query),
    events: (query) => visibleEvents(db, query),
    checkpoints: () => ledgerCheckpoints(db),
    // The owner of the asset's active AssetPassport (owner-only on the ledger, so only the owner's parties find it).
    assetOwnerOrgId: async (assetRef, parties) => {
      if (parties.length === 0) return null;
      const [passport] = await db
        .select({ payload: ledgerContracts.payload })
        .from(ledgerContracts)
        .where(
          and(
            eq(ledgerContracts.templateRef, TEMPLATES.AssetPassport),
            eq(ledgerContracts.businessRef, assetRef),
            isNull(ledgerContracts.archivedOffset),
            arrayOverlaps(ledgerContracts.stakeholders, [...parties]),
          ),
        )
        .orderBy(desc(ledgerContracts.createdOffset))
        .limit(1);
      if (!passport) return null;
      const owner = payloads.decode.passport(payloads.obj(passport.payload)).owner;
      return (await loadPartyDirectory(db)).orgOf(owner);
    },
    verifierEntries: async () => [],
  };
}
