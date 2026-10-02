"use client";

import { EMPTY_STATE_COPY } from "@collara/domain";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { Panel } from "@/components/collara/panel";
import { nextActionHref } from "@/components/workspace/case/links";
import { formatRelative } from "@/lib/format";
import { useCaseList } from "@/lib/queries";

/**
 * Minimal inbox (P1): the cases where this viewer is the next actor, as a generic event plus a link.
 * No serial, borrower, principal, filename or terms (synthesis §1.4.2 rule 6); the linked page
 * applies the same access check as everywhere else.
 */
export function NotificationsView() {
  const mine = useCaseList("mine");
  return (
    <div className="flex max-w-[860px] flex-col gap-[18px]">
      <PageHeader title="Notifications" description="Actions waiting for you. Each item links to the record; details appear after the access check." />
      {mine.isError ? (
        <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />
      ) : mine.isPending ? (
        <LoadingState rows={3} label="Loading notifications…" />
      ) : (
        <Panel padded={false} aria-label="Notifications">
          <ul>
            {mine.data.items.map((c) => (
              <li key={c.caseId} className="border-b border-line-subtle last:border-b-0">
                <Link
                  href={c.nextAction ? nextActionHref(c.caseId, c.nextAction.code) : `/app/cases/${encodeURIComponent(c.caseId)}/summary`}
                  className="flex items-center justify-between gap-3 px-4 py-3.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="text-[13.5px] text-fg">
                    <span className="font-mono">{c.caseId}</span>
                    {` · ${c.nextAction?.label ?? "Action requested"}`}
                    <span className="block text-[12px] text-fg-subtle">{formatRelative(c.updatedAt)}</span>
                  </span>
                  <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                </Link>
              </li>
            ))}
            {mine.data.items.length === 0 ? <li className="px-4 py-6 text-[13.5px] text-fg-muted">{EMPTY_STATE_COPY.OVERVIEW}</li> : null}
          </ul>
        </Panel>
      )}
      <p className="text-[12px] text-fg-subtle">In-app only. No email or push notifications are sent in this demo.</p>
    </div>
  );
}
