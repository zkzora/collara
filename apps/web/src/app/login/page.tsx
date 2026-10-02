import type { Metadata } from "next";
import { readRuntimeMode } from "@/lib/mode.server";
import { LoginScreen } from "./login-screen";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function LoginPage() {
  const mode = await readRuntimeMode();
  return <LoginScreen mode={mode} />;
}
