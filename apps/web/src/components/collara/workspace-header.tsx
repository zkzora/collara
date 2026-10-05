"use client";

import { ENVIRONMENT_CHIPS } from "@collara/domain";
import { LogOutIcon, MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { storePersona, useCollara } from "@/lib/collara-client";
import { initials } from "@/lib/format";
import { useSession } from "@/lib/session";
import { LedgerSyncIndicator } from "./ledger-sync";
import { shortenParty } from "./canton-connection";
import { breadcrumbsFor } from "./navigation";

function Breadcrumbs() {
  const crumbs = breadcrumbsFor(usePathname());
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-[13.5px]">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="text-fg-subtle">
                  /
                </span>
              ) : null}
              {crumb.href && !last ? (
                <Link href={crumb.href} className="text-fg-muted hover:text-fg focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={crumb.mono ? "truncate font-mono text-[12.5px] text-fg" : "truncate text-fg-muted"}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function AccountMenu() {
  const { me } = useSession();
  const { mode, mock, clearSession } = useCollara();
  const router = useRouter();

  async function signOut() {
    clearSession();
    if (mode === "UI_MOCK") {
      storePersona(null);
      router.push("/login");
      return;
    }
    // The API ends the server session and clears the HttpOnly cookie; the browser never holds tokens.
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      router.replace("/login");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${me.user.displayName}, ${me.org.name}`}
        className="grid size-8 place-items-center rounded-full border border-line-control bg-surface-2 text-[11.5px] font-semibold text-fg outline-none hover:border-line-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initials(me.user.displayName)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-1.5 text-[12px] font-normal">
            <span className="text-[13px] font-medium text-fg">{me.user.displayName}</span>
            <span>{[me.user.title, me.org.name].filter(Boolean).join(" · ")}</span>
            <span>{me.roleLabels.join(", ")}</span>
            {mock ? <span className="text-fg-subtle">Synthetic demo identity</span> : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()}>
          <LogOutIcon aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 52px workspace header: drawer button (< 900px), breadcrumbs, environment chip, ledger sync, account. */
export function WorkspaceHeader({ menuOpen, onMenuToggle }: { menuOpen: boolean; onMenuToggle: () => void }) {
  const { mode, ledgerSync, me } = useSession();
  return (
    <header className="flex h-[52px] flex-none items-center gap-3 border-b border-line-subtle bg-surface-header px-4 app:px-5">
      <Button
        variant="outline"
        size="icon"
        className="app:hidden"
        aria-label="Menu"
        aria-expanded={menuOpen}
        aria-controls="workspace-drawer"
        onClick={onMenuToggle}
      >
        <MenuIcon aria-hidden="true" />
      </Button>
      <Breadcrumbs />
      <div className="flex-1" />
      {mode !== "UI_MOCK" ? (
        <span className="hidden max-w-[190px] truncate font-mono text-[11px] text-fg-subtle md:inline-flex" aria-label={`Canton party: ${me.ledgerIdentity.partyId ?? "not connected"}`}>
          {shortenParty(me.ledgerIdentity.partyId)}
        </span>
      ) : null}
      <LedgerSyncIndicator mode={mode} sync={ledgerSync} className="hidden app:inline-flex" />
      <span
        className="hidden h-7 items-center rounded-[6px] border border-line-control px-2 font-mono text-[11px] tracking-[.04em] text-fg-muted xs:inline-flex"
        aria-label={`Environment: ${ENVIRONMENT_CHIPS[mode]}`}
      >
        {ENVIRONMENT_CHIPS[mode]}
      </span>
      <AccountMenu />
    </header>
  );
}
