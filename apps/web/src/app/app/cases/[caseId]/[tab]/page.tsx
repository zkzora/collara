import { CASE_TAB_LABELS } from "@collara/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CaseTabPanel } from "@/components/workspace/case/case-tab-panel";
import { isCaseTab } from "@/components/workspace/case/links";

export async function generateMetadata({ params }: PageProps<"/app/cases/[caseId]/[tab]">): Promise<Metadata> {
  const { caseId, tab } = await params;
  return { title: isCaseTab(tab) ? `${decodeURIComponent(caseId)} · ${CASE_TAB_LABELS[tab]}` : decodeURIComponent(caseId) };
}

/** Case sections: summary | evidence | verification | sharing | review | proposal | pledge | activity. */
export default async function CaseTabPage({ params }: PageProps<"/app/cases/[caseId]/[tab]">) {
  const { tab } = await params;
  if (!isCaseTab(tab)) notFound();
  return <CaseTabPanel tab={tab} />;
}
