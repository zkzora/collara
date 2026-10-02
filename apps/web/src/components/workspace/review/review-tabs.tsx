"use client";

import { BOUNDARY_COPY, STATUS_COPY, type Review } from "@collara/domain";
import { ArrowRightIcon, CheckIcon, CircleDashedIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CaseTimeline } from "@/components/collara/case-timeline";
import { DefinitionList } from "@/components/collara/definition-list";
import { EmptyState } from "@/components/collara/empty-state";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { Money } from "@/components/collara/money";
import { Panel } from "@/components/collara/panel";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { StatusBadge } from "@/components/collara/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatUtcDate, formatUtcDateTime } from "@/lib/format";
import { allows, useAttestation, useCaseActivity, useCaseEvidence } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AssessmentDialog } from "../assessment-dialog";
import { caseTabHref } from "../case/links";
import { AttestationDetails } from "../verification/attestation-details";
import { useCollateralReview } from "./collateral-review";
import { DecisionActions, RequestInformation, SubmitForApproval } from "./decision-actions";
import { REVIEW_TAB_LABELS, reviewTabHref, type ReviewTab } from "./links";

function Mark({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      aria-hidden="true"
      title={label}
      className={cn("grid size-4 shrink-0 place-items-center rounded-full border", done ? "border-success text-success" : "border-pending text-pending")}
    >
      {done ? <CheckIcon className="size-2.5" /> : <CircleDashedIcon className="size-2.5" />}
    </span>
  );
}

function EvidenceTab() {
  const { review, detail } = useCollateralReview();
  const evidence = useCaseEvidence(review.caseId);
  const snapshot = review.evidenceSnapshot;
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Panel title="Evidence completeness" action={detail.statuses.evidence?.label}>
        {evidence.isError ? (
          <ErrorState error={evidence.error} onRetry={() => void evidence.refetch()} />
        ) : evidence.isPending ? (
          <LoadingState variant="inline" label="Loading evidence…" />
        ) : (
          <ul className="flex flex-col">
            {evidence.data.map((doc) => {
              const done = doc.review?.value === "REVIEWED" || doc.review?.value === "ATTESTED" || doc.review?.value === "REVIEWED_GAP_NOTED";
              return (
                <li key={doc.id} className="flex items-center gap-3 border-b border-line-subtle py-2.5 first:pt-0 last:border-b-0">
                  <Mark done={done} label={done ? "Reviewed" : "Pending"} />
                  <span className="flex-1 text-[13.5px] text-fg">
                    {doc.title}
                    <span className="sr-only">{done ? " — reviewed" : " — pending review"}</span>
                  </span>
                  <span className="font-mono text-[12px] text-fg-muted">v{doc.version}</span>
                  <StatusBadge status={doc.review} className="text-[12.5px]" />
                </li>
              );
            })}
            {evidence.data.length === 0 ? <li className="text-[13px] text-fg-muted">No shared evidence is visible.</li> : null}
          </ul>
        )}
      </Panel>
      <Panel eyebrow="Snapshot">
        {snapshot ? (
          <DefinitionList
            items={[
              { term: "Package", description: <span className="font-mono">{`${snapshot.package.ref} v${snapshot.package.version}`}</span> },
              {
                term: "Matches attested versions",
                description: <StatusBadge status={{ label: snapshot.matchesAttested ? "Yes" : "No", tone: snapshot.matchesAttested ? "success" : "warning" }} />,
              },
              {
                term: "Attestation validity",
                description: detail.references.attestation ? (
                  <span>
                    <StatusBadge status={review.attestationValidity} />
                    <span className="ml-2 font-mono text-[12px] text-fg-muted">{`to ${formatUtcDate(detail.references.attestation.validUntil)}`}</span>
                  </span>
                ) : (
                  <StatusBadge status={review.attestationValidity} />
                ),
              },
              { term: "Stale evidence", description: snapshot.stale ? <span className="text-warning-strong">{STATUS_COPY.EVIDENCE_STALE}</span> : "None detected" },
            ]}
          />
        ) : (
          <p className="text-[13px] text-fg-muted">No evidence snapshot is recorded for this review yet.</p>
        )}
        <p className="mt-4 text-[12.5px] leading-relaxed text-fg-muted">
          If the reviewed evidence changes, this review returns to Needs information until the new version is acknowledged.
        </p>
      </Panel>
    </div>
  );
}

