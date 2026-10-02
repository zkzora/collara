"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/collara/page-header";
import { useSession } from "@/lib/session";
import { ExportDialog } from "./export-dialog";
import { SectionNav } from "./section-nav";
import { PageCommands, PageCommandStatus } from "./page-command";

/** Audit Center frame (S §9.17, P-Dash §3.7): header, export action and the Events / Exports tabs. */
export function AuditCenter({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const pathname = usePathname();
  const onExports = pathname.startsWith("/app/audit/exports");
  return (
    <PageCommands>
      <div className="flex flex-col gap-[18px]">
        <PageHeader
          title="Audit center"
          description={`Scoped projection of committed ledger events and application actions for records ${me.org.name} can access.`}
          actions={<ExportDialog me={me} />}
        />
        <PageCommandStatus />
        <SectionNav
          label="Audit sections"
          items={[
            { href: "/app/audit", label: "Events", active: !onExports },
            { href: "/app/audit/exports", label: "Exports", active: onExports },
          ]}
        />
        {children}
      </div>
    </PageCommands>
  );
}
