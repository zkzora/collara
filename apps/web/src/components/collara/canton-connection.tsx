"use client";

import { ExternalLinkIcon, LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/collara/panel";
import { useCollara } from "@/lib/collara-client";
import { useSession } from "@/lib/session";

/** The validator wallet is used for Canton onboarding, not for browser-side transaction signing. */
export const CANTON_WALLET_URL = "https://wallet.validator.hackcanton-01.devnet.naas.noders.services";

export function shortenParty(partyId: string | null): string {
  if (!partyId) return "Not connected";
  if (partyId.length <= 34) return partyId;
  return `${partyId.slice(0, 18)}…${partyId.slice(-12)}`;
}

export function connectionState(mode: "UI_MOCK" | "LOCALNET" | "DEVNET", identity: { network: string; partyId: string | null }): "mock" | "connected" | "wrong-network" | "not-connected" {
  if (mode === "UI_MOCK") return "mock";
  if (identity.network !== mode) return "wrong-network";
  return identity.partyId ? "connected" : "not-connected";
}

export function CantonConnectionPanel() {
  const { mode, ledgerSync } = useSession();
  const { clearSession } = useCollara();
  const { me } = useSession();
  const identity = me.ledgerIdentity;
  const router = useRouter();
  const state = connectionState(mode, identity);
  const connected = state === "connected";
  const networkLabel = identity.network === "DEVNET" ? "Canton DevNet" : identity.network === "LOCALNET" ? "Canton LocalNet" : "UI mockup";

  async function disconnect() {
    clearSession();
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    router.replace("/login");
  }

  return (
    <Panel title="Canton connection">
      <div className="flex flex-col gap-3 text-[13px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-fg-subtle">Network</dt>
          <dd className="text-fg">{networkLabel}</dd>
          <dt className="text-fg-subtle">Party address</dt>
          <dd className="break-all font-mono text-[12px] text-fg">{shortenParty(identity.partyId)}</dd>
          <dt className="text-fg-subtle">Participant</dt>
          <dd className="text-fg">{identity.participant ?? "—"}</dd>
          <dt className="text-fg-subtle">Ledger status</dt>
          <dd className={connected ? "text-success-strong" : "text-pending-strong"}>
            {state === "connected"
              ? ledgerSync?.offset !== null && ledgerSync?.offset !== undefined
                ? `Connected · ledger synced at offset ${ledgerSync.offset}`
                : "Connected · awaiting ledger sync"
              : state === "wrong-network"
                ? "Wrong network"
                : state === "mock"
                  ? "Mock only"
                  : "Not connected"}
          </dd>
        </dl>
        <p className="text-[12px] leading-relaxed text-fg-subtle">
          Collara uses Canton party authorization through the server. This is not an EVM/Solana wallet and no browser wallet
          signature is requested; roles and approval mandates remain server-side.
        </p>
        <div className="flex flex-wrap gap-2">
          {!connected && mode === "DEVNET" ? (
            <a href={CANTON_WALLET_URL} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-control px-3 text-[12px] text-fg hover:bg-hover">
              Open Canton Wallet onboarding <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
          {connected ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void disconnect()}>
              <LogOutIcon aria-hidden="true" />
              Disconnect
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
