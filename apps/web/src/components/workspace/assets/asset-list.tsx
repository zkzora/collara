"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { StatusBadge } from "@/components/collara/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatRelative, formatUtcDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { EmptyRow, TableRegion, TD, TR, Undisclosed } from "../audit/table-region";
import { assetHref } from "../case/links";
import { useAssetList } from "./queries";

/** Assets `/app/assets` (S §9.4): passports registered by, assigned to or shared with this organization. */
export function AssetList() {
  const { me } = useSession();
  const list = useAssetList();
  const canRegister = me.roles.includes("BORROWER");

  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader
        title="Assets"
        description={`Asset passports visible to ${me.org.name}. Verification and lifecycle are shown separately; neither means ownership or lien status was independently confirmed.`}
        actions={
          canRegister ? (
            <Link href="/app/assets/new" className={buttonVariants()}>
              <PlusIcon aria-hidden="true" />
              Register asset
            </Link>
          ) : null
        }
      />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <LoadingState variant="table" rows={4} label="Loading assets…" />
      ) : (
        <TableRegion
          label="Asset passports"
          head={["Asset ID", "Equipment type", "Manufacturer · model", "Owner organization", "Verification", "Lifecycle", "Last update"]}
          minWidth="min-w-[960px]"
        >
          {list.data.items.map((asset) => (
            <tr key={asset.ref} className={TR}>
              <td className={`${TD} whitespace-nowrap`}>
                <Link
                  href={assetHref(asset.ref)}
                  aria-label={`Open passport ${asset.ref}`}
                  className="font-mono text-[12.5px] text-fg underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {asset.ref}
                </Link>
              </td>
              <td className={TD}>{asset.equipmentClass || <Undisclosed />}</td>
              <td className={TD}>
                {asset.manufacturer || <Undisclosed />}
                {asset.model ? <span className="block font-mono text-[11.5px] text-fg-subtle">{asset.model}</span> : null}
              </td>
              <td className={TD}>{asset.owner?.name ?? <Undisclosed />}</td>
              <td className={TD}>
                <div className="flex flex-col gap-1">
                  <StatusBadge status={asset.verification} />
                  {asset.attestation ? <span className="text-[12px] text-fg-muted">Attestation · {asset.attestation.label}</span> : null}
                </div>
              </td>
              <td className={`${TD} whitespace-nowrap`}>
                <StatusBadge status={asset.lifecycle} />
              </td>
              <td className={`${TD} whitespace-nowrap text-fg-muted`}>
                <time dateTime={asset.updatedAt} title={formatUtcDateTime(asset.updatedAt)}>
                  {formatRelative(asset.updatedAt)}
                </time>
              </td>
            </tr>
          ))}
          {list.data.items.length === 0 ? (
            <EmptyRow colSpan={7}>
              {canRegister ? "No asset passports yet. Register an asset to start a passport." : "No asset passports are visible to your organization."}
            </EmptyRow>
          ) : null}
        </TableRegion>
      )}
    </div>
  );
}
