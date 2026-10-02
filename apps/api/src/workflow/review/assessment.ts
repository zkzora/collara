// Lender review (daml-model.md §4.7, §7 M18 + W1–W4): open the assessment, start the review, save the valuation,
// submit for approval, record the decision (eligible / rejected) or request information. The CollateralAssessment
// is lender-signed; analyst vs approver is an API-enforced mandate (domain policy), recorded on every choice
// through the opaque actorRef.
//
// Assessment trigger (M18): the seed creates CA-001 under the lender's authority; otherwise the lender's first
// GET /cases/:id or saveAssessment creates it through workflow/sharing ensureLenderAssessment (actAs the lender,
// snapshot copied from the lender's verifier-signed AttestationDisclosure) before the review starts.
import { STATUS_COPY, type ReviewDecisionRequest, type SaveAssessmentRequestSchema } from "@collara/domain";
import type { z } from "zod";
import type { AcsContract, AcsReader } from "../../ledger/acs";
import { ledgerCommands as L } from "../../ledger/builders";
import { PAYLOAD_SCHEMAS, type Payload } from "../../ledger/contracts";
import type { ResolvedActor } from "../../plugins/actor";
import { must, mustBeVisible, sameAnchor } from "../preconditions";
import { workflowProblems } from "../problems";
import type { CommittedStep, WorkflowOutcome } from "../run";
import { findCase, guardUnlessReplay, nextRef, type CaseScope, type FinanceDeps } from "../financing/common";
import { ensureLenderAssessment } from "../sharing";

type Assessment = AcsContract<Payload<"CollateralAssessment">>;
export type SaveAssessmentInput = z.output<typeof SaveAssessmentRequestSchema>;

/** The committed assessment version (decoded from the created contract of the transaction). */
export interface AssessmentState {
  readonly assessmentRef: string;
  readonly status: Payload<"CollateralAssessment">["status"];
  readonly version: number;
}

const OPEN_FOR_START: readonly string[] = ["SUBMITTED", "NEEDS_INFORMATION"];

/** The lender's newest active assessment of a case (by version), or null. */
export async function latestAssessment(acs: AcsReader, namespace: string, where: (a: Payload<"CollateralAssessment">) => boolean): Promise<Assessment | null> {
  const rows = await acs.list("CollateralAssessment", (a) => a.namespace === namespace && where(a));
  return rows.sort((a, b) => a.payload.version - b.payload.version || a.offset - b.offset).at(-1) ?? null;
}

function assessmentStateOf(step: CommittedStep): AssessmentState | null {
  const created = step.created.find((c) => c.template === "CollateralAssessment");
  if (!created) return null;
  const a = PAYLOAD_SCHEMAS.CollateralAssessment.parse(created.argument);
  return { assessmentRef: a.assessmentRef, status: a.status, version: a.version };
}

/** Resolves a review by its ref (CA-…) in the member's view; 404-shaped otherwise. */
export function findReview(deps: FinanceDeps, member: ResolvedActor, reviewRef: string): Promise<CaseScope> {
  return findCase(deps, member, (c) => c.review.ref !== "" && c.review.ref === reviewRef);
}

// --- POST /cases/:id/assessments ------------------------------------------------------------------------

export async function saveAssessment(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  input: SaveAssessmentInput,
  idempotencyKey: string,
): Promise<WorkflowOutcome<AssessmentState>> {
  const operation = "review.saveAssessment";
  await guardUnlessReplay(deps, scope, member, "review.saveAssessment", operation, idempotencyKey);
  const caseRef = scope.facts.ref;
  // M18 when it has not happened yet (builder A's single creation path, keyed per case and disclosure).
  const opened = await ensureLenderAssessment({ db: deps.db, workflow: deps.workflow, member, caseRef, facts: scope.facts, now: scope.now });
  if (opened && !opened.committed) return { ...opened, result: null };
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.sequence({
    actor,
    operation,
    idempotencyKey,
    payload: { caseId: caseRef, input },
    resourceRef: caseRef,
    steps: async (seq) => {
      const namespace = deps.workflow.namespace ?? "";
      const acs = deps.workflow.acs(actor);
      const lender = acs.parties[0] ?? "";
      const ofCase = (a: Payload<"CollateralAssessment">) => a.caseRef === caseRef && a.lender === lender;
      const current = mustBeVisible(await latestAssessment(acs, namespace, ofCase));
      if (OPEN_FOR_START.includes(current.payload.status)) {
        await seq.step("start", {
          prepare: async (ctx) => {
            const a = must(await latestAssessment(ctx.acs, ctx.namespace, ofCase));
            if (!OPEN_FOR_START.includes(a.payload.status)) throw workflowProblems.stateChanged();
            return { commands: [L.assessmentStartReview(a.contractId, { actorRef: ctx.actorRef })] };
          },
          result: assessmentStateOf,
        });
      }
      const fallback: AssessmentState = { assessmentRef: current.payload.assessmentRef, status: "IN_REVIEW", version: 0 };
      return seq.step("save", {
        payload: input,
        prepare: async (ctx) => {
          const a = must(await latestAssessment(ctx.acs, ctx.namespace, ofCase));
          if (a.payload.status !== "IN_REVIEW") throw workflowProblems.stateChanged();
          return {
            commands: [
              L.assessmentSave(a.contractId, {
                newValuation: {
                  value: { amount: input.valuation.amount, currency: input.valuation.currency },
                  source: input.valuationSource,
                  valuationDate: input.valuationDate,
                  limitations: input.limitations,
                },
                newPolicyRef: input.policyRef,
                actorRef: ctx.actorRef,
              }),
            ],
          };
        },
        result: (step) => assessmentStateOf(step) ?? fallback,
      });
    },
  });
}

