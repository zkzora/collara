// Opaque actor references recorded on ledger choices (`actorRef : Text`, daml-model.md §2): who acted inside
// an organization, never a name or an e-mail address. Convention:
//   usr:<userId>      a Collara user (what the API records)
//   mbr:<personaId>   a seeded demo persona (what the Daml seed scripts record)
//   svc:<name> / system:<name>   a service (registrar, intake); not a user
// The read model maps these back to user ids for ActorStamp/EventFacts.
import { DEMO_PERSONAS, PersonaIdSchema, type Role } from "./roles";

export const ACTOR_REF_MAX_LENGTH = 200;

/** The actorRef the API records for a user acting through a command. */
export function actorRefForUser(userId: string): string {
  return `usr:${userId}`;
}

/** The user id behind an actorRef, or null for services and unknown formats. */
export function userIdFromActorRef(actorRef: string | null | undefined): string | null {
  if (!actorRef) return null;
  if (actorRef.startsWith("usr:")) return actorRef.slice(4) || null;
  if (actorRef.startsWith("mbr:")) {
    const persona = PersonaIdSchema.safeParse(actorRef.slice(4));
    return persona.success ? DEMO_PERSONAS[persona.data].userId : null;
  }
  return null;
}

/** The demo persona's primary role for an `mbr:` reference (used to label ledger events); null otherwise. */
export function roleFromActorRef(actorRef: string | null | undefined): Role | null {
  if (!actorRef?.startsWith("mbr:")) return null;
  const persona = PersonaIdSchema.safeParse(actorRef.slice(4));
  if (!persona.success) return null;
  return DEMO_PERSONAS[persona.data].roles[0] ?? null;
}

export function isServiceActorRef(actorRef: string | null | undefined): boolean {
  return !!actorRef && (actorRef.startsWith("svc:") || actorRef.startsWith("system:"));
}
