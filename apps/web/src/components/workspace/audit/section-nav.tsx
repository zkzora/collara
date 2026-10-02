import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SectionNavItem {
  readonly href: string;
  readonly label: string;
  readonly active: boolean;
  /** Server-scoped count shown after the label (omit when unknown). */
  readonly count?: number;
}

/**
 * Section tabs that are routes (asset passport, collateral review, audit, governance, list filters):
 * a `nav` of links with `aria-current="page"`, never role=tablist, so history, deep links and
 * open-in-new-tab work. Scrolls sideways inside itself on narrow screens.
 */
export function SectionNav({ label, items, className }: { label: string; items: readonly SectionNavItem[]; className?: string }) {
  return (
    <nav aria-label={label} className={cn("relative overflow-x-auto border-b border-line", className)}>
      <ul className="flex min-w-max gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex h-[38px] items-center gap-2 border-b-2 px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                item.active ? "border-fg font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {item.label}
              {item.count !== undefined ? <span className="font-mono text-[11.5px] text-fg-subtle">{item.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
