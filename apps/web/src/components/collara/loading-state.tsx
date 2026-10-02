import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Skeleton placeholders with an announced label. `page` mimics a header plus cards. */
export function LoadingState({
  label = "Loading…",
  variant = "card",
  rows = 4,
  className,
}: {
  label?: string;
  variant?: "page" | "table" | "card" | "inline";
  rows?: number;
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <span role="status" className={cn("text-[13px] text-fg-muted", className)}>
        {label}
      </span>
    );
  }
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-3", className)}>
      <span className="sr-only">{label}</span>
      {variant === "page" ? (
        <>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <div className="mt-3 grid grid-cols-1 gap-3 xs:grid-cols-2 app:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="mt-2 h-64 rounded-lg" />
        </>
      ) : (
        <div className={cn(variant === "card" && "rounded-lg border border-line bg-surface-1 p-4", "flex flex-col gap-3")}>
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className={cn(variant === "table" ? "h-9" : "h-5", i === 0 && variant === "card" && "w-1/3")} />
          ))}
        </div>
      )}
    </div>
  );
}
