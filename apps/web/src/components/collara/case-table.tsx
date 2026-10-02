"use client";

import { SAVED_VIEW_LABELS, SAVED_VIEWS, type CaseSummary, type SavedView } from "@collara/domain";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, type MouseEvent, type ReactNode } from "react";
import { formatRelative, formatUtcDateTime, joinParts } from "@/lib/format";
import { cn } from "@/lib/utils";
import { casesHref } from "./navigation";
import { StatusBadge } from "./status-badge";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, basic: sortFn_basic },
});

const helper = createColumnHelper<typeof features, CaseSummary>();

export type CaseColumnId = "caseId" | "asset" | "borrower" | "verification" | "review" | "pledge" | "nextActor" | "updatedAt";

/** Detail link for a case row (Summary tab). */
export function caseHref(caseId: string): string {
  return `/app/cases/${encodeURIComponent(caseId)}/summary`;
}

// Null means "not disclosed to this viewer": those rows sort last and render "—", never a guess.
const allColumns = helper.columns([
  helper.accessor("caseId", {
    header: "Case ID",
    sortFn: "alphanumeric",
    cell: ({ row }) => (
      <Link
        href={caseHref(row.original.caseId)}
        className="font-mono text-[12.5px] text-fg underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        {row.original.caseId}
      </Link>
    ),
  }),
  helper.accessor((row) => joinParts([row.asset.equipmentClass, row.asset.model]), {
    id: "asset",
    header: "Asset",
    sortFn: "text",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span>{joinParts([row.original.asset.equipmentClass, row.original.asset.model]) || "—"}</span>
        <span className="font-mono text-[11.5px] text-fg-subtle">{row.original.asset.ref}</span>
      </div>
    ),
  }),
  helper.accessor((row) => row.borrower?.name, {
    id: "borrower",
    header: "Borrower",
    sortFn: "text",
    sortUndefined: "last",
    cell: ({ row }) => <StatusText value={row.original.borrower?.name} />,
  }),
  helper.accessor((row) => row.verification?.label, {
    id: "verification",
    header: "Verification",
    sortFn: "text",
    sortUndefined: "last",
    cell: ({ row }) => <StatusBadge status={row.original.verification} />,
  }),
  helper.accessor((row) => row.review?.label, {
    id: "review",
    header: "Lender review",
    sortFn: "text",
    sortUndefined: "last",
    cell: ({ row }) => <StatusBadge status={row.original.review} />,
  }),
  helper.accessor((row) => row.pledge?.label, {
    id: "pledge",
    header: "Pledge",
    sortFn: "text",
    sortUndefined: "last",
    cell: ({ row }) => <StatusBadge status={row.original.pledge} />,
  }),
  helper.accessor((row) => row.nextActor?.label, {
    id: "nextActor",
    header: "Next actor",
    sortFn: "text",
    sortUndefined: "last",
    cell: ({ row }) => <StatusText value={row.original.nextActor?.label} muted />,
  }),
  helper.accessor((row) => Date.parse(row.updatedAt), {
    id: "updatedAt",
    header: "Last update",
    sortFn: "basic",
    sortDescFirst: true,
    cell: ({ row }) => (
      <time dateTime={row.original.updatedAt} title={formatUtcDateTime(row.original.updatedAt)} className="text-[12.5px] text-fg-subtle">
        {formatRelative(row.original.updatedAt)}
      </time>
    ),
  }),
]);

function StatusText({ value, muted = false }: { value: string | null | undefined; muted?: boolean }) {
  if (!value) return <StatusBadge status={null} />;
  return <span className={muted ? "text-fg-muted" : undefined}>{value}</span>;
}

const ROW_IGNORE = "a,button,input,select,textarea,label";
const NOWRAP: ReadonlySet<string> = new Set(["caseId", "verification", "review", "pledge", "updatedAt"]);

/**
 * Case queue table (TanStack Table v9): sortable headers with aria-sort, a real link in the first
 * cell (the row is also clickable for pointer users), horizontal scroll inside its card on small
 * screens. Rows and counts come from the server under the viewer's scope.
 */
export function CaseTable({
  rows,
  caption,
  columns: visible,
  empty,
  className,
}: {
  rows: readonly CaseSummary[];
  caption: string;
  /** Visible columns in order; default all. */
  columns?: readonly CaseColumnId[];
  empty?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const columns = useMemo(
    () => (visible ? allColumns.filter((column) => visible.includes(column.id as CaseColumnId)) : allColumns),
    [visible],
  );
  const table = useTable({
    features,
    columns,
    data: rows,
    initialState: { sorting: [{ id: "updatedAt", desc: true }] },
    enableSortingRemoval: false,
  });

  function openRow(event: MouseEvent<HTMLTableRowElement>, caseId: string) {
    if ((event.target as HTMLElement).closest(ROW_IGNORE) || window.getSelection()?.toString()) return;
    router.push(caseHref(caseId));
  }

  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cn("relative overflow-x-auto rounded-lg border border-line bg-surface-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-line">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const align = header.column.id === "updatedAt" ? "text-right" : "";
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                    className={cn("px-3.5 py-2.5 text-[12px] font-medium whitespace-nowrap text-fg-muted", align)}
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? (
                          <ArrowUpIcon aria-hidden="true" className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDownIcon aria-hidden="true" className="size-3" />
                        ) : (
                          <ArrowUpDownIcon aria-hidden="true" className="size-3 opacity-40" />
                        )}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={(event) => openRow(event, row.original.caseId)}
              className="cursor-pointer border-b border-line-subtle last:border-b-0 hover:bg-white/[.03]"
            >
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={cn("px-3.5 py-3 align-middle", NOWRAP.has(cell.column.id) && "whitespace-nowrap", cell.column.id === "updatedAt" && "text-right")}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-9 text-center text-[13.5px] text-fg-muted">
                {empty ?? "No cases."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** Saved-view tabs for the queue (`?view=…`), with server-scoped counts. Links, not buttons. */
export function SavedViewTabs({
  current,
  counts,
  className,
}: {
  current: SavedView;
  counts: Partial<Record<SavedView, number>> | undefined;
  className?: string;
}) {
  return (
    <nav aria-label="Saved views" className={cn("relative overflow-x-auto border-b border-line", className)}>
      <ul className="flex min-w-max gap-1">
        {SAVED_VIEWS.map((view) => {
          const active = view === current;
          return (
            <li key={view}>
              <Link
                href={casesHref(view)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-[38px] items-center gap-2 border-b-2 px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-fg font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {SAVED_VIEW_LABELS[view]}
                {counts?.[view] !== undefined ? <span className="font-mono text-[11px] text-fg-subtle">{counts[view]}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