function VerificationScopeTab() {
  const { detail } = useCollateralReview();
  const ref = detail.references.attestation?.ref ?? null;
  const attestation = useAttestation(ref);
  if (!ref) {
    return (
      <Panel>
        <EmptyState title="No attestation">No attestation for this asset is disclosed to your organization.</EmptyState>
      </Panel>
    );
  }
  if (attestation.isError) return <ErrorState error={attestation.error} onRetry={() => void attestation.refetch()} />;
  if (attestation.isPending) return <LoadingState rows={6} label="Loading attestation…" />;
  return <AttestationDetails attestation={attestation.data} />;
}

function NoteBlock({ tag, tone, children }: { tag: string; tone: "internal" | "shared" | "request"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3.5 py-3",
        tone === "internal" ? "border-pending/30 bg-pending/5" : tone === "request" ? "border-warning/30 bg-warning/5" : "border-line-subtle bg-surface-sunken",
      )}
    >
      <p
        className={cn(
          "mb-1 font-mono text-[10.5px] tracking-[.04em] uppercase",
          tone === "internal" ? "text-pending-strong" : tone === "request" ? "text-warning-strong" : "text-fg-muted",
        )}
      >
        {tag}
      </p>
      <p className="text-[13px] leading-relaxed whitespace-pre-line text-fg">{children}</p>
    </div>
  );
}

