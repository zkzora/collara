"use client";

import type { GovernanceProposal, GovernanceState, Me } from "@collara/domain";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { DefinitionList } from "@/components/collara/definition-list";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { Panel } from "@/components/collara/panel";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { StatusBadge } from "@/components/collara/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { useCollara } from "@/lib/collara-client";
import { formatUtcDateTime } from "@/lib/format";
import { useGovernanceState } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { noPayload } from "../action-dialog";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { actingParty } from "../case/case-context";
import { useGovernanceProposal } from "./queries";
import { ConfirmationBar, GovernanceNotice, governanceCaveat, isSimulated } from "./shared";
import { PageCommands, PageCommandStatus } from "../audit/page-command";

const orgOfSeat = (state: GovernanceState, seat: number | null) => state.seats.find((s) => s.seat === seat)?.org.name ?? `Seat ${seat ?? "—"}`;

function executionLine(p: GovernanceProposal, state: GovernanceState): string {
  if (p.executedAt) return `Executed · seat ${p.executedBySeat ?? "—"} (${orgOfSeat(state, p.executedBySeat)}) · ${formatUtcDateTime(p.executedAt)}`;
  if (p.cancelledAt) return "Not executed · withdrawn by the proposer";
  if (p.state.value === "STALE") return "Not executed · stale (deadline passed or the registry changed)";
  if (p.state.value === "EXECUTABLE") return "Not executed · any seat may execute";
  const missing = Math.max(p.threshold - p.liveConfirmations, 0);
  return `Not executed · ${missing} more confirmation${missing === 1 ? "" : "s"} needed`;
}

function seatNote(p: GovernanceProposal, state: GovernanceState, me: Me): string | null {
  const simulated = isSimulated(state);
  if (p.executedAt) return `Executed by seat ${p.executedBySeat ?? "—"} at ${formatUtcDateTime(p.executedAt)}. The registry change is applied${simulated ? " in the simulation" : ""}.`;
  if (p.cancelledAt) return "Withdrawn by the proposer. The registry is unchanged.";
  if (p.state.value === "STALE") return "This proposal can no longer be executed. A new proposal is needed.";
  const mine = state.viewerSeat !== null ? p.confirmations.find((c) => c.seat === state.viewerSeat) : undefined;
  if (mine?.state.value === "CONFIRMED") {
    const waiting = p.confirmations.filter((c) => c.state.value !== "CONFIRMED").map((c) => c.org.name);
    return p.state.value === "EXECUTABLE"
      ? "Your confirmation is recorded. The threshold is met."
      : `Your confirmation is recorded. Awaiting ${waiting.join(" or ")}.`;
  }
  if (state.viewerSeat === null && state.seats.some((s) => s.org.id === me.org.id)) {
    return `The governance seat for ${me.org.name} is held by another mandate. Your mandate can view proposals but cannot confirm or execute.`;
  }
  return null;
}

