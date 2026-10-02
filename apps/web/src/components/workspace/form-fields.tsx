"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full min-w-0 rounded-md border border-line-strong bg-surface-sunken px-2.5 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-subtle hover:border-line-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-danger aria-invalid:ring-danger/20 disabled:opacity-60";

/**
 * Label + control + hint + error, wired with htmlFor / aria-describedby / aria-invalid so the error
 * is announced with the field. Pass the RHF `register(...)` spread as `inputProps`.
 */
export function Field({
  label,
  hint,
  error,
  tag,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Small badge next to the label (e.g. "Internal · Demo Lender A only"); announced as a hint. */
  tag?: string;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [tag || hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-[12.5px] font-medium text-fg-muted">
          {label}
        </label>
        {tag ? (
          <span aria-hidden="true" className="rounded-[4px] bg-pending/12 px-1.5 py-px font-mono text-[10.5px] tracking-[.04em] text-pending-strong uppercase">
            {tag}
          </span>
        ) : null}
      </div>
      {children({ id, describedBy, invalid: !!error })}
      {tag || hint ? (
        <p id={hintId} className={cn("text-[12px] text-fg-subtle", tag && !hint && "sr-only")}>
          {[tag, hint].filter(Boolean).map((part, index) => (
            <span key={index}>{index > 0 ? " · " : null}{part}</span>
          ))}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[12px] text-danger-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Wired = { id: string; describedBy: string | undefined; invalid: boolean };

export function TextInput({ wired, className, ...props }: ComponentProps<"input"> & { wired: Wired }) {
  return (
    <input id={wired.id} aria-describedby={wired.describedBy} aria-invalid={wired.invalid || undefined} className={cn(control, "h-9", className)} {...props} />
  );
}

export function TextArea({ wired, className, ...props }: ComponentProps<"textarea"> & { wired: Wired }) {
  return (
    <textarea
      id={wired.id}
      aria-describedby={wired.describedBy}
      aria-invalid={wired.invalid || undefined}
      className={cn(control, "min-h-[72px] py-2 leading-relaxed", className)}
      {...props}
    />
  );
}

export function SelectInput({ wired, className, children, ...props }: ComponentProps<"select"> & { wired: Wired }) {
  return (
    <select id={wired.id} aria-describedby={wired.describedBy} aria-invalid={wired.invalid || undefined} className={cn(control, "h-9", className)} {...props}>
      {children}
    </select>
  );
}
