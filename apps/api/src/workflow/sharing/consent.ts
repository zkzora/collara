// Dealer consent decisions, one consent request at a time (daml-model.md §4.6, D9). The request is addressed by its
// share reference (lender review: AG-…/SHR-…; verification: <requestRef>-G<v>-D<n>) and read FRESH from the
// dealer's own ledger view; only proposals naming the dealer and shares it co-signed qualify. One parent command
// per decision (the parent id is the correlation id):
//   GRANT    "contribute-<doc>-v<n>"  DealerContribution of each listed document without one (./share.ts)
//            "consent"                Consent_Grant → PackageShare signed by owner + dealer (recipient observes)
//   DECLINE  "decline"                Consent_Decline (reason code only; free text never goes on the ledger)
//   WITHDRAW "withdraw"               Share_WithdrawConsent: ends future access; previously shared copies may
//                                     still exist (STATUS_COPY.ACCESS_REVOKED, answered at download)
// The owner's own documents are never part of a consent request (PackageShareProposal lists dealer documents only).
import type { Db } from "@collara/db";
import { CONSENT_COPY } from "@collara/domain";
import type { AcsContract, AcsReader } from "../../ledger/acs";
import { ledgerCommands as L } from "../../ledger/builders";
import type { Payload } from "../../ledger/contracts";
import type { WorkflowActor } from "../actors";
import type { WorkflowServices } from "../context";
import { must, mustBeVisible } from "../preconditions";
import { workflowProblems } from "../problems";
import type { WorkflowOutcome } from "../run";
import { DEALER_DECLINE_REASON } from "./grants";
import { recordContributions } from "./share";

export interface ConsentDecisionInput {
  readonly db: Db;
  readonly workflow: WorkflowServices;
  readonly dealer: WorkflowActor;
  readonly caseRef: string;
  /** The consent request's share reference. */
  readonly consentRef: string;
  readonly idempotencyKey: string;
  readonly now: Date;
}

/** The dealer's live request (PackageShareProposal naming it) with this reference, or null. */
async function liveRequest(acs: AcsReader, input: { dealerParty: string; caseRef: string; ref: string }): Promise<AcsContract<Payload<"PackageShareProposal">> | null> {
  const found = await acs.list("PackageShareProposal", (p) => p.shareRef === input.ref && p.caseRef === input.caseRef && p.dealer === input.dealerParty);
  return found.sort((a, b) => a.offset - b.offset).at(-1) ?? null;
}

/** The dealer's live granted share (PackageShare it co-signed) with this reference, or null. */
async function liveShare(acs: AcsReader, input: { dealerParty: string; caseRef: string; ref: string }): Promise<AcsContract<Payload<"PackageShare">> | null> {
  const found = await acs.list("PackageShare", (s) => s.shareRef === input.ref && s.caseRef === input.caseRef && s.consenters.includes(input.dealerParty));
  return found.sort((a, b) => a.offset - b.offset).at(-1) ?? null;
}

const notExpired = (expiresAt: string, now: Date) => {
  if (Date.parse(expiresAt) <= now.getTime()) throw workflowProblems.stateChanged(CONSENT_COPY.EXPIRED);
};

/** Consent_Grant (with the dealer's contribution records) or Consent_Decline of one pending request. */
export function decideConsent(input: ConsentDecisionInput & { readonly decision: "GRANT" | "DECLINE" }): Promise<WorkflowOutcome<{ consentId: string }>> {
  const { db, workflow, dealer, caseRef, consentRef, decision } = input;
  return workflow.sequence({
    actor: dealer,
    operation: "consent.decision",
    idempotencyKey: input.idempotencyKey,
    payload: { caseRef, consentRef, decision },
    resourceRef: consentRef,
    steps: async (seq) => {
      const dealerParty = must(dealer.business, workflowProblems.ledgerUnavailable).party;
      const acs = workflow.acs(dealer);
      const key = { dealerParty, caseRef, ref: consentRef };
      const request = await liveRequest(acs, key);
      // Already answered (another session, or the projection lagging behind the ledger): 409, never 404.
      if (!request) throw workflowProblems.stateChanged(CONSENT_COPY.NOT_PENDING);
      notExpired(request.payload.expiresAt, input.now);
      if (decision === "GRANT") {
        await recordContributions(seq, { db, acs, dealerParty, owner: request.payload.owner, caseRef, documents: request.payload.documents });
        await seq.step("consent", {
          payload: { shareRef: consentRef },
          prepare: async (ctx) => {
            const live = mustBeVisible(await liveRequest(ctx.acs, key));
            notExpired(live.payload.expiresAt, ctx.now);
            return { commands: [L.consentGrant(live.contractId, { actorRef: ctx.actorRef })] };
          },
          result: (s) => ({ shareCid: s.createdOf("PackageShare") }),
        });
      } else {
        await seq.step("decline", {
          payload: { shareRef: consentRef },
          prepare: async (ctx) => {
            const live = mustBeVisible(await liveRequest(ctx.acs, key));
            return { commands: [L.consentDecline(live.contractId, { reason: DEALER_DECLINE_REASON, actorRef: ctx.actorRef })] };
          },
        });
      }
      return { consentId: consentRef };
    },
  });
}

/** Share_WithdrawConsent of the dealer's granted share: future access ends for the recipient. */
export function withdrawConsent(input: ConsentDecisionInput): Promise<WorkflowOutcome<{ consentId: string }>> {
  const { workflow, dealer, caseRef, consentRef } = input;
  return workflow.sequence({
    actor: dealer,
    operation: "consent.withdraw",
    idempotencyKey: input.idempotencyKey,
    payload: { caseRef, consentRef },
    resourceRef: consentRef,
    steps: async (seq) => {
      const dealerParty = must(dealer.business, workflowProblems.ledgerUnavailable).party;
      const key = { dealerParty, caseRef, ref: consentRef };
      if (!(await liveShare(workflow.acs(dealer), key))) throw workflowProblems.stateChanged(CONSENT_COPY.NOT_GRANTED);
      await seq.step("withdraw", {
        payload: { shareRef: consentRef },
        prepare: async (ctx) => {
          const live = mustBeVisible(await liveShare(ctx.acs, key));
          return { commands: [L.shareWithdrawConsent(live.contractId, { consenter: dealerParty, actorRef: ctx.actorRef })] };
        },
      });
      return { consentId: consentRef };
    },
  });
}
