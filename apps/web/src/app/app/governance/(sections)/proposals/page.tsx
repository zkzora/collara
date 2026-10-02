import type { Metadata } from "next";
import { ProposalsSection } from "@/components/workspace/governance/sections";

export const metadata: Metadata = { title: "Governance proposals" };

export default function GovernanceProposalsSectionPage() {
  return <ProposalsSection />;
}
