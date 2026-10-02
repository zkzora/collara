import { CAPABILITY_STATUS_META, type CapabilityStatus } from "@collara/domain";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Small building blocks for /docs (proto-landing-docs.md §1.9).

const CHIP_TONE: Readonly<Record<CapabilityStatus, string>> = {
  UI_MOCKUP: "border-white/18 text-fg-soft",
  SPECIFIED: "border-info/45 text-info-strong",
  PLANNED: "border-highlight/45 text-highlight-strong",
  IMPLEMENTED: "border-success/45 text-success-strong",
  NOT_AVAILABLE: "border-line-strong text-fg-muted",
};

/** Capability status chip; `label` overrides the default label (e.g. "LocalNet demo planned"). */
export function StatusChip({ status, label }: { status: CapabilityStatus; label?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-[5px] border px-[7px] py-0.5 font-mono text-[11px] leading-normal tracking-[0.06em] whitespace-nowrap uppercase",
        CHIP_TONE[status],
      )}
    >
      {label ?? CAPABILITY_STATUS_META[status].label}
    </span>
  );
}

export function DocsSection({
  id,
  kicker,
  chips,
  children,
}: {
  id: string;
  kicker: string;
  chips?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-[22px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[11px] tracking-[0.08em] text-fg-subtle uppercase">{kicker}</span>
        {chips}
      </div>
      {children}
    </section>
  );
}

export function DocsH2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-[clamp(24px,2.6vw,30px)] leading-[1.2] font-medium tracking-[-0.02em]">
      {children}
    </h2>
  );
}

export function DocsLead({ strong = false, children }: { strong?: boolean; children: ReactNode }) {
  return (
    <p
      className={cn(
        "max-w-[680px] text-pretty",
        strong ? "text-[16px] text-fg-soft" : "text-[15px] text-fg-muted",
        "leading-[1.65]",
      )}
    >
      {children}
    </p>
  );
}

export function DocsCard({
  title,
  titleAs: Title = "h3",
  filled = false,
  className,
  children,
}: {
  title?: ReactNode;
  /** h2 inside the overview (which carries the page h1), h3 under a section h2. */
  titleAs?: "h2" | "h3";
  filled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[10px] border border-line px-5 py-[18px]",
        filled && "bg-surface-sunken",
        className,
      )}
    >
      {title ? <Title className="text-[14px] font-medium">{title}</Title> : null}
      {children}
    </div>
  );
}

export function DocsList({
  ordered = false,
  small = false,
  items,
}: {
  ordered?: boolean;
  small?: boolean;
  items: readonly ReactNode[];
}) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "pl-[18px] text-fg-muted",
        ordered ? "list-decimal" : "list-disc",
        small ? "text-[13.5px]" : "text-[14px]",
        "leading-[1.7]",
      )}
    >
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </Tag>
  );
}

/** Key/value grid; one column below 560px. */
export function KeyValues({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="mt-3 grid gap-x-3 gap-y-0.5 text-[13.5px] leading-normal xs:grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] xs:gap-y-2">
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-fg-subtle">{key}</dt>
          <dd className="mb-2 text-fg-soft xs:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="border-b border-white/20 text-fg-soft hover:border-white/40 hover:text-fg">
      {children}
    </Link>
  );
}

/** Keyboard-focusable scroll region around a wide table (proto-landing-docs.md §7.10). */
export function TableRegion({ label, minWidth, children }: { label: string; minWidth: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative overflow-x-auto rounded-[10px] border border-line">
      <table className={cn("w-full border-collapse text-left", minWidth)}>{children}</table>
    </div>
  );
}

export const th = "border-b border-line px-3.5 py-2.5 text-[12px] font-medium text-fg-muted";
/** Body cells: hairline between rows, none after the last row. */
export const tbody = "[&>tr:last-child>*]:border-b-0 [&>tr>*]:border-b [&>tr>*]:border-line-subtle";
