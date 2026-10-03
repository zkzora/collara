"use client";

// Dealer consent requests (daml-model.md §4.6): the invited dealer approves (Consent_Grant), declines
// (Consent_Decline) or withdraws (Share_WithdrawConsent) the owner's request to share the dealer's OWN documents
// with one recipient; the owner reads the status per dealer document. All strings here are INFERRED copy except
// STATUS_COPY.ACCESS_REVOKED (approved revocation copy).
import { DOCUMENT_TYPE_LABELS, STATUS_COPY, type ConsentRequest, type Me } from "@collara/domain";
import Link from "next/link";
import { useId, useState } from "react";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { StatusBadge } from "@/components/collara/status-badge";
import { useCollara } from "@/lib/collara-client";
import { formatUtcDate, shortId } from "@/lib/format";
import { useConsentRequests } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { TrackedActionDialog as ActionDialog } from "../audit/page-command";
import { EmptyRow, TableRegion, TD, TR } from "../audit/table-region";
import { actingParty } from "../case/case-context";
import { caseTabHref } from "../case/links";

const PERMISSION_LABELS: Readonly<Record<ConsentRequest["permission"], string>> = {
  VIEW: "view",
  VIEW_DOWNLOAD: "view and download",
};

type ConsentDocument = ConsentRequest["documents"][number];

/** "Dealer invoice · DOC-003 v1" */
export function consentDocumentLabel(doc: ConsentDocument): string {
  const name = doc.title ?? (doc.type ? DOCUMENT_TYPE_LABELS[doc.type] : null);
  return `${name ? `${name} · ` : ""}${doc.documentId} v${doc.version}`;
}

/** "Lender review" or "Verification · VR-002" */
function purposeOf(request: ConsentRequest): string {
  return request.verificationRef ? `${request.purposeLabel} · ${request.verificationRef}` : request.purposeLabel;
}

function documentsSummary(request: ConsentRequest): string {
  return request.documents.map(consentDocumentLabel).join(", ");
}

