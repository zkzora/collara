// Pure Tier A governance rules, mirroring DM GovernanceRules semantics (research-dm.md §3.2–§3.4, §7.4) so the API
// never submits an execute that the ledger would abort, and answers with the approved/INFERRED copy instead:
//   - executable confirmations = the newest unexpired confirmation per CURRENT member (DM
//     `dedupe_newest_per_party` + `counts_toward_threshold`); duplicates and expired ones abort an execute;
//   - a governed proposal is stale when its deadline passed or the registry it pinned moved (Collara executeImpl);
//   - display refs GP-001, GP-002, … number the seat proposals of one governance party in creation order (the
//     read model numbers them the same way, packages/db/src/read-model/governance.ts).
// Governance administers the verifier registry only; nothing here can touch collateral (CR-22).
import { formatRef } from "@collara/domain";

/** INFERRED copy (needs approval); the first four mirror the UI_MOCK client (packages/api-client/src/mock/client.ts). */
export const GOVERNANCE_COPY = {
  CANNOT_CONFIRM: "This proposal cannot be confirmed by your seat in its current state.",
  CANNOT_SUSPEND: "This verifier cannot be suspended in its current state.",
  ONLY_OPEN_WITHDRAWN: "Only an open proposal can be withdrawn.",
  needsConfirmations: (threshold: number) => `Execution needs ${threshold} live confirmations from distinct seats.`,
  CANNOT_ADD: "This verifier cannot be added in its current state.",
  ORG_NOT_ONBOARDED: "No onboarded verifier organization has this name.",
} as const;

/** Proposal deadline for new governed proposals (the UI_MOCK registry uses 14 days). */
export const PROPOSAL_DEADLINE_DAYS = 14;
/** Accreditation validity for an added verifier (the genesis verifier uses one year). */
export const ACCREDITATION_VALID_DAYS = 365;
/** The only equipment scope Collara verifies (CNC-only, CON C1). Issuance checks it on-ledger. */
export const LEDGER_SCOPE = "CNC_MACHINERY";
/**
 * A confirmation must outlive the execute transaction (`GovernanceConfirmation_Consume` requires
 * now < expiresAt at commit), so one that expires within this margin is not sent.
 */
export const CONFIRMATION_EXPIRY_MARGIN_MS = 10_000;

export interface ConfirmationLike {
  readonly contractId: string;
  readonly confirmer: string;
  readonly actionProposalCid: string;
  readonly expiresAt: string;
  /** Creation offset (newest wins). */
  readonly offset: number;
}

/**
 * The confirmations to send with GovernanceRules_ExecuteConfirmedAction: the newest unexpired confirmation per
 * current member for this proposal. A seat that confirmed twice counts once.
 */
export function executableConfirmations<C extends ConfirmationLike>(
  confirmations: readonly C[],
  input: { readonly proposalCid: string; readonly members: readonly string[]; readonly now: Date; readonly marginMs?: number },
): C[] {
  const cutoff = input.now.getTime() + (input.marginMs ?? CONFIRMATION_EXPIRY_MARGIN_MS);
  const members = new Set(input.members);
  const newest = new Map<string, C>();
  for (const c of confirmations) {
    if (c.actionProposalCid !== input.proposalCid || !members.has(c.confirmer) || Date.parse(c.expiresAt) <= cutoff) continue;
    const prev = newest.get(c.confirmer);
    if (!prev || c.offset > prev.offset) newest.set(c.confirmer, c);
  }
  return [...newest.values()].sort((a, b) => a.offset - b.offset);
}

export type Staleness = "DEADLINE_PASSED" | "REGISTRY_MOVED" | null;

/** Why a governed proposal can no longer execute (null: still current). */
export function proposalStaleness(
  proposal: { readonly registryCid: string; readonly expectedVersion: number; readonly proposalDeadline: string },
  registry: { readonly contractId: string; readonly version: number } | null,
  now: Date,
): Staleness {
  if (now.getTime() > Date.parse(proposal.proposalDeadline)) return "DEADLINE_PASSED";
  if (!registry || registry.contractId !== proposal.registryCid || registry.version !== proposal.expectedVersion) return "REGISTRY_MOVED";
  return null;
}

/** GP-001 for the first seat proposal (the governed bootstrap is GP-000 and is not numbered here). */
export function governanceProposalRef(index: number): string {
  return formatRef("governanceProposal", index + 1);
}

/** Ledger scope list for an Add: always the CNC scope (checked at issuance), plus the requested description. */
export function ledgerScopeOf(requested: string): string[] {
  const text = requested.trim();
  return text === "" || text === LEDGER_SCOPE ? [LEDGER_SCOPE] : [LEDGER_SCOPE, text];
}
