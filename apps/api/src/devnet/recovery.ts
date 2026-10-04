// DEVNET recovery (scripts/devnet/recover.mjs, docs/devnet/recovery.md). `observeDevnet` gathers, read-only, what the
// diagnosis needs: the DEVNET database, the stored credential (decrypted in memory only), the state file, and the
// participant's answers to GETs (participant id, ledger end, pruning offset, the tenant user's rights, packages).
// `planNewRun` decides what `--new-run` must do so that running it again is a no-op. Nothing here submits,
// allocates, uploads, grants or prunes, and nothing reads another tenant's parties.
import { observeDevnetLedger, type DevnetDiagnosis, type DevnetObservation, type RecoveryLedgerClient } from "@collara/canton";
import { databaseRecoveryState, projectionRecoveryState, type CredentialCheck, type Db, type PgRefreshTokenStore } from "@collara/db";
import { loadLedgerState, type LedgerState } from "../ledger/state";
import { DEVNET_SOURCE } from "./bindings";
import { requiredPackages, type ManifestEntry } from "./preflight";

export interface ObserveDevnetDeps {
  /** Null when the database could not be reached. */
  readonly db: Db | null;
  readonly databaseError?: string | undefined;
  /** Credential store with this process's key. */
  readonly store: Pick<PgRefreshTokenStore, "check"> | null;
  readonly credentialId: string;
  readonly ledgerUserId: string;
  /** The tenant's client (OIDC refresh-token provider in the CLI; a fake in tests). */
  readonly client: RecoveryLedgerClient;
  readonly statePath: string;
  readonly manifest: readonly ManifestEntry[];
}

export interface DevnetObservationDetail {
  readonly observation: DevnetObservation;
  readonly state: LedgerState | null;
}

/** Read-only observation of everything recovery depends on. The ledger is queried only with a usable credential. */
export async function observeDevnet(deps: ObserveDevnetDeps): Promise<DevnetObservationDetail> {
  const database = await databaseRecoveryState(deps.db, deps.databaseError);
  const db = database.reachable && database.migrated ? deps.db : null;
  const credential: CredentialCheck | null = db && deps.store ? await deps.store.check(deps.credentialId) : null;
  // A corrupt or foreign (LocalNet) state file counts as missing: the bindings are imported again.
  let state = await loadLedgerState(deps.statePath).catch(() => null);
  if (state?.topology !== "devnet-shared-participant") state = null;
  const projection = db ? await projectionRecoveryState(db, DEVNET_SOURCE) : null;
  const ledger = credential?.state === "OK" ? await observeDevnetLedger(deps.client, deps.ledgerUserId, requiredPackages(deps.manifest)) : null;
  const observation: DevnetObservation = {
    database,
    credential: credential ? { state: credential.state, detail: credential.detail } : null,
    state: state
      ? { participantId: state.participantId, namespace: state.namespace ?? null, parties: Object.fromEntries(Object.entries(state.parties).map(([hint, p]) => [hint, p.party])) }
      : null,
    ledger,
    projection,
  };
  return { observation, state };
}

export interface NewRunPlan {
  /** Refusal (an earlier problem must be fixed first), or null. */
  readonly refusal: string | null;
  /** Import the bindings with this run ref (new namespace), or null to keep the current state and namespace. */
  readonly importRunRef: string | null;
  /** Reset the "devnet" projection source; startOffset > 0 records a history floor at the pruning offset. */
  readonly resetProjection: { readonly startOffset: number; readonly reason: string } | null;
  /** Always true when not refused: the bootstrap replays committed steps, so it is safe to repeat. */
  readonly bootstrap: boolean;
}

const BLOCKING = new Set(["DATABASE_MISSING", "CREDENTIAL_MISSING", "CREDENTIAL_REVOKED", "CREDENTIAL_KEY", "LEDGER_UNREACHABLE", "PARTIES_MISSING", "PACKAGES_MISSING"]);

/** A run ref from a clock: r<yyyymmddhhmm> (UTC). */
export function generatedRunRef(now: Date): string {
  return `r${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

/**
 * What `recover.mjs --new-run` does for this diagnosis. Idempotent by construction: after a completed run the
 * diagnosis is OK, the state names the current participant and the projection is consistent, so the plan is
 * "bootstrap only" (which replays).
 */
export function planNewRun(input: {
  readonly diagnosis: DevnetDiagnosis;
  readonly observation: DevnetObservation;
  readonly requestedRunRef?: string | undefined;
  readonly currentNamespace: string | null;
  readonly now: Date;
}): NewRunPlan {
  const { diagnosis, observation } = input;
  const blocker = diagnosis.findings.find((f) => f.status === "fail" && BLOCKING.has(f.case));
  if (blocker) {
    return {
      refusal: `refusing --new-run: ${blocker.case} must be fixed first (${blocker.detail.slice(0, 200)}). Follow the steps above, then run recover.mjs again.`,
      importRunRef: null,
      resetProjection: null,
      bootstrap: false,
    };
  }
  const ledger = observation.ledger;
  if (!ledger?.reachable) return { refusal: "refusing --new-run: the ledger was not observed", importRunRef: null, resetProjection: null, bootstrap: false };

  const requestedNamespace = input.requestedRunRef ? `collara-devnet-${input.requestedRunRef}` : null;
  const needsNewNamespace = diagnosis.newRunRequired || observation.state === null || (requestedNamespace !== null && requestedNamespace !== input.currentNamespace);
  const importRunRef = needsNewNamespace ? (input.requestedRunRef ?? generatedRunRef(input.now)) : null;

  const p = observation.projection;
  let resetProjection: NewRunPlan["resetProjection"] = null;
  if (p) {
    const reasons: string[] = [];
    if (p.status !== "ACTIVE") reasons.push(`status ${p.status}`);
    if (p.participantId !== ledger.participantId) reasons.push("participant changed");
    if (ledger.ledgerEnd < p.checkpoint) reasons.push("ledger end behind checkpoint");
    if (ledger.prunedUpTo > p.checkpoint) reasons.push(`pruned past checkpoint ${p.checkpoint}`);
    if (reasons.length) resetProjection = { startOffset: ledger.prunedUpTo, reason: reasons.join(", ") };
  } else if (ledger.prunedUpTo > 0) {
    // No projection yet: the worker would refuse to start from 0. Create the source at the history floor.
    resetProjection = { startOffset: ledger.prunedUpTo, reason: "no projection yet on a pruned participant" };
  }
  return { refusal: null, importRunRef, resetProjection, bootstrap: true };
}
