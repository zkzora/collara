// LocalNet bootstrap state (scripts/localnet/bootstrap.mjs), with the isolation prefix and the Collara
// namespace. state.json (no prefix) or state-<prefix>.json; parties are keyed by logical hint.
import { dirname, join } from "node:path";
import { defaultLocalnetStatePath, LocalnetStateSchema, readStateText } from "@collara/canton";
import { ASSET_NAMESPACE } from "@collara/domain";
import { z } from "zod";

export const LedgerStateSchema = LocalnetStateSchema.extend({
  /** Isolation prefix used by bootstrap --prefix (null/absent = the default demo namespace). */
  prefix: z.string().nullish(),
  /** Collara namespace (asset registry, config, verifier registry id). */
  namespace: z.string().min(1).optional(),
});
export type LedgerState = z.infer<typeof LedgerStateSchema>;

/** .local/localnet/state.json, or state-<prefix>.json next to it. */
export function ledgerStatePath(prefix?: string | null): string {
  const base = defaultLocalnetStatePath();
  return prefix ? join(dirname(base), `state-${prefix}.json`) : base;
}

/** Reads and validates a bootstrap state file (or `env:NAME`, see readStateText); null when it does not exist. */
export async function loadLedgerState(path: string = defaultLocalnetStatePath()): Promise<LedgerState | null> {
  const text = await readStateText(path);
  return text === null ? null : LedgerStateSchema.parse(JSON.parse(text));
}

/** The Collara namespace of a bootstrap state ("collara-localnet" or "collara-localnet-<prefix>"). */
export function namespaceOf(state: Pick<LedgerState, "namespace" | "prefix">): string {
  if (state.namespace) return state.namespace;
  return state.prefix ? `${ASSET_NAMESPACE}-${state.prefix}` : ASSET_NAMESPACE;
}

/** Party id of a logical hint ("DemoManufacturer"), or throws. */
export function partyOf(state: LedgerState, hint: string): string {
  const entry = state.parties[hint];
  if (!entry) throw new Error(`party ${hint} is not in the LocalNet state`);
  return entry.party;
}
