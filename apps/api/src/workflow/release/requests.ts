// Release (daml-model.md §4.4, §7 W9–W12). A release request never touches the lock; only Release_Authorize,
// controlled by the lock's designated lender, runs Lock_Release (control recreated, version + 1). Rejection and
// information rounds leave the lock ACTIVE. Decisions are designated-lender-approver only (domain policy:
// `release.decide`); the borrower or any other party gets 403 `Release requires the designated lender's
// authorization.` from the API, and the ledger refuses them anyway (controller lender).
import { ERROR_COPY, type CreateReleaseRequest, type ReleaseDecisionRequest } from "@collara/domain";
import { problems } from "../../errors";
import { ledgerCommands as L } from "../../ledger/builders";
import { PAYLOAD_SCHEMAS } from "../../ledger/contracts";
import type { AcsReader } from "../../ledger/acs";
import type { ResolvedActor } from "../../plugins/actor";
import { must } from "../preconditions";
import { workflowProblems } from "../problems";
import type { WorkflowOutcome } from "../run";
import { findCase, guardUnlessReplay, nextRef, type CaseScope, type FinanceDeps } from "../financing/common";

/** Resolves a pledge by its lock ref (PL-…) in the member's view; 404-shaped otherwise. */
export function findPledge(deps: FinanceDeps, member: ResolvedActor, lockRef: string): Promise<CaseScope> {
  return findCase(deps, member, (c) => c.lock?.ref === lockRef);
}

/** Resolves a release request by ref (RR-…) in the member's view; 404-shaped otherwise. */
export function findReleaseRequest(deps: FinanceDeps, member: ResolvedActor, releaseRequestRef: string): Promise<CaseScope> {
  return findCase(deps, member, (c) => c.releaseRequests.some((r) => r.ref === releaseRequestRef));
}

async function activeRequest(acs: AcsReader, namespace: string, releaseRequestRef: string) {
  return must(await acs.latest("ReleaseRequest", (r) => r.releaseRequestRef === releaseRequestRef && r.namespace === namespace));
}

// --- POST /pledges/:id/release-requests ------------------------------------------------------------------------

export async function requestRelease(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  lockRef: string,
  input: CreateReleaseRequest,
  idempotencyKey: string,
): Promise<WorkflowOutcome<{ releaseRequestRef: string }>> {
  const operation = "release.request";
  await guardUnlessReplay(deps, scope, member, "release.request", operation, idempotencyKey);
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { lockRef, input },
    resourceRef: lockRef,
    prepare: async (ctx) => {
      const requester = ctx.acs.parties[0] ?? "";
      // Owner and lender are both lock signatories, so either sees the active lock.
      const lock = must(await ctx.acs.one("CollateralLock", (l) => l.lockRef === lockRef && l.namespace === ctx.namespace));
      const open = await ctx.acs.list("ReleaseRequest", (r) => r.lockRef === lockRef && r.namespace === ctx.namespace);
      if (open.length > 0) throw workflowProblems.stateChanged();
      const taken = (await ctx.acs.list("ReleaseRequest")).map((r) => r.payload.releaseRequestRef);
      const releaseRequestRef = await nextRef(deps.db, "releaseRequest", taken);
      return {
        commands: [
          L.createReleaseRequest({
            requester,
            owner: lock.payload.owner,
            lender: lock.payload.lender,
            lockCid: lock.contractId,
            lockRef,
            caseRef: lock.payload.caseRef,
            namespace: ctx.namespace,
            assetId: lock.payload.assetId,
            releaseRequestRef,
            reason: input.reason,
            // The free-text note stays off-ledger and is not persisted in this stage (no note store).
            noteRef: "",
            requestedByRef: ctx.actorRef,
          }),
        ],
      };
    },
    result: (step) => {
      const created = step.created.find((c) => c.template === "ReleaseRequest");
      return { releaseRequestRef: created ? PAYLOAD_SCHEMAS.ReleaseRequest.parse(created.argument).releaseRequestRef : "" };
    },
  });
}

// --- POST /release-requests/:id/decision ------------------------------------------------------------------------

