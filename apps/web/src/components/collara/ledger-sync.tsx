import { isLedgerMode, type RuntimeMode } from "@collara/domain";
import { formatUtcDate, formatUtcTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface LedgerSyncValue {
  readonly offset: number | null;
  readonly at: string | null;
}

/** INFERRED copy (needs approval) for the states the prototype did not have. */
export const LEDGER_SYNC_COPY = {
  MOCK: "No ledger connection · UI mockup",
  UNKNOWN: "Ledger sync not reported yet",
} as const;

/**
 * "Ledger synced · offset 18422 · 14:32:05 UTC" from the projection checkpoint (LOCALNET, DEVNET).
 * UI_MOCK has no ledger, so it says so instead of inventing an offset.
 */
export function ledgerSyncText(mode: RuntimeMode, sync: LedgerSyncValue | null | undefined, { withDate = false } = {}): string {
  if (mode === "UI_MOCK") return LEDGER_SYNC_COPY.MOCK;
  if (!sync || sync.offset === null || !sync.at) return LEDGER_SYNC_COPY.UNKNOWN;
  return `Ledger synced · offset ${sync.offset} · ${withDate ? `${formatUtcDate(sync.at)} ` : ""}${formatUtcTime(sync.at)}`;
}

export function LedgerSyncIndicator({
  mode,
  sync,
  withDate,
  className,
}: {
  mode: RuntimeMode;
  sync: LedgerSyncValue | null | undefined;
  withDate?: boolean;
  className?: string;
}) {
  const known = isLedgerMode(mode) && sync?.offset !== null && sync?.offset !== undefined && !!sync.at;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11.5px] text-fg-subtle", className)}>
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", known ? "bg-success" : mode === "UI_MOCK" ? "bg-neutral" : "bg-pending")}
      />
      {ledgerSyncText(mode, sync, { withDate })}
    </span>
  );
}
