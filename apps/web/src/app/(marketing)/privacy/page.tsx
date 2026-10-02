import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { SimplePage } from "@/components/marketing/simple-page";

// The privacy notice is a blocked legal input (synthesis BPD-1). This page states that and nothing more.
export const metadata: Metadata = {
  title: "Privacy",
  description: "The Collara privacy notice is pending legal review and has not been published.",
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <MarketingPage current="privacy">
      <SimplePage eyebrow="Legal" title="Privacy">
        <p>The Collara privacy notice is pending legal review and has not been published.</p>
      </SimplePage>
    </MarketingPage>
  );
}
