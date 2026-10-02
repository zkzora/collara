import { redirect } from "next/navigation";

/** `/app/assets/ASSET-DEMO-001` opens the Overview section (one canonical URL per section). */
export default async function AssetIndexPage({ params }: PageProps<"/app/assets/[assetId]">) {
  const { assetId } = await params;
  redirect(`/app/assets/${assetId}/overview`);
}
