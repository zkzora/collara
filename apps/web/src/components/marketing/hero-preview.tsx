import { formatMoney, money } from "@collara/domain";
import { BrandMark } from "./primitives";

// Static illustration of the seeded CL-001 case (synthesis §1.6 main profile: awaiting lender review,
// no proposal, no lock). Values are synthetic; principal per CR-12. Not interactive.
const VALUATION = formatMoney(money("150000.00", "USD"));
const PRINCIPAL = formatMoney(money("100000.00", "USD"));

const EVIDENCE = [
  { title: "Inspection report", meta: "Demo Verifier · v2 · PDF", status: "Attested", attested: true },
  { title: "Dealer invoice", meta: "Demo CNC Dealer · v1 · PDF", status: "Hash verified", attested: false },
  { title: "Equipment photos (6)", meta: "Demo Manufacturer · v1 · JPEG", status: "Hash verified", attested: false },
] as const;

const monoLabel = "font-mono text-[11px] tracking-[0.08em] text-fg-subtle uppercase";

export function HeroPreview() {
  return (
    <div className="relative mx-auto mt-[72px] max-w-[1120px] px-5 site:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[15%] -top-[60px] h-[300px] bg-[radial-gradient(50%_60%_at_50%_30%,color-mix(in_oklch,var(--highlight)_13%,transparent),transparent_70%)]"
      />
      <figure
        aria-label="Illustrative demo case"
        className="relative m-0 overflow-hidden rounded-[14px] border border-white/9 bg-surface-1 shadow-[0_40px_100px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.05)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/7 px-[18px] py-3 text-[12.5px] text-fg-muted">
          <div className="flex items-center gap-2.5">
            <BrandMark size={18} />
            <span>Case workspace</span>
            <span aria-hidden="true" className="text-fg-faint">
              /
            </span>
            <span className="font-mono text-fg">CL-001</span>
          </div>
          <span className="inline-flex items-center rounded-sm bg-highlight/12 px-[9px] py-1 font-mono text-[11px] tracking-[0.03em] text-highlight-strong">
            Illustrative demo case
          </span>
        </div>

        <div className="grid text-left site:grid-cols-[1.25fr_1fr]">
          <div className="flex flex-col gap-[22px] border-b border-white/7 px-7 pt-[26px] pb-7 site:border-r site:border-b-0">
            <div>
              <p className={monoLabel}>Case</p>
              <p className="mt-1.5 text-[21px] font-medium tracking-[-0.02em]">Used CNC financing · CL-001</p>
              <p className="mt-1.5 text-[14px] text-fg-muted">CNC machining center · DEMO-CNC-500 · Serial SYNTH-CNC-001</p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] text-fg-subtle">Current stage</span>
              <span className="inline-flex items-center rounded-full border border-highlight/35 bg-highlight/8 px-2.5 py-[5px] text-[13px] text-fg">
                Awaiting lender review
              </span>
            </div>
            <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-4 gap-y-3 border-t border-white/7 pt-5 text-[14px]">
              <dt className="text-fg-subtle">Evidence</dt>
              <dd className="m-0">Inspection report · submitted</dd>
              <dt className="text-fg-subtle">Verification</dt>
              <dd className="m-0">Attestation issued · scope available</dd>
              <dt className="text-fg-subtle">Sharing</dt>
              <dd className="m-0">Shared with selected lender</dd>
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/7 pt-5">
              <div>
                <p className="text-[12px] text-fg-subtle">Next action</p>
                <p className="mt-0.5 text-[14px] text-fg-muted">Demo Lender A · Credit analyst</p>
              </div>
              {/* Looks like a button in the illustration; deliberately not interactive. */}
              <span className="inline-flex items-center gap-2 rounded-md bg-fg px-3.5 py-[9px] text-[14px] font-medium text-on-primary">
                Review evidence <span aria-hidden="true">→</span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-[18px] bg-[linear-gradient(180deg,rgb(255_255_255/0.015),transparent)] px-7 pt-[26px] pb-7">
            <p className={monoLabel}>Evidence package · shared with Demo Lender A</p>
            <ul className="flex flex-col gap-1.5">
              {EVIDENCE.map((item) => (
                <li
                  key={item.title}
                  className="flex items-center justify-between gap-2.5 rounded-md border border-white/7 bg-surface-2 px-3 py-2.5"
                >
                  <div>
                    <p className="text-[13.5px]">{item.title}</p>
                    <p className="mt-0.5 text-[12px] text-fg-subtle">{item.meta}</p>
                  </div>
                  <span className={item.attested ? "text-[12px] text-success" : "text-[12px] text-fg-muted"}>{item.status}</span>
                </li>
              ))}
            </ul>
            <div className="flex min-h-24 flex-1 items-center justify-center rounded-md border border-dashed border-white/14 p-4 text-center text-[12px] leading-normal text-fg-subtle">
              <p>
                Sample inspection report fixture
                <br />
                Page 1 of 4 · synthetic document
              </p>
            </div>
            <dl className="m-0 grid grid-cols-2 gap-2.5 text-[12.5px]">
              <div>
                <dt className="text-fg-subtle">Valuation (illustrative)</dt>
                <dd className="m-0 mt-[3px] font-mono text-[14px]">{VALUATION}</dd>
              </div>
              <div>
                <dt className="text-fg-subtle">Requested principal (illustrative)</dt>
                <dd className="m-0 mt-[3px] font-mono text-[14px]">{PRINCIPAL}</dd>
              </div>
            </dl>
          </div>
        </div>
      </figure>
    </div>
  );
}
