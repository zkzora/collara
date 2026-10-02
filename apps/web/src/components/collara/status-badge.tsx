import type { BadgeTone } from "@collara/domain";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Any domain status: `{ value, label, tone }` from @collara/domain vocabularies. */
export interface StatusLike {
  readonly label: string;
  readonly tone: BadgeTone;
}

const DOT: Readonly<Record<BadgeTone, string>> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  pending: "bg-pending",
  neutral: "bg-neutral",
};

/**
 * Status label with a tone. Meaning is always carried by the text; the color is redundant.
 * `null` means the server did not disclose the value: render "—" (never a guessed state).
 */
export function StatusBadge({
  status,
  variant = "dot",
  fallback = "—",
  className,
}: {
  status: StatusLike | null | undefined;
  /** `dot` for table cells and lists, `pill` for headers. */
  variant?: "dot" | "pill";
  fallback?: string;
  className?: string;
}) {
  if (!status) {
    return (
      <span className={cn("text-fg-subtle", className)}>
        <span aria-hidden="true">{fallback}</span>
        <span className="sr-only">Not available</span>
      </span>
    );
  }
  if (variant === "pill") {
    return (
      <Badge variant={status.tone} className={cn("h-6 px-2.5 text-[12.5px]", className)}>
        {status.label}
      </Badge>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[status.tone])} />
      {status.label}
    </span>
  );
}
