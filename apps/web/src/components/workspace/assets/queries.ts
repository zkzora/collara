"use client";

// Asset passport reads (S §9.4–9.6). Keys come from the session scope, like every workspace query.
import type { AssetDetail, Attestation, VerificationRequest } from "@collara/domain";
import { useQuery } from "@tanstack/react-query";
import { useCollara } from "@/lib/collara-client";
import { LIST_LIMIT, useAttestation, useCaseDetail, useVerificationList } from "@/lib/queries";
import { useSession } from "@/lib/session";

interface Opt {
  readonly enabled?: boolean;
}

export function useAssetList({ enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  const query = { limit: LIST_LIMIT };
  return useQuery({ queryKey: keys.assets.list(query), queryFn: ({ signal }) => client.assets.list(query, { signal }), enabled });
}

export function useAssetDetail(assetRef: string) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.assets.detail(assetRef), queryFn: ({ signal }) => client.assets.get(assetRef, { signal }) });
}

export function useAssetEvidence(assetRef: string, { enabled = true }: Opt = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({
    queryKey: keys.assets.evidence(assetRef),
    queryFn: ({ signal }) => client.assets.evidence(assetRef, { signal }),
    enabled,
  });
}

export interface AssetAttestation {
  readonly attestation: Attestation | null;
  /** Verification requests for this asset the viewer may see (owner and assigned verifier only). */
  readonly requests: readonly VerificationRequest[];
  readonly isPending: boolean;
  readonly error: unknown;
  refetch(): void;
}

/**
 * The asset's current attestation as disclosed to this viewer. Owners and verifiers read it from
 * their verification requests; lenders and auditors only through a case that discloses it.
 */
export function useAssetAttestation(detail: AssetDetail): AssetAttestation {
  const { me } = useSession();
  const seesRequests = me.roles.includes("BORROWER") || me.roles.includes("VERIFIER");
  const list = useVerificationList({ enabled: seesRequests && detail.allowedTabs.includes("verification") });
  const requests = (list.data?.items ?? []).filter((vr) => vr.assetRef === detail.ref);
  const fromRequest = requests.map((vr) => vr.attestation).find((a) => a && a.validity.value !== "SUPERSEDED") ?? null;

  const caseId = !seesRequests && detail.attestation ? (detail.cases[0]?.caseId ?? "") : "";
  const caseDetail = useCaseDetail(caseId, { enabled: !!caseId });
  const viaCase = useAttestation(caseDetail.data?.references.attestation?.ref);

  if (seesRequests) {
    return { attestation: fromRequest, requests, isPending: list.isPending && list.fetchStatus !== "idle", error: list.error, refetch: () => void list.refetch() };
  }
  return {
    attestation: viaCase.data ?? null,
    requests: [],
    isPending: (!!caseId && caseDetail.isPending) || (viaCase.isPending && viaCase.fetchStatus !== "idle"),
    error: caseDetail.error ?? viaCase.error,
    refetch: () => {
      void caseDetail.refetch();
      void viaCase.refetch();
    },
  };
}
