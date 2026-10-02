import type { Metadata } from "next";
import { RegistrySection } from "@/components/workspace/governance/sections";

export const metadata: Metadata = { title: "Verifier registry" };

export default function GovernanceRegistrySectionPage() {
  return <RegistrySection />;
}
