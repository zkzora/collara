import { ASSET_TABS, type AssetTab } from "@collara/domain";
import { assetHref } from "../case/links";

// Plain module (no "use client") so server pages can validate the tab segment and build titles.

export const ASSET_TAB_LABELS: Readonly<Record<AssetTab, string>> = {
  overview: "Overview",
  evidence: "Evidence",
  verification: "Verification",
  cases: "Cases",
  activity: "Activity",
};

export function isAssetTab(value: string): value is AssetTab {
  return (ASSET_TABS as readonly string[]).includes(value);
}

/** /app/assets/ASSET-DEMO-001/evidence */
export const assetTabHref = (assetRef: string, tab: AssetTab) => `${assetHref(assetRef)}/${tab}`;

/** `/app/access?caseId=…`: sharing and access grants across cases, optionally for one case. */
export const accessHref = (caseId?: string) => (caseId ? `/app/access?caseId=${encodeURIComponent(caseId)}` : "/app/access");

export const verificationHref = (ref: string) => `/app/verifications/${encodeURIComponent(ref)}`;
