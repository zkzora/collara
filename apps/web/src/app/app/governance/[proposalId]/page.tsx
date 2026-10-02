import type { Metadata } from "next";
import { GovernanceProposalDetail } from "@/components/workspace/governance/proposal-detail";

export async function generateMetadata({ params }: PageProps<"/app/governance/[proposalId]">): Promise<Metadata> {
  const { proposalId } = await params;
  return { title: decodeURIComponent(proposalId) };
}

export default async function GovernanceProposalPage({ params }: PageProps<"/app/governance/[proposalId]">) {
  const { proposalId } = await params;
  return <GovernanceProposalDetail proposalRef={decodeURIComponent(proposalId)} />;
}
