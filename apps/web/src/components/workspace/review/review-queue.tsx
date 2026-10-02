"use client";

import { SAVED_VIEW_LABELS } from "@collara/domain";
import Link from "next/link";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { Money } from "@/components/collara/money";
import { PageHeader } from "@/components/collara/page-header";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { StatusBadge } from "@/components/collara/status-badge";
import { formatRelative, formatUtcDateTime } from "@/lib/format";
import { useReviewList } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { SectionNav } from "../audit/section-nav";
import { EmptyRow, TableRegion, TD, TR, Undisclosed } from "../audit/table-region";
import { caseTabHref, reviewHref } from "../case/links";
import { REVIEW_VIEWS, type ReviewView } from "./links";

const viewHref = (view: ReviewView) => (view === "all" ? "/app/reviews" : `/app/reviews?view=${view}`);

/** Lender Review Queue `/app/reviews` (S §9.10). Views filter on the server-computed view tags. */
export function ReviewQueue({ view }: { view: ReviewView }) {
  const { me } = useSession();
  const isLender = me.roles.includes("LENDER_ANALYST") || me.roles.includes("LENDER_APPROVER");
  const list = useReviewList({ enabled: isLender });
  const items = list.data?.items ?? [];
  const count = (v: ReviewView) => (v === "all" ? items.length : items.filter((r) => r.views.includes(v)).length);
  const rows = view === "all" ? items : items.filter((r) => r.views.includes(view));

  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader
        title="Lender reviews"
        description={`Collateral reviews for cases shared with ${me.org.name}. Eligibility applies to one lender and one case; it never means funded.`}
      />
      {!isLender ? (
        <PermissionNotice reason="organization" title="Lender reviews are not available">
          The review queue lists collateral reviews for lender organizations. Your organization follows review outcomes in each case.
        </PermissionNotice>
      ) : (
        <>
          <SectionNav
            label="Review views"
            items={REVIEW_VIEWS.map((v) => ({ href: viewHref(v), label: SAVED_VIEW_LABELS[v], active: v === view, count: list.data ? count(v) : undefined }))}
          />
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : list.isPending ? (
            <LoadingState variant="table" rows={4} label="Loading reviews…" />
          ) : (
            <TableRegion
              label={`Lender reviews · ${SAVED_VIEW_LABELS[view]}`}
              head={["Case", "Review", "Equipment", "Evidence", "Attestation", "Requested principal", "Review stage", "Analyst", "Age"]}
              minWidth="min-w-[1100px]"
            >
              {rows.map((r) => (
                <tr key={r.ref} className={TR}>
                  <td className={`${TD} whitespace-nowrap`}>
                    <Link href={caseTabHref(r.caseId, "summary")} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
                      {r.caseId}
                    </Link>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <Link
                      href={reviewHref(r.ref)}
                      aria-label={`Open review ${r.ref} for ${r.caseId}`}
                      className="font-mono text-[12.5px] text-fg underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {r.ref}
                    </Link>
                  </td>
                  <td className={TD}>{r.equipmentSummary}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <StatusBadge status={{ label: r.evidenceComplete ? "Complete" : "Incomplete", tone: r.evidenceComplete ? "success" : "warning" }} />
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <StatusBadge status={r.attestationValidity} />
                  </td>
                  <td className={TD}>{r.requestedPrincipal ? <Money value={r.requestedPrincipal} size="sm" /> : <Undisclosed />}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <StatusBadge status={r.state} />
                  </td>
                  <td className={TD}>{r.analyst ?? "—"}</td>
                  <td className={`${TD} whitespace-nowrap text-fg-muted`}>
                    <time dateTime={r.updatedAt} title={formatUtcDateTime(r.updatedAt)}>
                      {formatRelative(r.updatedAt)}
                    </time>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? <EmptyRow colSpan={9}>No reviews in this view.</EmptyRow> : null}
            </TableRegion>
          )}
        </>
      )}
    </div>
  );
}
