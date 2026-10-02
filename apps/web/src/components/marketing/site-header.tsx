import Link from "next/link";
import { cn } from "@/lib/utils";
import { HeaderFrame } from "./mobile-menu";
import { PRIMARY_NAV, REQUEST_PILOT, SIGN_IN, type MarketingPageKey } from "./nav";
import { BrandLink, ButtonLink } from "./primitives";

export function SiteHeader({ current }: { current?: MarketingPageKey }) {
  const desktop = (
    <>
      <nav aria-label="Primary" className="hidden site:block">
        <ul className="flex items-center gap-[26px] text-[14px]">
          {PRIMARY_NAV.map((link) => {
            const active = link.page !== undefined && link.page === current;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("rounded-sm", active ? "text-fg hover:text-fg" : "text-fg-muted hover:text-fg")}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="hidden items-center gap-1.5 site:flex">
        <Link
          href={SIGN_IN.href}
          className="rounded-md px-3 py-2 text-[14px] text-fg-muted transition-colors hover:bg-hover hover:text-fg motion-reduce:transition-none"
        >
          {SIGN_IN.label}
        </Link>
        <ButtonLink href={REQUEST_PILOT.href} size="sm">
          {REQUEST_PILOT.label}
        </ButtonLink>
      </div>
    </>
  );

  return (
    <HeaderFrame
      brand={<BrandLink />}
      desktop={desktop}
      links={PRIMARY_NAV}
      signIn={SIGN_IN}
      requestPilot={REQUEST_PILOT}
      current={current}
    />
  );
}
