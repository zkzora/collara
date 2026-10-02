"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Container } from "./primitives";
import type { MarketingPageKey, NavLink } from "./nav";

/**
 * Sticky header frame with the mobile menu disclosure (below 920px). The desktop row is rendered on
 * the server and passed in; only the toggle and the panel need client state.
 */
export function HeaderFrame({
  brand,
  desktop,
  links,
  signIn,
  requestPilot,
  current,
}: {
  brand: ReactNode;
  desktop: ReactNode;
  links: readonly NavLink[];
  signIn: NavLink;
  requestPilot: NavLink;
  current?: MarketingPageKey;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/7 bg-surface-header backdrop-blur-[14px]">
      <Container className="flex h-16 items-center justify-between gap-6">
        {brand}
        {desktop}
        <button
          ref={buttonRef}
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex size-10 cursor-pointer items-center justify-center rounded-md border border-line-control bg-transparent text-[18px] text-fg hover:bg-hover site:hidden"
        >
          <span aria-hidden="true">{open ? "×" : "≡"}</span>
        </button>
      </Container>
      <nav
        id={panelId}
        aria-label="Mobile"
        hidden={!open}
        className="border-t border-white/7 bg-surface-page px-5 pt-2.5 pb-5 site:hidden"
      >
        <ul className="flex flex-col gap-0.5 text-[16px]">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                onClick={close}
                aria-current={link.page && link.page === current ? "page" : undefined}
                className="block rounded-md px-2 py-3 text-fg hover:bg-hover hover:text-fg"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-col gap-2">
          <Link
            href={signIn.href}
            onClick={close}
            className="flex justify-center rounded-md border border-line-strong p-3 text-[15px] text-fg hover:bg-hover hover:text-fg"
          >
            {signIn.label}
          </Link>
          <Link
            href={requestPilot.href}
            onClick={close}
            aria-current={current === requestPilot.page ? "page" : undefined}
            className="flex justify-center rounded-md bg-fg p-3 text-[15px] font-medium text-on-primary hover:bg-fg-strong hover:text-on-primary"
          >
            {requestPilot.label}
          </Link>
        </div>
      </nav>
    </header>
  );
}
