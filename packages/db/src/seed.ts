// Demo identity seed (synthesis §1.3): synthetic organizations, users, memberships and mandates.
// Party bindings are NOT seeded here: party ids change on every sandbox start, so they are imported
// from .local/localnet/state.json by importLocalnetState (bindings.ts).
import { DEMO_ORGANIZATIONS, DEMO_PERSONAS, PERSONA_IDS } from "@collara/domain";
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { mandates, memberships, organizations, users } from "./schema";

export interface SeedSummary {
  organizations: number;
  users: number;
  memberships: number;
  mandates: number;
}

/** Idempotent: re-running updates names/labels and re-activates the seeded rows. */
export async function seedDemoIdentities(db: Db, now = new Date()): Promise<SeedSummary> {
  const orgRows = Object.values(DEMO_ORGANIZATIONS).map((org) => ({
    id: org.id,
    name: org.name,
    type: org.type,
    state: "ACTIVE",
    isSynthetic: true,
    updatedAt: now,
  }));
  const personas = PERSONA_IDS.map((id) => DEMO_PERSONAS[id]);
  const userRows = personas.map((p) => ({
    id: p.userId,
    email: p.email.toLowerCase(),
    // Demo addresses are synthetic; OIDC users still need a verified email claim to be linked.
    emailVerified: false,
    displayName: p.displayName,
    title: p.title,
    personaId: p.id,
    isDemo: true,
    updatedAt: now,
  }));
  const membershipRows = personas.flatMap((p) =>
    p.roles.map((role) => ({ userId: p.userId, orgId: p.orgId, role, state: "ACTIVE", updatedAt: now })),
  );
  const mandateRows = personas.flatMap((p) =>
    p.mandates.map((m) => ({ userId: p.userId, orgId: p.orgId, code: m.code, seat: m.seat ?? 0, label: m.label, state: "ACTIVE" })),
  );

  await db.transaction(async (tx) => {
    await tx
      .insert(organizations)
      .values(orgRows)
      .onConflictDoUpdate({
        target: organizations.id,
        set: { name: sql`excluded.name`, type: sql`excluded.type`, isSynthetic: sql`true`, updatedAt: now },
      });
    await tx
      .insert(users)
      .values(userRows)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          displayName: sql`excluded.display_name`,
          title: sql`excluded.title`,
          personaId: sql`excluded.persona_id`,
          isDemo: sql`true`,
          updatedAt: now,
        },
      });
    await tx
      .insert(memberships)
      .values(membershipRows)
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.orgId, memberships.role],
        set: { state: "ACTIVE", updatedAt: now },
      });
    await tx
      .insert(mandates)
      .values(mandateRows)
      .onConflictDoUpdate({
        target: [mandates.userId, mandates.orgId, mandates.code, mandates.seat],
        set: { label: sql`excluded.label`, state: "ACTIVE", revokedAt: null },
      });
  });

  return {
    organizations: orgRows.length,
    users: userRows.length,
    memberships: membershipRows.length,
    mandates: mandateRows.length,
  };
}
