"use client";

import { errorMessage } from "@collara/api-client";
import type { EvidenceDocument, Me, VerificationRequest } from "@collara/domain";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { DefinitionList } from "@/components/collara/definition-list";
import { ErrorState } from "@/components/collara/error-state";
import { EvidenceList } from "@/components/collara/evidence-list";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { Panel } from "@/components/collara/panel";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { buttonVariants } from "@/components/ui/button";
import { useCollara } from "@/lib/collara-client";
import { formatRelative, formatUtcDate, formatUtcDateTime, withSeparator } from "@/lib/format";
import { useSession } from "@/lib/session";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { useAssetEvidence } from "../assets/queries";
import { openDownload } from "../audit/download";
import { MessageAction } from "../audit/message-action";
import { actingParty } from "../case/case-context";
import { assetHref, caseTabHref } from "../case/links";
import { DealerConsentStatus } from "../access/consent-requests";
import { AttestationDetails } from "./attestation-details";
import { IssueAttestationDialog } from "./issue-attestation-dialog";
import { SubmitEvidenceDialog } from "./submit-evidence-dialog";
import { useVerification } from "./queries";
import { PageCommands, PageCommandStatus } from "../audit/page-command";

/** The exact versions granted for the current evidence version (when recorded), else the document refs. */
function assignedDocuments(vr: VerificationRequest): string {
  const listed = vr.assignedVersions ? vr.assignedVersions.map((v) => `${v.documentId} v${v.version}`) : vr.documentIds;
  return listed.join(", ") || "None";
}

