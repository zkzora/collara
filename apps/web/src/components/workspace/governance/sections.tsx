"use client";

import { GOVERNANCE_ACTION_LABELS } from "@collara/domain";
import Link from "next/link";
import { DefinitionList } from "@/components/collara/definition-list";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { Panel } from "@/components/collara/panel";
import { StatusBadge } from "@/components/collara/status-badge";
import { formatUtcDate, formatUtcDateTime } from "@/lib/format";
import { useGovernanceProposals } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { EmptyRow, TableRegion, TD, TR } from "../audit/table-region";
import { useVerifiers } from "../verification/queries";
import { useGovernance } from "./governance-frame";
import { ProposeSuspensionDialog, ProposeVerifierDialog } from "./propose-dialogs";
import { ConfirmationBar, governanceProposalHref } from "./shared";

const link = "font-mono text-[12.5px] text-fg underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring";

/** Verifier Registry (CR-08): who may be assigned to verification requests. */
export function RegistrySection() {
  const state = useGovernance();
  const { me } = useSession();
  const verifiers = useVerifiers();
  const seats = state.seats.length;

  if (verifiers.isError) return <ErrorState error={verifiers.error} onRetry={() => void verifiers.refetch()} />;
  if (verifiers.isPending) return <LoadingState variant="table" rows={4} label="Loading the verifier registry…" />;

  return (
    <div className="flex flex-col gap-3">
      <TableRegion
        label="Verifier registry"
        head={["Verifier", "Registry ID", "Status", "Scope", "Since · via", "Assignments", "Attestations", ""]}
        minWidth="min-w-[1000px]"
      >
        {verifiers.data.map((v) => {
          const proposed = v.status.value === "PROPOSED";
          const pending = v.pendingProposal;
          return (
            <tr key={`${v.ref}-${v.via}`} className={TR}>
              <td className={TD}>
                <span className={proposed ? "text-fg-muted" : "text-fg"}>{v.orgName}</span>
                {pending ? (
                  <Link href={governanceProposalHref(pending.ref)} className="block text-[12px] text-highlight-strong underline-offset-4 hover:underline">
                    {`${proposed ? "Addition" : "Suspension"} proposed · ${pending.ref} · ${pending.confirmations} of ${seats} confirmations`}
                  </Link>
                ) : null}
              </td>
              <td className={cn(TD, "font-mono text-[12.5px]", proposed ? "text-fg-subtle" : "text-fg-muted")}>{v.ref}</td>
              <td className={`${TD} whitespace-nowrap`}>
                <StatusBadge status={v.status} />
              </td>
              <td className={`${TD} text-fg-muted`}>{v.scope}</td>
              <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{`${v.since ? formatUtcDate(v.since) : "—"} · ${v.via}`}</td>
              <td className={`${TD} font-mono text-[12.5px]`}>{proposed ? "—" : v.activeAssignments}</td>
              <td className={`${TD} font-mono text-[12.5px]`}>{proposed ? "—" : v.attestationsIssued}</td>
              <td className={`${TD} text-right whitespace-nowrap`}>
                {proposed && pending ? (
                  <Link href={governanceProposalHref(pending.ref)} className="text-[12.5px] text-fg underline-offset-4 hover:underline">
                    Open proposal
                  </Link>
                ) : state.viewerSeat !== null && v.status.value === "ACTIVE" && !pending ? (
                  <ProposeSuspensionDialog entry={v} state={state} me={me} />
                ) : null}
              </td>
            </tr>
          );
        })}
        {verifiers.data.length === 0 ? <EmptyRow colSpan={8}>The verifier registry is empty.</EmptyRow> : null}
      </TableRegion>
      <p className="text-[12px] leading-relaxed text-fg-subtle">
        Registry changes take effect only when a confirmed proposal is executed. Suspension blocks new assignments and new attestations; attestations
        already issued remain historical records and are not reopened by governance.
      </p>
    </div>
  );
}

