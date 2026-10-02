"use client";

import { CONFIRMATION_COPY } from "@collara/domain";
import Link from "next/link";
import { DefinitionList } from "@/components/collara/definition-list";
import { EmptyState } from "@/components/collara/empty-state";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { Panel } from "@/components/collara/panel";
import { StatusBadge } from "@/components/collara/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatUtcDate } from "@/lib/format";
import { useAttestation } from "@/lib/queries";
import { useCaseWorkspace } from "./case-context";
import { assetHref } from "./links";

/** Verification tab: the asset's current attestation as disclosed to this viewer (CR-14). */
export function VerificationTab() {
  const { detail } = useCaseWorkspace();
  const ref = detail.references.attestation?.ref ?? null;
  const attestation = useAttestation(ref);

  if (!ref) {
    return (
      <Panel>
        <EmptyState
          title="No attestation"
          action={
            detail.allowedActions.includes("verification.request") ? (
              <Link href={`${assetHref(detail.asset.ref)}/verification`} className={buttonVariants({ variant: "outline" })}>
                Open asset verification
              </Link>
            ) : null
          }
        >
          {detail.statuses.verification
            ? `Verification status: ${detail.statuses.verification.label}.`
            : "No attestation for this asset is visible to your organization."}
        </EmptyState>
      </Panel>
    );
  }
  if (attestation.isError) return <ErrorState error={attestation.error} onRetry={() => void attestation.refetch()} />;
  if (attestation.isPending) return <LoadingState label="Loading attestation…" rows={6} />;

  const a = attestation.data;
  const replacement = a.supersededBy
    ? `Superseded by ${a.supersededBy}`
    : a.supersedes
      ? `Replaces ${a.supersedes} · not superseded or revoked`
      : "None · not superseded or revoked";

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Panel title={<span className="font-mono">{a.ref}</span>} action={<StatusBadge status={a.validity} />}>
        <DefinitionList
          termWidth="sm"
          items={[
            { term: "Issuer", description: `${a.issuer.name} · ${a.verifierRegistryRef}` },
            { term: "Outcome", description: a.outcome },
            { term: "Inspection method", description: a.method },
            { term: "Inspected", description: <span className="font-mono">{formatUtcDate(a.inspectedAt)}</span> },
            { term: "Valid until", description: <span className="font-mono">{formatUtcDate(a.validUntil)}</span> },
            {
              term: "Supporting versions",
              description: a.supportingVersions.map((v) => `${v.title} v${v.version}`).join(" · ") || "—",
            },
            { term: "Evidence package", description: <span className="font-mono">{`${a.evidencePackage.ref} v${a.evidencePackage.version}`}</span> },
            { term: "Replacement", description: replacement },
          ]}
        />
        <p className="mt-4 rounded-md border border-line-subtle bg-surface-sunken px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">Limitations.</span> {a.limitations}
        </p>
      </Panel>

      <Panel title="Checked items" padded={false}>
        <ul>
          {a.checks.map((check) => (
            <li
              key={check.item}
              className="grid grid-cols-1 gap-x-4 gap-y-1 border-b border-line-subtle px-4 py-3 last:border-b-0 xs:grid-cols-[170px_minmax(0,1fr)_auto]"
            >
              <span className="text-[13px] text-fg">{check.item}</span>
              <span className="text-[12.5px] text-fg-muted">{check.finding}</span>
              <StatusBadge status={check.result} className="text-[12.5px]" />
            </li>
          ))}
        </ul>
        <p className="border-t border-line-subtle px-4 py-3 text-[12px] text-fg-subtle">{CONFIRMATION_COPY.ATTESTATION}</p>
      </Panel>
    </div>
  );
}
