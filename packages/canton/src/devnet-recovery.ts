// DEVNET recovery: what went wrong on the shared participant, and the exact next commands (docs/devnet/recovery.md).
// Two halves, both pure:
//   classifyRecoveryError(error)   one failure (from the token provider, the credential store or the JSON API) →
//                                  the recovery case it signals, or null
//   diagnoseDevnet(observation)    everything observed at once (database, credential, state file, participant,
//                                  rights, packages, pruning offset, projection source) → ordered findings
// The worker reports the primary case in /healthz, the API in GET /api/system/health, and scripts/devnet/recover.mjs
// prints every finding with its commands. Nothing here mixes histories or re-projects: it only names the case.
import type { LedgerClient } from "./client";
import { isLedgerError, type LedgerErrorInfo } from "./errors";

export const DEVNET_RECOVERY_CASES = [
  "OK",
  /** DATABASE_URL unreachable or the migrations were never applied (lost database). */
  "DATABASE_MISSING",
  /** No refresh token stored. */
  "CREDENTIAL_MISSING",
  /** The identity provider rejected (revoked, expired, reused) the refresh token, or migration 0005 erased a plaintext one. */
  "CREDENTIAL_REVOKED",
  /** The stored ciphertext does not open with the configured DEVNET_CREDENTIAL_KEY(_PREVIOUS). */
  "CREDENTIAL_KEY",
  /** No .local/devnet/state.json (bindings never imported, or the file was lost). */
  "STATE_MISSING",
  /** The participant or the identity provider cannot be reached (retry later). */
  "LEDGER_UNREACHABLE",
  /** Participant id changed, or the ledger end is behind the projection checkpoint: DevNet was reset. */
  "LEDGER_RESET",
  /** A bound Collara party is no longer in the tenant user's CanActAs/CanReadAs rights. */
  "PARTIES_MISSING",
  /** A required package is not on the participant or not vetted. */
  "PACKAGES_MISSING",
  /** Updates after the projection checkpoint were pruned: that history cannot be re-projected. */
  "PRUNED",
] as const;
export type DevnetRecoveryCase = (typeof DEVNET_RECOVERY_CASES)[number];

export const RECOVER_COMMAND = "node scripts/devnet/recover.mjs";
export const RECOVER_NEW_RUN_COMMAND = "node scripts/devnet/recover.mjs --new-run --yes";
const LOGIN = "node scripts/devnet/login.mjs   (owner, own terminal; Git Bash: winpty node scripts/devnet/login.mjs)";

/** Error ids meaning "that offset was pruned" (named in the committed Canton 3.5.19 OpenAPI). */
export const PRUNED_OFFSET_ERROR_CODES: readonly string[] = ["PARTICIPANT_PRUNED_DATA_ACCESSED"];
/**
 * Error ids meaning "that offset is beyond the ledger end": a checkpoint ahead of the participant, i.e. a reset.
 * From the Canton error-code reference, not the committed OpenAPI; not observed on DevNet.
 */
export const OFFSET_AHEAD_ERROR_CODES: readonly string[] = ["OFFSET_AFTER_LEDGER_END", "OFFSET_OUT_OF_RANGE"];
/** Error ids of a missing or unknown package / template (recorded on the 3.5.19 sandbox). */
export const PACKAGE_ERROR_CODES: readonly string[] = ["PACKAGE_NAMES_NOT_FOUND", "TEMPLATES_OR_INTERFACES_NOT_FOUND"];

export interface RecoveryErrorClassification {
  readonly case: DevnetRecoveryCase;
  /** Operator-facing detail (never a token or key). */
  readonly detail: string;
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string" ? (error as { name: string }).name : "";
}

