import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isReviewTab, REVIEW_TAB_LABELS } from "@/components/workspace/review/links";
import { ReviewTabPanel } from "@/components/workspace/review/review-tabs";

export async function generateMetadata({ params }: PageProps<"/app/reviews/[reviewId]/[tab]">): Promise<Metadata> {
  const { reviewId, tab } = await params;
  const ref = decodeURIComponent(reviewId);
  return { title: isReviewTab(tab) ? `${ref} · ${REVIEW_TAB_LABELS[tab]}` : ref };
}

/** Review sections: evidence | verification-scope | assessment | decision | activity. */
export default async function ReviewTabPage({ params }: PageProps<"/app/reviews/[reviewId]/[tab]">) {
  const { tab } = await params;
  if (!isReviewTab(tab)) notFound();
  return <ReviewTabPanel tab={tab} />;
}
