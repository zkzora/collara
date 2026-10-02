"use client";

import { BOUNDARY_COPY, MessageRequestSchema, STATUS_COPY, type CaseDetail, type Me, type Review } from "@collara/domain";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DefinitionList } from "@/components/collara/definition-list";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { Money } from "@/components/collara/money";
import { Panel } from "@/components/collara/panel";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { StatusBadge } from "@/components/collara/status-badge";
import { useCollara } from "@/lib/collara-client";
import { formatUtcDateTime } from "@/lib/format";
import { allows, useCaseReviewRef, useReview } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { ActionDialog, noPayload } from "../action-dialog";
import { AssessmentDialog } from "../assessment-dialog";
import { Field, TextArea } from "../form-fields";
import { actingParty, useCaseWorkspace } from "./case-context";
import { reviewHref } from "./links";

function snapshotText(review: Review): string {
  const s = review.evidenceSnapshot;
  if (!s) return "—";
  if (s.stale) return STATUS_COPY.EVIDENCE_STALE;
  return `${s.package.ref} v${s.package.version} · ${s.matchesAttested ? "matches attested versions" : "does not match the attested versions"}`;
}

function RequestInformationDialog({ review, me }: { review: Review; me: Me }) {
  const { client } = useCollara();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  return (
    <ActionDialog
      label="Request information"
      title={`Request information · ${review.caseId}`}
      description="Moves the review to Needs information and sends this request to the borrower. Internal notes are not shared."
      facts={{ actingParty: actingParty(me), record: review.ref, effect: `${review.state.value} → NEEDS_INFORMATION` }}
      confirmLabel="Send request"
      onOpen={() => {
        setMessage("");
        setError(undefined);
      }}
      prepare={() => {
        const parsed = MessageRequestSchema.safeParse({ message });
        setError(parsed.success ? undefined : "Describe the information you need.");
        return parsed.success ? parsed.data : null;
      }}
      perform={(body, options) => client.reviews.requestInformation(review.ref, body, options)}
    >
      <Field label="Request to the borrower" error={error}>
        {(wired) => <TextArea wired={wired} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} />}
      </Field>
    </ActionDialog>
  );
}

function DecisionDialog({ review, detail, me, outcome }: { review: Review; detail: CaseDetail; me: Me; outcome: "ELIGIBLE" | "REJECTED" }) {
  const { client } = useCollara();
  const [feedback, setFeedback] = useState("");
  const eligible = outcome === "ELIGIBLE";
  const version = review.assessment?.version ?? 1;
  const policy = review.assessment?.policyRef ?? "—";
  const pkg = review.evidenceSnapshot ? `${review.evidenceSnapshot.package.ref} v${review.evidenceSnapshot.package.version}` : "—";
  const attestation = detail.references.attestation?.ref ?? "—";
  return (
    <ActionDialog
      label={eligible ? "Approve eligibility" : "Reject for this case"}
      variant={eligible ? "primary" : "danger"}
      danger={!eligible}
      title={eligible ? `Approve collateral eligibility · ${detail.caseId}` : `Reject collateral for this case · ${detail.caseId}`}
      description={
        eligible
          ? `Records the assessment outcome Eligible for this case for ${review.lender.name} under policy ${policy}, against evidence snapshot ${pkg} and attestation ${attestation}.`
          : `Records the outcome Rejected for this case. The borrower receives the shared feedback; internal notes stay with ${review.lender.name}.`
      }
      facts={{
        actingParty: actingParty(me),
        record: `${review.ref} · assessment v${version}`,
        effect: `${review.state.value} → ${outcome} (this lender, this case)`,
      }}
      caveat={
        eligible
          ? "Eligible for this lender and case. Financing is not yet active. This does not issue a proposal, disburse funds, or make the passport eligible elsewhere."
          : "Rejection applies to this case only. The asset passport, attestation, and other cases are unaffected."
      }
      confirmLabel={eligible ? "Approve eligibility" : "Reject for this case"}
      onOpen={() => setFeedback(review.sharedFeedback ?? "")}
      prepare={() => ({ outcome, sharedFeedback: feedback.trim() || undefined })}
      perform={(body, options) => client.reviews.decide(review.ref, body, options)}
    >
      <Field label="Feedback shared with the borrower (optional)">
        {(wired) => <TextArea wired={wired} rows={2} value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={2000} />}
      </Field>
    </ActionDialog>
  );
}

function ReviewActions({ review, detail, me }: { review: Review; detail: CaseDetail; me: Me }) {
  const { client } = useCollara();
  const can = (action: Parameters<typeof allows>[1]) => allows(detail, action);
  const isAnalystOnly = me.roles.includes("LENDER_ANALYST") && !me.roles.includes("LENDER_APPROVER");
  const decisionOpen = review.state.value === "IN_REVIEW" || review.state.value === "PENDING_APPROVAL";
  const any = can("review.saveAssessment") || can("review.requestInformation") || can("review.submitForApproval") || can("review.decide");

  return (
    <div className="flex flex-col gap-3">
      {any ? (
        <div className="flex flex-wrap gap-2">
          {can("review.saveAssessment") ? (
            <AssessmentDialog caseId={detail.caseId} review={review} reviewRef={review.ref} me={me} start={review.state.value === "SUBMITTED"} />
          ) : null}
          {can("review.submitForApproval") ? (
            <ActionDialog
              label="Submit for approval"
              variant="primary"
              title={`Submit assessment for approval · ${detail.caseId}`}
              description={`Sends assessment v${review.assessment?.version ?? 1} to the approver mandate at ${review.lender.name} for a collateral decision.`}
              facts={{ actingParty: actingParty(me), record: `${review.ref} · assessment v${review.assessment?.version ?? 1}`, effect: "IN_REVIEW → PENDING_APPROVAL" }}
              caveat="Submitting does not record a decision. The approver can approve, reject or request information."
              confirmLabel="Submit for approval"
              prepare={noPayload}
              perform={(_body, options) => client.reviews.submitForApproval(review.ref, options)}
            />
          ) : null}
          {can("review.requestInformation") ? <RequestInformationDialog review={review} me={me} /> : null}
          {can("review.decide") ? (
            <>
              <DecisionDialog review={review} detail={detail} me={me} outcome="ELIGIBLE" />
              <DecisionDialog review={review} detail={detail} me={me} outcome="REJECTED" />
            </>
          ) : null}
        </div>
      ) : null}
      {isAnalystOnly && decisionOpen ? (
        <PermissionNotice reason="mandate">
          Your mandate (Lender Analyst) does not include collateral approval.
          {can("review.submitForApproval") ? " Submit the assessment for approval by the approver mandate." : null}
        </PermissionNotice>
      ) : null}
      {!any && !isAnalystOnly ? (
        <p className="text-[12.5px] text-fg-muted">No review action is available to your role at this stage.</p>
      ) : null}
    </div>
  );
}

