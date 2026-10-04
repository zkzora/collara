// DEVNET party bindings: the owner creates the eleven Collara parties in the DevNet Console (names get a fixed tenant
// prefix, e.g. "c2ede6f6-DemoLenderA::1220…"); this matches them, by the exact LocalNet hints, against the parties
// the tenant ledger user holds rights for, and builds .local/devnet/state.json. Nothing is allocated here: the JSON
// Ledger API of the shared node does not allocate parties for tenants.
import type { LedgerRight } from "@collara/canton";
import type { LedgerState } from "../ledger/state";

/** The hints of scripts/localnet/localnet.config.json (daml-model.md §2), with their Collara role. */
export const COLLARA_PARTIES = [
  { hint: "CollaraRegistrar", role: "registry operator: issues asset control, publishes the config and the verifier status mirror" },
  { hint: "CollaraGovernance", role: "governance party: signs GovernanceRules, the verifier registry and accreditations (Tier A)" },
  { hint: "DemoManufacturer", role: "borrower and asset owner (Demo Manufacturer)" },
  { hint: "DemoCNCDealer", role: "dealer contributor (Demo CNC Dealer)" },
  { hint: "DemoVerifier", role: "verifier VER-001 (Demo Verifier)" },
  { hint: "DemoLenderA", role: "selected lender (Demo Lender A)" },
  { hint: "DemoLenderB", role: "unrelated lender (Demo Lender B)" },
  { hint: "DemoAuditor", role: "auditor (Demo Auditor)" },
  { hint: "GovSeat1", role: "governance seat 1 (Demo Lender A's mandate)" },
  { hint: "GovSeat2", role: "governance seat 2 (Demo Lender B's mandate)" },
  { hint: "GovSeat3", role: "governance seat 3 (Demo Auditor's mandate)" },
] as const;
export type CollaraPartyHint = (typeof COLLARA_PARTIES)[number]["hint"];

/** The ledger source name of the shared participant in state.json, ledger_sources and party_bindings. */
export const DEVNET_SOURCE = "devnet";

export interface TenantRights {
  readonly actAs: readonly string[];
  readonly readAs: readonly string[];
}

/** CanActAs / CanReadAs parties of a ledger user's rights (other rights are ignored). */
export function rightsToParties(rights: readonly LedgerRight[]): TenantRights {
  const actAs = new Set<string>();
  const readAs = new Set<string>();
  for (const right of rights) {
    const kind = right.kind as Record<string, { value?: { party?: string } } | undefined>;
    const act = kind.CanActAs?.value?.party;
    const read = kind.CanReadAs?.value?.party;
    if (act) actAs.add(act);
    if (read) readAs.add(read);
  }
  return { actAs: [...actAs].sort(), readAs: [...readAs].sort() };
}

/** The identifier of a party id ("c2ede6f6-DemoLenderA" in "c2ede6f6-DemoLenderA::1220…"). */
export function partyIdentifier(partyId: string): string {
  const index = partyId.indexOf("::");
  return index === -1 ? partyId : partyId.slice(0, index);
}

/** True when a party's identifier is the hint itself or "<tenant prefix>-<hint>" (case-sensitive, exact). */
export function matchesHint(partyId: string, hint: string): boolean {
  const id = partyIdentifier(partyId);
  return id === hint || id.endsWith(`-${hint}`);
}

export interface PartyMatch {
  readonly matched: Partial<Record<CollaraPartyHint, string>>;
  /** Hints with no party among the tenant's rights. */
  readonly missing: CollaraPartyHint[];
  /** Hints with more than one candidate party. */
  readonly ambiguous: { hint: CollaraPartyHint; candidates: string[] }[];
  /** Matched parties the tenant can read but not act as (every Collara party needs CanActAs). */
  readonly readOnly: { hint: CollaraPartyHint; party: string }[];
  /** Case-insensitive near misses for missing hints (to spot a typo in the Console name). */
  readonly nearMisses: { hint: CollaraPartyHint; party: string }[];
}

