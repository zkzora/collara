import type { Metadata } from "next";
import { MembersSection } from "@/components/workspace/governance/sections";

export const metadata: Metadata = { title: "Governance members" };

export default function GovernanceMembersSectionPage() {
  return <MembersSection />;
}