function DocumentCell({ request }: { request: ConsentRequest }) {
  return (
    <ul className="flex flex-col gap-1">
      {request.documents.map((doc) => (
        <li key={`${doc.documentId}-${doc.version}`}>
          <span className="text-fg">{consentDocumentLabel(doc)}</span>
          <span className="block font-mono text-[11.5px] text-fg-subtle" title={doc.sha256}>
            {`SHA-256 ${shortId(doc.sha256, 8, 6)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ConsentActions({ request, me, onWithdrawn }: { request: ConsentRequest; me: Me; onWithdrawn: (request: ConsentRequest) => void }) {
  const { client } = useCollara();
  const can = (action: ConsentRequest["allowedActions"][number]) => request.allowedActions.includes(action);
  const record = `${request.id} · ${request.caseId}`;
  const docs = documentsSummary(request);
  const purpose = request.purposeLabel.toLowerCase();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {can("consent.grant") ? (
        <ActionDialog
          label="Approve"
          size="sm"
          variant="primary"
          title={`Approve consent · ${request.id}`}
          description={`Shares ${docs} with ${request.recipient.name} for ${purpose} on ${request.caseId}, with ${PERMISSION_LABELS[request.permission]} permission until ${formatUtcDate(request.expiresAt)}. Only these document versions are covered; nothing else of yours is shared.`}
          facts={{ actingParty: actingParty(me), record, effect: "Awaiting consent → Consent granted" }}
          caveat="You can withdraw this consent later. Withdrawal limits future access only."
          confirmLabel="Approve and share"
          prepare={() => ({ decision: "GRANT" as const })}
          perform={(body, options) => client.consentRequests.decide(request.id, body, options)}
        />
      ) : null}
      {can("consent.decline") ? (
        <ActionDialog
          label="Decline"
          size="sm"
          variant="danger"
          danger
          title={`Decline consent · ${request.id}`}
          description={`${request.recipient.name} will not receive ${docs} for ${purpose} on ${request.caseId}. ${request.requestedBy.name} sees that you declined and may send a new request.`}
          facts={{ actingParty: actingParty(me), record, effect: "Awaiting consent → Declined" }}
          caveat="Nothing is shared. No reason text is recorded on the ledger."
          confirmLabel="Decline request"
          prepare={() => ({ decision: "DECLINE" as const })}
          perform={(body, options) => client.consentRequests.decide(request.id, body, options)}
        />
      ) : null}
      {can("consent.withdraw") ? (
        <ActionDialog
          label="Withdraw consent"
          size="sm"
          variant="danger"
          danger
          title={`Withdraw consent · ${request.id}`}
          description={`Ends ${request.recipient.name}'s future access to ${docs} (${purpose}, ${request.caseId}).`}
          facts={{ actingParty: actingParty(me), record, effect: "Consent granted → Consent withdrawn" }}
          caveat={STATUS_COPY.ACCESS_REVOKED}
          confirmLabel="Withdraw consent"
          prepare={() => ({})}
          perform={(_body, options) => client.consentRequests.withdraw(request.id, options)}
          onSuccess={() => onWithdrawn(request)}
        />
      ) : null}
    </div>
  );
}

/**
 * The invited dealer's consent requests (pending first) for its own documents, with Approve / Decline and,
 * once granted, Withdraw consent. `caseId` scopes it to one case (the case's Sharing & Access tab).
 */
export function DealerConsentRequests({ caseId }: { caseId?: string }) {
  const { me } = useSession();
  const requests = useConsentRequests(caseId);
  const headingId = useId();
  const [withdrawn, setWithdrawn] = useState<ConsentRequest | null>(null);
  const label = caseId ? `Consent requests · ${caseId}` : "Consent requests · all accessible cases";
  const pending = requests.data?.items.filter((r) => r.state.value === "PENDING").length ?? 0;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-[14px] font-medium text-fg">
          Consent requests
        </h2>
        {requests.data ? <span className="text-[12.5px] text-fg-muted">{pending === 1 ? "1 awaiting your consent" : `${pending} awaiting your consent`}</span> : null}
      </div>
      <p className="text-[12.5px] leading-relaxed text-fg-muted">
        The asset owner asks before your own documents are shared with a lender or a verifier. Nothing reaches the recipient until you approve, and
        only the listed versions are covered.
      </p>
      {withdrawn ? (
        <p role="status" className="rounded-md border border-line bg-surface-sunken px-3.5 py-3 text-[13px] text-fg">
          {`${withdrawn.id} · ${withdrawn.recipient.name}: `}
          {STATUS_COPY.ACCESS_REVOKED}
        </p>
      ) : null}
      {requests.isError ? (
        <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
      ) : requests.isPending ? (
        <LoadingState variant="table" rows={2} label="Loading consent requests…" />
      ) : (
        <TableRegion label={label} head={["Case", "Your documents", "Recipient", "Purpose", "Expiry", "Status", ""]} minWidth="min-w-[1040px]">
          {requests.data.items.map((request) => (
            <tr key={`${request.caseId}-${request.id}`} className={TR}>
              <td className={`${TD} whitespace-nowrap`}>
                <Link href={caseTabHref(request.caseId, "sharing")} className="font-mono text-[12.5px] text-fg underline-offset-4 hover:underline">
                  {request.caseId}
                </Link>
                <span className="block font-mono text-[11.5px] text-fg-subtle">{request.id}</span>
              </td>
              <td className={TD}>
                <DocumentCell request={request} />
              </td>
              <td className={TD}>{request.recipient.name}</td>
              <td className={TD}>
                {purposeOf(request)}
                <span className="block text-[12px] text-fg-muted">{`Requested by ${request.requestedBy.name}`}</span>
              </td>
              <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{formatUtcDate(request.expiresAt)}</td>
              <td className={`${TD} whitespace-nowrap`}>
                <StatusBadge status={request.state} />
              </td>
              <td className={`${TD} text-right`}>
                <ConsentActions request={request} me={me} onWithdrawn={setWithdrawn} />
              </td>
            </tr>
          ))}
          {requests.data.items.length === 0 ? <EmptyRow colSpan={7}>No consent requests for your documents.</EmptyRow> : null}
        </TableRegion>
      )}
    </section>
  );
}

/**
 * Owner view: the consent status of each dealer document (pending, granted, declined, withdrawn …) per recipient,
 * so the owner sees why a dealer document has not reached the lender or the verifier. `verificationRef` narrows it
 * to one verification request.
 */
export function DealerConsentStatus({
  caseId,
  verificationRef,
  headingLevel = 2,
  hideWhenEmpty = false,
}: {
  caseId: string;
  verificationRef?: string;
  headingLevel?: 2 | 3;
  /** Render nothing when no dealer document was requested (e.g. a case without a dealer). */
  hideWhenEmpty?: boolean;
}) {
  const requests = useConsentRequests(caseId);
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const items = (requests.data?.items ?? []).filter((r) => !verificationRef || r.verificationRef === verificationRef);
  const rows = items.flatMap((request) => request.documents.map((doc) => ({ request, doc })));
  const label = verificationRef ? `Dealer consent · ${verificationRef}` : `Dealer consent · ${caseId}`;
  if (hideWhenEmpty && requests.isSuccess && rows.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <Heading id={headingId} className="text-[14px] font-medium text-fg">
        Dealer consent
      </Heading>
      <p className="text-[12.5px] leading-relaxed text-fg-muted">
        A dealer document reaches the lender or the verifier only after the dealer&apos;s own consent for that recipient. Your own documents are
        shared separately.
      </p>
      {requests.isError ? (
        <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
      ) : requests.isPending ? (
        <LoadingState variant="table" rows={2} label="Loading dealer consent…" />
      ) : (
        <TableRegion label={label} head={["Dealer document", "Dealer", "Recipient", "Purpose", "Status", "Requested", "Expiry"]} minWidth="min-w-[960px]">
          {rows.map(({ request, doc }) => (
            <tr key={`${request.id}-${doc.documentId}-${doc.version}`} className={TR}>
              <td className={TD}>
                {consentDocumentLabel(doc)}
                <span className="block font-mono text-[11.5px] text-fg-subtle" title={doc.sha256}>
                  {`SHA-256 ${shortId(doc.sha256, 8, 6)}`}
                </span>
              </td>
              <td className={TD}>{request.dealer.name}</td>
              <td className={TD}>{request.recipient.name}</td>
              <td className={TD}>
                {purposeOf(request)}
                <span className="block font-mono text-[11.5px] text-fg-subtle">{request.id}</span>
              </td>
              <td className={`${TD} whitespace-nowrap`}>
                <StatusBadge status={request.state} />
              </td>
              <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{formatUtcDate(request.requestedAt)}</td>
              <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{formatUtcDate(request.expiresAt)}</td>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={7}>No dealer documents have been requested for sharing.</EmptyRow> : null}
        </TableRegion>
      )}
    </section>
  );
}
