"use client";

// Reads for Create Financing Case (S §9.3): the onboarded lender/dealer directory and the selected asset's
// passport (its server-computed `allowedActions` say whether a case may be created on it).
import type { Me } from "@collara/domain";
import { useQuery } from "@tanstack/react-query";
import { useCollara } from "@/lib/collara-client";
import { useSession } from "@/lib/session";

export function useDirectory(kind: "lenders" | "dealers") {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({
    queryKey: keys.directory(kind),
    queryFn: ({ signal }) => (kind === "lenders" ? client.directory.lenders({ signal }) : client.directory.dealers({ signal })),
    staleTime: 5 * 60_000,
  });
}

export function useSelectedAsset(assetRef: string) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.assets.detail(assetRef), queryFn: ({ signal }) => client.assets.get(assetRef, { signal }), enabled: assetRef !== "" });
}

/**
 * Whether to offer `Create case` at all: the borrower role with the borrower mandate, as resolved by the server
 * for this session. Hiding the action is not enforcement; POST /api/cases checks the owner and mandate again.
 */
export function offersCaseCreation(me: Pick<Me, "roles" | "mandates">): boolean {
  return me.roles.includes("BORROWER") && me.mandates.some((m) => m.code === "BORROWER");
}

export const NEW_CASE_PATH = "/app/cases/new";

/** `/app/cases/new?asset=ASSET-…` preselects a registered asset (from the passport's `Create case`). */
export const newCaseHref = (assetRef?: string) => (assetRef ? `${NEW_CASE_PATH}?asset=${encodeURIComponent(assetRef)}` : NEW_CASE_PATH);
