import { AssetRefSchema } from "@collara/domain";
import type { Metadata } from "next";
import { CreateCaseForm } from "@/components/workspace/cases/create-case-form";

export const metadata: Metadata = { title: "Create case" };

/** `/app/cases/new` (S §9.3); `?asset=ASSET-…` preselects one of the borrower's registered assets. */
export default async function CreateCasePage({ searchParams }: PageProps<"/app/cases/new">) {
  const { asset } = await searchParams;
  const parsed = AssetRefSchema.safeParse(Array.isArray(asset) ? asset[0] : asset);
  return <CreateCaseForm initialAssetRef={parsed.success ? parsed.data : undefined} />;
}
