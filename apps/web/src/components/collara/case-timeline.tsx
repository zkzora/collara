import type { AuditEvent } from "@collara/domain";
import type { ReactNode } from "react";
import { formatUtcDateTime, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

function stateChange(event: AuditEvent): string | null {
  if (!event.stateChange) return null;
  return `${event.stateChange.from ?? "—"} → ${event.stateChange.to}`;
}

/**
 * Scoped activity, newest first, as an ordered list. Committed (ledger) and operational
 * (application) events are labelled separately; a commit reference appears only when the event
 * carries real ledger evidence (never fabricated in UI_MOCK).
 */
export function CaseTimeline({
  events,
  compact = false,
  limit,
  empty = "No activity is visible to your organization yet.",
  className,
}: {
  events: readonly AuditEvent[];
  /** Overview card: event and actor only. */
  compact?: boolean;
  limit?: number;
  empty?: ReactNode;
  className?: string;
}) {
  const shown = limit ? events.slice(0, limit) : events;
  if (shown.length === 0) return <p className={cn("px-4 py-6 text-[13.5px] text-fg-muted", className)}>{empty}</p>;
  return (
    <ol className={cn("flex flex-col", className)}>
      {shown.map((event) => {
        const change = stateChange(event);
        return (
          <li
            key={event.id}
            className={cn(
              "grid gap-x-4 gap-y-1 border-b border-line-subtle px-4 py-3 last:border-b-0",
              compact ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1 xs:grid-cols-[150px_minmax(0,1fr)_auto]",
            )}
          >
            {compact ? null : (
              <time dateTime={event.occurredAt} className="font-mono text-[11.5px] text-fg-subtle">
                {formatUtcDateTime(event.occurredAt)}
              </time>
            )}
            <div className="min-w-0">
              <p className="text-[13.5px] text-fg">
                {event.label}
                {compact ? null : <span className="ml-2 font-mono text-[11.5px] text-fg-subtle">{event.ref}</span>}
              </p>
              <p className="text-[12px] text-fg-muted">
                {[event.actor, compact ? null : change, compact ? null : event.version].filter(Boolean).join(" · ")}
              </p>
              {!compact && event.commit ? (
                <p className="font-mono text-[11px] text-fg-subtle">
                  {`${shortId(event.commit.updateId)} · offset ${event.commit.offset}`}
                </p>
              ) : null}
            </div>
            {compact ? (
              <time dateTime={event.occurredAt} className="font-mono text-[11px] text-fg-subtle">
                {formatUtcDateTime(event.occurredAt)}
              </time>
            ) : (
              <StatusBadge status={event.kind} className="text-[12px] xs:justify-self-end" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