function AssignedEvidence({ vr }: { vr: VerificationRequest }) {
  const { client } = useCollara();
  const evidence = useAssetEvidence(vr.assetRef);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(doc: EvidenceDocument) {
    setDownloading(doc.id);
    try {
      const link = await client.evidence.download(doc.id);
      openDownload(link.url, `${doc.id}-v${doc.version}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDownloading(null);
    }
  }

  if (evidence.isError) return <ErrorState error={evidence.error} onRetry={() => void evidence.refetch()} />;
  if (evidence.isPending) return <LoadingState variant="table" rows={4} label="Loading assigned evidence…" />;
  const assigned = evidence.data.filter((doc) => vr.documentIds.includes(doc.id));
  return (
    <EvidenceList
      documents={assigned}
      caption={`Assigned evidence · ${vr.ref} · ${vr.evidencePackage.ref} v${vr.evidencePackage.version}`}
      onDownload={(doc) => void download(doc)}
      downloadingId={downloading}
    />
  );
}

function Actions({ vr, me }: { vr: VerificationRequest; me: Me }) {
  const { client } = useCollara();
  const can = (action: VerificationRequest["allowedActions"][number]) => vr.allowedActions.includes(action);
  const party = actingParty(me);
  const record = `${vr.ref} · ${vr.evidencePackage.ref} v${vr.evidencePackage.version}`;
  const any = vr.allowedActions.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {any ? (
        <div className="flex flex-wrap gap-2">
          {can("verification.acceptAssignment") ? (
            <ActionDialog
              label="Accept assignment"
              variant="primary"
              title={`Accept assignment · ${vr.ref}`}
              description={`Accepts the verification of ${vr.assetRef} requested by ${vr.requester.name}. You will review the ${vr.documentIds.length} assigned documents and record the checks in an attestation.`}
              facts={{ actingParty: party, record, effect: "REQUESTED → IN_REVIEW" }}
              caveat={`The registry status of ${vr.verifierRegistryRef} is re-checked when the acceptance is committed.`}
              confirmLabel="Accept assignment"
              prepare={() => ({ decision: "ACCEPT" as const })}
              perform={(body, options) => client.verifications.decideAssignment(vr.ref, body, options)}
            />
          ) : null}
          {can("verification.declineAssignment") ? (
            <MessageAction
              label="Decline assignment"
              variant="danger"
              danger
              title={`Decline assignment · ${vr.ref}`}
              description={`Declines the verification of ${vr.assetRef}. ${vr.requester.name} receives your reason and can request another verifier.`}
              facts={{ actingParty: party, record, effect: "REQUESTED → DECLINED" }}
              confirmLabel="Decline assignment"
              fieldLabel="Reason"
              requiredMessage="Enter the reason for declining."
              perform={(reason, options) => client.verifications.decideAssignment(vr.ref, { decision: "DECLINE", reason }, options)}
            />
          ) : null}
          {can("verification.issueAttestation") ? <IssueAttestationDialog vr={vr} me={me} /> : null}
          {can("verification.requestChanges") ? (
            <MessageAction
              label="Request changes"
              title={`Request changes · ${vr.ref}`}
              description={`Asks ${vr.requester.name} for a corrected or additional evidence version before an attestation can be issued.`}
              facts={{ actingParty: party, record, effect: "IN_REVIEW → CHANGES_REQUESTED" }}
              confirmLabel="Request changes"
              fieldLabel="What needs to change"
              requiredMessage="Describe the changes you need."
              maxLength={2000}
              perform={(message, options) => client.verifications.requestChanges(vr.ref, { message }, options)}
            />
          ) : null}
          {can("verification.reject") ? (
            <MessageAction
              label="Reject with reason"
              variant="danger"
              danger
              title={`Reject verification · ${vr.ref}`}
              description={`Records the outcome Verification rejected for ${vr.assetRef}. No attestation is issued.`}
              facts={{ actingParty: party, record, effect: "IN_REVIEW → REJECTED" }}
              caveat="A rejection is recorded on the request. The passport and its other records are unchanged."
              confirmLabel="Reject verification"
              fieldLabel="Reason"
              requiredMessage="Enter the reason for the rejection."
              perform={(reason, options) => client.verifications.reject(vr.ref, { reason }, options)}
            />
          ) : null}
          {can("verification.submitEvidence") ? <SubmitEvidenceDialog vr={vr} me={me} /> : null}
        </div>
      ) : (
        <p className="text-[13px] text-fg-muted">No verification action is available to your organization at this stage.</p>
      )}
      {vr.state.value === "CHANGES_REQUESTED" && me.roles.includes("BORROWER") ? (
        <Link href={`${assetHref(vr.assetRef)}/evidence`} className={buttonVariants({ variant: "outline" })}>
          Add a new evidence version
        </Link>
      ) : null}
      {me.roles.includes("VERIFIER") && (vr.state.value === "REQUESTED" || vr.state.value === "IN_REVIEW") ? (
        <PermissionNotice reason="scope">
          Only the active, assigned verifier can submit this attestation. Registry status is re-checked at commit, not only when the assignment is accepted.
        </PermissionNotice>
      ) : null}
    </div>
  );
}

/** Verification Workspace `/app/verifications/:id` (S §9.9): request facts, assigned evidence, outcomes. */
export function VerificationWorkspace({ verificationRef }: { verificationRef: string }) {
  const { me } = useSession();
  const query = useVerification(verificationRef);

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        action={
          <Link href="/app/verifications" className={buttonVariants({ variant: "outline" })}>
            Back to verifications
          </Link>
        }
      />
    );
  }
  if (query.isPending) return <LoadingState variant="page" label={`Loading verification ${verificationRef}…`} />;
  const vr = query.data;

  return (
    <PageCommands>
      <div className="flex flex-col gap-[18px]">
        <PageHeader
          recordId={vr.ref}
          title="Verification request"
          status={vr.state}
          description={
            <>
              {withSeparator(vr.equipmentSummary)}
              <Link href={assetHref(vr.assetRef)} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
                {vr.assetRef}
              </Link>
              {` · Requested by ${vr.requester.name} · Verifier ${vr.verifier.name} (${vr.verifierRegistryRef})`}
            </>
          }
          actions={
            <Link href="/app/verifications" className={buttonVariants({ variant: "outline" })}>
              All verifications
            </Link>
          }
        />
        <PageCommandStatus />
        <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Panel eyebrow="Request">
            <DefinitionList
              items={[
                { term: "Asset", description: <span className="font-mono">{vr.assetRef}</span> },
                {
                  term: "Case",
                  description: vr.caseId ? (
                    me.roles.includes("BORROWER") ? (
                      <Link href={caseTabHref(vr.caseId, "verification")} className="font-mono underline-offset-4 hover:underline">
                        {vr.caseId}
                      </Link>
                    ) : (
                      <span className="font-mono">{vr.caseId}</span>
                    )
                  ) : (
                    "Not linked to a case"
                  ),
                },
                { term: "Checklist scope", description: vr.scope.join(", ") },
                { term: "Evidence package", description: <span className="font-mono">{`${vr.evidencePackage.ref} v${vr.evidencePackage.version}`}</span> },
                { term: "Assigned documents", description: <span className="font-mono">{assignedDocuments(vr)}</span> },
                { term: "Due", description: vr.dueAt ? <span className="font-mono">{formatUtcDate(vr.dueAt)}</span> : "Not agreed" },
                { term: "Requested", description: <span className="font-mono">{formatUtcDateTime(vr.requestedAt)}</span> },
                { term: "Last activity", description: formatRelative(vr.updatedAt) },
                ...(vr.lastMessage ? [{ term: "Last message", description: vr.lastMessage }] : []),
              ]}
            />
          </Panel>
          <Panel title="Outcome">
            <Actions vr={vr} me={me} />
          </Panel>
        </div>
        <section aria-label="Assigned evidence" className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium text-fg">Assigned evidence</h2>
          <AssignedEvidence vr={vr} />
        </section>
        {vr.caseId && me.roles.includes("BORROWER") && vr.requester.id === me.org.id ? (
          <DealerConsentStatus caseId={vr.caseId} verificationRef={vr.ref} hideWhenEmpty />
        ) : null}
        {vr.attestation ? (
          <section aria-label="Attestation" className="flex flex-col gap-2">
            <h2 className="text-[14px] font-medium text-fg">Attestation</h2>
            <AttestationDetails attestation={vr.attestation} headingLevel={3} />
          </section>
        ) : null}
      </div>
    </PageCommands>
  );
}
