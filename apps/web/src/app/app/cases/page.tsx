import { SavedViewSchema } from "@collara/domain";
import type { Metadata } from "next";
import { CaseQueue } from "@/components/workspace/case-queue";

export const metadata: Metadata = { title: "Cases" };

export default async function CasesPage({ searchParams }: PageProps<"/app/cases">) {
  const { view } = await searchParams;
  const parsed = SavedViewSchema.safeParse(Array.isArray(view) ? view[0] : view);
  return <CaseQueue view={parsed.success ? parsed.data : "all"} />;
}
