// Fixture helpers. Every fixture date is relative to an injected "now" (R-08): prototype timestamps
// are used only as anchors, shifted so the prototype's own clock (2026-10-01 14:32:05 UTC) maps to now.
import type { ActorStamp, EventFacts, EventType } from "../facts";
import { actorLine, orgName, type OrgId, type Role } from "../roles";
import type { EventKind } from "../states";

/** The prototype's wall clock (P-Dash §4.9). Used only to compute relative offsets. */
export const PROTOTYPE_NOW = Date.parse("2026-10-01T14:32:05Z");

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface Clock {
  readonly now: Date;
  /** Shift a prototype timestamp so that its distance to PROTOTYPE_NOW is preserved relative to now. */
  at(prototypeIso: string): string;
  daysAgo(days: number, hours?: number): string;
  hoursAgo(hours: number): string;
  daysFromNow(days: number): string;
}

export function clock(now: Date): Clock {
  const t = now.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    now,
    at: (prototypeIso) => iso(t + (Date.parse(prototypeIso) - PROTOTYPE_NOW)),
    daysAgo: (days, hours = 0) => iso(t - days * DAY - hours * HOUR),
    hoursAgo: (hours) => iso(t - hours * HOUR),
    daysFromNow: (days) => iso(t + days * DAY),
  };
}

/**
 * Deterministic 64-hex placeholder for synthetic fixture documents (FNV-1a based, not cryptographic).
 * UI_MOCK has no stored bytes; LOCALNET seeds hash real synthetic files with SHA-256.
 */
export function syntheticSha256(seed: string): string {
  let out = "";
  let h = 0x811c9dc5;
  for (let round = 0; out.length < 64; round += 1) {
    for (const ch of `${seed}#${round}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

export function stamp(orgId: OrgId, userId: string | null, label?: string): ActorStamp {
  return { orgId, userId, label: label ?? orgName(orgId) };
}

/** Sequential event ids per fixture world. */
export class EventLog {
  private next = 1;

  event(input: {
    at: string;
    ref: string;
    type: EventType;
    orgId: OrgId;
    role: Role | null;
    userId?: string | null;
    actorLabel?: string;
    detail?: string | null;
    from?: string | null;
    to?: string | null;
    version?: string | null;
    kind?: EventKind;
  }): EventFacts {
    const id = `EV-${String(this.next++).padStart(4, "0")}`;
    return {
      id,
      occurredAt: input.at,
      ref: input.ref,
      type: input.type,
      detail: input.detail ?? null,
      actor: {
        orgId: input.orgId,
        userId: input.userId ?? null,
        role: input.role,
        label: input.actorLabel ?? actorLine(input.orgId, input.role),
      },
      stateChange: input.to ? { from: input.from ?? null, to: input.to } : null,
      version: input.version ?? null,
      kind: input.kind ?? "COMMITTED",
      // Never fabricated in fixtures: commit refs exist only for events observed on a ledger.
      commit: null,
    };
  }

  /** Continue numbering after an existing world's events. */
  static after(events: readonly { id: string }[]): EventLog {
    const log = new EventLog();
    const max = events.reduce((m, e) => Math.max(m, Number.parseInt(e.id.replace(/\D/g, ""), 10) || 0), 0);
    log.next = max + 1;
    return log;
  }
}
