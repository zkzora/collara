// Actor resolution: session → user → active membership/org → roles + mandates → party bindings.
// Authority is derived server-side only. Organization, party and role values sent by the browser (headers,
// query, body) are never read here.
import { loadUserAuthority, type Db, type UserAuthority } from "@collara/db";
import {
  can,
  isRelated,
  MandateSchema,
  RoleSchema,
  type Actor,
  type Mandate,
  type OrgType,
  type PersonaId,
  type PolicyAction,
  type PolicyContext,
  type Role,
} from "@collara/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { problems } from "../errors";

export interface ActorParties {
  /** The organization's business party (actAs for its ledger user). */
  readonly business: string | null;
  /** Governance seat party for the actor's seat mandate (never the business party). */
  readonly governanceSeat: string | null;
  /** Shared governance party, readable by seat holders. */
  readonly governance: string | null;
  /** Parties whose projected contracts this actor may read. */
  readonly readAs: readonly string[];
}

export interface ResolvedActor extends Actor {
  readonly user: { readonly id: string; readonly email: string; readonly displayName: string; readonly title: string | null };
  readonly org: { readonly id: string; readonly name: string; readonly type: OrgType };
  readonly personaId: PersonaId | null;
  readonly authMethod: "oidc" | "demo";
  readonly parties: ActorParties;
}

declare module "fastify" {
  interface FastifyRequest {
    /** The authenticated actor, or null (memoized per request). */
    resolveActor(): Promise<ResolvedActor | null>;
    /** The authenticated actor, or a 401 problem. */
    requireActor(): Promise<ResolvedActor>;
    /**
     * Checks a policy action against a resource context: allowed → actor; related but not allowed → 403;
     * unrelated → 404-shaped `unavailable` (existence is never revealed).
     */
    requirePermission(action: PolicyAction, ctx: PolicyContext): Promise<ResolvedActor>;
  }
}

export function actorFromAuthority(authority: UserAuthority, session: { personaId?: PersonaId; authMethod?: "oidc" | "demo" }): ResolvedActor | null {
  const { user, org } = authority;
  if (!org) return null;
  const roles = authority.roles.flatMap((role) => {
    const parsed = RoleSchema.safeParse(role);
    return parsed.success ? [parsed.data] : [];
  });
  if (roles.length === 0) return null;
  const mandates: Mandate[] = authority.mandates.flatMap((row) => {
    const parsed = MandateSchema.safeParse(
      row.code === "GOVERNANCE_SEAT" ? { code: row.code, label: row.label, seat: row.seat } : { code: row.code, label: row.label },
    );
    return parsed.success ? [parsed.data] : [];
  });
  const seat = mandates.find((m) => m.code === "GOVERNANCE_SEAT")?.seat ?? null;
  const business = authority.bindings.find((b) => b.kind === "business" && b.orgId === org.id)?.partyId ?? null;
  const governanceSeat =
    seat === null
      ? null
      : (authority.bindings.find((b) => b.kind === "governance-member" && b.orgId === org.id && b.governanceSeat === seat)?.partyId ?? null);
  const governance = seat === null ? null : (authority.bindings.find((b) => b.kind === "governance")?.partyId ?? null);
  return {
    userId: user.id,
    orgId: org.id,
    roles: roles as Role[],
    mandates,
    user: { id: user.id, email: user.email, displayName: user.displayName, title: user.title },
    org: { id: org.id, name: org.name, type: org.type as OrgType },
    personaId: session.authMethod === "demo" ? (session.personaId ?? null) : null,
    authMethod: session.authMethod ?? "oidc",
    parties: {
      business,
      governanceSeat,
      governance,
      readAs: [business, governanceSeat, governance].filter((p): p is string => p !== null),
    },
  };
}

export function assertPermitted(actor: ResolvedActor, action: PolicyAction, ctx: PolicyContext): void {
  if (can(actor, action, ctx)) return;
  throw isRelated(actor, ctx) ? problems.forbidden() : problems.unavailable();
}

async function actorPlugin(app: FastifyInstance, opts: { db: Db }) {
  const cache = new WeakMap<FastifyRequest, Promise<ResolvedActor | null>>();

  app.decorateRequest("resolveActor", function (this: FastifyRequest) {
    let pending = cache.get(this);
    if (!pending) {
      const session = this.session as FastifyRequest["session"] | null | undefined;
      const userId = session?.userId;
      pending = userId
        ? loadUserAuthority(opts.db, userId, session.activeOrgId).then((authority) =>
            authority ? actorFromAuthority(authority, { personaId: session.personaId, authMethod: session.authMethod }) : null,
          )
        : Promise.resolve(null);
      cache.set(this, pending);
    }
    return pending;
  });

  app.decorateRequest("requireActor", async function (this: FastifyRequest) {
    const actor = await this.resolveActor();
    if (!actor) throw problems.unauthenticated();
    return actor;
  });

  app.decorateRequest("requirePermission", async function (this: FastifyRequest, action: PolicyAction, ctx: PolicyContext) {
    const actor = await this.requireActor();
    assertPermitted(actor, action, ctx);
    return actor;
  });
}

export const actorResolution = fp(actorPlugin, { name: "collara-actor", dependencies: ["@fastify/session"] });
