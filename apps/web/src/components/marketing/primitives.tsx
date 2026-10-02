import Image from "next/image";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared building blocks for the public pages. Values follow the prototype
// (docs/_research/proto-landing-docs.md §1): 1120px content width, 32px gutters (20px below 920px).

export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-[1120px] px-5 site:px-8", className)} {...props} />;
}

export function BrandMark({ size, className }: { size: number; className?: string }) {
  // Decorative: every use sits next to the visible "Collara" wordmark or in an illustration.
  return (
    <Image src="/brand/collara-mark.png" alt="" width={size} height={size} className={cn("block shrink-0", className)} />
  );
}

export function BrandLink({ size = "header" }: { size?: "header" | "footer" }) {
  const header = size === "header";
  return (
    <Link href="/" className="flex w-fit items-center gap-[9px] rounded-sm text-fg hover:text-fg-strong">
      <BrandMark size={header ? 30 : 26} />
      <span className={cn("font-semibold tracking-[-0.01em]", header ? "text-[17px]" : "text-[16px]")}>Collara</span>
    </Link>
  );
}

export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn("m-0 font-mono text-[11.5px] tracking-[0.08em] text-highlight uppercase", className)}>{children}</p>
  );
}

export function SectionTitle({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className={cn(
        "mt-4 text-[clamp(28px,3.6vw,46px)] leading-[1.08] font-medium tracking-[-0.03em] text-balance",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function Lead({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn("mt-5 text-[17px] leading-[1.6] text-pretty text-fg-muted", className)}>{children}</p>;
}

/** Eyebrow + H2 + optional lead, max 760px wide (prototype section intro). */
export function SectionIntro({
  eyebrow,
  title,
  titleId,
  lead,
}: {
  eyebrow: string;
  title: string;
  titleId?: string;
  lead?: ReactNode;
}) {
  return (
    <div className="max-w-[760px]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <SectionTitle id={titleId}>{title}</SectionTitle>
      {lead ? <Lead>{lead}</Lead> : null}
    </div>
  );
}

const buttonBase =
  "inline-flex items-center gap-2 whitespace-nowrap transition-colors motion-reduce:transition-none";
const buttonVariants = {
  primary: "bg-fg font-medium text-on-primary hover:bg-fg-strong hover:text-on-primary",
  secondary: "border border-white/14 text-fg hover:border-white/22 hover:bg-hover hover:text-fg",
} as const;
const buttonSizes = {
  lg: "rounded-[9px] px-5 py-3 text-[15px]",
  md: "rounded-[9px] px-[18px] py-[11px] text-[15px]",
  sm: "rounded-md px-3.5 py-2 text-[14px]",
} as const;

export function ButtonLink({
  href,
  variant = "primary",
  size = "lg",
  arrow = false,
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  /** Appends a decorative arrow (hidden from assistive technology). */
  arrow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}>
      {children}
      {arrow ? (
        <span aria-hidden="true" className={variant === "primary" ? "text-on-primary/60" : "text-fg-muted"}>
          →
        </span>
      ) : null}
    </Link>
  );
}

/** Surface card with the prototype's hover glow (cards on the landing page). */
export function GlowCard({
  as: Tag = "li",
  className,
  children,
}: {
  as?: "li" | "div";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "rounded-lg border border-line bg-surface-1 transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none",
        "hover:border-line-hover hover:shadow-[inset_0_0_60px_rgb(255_255_255/0.025),inset_0_1px_0_rgb(255_255_255/0.06)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** CTA row: buttons side by side, stacked full-width below 560px. */
export function CtaRow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col items-stretch gap-2.5 xs:flex-row xs:items-center [&>a]:justify-center xs:[&>a]:justify-start",
        className,
      )}
    >
      {children}
    </div>
  );
}
