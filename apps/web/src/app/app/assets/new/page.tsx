import type { Metadata } from "next";
import { RegisterAssetForm } from "@/components/workspace/assets/register-asset-form";

export const metadata: Metadata = { title: "Register asset" };

export default function RegisterAssetPage() {
  return <RegisterAssetForm />;
}
