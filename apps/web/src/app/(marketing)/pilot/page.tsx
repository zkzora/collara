import { PILOT_COPY } from "@collara/domain";
import type { Metadata } from "next";
import { PilotMockNotice } from "@/components/marketing/demo-content";
import { PilotSteps } from "@/components/marketing/landing";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { PilotForm } from "@/components/marketing/pilot-form";
import { Container, Eyebrow, Lead } from "@/components/marketing/primitives";
import { getPublicDemo, getRuntimeMode } from "@/components/marketing/runtime";

export const metadata: Metadata = {
  title: "Request a pilot",
  description: PILOT_COPY.DESCRIPTION,
};

export default async function PilotPage() {
  const [mode, demo] = await Promise.all([getRuntimeMode(), getPublicDemo()]);
  return (
    <MarketingPage current="pilot">
      <Container className="pt-[clamp(56px,7vw,96px)] pb-[clamp(80px,10vw,140px)]">
        <div className="grid items-start gap-14 site:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="site:sticky site:top-24">
            <Eyebrow>Pilot</Eyebrow>
            <h1 className="mt-4 text-[clamp(28px,3.6vw,46px)] leading-[1.08] font-medium tracking-[-0.03em] text-balance">
              {PILOT_COPY.HEADING}
            </h1>
            <Lead>{PILOT_COPY.DESCRIPTION}</Lead>
            <PilotSteps className="mt-8 border-t border-white/7" />
          </div>
          <div className="flex flex-col gap-5">
            {/* In UI_MOCK the form submits nothing: say so before anyone fills it in. The demo link only appears
                while the UI mockup demo is promoted (no /demo link while the gate is off, CR-04). */}
            {mode === "UI_MOCK" ? <PilotMockNotice showDemoLink={demo === "ui_mock"} /> : null}
            <PilotForm mode={mode} />
          </div>
        </div>
      </Container>
    </MarketingPage>
  );
}
