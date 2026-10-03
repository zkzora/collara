"use client";

import { BOUNDARY_COPY, STATUS_COPY, type AccessGrant, type Me } from "@collara/domain";
import Form from "next/form";
import Link from "next/link";
import { useState } from "react";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { StatusBadge } from "@/components/collara/status-badge";
import { Button } from "@/components/ui/button";
import { useCollara } from "@/lib/collara-client";
import { formatUtcDate } from "@/lib/format";
import { useAccessGrants, useCaseList } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { noPayload } from "../action-dialog";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { EmptyRow, TableRegion, TD, TR } from "../audit/table-region";
import { actingParty } from "../case/case-context";
import { caseTabHref } from "../case/links";
import { AuditGrantDialog } from "./audit-grant-dialog";
import { DealerConsentRequests } from "./consent-requests";
import { PageCommands, PageCommandStatus } from "../audit/page-command";

const PERMISSION_LABELS: Readonly<Record<AccessGrant["permission"], string>> = {
  VIEW: "View",
  VIEW_DOWNLOAD: "View + download",
  VIEW_EXPORT: "View + export",
};

const KIND_LABELS: Readonly<Record<AccessGrant["kind"], string>> = {
  PACKAGE_SHARE: "Package share",
  VERIFICATION_SCOPE: "Verification scope",
  AUDIT: "Audit grant",
};

function expiry(grant: AccessGrant): string {
  if (grant.expiresAt) return formatUtcDate(grant.expiresAt);
  return grant.kind === "VERIFICATION_SCOPE" ? "Until attestation issued" : "No expiry set";
}

function RevokeDialog({ grant, me, onRevoked }: { grant: AccessGrant; me: Me; onRevoked: (grant: AccessGrant) => void }) {
  const { client } = useCollara();
  return (
    <ActionDialog
      label="Revoke"
      size="sm"
      variant="danger"
      danger
      title={`Revoke future access · ${grant.id}`}
      description={`Revokes future access for ${grant.recipient.name} to ${grant.caseId} (${grant.purpose.toLowerCase()}).`}
      facts={{ actingParty: actingParty(me), record: `${grant.id} · ${grant.caseId}`, effect: `${grant.state.label} → Revoked` }}
      caveat={STATUS_COPY.ACCESS_REVOKED}
      confirmLabel="Revoke future access"
      prepare={noPayload}
      perform={(_body, options) => client.accessGrants.revoke(grant.id, options)}
      onSuccess={() => onRevoked(grant)}
    />
  );
}

/**
 * Sharing and Access `/app/access` (S §9.16): package shares, verification scopes and audit grants
 * across the viewer's cases, with grant and revoke for record owners. The case tab is the main entry.
 */
export function AccessCenter({ caseId }: { caseId?: string }) {
  const { me } = useSession();
  const cases = useCaseList("all");
  const grants = useAccessGrants(caseId);
  const [revoked, setRevoked] = useState<AccessGrant | null>(null);
  const canGrant = me.roles.includes("BORROWER") || me.roles.includes("LENDER_ANALYST") || me.roles.includes("LENDER_APPROVER");
  const caseItems = cases.data?.items ?? [];

  return (
    <PageCommands>
      <div className="flex flex-col gap-[18px]">
        <PageHeader
          title="Sharing and access"
          description={`Who can see which records of the cases visible to ${me.org.name}. Each data owner consents for its own records.`}
          actions={canGrant && caseItems.length > 0 ? <AuditGrantDialog cases={caseItems} me={me} initialCaseId={caseId} /> : null}
        />
        <PageCommandStatus />
        <Form action="/app/access" className="flex flex-wrap items-end gap-2" aria-label="Filter access grants">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="access-case" className="text-[12.5px] font-medium text-fg-muted">
              Case
            </label>
            <select
              id="access-case"
              name="caseId"
              defaultValue={caseId ?? ""}
              className="h-8 min-w-[220px] rounded-md border border-line-input bg-surface-sunken px-2.5 text-[13px] text-fg outline-none hover:border-line-input-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">All accessible cases</option>
              {caseItems.map((c) => (
                <option key={c.caseId} value={c.caseId}>
                  {`${c.caseId} · ${c.title}`}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            Apply
          </Button>
          {caseId ? (
            <Link href={caseTabHref(caseId, "sharing")} className="h-8 px-1 text-[12.5px] leading-8 text-fg-muted underline-offset-4 hover:text-fg hover:underline">
              Open {caseId} · Sharing &amp; Access
            </Link>
          ) : null}
        </Form>
        {revoked ? (
          <p role="status" className="rounded-md border border-line bg-surface-sunken px-3.5 py-3 text-[13px] text-fg">
            {`${revoked.id} · ${revoked.recipient.name}: `}
            {STATUS_COPY.ACCESS_REVOKED}
          </p>
        ) : null}
        {me.roles.includes("DEALER") ? <DealerConsentRequests caseId={caseId} /> : null}
        {grants.isError ? (
          <ErrorState error={grants.error} onRetry={() => void grants.refetch()} />
        ) : grants.isPending ? (
          <LoadingState variant="table" rows={4} label="Loading access grants…" />
        ) : (
          <TableRegion
            label={caseId ? `Access grants · ${caseId}` : "Access grants · all accessible cases"}
            head={["Case", "Recipient", "Kind · purpose", "Scope", "Permission", "Expiry", "Status", "Consenting parties", ""]}
            minWidth="min-w-[1140px]"
          >
            {grants.data.items.map((grant) => (
              <tr key={`${grant.caseId}-${grant.id}`} className={TR}>
                <td className={`${TD} whitespace-nowrap`}>
                  <Link href={caseTabHref(grant.caseId, "sharing")} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
                    {grant.caseId}
                  </Link>
                  <span className="block font-mono text-[11.5px] text-fg-subtle">{grant.id}</span>
                </td>
                <td className={TD}>
                  {grant.recipient.name}
                  {grant.recipient.id === me.org.id ? <span className="ml-2 text-[11px] text-highlight-strong">you</span> : null}
                </td>
                <td className={TD}>
                  {KIND_LABELS[grant.kind]}
                  <span className="block text-[12px] text-fg-muted">{grant.purpose}</span>
                </td>
                <td className={`${TD} text-[12.5px] text-fg-muted`}>
                  {grant.scope}
                  {grant.includesTerms ? null : <span className="block text-fg-subtle">No loan terms</span>}
                </td>
                <td className={`${TD} whitespace-nowrap`}>{PERMISSION_LABELS[grant.permission]}</td>
                <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{expiry(grant)}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  <StatusBadge status={grant.state} />
                </td>
                <td className={`${TD} text-[12.5px] text-fg-muted`}>{grant.consentingParties.map((org) => org.name).join(" · ") || "—"}</td>
                <td className={`${TD} text-right`}>{grant.canRevoke ? <RevokeDialog grant={grant} me={me} onRevoked={setRevoked} /> : null}</td>
              </tr>
            ))}
            {grants.data.items.length === 0 ? <EmptyRow colSpan={9}>No access grants are visible to your organization.</EmptyRow> : null}
          </TableRegion>
        )}
        <p className="text-[12px] leading-relaxed text-fg-subtle">{BOUNDARY_COPY.SHARING_TERMS}</p>
        <p className="text-[12px] leading-relaxed text-fg-subtle">Grant expiry is checked at download. Expiry does not remove records already disclosed on the ledger.</p>
      </div>
    </PageCommands>
  );
}
