import { AuditCenter } from "@/components/workspace/audit/audit-center";

export default function AuditLayout({ children }: LayoutProps<"/app/audit">) {
  return <AuditCenter>{children}</AuditCenter>;
}
