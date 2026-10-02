"use client";

import {
  BOUNDARY_COPY,
  CONFIRMATION_COPY,
  ERROR_COPY,
  NOTE_COPY,
  OPEN_RELEASE_REQUEST_STATES,
  RELEASE_THREAD_LABELS,
  STATUS_COPY,
  type Pledge,
  type ReleaseRequest,
} from "@collara/domain";
import Link from "next/link";
import { DefinitionList } from "@/components/collara/definition-list";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { Panel } from "@/components/collara/panel";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { StatusBadge } from "@/components/collara/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatUtcDateTime } from "@/lib/format";
import { allows, usePledge } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { assetHref, caseTabHref } from "../case/links";
import { BorrowerReleaseActions, ReleaseDecisionActions, RequestReleaseDialog } from "./release-actions";
import { PageCommands, PageCommandStatus } from "../audit/page-command";

const isOpen = (rr: ReleaseRequest) => OPEN_RELEASE_REQUEST_STATES.includes(rr.state.value);

function LockEvidence({ p }: { p: Pledge }) {
  const t = p.technical;
  return (
    <Panel eyebrow="Lock and activation evidence">
      <DefinitionList
        termWidth="lg"
        items={[
          { term: "Lock state", description: <StatusBadge status={p.state} /> },
          { term: "Activated", description: <span className="font-mono">{formatUtcDateTime(p.activatedAt)}</span> },
          { term: "Authorized by", description: p.activation?.authorizedBy.join(" · ") ?? "—" },
          ...(p.activation
            ? [
                { term: "Proposal", description: <span className="font-mono">{`${p.activation.proposal.ref} v${p.activation.proposal.version}`}</span> },
                { term: "Attestation", description: <span className="font-mono">{p.activation.attestationRef}</span> },
                {
                  term: "Evidence snapshot",
                  description: <span className="font-mono">{`${p.activation.evidencePackage.ref} v${p.activation.evidencePackage.version}`}</span>,
                },
              ]
            : []),
          ...(p.principalRef ? [{ term: "Principal reference", description: <span className="font-mono">{p.principalRef}</span> }] : []),
          ...(t
            ? [
                {
                  term: "Asset control",
                  description: (
                    <span className="font-mono">
                      {`${p.assetRef} v${t.controlVersionConsumed} → v${t.controlVersionLocked}${t.controlVersionAfterRelease ? ` → v${t.controlVersionAfterRelease}` : ""} · ${t.controlState}`}
                    </span>
                  ),
                },
              ]
            : []),
          ...(p.releasedAt ? [{ term: "Released", description: <span className="font-mono">{formatUtcDateTime(p.releasedAt)}</span> }] : []),
        ]}
      />
    </Panel>
  );
}

