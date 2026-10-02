import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const TH = "px-3.5 py-2.5 text-[12px] font-medium whitespace-nowrap text-fg-muted";
export const TD = "px-3.5 py-3 align-top";
export const TR = "border-b border-line-subtle last:border-b-0";

/**
 * A wide table that scrolls inside its own focusable region (keyboard users can scroll it), never
 * the page. `relative` keeps sr-only content inside the scroller on mobile.
 */
export function TableRegion({
  label,
  minWidth = "min-w-[880px]",
  head,
  children,
  className,
}: {
  /** Region name and table caption. */
  label: string;
  minWidth?: string;
  /** Column headers (rendered as `th scope="col"`); an empty string becomes an sr-only "Actions". */
  head: readonly string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("relative overflow-x-auto rounded-lg border border-line bg-surface-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <table className={cn("w-full border-collapse text-left text-[13px]", minWidth)}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-line">
            {head.map((column, index) => (
              <th key={`${column}-${index}`} scope="col" className={TH}>
                {column || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-9 text-center text-[13.5px] text-fg-muted">
        {children}
      </td>
    </tr>
  );
}

/** "—" for a value the server did not disclose to this viewer (never a guessed value). */
export function Undisclosed({ label = "Not disclosed" }: { label?: string }) {
  return (
    <span className="text-fg-subtle">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
