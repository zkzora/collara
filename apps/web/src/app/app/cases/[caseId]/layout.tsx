import { CaseWorkspace } from "@/components/workspace/case/case-workspace";

export default async function CaseLayout({ children, params }: LayoutProps<"/app/cases/[caseId]">) {
  const { caseId } = await params;
  return <CaseWorkspace caseId={decodeURIComponent(caseId)}>{children}</CaseWorkspace>;
}
