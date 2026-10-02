import type { Metadata } from "next";
import { VerificationWorkspace } from "@/components/workspace/verification/verification-workspace";

export async function generateMetadata({ params }: PageProps<"/app/verifications/[verificationId]">): Promise<Metadata> {
  const { verificationId } = await params;
  return { title: decodeURIComponent(verificationId) };
}

export default async function VerificationPage({ params }: PageProps<"/app/verifications/[verificationId]">) {
  const { verificationId } = await params;
  return <VerificationWorkspace verificationRef={decodeURIComponent(verificationId)} />;
}
