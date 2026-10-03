"use client";

import type { Me, SubmitEvidenceRequest, VerificationRequest } from "@collara/domain";
import { useState } from "react";
import { useCollara } from "@/lib/collara-client";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { useAssetEvidence } from "../assets/queries";
import { actingParty } from "../case/case-context";
import { Checklist, grantOptionLabel, selectionError } from "./request-verification-dialog";

/**
 * Submit new evidence (owner, after a change request): the new evidence version is granted to the assigned verifier
 * for the documents selected here (pre-selected: the documents granted for the previous version); the previous
 * grant is revoked.
 */
export function SubmitEvidenceDialog({ vr, me }: { vr: VerificationRequest; me: Me }) {
  const { client } = useCollara();
  const evidence = useAssetEvidence(vr.assetRef);
  const available = (evidence.data ?? []).filter((doc) => doc.status.value === "AVAILABLE");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();

  function prepare(): SubmitEvidenceRequest | null {
    const next = selectionError(available, docIds);
    setError(next);
    return next ? null : { documentIds: docIds.filter((id) => available.some((doc) => doc.id === id)) };
  }

  return (
    <ActionDialog
      label="Submit new evidence"
      variant="primary"
      title={`Submit new evidence · ${vr.ref}`}
      description={`Resubmits the current evidence package of ${vr.assetRef} to ${vr.verifier.name} after the requested changes. Add the new document versions on the passport first.`}
      facts={{ actingParty: actingParty(me), record: vr.ref, effect: "CHANGES_REQUESTED → IN_REVIEW" }}
      caveat="The verifier receives the selected documents at the new version; access to the previous version ends."
      confirmLabel="Submit evidence"
      onOpen={() => {
        setDocIds([...vr.documentIds]);
        setError(undefined);
      }}
      prepare={prepare}
      perform={(body, options) => client.verifications.submitEvidence(vr.ref, body, options)}
    >
      <Checklist
        legend="Documents shared with the verifier"
        options={available.map((doc) => ({ value: doc.id, label: grantOptionLabel(doc, me.org.id, vr.caseId !== null) }))}
        selected={docIds}
        onChange={setDocIds}
        error={error}
      />
    </ActionDialog>
  );
}
