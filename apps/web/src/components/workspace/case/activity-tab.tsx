"use client";

import { BOUNDARY_COPY } from "@collara/domain";
import { CaseTimeline } from "@/components/collara/case-timeline";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { Panel } from "@/components/collara/panel";
import { useCaseActivity } from "@/lib/queries";
import { useCaseWorkspace } from "./case-context";

/** Activity tab: the case history in the viewer's scope (same scope as every other list). */
export function ActivityTab() {
  const { detail } = useCaseWorkspace();
  const activity = useCaseActivity(detail.caseId);
  return (
    <div className="flex flex-col gap-3">
      {activity.isError ? (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      ) : activity.isPending ? (
        <LoadingState variant="table" rows={6} label="Loading activity…" />
      ) : (
        <Panel padded={false} aria-label={`Activity · ${detail.caseId}`}>
          <CaseTimeline events={activity.data.items} />
        </Panel>
      )}
      <p className="text-[12px] text-fg-subtle">{BOUNDARY_COPY.ACTIVITY_KINDS}</p>
    </div>
  );
}
