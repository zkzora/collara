import { hasImplementedCapability } from "@collara/domain";
import type { Metadata } from "next";
import { connection } from "next/server";
import {
  DemoSection,
  DocsSidebar,
  GovernanceSection,
  OverviewSection,
  PrebuildBanner,
  RolesSection,
  SetupSection,
  WorkflowDocsSection,
} from "@/components/marketing/docs";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { Container } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: { absolute: "Collara — Docs (pre-build)" },
  description:
    "Collara documentation: overview, workflow, roles and permissions, synthetic demo scenario, and planned BitSafe governance. Pre-build specification.",
};

export default async function DocsPage() {
  // Scenario dates are relative to the request time, like the synthetic fixtures (synthesis §1.6).
  await connection();
  const now = new Date();
  // The pre-build notices stay only while no capability is verified as implemented (CR-45).
  const prebuild = !hasImplementedCapability();

  return (
    <MarketingPage
      current="docs"
      footerNote={prebuild ? "Documentation v0.1 draft · pre-build." : "Documentation v0.1 draft."}
    >
      {prebuild ? <PrebuildBanner /> : null}
      <Container className="pt-14 pb-24">
        <div className="grid items-start gap-14 site:grid-cols-[220px_minmax(0,1fr)]">
          <DocsSidebar />
          <div className="flex min-w-0 flex-col gap-20">
            <OverviewSection prebuild={prebuild} />
            <WorkflowDocsSection />
            <RolesSection />
            <DemoSection now={now} />
            <GovernanceSection now={now} />
            <SetupSection />
          </div>
        </div>
      </Container>
    </MarketingPage>
  );
}
