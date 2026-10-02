"use client";

import type { CaseDetail, Me, Review } from "@collara/domain";
import { useState } from "react";
import { useCollara } from "@/lib/collara-client";
import { allows } from "@/lib/queries";
import { noPayload } from "../action-dialog";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { MessageAction } from "../audit/message-action";
import { actingParty } from "../case/case-context";
import { Field, TextArea } from "../form-fields";

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
      title={eligible ? `Approve collateral eligibility · ${review.caseId}` : `Reject collateral for this case · ${review.caseId}`}
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
      <Field label="Feedback shared with the borrower (optional)" hint="Internal notes are never shared.">
        {(wired) => <TextArea wired={wired} rows={2} value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={2000} />}
      </Field>
    </ActionDialog>
  );
}

export function RequestInformation({ review, me }: { review: Review; me: Me }) {
  const { client } = useCollara();
  return (
    <MessageAction
      label="Request information"
      title={`Request information · ${review.caseId}`}
      description="Moves the review to Needs information and sends this request to the borrower. Internal notes are not shared."
      facts={{ actingParty: actingParty(me), record: review.ref, effect: `${review.state.value} → NEEDS_INFORMATION` }}
      confirmLabel="Send request"
      fieldLabel="Request to the borrower"
      requiredMessage="Describe the information you need."
      maxLength={2000}
      perform={(message, options) => client.reviews.requestInformation(review.ref, { message }, options)}
    />
  );
}

export function SubmitForApproval({ review, me }: { review: Review; me: Me }) {
  const { client } = useCollara();
  const version = review.assessment?.version ?? 1;
  return (
    <ActionDialog
      label="Submit for approval"
      variant="primary"
      title={`Submit assessment for approval · ${review.caseId}`}
      description={`Sends assessment v${version} to the approver mandate at ${review.lender.name} for a collateral decision.`}
      facts={{ actingParty: actingParty(me), record: `${review.ref} · assessment v${version}`, effect: "IN_REVIEW → PENDING_APPROVAL" }}
      caveat="Submitting does not record a decision. The approver can approve, reject or request information."
      confirmLabel="Submit for approval"
      prepare={noPayload}
      perform={(_body, options) => client.reviews.submitForApproval(review.ref, options)}
    />
  );
}

/** Approver decision buttons (designated approver mandate only; the server lists `review.decide`). */
export function DecisionActions({ review, detail, me }: { review: Review; detail: CaseDetail; me: Me }) {
  return (
    <div className="flex flex-wrap gap-2">
      {allows(review, "review.decide") ? (
        <>
          <DecisionDialog review={review} detail={detail} me={me} outcome="ELIGIBLE" />
          <DecisionDialog review={review} detail={detail} me={me} outcome="REJECTED" />
        </>
      ) : null}
      {allows(review, "review.requestInformation") ? <RequestInformation review={review} me={me} /> : null}
    </div>
  );
}
