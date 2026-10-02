"use client";

import { PLEDGE_FILTERS, type PledgeFilter } from "@collara/domain";
import Link from "next/link";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { StatusBadge } from "@/components/collara/status-badge";
import { formatUtcDate } from "@/lib/format";
import { allows, usePledgeList } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { SectionNav } from "../audit/section-nav";
import { EmptyRow, TableRegion, TD, TR, Undisclosed } from "../audit/table-region";
import { assetHref, caseTabHref, pledgeHref } from "../case/links";

export const PLEDGE_FILTER_LABELS: Readonly<Record<PledgeFilter, string>> = {
  active: "Active",
  "release-requested": "Release requested",
  released: "Released",
};

const filterHref = (filter?: PledgeFilter) => (filter ? `/app/pledges?filter=${filter}` : "/app/pledges");

/** Pledges `/app/pledges` (S §9.14): real Collara locks only; parties and principal only when authorized. */
export function PledgeList({ filter }: { filter?: PledgeFilter }) {
  const { me } = useSession();
  const list = usePledgeList(filter);

  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader
        title="Pledges"
        description={`Collateral locks visible to ${me.org.name}. A lock is released only by the designated lender's authorization.`}
      />
      <SectionNav
        label="Pledge filters"
        items={[
          { href: filterHref(), label: "All", active: !filter },
          ...PLEDGE_FILTERS.map((f) => ({ href: filterHref(f), label: PLEDGE_FILTER_LABELS[f], active: filter === f })),
        ]}
      />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <LoadingState variant="table" rows={3} label="Loading pledges…" />
      ) : (
        <TableRegion
          label={`Pledges · ${filter ? PLEDGE_FILTER_LABELS[filter] : "All"}`}
          head={["Pledge", "Asset · case", "Lender", "Borrower", "Principal reference", "Activated", "State", "Release stage", ""]}
          minWidth="min-w-[1100px]"
        >
          {list.data.items.map((p) => {
            const rr = p.releaseRequests[0] ?? null;
            return (
              <tr key={p.ref} className={TR}>
                <td className={`${TD} whitespace-nowrap`}>
                  <Link
                    href={pledgeHref(p.ref)}
                    aria-label={`Open pledge ${p.ref}`}
                    className="font-mono text-[12.5px] text-fg underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {p.ref}
                  </Link>
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  <Link href={assetHref(p.assetRef)} className="block font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
                    {p.assetRef}
                  </Link>
                  <Link href={caseTabHref(p.caseId, "pledge")} className="font-mono text-[11.5px] text-fg-subtle underline-offset-4 hover:text-fg hover:underline">
                    {p.caseId}
                  </Link>
                </td>
                <td className={TD}>{p.lender?.name ?? <Undisclosed />}</td>
                <td className={TD}>{p.borrower?.name ?? <Undisclosed />}</td>
                <td className={`${TD} font-mono text-[12.5px]`}>{p.principalRef ?? <Undisclosed />}</td>
                <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{formatUtcDate(p.activatedAt)}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  <StatusBadge status={p.state} />
                </td>
                <td className={`${TD} whitespace-nowrap`}>{rr ? <StatusBadge status={rr.state} /> : <span className="text-fg-subtle">None</span>}</td>
                <td className={`${TD} text-right whitespace-nowrap`}>
                  {allows(p, "release.request") ? (
                    <Link href={pledgeHref(p.ref)} className="text-[12.5px] text-fg underline-offset-4 hover:underline">
                      Request release
                    </Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {list.data.items.length === 0 ? <EmptyRow colSpan={9}>No pledges match this filter for your organization.</EmptyRow> : null}
        </TableRegion>
      )}
    </div>
  );
}
