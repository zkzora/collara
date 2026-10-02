// Actor → ledger identities. Authority comes only from the server session → membership → mandate → party
// bindings (src/plugins/actor.ts); this adds the least-privilege ledger user of each bound party from
// ledger_users (imported from the bootstrap state, prefix-aware because the state file is). Browser
// values are never read. Registrar/governance service actors are explicit system users.
import { ledgerUsers, loadUserAuthority, partyBindings, users, type Db } from "@collara/db";
import { DEMO_ORG_IDS } from "@collara/domain";
import { and, eq, inArray } from "drizzle-orm";
import { workflowProblems } from "./problems";
import { actorRefFor } from "../ledger/builders";
import { actorFromAuthority, type ResolvedActor } from "../plugins/actor";

export const LEDGER_ENVIRONMENT = "LOCALNET";

/** One party the actor may submit as, with the ledger user that holds CanActAs for it. */
export interface LedgerIdentity {
  readonly party: string;
  readonly ledgerUserId: string;
  /** Participant source of the ledger user (e.g. "sandbox"). */
  readonly source: string;
  /** Parties to add as readAs when submitting with this identity (the governance party for seats). */
  readonly readAs: readonly string[];
}

export interface WorkflowActor {
  readonly kind: "member" | "system";
  /** users.id ("user-lender-a-approver", or "system:registrar"). Command records are attributed to it. */
  readonly userId: string;
  readonly orgId: string;
  /** Opaque in-org reference recorded on ledger choices ("mbr:lender-a-approver", "svc:registrar"). */
  readonly actorRef: string;
  /** The organisation's business party identity (null when the org has no active binding). */
  readonly business: LedgerIdentity | null;
  /** Governance seat identity for seat-mandate holders (actAs seat, readAs governance). */
  readonly seat: LedgerIdentity | null;
  readonly governanceParty: string | null;
  /** Parties whose contracts this actor may read (business, seat, governance). */
  readonly readableParties: readonly string[];
  /** The resolved member (null for system actors). */
  readonly member: ResolvedActor | null;
}

export type SystemActorKind = "registrar" | "governance";

export const SYSTEM_USERS: Readonly<Record<SystemActorKind, { id: string; email: string; displayName: string }>> = {
  registrar: { id: "system:registrar", email: "registrar@system.collara.invalid", displayName: "Collara registrar service" },
  governance: { id: "system:governance", email: "governance@system.collara.invalid", displayName: "Collara governance party (Tier A)" },
};

/** Parties the read model may use for this actor: readable parties ∩ (signatories ∪ observers) is the stakeholder filter. */
export function readableParties(actor: Pick<ResolvedActor, "parties"> | Pick<WorkflowActor, "readableParties">): string[] {
  return "readableParties" in actor ? [...actor.readableParties] : [...actor.parties.readAs];
}

async function ledgerUsersByParty(db: Db, parties: readonly string[]): Promise<Map<string, { id: string; source: string }>> {
  if (parties.length === 0) return new Map();
  const rows = await db
    .select({ party: ledgerUsers.primaryParty, id: ledgerUsers.ledgerUserId, source: ledgerUsers.source })
    .from(ledgerUsers)
    .where(and(eq(ledgerUsers.environment, LEDGER_ENVIRONMENT), eq(ledgerUsers.role, "org"), inArray(ledgerUsers.primaryParty, [...parties])));
  return new Map(rows.flatMap((row) => (row.party ? [[row.party, { id: row.id, source: row.source }] as const] : [])));
}

/** Ledger identities of an authenticated member (from the request's ResolvedActor). */
export async function resolveWorkflowActor(db: Db, actor: ResolvedActor): Promise<WorkflowActor> {
  const { business, governanceSeat, governance } = actor.parties;
  const byParty = await ledgerUsersByParty(db, [business, governanceSeat].filter((p): p is string => p !== null));
  const identity = (party: string | null, readAs: readonly string[]): LedgerIdentity | null => {
    const user = party ? byParty.get(party) : undefined;
    return party && user ? { party, ledgerUserId: user.id, source: user.source, readAs } : null;
  };
  return {
    kind: "member",
    userId: actor.userId,
    orgId: actor.orgId,
    actorRef: actorRefFor(actor.userId),
    business: identity(business, []),
    seat: identity(governanceSeat, governance ? [governance] : []),
    governanceParty: governance,
    readableParties: [...actor.parties.readAs],
    member: actor,
  };
}

