"use client";

import {
  AUDIT_SCOPE_LABELS,
  AUDIT_SCOPE_OWNERS,
  AUDIT_SCOPES,
  DEMO_ORGANIZATIONS,
  type AuditScope,
  type CaseSummary,
  type CreateAuditGrantRequest,
  type Me,
} from "@collara/domain";
import { useId, useState } from "react";
import { LoadingState } from "@/components/collara/loading-state";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { useCollara } from "@/lib/collara-client";
import { allows, useCaseDetail } from "@/lib/queries";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { actingParty } from "../case/case-context";
import { Field, SelectInput, TextInput } from "../form-fields";

/** Auditor organizations the demo knows about (LOCALNET seeds the same organizations). */
const AUDITORS = Object.values(DEMO_ORGANIZATIONS).filter((org) => org.type === "AUDITOR");

const defaultExpiry = () => new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

/** End of the chosen UTC day as an ISO timestamp, or null unless it lies in the future. */
function futureEndOfDay(date: string): string | null {
  const at = Date.parse(`${date}T23:59:59Z`);
  return Number.isNaN(at) || at <= Date.now() ? null : new Date(at).toISOString();
}

/**
 * Grant audit access from the cross-case access page (CR-49: an explicit grant by each record
 * owner). Each side grants only the record types it owns; the server re-checks everything.
 */
export function AuditGrantDialog({ cases, me, initialCaseId }: { cases: readonly CaseSummary[]; me: Me; initialCaseId?: string }) {
  const { client } = useCollara();
  const legendId = useId();
  const [caseId, setCaseId] = useState(initialCaseId ?? cases[0]?.caseId ?? "");
  const detail = useCaseDetail(caseId, { enabled: !!caseId });
  const side = detail.data && detail.data.borrower?.id === me.org.id ? "OWNER" : "LENDER";
  const ownScopes = AUDIT_SCOPES.filter((scope) => AUDIT_SCOPE_OWNERS[scope].includes(side));
  const [unchecked, setUnchecked] = useState<AuditScope[]>([]);
  const scopes = ownScopes.filter((scope) => !unchecked.includes(scope));
  const [auditorOrgId, setAuditorOrgId] = useState(AUDITORS[0]?.id ?? "");
  const [permission, setPermission] = useState<CreateAuditGrantRequest["permission"]>("VIEW_EXPORT");
  const [purpose, setPurpose] = useState("Scoped audit");
  const [expiresOn, setExpiresOn] = useState(defaultExpiry);
  const [errors, setErrors] = useState<{ caseId?: string; scopes?: string; purpose?: string; expiresOn?: string }>({});
  const permitted = !!detail.data && allows(detail.data, "auditGrant.create");
  const auditor = AUDITORS.find((org) => org.id === auditorOrgId);

  async function prepare(): Promise<CreateAuditGrantRequest | null> {
    const next: typeof errors = {};
    // The case detail may still be loading right after the dialog opens; the server re-checks anyway.
    const loaded = caseId ? (detail.data ?? (await detail.refetch()).data) : undefined;
    const ownerSide = loaded && loaded.borrower?.id === me.org.id ? "OWNER" : "LENDER";
    const chosenScopes = AUDIT_SCOPES.filter((scope) => AUDIT_SCOPE_OWNERS[scope].includes(ownerSide) && !unchecked.includes(scope));
    if (!loaded || !allows(loaded, "auditGrant.create")) next.caseId = "Choose a case where your organization owns records.";
    if (chosenScopes.length === 0) next.scopes = "Select at least one record type.";
    if (!purpose.trim()) next.purpose = "Enter the purpose of the grant.";
    const expiresAt = futureEndOfDay(expiresOn);
    if (!expiresAt) next.expiresOn = "Choose a future date.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !expiresAt) return null;
    return { caseId, auditorOrgId, scopes: chosenScopes, permission, purpose: purpose.trim(), expiresAt };
  }

  return (
    <ActionDialog
      label="Grant audit access"
      variant="primary"
      title="Grant audit access"
      description={`Grants ${auditor?.name ?? "the auditor"} access to the selected ${me.org.name} records of ${caseId || "a case"}. Records owned by another party need that party's own grant.`}
      facts={{ actingParty: actingParty(me), record: `${caseId || "—"} · audit grant`, effect: "Audit grant → Active until the expiry date" }}
      caveat="Revoking a grant limits future access only; previously exported copies may still exist."
      confirmLabel="Grant access"
      onOpen={() => {
        setCaseId(initialCaseId ?? cases[0]?.caseId ?? "");
        setUnchecked([]);
        setPermission("VIEW_EXPORT");
        setPurpose("Scoped audit");
        setExpiresOn(defaultExpiry());
        setErrors({});
      }}
      prepare={prepare}
      perform={(body, options) => client.accessGrants.create(body, options)}
    >
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
        <Field label="Case" error={errors.caseId}>
          {(wired) => (
            <SelectInput wired={wired} value={caseId} onChange={(event) => setCaseId(event.target.value)}>
              {cases.map((c) => (
                <option key={c.caseId} value={c.caseId}>
                  {`${c.caseId} · ${c.title}`}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
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
      </div>
      {detail.data && !permitted ? (
        <PermissionNotice reason="mandate">Your role cannot grant audit access on {caseId}.</PermissionNotice>
      ) : null}
      <fieldset aria-describedby={errors.scopes ? `${legendId}-error` : undefined} className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[12.5px] font-medium text-fg-muted">Records ({me.org.name} owns these)</legend>
        {!detail.data ? <LoadingState variant="inline" label="Loading the records you own…" /> : null}
        {(detail.data ? ownScopes : []).map((scope) => (
          <label key={scope} className="flex items-center gap-2 text-[13px] text-fg">
            <input
              type="checkbox"
              className="size-4 accent-[var(--fg)]"
              checked={scopes.includes(scope)}
              onChange={(event) => setUnchecked((current) => (event.target.checked ? current.filter((s) => s !== scope) : [...current, scope]))}
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
              <option value="VIEW">View</option>
              <option value="VIEW_EXPORT">View + export</option>
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
