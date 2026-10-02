import { AssetPassport } from "@/components/workspace/assets/asset-passport";

export default async function AssetLayout({ children, params }: LayoutProps<"/app/assets/[assetId]">) {
  const { assetId } = await params;
  return <AssetPassport assetRef={decodeURIComponent(assetId)}>{children}</AssetPassport>;
}
