import { redirect } from "next/navigation";

/** `/app/reviews/CA-001` opens the Assessment section (the prototype's default review tab). */
export default async function ReviewIndexPage({ params }: PageProps<"/app/reviews/[reviewId]">) {
  const { reviewId } = await params;
  redirect(`/app/reviews/${reviewId}/assessment`);
}
