import { MODE_BANNERS, formatMoney, money } from "@collara/domain";
import Link from "next/link";
import { StatusChip } from "./docs-ui";
import { ButtonLink, CtaRow } from "./primitives";
import { UI_MOCK_DEMO_DISCLOSURE } from "./public-demo";

// /demo while PUBLIC_DEMO_STATUS=ui_mock, and the UI-mockup notice on /pilot. Every visible string in this file is
// INFERRED copy (pending approval, Q-01) unless it comes from @collara/domain or is marked approved. Facts: the
// synthetic fixtures (CLAUDE.md), the persona order of docs/demo.md §3 (the UI_MOCK walkthrough spec follows it),
// and how the mock client keeps state (apps/web/src/lib/collara-client.tsx: one in-memory world per page load; only
// the chosen persona is kept in sessionStorage for the tab).

/** Persona order of the CL-001 walkthrough (docs/demo.md §3, steps 1–8). */
export const WALKTHROUGH_STEPS: readonly { persona: string; action: string }[] = [
  { persona: "Dana Reyes · Lender Analyst, Demo Lender A", action: "Starts the review of CA-001 and submits it for approval." },
  { persona: "Morgan Hale · Lender Approver, Demo Lender A", action: "Records the collateral decision and issues the proposal." },
  { persona: "Plant manager · Borrower, Demo Manufacturer", action: "Accepts the exact proposal version and authorizes pledge activation." },
  { persona: "Morgan Hale · Lender Approver", action: "Activates the pledge." },
  { persona: "Plant manager · Borrower", action: "Requests release. The collateral lock stays active." },
  { persona: "Morgan Hale · Lender Approver", action: "Authorizes the release." },
  { persona: "Plant manager, then Morgan Hale", action: "Each grants the auditor access to their own records." },
  { persona: "Audit lead · Auditor, Demo Auditor", action: "Exports the case report within the granted scope." },
];

export const UI_MOCK_STATE_NOTICE =
  "Changes you make are kept in memory in this browser tab only. Reloading the page, or opening the workspace in another tab, starts again from the seeded CL-001 data; only the persona you chose is remembered for the tab. Your actions are not sent to a server or a ledger.";

function H2({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mt-6 text-[19px] font-medium tracking-[-0.01em] text-fg">
      {children}
    </h2>
  );
}

/** /demo body while the UI mockup is the promoted public demo. */
export function UiMockDemo() {
  const principal = formatMoney(money("100000.00", "USD"));
  const valuation = formatMoney(money("150000.00", "USD"));
  return (
    <>
      <p className="flex flex-wrap items-center gap-2.5">
        <StatusChip status="UI_MOCKUP" label="Synthetic UI mockup" />
        <span className="text-[13px] text-fg-subtle">{MODE_BANNERS.UI_MOCK}</span>
      </p>
      <p>
        {UI_MOCK_DEMO_DISCLOSURE} The workspace runs entirely in your browser. The LocalNet version of the demo, with
        Daml contracts on a local Canton sandbox, runs only on a developer machine and is not available here.
      </p>
      <CtaRow className="mt-2">
        <ButtonLink href="/login">Start the demo</ButtonLink>
        <ButtonLink href="/docs#demo" variant="secondary" arrow>
          Synthetic demo scenario
        </ButtonLink>
      </CtaRow>

      <section aria-labelledby="demo-scenario" className="flex flex-col gap-3">
        <H2 id="demo-scenario">The case</H2>
        <p>
          CL-001 is one used CNC financing case. Demo Manufacturer, the borrower, has registered a CNC machining center
          (ASSET-DEMO-001, model DEMO-CNC-500, serial SYNTH-CNC-001). Demo Verifier has attested its evidence, and the
          evidence package is shared with Demo Lender A, the selected lender. The requested principal is {principal};
          the lender&apos;s collateral valuation of {valuation} is a separate figure.
        </p>
        {/* Approved (P-Docs, /docs#demo lead). */}
        <p>All organizations, people, documents, and amounts are synthetic. No funds are transferred.</p>
      </section>

      <section aria-labelledby="demo-personas" className="flex flex-col gap-3">
        <H2 id="demo-personas">Walk through it in this order</H2>
        <p>
          On the sign-in page, choose a demo persona. Switch personas later with the selector in the workspace sidebar.
        </p>
        <ol className="flex flex-col border-t border-white/7">
          {WALKTHROUGH_STEPS.map((step, index) => (
            <li key={`${index}-${step.persona}`} className="flex items-baseline gap-4 border-b border-white/7 py-3 text-[15.5px]">
              <span aria-hidden="true" className="flex-none font-mono text-[12px] text-highlight-strong">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <span className="text-fg">{step.persona}.</span> {step.action}
              </span>
            </li>
          ))}
        </ol>
        <p>
          To see what an unrelated party gets, switch to Lender B approver: the case is unavailable to Demo Lender B.
        </p>
      </section>

      <section aria-labelledby="demo-state" className="flex flex-col gap-3">
        <H2 id="demo-state">Where your changes live</H2>
        <p role="note" aria-labelledby="demo-state">
          {UI_MOCK_STATE_NOTICE}
        </p>
      </section>
    </>
  );
}

/** /pilot in UI_MOCK: shown above the form, before anyone fills it in. `showDemoLink` follows the public demo gate. */
export function PilotMockNotice({ showDemoLink }: { showDemoLink: boolean }) {
  return (
    <div
      role="note"
      aria-label="Example form"
      className="flex flex-col gap-2 rounded-lg border border-highlight/30 bg-highlight/8 px-5 py-4 text-[14.5px] leading-[1.6] text-fg-soft"
    >
      <p className="font-medium text-fg">This form is an example on this deployment.</p>
      <p>
        This site runs as a UI mockup. Nothing you enter here is sent or stored, and no one will contact you.
        {showDemoLink ? (
          <>
            {" "}
            {/* `Explore the demo` → /demo is approved copy (spec-content §a.3). */}
            <Link href="/demo" className="border-b border-white/30 text-fg hover:border-white/60">
              Explore the demo
            </Link>{" "}
            instead.
          </>
        ) : null}
      </p>
    </div>
  );
}
