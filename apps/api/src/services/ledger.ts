// Ports to the ledger. The API never talks to Canton directly from route handlers: commands go through a
// LedgerGateway (implemented with @collara/canton in the next stage) and reads go through a
// ProjectionReader over the worker's projections (ledger_contracts / ledger_events).
import type { LedgerCommand } from "@collara/canton";
import {
  ledgerCheckpoints,
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
  | { readonly kind: "committed"; readonly updateId: string; readonly offset: number }
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
}

/** Used until the Canton-backed gateway is wired: every submission fails before reaching a ledger. */
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
    // Registry templates are not projected yet; the next stage maps AssetPassport contracts here.
    assetOwnerOrgId: async () => null,
    verifierEntries: async () => [],
  };
}
