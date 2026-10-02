"use client";

import { BOUNDARY_COPY, EMPTY_STATE_COPY, SAVED_VIEW_LABELS, type SavedView } from "@collara/domain";
import { CaseTable, SavedViewTabs } from "@/components/collara/case-table";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { useCaseList } from "@/lib/queries";
import { useSession } from "@/lib/session";

/** Case Queue `/app/cases?view=…` (S §9.2). Rows, columns and counts are scoped by the server. */
export function CaseQueue({ view }: { view: SavedView }) {
  const { me } = useSession();
  const list = useCaseList(view);
  const total = list.data?.counts.all;
  const shown = list.data?.items.length;

  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader
        title="Cases"
        description={`Cases shared with ${me.org.name}. Borrower and pledge columns show only what your organization is authorized to see.`}
      />
      <SavedViewTabs current={view} counts={list.data?.counts} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-fg-subtle" aria-live="polite">
          {shown !== undefined && total !== undefined ? `${shown} of ${total} accessible cases` : " "}
        </p>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <LoadingState variant="table" rows={5} label="Loading cases…" />
      ) : (
        <CaseTable
          rows={list.data.items}
          caption={`Cases · ${SAVED_VIEW_LABELS[view]}`}
          empty={view === "all" && total === 0 && me.roles.includes("BORROWER") ? EMPTY_STATE_COPY.NEW_CASE : EMPTY_STATE_COPY.OVERVIEW}
        />
      )}
      <p className="text-[12px] text-fg-subtle">{BOUNDARY_COPY.NO_BULK}</p>
    </div>
  );
}