export async function decideRelease(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  releaseRequestRef: string,
  input: ReleaseDecisionRequest,
  idempotencyKey: string,
): Promise<WorkflowOutcome<{ decisionRef: string; outcome: "AUTHORIZED" | "REJECTED" }>> {
  const operation = "release.decide";
  const authorize = input.decision === "AUTHORIZE";
  await guardUnlessReplay(deps, scope, member, authorize ? "release.authorize" : "release.reject", operation, idempotencyKey);
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { releaseRequestRef, input },
    resourceRef: releaseRequestRef,
    prepare: async (ctx) => {
      const me = ctx.acs.parties[0] ?? "";
      const rr = await activeRequest(ctx.acs, ctx.namespace, releaseRequestRef);
      if (rr.payload.lender !== me) throw problems.forbidden(ERROR_COPY.RELEASE_UNAUTHORIZED);
      if (authorize) {
        if (rr.payload.status !== "REQUESTED") throw workflowProblems.stateChanged();
        const lock = must(await ctx.acs.get("CollateralLock", rr.payload.lockCid));
        if (lock.payload.lender !== me) throw problems.forbidden(ERROR_COPY.RELEASE_UNAUTHORIZED);
      }
      const decisionRef = await nextRef(deps.db, "releaseDecision");
      return {
        commands: [
          authorize
            ? L.releaseAuthorize(rr.contractId, { decisionRef, actorRef: ctx.actorRef })
            : L.releaseReject(rr.contractId, { decisionRef, sharedReason: input.decision === "REJECT" ? input.reason : "", actorRef: ctx.actorRef }),
        ],
      };
    },
    result: (step) => {
      const created = step.created.find((c) => c.template === "ReleaseDecision");
      const decision = created ? PAYLOAD_SCHEMAS.ReleaseDecision.parse(created.argument) : null;
      return { decisionRef: decision?.decisionRef ?? "", outcome: decision?.outcome ?? (authorize ? "AUTHORIZED" : "REJECTED") };
    },
  });
}

// --- POST /release-requests/:id/information-requests | /responses | /withdraw ----------------------------------

export async function requestReleaseInformation(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  releaseRequestRef: string,
  input: { readonly message: string },
  idempotencyKey: string,
): Promise<WorkflowOutcome<{ releaseRequestRef: string }>> {
  const operation = "release.requestInformation";
  await guardUnlessReplay(deps, scope, member, "release.requestInformation", operation, idempotencyKey);
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { releaseRequestRef, input },
    resourceRef: releaseRequestRef,
    prepare: async (ctx) => {
      const me = ctx.acs.parties[0] ?? "";
      const rr = await activeRequest(ctx.acs, ctx.namespace, releaseRequestRef);
      if (rr.payload.lender !== me) throw problems.forbidden(ERROR_COPY.RELEASE_UNAUTHORIZED);
      if (rr.payload.status !== "REQUESTED") throw workflowProblems.stateChanged();
      // Opaque reference only: the question text is not persisted off-ledger in this stage.
      return { commands: [L.releaseRequestInformation(rr.contractId, { questionRef: `${releaseRequestRef}-Q${rr.payload.version}`, actorRef: ctx.actorRef })] };
    },
    result: () => ({ releaseRequestRef }),
  });
}

export async function respondToRelease(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  releaseRequestRef: string,
  input: { readonly message: string },
  idempotencyKey: string,
): Promise<WorkflowOutcome<{ releaseRequestRef: string }>> {
  const operation = "release.respond";
  await guardUnlessReplay(deps, scope, member, "release.respond", operation, idempotencyKey);
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { releaseRequestRef, input },
    resourceRef: releaseRequestRef,
    prepare: async (ctx) => {
      const me = ctx.acs.parties[0] ?? "";
      const rr = await activeRequest(ctx.acs, ctx.namespace, releaseRequestRef);
      if (rr.payload.owner !== me) throw workflowProblems.unavailable();
      if (rr.payload.status !== "INFORMATION_REQUESTED") throw workflowProblems.stateChanged();
      return { commands: [L.releaseRespond(rr.contractId, { responseNoteRef: `${releaseRequestRef}-R${rr.payload.version}`, actorRef: ctx.actorRef })] };
    },
    result: () => ({ releaseRequestRef }),
  });
}

export async function withdrawRelease(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  releaseRequestRef: string,
  idempotencyKey: string,
): Promise<WorkflowOutcome<{ releaseRequestRef: string }>> {
  const operation = "release.withdraw";
  await guardUnlessReplay(deps, scope, member, "release.withdraw", operation, idempotencyKey);
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { releaseRequestRef },
    resourceRef: releaseRequestRef,
    prepare: async (ctx) => {
      const me = ctx.acs.parties[0] ?? "";
      const rr = await activeRequest(ctx.acs, ctx.namespace, releaseRequestRef);
      if (rr.payload.requester !== me) throw problems.forbidden();
      return { commands: [L.releaseWithdraw(rr.contractId, { actorRef: ctx.actorRef })] };
    },
    result: () => ({ releaseRequestRef }),
  });
}
