"use client";

import {
  CONFIRMATION_COPY,
  ERROR_COPY,
  releaseReasons,
  type CreateReleaseRequest,
  type Me,
  type Pledge,
  type ReleaseReason,
  type ReleaseRequest,
} from "@collara/domain";
import { useState } from "react";
import { useCollara } from "@/lib/collara-client";
import { allows } from "@/lib/queries";
import { noPayload } from "../action-dialog";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { MessageAction } from "../audit/message-action";
import { actingParty } from "../case/case-context";
import { Field, SelectInput, TextArea, TextInput } from "../form-fields";

/** Borrower release request (S §9.15; reasons per CR-50). The lock stays ACTIVE until the lender decides. */
export function RequestReleaseDialog({ pledge, me }: { pledge: Pledge; me: Me }) {
  const { client } = useCollara();
  const [reason, setReason] = useState<ReleaseReason>("EXTERNAL_LOAN_COMPLETION");
  const [note, setNote] = useState("");
  const [servicingRef, setServicingRef] = useState("");
  const lender = pledge.lender?.name ?? "the designated lender";
  return (
    <ActionDialog
      label="Request release"
      variant="primary"
      title={`Request release · ${pledge.ref}`}
      description={`Asks ${lender} to release the Collara lock ${pledge.ref} on ${pledge.assetRef}. The lock remains active while ${lender} reviews the request.`}
      facts={{ actingParty: actingParty(me), record: `${pledge.ref} · new release request`, effect: "ACTIVE → RELEASE_REQUESTED · lock stays ACTIVE" }}
      caveat={`${ERROR_COPY.RELEASE_UNAUTHORIZED} Uploading proof of repayment or reaching a maturity date does not release it.`}
      confirmLabel="Request release"
      onOpen={() => {
        setReason("EXTERNAL_LOAN_COMPLETION");
        setNote("");
        setServicingRef("");
      }}
      prepare={(): CreateReleaseRequest => ({ reason, note: note.trim() || undefined, servicingRef: servicingRef.trim() || undefined })}
      perform={(body, options) => client.pledges.requestRelease(pledge.ref, body, options)}
    >
      <Field label="Reason">
        {(wired) => (
          <SelectInput wired={wired} value={reason} onChange={(event) => setReason(event.target.value as ReleaseReason)}>
            {releaseReasons.values.map((value) => (
              <option key={value} value={value}>
                {releaseReasons.label(value)}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      <Field label="Note to the lender (optional)">
        {(wired) => <TextArea wired={wired} rows={2} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />}
      </Field>
      <Field label="Servicing reference (optional)" hint="External loan or servicing reference. Do not enter account numbers.">
        {(wired) => <TextInput wired={wired} className="font-mono" value={servicingRef} maxLength={120} onChange={(event) => setServicingRef(event.target.value)} />}
      </Field>
    </ActionDialog>
  );
}

/** Borrower follow-ups on an open request: answer an information request, or withdraw it. */
export function BorrowerReleaseActions({ pledge, rr, me }: { pledge: Pledge; rr: ReleaseRequest; me: Me }) {
  const { client } = useCollara();
  const party = actingParty(me);
  return (
    <>
      {allows(pledge, "release.respond") ? (
        <MessageAction
          label="Respond to the lender"
          variant="primary"
          title={`Respond to information request · ${rr.ref}`}
          description={`Sends your answer to ${pledge.lender?.name ?? "the lender"} and returns the request for a decision.`}
          facts={{ actingParty: party, record: `${pledge.ref} · ${rr.ref}`, effect: "INFORMATION_REQUESTED → REQUESTED · lock stays ACTIVE" }}
          confirmLabel="Send response"
          fieldLabel="Response"
          requiredMessage="Enter your response."
          maxLength={2000}
          perform={(message, options) => client.releaseRequests.respond(rr.ref, { message }, options)}
        />
      ) : null}
      {allows(pledge, "release.withdraw") ? (
        <ActionDialog
          label="Withdraw request"
          variant="danger"
          danger
          title={`Withdraw release request ${rr.ref}`}
          description="Withdraws the release request. The collateral lock remains active."
          facts={{ actingParty: party, record: `${pledge.ref} · ${rr.ref}`, effect: `${rr.state.value} → WITHDRAWN · lock stays ACTIVE` }}
          confirmLabel="Withdraw request"
          prepare={noPayload}
          perform={(_body, options) => client.releaseRequests.withdraw(rr.ref, options)}
        />
      ) : null}
    </>
  );
}

/** Designated lender approver: authorize, reject (with reason) or request information. */
export function ReleaseDecisionActions({ pledge, rr, me }: { pledge: Pledge; rr: ReleaseRequest; me: Me }) {
  const { client } = useCollara();
  const party = actingParty(me);
  const control = pledge.technical?.controlVersionLocked;
  const record = `${pledge.ref} · ${rr.ref}${control ? ` · control v${control}` : ""}`;
  return (
    <div className="flex flex-col gap-2">
      {allows(pledge, "release.authorize") ? (
        <ActionDialog
          label="Authorize release"
          variant="primary"
          className="h-9 w-full"
          title={`Authorize release of ${pledge.ref}`}
          description={`Release request ${rr.ref} from ${rr.requestedBy} cites ${rr.reason.label.toLowerCase()}. Authorizing releases the Collara workflow lock on ${pledge.assetRef}.`}
          facts={{
            actingParty: party,
            record,
            effect: `ACTIVE → RELEASED · control becomes AVAILABLE${control ? ` (v${control + 1})` : ""}`,
          }}
          caveat={CONFIRMATION_COPY.RELEASE}
          confirmLabel="Authorize release"
          prepare={() => ({ decision: "AUTHORIZE" as const })}
          perform={(body, options) => client.releaseRequests.decide(rr.ref, body, options)}
        />
      ) : null}
      {allows(pledge, "release.reject") ? (
        <MessageAction
          label="Reject release"
          variant="danger"
          danger
          className="h-9 w-full"
          title={`Reject release request ${rr.ref}`}
          description={`The collateral lock on ${pledge.assetRef} remains active. The borrower can reapply with a new reason or evidence.`}
          facts={{ actingParty: party, record: `${pledge.ref} · ${rr.ref}`, effect: "RELEASE_REQUESTED → RELEASE_REJECTED · lock stays ACTIVE" }}
          caveat="A rejection is a release-request outcome. It does not change the active lock or the case eligibility."
          confirmLabel="Reject release"
          fieldLabel="Reason shared with the borrower"
          requiredMessage="Enter the reason for the rejection."
          perform={(reason, options) => client.releaseRequests.decide(rr.ref, { decision: "REJECT", reason }, options)}
        />
      ) : null}
      {allows(pledge, "release.requestInformation") ? (
        <MessageAction
          label="Request information"
          className="h-9 w-full"
          title={`Request information · ${rr.ref}`}
          description="Asks the borrower for more information before you decide. The collateral lock remains active."
          facts={{ actingParty: party, record: `${pledge.ref} · ${rr.ref}`, effect: "REQUESTED → INFORMATION_REQUESTED · lock stays ACTIVE" }}
          confirmLabel="Send request"
          fieldLabel="Information needed"
          requiredMessage="Describe the information you need."
          maxLength={2000}
          perform={(message, options) => client.releaseRequests.requestInformation(rr.ref, { message }, options)}
        />
      ) : null}
    </div>
  );
}
