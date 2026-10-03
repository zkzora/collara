"use client";

// TanStack Query hooks over the CollaraClient. Keys come from the session scope (lib/session), so a
// persona switch or sign-out never shows another viewer's cached data. Part B pages reuse these.
import type { AuditEventQuery, CaseAction, CaseDetail, PledgeListQuery, SavedView } from "@collara/domain";
import { useQuery } from "@tanstack/react-query";
import { useCollara } from "./collara-client";
import { useSession } from "./session";

/** Lists are small in the demo; one page of up to 100 rows (the API caps `limit` at 100). */
export const LIST_LIMIT = 100;

interface Opt {
  readonly enabled?: boolean;
}

export function useCaseList(view: SavedView = "all", { enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  const query = { view, limit: LIST_LIMIT };
  return useQuery({ queryKey: keys.cases.list(query), queryFn: ({ signal }) => client.cases.list(query, { signal }), enabled });
}

export function useCaseDetail(caseId: string, { enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.cases.detail(caseId), queryFn: ({ signal }) => client.cases.get(caseId, { signal }), enabled });
}

export function useCaseEvidence(caseId: string, { enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.cases.evidence(caseId), queryFn: ({ signal }) => client.cases.evidence(caseId, { signal }), enabled });
}

export function useAuditEvents(query: AuditEventQuery, { enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.audit.events(query), queryFn: ({ signal }) => client.audit.events(query, { signal }), enabled });
}

export function useCaseActivity(caseId: string, opt: Opt = {}) {
  return useAuditEvents({ caseId, limit: LIST_LIMIT }, opt);
}

export function useAccessGrants(caseId: string | undefined, { enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  const query = { caseId, limit: LIST_LIMIT };
  return useQuery({ queryKey: keys.accessGrants.list(query), queryFn: ({ signal }) => client.accessGrants.list(query, { signal }), enabled });
}

/** Dealer consent requests (the dealer's own, or every dealer's for the owner), optionally of one case. */
export function useConsentRequests(caseId: string | undefined, { enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  const query = { caseId, limit: LIST_LIMIT };
  return useQuery({ queryKey: keys.consentRequests.list(query), queryFn: ({ signal }) => client.consentRequests.list(query, { signal }), enabled });
}

export function useAttestation(ref: string | null | undefined) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({
    queryKey: keys.attestations.detail(ref ?? ""),
    queryFn: ({ signal }) => client.attestations.get(ref ?? "", { signal }),
    enabled: !!ref,
  });
}

export function useReview(ref: string | null | undefined) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.reviews.detail(ref ?? ""), queryFn: ({ signal }) => client.reviews.get(ref ?? "", { signal }), enabled: !!ref });
}

export function useReviewList({ enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  const query = { limit: LIST_LIMIT };
  return useQuery({ queryKey: keys.reviews.list(query), queryFn: ({ signal }) => client.reviews.list(query, { signal }), enabled });
}

const REVIEW_EVENT_TYPES = new Set(["REVIEW_STARTED", "ASSESSMENT_SAVED", "SUBMITTED_FOR_APPROVAL", "INFORMATION_REQUESTED", "DECISION_RECORDED"]);

/**
 * The collateral review (CA-…) of a case. CaseDetail carries no review reference, so lenders find it
 * in their review queue and the borrower finds it in the case activity (decision and information
 * requests are disclosed to the borrower). Null while unknown or when nothing is disclosed.
 */
export function useCaseReviewRef(detail: CaseDetail | undefined): { ref: string | null; isPending: boolean } {
  const { me } = useSession();
  const isLender = me.roles.includes("LENDER_ANALYST") || me.roles.includes("LENDER_APPROVER");
  const enabled = !!detail && detail.allowedTabs.includes("review");
  const reviews = useReviewList({ enabled: enabled && isLender });
  const activity = useCaseActivity(detail?.caseId ?? "", { enabled: enabled && !isLender });
  if (!enabled) return { ref: null, isPending: false };
  if (isLender) {
    return { ref: reviews.data?.items.find((r) => r.caseId === detail.caseId)?.ref ?? null, isPending: reviews.isPending };
  }
  const event = activity.data?.items.find((e) => REVIEW_EVENT_TYPES.has(e.type) && e.caseId === detail.caseId);
  return { ref: event?.ref ?? null, isPending: activity.isPending };
}

export function useProposal(ref: string | null | undefined) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.proposals.detail(ref ?? ""), queryFn: ({ signal }) => client.proposals.get(ref ?? "", { signal }), enabled: !!ref });
}

export function usePledge(ref: string | null | undefined) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.pledges.detail(ref ?? ""), queryFn: ({ signal }) => client.pledges.get(ref ?? "", { signal }), enabled: !!ref });
}

export function usePledgeList(filter?: PledgeListQuery["filter"], { enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  const query = { filter, limit: LIST_LIMIT };
  return useQuery({ queryKey: keys.pledges.list(query), queryFn: ({ signal }) => client.pledges.list(query, { signal }), enabled });
}

export function useVerificationList({ enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  const query = { limit: LIST_LIMIT };
  return useQuery({ queryKey: keys.verifications.list(query), queryFn: ({ signal }) => client.verifications.list(query, { signal }), enabled });
}

export function useReportList({ enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  const query = { limit: LIST_LIMIT };
  return useQuery({ queryKey: keys.reports.list(query), queryFn: ({ signal }) => client.reports.list(query, { signal }), enabled });
}

export function useGovernanceState({ enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.governance.state(), queryFn: ({ signal }) => client.governance.state({ signal }), enabled });
}

export function useGovernanceProposals({ enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.governance.proposals(), queryFn: ({ signal }) => client.governance.proposals({ signal }), enabled });
}

/** True when the server listed `action` for this viewer (the UI never computes permissions itself). */
export function allows(detail: { readonly allowedActions: readonly CaseAction[] } | null | undefined, action: CaseAction): boolean {
  return !!detail?.allowedActions.includes(action);
}
