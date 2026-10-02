import type { ReactNode } from "react";
import "./marketing.css";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="marketing" className="min-h-dvh overflow-x-clip bg-background leading-[normal] text-foreground">
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-fg px-3 py-2 text-[14px] font-medium text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      {children}
    </div>
  );
}
