// Ledger projection library: consumes Canton /v2/updates (LEDGER_EFFECTS) through a structural client
// (@collara/canton's LedgerClient fits) and maintains ledger_sources / ledger_updates / ledger_events /
// ledger_contracts plus the worker-owned command transitions. See README.md next to read-model/.
export { applyTransaction, ProjectionSourceInactiveError, type ApplyOptions, type ApplyResult } from "./apply";
export {
  advanceCommandStatuses,
  reconcileUnknownOutcomes,
  type AdvanceOptions,
  type AdvanceSummary,
  type ReconcileDeps,
  type ReconcileOptions,
  type ReconcileOutcome,
} from "./commands";
export {
  projectOnce,
  resetProjectionSource,
  runProjectionLoop,
  type ProjectionLoopOptions,
  type ProjectionSourceConfig,
  type ProjectionStatus,
  type ProjectOnceOptions,
  type ProjectOnceResult,
  type ResetSummary,
} from "./project";
export {
  extractRefs,
  PROJECTED_PACKAGE_NAMES,
  T as TEMPLATES,
  TEMPLATE_MAPPINGS,
  templateMapping,
  type ExtractedRefs,
  type KnownTemplate,
  type TemplateMapping,
} from "./templates";
export type {
  CompletionLedgerClient,
  ProjectionArchivedEvent,
  ProjectionCommandCompletion,
  ProjectionCreatedEvent,
  ProjectionEvent,
  ProjectionExercisedEvent,
  ProjectionLedgerClient,
  ProjectionTransaction,
  ProjectionUpdate,
  ProjectionUpdatesPage,
} from "./types";
