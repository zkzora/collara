"use client";

// The signed-in viewer (GET /api/me or the mock persona) and the query-key scope derived from it.
// Every workspace query key starts with this scope so cached data never crosses users,
// organizations or demo personas (ADR-0001 §2.9).
import { createQueryKeys, sessionScope, type QueryKeys } from "@collara/api-client";
import type { Me, RuntimeMode } from "@collara/domain";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCollara } from "./collara-client";

export interface LedgerSync {
  readonly offset: number | null;
  readonly at: string | null;
}

export interface SessionValue {
  readonly me: Me;
  readonly mode: RuntimeMode;
  readonly scope: string;
  readonly keys: QueryKeys;
  /** Latest projection checkpoint reported by a page (e.g. CaseDetail.lastSync); null until one is seen. */
  readonly ledgerSync: LedgerSync | null;
  reportLedgerSync(sync: LedgerSync): void;
}

const SessionContext = createContext<SessionValue | null>(null);

/** The `me` key is not scoped (it defines the scope); the epoch changes on every persona switch. */
export function meQueryKey(mode: RuntimeMode, epoch: number) {
  return ["session", mode, epoch, "me"] as const;
}

export function useMeQuery() {
  const { client, mode, sessionEpoch } = useCollara();
  return useQuery({
    queryKey: meQueryKey(mode, sessionEpoch),
    queryFn: ({ signal }) => client.me({ signal }),
    staleTime: 60_000,
  });
}

export function scopeFor(me: Me): string {
  return me.personaId && me.mode === "UI_MOCK"
    ? sessionScope({ personaId: me.personaId })
    : sessionScope({ userId: me.user.id, orgId: me.org.id });
}

export function SessionProvider({
  children,
  pending,
  error,
}: {
  children: ReactNode;
  pending: ReactNode;
  error: (error: unknown, retry: () => void) => ReactNode;
}) {
  const { mode } = useCollara();
  const meQuery = useMeQuery();
  const me = meQuery.data;
  const scope = me ? scopeFor(me) : null;
  // Keyed by scope: a new viewer starts without a sync reading of its own.
  const [syncState, setSyncState] = useState<{ scope: string; sync: LedgerSync } | null>(null);
  const ledgerSync = syncState && syncState.scope === scope ? syncState.sync : null;

  const reportLedgerSync = useCallback(
    (sync: LedgerSync) => {
      if (!scope) return;
      setSyncState((current) =>
        current && current.scope === scope && current.sync.offset === sync.offset && current.sync.at === sync.at ? current : { scope, sync },
      );
    },
    [scope],
  );

  const value = useMemo<SessionValue | null>(
    () => (me && scope ? { me, mode, scope, keys: createQueryKeys(scope), ledgerSync, reportLedgerSync } : null),
    [me, mode, scope, ledgerSync, reportLedgerSync],
  );

  if (meQuery.isError) return <>{error(meQuery.error, () => void meQuery.refetch())}</>;
  if (!value) return <>{pending}</>;
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}

/** Pages that read a projection checkpoint report it so the header can show the last sync. */
export function useReportLedgerSync(sync: LedgerSync | null | undefined): void {
  const { reportLedgerSync } = useSession();
  const offset = sync?.offset ?? null;
  const at = sync?.at ?? null;
  useEffect(() => {
    if (sync) reportLedgerSync({ offset, at });
  }, [sync, offset, at, reportLedgerSync]);
}
