import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DefinitionItem {
  readonly term: ReactNode;
  readonly description: ReactNode;
  /** Stable key when `term` is not a string. */
  readonly key?: string;
}

const TERM_WIDTH = { sm: "xs:grid-cols-[130px_minmax(0,1fr)]", md: "xs:grid-cols-[150px_minmax(0,1fr)]", lg: "xs:grid-cols-[170px_minmax(0,1fr)]" };

/** Key/value facts as a real `<dl>` (prototype key/value grids, 130–170px label column). */
export function DefinitionList({
  items,
  termWidth = "md",
  className,
}: {
  items: readonly DefinitionItem[];
  termWidth?: keyof typeof TERM_WIDTH;
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-3.5 gap-y-1 text-[13px] xs:gap-y-2.5", TERM_WIDTH[termWidth], className)}>
      {items.map((item, index) => (
        <div key={item.key ?? (typeof item.term === "string" ? item.term : index)} className="contents">
          <dt className="pt-1.5 text-fg-subtle xs:pt-0">{item.term}</dt>
          <dd className="min-w-0 break-words text-fg">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
