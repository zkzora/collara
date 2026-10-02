import type { Metadata } from "next";
import { WorkspaceRoot } from "@/components/workspace/workspace-root";
import { readRuntimeMode } from "@/lib/mode.server";

export const metadata: Metadata = {
  title: { default: "Workspace", template: "%s · Collara" },
  robots: { index: false, follow: false },
};

/** Workspace root: the runtime mode is read per request on the server and handed to the client. */
export default async function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  const mode = await readRuntimeMode();
  return <WorkspaceRoot mode={mode}>{children}</WorkspaceRoot>;
}
