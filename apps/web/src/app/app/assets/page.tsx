import type { Metadata } from "next";
import { AssetList } from "@/components/workspace/assets/asset-list";

export const metadata: Metadata = { title: "Assets" };

export default function AssetsPage() {
  return <AssetList />;
}
