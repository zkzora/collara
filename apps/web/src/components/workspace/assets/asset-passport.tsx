"use client";

import { ASSET_TABS, STATUS_COPY, type AssetDetail } from "@collara/domain";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { buttonVariants } from "@/components/ui/button";
import { SectionNav } from "../audit/section-nav";
import { caseTabHref } from "../case/links";
import { ASSET_TAB_LABELS, accessHref, assetTabHref } from "./links";
import { useAssetDetail } from "./queries";
import { PageCommands, PageCommandStatus } from "../audit/page-command";

const AssetContext = createContext<AssetDetail | null>(null);

export function useAssetPassport(): AssetDetail {
  const value = useContext(AssetContext);
  if (!value) throw new Error("useAssetPassport must be used inside the asset passport layout.");
  return value;
}

function PassportHeader({ detail }: { detail: AssetDetail }) {
  const firstCase = detail.cases[0];
  const owner = detail.owner ? `${detail.owner.name}${detail.ownerClaimSource ? ` (${detail.ownerClaimSource.toLowerCase()})` : ""}` : null;
  return (
    <PageHeader
      recordId={detail.ref}
      title={detail.equipmentClass || "Asset passport"}
      status={detail.lifecycle}
      description={[
        detail.model,
        detail.serialNumber ? `Serial ${detail.serialNumber}` : null,
        owner ? `Owner claim: ${owner}` : null,
        `Passport version v${detail.passportVersion}`,
      ]
        .filter(Boolean)
        .join(" · ")}
      actions={
        firstCase ? (
          <>
            <Link href={caseTabHref(firstCase.caseId, "summary")} className={buttonVariants({ variant: "outline" })}>
              Open case {firstCase.caseId}
            </Link>
            <Link href={accessHref(firstCase.caseId)} className={buttonVariants({ variant: "outline" })}>
              Review sharing <ArrowRightIcon aria-hidden="true" />
            </Link>
          </>
        ) : null
      }
    />
  );
}

/**
 * Asset Passport frame (S §9.6): header, the ownership note, and route tabs filtered by the
 * server's `allowedTabs`. Tab pages read the passport from context.
 */
export function AssetPassport({ assetRef, children }: { assetRef: string; children: ReactNode }) {
  const query = useAssetDetail(assetRef);
  const segment = useSelectedLayoutSegment();

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        action={
          <Link href="/app/assets" className={buttonVariants({ variant: "outline" })}>
            Back to assets
          </Link>
        }
      />
    );
  }
  if (query.isPending) return <LoadingState variant="page" label={`Loading passport ${assetRef}…`} />;

  const detail = query.data;
  return (
    <AssetContext value={detail}>
      <PageCommands>
        <div className="flex flex-col gap-[18px]">
          <PassportHeader detail={detail} />
          <PageCommandStatus />
          <p className="flex gap-3 rounded-md border border-highlight/30 bg-highlight/5 px-3.5 py-3 text-[13px] leading-relaxed text-fg-muted">
            <span className="font-mono text-[11px] tracking-[.07em] text-highlight-strong uppercase">Note</span>
            <span>
              {detail.attestation
                ? "Ownership and lien status were reviewed from submitted documents by the verifier. This is not a legal title or lien check."
                : STATUS_COPY.REGISTER_ASSET_WARNING}
            </span>
          </p>
          <SectionNav
            label="Passport sections"
            items={ASSET_TABS.filter((tab) => detail.allowedTabs.includes(tab)).map((tab) => ({
              href: assetTabHref(detail.ref, tab),
              label: ASSET_TAB_LABELS[tab],
              active: segment === tab,
            }))}
          />
          <div aria-busy={query.isFetching}>{children}</div>
        </div>
      </PageCommands>
    </AssetContext>
  );
}
