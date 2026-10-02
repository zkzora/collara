"use client";

import Link from "next/link";
import { DefinitionList } from "@/components/collara/definition-list";
import { Money } from "@/components/collara/money";
import { Panel } from "@/components/collara/panel";
import { formatUtcDate } from "@/lib/format";
import { useCaseWorkspace } from "./case-context";
import { assetHref, caseTabHref, pledgeHref } from "./links";
import { PrerequisiteList } from "./prerequisite-list";

function ReferenceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-2.5 last:border-b-0">
      <span className="text-[13px] text-fg-muted">{label}</span>
      <span className="text-right font-mono text-[12px] text-fg">{children}</span>
    </li>
  );
}

const refLink = "underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Summary tab: current step, responsible party, blockers, activation prerequisites, participants, references. */
export function SummaryTab() {
  const { detail } = useCaseWorkspace();
  const { references: refs } = detail;

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="flex flex-col gap-3.5">
        <Panel eyebrow="Current step">
          <p className="mb-4 text-base font-medium tracking-[-0.01em] text-fg">{detail.currentStep ?? "—"}</p>
          <DefinitionList
            items={[
              { term: "Responsible party", description: detail.nextActor?.label ?? "—" },
              { term: "Permitted next action", description: detail.nextAction?.label ?? "—" },
              {
                term: "Blocker",
                description: detail.blockers.length ? detail.blockers.map((b) => b.message).join(" · ") : "None",
              },
            ]}
          />
        </Panel>

        {detail.prerequisites ? (
          <Panel eyebrow="Prerequisites for pledge activation" bodyClassName="pb-2">
            <PrerequisiteList items={detail.prerequisites} />
          </Panel>
        ) : null}
      </div>

      <div className="flex flex-col gap-3.5">
        <Panel title="Participants" padded={false}>
          <ul>
            {detail.participants.map((p) => (
              <li key={`${p.org.id}-${p.roleLabel}`} className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-2.5 last:border-b-0">
                <span className="text-[13px] text-fg">
                  {p.org.name}
                  {p.isViewer ? <span className="ml-2 text-[11px] text-highlight-strong">you</span> : null}
                </span>
                <span className="text-right text-[12.5px] text-fg-muted">{p.roleLabel}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="References" padded={false}>
          <ul>
            <ReferenceRow label="Asset passport">
              <Link href={assetHref(refs.passport)} className={refLink}>
                {refs.passport}
              </Link>
            </ReferenceRow>
            <ReferenceRow label="Attestation">
              {refs.attestation ? `${refs.attestation.ref} · valid to ${formatUtcDate(refs.attestation.validUntil)}` : "—"}
            </ReferenceRow>
            <ReferenceRow label="Evidence package">
              {refs.package ? `${refs.package.ref} v${refs.package.version} · ${refs.package.documentCount} documents` : "—"}
            </ReferenceRow>
            <ReferenceRow label="Proposal">
              {refs.proposal ? (
                <Link href={caseTabHref(detail.caseId, "proposal")} className={refLink}>
                  {`${refs.proposal.ref} v${refs.proposal.version} · ${refs.proposal.state.label}`}
                </Link>
              ) : detail.allowedTabs.includes("proposal") ? (
                "Not issued"
              ) : (
                "—"
              )}
            </ReferenceRow>
            <ReferenceRow label="Pledge">
              {refs.pledge ? (
                <Link href={pledgeHref(refs.pledge.ref)} className={refLink}>
                  {`${refs.pledge.ref} · ${refs.pledge.state.label}`}
                </Link>
              ) : (
                "—"
              )}
            </ReferenceRow>
            {detail.requestedPrincipal ? (
              <ReferenceRow label="Requested principal">
                <Money value={detail.requestedPrincipal} size="sm" />
              </ReferenceRow>
            ) : null}
          </ul>
        </Panel>

        {detail.technical ? (
          <details className="rounded-lg border border-line bg-surface-1 px-4 py-3 text-[13px]">
            <summary className="cursor-pointer text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">Technical details</summary>
            <DefinitionList
              className="mt-3"
              items={[
                { term: "Asset control", description: <span className="font-mono">{`${refs.passport} · v${detail.technical.controlVersion}`}</span> },
                { term: "Evidence package", description: <span className="font-mono">{`v${detail.technical.packageVersion}`}</span> },
                { term: "Namespace", description: <span className="font-mono">{detail.technical.namespace}</span> },
              ]}
            />
          </details>
        ) : null}
      </div>
    </div>
  );
}
