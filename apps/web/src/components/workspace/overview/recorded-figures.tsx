"use client";

import { BOUNDARY_COPY, NOT_AVAILABLE, type OverviewFigure, type RuntimeMode } from "@collara/domain";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/collara/error-state";
import { ledgerSyncText } from "@/components/collara/ledger-sync";
import { LoadingState } from "@/components/collara/loading-state";
import { Money } from "@/components/collara/money";
import { Panel } from "@/components/collara/panel";
import { useCollara } from "@/lib/collara-client";
import { useSession } from "@/lib/session";

export function useOverview({ enabled = true }: { enabled?: boolean } = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.overview(), queryFn: ({ signal }) => client.overview.get({ signal }), enabled });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** INFERRED copy (needs approval): coverage and date lines of a recorded figure. */
export function coverageLine(figure: OverviewFigure, noun: string): string {
  const { included, of } = figure.coverage;
  if (of === 0) return "No active pledges in your organization's scope.";
  return `${included} of ${plural(of, "active pledge", "active pledges")} with a recorded ${noun}.`;
}

function datesLine(figure: OverviewFigure, what: string): string | null {
  if (!figure.dates) return null;
  const { earliest, latest } = figure.dates;
  return earliest === latest ? `${what} ${latest}` : `${what} ${earliest} to ${latest}`;
}

function Figure({ figure, noun, dated, mode, sync }: { figure: OverviewFigure; noun: string; dated: string; mode: RuntimeMode; sync: { offset: number | null; at: string | null } }) {
  const multi = figure.totals.length > 1;
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-[13px] font-normal text-fg-muted">{figure.label}</h2>
      {figure.totals.length === 0 ? (
        <p className="text-lg text-fg-muted">{NOT_AVAILABLE}</p>
      ) : (
        // One line per currency; amounts in different currencies are never added together.
        <ul className="flex flex-col gap-1" aria-label={`${figure.label} by currency`}>
          {figure.totals.map((t) => (
            <li key={t.total.currency} className="flex flex-wrap items-baseline gap-x-2">
              <Money value={t.total} size="lg" />
              {multi ? <span className="text-[12px] text-fg-subtle">{plural(t.count, "pledge", "pledges")}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] leading-relaxed text-fg-subtle">{coverageLine(figure, noun)}</p>
      <p className="text-[12px] leading-relaxed text-fg-subtle">
        {[`Source: ${figure.source}`, datesLine(figure, dated), ledgerSyncText(mode, sync, { withDate: true })].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

/**
 * `Recorded financing principal` / `Recorded collateral valuation` (S §9.1, synthesis §1.4.2 #13): one total per
 * currency from GET /api/overview (the viewer's own scope), with coverage and source. A figure the server omits
 * (not disclosed to this organization) is not shown; nothing recorded reads `Not available`, never 0.
 */
export function RecordedFigures({ expected }: { expected: boolean }) {
  const { mode } = useSession();
  const overview = useOverview();
  if (overview.isError) {
    return expected ? (
      <Panel aria-label="Recorded figures">
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      </Panel>
    ) : null;
  }
  if (overview.isPending) {
    return expected ? (
      <Panel aria-label="Recorded figures">
        <LoadingState variant="inline" label="Loading recorded figures…" />
      </Panel>
    ) : null;
  }
  const { principal, valuation, lastSync } = overview.data;
  if (!principal && !valuation) return null;
  return (
    <Panel aria-label="Recorded figures" bodyClassName="flex flex-col gap-4">
      {principal ? <Figure figure={principal} noun="principal" dated="Activated" mode={mode} sync={lastSync} /> : null}
      {principal ? <p className="-mt-2 text-[12px] text-fg-subtle">Not a valuation, balance, or TVL figure.</p> : null}
      {principal && valuation ? <div className="border-t border-line-subtle" /> : null}
      {valuation ? <Figure figure={valuation} noun="valuation" dated="Valuation date" mode={mode} sync={lastSync} /> : null}
      <p className="text-[12px] text-fg-subtle">{BOUNDARY_COPY.VALUATION_PRINCIPAL_SEPARATE}</p>
    </Panel>
  );
}
