"use client";

import type { CaseDetail, Review } from "@collara/domain";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { buttonVariants } from "@/components/ui/button";
import { useCaseDetail, useReview } from "@/lib/queries";
import { useReportLedgerSync } from "@/lib/session";
import { SectionNav } from "../audit/section-nav";
import { assetHref, caseTabHref } from "../case/links";
import { REVIEW_TAB_LABELS, REVIEW_TABS, reviewTabHref } from "./links";
import { PageCommands, PageCommandStatus } from "../audit/page-command";

export interface CollateralReviewValue {
  readonly review: Review;
  readonly detail: CaseDetail;
}

const ReviewContext = createContext<CollateralReviewValue | null>(null);

export function useCollateralReview(): CollateralReviewValue {
  const value = useContext(ReviewContext);
  if (!value) throw new Error("useCollateralReview must be used inside the collateral review layout.");
  return value;
}

function snapshotLabel(review: Review): string | null {
  const s = review.evidenceSnapshot;
  return s ? `Evidence snapshot ${s.package.ref} v${s.package.version}` : null;
}

/**
 * Collateral Review frame (S §9.11, P-Dash §3.5): the review header and its route tabs. The case
 * detail supplies references (attestation, package) under the same server-side scope.
 */
export function CollateralReview({ reviewRef, children }: { reviewRef: string; children: ReactNode }) {
  const review = useReview(reviewRef);
  const caseId = review.data?.caseId ?? "";
  const detail = useCaseDetail(caseId, { enabled: !!caseId });
  const segment = useSelectedLayoutSegment();
  useReportLedgerSync(detail.data?.lastSync);

  const error = review.error ?? detail.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void review.refetch();
          if (caseId) void detail.refetch();
        }}
        action={
          <Link href="/app/reviews" className={buttonVariants({ variant: "outline" })}>
            Back to reviews
          </Link>
        }
      />
    );
  }
  if (!review.data || !detail.data) return <LoadingState variant="page" label={`Loading review ${reviewRef}…`} />;

  const r = review.data;
  const d = detail.data;
  return (
    <ReviewContext value={{ review: r, detail: d }}>
      <PageCommands detail={d}>
        <div className="flex flex-col gap-[18px]">
          <PageHeader
            eyebrow={r.ref}
            title={
              <>
                Collateral review · <span className="font-mono tracking-[-0.03em]">{r.caseId}</span>
              </>
            }
            status={r.state}
            description={
              <>
                {`${r.equipmentSummary} · `}
                <Link href={assetHref(d.asset.ref)} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
                  {d.asset.ref}
                </Link>
                {[r.analyst ? `Analyst: ${r.analyst}` : null, r.approver ? `Approver: ${r.approver}` : null, snapshotLabel(r)]
                  .filter(Boolean)
                  .map((part) => ` · ${part}`)
                  .join("")}
              </>
            }
            actions={
              <Link href={caseTabHref(r.caseId, "review")} className={buttonVariants({ variant: "outline" })}>
                Back to case
              </Link>
            }
          />
          <PageCommandStatus />
          <SectionNav
            label="Review sections"
            items={REVIEW_TABS.map((tab) => ({ href: reviewTabHref(r.ref, tab), label: REVIEW_TAB_LABELS[tab], active: segment === tab }))}
          />
          <div aria-busy={review.isFetching || detail.isFetching}>{children}</div>
        </div>
      </PageCommands>
    </ReviewContext>
  );
}
