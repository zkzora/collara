"use client";

import type { GovernanceState, Me, VerifierEntry } from "@collara/domain";
import { useState } from "react";
import { useCollara } from "@/lib/collara-client";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { MessageAction } from "../audit/message-action";
import { actingParty } from "../case/case-context";
import { Field, TextArea, TextInput } from "../form-fields";
import { governanceCaveat } from "./shared";

function afterYours(state: GovernanceState): string {
  const remaining = Math.max(state.threshold - 1, 0);
  return remaining === 0
    ? "Your confirmation alone reaches the threshold."
    : `${remaining} more confirmation${remaining === 1 ? " makes" : "s make"} it executable.`;
}

/** Open a Suspend verifier proposal (seat holders; the proposer's confirmation is recorded with it). */
export function ProposeSuspensionDialog({ entry, state, me }: { entry: VerifierEntry; state: GovernanceState; me: Me }) {
  const { client } = useCollara();
  const seat = state.viewerSeat;
  return (
    <MessageAction
      label="Propose suspension"
      size="sm"
      title={`Propose suspension · ${entry.orgName}`}
      description={`Opens a Suspend verifier proposal for ${entry.ref} · ${entry.orgName}. Your confirmation as seat ${seat ?? "—"} is recorded with the proposal; ${afterYours(state)}`}
      facts={{ actingParty: actingParty(me), record: `New proposal · ${entry.ref}`, effect: `New proposal · Open · 1 of ${state.seats.length} confirmations` }}
      caveat={governanceCaveat(state)}
      confirmLabel="Open proposal"
      fieldLabel="Rationale for the other seats"
      requiredMessage="Enter the rationale for the suspension."
      maxLength={2000}
      perform={(rationale, options) => client.governance.propose({ type: "SUSPEND_VERIFIER", verifierRef: entry.ref, rationale }, options)}
    />
  );
}

/** Open an Add verifier proposal. */
export function ProposeVerifierDialog({ state, me }: { state: GovernanceState; me: Me }) {
  const { client } = useCollara();
  const [orgName, setOrgName] = useState("");
  const [scope, setScope] = useState("");
  const [rationale, setRationale] = useState("");
  const [errors, setErrors] = useState<{ orgName?: string; scope?: string; rationale?: string }>({});
  return (
    <ActionDialog
      label="Propose verifier"
      variant="primary"
      title="Propose verifier"
      description={`Opens an Add verifier proposal. Your confirmation as seat ${state.viewerSeat ?? "—"} is recorded with the proposal; ${afterYours(state)}`}
      facts={{ actingParty: actingParty(me), record: "New proposal · Add verifier", effect: `New proposal · Open · 1 of ${state.seats.length} confirmations` }}
      caveat={governanceCaveat(state)}
      confirmLabel="Open proposal"
      onOpen={() => {
        setOrgName("");
        setScope("");
        setRationale("");
        setErrors({});
      }}
      prepare={() => {
        const next: typeof errors = {};
        if (!orgName.trim()) next.orgName = "Enter the verifier organization.";
        if (!scope.trim()) next.scope = "Enter the inspection scope.";
        if (!rationale.trim()) next.rationale = "Enter the rationale for the other seats.";
        setErrors(next);
        if (Object.keys(next).length > 0) return null;
        return { type: "ADD_VERIFIER" as const, orgName: orgName.trim(), scope: scope.trim(), rationale: rationale.trim() };
      }}
      perform={(body, options) => client.governance.propose(body, options)}
    >
      <Field label="Verifier organization" error={errors.orgName}>
        {(wired) => <TextInput wired={wired} value={orgName} maxLength={120} onChange={(event) => setOrgName(event.target.value)} />}
      </Field>
      <Field label="Scope" hint="e.g. Dimensional metrology · CNC equipment" error={errors.scope}>
        {(wired) => <TextInput wired={wired} value={scope} maxLength={200} onChange={(event) => setScope(event.target.value)} />}
      </Field>
      <Field label="Rationale for the other seats" error={errors.rationale}>
        {(wired) => <TextArea wired={wired} rows={3} value={rationale} maxLength={2000} onChange={(event) => setRationale(event.target.value)} />}
      </Field>
    </ActionDialog>
  );
}
