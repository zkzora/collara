import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Prototype card: surface-1, 1px line, 10px radius. With a `title` it gets a header row whose title
 * is a real heading (h2 by default) so screen-reader users can jump between cards.
 */
export function Panel({
  title,
  eyebrow,
  headingLevel = 2,
  action,
  padded = true,
  className,
  bodyClassName,
  children,
  "aria-label": ariaLabel,
}: {
  title?: ReactNode;
  /** Mono uppercase label rendered as the heading instead of a title row (prototype "Current step"). */
  eyebrow?: ReactNode;
  headingLevel?: 2 | 3;
  action?: ReactNode;
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-label={ariaLabel} className={cn("min-w-0 rounded-lg border border-line bg-surface-1", className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-3.5">
          <Heading className="text-[14px] font-medium text-fg">{title}</Heading>
          {action ? <div className="text-[12px] text-fg-subtle">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn(padded && "p-[18px]", bodyClassName)}>
        {eyebrow ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            <Heading className="font-mono text-[11px] font-normal tracking-[.07em] text-fg-subtle uppercase">{eyebrow}</Heading>
            {!title && action ? <div className="text-[12px] text-fg-subtle">{action}</div> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