function errorCode(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** The recovery case one failure signals, or null when it says nothing specific (a business rejection, a bug). */
export function classifyRecoveryError(error: unknown): RecoveryErrorClassification | null {
  const name = errorName(error);
  if (name === "LedgerCredentialError") {
    switch (errorCode(error)) {
      case "NO_REFRESH_TOKEN":
        return { case: "CREDENTIAL_MISSING", detail: messageOf(error) };
      case "REFRESH_REJECTED":
        return { case: "CREDENTIAL_REVOKED", detail: messageOf(error) };
      case "TOKEN_ENDPOINT_UNAVAILABLE":
        return { case: "LEDGER_UNREACHABLE", detail: messageOf(error) };
      default:
        return null;
    }
  }
  if (name === "CredentialCipherError") {
    return { case: "CREDENTIAL_KEY", detail: messageOf(error) };
  }
  if (name === "LedgerResetError" || errorCode(error) === "LEDGER_RESET") return { case: "LEDGER_RESET", detail: messageOf(error) };
  if (!isLedgerError(error)) return null;
  const info: LedgerErrorInfo = error.info;
  // A token that could not be obtained: the cause is the provider's or the store's error.
  if (info.original && info.original !== error && (errorName(info.original) === "LedgerCredentialError" || errorName(info.original) === "CredentialCipherError")) {
    return classifyRecoveryError(info.original);
  }
  if (info.code && PRUNED_OFFSET_ERROR_CODES.includes(info.code)) return { case: "PRUNED", detail: info.message };
  if (info.code && OFFSET_AHEAD_ERROR_CODES.includes(info.code)) return { case: "LEDGER_RESET", detail: info.message };
  if (info.code && PACKAGE_ERROR_CODES.includes(info.code)) return { case: "PACKAGES_MISSING", detail: info.message };
  // Security-sensitive errors are redacted to "NA": a 403 on a read as the bound parties means the tenant user lost
  // a right (or the token's scope/audience changed); recover.mjs lists which parties.
  if (info.kind === "PERMISSION_DENIED") return { case: "PARTIES_MISSING", detail: `${info.message} (the tenant user lacks a right on a bound party, or its token's scope or audience changed)` };
  if (info.kind === "UNAVAILABLE" || info.kind === "TIMEOUT") return { case: "LEDGER_UNREACHABLE", detail: info.message };
  return null;
}

// --- diagnosis ---------------------------------------------------------------------------------------------------

export type CredentialCheckState = "OK" | "MISSING" | "REAUTH_REQUIRED" | "KEY_MISSING" | "KEY_UNKNOWN" | "DECRYPT_FAILED" | "KEY_INVALID";

export interface RequiredPackageObservation {
  readonly name: string;
  readonly version: string;
  readonly packageId: string;
  readonly present: boolean;
  readonly vetted: boolean;
}

export type LedgerObservation =
  | { readonly reachable: false; readonly error: string; readonly case?: DevnetRecoveryCase | undefined }
  | {
      readonly reachable: true;
      readonly participantId: string;
      readonly ledgerEnd: number;
      /** participantPrunedUpToInclusive (0 = never pruned). */
      readonly prunedUpTo: number;
      readonly actAs: readonly string[];
      readonly readAs: readonly string[];
      readonly packages: readonly RequiredPackageObservation[];
    };

export interface DevnetObservation {
  readonly database: { readonly reachable: boolean; readonly migrated: boolean; readonly detail?: string };
  readonly credential: { readonly state: CredentialCheckState; readonly detail: string } | null;
  /** The DevNet state file, or null when missing. */
  readonly state: { readonly participantId: string; readonly namespace: string | null; readonly parties: Readonly<Record<string, string>> } | null;
  /** Null when the ledger was not queried (an earlier blocker). */
  readonly ledger: LedgerObservation | null;
  /** ledger_sources row of source "devnet", or null when the worker never ran. */
  readonly projection: {
    readonly status: string;
    readonly participantId: string;
    readonly checkpoint: number;
    readonly historyFloor: number | null;
    readonly reason: string | null;
  } | null;
}

export interface DevnetFinding {
  readonly case: DevnetRecoveryCase;
  readonly status: "ok" | "warn" | "fail";
  readonly title: string;
  readonly detail: string;
  /** Exact commands or Console steps, in order. */
  readonly next: readonly string[];
}

export interface DevnetDiagnosis {
  /** The first failing case (OK when none). */
  readonly primary: DevnetRecoveryCase;
  readonly findings: readonly DevnetFinding[];
  /** True when the only way forward is a fresh run namespace (reset, pruning past the checkpoint, lost database). */
  readonly newRunRequired: boolean;
}

const fail = (c: DevnetRecoveryCase, title: string, detail: string, next: readonly string[]): DevnetFinding => ({ case: c, status: "fail", title, detail, next });
const ok = (title: string, detail: string): DevnetFinding => ({ case: "OK", status: "ok", title, detail, next: [] });

function credentialFinding(credential: NonNullable<DevnetObservation["credential"]>): DevnetFinding {
  switch (credential.state) {
    case "OK":
      return ok("credential", credential.detail);
    case "MISSING":
      return fail("CREDENTIAL_MISSING", "credential", credential.detail, [LOGIN, RECOVER_COMMAND]);
    case "REAUTH_REQUIRED":
      return fail("CREDENTIAL_REVOKED", "credential", `the refresh token was rejected or erased: ${credential.detail}`, [LOGIN, RECOVER_COMMAND]);
    default:
      return fail("CREDENTIAL_KEY", "credential key", credential.detail, [
        "put back the key that wrote the row: DEVNET_CREDENTIAL_KEY + DEVNET_CREDENTIAL_KEY_ID, or keep the new key and add DEVNET_CREDENTIAL_KEY_PREVIOUS=<old id>:<old key> (docs/devnet/recovery.md §5)",
        `or, if that key is lost: ${LOGIN}`,
        RECOVER_COMMAND,
      ]);
  }
}

/** Ordered findings for one observation. Blockers come first; later checks are skipped while an earlier one fails. */
export function diagnoseDevnet(observation: DevnetObservation): DevnetDiagnosis {
  const findings: DevnetFinding[] = [];
  let newRunRequired = false;
  const done = (): DevnetDiagnosis => ({ primary: findings.find((f) => f.status === "fail")?.case ?? "OK", findings, newRunRequired });

  if (!observation.database.reachable || !observation.database.migrated) {
    findings.push(
      fail(
        "DATABASE_MISSING",
        "database",
        observation.database.detail ?? (observation.database.reachable ? "the DEVNET database has no Collara tables (lost or never set up)" : "the DEVNET database is unreachable"),
        [
          "pnpm db:up   (if PostgreSQL is simply stopped, this is all; then run recover.mjs again)",
          "node scripts/devnet/db-setup.mjs",
          LOGIN,
          RECOVER_NEW_RUN_COMMAND + "   (the old run's records are gone; its contracts stay on DevNet as synthetic data)",
        ],
      ),
    );
    newRunRequired = observation.database.reachable;
    return done();
  }
  findings.push(ok("database", "reachable, migrated"));

  if (!observation.credential) return done();
  const credential = credentialFinding(observation.credential);
  findings.push(credential);
  if (credential.status === "fail") return done();

  const ledger = observation.ledger;
  if (!ledger) return done();
  if (!ledger.reachable) {
    const c = ledger.case && ledger.case !== "OK" ? ledger.case : "LEDGER_UNREACHABLE";
    const next = c === "CREDENTIAL_REVOKED" || c === "CREDENTIAL_MISSING" ? [LOGIN, RECOVER_COMMAND] : c === "CREDENTIAL_KEY" ? credentialFinding({ state: "DECRYPT_FAILED", detail: "" }).next : ["node scripts/devnet/preflight.mjs   (public checks: readyz, version, OIDC)", `retry later: ${RECOVER_COMMAND}`];
    findings.push(fail(c, "ledger", ledger.error, next));
    return done();
  }
  findings.push(ok("ledger", `participant ${ledger.participantId}, ledger end ${ledger.ledgerEnd}`));

  const state = observation.state;
  const projection = observation.projection;

  // Reset: the participant answering now is not the one the bindings (or the projection) were taken from.
  const resetReasons: string[] = [];
  if (state && state.participantId !== ledger.participantId) resetReasons.push(`the bindings were imported from participant ${state.participantId}, the ledger now reports ${ledger.participantId}`);
  if (projection && projection.participantId !== ledger.participantId) resetReasons.push(`the projection is of participant ${projection.participantId}`);
  if (projection && ledger.ledgerEnd < projection.checkpoint) resetReasons.push(`ledger end ${ledger.ledgerEnd} is behind the projection checkpoint ${projection.checkpoint}`);
  if (projection?.status === "RESET_DETECTED") resetReasons.push(`the worker stopped the projection: ${projection.reason ?? "reset detected"}`);
  if (resetReasons.length) {
    newRunRequired = true;
    findings.push(
      fail("LEDGER_RESET", "network reset", resetReasons.join("; "), [
        "Console: check the 11 Collara parties still exist; re-create any that are gone (owner checklist step b)",
        "Console: re-upload the two DARs if preflight lists them as NOT present (owner checklist step c)",
        RECOVER_COMMAND + "   (repeat until only the reset is left)",
        RECOVER_NEW_RUN_COMMAND,
      ]),
    );
  }

  if (!state) {
    findings.push(fail("STATE_MISSING", "bindings", "no DevNet state file (.local/devnet/state.json)", [RECOVER_NEW_RUN_COMMAND + "   (imports the bindings, then bootstraps a run namespace)"]));
    return done();
  }

  // Parties: every bound party must still be in the tenant user's CanActAs rights (which also let it read as the party).
  const missing = Object.entries(state.parties)
    .filter(([, party]) => !ledger.actAs.includes(party))
    .map(([hint, party]) => `${hint} (${party})`);
  if (missing.length && !resetReasons.length) {
    findings.push(
      fail("PARTIES_MISSING", "parties", `the tenant user has no CanActAs on ${missing.length} bound part${missing.length === 1 ? "y" : "ies"}: ${missing.join(", ")}`, [
        "Console: restore CanActAs + CanReadAs of the tenant user on these parties, or send docs/devnet/noders-rights-request.md (Collara never grants rights itself)",
        "if the parties are gone and you re-created them (new party ids): " + RECOVER_NEW_RUN_COMMAND,
        "otherwise, once the rights are back: " + RECOVER_COMMAND,
      ]),
    );
  } else if (!missing.length) {
    findings.push(ok("parties", `all ${Object.keys(state.parties).length} bound parties have CanActAs`));
  }

  const badPackages = ledger.packages.filter((p) => !p.present || !p.vetted);
  if (badPackages.length) {
    findings.push(
      fail(
        "PACKAGES_MISSING",
        "packages",
        badPackages.map((p) => `${p.name} ${p.version} (${p.packageId.slice(0, 12)}…) ${p.present ? "present" : "NOT present"}, ${p.vetted ? "vetted" : "NOT vetted"}`).join("; "),
        [
          "node scripts/devnet/build-dars.mjs --check",
          "Console → Collections → Upload DAR, in manifest order, and vet (owner checklist step c)",
          "if the node refuses the same name and version with different content: bump the package version, rebuild, update the manifest (docs/devnet/recovery.md §7)",
          RECOVER_COMMAND,
        ],
      ),
    );
  } else if (ledger.packages.length) {
    findings.push(ok("packages", `${ledger.packages.length} required packages present and vetted`));
  }

  // Pruning: compare the participant's horizon with what the worker still has to read.
  if (!resetReasons.length) {
    if (projection?.status === "PRUNED" || (projection && ledger.prunedUpTo > projection.checkpoint)) {
      newRunRequired = true;
      findings.push(
        fail(
          "PRUNED",
          "pruning",
          `the participant pruned up to offset ${ledger.prunedUpTo}, past the projection checkpoint ${projection.checkpoint}: the updates in between are gone and the projection cannot be rebuilt from before the pruning horizon. The existing projection is kept as history.`,
          [RECOVER_NEW_RUN_COMMAND + `   (new run namespace; the projection restarts at offset ${ledger.prunedUpTo})`],
        ),
      );
    } else if (!projection && ledger.prunedUpTo > 0) {
      newRunRequired = true;
      findings.push(
        fail("PRUNED", "pruning", `no projection yet, and the participant pruned up to offset ${ledger.prunedUpTo}: a projection from offset 0 would miss that history, so the worker refuses it`, [
          RECOVER_NEW_RUN_COMMAND + `   (starts the projection at offset ${ledger.prunedUpTo} for a new run namespace)`,
        ]),
      );
    } else if (ledger.prunedUpTo > 0 && projection) {
      findings.push({
        case: "OK",
        status: "warn",
        title: "pruning",
        detail: `pruned up to offset ${ledger.prunedUpTo}; the projection checkpoint ${projection.checkpoint} is still within retention, so the worker resumes from it${projection.historyFloor ? ` (history floor ${projection.historyFloor})` : ""}`,
        next: [],
      });
    } else {
      findings.push(ok("pruning", ledger.prunedUpTo > 0 ? `pruned up to ${ledger.prunedUpTo}` : "not pruned"));
    }
  }
  return done();
}

// --- observation (read-only GETs) ----------------------------------------------------------------------------------

/** The read-only calls the observation makes (a LedgerClient with the tenant's token). */
export type RecoveryLedgerClient = Pick<LedgerClient, "participantId" | "ledgerEnd" | "latestPrunedOffset" | "listUserRights" | "listPackages" | "vettedPackages">;

function partiesOfRights(rights: Awaited<ReturnType<LedgerClient["listUserRights"]>>): { actAs: string[]; readAs: string[] } {
  const actAs = new Set<string>();
  const readAs = new Set<string>();
  for (const right of rights) {
    const kind = right.kind as Record<string, { value?: { party?: string } } | undefined>;
    const act = kind.CanActAs?.value?.party;
    const read = kind.CanReadAs?.value?.party;
    if (act) actAs.add(act);
    if (read) readAs.add(read);
  }
  return { actAs: [...actAs].sort(), readAs: [...readAs].sort() };
}

/**
 * The participant as the tenant user sees it: participant id, ledger end, pruning offset, its own rights and the
 * required packages (present + vetted). Only GETs and list calls; never another tenant's parties. A failure is
 * classified (classifyRecoveryError) instead of thrown.
 */
export async function observeDevnetLedger(
  client: RecoveryLedgerClient,
  ledgerUserId: string,
  required: readonly { readonly name: string; readonly version: string; readonly packageId: string }[],
): Promise<LedgerObservation> {
  try {
    const [participantId, ledgerEnd, prunedUpTo, rights] = await Promise.all([
      client.participantId(),
      client.ledgerEnd(),
      client.latestPrunedOffset(),
      client.listUserRights(ledgerUserId),
    ]);
    const known = new Set(required.length ? await client.listPackages() : []);
    const vetted = required.length ? await client.vettedPackages({ packageIds: required.map((p) => p.packageId), participantIds: [participantId] }) : [];
    const vettedIds = new Set(vetted.flatMap((v) => v.packages.map((p) => p.packageId)));
    return {
      reachable: true,
      participantId,
      ledgerEnd,
      prunedUpTo,
      ...partiesOfRights(rights),
      packages: required.map((p) => ({ name: p.name, version: p.version, packageId: p.packageId, present: known.has(p.packageId), vetted: vettedIds.has(p.packageId) })),
    };
  } catch (error) {
    const classified = classifyRecoveryError(error);
    return { reachable: false, error: classified?.detail ?? messageOf(error), case: classified?.case };
  }
}

/** Plain-text report: one line per finding, then the commands of the primary case. */
export function formatDiagnosis(diagnosis: DevnetDiagnosis): string {
  const mark = { ok: "ok  ", warn: "WARN", fail: "FAIL" } as const;
  const lines = diagnosis.findings.map((f) => `  ${mark[f.status]}  ${f.title.padEnd(16)} ${f.case === "OK" ? "" : `[${f.case}] `}${f.detail}`);
  lines.push("", `case: ${diagnosis.primary}${diagnosis.newRunRequired ? " (a new run is required)" : ""}`);
  const failing = diagnosis.findings.filter((f) => f.status === "fail");
  if (failing.length === 0) {
    lines.push("nothing to recover: the API and worker can run (start or restart them).");
  } else {
    for (const finding of failing) {
      lines.push(`next for ${finding.case}:`);
      finding.next.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
    }
  }
  return lines.join("\n");
}
