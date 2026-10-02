"use client";

import { useQuery } from "@tanstack/react-query";
import { useCollara } from "@/lib/collara-client";
import { useSession } from "@/lib/session";

export function useVerification(ref: string) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.verifications.detail(ref), queryFn: ({ signal }) => client.verifications.get(ref, { signal }) });
}

/** Verifier registry (governance-administered). Used to pick an active verifier for a request. */
export function useVerifiers({ enabled = true }: { enabled?: boolean } = {}) {
  const { client } = useCollara();
  const { keys } = useSession();
  return useQuery({ queryKey: keys.verifiers(), queryFn: ({ signal }) => client.verifiers.list({ signal }), enabled });
}
