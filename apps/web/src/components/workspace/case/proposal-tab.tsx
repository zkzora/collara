"use client";

import {
  BOUNDARY_COPY,
  CONFIRMATION_COPY,
  DECIMAL_AMOUNT_PATTERN,
  formatMoney,
  type CaseDetail,
  type CreateProposalRequest,
  type Me,
  type Proposal,
} from "@collara/domain";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DefinitionList } from "@/components/collara/definition-list";
import { EmptyState } from "@/components/collara/empty-state";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { Money } from "@/components/collara/money";
import { Panel } from "@/components/collara/panel";
import { StatusBadge } from "@/components/collara/status-badge";
import { useCollara } from "@/lib/collara-client";
import { formatUtcDate, formatUtcDateTime } from "@/lib/format";
import { allows, useProposal } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { ActionDialog, noPayload } from "../action-dialog";
import { Field, SelectInput, TextArea, TextInput } from "../form-fields";
import { actingParty, useCaseWorkspace } from "./case-context";

const CURRENCIES = ["USD", "EUR"] as const;

const ProposalFormSchema = z.object({
  amount: z
    .string()
    .transform((value) => value.replaceAll(",", "").trim())
    .pipe(z.string().regex(DECIMAL_AMOUNT_PATTERN, "Enter a principal such as 100000.00 (two decimals at most).")),
  currency: z.enum(CURRENCIES),
  termMetadata: z.string().trim().max(200),
  financingRef: z.string().trim().max(80),
  externalLegalRef: z.string().trim().max(200),
  expiresInDays: z.coerce.number<string>().int("Use whole days.").min(1, "At least 1 day.").max(60, "At most 60 days."),
});
type ProposalForm = z.input<typeof ProposalFormSchema>;

function proposalDefaults(detail: CaseDetail, draft: Proposal | null): ProposalForm {
  const principal = draft?.principal ?? detail.requestedPrincipal;
  return {
    amount: principal?.amount ?? "",
    currency: principal?.currency === "EUR" ? "EUR" : "USD",
    termMetadata: draft?.termMetadata ?? "",
    financingRef: draft?.financingRef ?? "",
    externalLegalRef: draft?.externalLegalRef ?? "",
    expiresInDays: "14",
  };
}

