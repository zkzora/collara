"use client";

import {
  AUDIT_SCOPE_LABELS,
  AUDIT_SCOPE_OWNERS,
  AUDIT_SCOPES,
  BOUNDARY_COPY,
  DEMO_ORGANIZATIONS,
  STATUS_COPY,
  type AccessGrant,
  type AuditScope,
  type CaseDetail,
  type CreateAuditGrantRequest,
  type Me,
} from "@collara/domain";
import { useId, useState } from "react";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { StatusBadge } from "@/components/collara/status-badge";
import { useCollara } from "@/lib/collara-client";
import { formatUtcDate } from "@/lib/format";
import { allows, useAccessGrants } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { ActionDialog, noPayload } from "../action-dialog";
import { DealerConsentRequests, DealerConsentStatus } from "../access/consent-requests";
import { Field, SelectInput, TextInput } from "../form-fields";
import { actingParty, useCaseWorkspace } from "./case-context";

const PERMISSION_LABELS: Readonly<Record<AccessGrant["permission"], string>> = {
  VIEW: "View",
  VIEW_DOWNLOAD: "View + download",
  VIEW_EXPORT: "View + export",
};

/** Auditor organizations the demo knows about (LOCALNET seeds the same organizations). */
const AUDITORS = Object.values(DEMO_ORGANIZATIONS).filter((org) => org.type === "AUDITOR");

function expiry(grant: AccessGrant): string {
  if (grant.expiresAt) return formatUtcDate(grant.expiresAt);
  return grant.kind === "VERIFICATION_SCOPE" ? "Until attestation issued" : "—";
}

function RevokeDialog({ grant, me }: { grant: AccessGrant; me: Me }) {
  const { client } = useCollara();
  return (
    <ActionDialog
      label="Revoke"
      size="sm"
      variant="danger"
      danger
      title={`Revoke access · ${grant.id}`}
      description={`Revokes future access for ${grant.recipient.name} (${grant.purpose.toLowerCase()}).`}
      facts={{ actingParty: actingParty(me), record: `${grant.id} · ${grant.caseId}`, effect: `${grant.state.label} → Revoked` }}
      caveat={STATUS_COPY.ACCESS_REVOKED}
      confirmLabel="Revoke access"
      prepare={noPayload}
      perform={(_body, options) => client.accessGrants.revoke(grant.id, options)}
    />
  );
}

function ShareDialog({ detail, me }: { detail: CaseDetail; me: Me }) {
  const { client } = useCollara();
  const lender = detail.selectedLender;
  const pkg = detail.references.package;
  if (!lender) return null;
  return (
    <ActionDialog
      label={`Share package with ${lender.name}`}
      variant="primary"
      title={`Share evidence package · ${detail.caseId}`}
      description={`Shares ${pkg ? `${pkg.ref} v${pkg.version} (${pkg.documentCount} documents)` : "the evidence package"} and the case terms with ${lender.name} for lender review, with view and download permission.`}
      facts={{
        actingParty: actingParty(me),
        record: pkg ? `${pkg.ref} · package v${pkg.version}` : detail.caseId,
        effect: "Lender review NOT_SUBMITTED → SUBMITTED",
      }}
      caveat={BOUNDARY_COPY.SHARING_TERMS}
      confirmLabel="Share package"
      prepare={() => ({ recipientOrgId: lender.id, permission: "VIEW_DOWNLOAD" as const })}
      perform={(body, options) => client.cases.share(detail.caseId, body, options)}
    />
  );
}

function defaultExpiry(): string {
  return new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
}