// --- POST /reviews/:id/submit-for-approval -----------------------------------------------------------------

export async function submitForApproval(deps: FinanceDeps, member: ResolvedActor, scope: CaseScope, idempotencyKey: string): Promise<WorkflowOutcome<AssessmentState>> {
  const operation = "review.submitForApproval";
  await guardUnlessReplay(deps, scope, member, "review.submitForApproval", operation, idempotencyKey);
  const reviewRef = scope.facts.review.ref;
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { reviewRef },
    resourceRef: reviewRef,
    prepare: async (ctx) => {
      const a = mustBeVisible(await latestAssessment(ctx.acs, ctx.namespace, (x) => x.assessmentRef === reviewRef));
      if (a.payload.status !== "IN_REVIEW") throw workflowProblems.stateChanged();
      if (!a.payload.valuation) throw workflowProblems.stateChanged("Save the assessment before submitting it for approval.");
      return { commands: [L.assessmentSubmitForApproval(a.contractId, { actorRef: ctx.actorRef })] };
    },
    result: (step) => assessmentStateOf(step) ?? { assessmentRef: reviewRef, status: "PENDING_APPROVAL", version: 0 },
  });
}

// --- POST /reviews/:id/decision -----------------------------------------------------------------------------

/**
 * Approver decision. ELIGIBLE needs PENDING_APPROVAL on the ledger, so an approver deciding an IN_REVIEW
 * assessment first submits it for approval (step "submit", same approver), then approves.
 */
export async function decideReview(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  input: ReviewDecisionRequest,
  idempotencyKey: string,
): Promise<WorkflowOutcome<AssessmentState>> {
  const operation = "review.decide";
  await guardUnlessReplay(deps, scope, member, "review.decide", operation, idempotencyKey);
  const reviewRef = scope.facts.review.ref;
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.sequence({
    actor,
    operation,
    idempotencyKey,
    payload: { reviewRef, input },
    resourceRef: reviewRef,
    steps: async (seq) => {
      const namespace = deps.workflow.namespace ?? "";
      const acs = deps.workflow.acs(actor);
      const byRef = (x: Payload<"CollateralAssessment">) => x.assessmentRef === reviewRef;
      const current = mustBeVisible(await latestAssessment(acs, namespace, byRef));
      if (input.outcome === "ELIGIBLE" && current.payload.status === "IN_REVIEW") {
        await seq.step("submit", {
          prepare: async (ctx) => {
            const a = must(await latestAssessment(ctx.acs, ctx.namespace, byRef));
            if (a.payload.status !== "IN_REVIEW") throw workflowProblems.stateChanged();
            if (!a.payload.valuation) throw workflowProblems.stateChanged("Save the assessment before recording a decision.");
            return { commands: [L.assessmentSubmitForApproval(a.contractId, { actorRef: ctx.actorRef })] };
          },
          result: assessmentStateOf,
        });
      }
      return seq.step(input.outcome === "ELIGIBLE" ? "approve" : "reject", {
        payload: input,
        prepare: async (ctx) => {
          const a = must(await latestAssessment(ctx.acs, ctx.namespace, byRef));
          const allowed = input.outcome === "ELIGIBLE" ? ["PENDING_APPROVAL"] : ["IN_REVIEW", "PENDING_APPROVAL"];
          if (!allowed.includes(a.payload.status)) throw workflowProblems.stateChanged();
          if (!a.payload.valuation) throw workflowProblems.stateChanged("Save the assessment before recording a decision.");
          // The reviewed snapshot must still be the evidence anchored on the control the lender observes.
          const control = await ctx.acs.latest("AssetControl", (c) => c.assetId === a.payload.assetId && c.namespace === ctx.namespace);
          if (control && control.payload.evidence && !sameAnchor(control.payload.evidence, a.payload.snapshot.evidence)) {
            throw workflowProblems.stateChanged(STATUS_COPY.EVIDENCE_STALE);
          }
          const noticeRef = await nextRef(deps.db, "decisionNotice");
          const args = { noticeRef, sharedFeedback: input.sharedFeedback ?? "", actorRef: ctx.actorRef };
          return { commands: [input.outcome === "ELIGIBLE" ? L.assessmentApprove(a.contractId, args) : L.assessmentReject(a.contractId, args)] };
        },
        result: (step) => assessmentStateOf(step) ?? { assessmentRef: reviewRef, status: input.outcome, version: 0 },
      });
    },
  });
}

// --- POST /reviews/:id/information-requests ---------------------------------------------------------------------

export async function requestReviewInformation(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  input: { message: string },
  idempotencyKey: string,
): Promise<WorkflowOutcome<AssessmentState>> {
  const operation = "review.requestInformation";
  await guardUnlessReplay(deps, scope, member, "review.requestInformation", operation, idempotencyKey);
  const reviewRef = scope.facts.review.ref;
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { reviewRef, input },
    resourceRef: reviewRef,
    prepare: async (ctx) => {
      const a = mustBeVisible(await latestAssessment(ctx.acs, ctx.namespace, (x) => x.assessmentRef === reviewRef));
      if (a.payload.status !== "IN_REVIEW" && a.payload.status !== "PENDING_APPROVAL") throw workflowProblems.stateChanged();
      const noticeRef = await nextRef(deps.db, "decisionNotice");
      return { commands: [L.assessmentRequestInformation(a.contractId, { noticeRef, sharedFeedback: input.message, actorRef: ctx.actorRef })] };
    },
    result: (step) => assessmentStateOf(step) ?? { assessmentRef: reviewRef, status: "NEEDS_INFORMATION", version: 0 },
  });
}
