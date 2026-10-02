import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { SimplePage } from "@/components/marketing/simple-page";

// The terms are a blocked legal input (synthesis BPD-1). This page states that and nothing more.
export const metadata: Metadata = {
  title: "Terms",
  description: "The Collara terms are pending legal review and have not been published.",
  robots: { index: false },
};

export default function TermsPage() {
  return (
    <MarketingPage current="terms">
      <SimplePage eyebrow="Legal" title="Terms">
        <p>The Collara terms are pending legal review and have not been published.</p>
        <p>
          Collara is in development. It is not a lender, custodian, legal lien registry, or provider of guaranteed
          financing.
        </p>
      </SimplePage>
    </MarketingPage>
  );
}
