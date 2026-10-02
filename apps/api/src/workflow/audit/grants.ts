// Audit grants (daml-model.md §4.9, §7 W13–W14): explicit, scoped auditor access, one grant per record owner
// (the borrower for owner records, the selected lender's approver for lender records). The auditor party is
// resolved from the server-side bindings of the chosen auditor organisation; nothing party-like is read from
// the browser. Revocation (Grant_Revoke by the grantor) limits future access only.
//
// Exposed by routes/workflow/audit.ts as POST /audit/grants and POST /audit/grants/:id/revoke. The route
// contract (API_ENDPOINTS) names POST /access-grants ("accessGrants.create", body CreateAuditGrantRequest) and
// POST /access-grants/:id/revoke: those belong to routes/workflow/access.ts, which should delegate audit grants
// to createAuditGrant / revokeAuditGrant below.
import { organizations } from "@collara/db";
import { AUDIT_SCOPE_OWNERS, ERROR_COPY, type CreateAuditGrantRequest } from "@collara/domain";
import { eq } from "drizzle-orm";
import { problems } from "../../errors";
import { ledgerCommands as L } from "../../ledger/builders";
import { PAYLOAD_SCHEMAS } from "../../ledger/contracts";
import type { ResolvedActor } from "../../plugins/actor";
import { businessPartyOfOrg } from "../actors";
import { must } from "../preconditions";
import type { WorkflowOutcome } from "../run";
import { findCase, guardCase, isPast, isReplay, nextRef, type FinanceDeps } from "../financing/common";

/** Copy of the UI_MOCK client (INFERRED, kept identical for parity). */
export const AUDIT_GRANT_COPY = {
  notOwned: (scopes: readonly string[]) => `Only the record owner can grant: ${scopes.join(", ")}.`,
  SELECT_AUDITOR: "Select an auditor organization.",
  EXPIRY_FUTURE: "The grant must expire in the future.",
  ALREADY_REVOKED: "This grant is already revoked.",
} as const;

const invalid = (detail: string) => problems.validation([], detail);

export async function createAuditGrant(
  deps: FinanceDeps,
  member: ResolvedActor,
  input: CreateAuditGrantRequest,
  idempotencyKey: string,
): Promise<WorkflowOutcome<{ grantId: string }>> {
  const operation = "auditGrant.create";
  const scope = await findCase(deps, member, (c) => c.ref === input.caseId);
  const facts = scope.facts;
  if (!(await isReplay(deps.db, member, operation, idempotencyKey))) {
    guardCase(scope, member, "auditGrant.create");
    const side = member.orgId === facts.borrowerOrgId ? "OWNER" : "LENDER";
    const notOwned = input.scopes.filter((s) => !AUDIT_SCOPE_OWNERS[s].includes(side));
    if (notOwned.length > 0) throw invalid(AUDIT_GRANT_COPY.notOwned(notOwned));
    const [org] = await deps.db.select({ type: organizations.type }).from(organizations).where(eq(organizations.id, input.auditorOrgId)).limit(1);
    if (org?.type !== "AUDITOR") throw invalid(AUDIT_GRANT_COPY.SELECT_AUDITOR);
    if (isPast(input.expiresAt, scope.now)) throw invalid(AUDIT_GRANT_COPY.EXPIRY_FUTURE);
  }
  const auditor = await businessPartyOfOrg(deps.db, input.auditorOrgId);
  if (!auditor) throw invalid(AUDIT_GRANT_COPY.SELECT_AUDITOR);
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: input,
    resourceRef: input.caseId,
    prepare: async (ctx) => {
      const grantor = ctx.acs.parties[0] ?? "";
      const taken = (await ctx.acs.list("AuditGrant")).map((g) => g.payload.grantRef);
      const grantRef = await nextRef(deps.db, "accessGrant", taken);
      return {
        commands: [
          L.createAuditGrant({
            grantor,
            auditor,
            grantRef,
            caseRef: input.caseId,
            scopes: [...new Set(input.scopes)],
            permission: input.permission === "VIEW_EXPORT" ? "EXPORT" : "VIEW",
            purpose: input.purpose,
            expiresAt: input.expiresAt,
          }),
        ],
      };
    },
    result: (step) => {
      const created = step.created.find((c) => c.template === "AuditGrant");
      return { grantId: created ? PAYLOAD_SCHEMAS.AuditGrant.parse(created.argument).grantRef : "" };
    },
  });
}

export async function revokeAuditGrant(deps: FinanceDeps, member: ResolvedActor, grantRef: string, idempotencyKey: string): Promise<WorkflowOutcome<{ grantId: string }>> {
  const operation = "auditGrant.revoke";
  const scope = await findCase(deps, member, (c) => c.auditGrants.some((g) => g.ref === grantRef));
  if (!(await isReplay(deps.db, member, operation, idempotencyKey))) {
    guardCase(scope, member, "auditGrant.revoke");
    const grant = scope.facts.auditGrants.find((g) => g.ref === grantRef);
    if (!grant) throw problems.unavailable();
    if (grant.grantorOrgId !== member.orgId) throw problems.forbidden(ERROR_COPY.FORBIDDEN);
    if (grant.revokedAt) throw problems.stateConflict(AUDIT_GRANT_COPY.ALREADY_REVOKED);
  }
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { grantRef },
    resourceRef: grantRef,
    prepare: async (ctx) => {
      const grantor = ctx.acs.parties[0] ?? "";
      const grant = must(await ctx.acs.latest("AuditGrant", (g) => g.grantRef === grantRef && g.grantor === grantor));
      return { commands: [L.grantRevoke(grant.contractId, { actorRef: ctx.actorRef })] };
    },
    result: () => ({ grantId: grantRef }),
  });
}