function AssessmentActions({ review }: { review: Review }) {
  const { me } = useSession();
  const canSave = allows(review, "review.saveAssessment");
  const canSubmit = allows(review, "review.submitForApproval");
  const canRequest = allows(review, "review.requestInformation");
  const canDecide = allows(review, "review.decide");
  const analystOnly = me.roles.includes("LENDER_ANALYST") && !me.roles.includes("LENDER_APPROVER");
  if (!canSave && !canSubmit && !canRequest && !canDecide) {
    return review.decision ? (
      <p className="text-[12.5px] text-fg-muted">
        {`Assessment recorded with the decision on ${formatUtcDate(review.decision.decidedAt)}. Changes require a new assessment version.`}
      </p>
    ) : (
      <p className="text-[12.5px] text-fg-muted">No assessment action is available to your role at this stage.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {canSave ? <AssessmentDialog caseId={review.caseId} review={review} reviewRef={review.ref} me={me} start={review.state.value === "SUBMITTED"} /> : null}
        {canSubmit ? <SubmitForApproval review={review} me={me} /> : null}
        {canRequest ? <RequestInformation review={review} me={me} /> : null}
        {canDecide ? (
          <Link href={reviewTabHref(review.ref, "decision")} className={buttonVariants()}>
            Record decision <ArrowRightIcon aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {analystOnly ? (
        <PermissionNotice reason="mandate">
          Your mandate (Lender Analyst) does not include collateral approval.{canSubmit ? " Submit the assessment for approval by the approver mandate." : null}
        </PermissionNotice>
      ) : null}
    </div>
  );
}

function AssessmentTab() {
  const { review } = useCollateralReview();
  const a = review.assessment;
  const lender = review.lender.name;
  const isLenderView = review.evidenceSnapshot !== null || a !== null || review.internalNotes !== null;

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Panel title="Assessment" action={a ? `v${a.version} · saved ${formatUtcDateTime(a.savedAt)}` : null}>
        {a ? (
          <DefinitionList
            termWidth="lg"
            items={[
              { term: "Valuation source", description: a.valuationSource },
              { term: "Valuation date", description: <span className="font-mono">{a.valuationDate}</span> },
              { term: "Valuation limitations", description: a.limitations || "—" },
              { term: "Collateral outcome", description: <StatusBadge status={a.outcome} /> },
              { term: "Policy reference", description: <span className="font-mono">{a.policyRef}</span> },
              {
                term: "Required external checks",
                description: (
                  <ul className="flex flex-col gap-1">
                    {a.requiredExternalChecks.map((check) => (
                      <li key={check.label}>
                        {check.label} · <span className="text-fg-muted">{check.status}</span>
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        ) : isLenderView ? (
          <p className="text-[13px] text-fg-muted">No assessment has been saved for this review yet.</p>
        ) : (
          <PermissionNotice reason="organization">{`The collateral assessment is a ${lender} record and is not shared with your organization.`}</PermissionNotice>
        )}
        <div className="mt-4 flex flex-col gap-2.5">
          {review.internalNotes ? <NoteBlock tag={`Internal · ${lender} only`} tone="internal">{review.internalNotes}</NoteBlock> : null}
          {review.sharedFeedback ? <NoteBlock tag="Shared feedback · visible to the borrower" tone="shared">{review.sharedFeedback}</NoteBlock> : null}
          {review.informationRequest ? <NoteBlock tag="Information requested from the borrower" tone="request">{review.informationRequest}</NoteBlock> : null}
        </div>
        <div className="mt-5 border-t border-line-subtle pt-4">
          <AssessmentActions review={review} />
        </div>
      </Panel>
      <div className="flex flex-col gap-3.5">
        <Panel title="Collateral valuation">
          <Money value={a?.valuation} size="xl" />
          {a ? <p className="mt-1.5 text-[12.5px] text-fg-muted">{`${a.valuationSource} · ${a.valuationDate}`}</p> : null}
        </Panel>
        <Panel title="Requested principal">
          {review.derived ? (
            <>
              <Money value={review.derived.requestedPrincipal} size="xl" />
              <DefinitionList
                className="mt-3"
                items={[
                  { term: "Principal / valuation", description: <span className="font-mono">{review.derived.principalToValuation ?? "—"}</span> },
                  { term: "Policy maximum", description: <span className="font-mono">{review.derived.policyMaximum}</span> },
                ]}
              />
            </>
          ) : (
            <p className="text-[13px] text-fg-muted">Financing terms are disclosed only to the borrower and the selected lender.</p>
          )}
        </Panel>
        <p className="px-1 text-[12px] text-fg-subtle">{BOUNDARY_COPY.VALUATION_PRINCIPAL_SEPARATE}</p>
        <Panel title="Scope of this review">
          <p className="text-[13px] leading-relaxed text-fg-muted">{BOUNDARY_COPY.REVIEW_SCOPE}</p>
        </Panel>
      </div>
    </div>
  );
}

function DecisionTab() {
  const { review, detail } = useCollateralReview();
  const { me } = useSession();
  const decision = review.decision;
  const analystOnly = me.roles.includes("LENDER_ANALYST") && !me.roles.includes("LENDER_APPROVER");
  const snapshot = review.evidenceSnapshot ? `${review.evidenceSnapshot.package.ref} v${review.evidenceSnapshot.package.version}` : null;

  if (!decision) {
    const open = review.state.value === "IN_REVIEW" || review.state.value === "PENDING_APPROVAL";
    const hasActions = allows(review, "review.decide") || allows(review, "review.requestInformation");
    return (
      <Panel className="max-w-[760px]" title="Decision pending" action={<StatusBadge status={review.state} />}>
        <p className="text-[13.5px] leading-relaxed text-fg-muted">
          {review.assessment
            ? `The assessment records ${review.assessment.outcome.label} under policy ${review.assessment.policyRef}. A decision requires the approver mandate; the analyst cannot record it.`
            : "A decision requires a saved assessment and the approver mandate; the analyst cannot record it."}
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {hasActions ? <DecisionActions review={review} detail={detail} me={me} /> : null}
          {analystOnly && open ? (
            <PermissionNotice reason="mandate">
              Your mandate (Lender Analyst) does not include collateral approval.
              {review.state.value === "IN_REVIEW" ? " Submit the assessment for approval by the approver mandate." : " The assessment is awaiting the approver."}
            </PermissionNotice>
          ) : null}
          {!hasActions && !(analystOnly && open) ? (
            allows(review, "review.saveAssessment") ? (
              <p className="text-[12.5px] text-fg-muted">
                {"Save an assessment first on the "}
                <Link href={reviewTabHref(review.ref, "assessment")} className="text-fg underline underline-offset-4">
                  Assessment
                </Link>
                {" tab."}
              </p>
            ) : (
              <p className="text-[12.5px] text-fg-muted">No decision action is available to your role at this stage.</p>
            )
          ) : null}
        </div>
      </Panel>
    );
  }

  const eligible = decision.outcome.value === "ELIGIBLE";
  return (
    <Panel className="max-w-[760px]" title="Collateral decision" action={<StatusBadge status={decision.outcome} />}>
      <p className="text-[15px] leading-relaxed text-fg">{eligible ? STATUS_COPY.REVIEW_ELIGIBLE : "Rejected for this case."}</p>
      {!eligible ? (
        <p className="mt-1 text-[13px] text-fg-muted">Rejection applies to this case only. The asset passport, attestation, and other cases are unaffected.</p>
      ) : null}
      <DefinitionList
        className="mt-4"
        items={[
          { term: "Recorded by", description: `${decision.decidedBy} · ${review.lender.name}` },
          { term: "Recorded", description: <span className="font-mono">{formatUtcDateTime(decision.decidedAt)}</span> },
          ...(snapshot ? [{ term: "Evidence snapshot", description: <span className="font-mono">{`${snapshot} · ${detail.references.attestation?.ref ?? "—"}`}</span> }] : []),
          ...(review.assessment ? [{ term: "Policy reference", description: <span className="font-mono">{review.assessment.policyRef}</span> }] : []),
          ...(review.sharedFeedback ? [{ term: "Shared feedback", description: review.sharedFeedback }] : []),
        ]}
      />
      {eligible && (allows(detail, "proposal.issue") || allows(detail, "proposal.draft")) ? (
        <div className="mt-5 border-t border-line-subtle pt-4">
          <Link href={caseTabHref(review.caseId, "proposal")} className={buttonVariants()}>
            Continue to the proposal <ArrowRightIcon aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </Panel>
  );
}

function ActivityTab() {
  const { review, detail } = useCollateralReview();
  const activity = useCaseActivity(review.caseId);
  const refs = new Set([review.ref, detail.references.package?.ref].filter(Boolean));
  return (
    <div className="flex flex-col gap-3">
      {activity.isError ? (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      ) : activity.isPending ? (
        <LoadingState variant="table" rows={5} label="Loading activity…" />
      ) : (
        <Panel padded={false} aria-label={`Review activity · ${review.ref}`}>
          <CaseTimeline events={activity.data.items.filter((e) => refs.has(e.ref))} empty="No review activity is visible yet." />
        </Panel>
      )}
      <p className="text-[12px] text-fg-subtle">{BOUNDARY_COPY.ACTIVITY_KINDS}</p>
    </div>
  );
}

const PANELS: Readonly<Record<ReviewTab, () => React.JSX.Element>> = {
  evidence: EvidenceTab,
  "verification-scope": VerificationScopeTab,
  assessment: AssessmentTab,
  decision: DecisionTab,
  activity: ActivityTab,
};

export function ReviewTabPanel({ tab }: { tab: ReviewTab }) {
  const Content = PANELS[tab];
  return (
    <section aria-label={REVIEW_TAB_LABELS[tab]}>
      <Content />
    </section>
  );
}
