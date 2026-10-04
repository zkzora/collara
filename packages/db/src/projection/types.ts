// Structural view of the normalized ledger updates produced by @collara/canton (events.ts). @collara/db does
// not depend on @collara/canton: the worker passes a LedgerClient, which satisfies ProjectionLedgerClient
// structurally. Keep these shapes in step with packages/canton/src/events.ts.

interface ProjectedEventBase {
  readonly offset: number;
  readonly nodeId: number;
  readonly contractId: string;
  /** Package-id form as served: "<pkgId>:Module:Template". */
  readonly templateId: string;
  /** Package-name form: "#collara-contracts:Module:Template". */
  readonly templateRef: string;
  readonly packageName: string;
  /** Requesting parties that witnessed this event. */
  readonly witnessParties: readonly string[];
}

export interface ProjectionCreatedEvent extends ProjectedEventBase {
  readonly kind: "created";
  readonly createArgument: unknown;
  readonly signatories: readonly string[];
  readonly observers: readonly string[];
  readonly createdAt: string;
}

export interface ProjectionArchivedEvent extends ProjectedEventBase {
  readonly kind: "archived";
}

/** Only present in the LEDGER_EFFECTS shape. */
export interface ProjectionExercisedEvent extends ProjectedEventBase {
  readonly kind: "exercised";
  readonly choice: string;
  readonly choiceArgument: unknown;
  readonly actingParties: readonly string[];
  readonly consuming: boolean;
  readonly exerciseResult: unknown;
  readonly lastDescendantNodeId: number;
  readonly interfaceId?: string;
}

export type ProjectionEvent = ProjectionCreatedEvent | ProjectionArchivedEvent | ProjectionExercisedEvent;

export interface ProjectionTransaction {
  readonly updateId: string;
  readonly offset: number;
  readonly commandId: string;
  readonly workflowId: string;
  readonly effectiveAt: string;
  readonly recordTime: string;
  readonly synchronizerId: string;
  readonly events: readonly ProjectionEvent[];
}

export type ProjectionUpdate =
  | { readonly kind: "transaction"; readonly offset: number; readonly transaction: ProjectionTransaction }
  | { readonly kind: "checkpoint"; readonly offset: number }
  | { readonly kind: "other"; readonly offset?: number; readonly type: string };

export interface ProjectionUpdatesPage {
  readonly updates: readonly ProjectionUpdate[];
  readonly endInclusive: number;
  readonly nextBeginExclusive: number;
  readonly complete: boolean;
}

export interface ProjectionCommandCompletion {
  readonly commandId: string;
  readonly submissionId: string;
  readonly updateId: string;
  readonly offset: number;
  readonly userId: string;
  readonly actAs: readonly string[];
  /** gRPC status: 0 = committed. */
  readonly status: { readonly code: number; readonly message: string };
}

/** The subset of @collara/canton's LedgerClient the projection uses (one instance per ledger user). */
export interface ProjectionLedgerClient {
  participantId(options?: { signal?: AbortSignal }): Promise<string>;
  ledgerEnd(options?: { signal?: AbortSignal }): Promise<number>;
  updates(
    request: {
      beginExclusive: number;
      endInclusive?: number;
      parties: string[];
      shape?: "ACS_DELTA" | "LEDGER_EFFECTS";
      limit?: number;
    },
    options?: { signal?: AbortSignal },
  ): Promise<ProjectionUpdatesPage>;
  /**
   * GET /v2/state/latest-pruned-offsets → participantPrunedUpToInclusive (0 = never pruned). Optional: a client
   * without it is only checked through PARTICIPANT_PRUNED_DATA_ACCESSED errors.
   */
  latestPrunedOffset?(options?: { signal?: AbortSignal }): Promise<number>;
}

/** Completions of one ledger user (used to reconcile UNKNOWN_OUTCOME commands). */
export interface CompletionLedgerClient {
  commandCompletions(
    request: { parties: string[]; beginExclusive: number; limit?: number; idleTimeoutMs?: number },
    options?: { signal?: AbortSignal },
  ): Promise<{ completions: ProjectionCommandCompletion[]; checkpointOffset?: number }>;
  ledgerEnd(options?: { signal?: AbortSignal }): Promise<number>;
}
