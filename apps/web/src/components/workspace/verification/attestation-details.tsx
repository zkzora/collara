import { CONFIRMATION_COPY, STATUS_COPY, type Attestation } from "@collara/domain";
import type { ReactNode } from "react";
import { DefinitionList } from "@/components/collara/definition-list";
import { Panel } from "@/components/collara/panel";
import { StatusBadge } from "@/components/collara/status-badge";
import { formatUtcDate } from "@/lib/format";

function replacementText(a: Attestation): string {
  if (a.supersededBy) return `Superseded by ${a.supersededBy}`;
  if (a.supersedes) return `Replaces ${a.supersedes} · not superseded or revoked`;
  return "None · not superseded or revoked";
}

/**
 * One attestation: issuer, method, validity, supporting versions, limitations and the checked items.
 * Ownership/lien rows keep the verifier's mandated wording ("Reviewed documents"), never "verified".
 */
export function AttestationDetails({ attestation: a, footnote, headingLevel = 2 }: { attestation: Attestation; footnote?: ReactNode; headingLevel?: 2 | 3 }) {
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Panel headingLevel={headingLevel} title={<span className="font-mono">{a.ref}</span>} action={<StatusBadge status={a.validity} />}>
        {a.validity.value === "EXPIRED" ? <p className="mb-3 text-[13px] text-warning-strong">{STATUS_COPY.ATTESTATION_EXPIRED}</p> : null}
        <DefinitionList
          termWidth="sm"
          items={[
            { term: "Issuer", description: `${a.issuer.name} · ${a.verifierRegistryRef}` },
            { term: "Outcome", description: a.outcome },
            { term: "Inspection method", description: a.method },
            { term: "Inspected", description: <span className="font-mono">{formatUtcDate(a.inspectedAt)}</span> },
            { term: "Valid until", description: <span className="font-mono">{formatUtcDate(a.validUntil)}</span> },
            { term: "Supporting versions", description: a.supportingVersions.map((v) => `${v.title} v${v.version}`).join(" · ") || "—" },
            { term: "Evidence package", description: <span className="font-mono">{`${a.evidencePackage.ref} v${a.evidencePackage.version}`}</span> },
            { term: "Replacement", description: replacementText(a) },
          ]}
        />
        <p className="mt-4 rounded-md border border-line-subtle bg-surface-sunken px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">Limitations.</span> {a.limitations}
        </p>
      </Panel>
      <Panel headingLevel={headingLevel} title="Checked items" padded={false}>
        <ul>
          {a.checks.map((check) => (
            <li
              key={check.item}
              className="grid grid-cols-1 gap-x-4 gap-y-1 border-b border-line-subtle px-4 py-3 last:border-b-0 xs:grid-cols-[170px_minmax(0,1fr)_auto]"
            >
              <span className="text-[13px] text-fg">{check.item}</span>
              <span className="text-[12.5px] text-fg-muted">{check.finding || "—"}</span>
              <StatusBadge status={check.result} className="text-[12.5px]" />
            </li>
          ))}
        </ul>
        <p className="border-t border-line-subtle px-4 py-3 text-[12px] text-fg-subtle">{footnote ?? CONFIRMATION_COPY.ATTESTATION}</p>
      </Panel>
    </div>
  );
}
