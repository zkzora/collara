import { CaseRefSchema } from "@collara/domain";
import type { Metadata } from "next";
import { AccessCenter } from "@/components/workspace/access/access-center";

export const metadata: Metadata = { title: "Sharing and access" };

/** `/app/access?caseId=CL-001` (S §9.16). The case's Sharing & Access tab is the main entry. */
export default async function AccessPage({ searchParams }: PageProps<"/app/access">) {
  const { caseId } = await searchParams;
  const parsed = CaseRefSchema.safeParse(Array.isArray(caseId) ? caseId[0] : caseId);
  return <AccessCenter caseId={parsed.success ? parsed.data : undefined} />;
}
