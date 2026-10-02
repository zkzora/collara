// Release (daml-model.md §4.4, §7 W9–W12). A release request never touches the lock; only Release_Authorize,
// controlled by the lock's designated lender, runs Lock_Release (control recreated, version + 1). Rejection and
// information rounds leave the lock ACTIVE. Decisions are designated-lender-approver only (domain policy:
// `release.decide`); the borrower or any other party gets 403 `Release requires the designated lender's
// authorization.` from the API, and the ledger refuses them anyway (controller lender).
//
// Notes (packages/db notes.ts): the request note, the servicing reference, the lender's question and the borrower's
// response are private off-ledger notes of the command that carries them (lock owner and designated lender only).
// The ledger carries only the note id: ReleaseRequest.noteRef, Release_RequestInformation.questionRef,
// Release_Respond.responseNoteRef. A note is readable once its command commits; command records carry digests only.
import { noteDigest, putPendingNote, settleNotes, settleNotesOfCommand, type NoteKind } from "@collara/db";
import { ERROR_COPY, type CreateReleaseRequest, type ReleaseDecisionRequest } from "@collara/domain";
import { problems } from "../../errors";
import { ledgerCommands as L } from "../../ledger/builders";
import { PAYLOAD_SCHEMAS } from "../../ledger/contracts";
import type { AcsReader } from "../../ledger/acs";
import type { ResolvedActor } from "../../plugins/actor";
import { must } from "../preconditions";
import { workflowProblems } from "../problems";
import type { PrepareContext, WorkflowOutcome } from "../run";
import { findCase, guardUnlessReplay, nextRef, type CaseScope, type FinanceDeps } from "../financing/common";
import { assertNoteText } from "../review/notes";

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

/** A PENDING note of the command being prepared; its id is the opaque on-ledger reference. */
async function pendingNote(deps: FinanceDeps, member: ResolvedActor, ctx: PrepareContext, kind: NoteKind, caseRef: string, subjectRef: string, body: string): Promise<string> {
  const note = await putPendingNote(
    deps.db,
    { kind, ownerOrgId: member.orgId, caseRef, subjectRef, body, commandId: ctx.record.id, createdByUserId: member.userId },
    deps.clock(),
  );
  return note.id;
}

/** Runs a release command and settles the notes it carries from the outcome (also when the runner throws). */
async function settlingNotes<R>(deps: FinanceDeps, run: (carrier: { id: string | null }) => Promise<WorkflowOutcome<R>>): Promise<WorkflowOutcome<R>> {
  const carrier: { id: string | null } = { id: null };
  try {
    const outcome = await run(carrier);
    await settleNotes(deps.db, outcome.record.id, outcome.record.status, deps.clock());
    return outcome;
  } catch (error) {
    if (carrier.id) await settleNotesOfCommand(deps.db, carrier.id, deps.clock());
    throw error;
  }
}

