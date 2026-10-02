"use client";

import { errorMessage } from "@collara/api-client";
import { assetControlStates, BOUNDARY_COPY, type AssetDetail, type AssetTab, type EvidenceDocument } from "@collara/domain";
import { ArrowRightIcon, DownloadIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { CaseTimeline } from "@/components/collara/case-timeline";
import { DefinitionList } from "@/components/collara/definition-list";
import { EmptyState } from "@/components/collara/empty-state";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { Panel } from "@/components/collara/panel";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { StatusBadge } from "@/components/collara/status-badge";
import { Button } from "@/components/ui/button";
import { useCollara } from "@/lib/collara-client";
import { formatRelative, formatUtcDate, formatUtcDateTime, shortId } from "@/lib/format";
import { LIST_LIMIT, useAuditEvents } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { openDownload } from "../audit/download";
import { EmptyRow, TableRegion, TD, TR, Undisclosed } from "../audit/table-region";
import { caseTabHref, pledgeHref } from "../case/links";
import { AttestationDetails } from "../verification/attestation-details";
import { RequestVerificationDialog } from "../verification/request-verification-dialog";
import { useAssetPassport } from "./asset-passport";
import { EvidenceUploadDialog } from "./evidence-upload-dialog";
import { ASSET_TAB_LABELS, verificationHref } from "./links";
import { useAssetAttestation, useAssetEvidence } from "./queries";

function ControlStatus({ control }: { control: NonNullable<AssetDetail["control"]> }) {
  const locked = control.lockRef !== null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge status={assetControlStates.badge(locked ? "LOCKED" : "AVAILABLE")} />
      {control.version !== null ? <span className="font-mono text-[12px] text-fg-muted">v{control.version}</span> : null}
      {control.lockRef ? (
        <Link href={pledgeHref(control.lockRef)} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
          {control.lockRef}
        </Link>
      ) : null}
      {locked ? <span className="text-[12px] text-fg-muted">{control.state.label}</span> : null}
    </span>
  );
}

function PermittedActions({ detail }: { detail: AssetDetail }) {
  const { me } = useSession();
  const isOwner = me.roles.includes("BORROWER") && detail.owner?.id === me.org.id;
  const canUpload = detail.allowedActions.includes("evidence.upload");
  const canRequest = detail.allowedActions.includes("verification.request");
  // The owner acts from here even before the Evidence or Verification sections have content.
  const documents = useAssetEvidence(detail.ref, { enabled: canUpload || canRequest });
  const rows = [
    {
      label: "Add evidence",
      allowed: canUpload,
      reason: isOwner ? "Not available in the current passport state" : "Owner only",
      action: documents.data ? <EvidenceUploadDialog detail={detail} me={me} documents={documents.data} size="sm" /> : null,
    },
    {
      label: "Request verification",
      allowed: canRequest,
      reason: isOwner ? "Not available while a verification request is open or the passport is not registered" : "Owner only",
      action: documents.data ? <RequestVerificationDialog detail={detail} me={me} documents={documents.data} size="sm" /> : null,
    },
  ];
  return (
    <Panel eyebrow={`Permitted actions · ${me.org.name}`}>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3 border-b border-line-subtle py-2.5 first:pt-0 last:border-b-0">
            <span className={cn("text-[13.5px]", row.allowed ? "text-fg" : "text-fg-muted")}>{row.label}</span>
            {row.allowed && row.action ? row.action : (
              <span className={cn("text-right text-[12.5px]", row.allowed ? "text-success-strong" : "text-fg-subtle")}>
                {row.allowed ? "Available" : row.reason}
              </span>
            )}
          </li>
        ))}
        <li className="flex items-start justify-between gap-3 py-2.5 last:pb-0">
          <span className="text-[13.5px] text-fg-muted">Transfer ownership</span>
          <span className="text-right text-[12.5px] text-fg-subtle">Planned · blocked while locked</span>
        </li>
      </ul>
    </Panel>
  );
}

