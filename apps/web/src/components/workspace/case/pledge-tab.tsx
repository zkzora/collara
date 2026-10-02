"use client";

import { BOUNDARY_COPY, STATUS_COPY, type CaseDetail, type Me } from "@collara/domain";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { DefinitionList } from "@/components/collara/definition-list";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { Panel } from "@/components/collara/panel";
import { StatusBadge } from "@/components/collara/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { useCollara } from "@/lib/collara-client";
import { formatUtcDateTime } from "@/lib/format";
import { allows, usePledge } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { ActionDialog, noPayload } from "../action-dialog";
import { actingParty, useCaseWorkspace } from "./case-context";
import { pledgeHref } from "./links";
import { PrerequisiteList } from "./prerequisite-list";

const ACTIVATION_CAVEAT = "Activation consumes the available control and requires the authorizations below. Two concurrent activations cannot both commit.";

function ActivationActions({ detail, me }: { detail: CaseDetail; me: Me }) {
  const { client } = useCollara();
  const proposal = detail.references.proposal;
  const attestation = detail.references.attestation?.ref ?? "—";
  const pkg = detail.references.package ? `${detail.references.package.ref} v${detail.references.package.version}` : "—";
  const lender = detail.selectedLender?.name ?? "the selected lender";
  const control = detail.technical ? ` v${detail.technical.controlVersion}` : "";
  const canAuthorize = allows(detail, "activation.authorize") && !!proposal;
  const canActivate = allows(detail, "pledge.activate");
  if (!canAuthorize && !canActivate) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canAuthorize && proposal ? (
        <ActionDialog
          label="Authorize pledge activation"
          variant="primary"
          title={`Authorize pledge activation · ${detail.caseId}`}
          description={`Authorizes ${lender} to activate a Collara lock on ${detail.asset.ref} for accepted proposal ${proposal.ref} v${proposal.version}. The authorization carries references, not loan terms.`}
          facts={{
            actingParty: actingParty(me),
            record: `${proposal.ref} · v${proposal.version} · ${attestation} · ${pkg}`,
            effect: "Activation authorization NONE → AUTHORIZED",
          }}
          caveat={`${ACTIVATION_CAVEAT} The lender approver activates the pledge separately.`}
          confirmLabel="Authorize activation"
          prepare={() => ({ expectedVersion: proposal.version })}
          perform={(body, options) => client.proposals.authorizeActivation(proposal.ref, body, options)}
        />
      ) : null}
      {canActivate ? (
        <ActionDialog
          label="Activate pledge"
          variant="primary"
          title={`Activate pledge · ${detail.caseId}`}
          description={`Consumes asset control ${detail.asset.ref}${control} and creates an active Collara lock for ${lender}, referencing ${proposal ? `proposal ${proposal.ref} v${proposal.version}, ` : ""}attestation ${attestation} and evidence snapshot ${pkg}.`}
          facts={{
            actingParty: actingParty(me),
            record: `${detail.asset.ref}${control} · ${proposal ? `${proposal.ref} v${proposal.version}` : "—"}`,
            effect: "Control AVAILABLE → LOCKED · lock ACTIVE",
          }}
          caveat="This creates a Collara workflow lock. It does not disburse funds or register a legal lien."
          confirmLabel="Activate pledge"
          prepare={noPayload}
          perform={(_body, options) => client.cases.activatePledge(detail.caseId, options)}
        />
      ) : null}
    </div>
  );
}

