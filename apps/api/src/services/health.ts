// Sanitized infrastructure status for GET /api/system/health: no URLs, credentials or party ids.
import { loadLocalnetState, type LocalnetState } from "@collara/canton";
import type { DbHandle, LedgerSourceRow } from "@collara/db";
import type { SystemHealth } from "@collara/domain";
import type { StorageService } from "./storage";

export type HealthCheck = SystemHealth["checks"][string];

const TOPOLOGY_LABELS: Readonly<Record<LocalnetState["topology"], string>> = {
  "sandbox-1-participant": "1 participant",
  "sandbox-3-participants": "3 participants",
};

/** Exact topology wording (ADR-0001 §2.3): a dpm sandbox is not Splice LocalNet. */
export function topologyLabel(state: Pick<LocalnetState, "topology" | "cantonVersion">, version?: string): string {
  const canton = version ?? state.cantonVersion ?? "unknown version";
  return `Canton ${canton} dpm sandbox, ${TOPOLOGY_LABELS[state.topology]} (not Splice LocalNet)`;
}

export interface LedgerProbeOptions {
  readonly statePath?: string;
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
  if (!state) return { status: "unavailable", detail: "LocalNet is not bootstrapped (no bootstrap state found)." };

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
