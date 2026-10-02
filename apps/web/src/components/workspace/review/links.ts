import { reviewHref } from "../case/links";

// Plain module (no "use client") so server pages can validate the tab segment and build titles.

export const REVIEW_TABS = ["evidence", "verification-scope", "assessment", "decision", "activity"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export const REVIEW_TAB_LABELS: Readonly<Record<ReviewTab, string>> = {
  evidence: "Evidence",
  "verification-scope": "Verification scope",
  assessment: "Assessment",
  decision: "Decision",
  activity: "Activity",
};

export function isReviewTab(value: string): value is ReviewTab {
  return (REVIEW_TABS as readonly string[]).includes(value);
}

/** /app/reviews/CA-001/assessment */
export const reviewTabHref = (reviewRef: string, tab: ReviewTab) => `${reviewHref(reviewRef)}/${tab}`;

/** Review queue views (S §9.10): the case saved views that apply to lender reviews. */
export const REVIEW_VIEWS = ["all", "mine", "ready-for-review", "needs-evidence", "awaiting-approval", "release-requests"] as const;
export type ReviewView = (typeof REVIEW_VIEWS)[number];

export function isReviewView(value: string | undefined): value is ReviewView {
  return !!value && (REVIEW_VIEWS as readonly string[]).includes(value);
}
