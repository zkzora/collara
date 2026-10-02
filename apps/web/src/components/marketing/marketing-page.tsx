import type { ReactNode } from "react";
import type { MarketingPageKey } from "./nav";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Header, `<main id="main">` (skip-link target) and footer for one public page. */
export function MarketingPage({
  current,
  footerNote,
  children,
}: {
  current?: MarketingPageKey;
  footerNote?: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader current={current} />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter note={footerNote} />
    </>
  );
}
