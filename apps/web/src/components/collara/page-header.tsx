import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge, type StatusLike } from "./status-badge";

/**
 * Page title block. `list` pages: title, description, right-aligned meta or actions. `detail` pages
 * add a mono record id before the title and a status pill (prototype `d-hdr`).
 */
export function PageHeader({
  title,
  recordId,
  status,
  eyebrow,
  description,
  meta,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  /** Mono display id, e.g. "CL-001", rendered before the title. */
  recordId?: string;
  status?: StatusLike | null;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Small right-aligned text (sync line, counts). */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Extra rows under the description (technical ids, blockers). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("grid grid-cols-1 gap-x-5 gap-y-3 app:grid-cols-[minmax(0,1fr)_auto] app:items-end", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1.5 font-mono text-[11px] tracking-[.07em] text-fg-subtle uppercase">{eyebrow}</p> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-[22px] leading-tight font-medium tracking-[-0.02em] text-fg">
            {recordId ? (
              <>
                <span className="font-mono tracking-[-0.03em]">{recordId}</span>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
              </>
            ) : null}
            {title}
          </h1>
          {status !== undefined ? <StatusBadge status={status} variant="pill" /> : null}
        </div>
        {description ? <div className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{description}</div> : null}
        {children}
      </div>
      {meta || actions ? (
        <div className="flex flex-col items-start gap-2 app:items-end">
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          {meta ? <div className="text-[12px] text-fg-subtle app:text-right">{meta}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
