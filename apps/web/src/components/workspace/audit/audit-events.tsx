"use client";

import { BOUNDARY_COPY, type AuditEventQuery, type EventKind } from "@collara/domain";
import Form from "next/form";
import Link from "next/link";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { StatusBadge } from "@/components/collara/status-badge";
import { Button } from "@/components/ui/button";
import { formatUtcDateTime, shortId } from "@/lib/format";
import { LIST_LIMIT, useAuditEvents, useCaseList } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { assetHref, caseTabHref } from "../case/links";
import { EmptyRow, TableRegion, TD, TR } from "./table-region";

export interface AuditFilters {
  readonly caseId?: string;
  readonly kind?: EventKind;
  /** yyyy-mm-dd (UTC) */
  readonly from?: string;
  readonly to?: string;
}

const KIND_OPTIONS: readonly { value: EventKind; label: string }[] = [
  { value: "COMMITTED", label: "Committed" },
  { value: "OPERATIONAL", label: "Operational" },
  { value: "PENDING", label: "Pending" },
];

const control =
  "h-8 rounded-md border border-line-strong bg-surface-sunken px-2.5 text-[13px] text-fg outline-none hover:border-line-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function toQuery(filters: AuditFilters): AuditEventQuery {
  return {
    caseId: filters.caseId,
    kind: filters.kind,
    from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
    to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
    limit: LIST_LIMIT,
  };
}

function FilterBar({ filters }: { filters: AuditFilters }) {
  const cases = useCaseList("all");
  return (
    <Form action="/app/audit" aria-label="Filter audit events" className="flex flex-wrap items-end gap-2.5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="audit-case" className="text-[12.5px] font-medium text-fg-muted">
          Case
        </label>
        <select id="audit-case" name="caseId" defaultValue={filters.caseId ?? ""} className={`${control} min-w-[200px]`}>
          <option value="">All accessible cases</option>
          {(cases.data?.items ?? []).map((c) => (
            <option key={c.caseId} value={c.caseId}>
              {`${c.caseId} · ${c.title}`}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="audit-kind" className="text-[12.5px] font-medium text-fg-muted">
          Status
        </label>
        <select id="audit-kind" name="kind" defaultValue={filters.kind ?? ""} className={control}>
          <option value="">Committed + operational</option>
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="audit-from" className="text-[12.5px] font-medium text-fg-muted">
          From (UTC)
        </label>
        <input id="audit-from" name="from" type="date" defaultValue={filters.from ?? ""} className={`${control} font-mono`} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="audit-to" className="text-[12.5px] font-medium text-fg-muted">
          To (UTC)
        </label>
        <input id="audit-to" name="to" type="date" defaultValue={filters.to ?? ""} className={`${control} font-mono`} />
      </div>
      <Button type="submit" variant="outline">
        Apply filters
      </Button>
      {filters.caseId || filters.kind || filters.from || filters.to ? (
        <Link href="/app/audit" className="h-8 px-1 text-[12.5px] leading-8 text-fg-muted underline-offset-4 hover:text-fg hover:underline">
          Clear
        </Link>
      ) : null}
    </Form>
  );
}

/** Scoped audit events (S §9.17): the same scope as every other list; committed vs operational kept apart. */
export function AuditEvents({ filters }: { filters: AuditFilters }) {
  const { mode } = useSession();
  const events = useAuditEvents(toQuery(filters));
  const items = events.data?.items ?? [];
  const offsets = items.flatMap((e) => (e.commit ? [e.commit.offset] : []));
  const watermark = mode === "UI_MOCK" ? "no ledger offsets in the UI mockup" : offsets.length ? `through offset ${Math.max(...offsets)}` : "no committed events in view";

  return (
    <div className="flex flex-col gap-3">
      <FilterBar filters={filters} />
      <p className="text-[12px] text-fg-subtle" aria-live="polite">
        {events.data ? `${items.length} events · ${watermark}${events.data.nextCursor ? ` · showing the latest ${LIST_LIMIT}` : ""}` : " "}
      </p>
      {events.isError ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : events.isPending ? (
        <LoadingState variant="table" rows={6} label="Loading audit events…" />
      ) : (
        <TableRegion
          label="Audit events"
          head={["Event time (UTC)", "Reference", "Event type", "Authorized actor", "State change", "Version", "Commit", "Status"]}
          minWidth="min-w-[1080px]"
        >
          {items.map((e) => (
            <tr key={e.id} className={TR}>
              <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>
                <time dateTime={e.occurredAt}>{formatUtcDateTime(e.occurredAt)}</time>
              </td>
              <td className={TD}>
                <span className="font-mono text-[12.5px]">{e.ref}</span>
                <span className="block font-mono text-[11.5px] text-fg-subtle">
                  {e.caseId ? (
                    <Link href={caseTabHref(e.caseId, "activity")} className="underline-offset-4 hover:text-fg hover:underline">
                      {e.caseId}
                    </Link>
                  ) : (
                    <Link href={assetHref(e.assetRef)} className="underline-offset-4 hover:text-fg hover:underline">
                      {e.assetRef}
                    </Link>
                  )}
                </span>
              </td>
              <td className={TD}>{e.label}</td>
              <td className={TD}>{e.actor}</td>
              <td className={`${TD} font-mono text-[11.5px] text-fg-muted`}>{e.stateChange ? `${e.stateChange.from ?? "—"} → ${e.stateChange.to}` : "—"}</td>
              <td className={`${TD} text-[12.5px] text-fg-muted`}>{e.version ?? "—"}</td>
              <td className={`${TD} font-mono text-[11.5px] whitespace-nowrap text-fg-muted`}>
                {e.commit ? `${shortId(e.commit.updateId)} · ${e.commit.offset}` : "—"}
              </td>
              <td className={`${TD} whitespace-nowrap`}>
                <StatusBadge status={e.kind} />
              </td>
            </tr>
          ))}
          {items.length === 0 ? <EmptyRow colSpan={8}>No events match these filters within your access scope.</EmptyRow> : null}
        </TableRegion>
      )}
      <p className="text-[12px] leading-relaxed text-fg-subtle">{BOUNDARY_COPY.AUDIT_EVENTS}</p>
    </div>
  );
}
