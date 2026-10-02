"use client";

import { ENVIRONMENT_CHIPS, GOVERNANCE_INTEGRATION_LABELS, SAVED_VIEW_LABELS, type GovernanceIntegrationStatus } from "@collara/domain";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { useCaseList, useGovernanceState } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { LedgerSyncIndicator } from "./ledger-sync";
import { casesHref, isNavActive, NAV_ITEMS, SIDEBAR_SAVED_VIEWS } from "./navigation";
import { PersonaSwitcher } from "./persona-switcher";

const INTEGRATION_SHORT: Readonly<Record<GovernanceIntegrationStatus, string>> = {
  SIMULATED: GOVERNANCE_INTEGRATION_LABELS.SIMULATED,
  PARTIAL_TIER_A: "Partial",
  DM_TIER_B: "Local DM",
  UNAVAILABLE: GOVERNANCE_INTEGRATION_LABELS.UNAVAILABLE,
};

/** Initials for the org tile: "Demo Lender A" → "LA" (the "Demo" prefix carries no information). */
function orgInitials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word && word.toLowerCase() !== "demo" && /^[A-Za-z]/.test(word));
  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  return (words[0] ?? name).slice(0, 2).toUpperCase();
}

function GovernanceBadge() {
  const { mode, me } = useSession();
  const state = useGovernanceState({ enabled: mode === "LOCALNET" && me.navigation.includes("governance") });
  const status: GovernanceIntegrationStatus = mode === "UI_MOCK" ? "SIMULATED" : (state.data?.integration.status ?? "UNAVAILABLE");
  const full = mode === "UI_MOCK" ? GOVERNANCE_INTEGRATION_LABELS.SIMULATED : (state.data?.integration.label ?? GOVERNANCE_INTEGRATION_LABELS.UNAVAILABLE);
  if (mode === "LOCALNET" && state.isPending) return null;
  return (
    <Badge variant={status === "UNAVAILABLE" ? "warning" : "neutral"} className="h-5 px-1.5 text-[10.5px]" title={full}>
      <span aria-hidden="true">{INTEGRATION_SHORT[status]}</span>
      <span className="sr-only">Integration status: {full}</span>
    </Badge>
  );
}

/**
 * Workspace navigation (232px rail ≥ 900px, also rendered inside the mobile drawer). Items come from
 * the server's `Me.navigation`; hiding an item is never the enforcement (S L140).
 */
export function Sidebar({ onNavigate, showSync = false, className }: { onNavigate?: () => void; /** The rail relies on the header; the drawer shows sync itself. */ showSync?: boolean; className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const savedViewsId = useId();
  const { me, mode, ledgerSync } = useSession();
  const hasCases = me.navigation.includes("cases");
  const cases = useCaseList("all", { enabled: hasCases });
  const counts = cases.data?.counts;
  const mainItems = me.navigation.filter((key) => key !== "settings").map((key) => NAV_ITEMS[key]);
  const currentView = pathname === "/app/cases" ? (searchParams.get("view") ?? "all") : null;

  const itemClass = (active: boolean) =>
    cn(
      "flex h-[34px] items-center gap-2.5 rounded-[7px] px-2.5 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
      active ? "bg-selected text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
    );

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-surface-nav", className)}>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Image src="/brand/collara-mark.png" alt="" width={26} height={26} className="size-[26px]" />
        <span className="text-[15.5px] font-semibold tracking-[-0.01em] text-fg">Collara</span>
      </div>

      <div className="mx-2.5 mb-3 flex flex-col gap-2.5 rounded-md border border-line bg-surface-sunken px-2.5 py-2.5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-[26px] shrink-0 place-items-center rounded-[6px] bg-info/20 text-[11px] font-semibold text-info-strong">
            {orgInitials(me.org.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-fg">{me.org.name}</p>
            <p className="truncate text-[11.5px] text-fg-muted">{me.roleLabels[0] ?? ""}</p>
          </div>
        </div>
        <PersonaSwitcher />
      </div>

      <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5">
        <ul className="flex flex-col gap-0.5">
          {mainItems.map((item) => {
            const active = isNavActive(item, pathname);
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate} className={itemClass(active)}>
                  <Icon aria-hidden="true" className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-60")} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.key === "cases" && counts ? (
                    <span className="font-mono text-[11px] text-fg-subtle">
                      {counts.all}
                      <span className="sr-only"> accessible cases</span>
                    </span>
                  ) : null}
                  {item.key === "governance" ? <GovernanceBadge /> : null}
                </Link>
              </li>
            );
          })}
        </ul>

        {hasCases ? (
          <div className="mt-[18px]">
            <h2 id={savedViewsId} className="px-2.5 pb-1.5 font-mono text-[11px] font-normal tracking-[.08em] text-fg-subtle uppercase">
              Saved views
            </h2>
            <ul aria-labelledby={savedViewsId} className="flex flex-col">
              {SIDEBAR_SAVED_VIEWS.map((view) => {
                const active = currentView === view;
                return (
                  <li key={view}>
                    <Link
                      href={casesHref(view)}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-[30px] items-center rounded-[7px] pr-2.5 pl-[26px] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "bg-selected text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
                      )}
                    >
                      <span className="flex-1 truncate">{SAVED_VIEW_LABELS[view]}</span>
                      {counts ? <span className="font-mono text-[11px] text-fg-subtle">{counts[view]}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </nav>

      <div className="flex flex-col gap-2 border-t border-line-subtle px-2.5 pt-3 pb-4">
        {me.navigation.includes("settings") ? (
          <Link
            href={NAV_ITEMS.settings.href}
            onClick={onNavigate}
            aria-current={isNavActive(NAV_ITEMS.settings, pathname) ? "page" : undefined}
            className={itemClass(isNavActive(NAV_ITEMS.settings, pathname))}
          >
            <NAV_ITEMS.settings.icon aria-hidden="true" className="size-4 opacity-60" />
            {NAV_ITEMS.settings.label}
          </Link>
        ) : null}
        <div className="flex flex-col gap-1 px-2.5">
          <span className="text-[12px] text-fg-muted">{ENVIRONMENT_CHIPS[mode]}</span>
          {showSync ? <LedgerSyncIndicator mode={mode} sync={ledgerSync} withDate /> : null}
        </div>
      </div>
    </div>
  );
}
