import { CollateralReview } from "@/components/workspace/review/collateral-review";

export default async function ReviewLayout({ children, params }: LayoutProps<"/app/reviews/[reviewId]">) {
  const { reviewId } = await params;
  return <CollateralReview reviewRef={decodeURIComponent(reviewId)}>{children}</CollateralReview>;
}
