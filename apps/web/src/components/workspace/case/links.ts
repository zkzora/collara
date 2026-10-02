import { CASE_TABS, type CaseTab, type NextActionCode } from "@collara/domain";

/** Case workspace tab URL: /app/cases/CL-001/evidence. */
export function caseTabHref(caseId: string, tab: CaseTab): string {
  return `/app/cases/${encodeURIComponent(caseId)}/${tab}`;
}

export function isCaseTab(value: string): value is CaseTab {
  return (CASE_TABS as readonly string[]).includes(value);
}

/** Where the next-action CTA leads. `null` targets leave the case (Part B pages). */
const NEXT_ACTION_TAB: Readonly<Record<NextActionCode, CaseTab | null>> = {
  ADD_EVIDENCE: "evidence",
  REQUEST_VERIFICATION: "verification",
  ACCEPT_ASSIGNMENT: "verification",
  SUBMIT_ATTESTATION: "verification",
  SUBMIT_NEW_EVIDENCE: "evidence",
  REVIEW_SHARING: "sharing",
  REVIEW_EVIDENCE: "review",
  OPEN_COLLATERAL_REVIEW: "review",
  PROVIDE_INFORMATION: "review",
  DECIDE_ELIGIBILITY: "review",
  ISSUE_PROPOSAL: "proposal",
  RESPOND_TO_PROPOSAL: "proposal",
  AUTHORIZE_ACTIVATION: "pledge",
  ACTIVATE_PLEDGE: "pledge",
  DECIDE_RELEASE: "pledge",
  RESPOND_RELEASE_INFORMATION: "pledge",
  EXPORT_CASE_HISTORY: null,
};

export function nextActionTab(code: string): CaseTab | null {
  return code in NEXT_ACTION_TAB ? NEXT_ACTION_TAB[code as NextActionCode] : null;
}

/** CTA target; tabs the viewer may not open fall back to the summary. */
export function nextActionHref(caseId: string, code: string, allowedTabs?: readonly CaseTab[]): string {
  if (code === "EXPORT_CASE_HISTORY") return "/app/audit/exports";
  const tab = nextActionTab(code);
  return caseTabHref(caseId, tab && (!allowedTabs || allowedTabs.includes(tab)) ? tab : "summary");
}

export const assetHref = (assetRef: string) => `/app/assets/${encodeURIComponent(assetRef)}`;
export const pledgeHref = (pledgeRef: string) => `/app/pledges/${encodeURIComponent(pledgeRef)}`;
export const reviewHref = (reviewRef: string) => `/app/reviews/${encodeURIComponent(reviewRef)}`;
