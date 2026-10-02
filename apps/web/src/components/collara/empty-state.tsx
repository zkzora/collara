import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Nothing to show yet, with the reason and (optionally) the next permitted step. */
export function EmptyState({
  title,
  children,
  action,
  icon,
  headingLevel = 2,
  className,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cn("flex flex-col items-start gap-2.5 px-4 py-9 xs:items-center xs:text-center", className)}>
      {icon ? <span aria-hidden="true" className="text-fg-subtle [&_svg]:size-5">{icon}</span> : null}
      {title ? <Heading className="text-[15px] font-medium text-fg">{title}</Heading> : null}
      {children ? <div className="max-w-[60ch] text-[13.5px] leading-relaxed text-fg-muted">{children}</div> : null}
      {action ? <div className="mt-1.5 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
