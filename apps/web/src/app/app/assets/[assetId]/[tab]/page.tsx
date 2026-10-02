import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ASSET_TAB_LABELS, isAssetTab } from "@/components/workspace/assets/links";
import { AssetTabPanel } from "@/components/workspace/assets/asset-tabs";

export async function generateMetadata({ params }: PageProps<"/app/assets/[assetId]/[tab]">): Promise<Metadata> {
  const { assetId, tab } = await params;
  const ref = decodeURIComponent(assetId);
  return { title: isAssetTab(tab) ? `${ref} · ${ASSET_TAB_LABELS[tab]}` : ref };
}

/** Passport sections: overview | evidence | verification | cases | activity. */
export default async function AssetTabPage({ params }: PageProps<"/app/assets/[assetId]/[tab]">) {
  const { tab } = await params;
  if (!isAssetTab(tab)) notFound();
  return <AssetTabPanel tab={tab} />;
}
