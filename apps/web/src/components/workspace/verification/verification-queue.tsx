"use client";

import Link from "next/link";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { StatusBadge } from "@/components/collara/status-badge";
import { formatRelative, formatUtcDate, formatUtcDateTime } from "@/lib/format";
import { useVerificationList } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { EmptyRow, TableRegion, TD, TR } from "../audit/table-region";
import { verificationHref } from "../assets/links";
import { assetHref } from "../case/links";

/** Verification Queue `/app/verifications` (S §9.8): the verifier's assignments, or the owner's requests. */
export function VerificationQueue() {
  const { me } = useSession();
  const list = useVerificationList();
  const isVerifier = me.roles.includes("VERIFIER");

  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader
        title="Verifications"
        description={
          isVerifier
            ? `Verification requests assigned to ${me.org.name}. You see only the documents each owner shared for the assignment, never loan terms.`
            : `Verification requests made by ${me.org.name} for its assets.`
        }
      />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <LoadingState variant="table" rows={4} label="Loading verification requests…" />
      ) : (
        <TableRegion
          label="Verification requests"
          head={["Request", "Equipment", "Scope", "Due", "Stage", isVerifier ? "Requester" : "Verifier", "Last activity"]}
          minWidth="min-w-[960px]"
        >
          {list.data.items.map((vr) => (
            <tr key={vr.ref} className={TR}>
              <td className={`${TD} whitespace-nowrap`}>
                <Link
                  href={verificationHref(vr.ref)}
                  aria-label={`Open verification ${vr.ref}`}
                  className="font-mono text-[12.5px] text-fg underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {vr.ref}
                </Link>
              </td>
              <td className={TD}>
                {vr.equipmentSummary}
                <Link href={assetHref(vr.assetRef)} className="block font-mono text-[11.5px] text-fg-subtle underline-offset-4 hover:text-fg hover:underline">
                  {vr.assetRef}
                </Link>
              </td>
              <td className={`${TD} max-w-[260px] text-[12.5px] text-fg-muted`}>{vr.scope.join(", ")}</td>
              <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-fg-muted`}>{vr.dueAt ? formatUtcDate(vr.dueAt) : "Not agreed"}</td>
              <td className={`${TD} whitespace-nowrap`}>
                <StatusBadge status={vr.state} />
              </td>
              <td className={TD}>{isVerifier ? vr.requester.name : `${vr.verifier.name} · ${vr.verifierRegistryRef}`}</td>
              <td className={`${TD} whitespace-nowrap text-fg-muted`}>
                <time dateTime={vr.updatedAt} title={formatUtcDateTime(vr.updatedAt)}>
                  {formatRelative(vr.updatedAt)}
                </time>
              </td>
            </tr>
          ))}
          {list.data.items.length === 0 ? <EmptyRow colSpan={7}>No verification requests are visible to your organization.</EmptyRow> : null}
        </TableRegion>
      )}
    </div>
  );
}