function SeatActions({ p, state, me }: { p: GovernanceProposal; state: GovernanceState; me: Me }) {
  const { client } = useCollara();
  const seat = state.viewerSeat;
  const seats = state.seats.length;
  const party = actingParty(me);
  const reaches = p.liveConfirmations + 1 >= p.threshold;
  return (
    <div className="flex flex-col gap-2">
      {p.allowedActions.includes("confirm") ? (
        <ActionDialog
          label="Confirm proposal"
          variant="primary"
          className="h-9 w-full"
          title={`Confirm ${p.ref}`}
          description={`Records your confirmation as seat ${seat ?? "—"} (${me.org.name}) for ${p.typeLabel.toLowerCase()} · ${p.target.orgName}. ${
            reaches ? `This reaches the ${p.threshold}-of-${seats} threshold; any seat can then execute.` : `${p.threshold - p.liveConfirmations - 1} more confirmation is needed after yours.`
          }`}
          facts={{ actingParty: party, record: `${p.ref} · seat ${seat ?? "—"}`, effect: `Confirmations ${p.liveConfirmations} → ${p.liveConfirmations + 1} of ${seats}${reaches ? " · executable" : ""}` }}
          caveat={`${governanceCaveat(state)} Confirmations expire after ${state.confirmationTimeoutHours} hours.`}
          confirmLabel="Confirm proposal"
          prepare={noPayload}
          perform={(_body, options) => client.governance.confirm(p.ref, options)}
        />
      ) : null}
      {p.allowedActions.includes("execute") ? (
        <ActionDialog
          label="Execute proposal"
          variant="primary"
          className="h-9 w-full"
          title={`Execute ${p.ref}`}
          description={`Applies the confirmed proposal to the verifier registry: ${p.effect}`}
          facts={{
            actingParty: party,
            record: `${p.ref} · ${p.target.verifierRef}`,
            effect: p.type === "ADD_VERIFIER" ? `${p.target.orgName} → ACTIVE` : `${p.target.verifierRef} ACTIVE → SUSPENDED`,
          }}
          caveat={governanceCaveat(state)}
          confirmLabel="Execute proposal"
          prepare={noPayload}
          perform={(_body, options) => client.governance.execute(p.ref, options)}
        />
      ) : null}
      {p.allowedActions.includes("cancel") ? (
        <ActionDialog
          label="Withdraw proposal"
          variant="danger"
          danger
          className="h-9 w-full"
          title={`Withdraw ${p.ref}`}
          description="Withdraws your open proposal. Recorded confirmations no longer count and the registry is unchanged."
          facts={{ actingParty: party, record: p.ref, effect: `${p.state.label} → Withdrawn by proposer` }}
          caveat={governanceCaveat(state)}
          confirmLabel="Withdraw proposal"
          prepare={noPayload}
          perform={(_body, options) => client.governance.cancel(p.ref, options)}
        />
      ) : null}
    </div>
  );
}

interface ActivityRow {
  readonly at: string;
  readonly event: string;
  readonly actor: string;
}

