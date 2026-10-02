"use client";

import { AUDIT_SCOPE_LABELS, CONFIRMATION_COPY, REPORT_FORMATS, STATUS_COPY, type CreateReportRequest, type Me, type ReportFormat } from "@collara/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { useCollara } from "@/lib/collara-client";
import { allows, useAccessGrants, useCaseDetail, useCaseList } from "@/lib/queries";
import { TrackedActionDialog as ActionDialog } from "./page-command";
import { actingParty } from "../case/case-context";
import { Field, SelectInput } from "../form-fields";

/** Records this viewer's export will cover: the auditor's granted record types, or the own scope. */
function ScopePreview({ caseId, me }: { caseId: string; me: Me }) {
  const isAuditor = me.roles.includes("AUDITOR");
  const grants = useAccessGrants(caseId, { enabled: isAuditor && !!caseId });
  if (!isAuditor) return <p className="text-[12.5px] text-fg-muted">{`Scope: own scope · ${me.org.name}. Only records your organization may see are included.`}</p>;
  const active = (grants.data?.items ?? []).filter((g) => g.kind === "AUDIT" && g.recipient.id === me.org.id && g.state.value === "GRANTED");
  const scopes = [...new Set(active.flatMap((g) => g.auditScopes ?? []))];
  return (
    <div className="text-[12.5px] text-fg-muted">
      <p>{`Scope: granted subset · ${me.org.name}.`}</p>
      <p className="mt-1">
        {grants.isPending
          ? "Checking active grants…"
          : scopes.length > 0
            ? `Granted record types: ${scopes.map((s) => AUDIT_SCOPE_LABELS[s]).join(", ")}. A record type owned by two parties needs both grants.`
            : "No active audit grant covers this case."}
      </p>
    </div>
  );
}

/**
 * Export case report (S §9.18): a permission-scoped JSON or CSV export with cut-off, schema version
 * and checksum. Access is evaluated at generation and again at download.
 */
export function ExportDialog({ me, initialCaseId }: { me: Me; initialCaseId?: string }) {
  const { client } = useCollara();
  const router = useRouter();
  const cases = useCaseList("all");
  const items = cases.data?.items ?? [];
  const [caseId, setCaseId] = useState(initialCaseId ?? "");
  const [format, setFormat] = useState<ReportFormat>("JSON");
  const chosen = caseId || items[0]?.caseId || "";
  const detail = useCaseDetail(chosen, { enabled: !!chosen });
  const permitted = !!detail.data && allows(detail.data, "report.export");
  const [error, setError] = useState<string | undefined>();

  return (
    <ActionDialog
      label="Export case report"
      variant="primary"
      title={`Export case report · ${chosen || "—"}`}
      description="Generates a permission-scoped export of the evidence manifest, attestation scope, review decisions, pledge and release events, and access scope."
      facts={{ actingParty: actingParty(me), record: `${chosen || "—"} · ${format}`, effect: "Export job created · cut-off at generation time" }}
      caveat={`${CONFIRMATION_COPY.REPORT_LABEL} ${STATUS_COPY.SCOPED_EXPORT}`}
      confirmLabel="Generate export"
      onOpen={() => {
        setCaseId(initialCaseId ?? "");
        setFormat("JSON");
        setError(undefined);
      }}
      prepare={async (): Promise<CreateReportRequest | null> => {
        // The case detail may still be loading right after the dialog opens; the server re-checks anyway.
        const loaded = chosen ? (detail.data ?? (await detail.refetch()).data) : undefined;
        if (!chosen || !loaded || !allows(loaded, "report.export")) {
          setError("Choose a case you may export.");
          return null;
        }
        setError(undefined);
        return { caseId: chosen, format };
      }}
      perform={(body, options) => client.reports.create(body, options)}
      onSuccess={() => router.push("/app/audit/exports")}
    >
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-[minmax(0,1fr)_120px]">
        <Field label="Case" error={error}>
          {(wired) => (
            <SelectInput wired={wired} value={chosen} onChange={(event) => setCaseId(event.target.value)} disabled={items.length === 0}>
              {items.map((c) => (
                <option key={c.caseId} value={c.caseId}>
                  {`${c.caseId} · ${c.title}`}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <Field label="Format">
          {(wired) => (
            <SelectInput wired={wired} value={format} onChange={(event) => setFormat(event.target.value as ReportFormat)}>
              {REPORT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>
      {items.length === 0 ? (
        <PermissionNotice reason="scope">No case is visible to your organization, so there is nothing to export.</PermissionNotice>
      ) : detail.data && !permitted ? (
        <PermissionNotice reason="mandate">Your role cannot export a report for {chosen}.</PermissionNotice>
      ) : chosen ? (
        <ScopePreview caseId={chosen} me={me} />
      ) : null}
    </ActionDialog>
  );
}
