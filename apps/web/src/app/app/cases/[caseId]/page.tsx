import { redirect } from "next/navigation";

/** `/app/cases/CL-001` opens the Summary tab (one canonical URL per tab). */
export default async function CaseIndexPage({ params }: PageProps<"/app/cases/[caseId]">) {
  const { caseId } = await params;
  redirect(`/app/cases/${caseId}/summary`);
}