/** Governed actions (DM model, CR-28): seats confirm; there are no reject votes; the proposer may withdraw. */
export function ProposalsSection() {
  const state = useGovernance();
  const { me } = useSession();
  const proposals = useGovernanceProposals();
  const seats = state.seats.length;

  if (proposals.isError) return <ErrorState error={proposals.error} onRetry={() => void proposals.refetch()} />;
  if (proposals.isPending) return <LoadingState variant="table" rows={4} label="Loading proposals…" />;
  const open = proposals.data.filter((p) => p.state.value === "OPEN" || p.state.value === "EXECUTABLE").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-fg-muted">{`${proposals.data.length} proposals · ${open} open · deadline ${state.proposalDeadlineDays} days after opening`}</p>
        {state.viewerSeat !== null ? <ProposeVerifierDialog state={state} me={me} /> : null}
      </div>
      <TableRegion
        label="Governance proposals"
        head={["Proposal", "Type", "Target", "Proposed by", "Opened (UTC)", "Confirmations", "State"]}
        minWidth="min-w-[1000px]"
      >
        {proposals.data.map((p) => (
          <tr key={p.ref} className={TR}>
            <td className={TD}>
              <Link href={governanceProposalHref(p.ref)} aria-label={`Open proposal ${p.ref}`} className={link}>
                {p.ref}
              </Link>
            </td>
            <td className={TD}>{GOVERNANCE_ACTION_LABELS[p.type]}</td>
            <td className={TD}>
              {p.target.orgName}
              <span className="block font-mono text-[11.5px] text-fg-subtle">{p.target.verifierRef}</span>
            </td>
            <td className={TD}>{`${p.proposer.org.name} · seat ${p.proposer.seat}`}</td>
            <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{formatUtcDateTime(p.openedAt)}</td>
            <td className={`${TD} whitespace-nowrap`}>
              <ConfirmationBar live={p.liveConfirmations} seats={seats} threshold={p.threshold} />
            </td>
            <td className={`${TD} whitespace-nowrap`}>
              <StatusBadge status={p.state} />
            </td>
          </tr>
        ))}
        {proposals.data.length === 0 ? <EmptyRow colSpan={7}>No governance proposals yet.</EmptyRow> : null}
      </TableRegion>
      <p className="text-[12px] leading-relaxed text-fg-subtle">
        {`A proposal becomes executable when ${state.threshold} of ${seats} seats hold live confirmations. Confirmation alone does not change the registry; a seat must execute the proposal. There are no reject votes: a proposal not executed by its deadline becomes stale, and the proposer can withdraw an open proposal.`}
      </p>
    </div>
  );
}

/** Seats, mandate holders and the module's fixed parameters (CR-29). */
export function MembersSection() {
  const state = useGovernance();
  const { me } = useSession();
  const seats = state.seats.length;
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <TableRegion label="Governance seats" head={["Seat", "Organization", "Mandate holder", "Member since"]} minWidth="min-w-[560px]">
        {state.seats.map((s) => (
          <tr key={s.seat} className={TR}>
            <td className={`${TD} font-mono`}>{`Seat ${s.seat}`}</td>
            <td className={TD}>
              {s.org.name}
              {s.org.id === me.org.id ? <span className="ml-2 text-[11px] text-highlight-strong">you</span> : null}
            </td>
            <td className={TD}>{s.mandateLabel}</td>
            <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{formatUtcDate(s.since)}</td>
          </tr>
        ))}
      </TableRegion>
      <Panel eyebrow="Decentralization Manager">
        <DefinitionList
          termWidth="md"
          items={[
            { term: "Integration", description: state.integration.label },
            { term: "Governance set", description: `${seats} seats` },
            { term: "Threshold", description: `${state.threshold} of ${seats} live confirmations · no reject votes` },
            { term: "Confirmation timeout", description: `${state.confirmationTimeoutHours} hours` },
            { term: "Proposal deadline", description: `${state.proposalDeadlineDays} days after opening` },
            { term: "Proposal types", description: "Add verifier · Suspend verifier" },
            {
              term: "Out of scope",
              description:
                "Collateral decisions, financing proposals, pledge activation and release. These remain under lender mandates and are never governed here.",
            },
          ]}
        />
      </Panel>
    </div>
  );
}