/** Audit grants are per record owner: each side grants only the scopes it owns (AUDIT_SCOPE_OWNERS). */
function AuditGrantDialog({ detail, me }: { detail: CaseDetail; me: Me }) {
  const { client } = useCollara();
  const legendId = useId();
  const side = detail.borrower?.id === me.org.id ? "OWNER" : "LENDER";
  const ownScopes = AUDIT_SCOPES.filter((scope) => AUDIT_SCOPE_OWNERS[scope].includes(side));
  const [auditorOrgId, setAuditorOrgId] = useState(AUDITORS[0]?.id ?? "");
  const [scopes, setScopes] = useState<AuditScope[]>(ownScopes);
  const [permission, setPermission] = useState<CreateAuditGrantRequest["permission"]>("VIEW_EXPORT");
  const [purpose, setPurpose] = useState("Scoped audit");
  const [expiresOn, setExpiresOn] = useState(defaultExpiry);
  const [errors, setErrors] = useState<{ scopes?: string; purpose?: string; expiresOn?: string }>({});
  const auditor = AUDITORS.find((org) => org.id === auditorOrgId);

  function prepare(): CreateAuditGrantRequest | null {
    const next: typeof errors = {};
    if (scopes.length === 0) next.scopes = "Select at least one record type.";
    if (!purpose.trim()) next.purpose = "Enter the purpose of the grant.";
    const expires = Date.parse(`${expiresOn}T23:59:59Z`);
    if (Number.isNaN(expires) || expires <= Date.now()) next.expiresOn = "Choose a future date.";
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return { caseId: detail.caseId, auditorOrgId, scopes, permission, purpose: purpose.trim(), expiresAt: new Date(expires).toISOString() };
  }

  return (
    <ActionDialog
      label="Grant audit access"
      title={`Grant audit access · ${detail.caseId}`}
      description={`Grants ${auditor?.name ?? "the auditor"} access to the selected ${me.org.name} records of ${detail.caseId}. Records owned by another party need that party's own grant.`}
      facts={{ actingParty: actingParty(me), record: `${detail.caseId} · audit grant`, effect: "Audit grant → Active until the expiry date" }}
      caveat="Revoking a grant limits future access only; previously exported copies may still exist."
      confirmLabel="Grant access"
      onOpen={() => {
        setScopes(ownScopes);
        setPermission("VIEW_EXPORT");
        setPurpose("Scoped audit");
        setExpiresOn(defaultExpiry());
        setErrors({});
      }}
      prepare={prepare}
      perform={(body, options) => client.accessGrants.create(body, options)}
    >
      <Field label="Auditor">
        {(wired) => (
          <SelectInput wired={wired} value={auditorOrgId} onChange={(event) => setAuditorOrgId(event.target.value)}>
            {AUDITORS.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      <fieldset aria-describedby={errors.scopes ? `${legendId}-error` : undefined} className="flex flex-col gap-1.5">
        <legend id={legendId} className="mb-1 text-[12.5px] font-medium text-fg-muted">
          Records ({me.org.name} owns these)
        </legend>
        {ownScopes.map((scope) => (
          <label key={scope} className="flex items-center gap-2 text-[13px] text-fg">
            <input
              type="checkbox"
              className="size-4 accent-[var(--fg)]"
              checked={scopes.includes(scope)}
              onChange={(event) => setScopes((current) => (event.target.checked ? [...current, scope] : current.filter((s) => s !== scope)))}
            />
            {AUDIT_SCOPE_LABELS[scope]}
          </label>
        ))}
        {errors.scopes ? (
          <p id={`${legendId}-error`} className="text-[12px] text-danger-strong">
            {errors.scopes}
          </p>
        ) : null}
      </fieldset>
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
        <Field label="Permission">
          {(wired) => (
            <SelectInput wired={wired} value={permission} onChange={(event) => setPermission(event.target.value as CreateAuditGrantRequest["permission"])}>
              <option value="VIEW">{PERMISSION_LABELS.VIEW}</option>
              <option value="VIEW_EXPORT">{PERMISSION_LABELS.VIEW_EXPORT}</option>
            </SelectInput>
          )}
        </Field>
        <Field label="Expires on" error={errors.expiresOn}>
          {(wired) => <TextInput wired={wired} type="date" className="font-mono" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />}
        </Field>
      </div>
      <Field label="Purpose" error={errors.purpose}>
        {(wired) => <TextInput wired={wired} value={purpose} maxLength={200} onChange={(event) => setPurpose(event.target.value)} />}
      </Field>
    </ActionDialog>
  );
}

/**
 * Sharing & Access tab: package shares, verification scope and audit grants visible to this viewer; the invited
 * dealer's consent requests for its own documents; the owner's view of each dealer document's consent status.
 */
export function SharingTab() {
  const { detail } = useCaseWorkspace();
  const { me } = useSession();
  const grants = useAccessGrants(detail.caseId);
  const isOwner = detail.borrower?.id === me.org.id && me.roles.includes("BORROWER");
  // The tab is shown to the owner, the invited dealer and the selected lender only (server-side allowedTabs).
  const isDealer = me.roles.includes("DEALER") && !isOwner;
  const head = "px-3.5 py-2.5 text-[12px] font-medium whitespace-nowrap text-fg-muted";
  const canShare = allows(detail, "sharing.share");
  const canGrant = allows(detail, "auditGrant.create") && AUDITORS.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {isDealer ? <DealerConsentRequests caseId={detail.caseId} /> : null}
      {grants.isError ? (
        <ErrorState error={grants.error} onRetry={() => void grants.refetch()} />
      ) : grants.isPending ? (
        <LoadingState variant="table" rows={3} label="Loading access grants…" />
      ) : (
        <div
          role="region"
          aria-label={`Sharing and access · ${detail.caseId}`}
          tabIndex={0}
          className="relative overflow-x-auto rounded-lg border border-line bg-surface-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
            <caption className="sr-only">{`Sharing and access grants for ${detail.caseId}`}</caption>
            <thead>
              <tr className="border-b border-line">
                {["Recipient", "Purpose", "Scope", "Permission", "Expiry", "Status", "Consenting parties"].map((label) => (
                  <th key={label} scope="col" className={head}>
                    {label}
                  </th>
                ))}
                <th scope="col" className={head}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {grants.data.items.map((grant) => (
                <tr key={grant.id} className="border-b border-line-subtle last:border-b-0">
                  <td className="px-3.5 py-3">
                    {grant.recipient.name}
                    {grant.recipient.id === me.org.id ? <span className="ml-2 text-[11px] text-highlight-strong">you</span> : null}
                  </td>
                  <td className="px-3.5 py-3">{grant.purpose}</td>
                  <td className="px-3.5 py-3 text-fg-muted">{grant.scope}</td>
                  <td className="px-3.5 py-3">{PERMISSION_LABELS[grant.permission]}</td>
                  <td className="px-3.5 py-3 font-mono text-[12px] whitespace-nowrap text-fg-muted">{expiry(grant)}</td>
                  <td className="px-3.5 py-3 whitespace-nowrap">
                    <StatusBadge status={grant.state} />
                  </td>
                  <td className="px-3.5 py-3 text-[12.5px] text-fg-muted">{grant.consentingParties.map((org) => org.name).join(" · ") || "—"}</td>
                  <td className="px-3.5 py-3 text-right">{grant.canRevoke ? <RevokeDialog grant={grant} me={me} /> : null}</td>
                </tr>
              ))}
              {grants.data.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-9 text-center text-[13.5px] text-fg-muted">
                    No access grants are visible to your organization for this case.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {canShare || canGrant ? (
        <div className="flex flex-wrap gap-2">
          {canShare ? <ShareDialog detail={detail} me={me} /> : null}
          {canGrant ? <AuditGrantDialog detail={detail} me={me} /> : null}
        </div>
      ) : null}
      {isOwner ? <DealerConsentStatus caseId={detail.caseId} hideWhenEmpty /> : null}
      <p className="text-[12px] leading-relaxed text-fg-subtle">{BOUNDARY_COPY.SHARING_TERMS}</p>
    </div>
  );
}
