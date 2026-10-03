import { cn } from "@/lib/utils";
import { HeroPreview } from "./hero-preview";
import { UI_MOCK_DEMO_DISCLOSURE, type PublicDemoStatus } from "./public-demo";
import {
  BrandMark,
  ButtonLink,
  Container,
  CtaRow,
  Eyebrow,
  GlowCard,
  Lead,
  SectionIntro,
  SectionTitle,
} from "./primitives";

// Landing page sections. Copy is approved and verbatim (docs/_research/spec-content.md §a);
// layout follows the prototype (docs/_research/proto-landing-docs.md §2).

const sectionPad = "pt-[clamp(80px,10vw,140px)]";

/**
 * Pre-demo vs demo-live CTAs (spec-content.md §b). `demo` is resolved on the server from
 * PUBLIC_DEMO_STATUS and the runtime mode (public-demo.ts), so no dead demo button can ship.
 */
function PrimaryCtas({ demo }: { demo: PublicDemoStatus }) {
  return demo !== "off" ? (
    <>
      <ButtonLink href="/demo">Explore the demo</ButtonLink>
      <ButtonLink href="/pilot" variant="secondary">
        Request a pilot
      </ButtonLink>
    </>
  ) : (
    <>
      <ButtonLink href="/pilot">Request a pilot</ButtonLink>
      <ButtonLink href="/#workflow" variant="secondary" arrow>
        Read the workflow
      </ButtonLink>
    </>
  );
}

/** The hero disclosure line: approved LocalNet and pre-demo strings; the UI mockup one is INFERRED (public-demo.ts). */
const HERO_DISCLOSURE: Readonly<Record<PublicDemoStatus, string>> = {
  off: "Collara is currently in development. We are seeking equipment-finance design partners.",
  ui_mock: UI_MOCK_DEMO_DISCLOSURE,
  localnet: "The demo uses synthetic data on LocalNet. No funds are transferred.",
};

export function Hero({ demo }: { demo: PublicDemoStatus }) {
  return (
    <section aria-labelledby="hero-title" className="relative pt-[clamp(72px,10vw,132px)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(55%_50%_at_50%_0%,rgb(255_255_255/0.06),transparent_70%)]"
      />
      <Container className="relative flex flex-col items-center text-center">
        <p className="inline-flex items-center rounded-full border border-white/10 px-3 py-1.5 font-mono text-[11.5px] tracking-[0.07em] text-fg-muted uppercase">
          Private equipment collateral workflows
        </p>
        <h1
          id="hero-title"
          className="mt-7 max-w-[920px] text-[clamp(38px,6vw,74px)] leading-[1.02] font-medium tracking-[-0.035em] text-balance"
        >
          Equipment evidence and pledge workflows, coordinated privately.
        </h1>
        <p className="mt-[26px] max-w-[660px] text-[clamp(16px,1.4vw,19px)] leading-[1.55] text-pretty text-fg-muted">
          Bring used CNC equipment evidence, verification, and lender review into one coordinated workflow. Share the
          relevant records with selected counterparties and track who can authorize each pledge and release.
        </p>
        <CtaRow className="mt-9">
          <PrimaryCtas demo={demo} />
        </CtaRow>
        <p className="mt-[26px] text-[13.5px] text-fg-subtle">Starting with used CNC financing. Built on Canton.</p>
        <p className="mt-1.5 text-[13.5px] text-fg-subtle">{HERO_DISCLOSURE[demo]}</p>
      </Container>
      <HeroPreview />
    </section>
  );
}

const PROBLEMS = [
  {
    title: "Evidence across counterparties",
    body: "Bring case-specific records together without making every document visible to every participant.",
  },
  {
    title: "Status without guesswork",
    body: "Track verification, lender review, and pledge status as separate states instead of treating one approval as proof of everything.",
  },
  {
    title: "Clear authorization",
    body: "Make the responsible party and required authorization explicit before a workflow transition is submitted.",
  },
] as const;

