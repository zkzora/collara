// Sanitized infrastructure status for GET /api/system/health: no URLs, credentials or party ids.
import { devnetCredentialId, loadLocalnetState, type LocalnetState } from "@collara/canton";
import { PgRefreshTokenStore, type Db, type DbHandle, type LedgerSourceRow } from "@collara/db";
import type { SystemHealth } from "@collara/domain";
import type { StorageService } from "./storage";

export type HealthCheck = SystemHealth["checks"][string];

const TOPOLOGY_LABELS: Readonly<Record<LocalnetState["topology"], string>> = {
  "sandbox-1-participant": "1 participant",
  "sandbox-3-participants": "3 participants",
  "sandbox-5-participants": "5 participants",
  "devnet-shared-participant": "shared DevNet participant",
};

/** Exact topology wording (ADR-0001 §2.3): a dpm sandbox is not Splice LocalNet; DevNet is a shared participant. */
export function topologyLabel(state: Pick<LocalnetState, "topology" | "cantonVersion">, version?: string): string {
  const canton = version ?? state.cantonVersion ?? "unknown version";
  if (state.topology === "devnet-shared-participant") {
    return `Canton ${canton}, Canton DevNet, one shared participant run by a node operator, one tenant ledger user`;
  }
  return `Canton ${canton} dpm sandbox, ${TOPOLOGY_LABELS[state.topology]} (not Splice LocalNet)`;
}

/** DEVNET: whether a usable refresh token is stored (no token, no user id, no URL in the result). */
export async function devnetCredentialStatus(env: { DEVNET_LEDGER_USER_ID?: string | undefined }, db: Db): Promise<HealthCheck> {
  if (!env.DEVNET_LEDGER_USER_ID) return { status: "unavailable", detail: "No DevNet ledger user configured." };
  const status = await new PgRefreshTokenStore(db).status(devnetCredentialId(env.DEVNET_LEDGER_USER_ID)).catch(() => null);
  if (!status || !status.hasRefreshToken) return { status: "unavailable", detail: "No DevNet credential stored: the owner must run scripts/devnet/login.mjs." };
  if (status.status !== "ACTIVE") return { status: "unavailable", detail: "The DevNet credential was rejected: the owner must run scripts/devnet/login.mjs again." };
  return { status: "ok" };
}

export interface LedgerProbeOptions {
  readonly statePath?: string;
  /** DEVNET: the stored credential's state; a missing or rejected credential makes the ledger check unavailable. */
  readonly credentialStatus?: (() => Promise<HealthCheck>) | undefined;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Reachability of every bootstrapped participant (/readyz, /v2/version) plus the exact topology. */
export async function probeLedger(options: LedgerProbeOptions = {}): Promise<HealthCheck> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_000;
  let state: LocalnetState | null;
  try {
    state = await loadLocalnetState(options.statePath);
  } catch {
    return { status: "unavailable", detail: "The LocalNet bootstrap state is unreadable." };
  }
  const devnet = state?.topology === "devnet-shared-participant";
  if (!state) {
    return { status: "unavailable", detail: options.credentialStatus ? "DevNet bindings are not imported (no DevNet state found)." : "LocalNet is not bootstrapped (no bootstrap state found)." };
  }

  let version: string | undefined;
  const notReady: string[] = [];
  for (const [name, participant] of Object.entries(state.participants)) {
    try {
      const ready = await doFetch(new URL("/readyz", participant.jsonApiUrl), { signal: AbortSignal.timeout(timeoutMs) });
      if (!ready.ok) {
        notReady.push(name);
        continue;
      }
      if (!version) {
        const response = await doFetch(new URL("/v2/version", participant.jsonApiUrl), { signal: AbortSignal.timeout(timeoutMs) });
        const body = (await response.json().catch(() => null)) as { version?: unknown } | null;
        if (typeof body?.version === "string") version = body.version;
      }
    } catch {
      notReady.push(name);
    }
  }
  const label = topologyLabel(state, version);
  if (devnet && options.credentialStatus) {
    const credential = await options.credentialStatus();
    if (credential.status !== "ok") return { status: "unavailable", detail: `${label}. ${credential.detail ?? ""}`.trim() };
  }
  if (notReady.length === Object.keys(state.participants).length) {
    return { status: "unavailable", detail: `Ledger unreachable. Configured topology: ${label}.` };
  }
  if (notReady.length > 0) return { status: "degraded", detail: `${label}; not ready: ${notReady.join(", ")}.` };
  return { status: "ok", detail: label };
}

export function workerCheck(sources: readonly LedgerSourceRow[], now: Date, staleAfterSeconds: number): HealthCheck {
  if (sources.length === 0) return { status: "unavailable", detail: "No projection checkpoint yet (worker not started)." };
  const reset = sources.filter((s) => s.status !== "ACTIVE");
  if (reset.length > 0) {
    return { status: "degraded", detail: `Projection paused after a ledger reset: ${reset.map((s) => s.source).join(", ")}.` };
  }
  const applied = sources.map((s) => s.lastAppliedAt).filter((d): d is Date => d !== null);
  if (applied.length < sources.length) return { status: "degraded", detail: "The worker has not applied any ledger update yet." };
  const oldest = Math.min(...applied.map((d) => d.getTime()));
  const ageSeconds = Math.max(0, Math.round((now.getTime() - oldest) / 1000));
  const offsets = sources.map((s) => `${s.source} offset ${s.checkpointOffset}`).join(", ");
  return {
    status: ageSeconds > staleAfterSeconds ? "degraded" : "ok",
    detail: `Checkpoint age ${ageSeconds} s (${offsets}).`,
  };
}

export async function databaseCheck(handle: DbHandle): Promise<HealthCheck> {
  try {
    await handle.ping();
    return { status: "ok" };
  } catch {
    return { status: "unavailable", detail: "The database is not reachable." };
  }
}

export async function storageCheck(storage: StorageService | null): Promise<HealthCheck> {
  if (!storage) return { status: "unavailable", detail: "Object storage is not configured." };
  const result = await storage.check();
  return result.ok ? { status: "ok", detail: result.detail } : { status: "unavailable", detail: result.detail };
}