const digestOf = (text: string | undefined) => (text === undefined ? undefined : noteDigest(text));

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
  assertNoteText([
    ["RELEASE_REQUEST_NOTE", input.note, "body.note"],
    ["RELEASE_SERVICING_REF", input.servicingRef, "body.servicingRef"],
  ]);
  await guardUnlessReplay(deps, scope, member, "release.request", operation, idempotencyKey);
  const actor = await deps.workflow.actorFor(member);
  const recorded = { reason: input.reason, note: digestOf(input.note), servicingRef: digestOf(input.servicingRef) };
  return settlingNotes(deps, (carrier) =>
    deps.workflow.run({
      actor,
      operation,
      idempotencyKey,
      payload: { lockRef, input: recorded },
      resourceRef: lockRef,
      prepare: async (ctx) => {
        carrier.id = ctx.record.id;
        const requester = ctx.acs.parties[0] ?? "";
        // Owner and lender are both lock signatories, so either sees the active lock.
        const lock = must(await ctx.acs.one("CollateralLock", (l) => l.lockRef === lockRef && l.namespace === ctx.namespace));
        const open = await ctx.acs.list("ReleaseRequest", (r) => r.lockRef === lockRef && r.namespace === ctx.namespace);
        if (open.length > 0) throw workflowProblems.stateChanged();
        const taken = (await ctx.acs.list("ReleaseRequest")).map((r) => r.payload.releaseRequestRef);
        const releaseRequestRef = await nextRef(deps.db, "releaseRequest", taken);
        const caseRef = lock.payload.caseRef;
        const noteRef = input.note ? await pendingNote(deps, member, ctx, "RELEASE_REQUEST_NOTE", caseRef, releaseRequestRef, input.note) : "";
        if (input.servicingRef) await pendingNote(deps, member, ctx, "RELEASE_SERVICING_REF", caseRef, releaseRequestRef, input.servicingRef);
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
              // Opaque reference to the private note (its text stays off-ledger); "" without a note.
              noteRef,
              requestedByRef: ctx.actorRef,
            }),
          ],
        };
      },
      result: (step) => {
        const created = step.created.find((c) => c.template === "ReleaseRequest");
        return { releaseRequestRef: created ? PAYLOAD_SCHEMAS.ReleaseRequest.parse(created.argument).releaseRequestRef : "" };
      },
    }),
  );
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
  assertNoteText([["RELEASE_QUESTION", input.message, "body.message"]]);
  await guardUnlessReplay(deps, scope, member, "release.requestInformation", operation, idempotencyKey);
  const actor = await deps.workflow.actorFor(member);
  return settlingNotes(deps, (carrier) =>
    deps.workflow.run({
      actor,
      operation,
      idempotencyKey,
      payload: { releaseRequestRef, input: { message: noteDigest(input.message) } },
      resourceRef: releaseRequestRef,
      prepare: async (ctx) => {
        carrier.id = ctx.record.id;
        const me = ctx.acs.parties[0] ?? "";
        const rr = await activeRequest(ctx.acs, ctx.namespace, releaseRequestRef);
        if (rr.payload.lender !== me) throw problems.forbidden(ERROR_COPY.RELEASE_UNAUTHORIZED);
        if (rr.payload.status !== "REQUESTED") throw workflowProblems.stateChanged();
        // The ledger carries the note id only; the question text stays in the private note store.
        const questionRef = await pendingNote(deps, member, ctx, "RELEASE_QUESTION", rr.payload.caseRef, releaseRequestRef, input.message);
        return { commands: [L.releaseRequestInformation(rr.contractId, { questionRef, actorRef: ctx.actorRef })] };
      },
      result: () => ({ releaseRequestRef }),
    }),
  );
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
  assertNoteText([["RELEASE_RESPONSE", input.message, "body.message"]]);
  await guardUnlessReplay(deps, scope, member, "release.respond", operation, idempotencyKey);
  const actor = await deps.workflow.actorFor(member);
  return settlingNotes(deps, (carrier) =>
    deps.workflow.run({
      actor,
      operation,
      idempotencyKey,
      payload: { releaseRequestRef, input: { message: noteDigest(input.message) } },
      resourceRef: releaseRequestRef,
      prepare: async (ctx) => {
        carrier.id = ctx.record.id;
        const me = ctx.acs.parties[0] ?? "";
        const rr = await activeRequest(ctx.acs, ctx.namespace, releaseRequestRef);
        if (rr.payload.owner !== me) throw workflowProblems.unavailable();
        if (rr.payload.status !== "INFORMATION_REQUESTED") throw workflowProblems.stateChanged();
        const responseNoteRef = await pendingNote(deps, member, ctx, "RELEASE_RESPONSE", rr.payload.caseRef, releaseRequestRef, input.message);
        return { commands: [L.releaseRespond(rr.contractId, { responseNoteRef, actorRef: ctx.actorRef })] };
      },
      result: () => ({ releaseRequestRef }),
    }),
  );
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
