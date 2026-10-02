// GET /api/directory/lenders and /api/directory/dealers: the non-sensitive directory of onboarded (ACTIVE)
// lender and dealer organizations a borrower may select on a new case. Organization id and display name only:
// no members, parties, cases or counts. Signed-in members only. POST /api/cases validates against the same rows.
import { organizations, type Db } from "@collara/db";
import { OrgRefSchema, type OrgRef } from "@collara/domain";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export const DIRECTORY_KINDS = { lenders: "LENDER", dealers: "DEALER" } as const;
export type DirectoryOrgType = (typeof DIRECTORY_KINDS)[keyof typeof DIRECTORY_KINDS];

export async function listDirectory(db: Db, type: DirectoryOrgType): Promise<OrgRef[]> {
  return db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(and(eq(organizations.type, type), eq(organizations.state, "ACTIVE")))
    .orderBy(asc(organizations.name), asc(organizations.id));
}

/** True when `orgId` is an onboarded organization of `type` (the same rows the directory lists). */
export async function inDirectory(db: Db, type: DirectoryOrgType, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.type, type), eq(organizations.state, "ACTIVE")))
    .limit(1);
  return !!row;
}

export const directoryRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  for (const [kind, type] of Object.entries(DIRECTORY_KINDS)) {
    app.get(
      `/${kind}`,
      {
        schema: {
          tags: ["directory"],
          summary: `Onboarded ${type.toLowerCase()} organizations (id and display name only)`,
          response: { 200: z.array(OrgRefSchema) },
        },
      },
      async (request) => {
        await request.requireActor();
        return listDirectory(db, type);
      },
    );
  }
};
