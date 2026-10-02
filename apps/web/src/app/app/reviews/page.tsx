import type { Metadata } from "next";
import { isReviewView } from "@/components/workspace/review/links";
import { ReviewQueue } from "@/components/workspace/review/review-queue";

export const metadata: Metadata = { title: "Lender reviews" };

export default async function ReviewsPage({ searchParams }: PageProps<"/app/reviews">) {
  const { view } = await searchParams;
  const value = Array.isArray(view) ? view[0] : view;
  return <ReviewQueue view={isReviewView(value) ? value : "all"} />;
}