export function ProblemSection() {
  return (
    <section id="product" aria-labelledby="problem-title" className={cn(sectionPad, "scroll-mt-16")}>
      <Container>
        <SectionIntro
          eyebrow="The problem"
          title="The documents are digital. The coordination can still be fragmented."
          titleId="problem-title"
          lead="Equipment financing can involve borrower records, dealer documents, inspection reports, and lender systems. When these records are reviewed separately, teams may need repeated follow-ups to confirm which evidence is current and who is responsible for the next step."
        />
        <ol className="mt-14 grid border-t border-line site:grid-cols-3">
          {PROBLEMS.map((item, index) => (
            <li key={item.title} className="pt-7 pr-7 pb-2 last:pr-0">
              <span aria-hidden="true" className="font-mono text-[12px] text-fg-subtle">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3.5 text-[17px] font-medium tracking-[-0.01em]">{item.title}</h3>
              <p className="mt-2.5 text-[15px] leading-[1.6] text-fg-muted">{item.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

const PRODUCT_CARDS = [
  {
    title: "Equipment Passport",
    body: "Keep the equipment identifier, submitted ownership evidence, inspection references, and document versions linked to the case.",
  },
  {
    title: "Scoped Evidence Sharing",
    body: "Share a selected evidence package with a named lender or verifier. Keep unrelated records outside that package.",
  },
  {
    title: "Pledge and Release Workflow",
    body: "Record an active collateral lock for a registered asset within Collara and require the designated lender's authorization for release.",
  },
  {
    title: "Case History",
    body: "Review the actors, decisions, evidence versions, and committed workflow transitions available within your access scope.",
  },
] as const;

export function ProductSection() {
  return (
    <section aria-labelledby="product-title" className={sectionPad}>
      <Container>
        <SectionIntro
          eyebrow="Product"
          title="One case workspace. Defined responsibilities."
          titleId="product-title"
          lead="Collara connects an equipment passport with its supporting evidence, verification scope, lender decision, and collateral workflow. Each participant works with the records and actions relevant to their role."
        />
        <ul className="mt-12 grid gap-3.5 site:grid-cols-2">
          {PRODUCT_CARDS.map((card) => (
            <GlowCard key={card.title} className="p-[26px]">
              <h3 className="text-[17px] font-medium tracking-[-0.01em]">{card.title}</h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-fg-muted">{card.body}</p>
            </GlowCard>
          ))}
        </ul>
        <p className="mt-5 flex items-start gap-2.5 text-[13.5px] leading-[1.6] text-fg-subtle">
          <span className="mt-px flex-none rounded-[4px] border border-white/10 px-1.5 py-0.5 font-mono text-[11px] tracking-[0.06em] uppercase">
            Boundary
          </span>
          <span>A Collara record is not a legal lien registration, proof of title, or verification of pledges outside Collara.</span>
        </p>
      </Container>
    </section>
  );
}

const STEPS = [
  { title: "Register the equipment", body: "Create a passport and attach case-specific equipment records." },
  { title: "Request verification", body: "Assign an accepted verifier and define what needs to be checked." },
  { title: "Share with the lender", body: "Provide the selected lender with the approved evidence package." },
  {
    title: "Record review and pledge",
    body: "Capture the lender decision and activate the collateral lock with the required authorizations.",
  },
  {
    title: "Request and authorize release",
    body: "Route a release request to the designated lender and record its decision.",
  },
  { title: "Export the case history", body: "Generate a permission-scoped record of the evidence and workflow." },
] as const;

function stepRing(index: number): string {
  if (index === 0) return "border-highlight/60 text-highlight-strong";
  if (index === STEPS.length - 1) return "border-success/60 text-success-strong";
  return "border-white/18 text-fg";
}

export function WorkflowSection() {
  return (
    <section id="workflow" aria-labelledby="workflow-title" className={cn(sectionPad, "scroll-mt-16")}>
      <Container>
        <SectionIntro eyebrow="Workflow" title="From equipment evidence to authorized release." titleId="workflow-title" />
        <div className="relative mt-14">
          {/* Connector from the centre of step 01 to the centre of step 06 (6 columns, 5 gaps of 24px). */}
          <div
            aria-hidden="true"
            className="absolute top-[17px] right-[calc((100%-120px)/6-17px)] left-[17px] hidden h-px bg-[linear-gradient(90deg,color-mix(in_oklch,var(--highlight)_50%,transparent),rgb(255_255_255/0.12)_40%,rgb(255_255_255/0.12)_60%,color-mix(in_oklch,var(--tone-success)_50%,transparent))] site:block"
          />
          <ol className="relative grid gap-6 xs:grid-cols-2 site:grid-cols-6">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-[34px] items-center justify-center rounded-full border bg-surface-page font-mono text-[12px]",
                    stepRing(index),
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-1.5 text-[15.5px] font-medium tracking-[-0.01em]">{step.title}</h3>
                <p className="text-[14px] leading-[1.6] text-fg-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-12 max-w-[760px] border-t border-line pt-5 text-[14px] leading-[1.6] text-fg-subtle">
          Credit decisions, disbursement, legal filings, and enforcement remain with the lender and its existing
          processes.
        </p>
      </Container>
    </section>
  );
}

const LENDER_CARDS = [
  { title: "Review queue", body: "See which cases need evidence, verification, or a lender decision." },
  { title: "Evidence context", body: "Review the source, version, scope, and validity of records before relying on them." },
  { title: "Release control", body: "Keep release authority with the lender named on the collateral workflow." },
  { title: "Pilot measurement", body: "Compare follow-up cycles and handling time with the current process." },
] as const;

export function LendersSection() {
  return (
    <section id="for-lenders" aria-labelledby="lenders-title" className={cn(sectionPad, "scroll-mt-16")}>
      <Container className="grid items-start gap-14 site:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="site:sticky site:top-24">
          <Eyebrow>For lenders</Eyebrow>
          <SectionTitle id="lenders-title">Start with one credit and documentation team.</SectionTitle>
          <Lead>
            Collara&apos;s initial focus is equipment-finance lenders handling used CNC machinery. The first pilot is
            designed to test one workflow alongside existing origination and servicing systems—not replace the entire
            lending stack.
          </Lead>
          <ButtonLink href="/pilot" size="md" arrow className="mt-7">
            Discuss your workflow
          </ButtonLink>
        </div>
        <ul className="grid gap-3.5 site:grid-cols-2">
          {LENDER_CARDS.map((card) => (
            <GlowCard key={card.title} className="p-6">
              <h3 className="text-[16.5px] font-medium tracking-[-0.01em]">{card.title}</h3>
              <p className="mt-2.5 text-[14.5px] leading-[1.6] text-fg-muted">{card.body}</p>
            </GlowCard>
          ))}
        </ul>
      </Container>
    </section>
  );
}

const PARTICIPANTS = [
  { title: "Equipment owners", body: "Submit equipment evidence, approve sharing, and follow the case's next steps." },
  { title: "Dealers", body: "Contribute relevant equipment records to an invited case." },
  { title: "Verifiers", body: "Review assigned evidence and issue an attestation with an explicit scope." },
  { title: "Lenders", body: "Assess the case, record decisions, and authorize collateral release." },
  { title: "Auditors", body: "Inspect and export the records covered by their access grant." },
] as const;

export function ParticipantsSection() {
  return (
    <section aria-labelledby="participants-title" className={sectionPad}>
      <Container>
        <SectionIntro
          eyebrow="Participants"
          title="Different participants. Different permissions."
          titleId="participants-title"
        />
        <ul className="mt-12 grid overflow-hidden rounded-lg border border-line bg-surface-1 site:grid-cols-5">
          {PARTICIPANTS.map((item) => (
            <li
              key={item.title}
              className="border-b border-white/7 px-[22px] py-6 last:border-b-0 site:border-r site:border-b-0 site:last:border-r-0"
            >
              <h3 className="text-[15.5px] font-medium">{item.title}</h3>
              <p className="mt-2.5 text-[14px] leading-[1.6] text-fg-muted">{item.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[14px] leading-[1.6] text-fg-subtle">
          Participation does not grant access to every document, every loan term, or every case.
        </p>
      </Container>
    </section>
  );
}

const CANTON_CARDS = [
  {
    title: "Scoped disclosure",
    body: "Design separate records for equipment evidence and financing terms so their recipients can differ.",
  },
  {
    title: "Explicit authorization",
    body: "Express verifier, owner, and lender responsibilities in the workflow rather than relying only on interface controls.",
  },
  {
    title: "Recorded transitions",
    body: "Connect case history to committed workflow events instead of treating a clicked button as a completed action.",
  },
] as const;

export function CantonSection() {
  return (
    <section
      id="why-canton"
      aria-labelledby="canton-title"
      className="mt-[clamp(80px,10vw,140px)] scroll-mt-16 border-y border-white/7 bg-surface-1 py-[clamp(72px,8vw,110px)]"
    >
      <Container>
        <SectionIntro
          eyebrow="Why Canton"
          title="Shared workflow rules without shared access to everything."
          titleId="canton-title"
          lead="Collara is being built with Daml workflows on Canton. Contract permissions define who can participate in a transition and which records are disclosed to the relevant parties."
        />
        <ul className="mt-12 grid gap-3.5 site:grid-cols-3">
          {CANTON_CARDS.map((card, index) => (
            <GlowCard key={card.title} className="bg-surface-page p-6">
              <p className="font-mono text-[12px] text-fg-subtle">Fig. {index + 1}</p>
              <h3 className="mt-3.5 text-[16.5px] font-medium tracking-[-0.01em]">{card.title}</h3>
              <p className="mt-2.5 text-[14.5px] leading-[1.6] text-fg-muted">{card.body}</p>
            </GlowCard>
          ))}
        </ul>
        <p className="mt-5 max-w-[760px] text-[14px] leading-[1.6] text-fg-subtle">
          Privacy depends on the implemented contract model and deployment. The LocalNet demo will include access-denial
          and authorization tests.
        </p>
      </Container>
    </section>
  );
}

export const PILOT_STEPS = [
  "Map one current workflow.",
  "Test with historical or approved shadow cases.",
  "Compare follow-ups, handling time, and onboarding effort.",
] as const;

export const PILOT_DISCLAIMER =
  "A pilot request is not a loan application. Do not submit financial documents through this form.";

/** The three-step pilot outline (ordered list), shared by the landing #pilot section and /pilot. */
export function PilotSteps({ className }: { className?: string }) {
  return (
    <ol className={className}>
      {PILOT_STEPS.map((step, index) => (
        <li key={step} className="flex items-baseline gap-[18px] border-b border-white/7 py-5 last:border-b-0">
          <span aria-hidden="true" className="flex-none font-mono text-[12px] text-highlight-strong">
            {index + 1}
          </span>
          <span className="text-[16px]">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function PilotSection() {
  return (
    <section id="pilot" aria-labelledby="pilot-title" className={cn(sectionPad, "scroll-mt-16")}>
      <Container className="grid items-start gap-14 site:grid-cols-2">
        <div>
          <Eyebrow>Pilot</Eyebrow>
          <SectionTitle id="pilot-title">Help shape the first used CNC financing pilot.</SectionTitle>
          <Lead>
            We are looking for a lender team willing to map its current evidence and collateral-status workflow.
            Together, we will define a limited pilot, agree on the required participants, and measure whether
            coordination improves.
          </Lead>
        </div>
        <div className="rounded-lg border border-line bg-surface-1 px-7 py-2">
          <PilotSteps />
          <div className="flex flex-col items-start gap-3.5 pt-2 pb-[22px]">
            <ButtonLink href="/pilot" size="md">
              Request a pilot
            </ButtonLink>
            <p className="text-[13px] leading-[1.6] text-fg-subtle">{PILOT_DISCLAIMER}</p>
          </div>
        </div>
      </Container>
    </section>
  );
}

const FAQ = [
  {
    q: "Is Collara a lender?",
    a: "No. Collara coordinates equipment evidence and collateral workflow. Financing decisions and funding remain with the lender.",
  },
  {
    q: "What equipment does Collara support first?",
    a: "The initial scope is used CNC machinery. Other equipment categories are outside the first pilot.",
  },
  {
    q: "Does an attestation prove legal ownership?",
    a: "Not automatically. An attestation states what a verifier checked, the evidence used, and its limitations. Legal ownership and lien checks remain separate requirements.",
  },
  {
    q: "Can Collara prevent double pledging?",
    a: "The planned workflow blocks a second active lock for the same registered asset within Collara. It does not detect every pledge outside the system or guarantee that duplicate physical-asset registrations cannot occur.",
  },
  {
    q: "Who can see my documents?",
    a: "Access depends on your case's grants and the implemented contract permissions. Only selected evidence should be disclosed to selected parties. Your hosting provider's access and trust model must also be considered.",
  },
  {
    q: "Can shared information be taken back?",
    a: "Future document access can be limited or revoked according to the workflow. Information already disclosed, downloaded, or stored by a participant cannot be guaranteed to disappear.",
  },
  {
    q: "Does Collara replace our lending system?",
    a: "No. The initial pilot is a coordination layer alongside existing credit, documentation, and servicing processes.",
  },
  {
    q: "Does the demo move money?",
    a: "No. The demo uses synthetic records on LocalNet. Cash settlement and MainNet wallet payments are outside the initial scope.",
  },
] as const;

/**
 * With the UI mockup promoted, the approved answer ("…synthetic records on LocalNet…") would describe a different
 * demo than the one linked. INFERRED replacement for its middle sentence (pending approval); "No." and the last
 * sentence stay approved.
 */
const FAQ_UI_MOCK_MONEY =
  "No. The demo is a UI mockup with synthetic records and no ledger connection. Cash settlement and MainNet wallet payments are outside the initial scope.";

function faqFor(demo: PublicDemoStatus): readonly { q: string; a: string }[] {
  return demo === "ui_mock"
    ? FAQ.map((item) => (item.q === "Does the demo move money?" ? { ...item, a: FAQ_UI_MOCK_MONEY } : item))
    : FAQ;
}

export function FaqSection({ demo }: { demo: PublicDemoStatus }) {
  return (
    <section id="faq" aria-labelledby="faq-title" className={cn(sectionPad, "scroll-mt-16")}>
      <Container className="grid items-start gap-14 site:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="site:sticky site:top-24">
          <Eyebrow>FAQ</Eyebrow>
          <SectionTitle id="faq-title">Questions before you start</SectionTitle>
        </div>
        <div className="border-t border-line">
          {faqFor(demo).map((item, index) => (
            <details key={item.q} open={index === 0} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[17px] font-medium tracking-[-0.01em] text-fg-soft group-open:text-fg hover:text-fg [&::-webkit-details-marker]:hidden">
                <span>{item.q}</span>
                <span
                  aria-hidden="true"
                  className="flex size-6 flex-none items-center justify-center rounded-full border border-white/14 text-[16px] font-light text-fg-muted transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                >
                  +
                </span>
              </summary>
              <p className="pr-10 pb-[22px] text-[15.5px] leading-[1.65] text-fg-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}

export function FinalCta({ demo }: { demo: PublicDemoStatus }) {
  return (
    <section
      aria-labelledby="final-cta-title"
      className="relative pt-[clamp(96px,12vw,160px)] pb-[clamp(80px,10vw,140px)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[20%] bottom-0 h-[360px] bg-[radial-gradient(50%_60%_at_50%_100%,color-mix(in_oklch,var(--highlight)_10%,transparent),transparent_70%)]"
      />
      <Container className="relative flex flex-col items-center text-center">
        <BrandMark size={44} className="opacity-90" />
        <h2
          id="final-cta-title"
          className="mt-7 max-w-[760px] text-[clamp(32px,4.4vw,56px)] leading-[1.04] font-medium tracking-[-0.035em] text-balance"
        >
          Make the next step in the case clear.
        </h2>
        <p className="mt-5 max-w-[560px] text-[17px] leading-[1.6] text-pretty text-fg-muted">
          Explore the equipment evidence workflow, or help us test it with a focused lender team.
        </p>
        <CtaRow className="mt-[34px]">
          <PrimaryCtas demo={demo} />
        </CtaRow>
        {demo === "ui_mock" ? <p className="mt-[22px] text-[13.5px] text-fg-subtle">{UI_MOCK_DEMO_DISCLOSURE}</p> : null}
      </Container>
    </section>
  );
}
