// Authoritative governance reads for the write path: the active governance contracts as the acting seat sees
// them right now (seat party + readAs the Tier A governance party), and the creation history of the governed
// proposals, which gives the stable display refs (GP-001…) without waiting for the projection.
import type { LedgerClient } from "@collara/canton";
import type { AcsContract, AcsReader } from "../../ledger/acs";
import { AddVerifierProposalSchema, SuspendVerifierProposalSchema, type Payload } from "../../ledger/contracts";
import { TEMPLATES } from "../../ledger/templates";
import { workflowProblems } from "../problems";
import { governanceProposalRef, proposalStaleness } from "./rules";

export type GovernedTemplate = "AddVerifierProposal" | "SuspendVerifierProposal";

export type GovernedPayload =
  | { readonly type: "ADD_VERIFIER"; readonly payload: Payload<"AddVerifierProposal"> }
  | { readonly type: "SUSPEND_VERIFIER"; readonly payload: Payload<"SuspendVerifierProposal"> };

/** An active governed proposal (Add / Suspend) of this governance party. */
export interface ActiveProposal {
  readonly contractId: string;
  readonly offset: number;
  readonly proposal: GovernedPayload;
}

export interface GovernanceLedger {
  readonly governanceParty: string;
  readonly rules: AcsContract<Payload<"GovernanceRules">>;
  readonly members: readonly string[];
  readonly threshold: number;
  /** The live verifier registry of this namespace (null before the governed bootstrap executed). */
  readonly registry: AcsContract<Payload<"VerifierRegistry">> | null;
  /** Active accreditations of this registry (ACTIVE and SUSPENDED), oldest first. */
  readonly accreditations: readonly AcsContract<Payload<"VerifierAccreditation">>[];
  readonly proposals: readonly ActiveProposal[];
  readonly confirmations: readonly AcsContract<Payload<"GovernanceConfirmation">>[];
}

/** Fresh ACS reads as the seat. Throws 409 when the governance rules are not on the ledger. */
export async function readGovernanceLedger(acs: AcsReader, input: { governanceParty: string; namespace: string }): Promise<GovernanceLedger> {
  const gp = input.governanceParty;
  const [rules, registries, accreditations, adds, suspends, confirmations] = await Promise.all([
    acs.one("GovernanceRules", (r) => r.governanceParty === gp),
    acs.list("VerifierRegistry", (r) => r.governanceParty === gp && r.registryId === input.namespace),
    acs.list("VerifierAccreditation", (a) => a.governanceParty === gp && a.registryId === input.namespace),
    acs.list("AddVerifierProposal", (p) => p.governanceParty === gp),
    acs.list("SuspendVerifierProposal", (p) => p.governanceParty === gp),
    acs.list("GovernanceConfirmation", (c) => c.governanceParty === gp),
  ]);
  if (!rules) throw workflowProblems.stateChanged();
  if (registries.length > 1) throw workflowProblems.stateChanged();
  const proposals: ActiveProposal[] = [
    ...adds.map((c) => ({ contractId: c.contractId, offset: c.offset, proposal: { type: "ADD_VERIFIER" as const, payload: c.payload } })),
    ...suspends.map((c) => ({ contractId: c.contractId, offset: c.offset, proposal: { type: "SUSPEND_VERIFIER" as const, payload: c.payload } })),
  ].sort((a, b) => a.offset - b.offset);
  return {
    governanceParty: gp,
    rules,
    members: rules.payload.members,
    threshold: rules.payload.threshold,
    registry: registries[0] ?? null,
    accreditations,
    proposals,
    confirmations,
  };
}

/** Active proposals that can still execute (deadline not passed, registry not moved). */
export function openProposals(gov: GovernanceLedger, now: Date): ActiveProposal[] {
  const registry = gov.registry ? { contractId: gov.registry.contractId, version: gov.registry.payload.version } : null;
  return gov.proposals.filter((p) => proposalStaleness(p.proposal.payload, registry, now) === null);
}

/** One governed proposal ever created for the governance party by a member seat, with its display ref. */
export interface ProposalHistoryEntry {
  readonly ref: string;
  readonly contractId: string;
  readonly offset: number;
  readonly proposal: GovernedPayload;
}

const GOVERNED_TEMPLATE_IDS = [TEMPLATES.AddVerifierProposal, TEMPLATES.SuspendVerifierProposal];

/**
 * Every Add/Suspend proposal created for `governanceParty` by one of `members`, in ledger order, numbered
 * GP-001, GP-002, … (the read model uses the same order and filter). Reads the update stream as the governance
 * party (the seat user holds readAs on it) up to `endInclusive` (default: the current ledger end).
 */
export async function governedProposalHistory(
  client: LedgerClient,
  input: { governanceParty: string; members: readonly string[]; endInclusive?: number },
): Promise<ProposalHistoryEntry[]> {
  const members = new Set(input.members);
  const end = input.endInclusive ?? (await client.ledgerEnd());
  const found: { contractId: string; offset: number; nodeId: number; proposal: GovernedPayload }[] = [];
  let begin = 0;
  for (let pages = 0; pages < 10_000; pages++) {
    const page = await client.updates({ parties: [input.governanceParty], templateIds: GOVERNED_TEMPLATE_IDS, beginExclusive: begin, endInclusive: end, shape: "ACS_DELTA", limit: 500 });
    for (const update of page.updates) {
      if (update.kind !== "transaction") continue;
      for (const event of update.transaction.events) {
        if (event.kind !== "created") continue;
        const proposal = governedPayloadOf(event.templateRef, event.createArgument);
        if (!proposal || proposal.payload.governanceParty !== input.governanceParty || !members.has(proposal.payload.proposer)) continue;
        found.push({ contractId: event.contractId, offset: event.offset, nodeId: event.nodeId, proposal });
      }
    }
    if (page.complete || page.nextBeginExclusive <= begin) break;
    begin = page.nextBeginExclusive;
  }
  found.sort((a, b) => a.offset - b.offset || a.nodeId - b.nodeId);
  return found.map((f, i) => ({ ref: governanceProposalRef(i), contractId: f.contractId, offset: f.offset, proposal: f.proposal }));
}

function governedPayloadOf(templateRef: string, argument: unknown): GovernedPayload | null {
  if (templateRef === TEMPLATES.AddVerifierProposal) {
    const parsed = AddVerifierProposalSchema.safeParse(argument);
    return parsed.success ? { type: "ADD_VERIFIER", payload: parsed.data } : null;
  }
  if (templateRef === TEMPLATES.SuspendVerifierProposal) {
    const parsed = SuspendVerifierProposalSchema.safeParse(argument);
    return parsed.success ? { type: "SUSPEND_VERIFIER", payload: parsed.data } : null;
  }
  return null;
}