/** Loads a member by user id (seed, tests). Uses the same authority path as a session. */
export async function loadMemberActor(db: Db, userId: string): Promise<WorkflowActor> {
  const authority = await loadUserAuthority(db, userId);
  const resolved = authority ? actorFromAuthority(authority, { authMethod: "demo" }) : null;
  if (!resolved) throw new Error(`user ${userId} has no active membership`);
  return resolveWorkflowActor(db, resolved);
}

/** Creates the system service users (no membership: they can never sign in). Idempotent. */
export async function ensureSystemUsers(db: Db): Promise<void> {
  const rows = Object.values(SYSTEM_USERS).map((u) => ({ id: u.id, email: u.email, displayName: u.displayName, isDemo: false, emailVerified: false }));
  await db.insert(users).values(rows).onConflictDoNothing({ target: users.id });
}

/**
 * The registrar service (CollaraRegistrar party, registrar ledger user) or the Tier A governance party
 * (CollaraGovernance, used only for the governed bootstrap's GovernanceRules). Server-side only: never
 * reachable from a browser-supplied value. Command records are attributed to "system:<kind>".
 */
export async function resolveSystemActor(db: Db, kind: SystemActorKind): Promise<WorkflowActor> {
  await ensureSystemUsers(db);
  const [binding] = await db
    .select({ partyId: partyBindings.partyId })
    .from(partyBindings)
    .where(
      and(
        eq(partyBindings.environment, LEDGER_ENVIRONMENT),
        eq(partyBindings.state, "ACTIVE"),
        eq(partyBindings.orgId, DEMO_ORG_IDS.collara),
        eq(partyBindings.kind, kind === "registrar" ? "business" : "governance"),
      ),
    )
    .limit(1);
  const party = binding?.partyId ?? null;
  const user = party ? (await ledgerUsersByParty(db, [party])).get(party) : undefined;
  const identity: LedgerIdentity | null = party && user ? { party, ledgerUserId: user.id, source: user.source, readAs: [] } : null;
  const system = SYSTEM_USERS[kind];
  return {
    kind: "system",
    userId: system.id,
    orgId: DEMO_ORG_IDS.collara,
    actorRef: actorRefFor(system.id, "system"),
    business: identity,
    seat: null,
    governanceParty: kind === "governance" ? party : null,
    readableParties: party ? [party] : [],
    member: null,
  };
}

/**
 * Business party of another organisation (a counterparty such as the selected lender, the dealer or the
 * registrar), from the server-side party bindings. Never taken from the browser. Null when unbound.
 */
export async function businessPartyOfOrg(db: Db, orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ partyId: partyBindings.partyId })
    .from(partyBindings)
    .where(and(eq(partyBindings.environment, LEDGER_ENVIRONMENT), eq(partyBindings.state, "ACTIVE"), eq(partyBindings.orgId, orgId), eq(partyBindings.kind, "business")))
    .limit(1);
  return row?.partyId ?? null;
}

/** Organisation of a business party (reverse lookup for presenting ledger payloads), or null. */
export async function orgOfParty(db: Db, partyId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: partyBindings.orgId })
    .from(partyBindings)
    .where(and(eq(partyBindings.environment, LEDGER_ENVIRONMENT), eq(partyBindings.partyId, partyId)))
    .limit(1);
  return row?.orgId ?? null;
}

/** The identity to submit with, or a 503 (the organisation has no ledger binding in this environment). */
export function requireIdentity(actor: WorkflowActor, as: "business" | "seat" = "business"): LedgerIdentity {
  const identity = as === "seat" ? actor.seat : actor.business;
  if (!identity) throw workflowProblems.ledgerUnavailable();
  return identity;
}
