import type { ReactNode } from "react";
import { GovernanceFrame } from "@/components/workspace/governance/governance-frame";

export default function GovernanceSectionsLayout({ children }: { children: ReactNode }) {
  return <GovernanceFrame>{children}</GovernanceFrame>;
}
