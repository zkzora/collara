// Governance read path: projections → domain GovernanceFacts → presenters (never the ACS).
//   - governance state / proposals: seat holders only (their seat + readAs governance view);
//   - verifier registry (GET /verifiers): every signed-in member. The registry is network reference data
//     (ref, organisation name, scope, ACTIVE/SUSPENDED), published by the registrar (operator) — so members
//     without a governance seat read it from the registrar's projected view, while open governance proposals
//     are only shown to seat holders. Assignment and attestation counts come from the viewer's own view.
import { governanceState, loadReadWorld, readViewerOf, type Db } from "@collara/db";
import { can, DEMO_ORG_IDS, presentVerifierEntries, type Actor, type GovernanceFacts, type RuntimeMode, type VerifierEntry } from "@collara/domain";
import { businessPartyOfOrg } from "../actors";
import { PROPOSAL_DEADLINE_DAYS } from "./rules";

/** Governance facts before anything was projected: honest "Unavailable" integration, no seats, no verifiers. */
export const UNPROJECTED_GOVERNANCE: GovernanceFacts = {
  integration: "UNAVAILABLE",
  threshold: 2,
  seats: [],
  registryVersion: 0,
  proposalDeadlineDays: PROPOSAL_DEADLINE_DAYS,
  confirmationTimeoutHours: 0.5,
  verifiers: [],
  proposals: [],
};

/** Holds a governance seat mandate (policy `governance.act`). */
export function isSeatHolder(actor: Actor): boolean {
  return can(actor, "governance.act");
}

type ViewerActor = Actor & { readonly parties: { readonly readAs: readonly string[] } };

/** The registry as the registrar (operator) has it projected: accreditations and mirrors, no proposals. */
async function registryDirectory(db: Db, now: Date): Promise<GovernanceFacts | null> {
  const registrar = await businessPartyOfOrg(db, DEMO_ORG_IDS.collara);
  if (!registrar) return null;
  return governanceState(db, { orgId: DEMO_ORG_IDS.collara, readableParties: [registrar], roles: ["OPERATOR"] }, { now });
}

export async function verifierDirectory(db: Db, member: ViewerActor, options: { now: Date; mode: RuntimeMode }): Promise<VerifierEntry[]> {
  const world = await loadReadWorld(db, readViewerOf(member), { now: options.now });
  const own = isSeatHolder(member) ? world.governance : null;
  let facts: GovernanceFacts | null = own && own.verifiers.length > 0 ? own : null;
  if (!facts) {
    const directory = await registryDirectory(db, options.now);
    facts = directory ? { ...directory, proposals: own?.proposals ?? [] } : null;
  }
  if (!facts) return [];
  return presentVerifierEntries(facts, world.assets, { now: options.now, mode: options.mode, sync: world.lastSync });
}