function OverviewTab() {
  const detail = useAssetPassport();
  const { attestation } = useAssetAttestation(detail);
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Panel eyebrow="Equipment identity">
        <DefinitionList
          termWidth="lg"
          items={[
            { term: "Equipment class", description: detail.equipmentClass },
            { term: "Manufacturer", description: detail.manufacturer },
            { term: "Model", description: <span className="font-mono">{detail.model}</span> },
            { term: "Serial number", description: detail.serialNumber ? <span className="font-mono">{detail.serialNumber}</span> : <Undisclosed /> },
            { term: "Year of manufacture", description: detail.yearOfManufacture ?? "—" },
            { term: "Asset ID · namespace", description: <span className="font-mono">{`${detail.ref} · ${detail.namespace}`}</span> },
            {
              term: "Owner organization",
              description: detail.owner
                ? `${detail.owner.name}${detail.ownerClaimSource ? ` · claim source: ${detail.ownerClaimSource}` : ""}`
                : <Undisclosed />,
            },
            { term: "Location scope", description: detail.locationScope ?? <Undisclosed /> },
            { term: "Registered", description: <span className="font-mono">{detail.registeredAt ? formatUtcDateTime(detail.registeredAt) : "Not registered"}</span> },
            { term: "Last update", description: <span className="font-mono">{formatUtcDateTime(detail.updatedAt)}</span> },
          ]}
        />
      </Panel>
      <div className="flex flex-col gap-3.5">
        <Panel eyebrow="Verification and evidence">
          <DefinitionList
            termWidth="sm"
            items={[
              {
                term: "Attestation",
                description: attestation ? (
                  <span>
                    <span className="font-mono">{attestation.ref}</span>
                    {` · valid to ${formatUtcDate(attestation.validUntil)} · `}
                    <StatusBadge status={attestation.validity} />
                  </span>
                ) : detail.attestation ? (
                  <StatusBadge status={detail.attestation} />
                ) : (
                  "No attestation"
                ),
              },
              { term: "Verification", description: <StatusBadge status={detail.verification} fallback="None visible" /> },
              ...(attestation ? [{ term: "Checked scope", description: attestation.checks.map((c) => c.item).join(", ") }] : []),
              {
                term: "Evidence",
                description: detail.evidence ? (
                  <span>
                    {`${detail.evidence.documentCount} documents · `}
                    <span className="font-mono">{`${detail.evidence.packageRef} v${detail.evidence.packageVersion}`}</span>
                  </span>
                ) : (
                  <Undisclosed />
                ),
              },
              {
                term: "Collateral control",
                description: detail.control ? <ControlStatus control={detail.control} /> : <Undisclosed label="Not disclosed to your organization" />,
              },
            ]}
          />
        </Panel>
        <PermittedActions detail={detail} />
      </div>
    </div>
  );
}

