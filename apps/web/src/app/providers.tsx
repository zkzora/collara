"use client";

import { isApiError } from "@collara/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";

/** Client errors (401/403/404/409/…) are answers, not glitches: retrying them only delays the error state. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

/**
 * Client-side providers shared by every route. One QueryClient per browser session
 * (never at module scope). Workspace query keys are prefixed with the session scope
 * (lib/session) and `queryClient.clear()` runs on sign-out or persona switch
 * (lib/collara-client, ADR-0001 §2.9).
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Rendered only when NODE_ENV is "development"; excluded from production bundles. */}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