/** The request's private note thread (request note, lender questions, borrower responses), oldest first. */
function ReleaseThread({ rr }: { rr: ReleaseRequest }) {
  if (rr.thread.length === 0) return null;
  return (
    <section aria-label={`${NOTE_COPY.THREAD_TITLE} · ${rr.ref}`} className="mt-4 border-t border-line-subtle pt-4">
      <h4 className="text-[12.5px] font-medium text-fg-muted">{NOTE_COPY.THREAD_TITLE}</h4>
      <ol className="mt-2 flex flex-col gap-2.5">
        {rr.thread.map((entry, index) => (
          <li
            key={`${entry.kind}-${entry.at}-${index}`}
            className={entry.kind === "QUESTION" ? "rounded-md border border-warning/30 bg-warning/5 px-3.5 py-3" : "rounded-md border border-line-subtle bg-surface-sunken px-3.5 py-3"}
          >
            <p className="mb-1 font-mono text-[10.5px] tracking-[.04em] text-fg-muted uppercase">
              {`${RELEASE_THREAD_LABELS[entry.kind]} · ${entry.by ?? entry.author.name} · ${formatUtcDateTime(entry.at)}`}
            </p>
            <p className="text-[13px] leading-relaxed whitespace-pre-line text-fg">{entry.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[12px] text-fg-subtle">{NOTE_COPY.THREAD_SCOPE}</p>
    </section>
  );
}

function ReleaseRequestCard({ rr }: { rr: ReleaseRequest }) {
  return (
    <Panel eyebrow={`Release request · ${rr.ref}`} action={<StatusBadge status={rr.state} />}>
      <DefinitionList
        termWidth="lg"
        items={[
          { term: "Requested by", description: rr.requestedBy },
          { term: "Requested", description: <span className="font-mono">{formatUtcDateTime(rr.requestedAt)}</span> },
          { term: "Reason", description: rr.reason.label },
          ...(rr.note ? [{ term: "Borrower note", description: <span className="whitespace-pre-line text-fg-muted">{rr.note}</span> }] : []),
          ...(rr.servicingRef ? [{ term: "Servicing reference", description: <span className="font-mono">{rr.servicingRef}</span> }] : []),
          ...(rr.informationRequest ? [{ term: "Information requested", description: <span className="whitespace-pre-line">{rr.informationRequest}</span> }] : []),
          ...(rr.decision
            ? [
                { term: "Decision", description: `${rr.decision.outcome.label} · ${rr.decision.decidedBy}` },
                { term: "Decided", description: <span className="font-mono">{formatUtcDateTime(rr.decision.decidedAt)}</span> },
                ...(rr.decision.reason ? [{ term: "Reason given", description: rr.decision.reason }] : []),
              ]
            : []),
        ]}
      />
      <ReleaseThread rr={rr} />
      {isOpen(rr) ? (
        <p role="note" className="mt-4 rounded-md border border-pending/30 bg-pending/5 px-3.5 py-3 text-[13px] text-pending-strong">
          {STATUS_COPY.RELEASE_PENDING}
        </p>
      ) : null}
    </Panel>
  );
}

function ReleasePanel({ p }: { p: Pledge }) {
  const { me } = useSession();
  const open = p.releaseRequests.find(isOpen) ?? null;
  const latest = p.releaseRequests[0] ?? null;
  const lender = p.lender?.name ?? "the designated lender";
  const decides = allows(p, "release.authorize") || allows(p, "release.reject") || allows(p, "release.requestInformation");
  const isLenderAnalyst = me.roles.includes("LENDER_ANALYST") && !me.roles.includes("LENDER_APPROVER");

  if (p.lockState.value === "RELEASED") {
    const decision = latest?.decision;
    return (
      <Panel title="Release decision">
        <p className="text-[14px] text-fg">Released. The asset control returned to available; a new workflow is subject to fresh checks.</p>
        {decision ? (
          <DefinitionList
            className="mt-3"
            termWidth="sm"
            items={[
              { term: "Decided by", description: decision.decidedBy },
              { term: "Recorded", description: <span className="font-mono">{formatUtcDateTime(decision.decidedAt)}</span> },
            ]}
          />
        ) : null}
        <p className="mt-3 text-[12.5px] text-fg-subtle">{CONFIRMATION_COPY.RELEASE}</p>
      </Panel>
    );
  }

  return (
    <Panel title="Release decision">
      {open && decides ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-fg-muted">
            {`You hold the approver mandate for ${lender}, the designated lender on this lock. Only this authority can release it.`}
          </p>
          <ReleaseDecisionActions pledge={p} rr={open} me={me} />
        </div>
      ) : open && isLenderAnalyst ? (
        <PermissionNotice reason="mandate">
          {ERROR_COPY.RELEASE_UNAUTHORIZED} Your mandate (Lender Analyst) does not include release approval.
        </PermissionNotice>
      ) : open ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-fg-muted">{`${ERROR_COPY.RELEASE_UNAUTHORIZED} Waiting for ${lender}.`}</p>
          <div className="flex flex-wrap gap-2">
            <BorrowerReleaseActions pledge={p} rr={open} me={me} />
          </div>
        </div>
      ) : allows(p, "release.request") ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-fg-muted">
            {`Ask ${lender} to release this lock once the external loan is completed or refinanced. ${ERROR_COPY.RELEASE_UNAUTHORIZED}`}
          </p>
          <div>
            <RequestReleaseDialog pledge={p} me={me} />
          </div>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-fg-muted">No release request is open. {ERROR_COPY.RELEASE_UNAUTHORIZED}</p>
      )}
      {open || allows(p, "release.request") || decides ? <p className="mt-4 text-[12px] text-fg-subtle">{CONFIRMATION_COPY.RELEASE}</p> : null}
    </Panel>
  );
}

/** Pledge Detail and Release `/app/pledges/:id` (S §9.15): real locks only (CR, PDB bug 11). */
export function PledgeDetail({ pledgeRef }: { pledgeRef: string }) {
  const query = usePledge(pledgeRef);

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        action={
          <Link href="/app/pledges" className={buttonVariants({ variant: "outline" })}>
            Back to pledges
          </Link>
        }
      />
    );
  }
  if (query.isPending) return <LoadingState variant="page" label={`Loading pledge ${pledgeRef}…`} />;
  const p = query.data;
  const others = p.releaseRequests;

  return (
    <PageCommands>
      <div className="flex flex-col gap-[18px]">
        <PageHeader
          recordId={p.ref}
          title={`Collateral lock for ${p.assetRef}`}
          status={p.state}
          description={
            <>
              {"Linked case "}
              <Link href={caseTabHref(p.caseId, "pledge")} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
                {p.caseId}
              </Link>
              {" · Registered asset "}
              <Link href={assetHref(p.assetRef)} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
                {p.assetRef}
              </Link>
              {p.lender ? ` · Lender authority: ${p.lender.name} · Approver mandate` : null}
              {p.borrower ? ` · Borrower: ${p.borrower.name}` : null}
            </>
          }
        />
        <PageCommandStatus />
        <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="flex flex-col gap-3.5">
            <LockEvidence p={p} />
            {others.length > 0 ? others.map((rr) => <ReleaseRequestCard key={rr.ref} rr={rr} />) : null}
          </div>
          <div className="flex flex-col gap-3.5">
            <ReleasePanel p={p} />
            <Panel title="What does not release this lock">
              <p className="text-[13px] leading-relaxed text-fg-muted">{BOUNDARY_COPY.WHAT_DOES_NOT_RELEASE}</p>
            </Panel>
          </div>
        </div>
      </div>
    </PageCommands>
  );
}
