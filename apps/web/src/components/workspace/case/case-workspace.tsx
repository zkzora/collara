"use client";

import { CASE_TAB_LABELS, CASE_TABS, type CaseDetail, type CaseTab, type CommandStatus as CommandStatusValue } from "@collara/domain";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { CommandStatus } from "@/components/collara/command-status";
import { DataSourceBadge } from "@/components/collara/data-source-badge";
import { ErrorState } from "@/components/collara/error-state";
import { LedgerSyncIndicator } from "@/components/collara/ledger-sync";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { StatusBadge, type StatusLike } from "@/components/collara/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { useCommandProgress } from "@/lib/commands";
import { useCaseDetail } from "@/lib/queries";
import { useReportLedgerSync, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CaseWorkspaceContext, type CaseWorkspaceValue } from "./case-context";
import { assetHref, caseTabHref, isCaseTab, nextActionHref } from "./links";

function MiniTile({ label, status, fallback = "—" }: { label: string; status: StatusLike | null; fallback?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[9px] border border-line bg-surface-1 px-3.5 py-3">
      <span className="text-[11.5px] text-fg-subtle">{label}</span>
      {status ? <StatusBadge status={status} className="text-[13px]" /> : <span className="text-[13px] text-fg-muted">{fallback}</span>}
    </div>
  );
}

function StatusTiles({ detail }: { detail: CaseDetail }) {
  const { statuses } = detail;
  const evidence: StatusLike | null = statuses.evidence ? { label: statuses.evidence.label, tone: statuses.evidence.complete ? "success" : "warning" } : null;
  const verification: StatusLike | null = statuses.verification
    ? {
        label:
          statuses.verification.value === "ATTESTED" && detail.references.attestation
            ? `${statuses.verification.label} · valid to ${detail.references.attestation.validUntil.slice(0, 10)}`
            : statuses.verification.label,
        tone: statuses.attestation && statuses.attestation.value !== "VALID" ? statuses.attestation.tone : statuses.verification.tone,
      }
    : null;
  // A null proposal is "not issued" only for viewers who may see terms; otherwise it is undisclosed.
  const proposalFallback = detail.allowedTabs.includes("proposal") ? "Not issued" : "—";
  return (
    <section aria-label="Case status" className="grid grid-cols-2 gap-2.5 app:grid-cols-5">
      <MiniTile label="Evidence" status={evidence} />
      <MiniTile label="Verification" status={verification} />
      <MiniTile label="Lender review" status={statuses.review} />
      <MiniTile label="Proposal" status={statuses.proposal} fallback={proposalFallback} />
      <MiniTile label="Pledge" status={statuses.pledge} />
    </section>
  );
}

function CaseTabs({ detail, current }: { detail: CaseDetail; current: CaseTab | null }) {
  return (
    <nav aria-label="Case sections" className="relative overflow-x-auto border-b border-line">
      <ul className="flex min-w-max gap-1">
        {CASE_TABS.filter((tab) => detail.allowedTabs.includes(tab)).map((tab) => {
          const active = tab === current;
          return (
            <li key={tab}>
              <Link
                href={caseTabHref(detail.caseId, tab)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-[38px] items-center border-b-2 px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active ? "border-fg font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {CASE_TAB_LABELS[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function CaseHeader({ detail }: { detail: CaseDetail }) {
  const { mode } = useSession();
  const next = detail.nextAction;
  return (
    <PageHeader
      recordId={detail.caseId}
      title={detail.title}
      // An undisclosed stage (null) shows no pill rather than a placeholder.
      status={detail.stage ?? undefined}
      description={
        <>
          {`${detail.asset.equipmentClass} · ${detail.asset.model} · `}
          <Link href={assetHref(detail.asset.ref)} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
            {detail.asset.ref}
          </Link>
          {detail.borrower ? ` · Borrower: ${detail.borrower.name}` : null}
          {detail.selectedLender ? ` · Selected lender: ${detail.selectedLender.name}` : null}
        </>
      }
      meta={
        <span className="flex flex-col items-start gap-1 app:items-end">
          <LedgerSyncIndicator mode={mode} sync={detail.lastSync} />
          <DataSourceBadge source={detail.dataSource} className="text-[11.5px]" />
        </span>
      }
      actions={
        <div className="flex flex-col items-start gap-2 app:items-end">
          <p className="text-[12.5px] text-fg-muted">
            Next actor · <span className="text-fg">{detail.nextActor?.label ?? "—"}</span>
          </p>
          {next ? (
            <Link href={nextActionHref(detail.caseId, next.code, detail.allowedTabs)} className={cn(buttonVariants(), "h-[34px] px-3.5")}>
              {next.label} <ArrowRightIcon aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      }
    >
      {detail.blockers.length > 0 ? (
        <div className="mt-2.5 flex flex-col gap-1">
          <h2 className="sr-only">Blockers</h2>
          <ul className="flex flex-col gap-1 text-[12.5px] text-warning-strong">
            {detail.blockers.map((blocker) => (
              <li key={blocker.code}>Blocker · {blocker.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </PageHeader>
  );
}

/**
 * Case Workspace frame (S §9.13): header with next actor, next-action CTA, blockers, data source and
 * last sync; five separate status tiles; section tabs as links with aria-current; the latest action's
 * command status. Tab pages read the detail from context.
 */
export function CaseWorkspace({ caseId, children }: { caseId: string; children: ReactNode }) {
  const detailQuery = useCaseDetail(caseId);
  const segment = useSelectedLayoutSegment();
  const current = segment && isCaseTab(segment) ? segment : null;
  const [tracked, setTracked] = useState<{ caseId: string; command: CommandStatusValue } | null>(null);
  const { mode } = useSession();
  const live = useCommandProgress(tracked?.caseId === caseId ? tracked.command : null);
  useReportLedgerSync(detailQuery.data?.lastSync);

  const detail = detailQuery.data;
  const value = useMemo<CaseWorkspaceValue | null>(
    () => (detail ? { detail, trackCommand: (command) => setTracked({ caseId, command }) } : null),
    [detail, caseId],
  );

  if (detailQuery.isError) {
    return (
      <ErrorState
        error={detailQuery.error}
        onRetry={() => void detailQuery.refetch()}
        action={
          <Link href="/app/cases" className={buttonVariants({ variant: "outline" })}>
            Back to cases
          </Link>
        }
      />
    );
  }
  if (!value || !detail) return <LoadingState variant="page" label={`Loading case ${caseId}…`} />;

  return (
    <CaseWorkspaceContext value={value}>
      <div className="flex flex-col gap-[18px]">
        <CaseHeader detail={detail} />
        <CommandStatus mode={mode} command={live} />
        <StatusTiles detail={detail} />
        <CaseTabs detail={detail} current={current} />
        <div aria-busy={detailQuery.isFetching}>{children}</div>
      </div>
    </CaseWorkspaceContext>
  );
}
