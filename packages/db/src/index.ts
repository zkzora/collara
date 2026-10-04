// @collara/db — server-only persistence: Drizzle schema, committed SQL migrations, scoped queries.
export * from "./schema";
export {
  createPgDatabase,
  createPgliteDatabase,
  MIGRATIONS_FOLDER,
  type Db,
  type DbHandle,
  type DbOrTx,
  type PgOptions,
  type Schema,
} from "./client";
export { seedDemoIdentities, type SeedSummary } from "./seed";
export {
  currentLedgerEnvironment,
  GOVERNANCE_PARTY_HINT,
  importLocalnetState,
  type LedgerEnvironment,
  type BindingImportSummary,
  type LocalnetBindingSource,
} from "./bindings";
export {
  allocateRef,
  ledgerCheckpoints,
  loadUserAuthority,
  visibleContracts,
  visibleEvents,
  type UserAuthority,
  type VisibleContractsQuery,
  type VisibleEventsQuery,
} from "./queries";
export {
  applyNotes,
  isValidNoteBody,
  loadCommittedNotes,
  NOTE_KINDS,
  NOTE_RULES,
  noteDigest,
  noteReadable,
  NoteStoreError,
  putPendingNote,
  settleNotes,
  settleNotesOfCommand,
  withNotes,
  type CommittedNote,
  type NoteAudience,
  type NoteKind,
  type NoteReader,
  type NoteState,
  type NoteSubjectParties,
  type PendingNoteInput,
} from "./notes";
export { toLogSafeError } from "./log-safety";
export {
  PgRefreshTokenStore,
  type CredentialCheck,
  type PgRefreshTokenStoreOptions,
  type CredentialStatus,
  type CredentialUpdate,
  type StoredCredential,
  type StoredCredentialStatus,
} from "./credentials";
export {
  CredentialCipher,
  CredentialCipherError,
  type CredentialCipherErrorCode,
  type CredentialKey,
  type CredentialKeys,
  type SealedSecret,
  type SecretBinding,
} from "./credential-cipher";
export { databaseRecoveryState, projectionRecoveryState, type DatabaseRecoveryState, type ProjectionRecoveryState } from "./recovery";
// Worker projection (ledger updates → ledger_* tables) and the stakeholder-filtered read model.
export * from "./projection";
export * from "./read-model";
