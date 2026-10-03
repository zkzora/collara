import type { Metadata } from "next";
import {
  CantonSection,
  FaqSection,
  FinalCta,
  Hero,
  LendersSection,
  ParticipantsSection,
  PilotSection,
  ProblemSection,
  ProductSection,
  WorkflowSection,
} from "@/components/marketing/landing";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { getPublicDemo } from "@/components/marketing/runtime";

// Approved metadata (spec-content.md §a.1).
export const metadata: Metadata = {
  title: { absolute: "Collara — Private Equipment Collateral Workflows" },
  description:
    "Coordinate used CNC equipment evidence, lender review, and authorized pledge and release workflows with Collara, built on Canton.",
  openGraph: {
    type: "website",
    siteName: "Collara",
    title: "Equipment evidence. Authorized collateral workflows.",
    description: "A private coordination workspace for lenders, equipment owners, and verifiers.",
  },
  twitter: {
    card: "summary",
    title: "Equipment evidence. Authorized collateral workflows.",
    description: "A private coordination workspace for lenders, equipment owners, and verifiers.",
  },
};

export default async function HomePage() {
  const demo = await getPublicDemo();
  return (
    <MarketingPage current="home">
      <Hero demo={demo} />
      <ProblemSection />
      <ProductSection />
      <WorkflowSection />
      <LendersSection />
      <ParticipantsSection />
      <CantonSection />
      <PilotSection />
      <FaqSection demo={demo} />
      <FinalCta demo={demo} />
    </MarketingPage>
  );
}
