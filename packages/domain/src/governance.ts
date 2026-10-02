// Verifier-registry governance facts and derivation, modelled on DLC-link Decentralization Manager
// semantics (CR-28): seats confirm, there is no reject vote, the proposer may withdraw, confirmations
// expire after a timeout, and a proposal goes STALE when its deadline passes or the registry moved.
// Governance administers the verifier registry only; it can never release collateral (CR-22).
import type { GovernanceIntegrationStatus } from "./copy";
import type { GovernanceActionType } from "./dto";
import type { GovernanceSeat, OrgId } from "./roles";
import type { GovernanceProposalState, SeatConfirmationState } from "./states";

export interface GovernanceSeatFacts {
  seat: GovernanceSeat;
  orgId: OrgId;
  /** Separate governance-member party, never the org's business party (CR-24). */
  memberRef: string;
  mandateLabel: string;
  since: string;
}

export interface VerifierFacts {
  ref: string; // VER-001
  orgName: string;
  /** Collara organization id when the verifier is onboarded as an org. */
  orgId: OrgId | null;
  scope: string;
  status: "ACTIVE" | "SUSPENDED";
  since: string;
  /** "genesis" or the executing proposal ref. */
  via: string;
}

export interface GovernanceProposalFacts {
  ref: string; // GP-004
  type: GovernanceActionType;
  target: { verifierRef: string; orgName: string; scope: string };
  proposerSeat: GovernanceSeat;
  rationale: string;
  effect: string;
  openedAt: string;
  deadlineAt: string;
  expectedRegistryVersion: number;
  confirmations: { seat: GovernanceSeat; confirmedAt: string }[];
  executedAt: string | null;
  executedBySeat: GovernanceSeat | null;
  cancelledAt: string | null;
}

export interface GovernanceFacts {
  integration: GovernanceIntegrationStatus;
  threshold: number;
  seats: GovernanceSeatFacts[];
  registryVersion: number;
  proposalDeadlineDays: number;
  confirmationTimeoutHours: number;
  verifiers: VerifierFacts[];
  proposals: GovernanceProposalFacts[];
}

const HOUR = 3_600_000;

export function confirmationExpiry(gov: GovernanceFacts, confirmedAt: string): string {
  return new Date(Date.parse(confirmedAt) + gov.confirmationTimeoutHours * HOUR).toISOString();
}

/** Newest confirmation per current member seat that has not timed out. Duplicates never count twice. */
export function liveConfirmationSeats(proposal: GovernanceProposalFacts, gov: GovernanceFacts, now: Date): GovernanceSeat[] {
  const memberSeats = new Set(gov.seats.map((s) => s.seat));
  const live = new Set<GovernanceSeat>();
  for (const c of proposal.confirmations) {
    if (memberSeats.has(c.seat) && Date.parse(confirmationExpiry(gov, c.confirmedAt)) > now.getTime()) live.add(c.seat);
  }
  return [...live].sort();
}

export function seatConfirmationState(
  proposal: GovernanceProposalFacts,
  gov: GovernanceFacts,
  seat: GovernanceSeat,
  now: Date,
): SeatConfirmationState {
  const confirmations = proposal.confirmations.filter((c) => c.seat === seat);
  if (confirmations.length === 0) return "NONE";
  return liveConfirmationSeats(proposal, gov, now).includes(seat) ? "CONFIRMED" : "EXPIRED";
}

export function governanceProposalState(
  proposal: GovernanceProposalFacts,
  gov: GovernanceFacts,
  now: Date,
): GovernanceProposalState {
  if (proposal.executedAt) return "EXECUTED";
  if (proposal.cancelledAt) return "CANCELLED";
  if (now.getTime() > Date.parse(proposal.deadlineAt) || gov.registryVersion !== proposal.expectedRegistryVersion) {
    return "STALE";
  }
  return liveConfirmationSeats(proposal, gov, now).length >= gov.threshold ? "EXECUTABLE" : "OPEN";
}

export function isOpenGovernanceProposal(state: GovernanceProposalState): boolean {
  return state === "OPEN" || state === "EXECUTABLE";
}

export function verifierByRef(gov: GovernanceFacts, ref: string): VerifierFacts | undefined {
  return gov.verifiers.find((v) => v.ref === ref);
}

/** Registry status lookup used for assignment and attestation checks (re-checked at commit). */
export function verifierActiveLookup(gov: GovernanceFacts): (ref: string) => boolean {
  return (ref) => verifierByRef(gov, ref)?.status === "ACTIVE";
}

export function seatForOrg(gov: GovernanceFacts, orgId: OrgId): GovernanceSeatFacts | undefined {
  return gov.seats.find((s) => s.orgId === orgId);
}
