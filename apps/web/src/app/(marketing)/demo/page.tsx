import { MODE_BANNERS } from "@collara/domain";
import type { Metadata } from "next";
import { UiMockDemo } from "@/components/marketing/demo-content";
import { StatusChip } from "@/components/marketing/docs-ui";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { ButtonLink, CtaRow } from "@/components/marketing/primitives";
import { getPublicDemo } from "@/components/marketing/runtime";
import { SimplePage } from "@/components/marketing/simple-page";

export const metadata: Metadata = {
  title: "Demo",
  description: "Synthetic demo scenario for Collara: one used CNC financing case, CL-001.",
};

/**
 * /demo is never linked while the public demo gate is off (CR-03/CR-04); visiting it directly shows
 * the pre-build state with approved copy instead of a broken page. When the gate is on, demo
 * sessions start from /login: the in-browser UI mockup (ui_mock) or the LocalNet demo (localnet),
 * each with its own disclosure.
 */
export default async function DemoPage() {
  const demo = await getPublicDemo();
  return (
    <MarketingPage current="demo">
      <SimplePage eyebrow="Demo" title="One case, CL-001, modelled end to end">
        {demo === "ui_mock" ? (
          <UiMockDemo />
        ) : demo === "localnet" ? (
          <>
            <p className="text-[13px] text-fg-subtle">{MODE_BANNERS.LOCALNET}</p>
            <p>The demo uses synthetic data on LocalNet. No funds are transferred.</p>
            <CtaRow className="mt-4">
              <ButtonLink href="/login">Sign in</ButtonLink>
              <ButtonLink href="/docs#demo" variant="secondary" arrow>
                Synthetic demo scenario
              </ButtonLink>
            </CtaRow>
          </>
        ) : (
          <>
            <p className="flex">
              <StatusChip status="PLANNED" label="LocalNet demo planned" />
            </p>
            <p>Collara is currently in development. We are seeking equipment-finance design partners.</p>
            <p>
              Privacy depends on the implemented contract model and deployment. The LocalNet demo will include
              access-denial and authorization tests.
            </p>
            <CtaRow className="mt-4">
              <ButtonLink href="/pilot">Request a pilot</ButtonLink>
              <ButtonLink href="/docs#demo" variant="secondary" arrow>
                Synthetic demo scenario
              </ButtonLink>
            </CtaRow>
          </>
        )}
      </SimplePage>
    </MarketingPage>
  );
}
