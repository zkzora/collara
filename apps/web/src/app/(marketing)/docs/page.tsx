import { hasImplementedCapability } from "@collara/domain";
import type { Metadata } from "next";
import { connection } from "next/server";
import {
  DemoSection,
  DocsSidebar,
  DocsStatusBanner,
  GovernanceSection,
  OverviewSection,
  RolesSection,
  SetupSection,
  WorkflowDocsSection,
} from "@/components/marketing/docs";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { Container } from "@/components/marketing/primitives";

// The pre-build notices stay only while no capability is verified as implemented (CR-45). The capability
// config is static, so this is decided once per build.
const prebuild = !hasImplementedCapability();

export const metadata: Metadata = prebuild
  ? {
      title: { absolute: "Collara — Docs (pre-build)" },
      description:
        "Collara documentation: overview, workflow, roles and permissions, synthetic demo scenario, and planned BitSafe governance. Pre-build specification.",
    }
  : {
      // INFERRED title and description (pending approval) for the local-demo build.
      title: { absolute: "Collara — Docs" },
      description:
        "Collara documentation: overview, workflow, roles and permissions, synthetic demo scenario, BitSafe governance, and where to find setup, API and test records. Local demo with synthetic data.",
    };

export default async function DocsPage() {
  // Scenario dates are relative to the request time, like the synthetic fixtures (synthesis §1.6).
  await connection();
  const now = new Date();

  return (
    <MarketingPage
      current="docs"
      footerNote={prebuild ? "Documentation v0.1 draft · pre-build." : "Documentation v0.1 draft."}
    >
      <DocsStatusBanner prebuild={prebuild} />
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