/** Review tab: lender review state, assessment, decision and the actions the server allows. */
export function ReviewTab() {
  const { detail } = useCaseWorkspace();
  const { me } = useSession();
  const { ref, isPending: refPending } = useCaseReviewRef(detail);
  const review = useReview(ref);
  const isLender = me.roles.includes("LENDER_ANALYST") || me.roles.includes("LENDER_APPROVER");

  if (refPending || (ref && review.isPending)) return <LoadingState label="Loading review…" rows={6} />;
  if (review.isError) return <ErrorState error={review.error} onRetry={() => void review.refetch()} />;

  const r = review.data ?? null;
  const lenderName = r?.lender.name ?? detail.selectedLender?.name ?? "the selected lender";

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Panel eyebrow={`Collateral review · ${lenderName}`}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <StatusBadge status={r?.state ?? detail.statuses.review} variant="pill" />
          {r && isLender ? (
            <Link href={reviewHref(r.ref)} className="text-[12.5px] text-fg-muted underline-offset-4 hover:text-fg hover:underline">
              Open collateral review <ArrowRightIcon aria-hidden="true" className="inline size-3" />
            </Link>
          ) : null}
        </div>
        {r ? (
          <DefinitionList
            items={[
              ...(isLender ? [{ term: "Analyst", description: r.analyst ?? "—" }] : []),
              { term: "Approver", description: r.approver ?? "—" },
              ...(isLender ? [{ term: "Evidence snapshot", description: snapshotText(r) }] : []),
              ...(isLender
                ? [
                    {
                      term: "Assessment",
                      description: r.assessment
                        ? `v${r.assessment.version} · ${r.assessment.outcome.label} · saved ${formatUtcDateTime(r.assessment.savedAt)}`
                        : "Not started",
                    },
                  ]
                : []),
              {
                term: "Decision",
                description: r.decision
                  ? `${r.decision.outcome.label} · ${r.decision.decidedBy} · ${formatUtcDateTime(r.decision.decidedAt)}`
                  : "Pending approver mandate",
              },
              ...(r.informationRequest ? [{ term: "Information requested", description: r.informationRequest }] : []),
              ...(r.sharedFeedback ? [{ term: "Shared feedback", description: r.sharedFeedback }] : []),
            ]}
          />
        ) : (
          <p className="text-[13px] text-fg-muted">No review record is visible to your organization yet.</p>
        )}
        {r?.internalNotes ? (
          <div className="mt-4 rounded-md border border-pending/30 bg-pending/5 px-3.5 py-3">
            <p className="mb-1 font-mono text-[10.5px] tracking-[.04em] text-pending-strong uppercase">Internal · {lenderName} only</p>
            <p className="text-[13px] leading-relaxed text-fg">{r.internalNotes}</p>
          </div>
        ) : null}
        {r ? (
          <div className="mt-5 border-t border-line-subtle pt-4">
            <ReviewActions review={r} detail={detail} me={me} />
          </div>
        ) : null}
      </Panel>

      <div className="flex flex-col gap-3.5">
        {r?.derived ? (
          <Panel title="Derived figures">
            <DefinitionList
              items={[
                { term: "Requested principal", description: <Money value={r.derived.requestedPrincipal} size="sm" /> },
                { term: "Valuation", description: <Money value={r.assessment?.valuation} size="sm" /> },
                { term: "Principal / valuation", description: <span className="font-mono">{r.derived.principalToValuation ?? "—"}</span> },
                { term: "Policy maximum", description: <span className="font-mono">{r.derived.policyMaximum}</span> },
              ]}
            />
            <p className="mt-3 text-[12px] text-fg-subtle">{BOUNDARY_COPY.VALUATION_PRINCIPAL_SEPARATE}</p>
          </Panel>
        ) : null}
        <Panel title="Scope of this review">
          <p className="text-[13px] leading-relaxed text-fg-muted">{BOUNDARY_COPY.REVIEW_SCOPE}</p>
          <p className="mt-2.5 text-[13px] leading-relaxed text-fg-muted">
            {`Internal assessment notes and the internal risk view are visible to ${lenderName} only. Feedback shared with the borrower is recorded separately.`}
          </p>
          {r?.state.value === "ELIGIBLE" ? <p className="mt-2.5 text-[13px] text-fg">{STATUS_COPY.REVIEW_ELIGIBLE}</p> : null}
        </Panel>
      </div>
    </div>
  );
}
