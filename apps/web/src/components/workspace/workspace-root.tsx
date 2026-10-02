"use client";

import type { RuntimeMode } from "@collara/domain";
import type { ReactNode } from "react";
import { AppShell } from "@/components/collara/app-shell";
import { ErrorState } from "@/components/collara/error-state";
import { LoadingState } from "@/components/collara/loading-state";
import { ModeBanner } from "@/components/collara/mode-banner";
import { CollaraClientProvider } from "@/lib/collara-client";
import { SessionProvider } from "@/lib/session";

function Frame({ mode, children }: { mode: RuntimeMode; children: ReactNode }) {
  return (
    <div data-surface="app" className="flex min-h-dvh flex-col bg-surface-page text-fg">
      <ModeBanner mode={mode} />
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-8 app:px-7">{children}</main>
    </div>
  );
}

/**
 * Client root of /app: picks the data client for the server-resolved mode, loads the viewer, then
 * renders the shell. Session failures (expired session, network) replace the whole workspace.
 */
export function WorkspaceRoot({ mode, children }: { mode: RuntimeMode; children: ReactNode }) {
  const loading = (
    <Frame mode={mode}>
      <LoadingState variant="page" label="Loading your workspace…" />
    </Frame>
  );
  return (
    <CollaraClientProvider mode={mode} fallback={loading}>
      <SessionProvider
        pending={loading}
        error={(error, retry) => (
          <Frame mode={mode}>
            <ErrorState error={error} onRetry={retry} />
          </Frame>
        )}
      >
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </CollaraClientProvider>
  );
}