/** Analysts draft; approvers issue (CR-18). Issuing an existing draft re-sends its terms. */
function ProposalDialog({ detail, me, draft, intent }: { detail: CaseDetail; me: Me; draft: Proposal | null; intent: "DRAFT" | "ISSUE" }) {
  const { client } = useCollara();
  const form = useForm<ProposalForm, unknown, z.output<typeof ProposalFormSchema>>({
    resolver: zodResolver(ProposalFormSchema),
    defaultValues: proposalDefaults(detail, draft),
    mode: "onTouched",
  });
  const errors = form.formState.errors;
  const version = draft?.version ?? (detail.references.proposal?.version ?? 0) + 1;
  const issue = intent === "ISSUE";
  const borrower = detail.borrower?.name ?? "the borrower";

  async function prepare(): Promise<CreateProposalRequest | null> {
    if (!(await form.trigger())) return null;
    const v = ProposalFormSchema.parse(form.getValues());
    return {
      intent,
      principal: { amount: v.amount, currency: v.currency },
      termMetadata: v.termMetadata || undefined,
      financingRef: v.financingRef || undefined,
      externalLegalRef: v.externalLegalRef || undefined,
      expiresInDays: v.expiresInDays,
    };
  }

  return (
    <ActionDialog
      label={issue ? "Issue proposal" : "Draft proposal"}
      variant="primary"
      title={`${issue ? "Issue" : "Draft"} financing proposal · ${detail.caseId}`}
      description={
        issue
          ? `Issues version v${version} to ${borrower} for acceptance of this exact version. Issuing a proposal creates a workflow record; it does not disburse funds.`
          : `Saves a draft (v${version}) visible to your organization only. An approver issues it to ${borrower}.`
      }
      facts={{
        actingParty: actingParty(me),
        record: `${detail.references.proposal?.ref ?? "New proposal"} · v${version}`,
        effect: issue ? "DRAFT → ISSUED" : "→ DRAFT",
      }}
      caveat="Loan terms are disclosed only to the borrower and the selected lender."
      confirmLabel={issue ? "Issue proposal" : "Save draft"}
      onOpen={() => form.reset(proposalDefaults(detail, draft))}
      prepare={prepare}
      perform={(body, options) => client.cases.createProposal(detail.caseId, body, options)}
    >
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-[minmax(0,1fr)_110px]">
        <Field label="Principal" error={errors.amount?.message}>
          {(wired) => <TextInput wired={wired} inputMode="decimal" autoComplete="off" className="font-mono" {...form.register("amount")} />}
        </Field>
        <Field label="Currency" error={errors.currency?.message}>
          {(wired) => (
            <SelectInput wired={wired} {...form.register("currency")}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>
      <Field label="Term metadata" hint="Metadata only, e.g. 36 months." error={errors.termMetadata?.message}>
        {(wired) => <TextInput wired={wired} {...form.register("termMetadata")} />}
      </Field>
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
        <Field label="Financing reference (external)" error={errors.financingRef?.message}>
          {(wired) => <TextInput wired={wired} className="font-mono" {...form.register("financingRef")} />}
        </Field>
        <Field label="Expires in (days)" error={errors.expiresInDays?.message}>
          {(wired) => <TextInput wired={wired} type="number" min={1} max={60} inputMode="numeric" {...form.register("expiresInDays")} />}
        </Field>
      </div>
      <Field label="Legal document reference (external)" error={errors.externalLegalRef?.message}>
        {(wired) => <TextInput wired={wired} {...form.register("externalLegalRef")} />}
      </Field>
    </ActionDialog>
  );
}

function ResponseActions({ proposal, detail, me }: { proposal: Proposal; detail: CaseDetail; me: Me }) {
  const { client } = useCollara();
  const [reason, setReason] = useState("");
  const record = `${proposal.ref} · v${proposal.version}`;
  return (
    <>
      {allows(detail, "proposal.accept") ? (
        <ActionDialog
          label={`Accept v${proposal.version}`}
          variant="primary"
          title={`Accept proposal ${proposal.ref} · exact version v${proposal.version}`}
          description={`Accepts exactly version v${proposal.version} from ${proposal.lender.name}: principal ${formatMoney(proposal.principal)}, expiry ${formatUtcDate(proposal.expiresAt)}.`}
          facts={{ actingParty: actingParty(me), record, effect: "ISSUED → ACCEPTED" }}
          caveat={CONFIRMATION_COPY.PROPOSAL_ACCEPT}
          confirmLabel="Accept this version"
          prepare={() => ({ expectedVersion: proposal.version })}
          perform={(body, options) => client.proposals.accept(proposal.ref, body, options)}
        />
      ) : null}
      {allows(detail, "proposal.decline") ? (
        <ActionDialog
          label="Decline"
          variant="danger"
          danger
          title={`Decline proposal ${proposal.ref} · v${proposal.version}`}
          description={`Declines version v${proposal.version} from ${proposal.lender.name}. The lender can issue a new version.`}
          facts={{ actingParty: actingParty(me), record, effect: "ISSUED → DECLINED" }}
          confirmLabel="Decline proposal"
          onOpen={() => setReason("")}
          prepare={() => ({ expectedVersion: proposal.version, reason: reason.trim() || undefined })}
          perform={(body, options) => client.proposals.decline(proposal.ref, body, options)}
        >
          <Field label="Reason (optional)">
            {(wired) => <TextArea wired={wired} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} />}
          </Field>
        </ActionDialog>
      ) : null}
      {allows(detail, "proposal.withdraw") ? (
        <ActionDialog
          label="Withdraw"
          variant="danger"
          danger
          title={`Withdraw proposal ${proposal.ref} · v${proposal.version}`}
          description={`Withdraws issued version v${proposal.version} before acceptance. ${proposal.borrower.name} can no longer accept it; new terms need a new version and a new acceptance.`}
          facts={{ actingParty: actingParty(me), record, effect: "ISSUED → WITHDRAWN" }}
          confirmLabel="Withdraw proposal"
          prepare={noPayload}
          perform={(_body, options) => client.proposals.withdraw(proposal.ref, undefined, options)}
        />
      ) : null}
    </>
  );
}

/** Proposal tab (S §9.12): terms for the borrower and the selected lender only; exact-version actions. */
export function ProposalTab() {
  const { detail } = useCaseWorkspace();
  const { me } = useSession();
  const ref = detail.references.proposal?.ref ?? null;
  const query = useProposal(ref);
  const canDraft = allows(detail, "proposal.draft");
  const canIssue = allows(detail, "proposal.issue");

  if (ref && query.isPending) return <LoadingState label="Loading proposal…" rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const proposal = query.data ?? null;
  const draft = proposal?.state.value === "DRAFT" ? proposal : null;
  const createActions =
    canIssue || canDraft ? (
      <div className="flex flex-wrap gap-2">
        {canIssue ? <ProposalDialog detail={detail} me={me} draft={draft} intent="ISSUE" /> : null}
        {canDraft && !canIssue ? <ProposalDialog detail={detail} me={me} draft={draft} intent="DRAFT" /> : null}
      </div>
    ) : null;

  if (!proposal) {
    return (
      <Panel>
        <EmptyState title="No proposal issued" action={createActions}>
          {BOUNDARY_COPY.PROPOSAL_EMPTY}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Panel
        title={<span className="font-mono">{`${proposal.ref} · v${proposal.version}`}</span>}
        action={<StatusBadge status={proposal.state} />}
      >
        <DefinitionList
          termWidth="lg"
          items={[
            { term: "Lender", description: proposal.lender.name },
            { term: "Borrower", description: proposal.borrower.name },
            { term: "Case · Asset", description: <span className="font-mono">{`${proposal.caseId} · ${proposal.assetRef}`}</span> },
            { term: "Principal", description: <Money value={proposal.principal} /> },
            { term: "Term metadata", description: proposal.termMetadata ? `${proposal.termMetadata} · metadata only` : "—" },
            { term: "Financing reference", description: proposal.financingRef ? `${proposal.financingRef} (external)` : "—" },
            { term: "Legal document reference", description: proposal.externalLegalRef ?? "—" },
            { term: "Proposal expiry", description: <span className="font-mono">{formatUtcDate(proposal.expiresAt)}</span> },
            { term: "Authorized approver", description: proposal.approver ?? "—" },
            {
              term: "Response",
              description: proposal.respondedAt ? `${proposal.respondedBy ?? proposal.borrower.name} · ${formatUtcDateTime(proposal.respondedAt)}` : "—",
            },
            ...(proposal.activation
              ? [{ term: "Activation authorization", description: <StatusBadge status={proposal.activation.state} /> }]
              : []),
          ]}
        />
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line-subtle pt-4">
          <ResponseActions proposal={proposal} detail={detail} me={me} />
          {createActions}
        </div>
      </Panel>

      <div className="flex flex-col gap-3.5">
        <Panel title="Version history" padded={false}>
          <ul>
            {proposal.versions.map((version) => (
              <li key={version.version} className="flex items-start justify-between gap-3 border-b border-line-subtle px-4 py-2.5 last:border-b-0">
                <span className="text-[13px] text-fg">
                  <span className="font-mono">v{version.version}</span>
                  {version.issuedAt ? ` · issued ${formatUtcDate(version.issuedAt)}` : " · not issued"}
                  {version.note ? <span className="block text-[12px] text-fg-subtle">{version.note}</span> : null}
                </span>
                <StatusBadge status={version.state} className="text-[12.5px]" />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <p className="text-[13px] leading-relaxed text-fg-muted">{CONFIRMATION_COPY.PROPOSAL_ACCEPT}</p>
        </Panel>
      </div>
    </div>
  );
}
