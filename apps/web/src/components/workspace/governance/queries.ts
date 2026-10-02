"use client";

import { useQuery } from "@tanstack/react-query";
import { useCollara } from "@/lib/collara-client";
import { useSession } from "@/lib/session";

export function useGovernanceProposal(ref: string) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.governance.proposal(ref), queryFn: ({ signal }) => client.governance.proposal(ref, { signal }) });
}