function activityOf(p: GovernanceProposal, state: GovernanceState): ActivityRow[] {
  const rows: ActivityRow[] = [{ at: p.openedAt, event: "Proposal opened", actor: `${p.proposer.org.name} · seat ${p.proposer.seat}` }];
  for (const c of p.confirmations) {
    if (c.confirmedAt) rows.push({ at: c.confirmedAt, event: "Confirmation recorded", actor: `${c.org.name} · seat ${c.seat}` });
  }
  if (p.cancelledAt) rows.push({ at: p.cancelledAt, event: "Withdrawn by proposer", actor: `${p.proposer.org.name} · seat ${p.proposer.seat}` });
  if (p.executedAt) rows.push({ at: p.executedAt, event: "Executed · registry updated", actor: `${orgOfSeat(state, p.executedBySeat)} · seat ${p.executedBySeat ?? "—"}` });
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Governed action detail `/app/governance/:proposalId` (CR-28: confirm, execute, proposer withdraw; no reject). */
export function GovernanceProposalDetail({ proposalRef }: { proposalRef: string }) {
  const { me } = useSession();
  const proposal = useGovernanceProposal(proposalRef);
  const state = useGovernanceState();
  const back = (
    <Link href="/app/governance/proposals" className={buttonVariants({ variant: "outline" })}>
      <ArrowLeftIcon aria-hidden="true" />
      All proposals
    </Link>
  );

  const error = proposal.error ?? state.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void proposal.refetch();
          void state.refetch();
        }}
        action={back}
      />
    );
  }
  if (!proposal.data || !state.data) return <LoadingState variant="page" label={`Loading proposal ${proposalRef}…`} />;
  const p = proposal.data;
  const s = state.data;
  const seats = s.seats.length;
  const note = seatNote(p, s, me);
  const viewerSeat = s.seats.find((seat) => seat.seat === s.viewerSeat);

  return (
    <PageCommands>
      <div className="flex flex-col gap-[18px]">
        <PageHeader
          eyebrow={`Governance proposal · ${s.integration.label}`}
          recordId={p.ref}
          title={`${p.typeLabel} · ${p.target.orgName}`}
          status={p.state}
          description={`Proposed by ${p.proposer.org.name} (seat ${p.proposer.seat}) · opened ${formatUtcDateTime(p.openedAt)} · deadline ${formatUtcDateTime(p.deadlineAt)}`}
          actions={back}
        />
        <GovernanceNotice state={s} />
        <PageCommandStatus />
        <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="flex flex-col gap-3.5">
            <Panel title="Confirmation progress" action={`${p.liveConfirmations} of ${seats} confirmations · threshold ${p.threshold} of ${seats}`}>
              <ConfirmationBar live={p.liveConfirmations} seats={seats} threshold={p.threshold} size="md" />
              <ul className="mt-4 flex flex-col">
                {p.confirmations.map((c) => (
                  <li key={c.seat} className="grid grid-cols-[60px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line-subtle py-2.5 last:border-b-0 xs:grid-cols-[60px_minmax(0,1fr)_auto_auto]">
                    <span className="font-mono text-[12.5px] text-fg-muted">{`Seat ${c.seat}`}</span>
                    <span className="text-[13.5px] text-fg">
                      {c.org.name}
                      {c.org.id === me.org.id ? <span className="ml-2 text-[11px] text-highlight-strong">you</span> : null}
                    </span>
                    <StatusBadge status={c.state} className="col-start-2 text-[12.5px] xs:col-start-auto" />
                    <span className="col-start-2 font-mono text-[11.5px] text-fg-subtle xs:col-start-auto">
                      {c.confirmedAt ? formatUtcDateTime(c.confirmedAt) : "—"}
                      {c.expiresAt && c.state.value === "CONFIRMED" ? ` · expires ${formatUtcDateTime(c.expiresAt)}` : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Execution">
              <DefinitionList
                termWidth="sm"
                items={[
                  { term: "State", description: executionLine(p, s) },
                  { term: "Registry effect", description: p.effect },
                  { term: "Target", description: <span>{`${p.target.orgName} · `}<span className="font-mono">{p.target.verifierRef}</span></span> },
                  { term: "Registry version", description: <span className="font-mono">{`expected v${p.expectedRegistryVersion} · current v${s.registryVersion}`}</span> },
                ]}
              />
            </Panel>
            <Panel title="Proposal">
              <DefinitionList
                termWidth="sm"
                items={[
                  { term: "Type", description: p.typeLabel },
                  { term: "Verifier scope", description: p.target.scope },
                  { term: "Proposed by", description: `${p.proposer.org.name} · seat ${p.proposer.seat}` },
                  { term: "Rationale", description: <span className="text-fg-soft">{p.rationale}</span> },
                ]}
              />
            </Panel>
          </div>
          <div className="flex flex-col gap-3.5">
            <Panel eyebrow={viewerSeat ? `Your seat · ${viewerSeat.org.name} · seat ${viewerSeat.seat}` : "Your seat"}>
              {viewerSeat ? (
                <div className="flex flex-col gap-3">
                  {p.allowedActions.length > 0 ? (
                    <p className="text-[13px] leading-relaxed text-fg-muted">
                      {p.allowedActions.includes("execute")
                        ? `Threshold met. Executing applies the registry change${isSimulated(s) ? " in the simulation" : ""}. Any seat may execute a confirmed proposal.`
                        : `Confirm on behalf of ${viewerSeat.org.name}. ${p.threshold} live confirmations make the proposal executable. There is no reject vote.`}
                    </p>
                  ) : null}
                  <SeatActions p={p} state={s} me={me} />
                  {note ? <p className="rounded-md border border-line-subtle bg-surface-sunken px-3.5 py-3 text-[13px] text-fg-muted">{note}</p> : null}
                </div>
              ) : (
                <PermissionNotice reason="mandate">
                  {note ?? "Your organization holds no governance seat. You can view proposals but cannot confirm or execute."}
                </PermissionNotice>
              )}
              <p className="mt-3 text-[12px] leading-relaxed text-fg-subtle">
                {isSimulated(s) ? "UI simulation. No Decentralization Manager transaction is submitted. " : null}
                This seat administers the verifier registry only and cannot authorize collateral release.
              </p>
            </Panel>
            <Panel title="Activity" padded={false}>
              <ol>
                {activityOf(p, s).map((row) => (
                  <li key={`${row.at}-${row.event}`} className="grid grid-cols-1 gap-x-3 border-b border-line-subtle px-4 py-2.5 last:border-b-0 xs:grid-cols-[128px_minmax(0,1fr)]">
                    <time dateTime={row.at} className="font-mono text-[11.5px] text-fg-subtle">
                      {formatUtcDateTime(row.at)}
                    </time>
                    <span className="text-[13px] text-fg">
                      {row.event}
                      <span className="block text-[12px] text-fg-muted">{row.actor}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </div>
      </div>
    </PageCommands>
  );
}
