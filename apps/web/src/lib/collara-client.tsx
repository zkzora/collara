"use client";

// Chooses the data path for the workspace (ADR-0001 §2.2): LOCALNET talks to same-origin /api over
// HTTP; UI_MOCK code-splits the in-memory mock client so it never ships in LOCALNET bundles.
import { createHttpClient, type CollaraClient } from "@collara/api-client";
import type { MockCollaraClient } from "@collara/api-client/mock";
import { DEFAULT_PERSONA_ID, PersonaIdSchema, type PersonaId, type RuntimeMode } from "@collara/domain";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const PERSONA_STORAGE_KEY = "collara.demoPersona";

/** The demo persona chosen in this tab (UI_MOCK). Storage can be unavailable; never required. */
export function readStoredPersona(): PersonaId | null {
  try {
    const parsed = PersonaIdSchema.safeParse(window.sessionStorage.getItem(PERSONA_STORAGE_KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function storePersona(personaId: PersonaId | null): void {
  try {
    if (personaId) window.sessionStorage.setItem(PERSONA_STORAGE_KEY, personaId);
    else window.sessionStorage.removeItem(PERSONA_STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the persona then lasts until the tab reloads.
  }
}

// One mock world per browser tab, shared by /login and /app so client-side navigation keeps the
// simulated state. Created only in the browser (inside an effect), never during SSR.
let mockClientPromise: Promise<MockCollaraClient> | null = null;
function loadMockClient(): Promise<MockCollaraClient> {
  mockClientPromise ??= import("@collara/api-client/mock").then(({ createMockClient }) =>
    createMockClient({ personaId: readStoredPersona() ?? DEFAULT_PERSONA_ID }),
  );
  return mockClientPromise;
}

export interface CollaraContextValue {
  readonly mode: RuntimeMode;
  readonly client: CollaraClient;
  /** The in-memory client in UI_MOCK; null in LOCALNET. */
  readonly mock: MockCollaraClient | null;
  /** Bumped on every persona switch or sign-out; part of the `me` query key. */
  readonly sessionEpoch: number;
  /** Switches the demo persona (UI_MOCK) or creates an isolated demo session (LOCALNET), then clears every cached query. */
  switchPersona(personaId: PersonaId): Promise<void>;
  /** Drops all cached data for the current session (call before leaving the workspace). */
  clearSession(): void;
}

const CollaraContext = createContext<CollaraContextValue | null>(null);

export function CollaraClientProvider({
  mode,
  children,
  fallback = null,
  client: injected,
}: {
  mode: RuntimeMode;
  children: ReactNode;
  /** Rendered while the UI_MOCK client loads. */
  fallback?: ReactNode;
  /** Tests inject a client instead of the default for the mode. */
  client?: CollaraClient;
}) {
  const queryClient = useQueryClient();
  const [httpClient] = useState(() => (mode === "LOCALNET" && !injected ? createHttpClient() : null));
  const [loadedMock, setLoadedMock] = useState<MockCollaraClient | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);

  useEffect(() => {
    if (mode !== "UI_MOCK" || injected) return;
    let cancelled = false;
    void loadMockClient().then((mock) => {
      if (!cancelled) setLoadedMock(mock);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, injected]);

  const client: CollaraClient | null = injected ?? httpClient ?? loadedMock;
  const mock = client?.kind === "mock" ? (client as MockCollaraClient) : null;

  const clearSession = useCallback(() => {
    queryClient.clear();
    setSessionEpoch((epoch) => epoch + 1);
  }, [queryClient]);

  const switchPersona = useCallback(
    async (personaId: PersonaId) => {
      if (!client) return;
      await client.demo.createSession({ personaId });
      if (mode === "UI_MOCK") storePersona(personaId);
      clearSession();
    },
    [client, mode, clearSession],
  );

  const value = useMemo<CollaraContextValue | null>(
    () => (client ? { mode, client, mock, sessionEpoch, switchPersona, clearSession } : null),
    [mode, client, mock, sessionEpoch, switchPersona, clearSession],
  );

  if (!value) return <>{fallback}</>;
  return <CollaraContext value={value}>{children}</CollaraContext>;
}

export function useCollara(): CollaraContextValue {
  const value = useContext(CollaraContext);
  if (!value) throw new Error("useCollara must be used inside CollaraClientProvider.");
  return value;
}
