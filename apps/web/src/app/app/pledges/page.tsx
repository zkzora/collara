import { PledgeFilterSchema } from "@collara/domain";
import type { Metadata } from "next";
import { PledgeList } from "@/components/workspace/pledge/pledge-list";

export const metadata: Metadata = { title: "Pledges" };

/** `/app/pledges?filter=active|release-requested|released` (S §9.14). */
export default async function PledgesPage({ searchParams }: PageProps<"/app/pledges">) {
  const { filter } = await searchParams;
  const parsed = PledgeFilterSchema.safeParse(Array.isArray(filter) ? filter[0] : filter);
  return <PledgeList filter={parsed.success ? parsed.data : undefined} />;
}
