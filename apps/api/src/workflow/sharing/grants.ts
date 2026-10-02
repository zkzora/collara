// Package-share revocation (daml-model.md §4.6). Owner: Share_Revoke for an active share, ShareProposal_Withdraw
// for a share request still waiting for the dealer's consent. Consenting dealer: Share_WithdrawConsent for a
// share of its own records, Consent_Decline for a request it has not granted. Revocation limits future access
// only; previously shared copies may still exist. Audit grants (AuditGrant / Grant_Revoke) are implemented in ../audit/grants.ts and
// reached through POST /access-grants and POST /access-grants/:id/revoke (routes/workflow/access.ts).
import { ledgerCommands as L } from "../../ledger/builders";
import type { WorkflowActor } from "../actors";
import type { WorkflowServices } from "../context";
import { must } from "../preconditions";
import { workflowProblems } from "../problems";
import type { WorkflowOutcome } from "../run";

export interface RevokeInput {
  readonly workflow: WorkflowServices;
  readonly actor: WorkflowActor;
  readonly caseRef: string;
  readonly grantId: string;
  readonly idempotencyKey: string;
}

/** Ledger reason code when a dealer declines a share request through revoke (never shown as UI copy). */
export const DEALER_DECLINE_REASON = "DECLINED_BY_CONSENTER";

/** Owner revokes (or withdraws) a share; a consenting dealer withdraws (or declines) its consent. */
export function revokeShare(input: RevokeInput): Promise<WorkflowOutcome<{ grantId: string }>> {
  const { workflow, actor, caseRef, grantId } = input;
  return workflow.run({
    actor,
    operation: "accessGrant.revoke",
    idempotencyKey: input.idempotencyKey,
    payload: { grantId },
    resourceRef: grantId,
    prepare: async (ctx) => {
      const party = must(actor.business, workflowProblems.ledgerUnavailable).party;
      const share = await ctx.acs.one("PackageShare", (s) => s.shareRef === grantId && s.caseRef === caseRef && (s.owner === party || s.consenters.includes(party)));
      if (share) {
        if (share.payload.owner === party) return { commands: [L.shareRevoke(share.contractId, { actorRef: ctx.actorRef })] };
        return { commands: [L.shareWithdrawConsent(share.contractId, { consenter: party, actorRef: ctx.actorRef })] };
      }
      const proposal = must(await ctx.acs.one("PackageShareProposal", (s) => s.shareRef === grantId && s.caseRef === caseRef && (s.owner === party || s.dealer === party)));
      if (proposal.payload.owner === party) return { commands: [L.shareProposalWithdraw(proposal.contractId, { actorRef: ctx.actorRef })] };
      return { commands: [L.consentDecline(proposal.contractId, { reason: DEALER_DECLINE_REASON, actorRef: ctx.actorRef })] };
    },
    result: () => ({ grantId }),
  });
}
