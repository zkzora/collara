import type { Metadata } from "next";
import { VerificationQueue } from "@/components/workspace/verification/verification-queue";

export const metadata: Metadata = { title: "Verifications" };

export default function VerificationsPage() {
  return <VerificationQueue />;
}