/** Matches the tenant's parties (CanActAs ∪ CanReadAs) to the eleven Collara hints. */
export function matchParties(rights: TenantRights): PartyMatch {
  const candidates = [...new Set([...rights.actAs, ...rights.readAs])];
  const matched: Partial<Record<CollaraPartyHint, string>> = {};
  const missing: CollaraPartyHint[] = [];
  const ambiguous: PartyMatch["ambiguous"] = [];
  const readOnly: PartyMatch["readOnly"] = [];
  const nearMisses: PartyMatch["nearMisses"] = [];
  for (const { hint } of COLLARA_PARTIES) {
    const hits = candidates.filter((party) => matchesHint(party, hint));
    if (hits.length === 0) {
      missing.push(hint);
      for (const party of candidates) {
        const id = partyIdentifier(party).toLowerCase();
        if (id === hint.toLowerCase() || id.endsWith(`-${hint.toLowerCase()}`)) nearMisses.push({ hint, party });
      }
    } else if (hits.length > 1) {
      ambiguous.push({ hint, candidates: hits.sort() });
    } else {
      const party = hits[0] as string;
      matched[hint] = party;
      if (!rights.actAs.includes(party)) readOnly.push({ hint, party });
    }
  }
  // One party may not serve two hints (e.g. a Console name that ends in two hints).
  const used = new Map<string, CollaraPartyHint[]>();
  for (const [hint, party] of Object.entries(matched) as [CollaraPartyHint, string][]) used.set(party, [...(used.get(party) ?? []), hint]);
  for (const [party, hints] of used) {
    if (hints.length > 1) for (const hint of hints) ambiguous.push({ hint, candidates: [party] });
  }
  return { matched, missing, ambiguous, readOnly, nearMisses };
}

/** Exact, operator-facing refusal text, or null when every hint has exactly one party with CanActAs. */
export function matchProblems(match: PartyMatch): string | null {
  const lines: string[] = [];
  for (const hint of match.missing) {
    const role = COLLARA_PARTIES.find((p) => p.hint === hint)?.role ?? "";
    lines.push(`missing: ${hint} (${role}): create a party named exactly "${hint}" in the Console and make sure the tenant user has CanActAs on it`);
  }
  for (const near of match.nearMisses) lines.push(`  near miss for ${near.hint}: ${near.party} (names are case-sensitive)`);
  for (const a of match.ambiguous) lines.push(`ambiguous: ${a.hint} matches ${a.candidates.join(", ")}`);
  for (const r of match.readOnly) lines.push(`read-only: ${r.hint} = ${r.party}: the tenant user has CanReadAs but not CanActAs on it`);
  return lines.length ? lines.join("\n") : null;
}

export interface DevnetStateInput {
  readonly ledgerUserId: string;
  readonly primaryParty?: string | undefined;
  readonly jsonApiUrl: string;
  readonly participantId: string;
  readonly ledgerEnd: number;
  readonly cantonVersion: string;
  readonly audience: string;
  readonly parties: Record<CollaraPartyHint, string>;
  readonly packages: LedgerState["packages"];
  readonly namespace: string;
  readonly now?: Date;
}

/**
 * .local/devnet/state.json: one participant source ("devnet"), the eleven parties, and ONE tenant user whose
 * actAs/readAs are exactly the bound Collara parties (never the tenant's other parties, never "any party").
 */
export function buildDevnetState(input: DevnetStateInput): LedgerState {
  const parties = Object.fromEntries(
    COLLARA_PARTIES.map(({ hint }) => [hint, { party: input.parties[hint], participant: DEVNET_SOURCE, user: input.ledgerUserId }]),
  );
  const bound = COLLARA_PARTIES.map(({ hint }) => input.parties[hint]);
  return {
    version: 1,
    bootstrappedAt: (input.now ?? new Date()).toISOString(),
    topology: "devnet-shared-participant",
    cantonVersion: input.cantonVersion,
    audience: input.audience,
    jsonApiUrl: input.jsonApiUrl,
    participantId: input.participantId,
    participants: { [DEVNET_SOURCE]: { jsonApiUrl: input.jsonApiUrl, participantId: input.participantId, ledgerEndAtBootstrap: input.ledgerEnd } },
    parties,
    users: [
      {
        id: input.ledgerUserId,
        participant: DEVNET_SOURCE,
        role: "tenant",
        ...(input.primaryParty ? { primaryParty: input.primaryParty } : {}),
        actAs: bound,
        readAs: bound,
      },
    ],
    packages: input.packages,
    prefix: null,
    namespace: input.namespace,
  };
}

/** Run namespace: collara-devnet-<runRef> (lower-case letters, digits, dashes). */
export function devnetNamespace(runRef: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(runRef)) throw new Error("--run-ref: 1-31 lower-case letters, digits or '-'");
  return `collara-devnet-${runRef}`;
}
