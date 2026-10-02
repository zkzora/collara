"use client";

import type { GovernanceState } from "@collara/domain";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { useGovernanceState } from "@/lib/queries";
import { SectionNav } from "../audit/section-nav";
import { GovernanceNotice } from "./shared";
import { PageCommands, PageCommandStatus } from "../audit/page-command";

const GovernanceContext = createContext<GovernanceState | null>(null);

export function useGovernance(): GovernanceState {
  const value = useContext(GovernanceContext);
  if (!value) throw new Error("useGovernance must be used inside the governance layout.");
  return value;
}

const SECTIONS = [
  { href: "/app/governance/registry", label: "Verifier registry" },
  { href: "/app/governance/proposals", label: "Proposals" },
  { href: "/app/governance/members", label: "Members" },
] as const;

function Tile({ label, value, footer, href }: { label: string; value: ReactNode; footer: string; href: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-1 rounded-lg border border-line bg-surface-1 px-4 py-3.5 outline-none hover:border-line-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-[12px] text-fg-subtle">{label}</span>
      <span className="font-mono text-[22px] leading-tight text-fg">{value}</span>
      <span className="flex items-center gap-1 text-[12px] text-fg-muted group-hover:text-fg">
        {footer} <ArrowRightIcon aria-hidden="true" className="size-3" />
      </span>
    </Link>
  );
}

/**
 * Governance frame (MP #8, CR-08/28/29): verifier-registry administration by the governance seats.
 * The integration status badge is always shown; governance never touches collateral.
 */
export function GovernanceFrame({ children }: { children: ReactNode }) {
  const state = useGovernanceState();
  const pathname = usePathname();

  if (state.isError) return <ErrorState error={state.error} onRetry={() => void state.refetch()} />;
  if (state.isPending) return <LoadingState variant="page" label="Loading governance…" />;
  const s = state.data;
  const seats = s.seats.length;

  return (
    <GovernanceContext value={s}>
      <PageCommands>
        <div className="flex flex-col gap-[18px]">
          <PageHeader
            eyebrow={`BitSafe governance · ${s.integration.label}`}
            title="Governance"
            description={`Verifier-registry administration by a ${seats}-seat governance set with a ${s.threshold}-of-${seats} confirmation threshold. Proposals add or suspend verifiers. Nothing here touches collateral.`}
            meta={
              <span className="flex flex-col gap-0.5 app:items-end">
                <span>{`Decentralization Manager · ${s.integration.label}`}</span>
                <span>{`${seats} seats · threshold ${s.threshold} of ${seats} · registry v${s.registryVersion}`}</span>
              </span>
            }
          />
          <GovernanceNotice state={s} />
          <PageCommandStatus />
          <section aria-label="Governance summary" className="grid grid-cols-2 gap-2.5 app:grid-cols-4">
            <Tile label="Active verifiers" value={s.counts.activeVerifiers} footer="Assignable to verification requests" href="/app/governance/registry" />
            <Tile label="Suspended verifiers" value={s.counts.suspendedVerifiers} footer="No new assignments accepted" href="/app/governance/registry" />
            <Tile label="Open proposals" value={s.counts.openProposals} footer="Open proposals" href="/app/governance/proposals" />
            <Tile
              label="Confirmation threshold"
              value={
                <>
                  {s.threshold}
                  <span className="text-[14px] text-fg-muted">{` of ${seats}`}</span>
                </>
              }
              footer="Seats and members"
              href="/app/governance/members"
            />
          </section>
          <SectionNav label="Governance sections" items={SECTIONS.map((section) => ({ ...section, active: pathname === section.href }))} />
          {children}
        </div>
      </PageCommands>
    </GovernanceContext>
  );
}
