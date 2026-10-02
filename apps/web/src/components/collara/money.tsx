import { formatAmount, NOT_AVAILABLE, type Money as MoneyValue } from "@collara/domain";
import { cn } from "@/lib/utils";

/**
 * A decimal amount with its explicit ISO currency ("150,000.00 USD"). Missing values render
 * `Not available`, never 0. Amounts are never summed here (aggregate per currency upstream).
 */
export function Money({
  value,
  size = "md",
  className,
}: {
  value: MoneyValue | null | undefined;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  if (!value) return <span className={cn("text-fg-muted", className)}>{NOT_AVAILABLE}</span>;
  const amountSize = { sm: "text-[12.5px]", md: "text-[13.5px]", lg: "text-lg", xl: "text-2xl" }[size];
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 whitespace-nowrap", className)}>
      <span className={cn("font-mono font-medium tracking-tight text-fg", amountSize)}>{formatAmount(value)}</span>
      <span className="text-[13px] text-fg-muted">{value.currency}</span>
    </span>
  );
}
