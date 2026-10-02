import type { Metadata } from "next";
import { PledgeDetail } from "@/components/workspace/pledge/pledge-detail";

export async function generateMetadata({ params }: PageProps<"/app/pledges/[pledgeId]">): Promise<Metadata> {
  const { pledgeId } = await params;
  return { title: decodeURIComponent(pledgeId) };
}

export default async function PledgePage({ params }: PageProps<"/app/pledges/[pledgeId]">) {
  const { pledgeId } = await params;
  return <PledgeDetail pledgeRef={decodeURIComponent(pledgeId)} />;
}
