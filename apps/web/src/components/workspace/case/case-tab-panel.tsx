"use client";

import { CASE_TAB_LABELS, type CaseTab } from "@collara/domain";
import { PermissionNotice } from "@/components/collara/permission-notice";
import { ActivityTab } from "./activity-tab";
import { useCaseWorkspace } from "./case-context";
import { EvidenceTab } from "./evidence-tab";
import { PledgeTab } from "./pledge-tab";
import { ProposalTab } from "./proposal-tab";
import { ReviewTab } from "./review-tab";
import { SharingTab } from "./sharing-tab";
import { SummaryTab } from "./summary-tab";
import { VerificationTab } from "./verification-tab";

const PANELS: Readonly<Record<CaseTab, () => React.JSX.Element>> = {
  summary: SummaryTab,
  evidence: EvidenceTab,
  verification: VerificationTab,
  sharing: SharingTab,
  review: ReviewTab,
  proposal: ProposalTab,
  pledge: PledgeTab,
  activity: ActivityTab,
};

/**
 * One case section. Tabs outside the server's `allowedTabs` (e.g. Proposal for a dealer) render a
 * notice instead of data; the API omits those fields anyway, this only explains the gap.
 */
export function CaseTabPanel({ tab }: { tab: CaseTab }) {
  const { detail } = useCaseWorkspace();
  if (!detail.allowedTabs.includes(tab)) {
    return (
      <PermissionNotice reason="organization" title={`${CASE_TAB_LABELS[tab]} is not available`}>
        This section of {detail.caseId} is not disclosed to your organization.
      </PermissionNotice>
    );
  }
  const Panel = PANELS[tab];
  return (
    <section aria-label={CASE_TAB_LABELS[tab]}>
      <Panel />
    </section>
  );
}
