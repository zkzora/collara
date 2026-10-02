import type { CaseDetail } from "@collara/domain";
import { CheckIcon, CircleDashedIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Activation prerequisites with an icon plus spoken state (never color alone). */
export function PrerequisiteList({ items }: { items: NonNullable<CaseDetail["prerequisites"]> }) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.code} className="flex items-center gap-3 border-b border-line-subtle py-2.5 last:border-b-0">
          <span
            aria-hidden="true"
            className={cn("grid size-4 shrink-0 place-items-center rounded-full border", item.done ? "border-success text-success" : "border-pending text-pending")}
          >
            {item.done ? <CheckIcon className="size-2.5" /> : <CircleDashedIcon className="size-2.5" />}
          </span>
          <span className="flex-1 text-[13.5px] text-fg">
            {item.label}
            <span className="sr-only">{item.done ? " — done" : " — pending"}</span>
          </span>
          <span className="text-right text-[12px] text-fg-muted">{item.detail}</span>
        </li>
      ))}
    </ul>
  );
}