function ActivePledge({ detail, pledgeRef }: { detail: CaseDetail; pledgeRef: string }) {
  const pledge = usePledge(pledgeRef);
  if (pledge.isPending) return <LoadingState label="Loading pledge…" rows={6} />;
  if (pledge.isError) return <ErrorState error={pledge.error} onRetry={() => void pledge.refetch()} />;
  const p = pledge.data;
  const rr = p.releaseRequests[0] ?? null;
  const t = p.technical;
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Panel eyebrow={`Lock and activation evidence · ${p.ref}`} action={<StatusBadge status={p.state} />}>
        <DefinitionList
          termWidth="lg"
          items={[
            { term: "Lock state", description: <StatusBadge status={p.lockState} /> },
            { term: "Activated", description: <span className="font-mono">{formatUtcDateTime(p.activatedAt)}</span> },
            { term: "Authorized by", description: p.activation?.authorizedBy.join(" · ") ?? "—" },
            { term: "Proposal", description: p.activation ? <span className="font-mono">{`${p.activation.proposal.ref} v${p.activation.proposal.version}`}</span> : "—" },
            { term: "Attestation", description: <span className="font-mono">{p.activation?.attestationRef ?? "—"}</span> },
            {
              term: "Evidence snapshot",
              description: p.activation ? <span className="font-mono">{`${p.activation.evidencePackage.ref} v${p.activation.evidencePackage.version}`}</span> : "—",
            },
            ...(t
              ? [
                  {
                    term: "Asset control",
                    description: (
                      <span className="font-mono">{`${p.assetRef} v${t.controlVersionConsumed} → v${t.controlVersionLocked}${t.controlVersionAfterRelease ? ` → v${t.controlVersionAfterRelease}` : ""}`}</span>
                    ),
                  },
                ]
              : []),
            ...(p.releasedAt ? [{ term: "Released", description: <span className="font-mono">{formatUtcDateTime(p.releasedAt)}</span> }] : []),
          ]}
        />
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line-subtle pt-4">
          <Link href={pledgeHref(p.ref)} className={buttonVariants({ variant: "outline" })}>
            Open pledge detail <ArrowRightIcon aria-hidden="true" />
          </Link>
          {allows(detail, "release.request") ? (
            <Link href={pledgeHref(p.ref)} className={buttonVariants()}>
              Request release <ArrowRightIcon aria-hidden="true" />
            </Link>
          ) : null}
          {allows(detail, "release.authorize") || allows(detail, "release.reject") ? (
            <Link href={pledgeHref(p.ref)} className={buttonVariants()}>
              Decide release request <ArrowRightIcon aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </Panel>
      <div className="flex flex-col gap-3.5">
        <Panel title={rr ? `Release request · ${rr.ref}` : "Release"} action={rr ? <StatusBadge status={rr.state} /> : null}>
          {rr ? (
            <DefinitionList
              termWidth="sm"
              items={[
                { term: "Requested by", description: rr.requestedBy },
                { term: "Requested", description: <span className="font-mono">{formatUtcDateTime(rr.requestedAt)}</span> },
                { term: "Reason", description: rr.reason.label },
                ...(rr.note ? [{ term: "Borrower note", description: <span className="whitespace-pre-line text-fg-muted">{rr.note}</span> }] : []),
                ...(rr.informationRequest ? [{ term: "Information requested", description: <span className="whitespace-pre-line">{rr.informationRequest}</span> }] : []),
                ...(rr.decision ? [{ term: "Decision", description: `${rr.decision.outcome.label} · ${rr.decision.decidedBy}` }] : []),
              ]}
            />
          ) : (
            <p className="text-[13px] text-fg-muted">No release request has been made.</p>
          )}
          {rr && (rr.state.value === "REQUESTED" || rr.state.value === "INFORMATION_REQUESTED") ? (
            <p className="mt-3 text-[12.5px] text-fg-muted">{STATUS_COPY.RELEASE_PENDING}</p>
          ) : null}
        </Panel>
        <Panel title="What does not release this lock">
          <p className="text-[13px] leading-relaxed text-fg-muted">{BOUNDARY_COPY.WHAT_DOES_NOT_RELEASE}</p>
        </Panel>
      </div>
    </div>
  );
}

/** Why no activation action is offered to this viewer right now (INFERRED copy except the first case). */
function waitingText(detail: CaseDetail, isLender: boolean): string {
  switch (detail.nextAction?.code) {
    case "AUTHORIZE_ACTIVATION":
      return "Waiting for the borrower to authorize pledge activation.";
    case "ACTIVATE_PLEDGE":
      return "Pledge activation requires the lender approver mandate.";
    default:
      return `Activation becomes available after the collateral decision is recorded and the borrower accepts an issued proposal.${isLender ? " No lender action is available on this control right now." : ""}`;
  }
}

/** Pledge tab: the lock for this case, or (before activation) the control and its prerequisites. */
export function PledgeTab() {
  const { detail } = useCaseWorkspace();
  const { me } = useSession();
  const pledgeRef = detail.references.pledge?.ref;
  if (pledgeRef) return <ActivePledge detail={detail} pledgeRef={pledgeRef} />;

  const isLender = me.roles.includes("LENDER_ANALYST") || me.roles.includes("LENDER_APPROVER");
  const hasAction = allows(detail, "activation.authorize") || allows(detail, "pledge.activate");
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Panel eyebrow={`Collateral control · ${detail.asset.ref}`}>
        <h3 className="text-base font-medium text-fg">No active Collara lock</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
          {`Asset control ${detail.asset.ref}${detail.technical ? ` v${detail.technical.controlVersion}` : ""} is not locked by this case. `}
          {ACTIVATION_CAVEAT}
        </p>
        {detail.prerequisites ? (
          <div className="mt-4">
            <PrerequisiteList items={detail.prerequisites} />
          </div>
        ) : null}
      </Panel>
      <Panel title="Activation">
        {hasAction ? (
          <ActivationActions detail={detail} me={me} />
        ) : (
          <p className="text-[13px] leading-relaxed text-fg-muted">{waitingText(detail, isLender)}</p>
        )}
      </Panel>
    </div>
  );
}