function EvidenceTable({ detail, documents }: { detail: AssetDetail; documents: readonly EvidenceDocument[] }) {
  const { client } = useCollara();
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(doc: EvidenceDocument) {
    setDownloading(doc.id);
    try {
      const link = await client.evidence.download(doc.id);
      openDownload(link.url, `${doc.id}-v${doc.version}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <TableRegion
      label={`Evidence documents · ${detail.ref}`}
      head={["Document", "Source", "Version", "Uploaded", "Integrity (SHA-256)", "Scan", "Sharing scope", ""]}
      minWidth="min-w-[1080px]"
    >
      {documents.map((doc) => (
        <tr key={doc.id} className={TR}>
          <td className={TD}>
            <p className="text-fg">{doc.title}</p>
            <p className="text-[12px] text-fg-subtle">
              <span className="font-mono">{doc.id}</span> · {doc.mediaSummary}
            </p>
            {doc.status.value !== "AVAILABLE" ? <StatusBadge status={doc.status} className="mt-1 text-[12px]" /> : null}
          </td>
          <td className={TD}>
            <p>{doc.source.name}</p>
            <p className="text-[12px] text-fg-subtle">{doc.uploadedBy}</p>
          </td>
          <td className={TD}>
            <span className="font-mono">v{doc.version}</span>
            {doc.versions.length > 1 ? (
              <ol aria-label={`Version history of ${doc.title}`} className="mt-1 flex flex-col text-[11.5px] text-fg-subtle">
                {[...doc.versions].reverse().map((v) => (
                  <li key={v.version} className="font-mono whitespace-nowrap">{`v${v.version} · ${formatUtcDate(v.uploadedAt)}`}</li>
                ))}
              </ol>
            ) : null}
          </td>
          <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>
            <time dateTime={doc.uploadedAt}>{formatUtcDate(doc.uploadedAt)}</time>
          </td>
          <td className={TD}>
            <StatusBadge status={doc.integrity.state} />
            <p className="mt-1 font-mono text-[11.5px] text-fg-subtle" title={doc.integrity.hash ?? undefined}>
              {doc.integrity.hash ? shortId(doc.integrity.hash, 8, 6) : "No hash recorded"}
            </p>
          </td>
          <td className={`${TD} whitespace-nowrap`}>
            <StatusBadge status={doc.scanStatus} />
          </td>
          <td className={`${TD} text-[12.5px] text-fg-muted`}>{doc.sharingScope.length ? doc.sharingScope.join(" · ") : "—"}</td>
          <td className={`${TD} text-right`}>
            {doc.canDownload ? (
              <Button size="sm" variant="outline" disabled={downloading === doc.id} onClick={() => void download(doc)} aria-label={`Download ${doc.title} v${doc.version}`}>
                <DownloadIcon aria-hidden="true" />
                Download
              </Button>
            ) : (
              <Undisclosed label="Download not permitted" />
            )}
          </td>
        </tr>
      ))}
      {documents.length === 0 ? <EmptyRow colSpan={8}>No evidence documents are visible to your organization.</EmptyRow> : null}
    </TableRegion>
  );
}

function EvidenceTab() {
  const detail = useAssetPassport();
  const { me } = useSession();
  const evidence = useAssetEvidence(detail.ref);
  return (
    <div className="flex flex-col gap-3">
      {evidence.isError ? (
        <ErrorState error={evidence.error} onRetry={() => void evidence.refetch()} />
      ) : evidence.isPending ? (
        <LoadingState variant="table" rows={5} label="Loading evidence…" />
      ) : (
        <>
          {detail.allowedActions.includes("evidence.upload") ? (
            <div className="flex flex-wrap gap-2">
              <EvidenceUploadDialog detail={detail} me={me} documents={evidence.data} />
            </div>
          ) : null}
          <EvidenceTable detail={detail} documents={evidence.data} />
        </>
      )}
      <p className="text-[12px] leading-relaxed text-fg-subtle">{BOUNDARY_COPY.HASH_MATCH}</p>
      <p className="text-[12px] leading-relaxed text-fg-subtle">{BOUNDARY_COPY.NOT_SCANNED}</p>
    </div>
  );
}

function VerificationTab() {
  const detail = useAssetPassport();
  const { me } = useSession();
  const { attestation, requests, isPending, error, refetch } = useAssetAttestation(detail);
  const canRequest = detail.allowedActions.includes("verification.request");
  const evidence = useAssetEvidence(detail.ref, { enabled: canRequest });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isPending) return <LoadingState rows={6} label="Loading verification…" />;

  return (
    <div className="flex flex-col gap-3.5">
      {canRequest ? (
        <div className="flex flex-wrap gap-2">
          {evidence.data ? <RequestVerificationDialog detail={detail} me={me} documents={evidence.data} /> : <LoadingState variant="inline" label="Loading documents…" />}
        </div>
      ) : null}
      {requests.length > 0 ? (
        <TableRegion label={`Verification requests · ${detail.ref}`} head={["Request", "Verifier", "Scope", "Stage", "Requested", "Last activity"]} minWidth="min-w-[760px]">
          {requests.map((vr) => (
            <tr key={vr.ref} className={TR}>
              <td className={`${TD} whitespace-nowrap`}>
                <Link href={verificationHref(vr.ref)} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
                  {vr.ref}
                </Link>
              </td>
              <td className={TD}>
                {vr.verifier.name}
                <span className="block font-mono text-[11.5px] text-fg-subtle">{vr.verifierRegistryRef}</span>
              </td>
              <td className={`${TD} text-fg-muted`}>{`${vr.scope.length} checklist items`}</td>
              <td className={`${TD} whitespace-nowrap`}>
                <StatusBadge status={vr.state} />
              </td>
              <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{formatUtcDate(vr.requestedAt)}</td>
              <td className={`${TD} whitespace-nowrap text-fg-muted`}>{formatRelative(vr.updatedAt)}</td>
            </tr>
          ))}
        </TableRegion>
      ) : null}
      {attestation ? (
        <AttestationDetails attestation={attestation} />
      ) : (
        <Panel>
          <EmptyState title="No attestation">
            {detail.verification ? `Verification status: ${detail.verification.label}.` : "No attestation for this asset is visible to your organization."}
          </EmptyState>
        </Panel>
      )}
    </div>
  );
}

function CasesTab() {
  const detail = useAssetPassport();
  return (
    <div className="flex flex-col gap-3">
      <Panel padded={false} aria-label={`Cases · ${detail.ref}`}>
        <ul>
          {detail.cases.map((c) => (
            <li key={c.caseId} className="border-b border-line-subtle last:border-b-0">
              <Link
                href={caseTabHref(c.caseId, "summary")}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[13px] text-fg">{c.caseId}</span>
                  <span className="text-[13.5px] text-fg-muted">{c.title}</span>
                </span>
                <span className="flex items-center gap-2 text-[13px]">
                  <StatusBadge status={c.stage} />
                  <ArrowRightIcon aria-hidden="true" className="size-4 text-fg-subtle" />
                </span>
              </Link>
            </li>
          ))}
          {detail.cases.length === 0 ? <li className="px-4 py-6 text-[13.5px] text-fg-muted">No cases are visible to your organization.</li> : null}
        </ul>
      </Panel>
      <p className="text-[12px] text-fg-subtle">Only cases your organization is permitted to see are listed.</p>
    </div>
  );
}

function ActivityTab() {
  const detail = useAssetPassport();
  const activity = useAuditEvents({ assetRef: detail.ref, limit: LIST_LIMIT });
  return (
    <div className="flex flex-col gap-3">
      {activity.isError ? (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      ) : activity.isPending ? (
        <LoadingState variant="table" rows={5} label="Loading activity…" />
      ) : (
        <Panel padded={false} aria-label={`Passport activity · ${detail.ref}`}>
          <CaseTimeline events={activity.data.items} />
        </Panel>
      )}
      <p className="text-[12px] text-fg-subtle">
        Passport activity lists asset, passport, verification and collateral-control events only. Case reviews and terms stay in each case.
      </p>
      <p className="text-[12px] text-fg-subtle">{BOUNDARY_COPY.ACTIVITY_KINDS}</p>
    </div>
  );
}

const PANELS: Readonly<Record<AssetTab, () => React.JSX.Element>> = {
  overview: OverviewTab,
  evidence: EvidenceTab,
  verification: VerificationTab,
  cases: CasesTab,
  activity: ActivityTab,
};

/** One passport section; sections outside `allowedTabs` explain the gap instead of showing data. */
export function AssetTabPanel({ tab }: { tab: AssetTab }) {
  const detail = useAssetPassport();
  if (!detail.allowedTabs.includes(tab)) {
    return (
      <PermissionNotice reason="organization" title={`${ASSET_TAB_LABELS[tab]} is not available`}>
        This section of {detail.ref} is not disclosed to your organization.
      </PermissionNotice>
    );
  }
  const Content = PANELS[tab];
  return (
    <section aria-label={ASSET_TAB_LABELS[tab]}>
      <Content />
    </section>
  );
}
