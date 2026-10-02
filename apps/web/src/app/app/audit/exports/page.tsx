import type { Metadata } from "next";
import { AuditExports } from "@/components/workspace/audit/audit-exports";

export const metadata: Metadata = { title: "Audit exports" };

export default function AuditExportsPage() {
  return <AuditExports />;
}
