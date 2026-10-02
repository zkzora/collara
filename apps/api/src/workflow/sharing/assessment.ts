// M18 trigger (daml-model.md §7: create CollateralAssessment, actAs the lender). Decision: the owner's share
// never acts for the lender. The lender's CollateralAssessment (SUBMITTED) is created under the LENDER's own
// authority the first time a selected-lender analyst or approver opens the case (GET /api/cases/:id, see
// routes/workflow/cases.ts) — and any lender-side review endpoint may call `ensureLenderAssessment` first
// (e.g. the review builder's GET /reviews/:id or POST /cases/:id/assessments). It is idempotent:
//   - nothing happens unless the lender's own ACS holds an AttestationDisclosure for the case and the asset
//     control is shared with it (the share committed), and no CollateralAssessment exists for the case;
//   - the command key is deterministic per (case, disclosure), and concurrent calls for the same lender
//     organisation and case are serialised in this process (two analysts opening the case at once).
// The snapshot is copied from the lender's verifier-signed disclosure (snapshotFromDisclosure), never from input.
import { createHash } from "node:crypto";
import type { Db } from "@collara/db";
import { CREDIT_POLICY_REF, hasMandate, type CaseFacts } from "@collara/domain";
import { ledgerCommands as L } from "../../ledger/builders";
import type { ResolvedActor } from "../../plugins/actor";
import type { WorkflowServices } from "../context";
import { must, snapshotFromDisclosure } from "../preconditions";
import { workflowProblems } from "../problems";
import type { WorkflowOutcome } from "../run";
import { allocateFreshRef } from "../cases/read";
import { createdField } from "../cases/steps";

export const REVIEW_OPEN_OPERATION = "review.open";

export interface EnsureLenderAssessmentInput {
  readonly db: Db;
  readonly workflow: WorkflowServices;
  /** The signed-in lender member (session → membership → mandate → binding). */
  readonly member: ResolvedActor;
  readonly caseRef: string;
  /** The case facts as the member sees them (policyRef, selected lender); optional. */
  readonly facts?: CaseFacts | null;
  readonly now?: Date;
}

const inFlight = new Map<string, Promise<WorkflowOutcome<{ assessmentRef: string }> | null>>();

/**
 * Creates the selected lender's CollateralAssessment (status SUBMITTED, version 1) for a shared case when it does
 * not exist yet. Returns null when there is nothing to do (not a lender analyst/approver, not shared with this
 * lender, no disclosure, or the assessment already exists). Throws only for ledger infrastructure problems.
 */
export function ensureLenderAssessment(input: EnsureLenderAssessmentInput): Promise<WorkflowOutcome<{ assessmentRef: string }> | null> {
  const key = `${input.member.orgId}:${input.caseRef}`;
  const running = inFlight.get(key);
  if (running) return running;
  const promise = run(input).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function run(input: EnsureLenderAssessmentInput): Promise<WorkflowOutcome<{ assessmentRef: string }> | null> {
  const { workflow, member, caseRef } = input;
  const isLenderMember =
    (member.roles.includes("LENDER_ANALYST") || member.roles.includes("LENDER_APPROVER")) && (hasMandate(member, "ANALYST") || hasMandate(member, "APPROVER"));
  if (!isLenderMember || !workflow.access) return null;
  if (input.facts && input.facts.selectedLenderOrgId !== member.orgId) return null;
  const actor = await workflow.actorFor(member);
  const lender = actor.business?.party;
  const namespace = workflow.namespace;
  if (!lender || !namespace) return null;

  const acs = workflow.acs(actor);
  const [lenderAssessments, disclosures] = await Promise.all([
    acs.list("CollateralAssessment", (a) => a.lender === lender && a.namespace === namespace),
    acs.list("AttestationDisclosure", (d) => d.recipient === lender && d.caseRef === caseRef),
  ]);
  if (lenderAssessments.some((a) => a.payload.caseRef === caseRef)) return null;
  const disclosure = disclosures.sort((a, b) => a.offset - b.offset).at(-1);
  if (!disclosure) return null;
  const assetId = disclosure.payload.attestation.assetId;
  const controls = await acs.list("AssetControl", (c) => c.assetId === assetId && c.sharedLender === lender && c.namespace === namespace);
  if (controls.length === 0) return null;

  const digest = createHash("sha256").update(disclosure.contractId).digest("hex").slice(0, 16);
  const assessmentRef = await allocateFreshRef(input.db, "assessment", lenderAssessments.map((a) => a.payload.assessmentRef));
  return workflow.run({
    actor,
    operation: REVIEW_OPEN_OPERATION,
    idempotencyKey: `lender-review:${caseRef}:${digest}`,
    payload: { caseRef, disclosure: digest },
    resourceRef: caseRef,
    prepare: async (ctx) => {
      const existing = await ctx.acs.list("CollateralAssessment", (a) => a.lender === lender && a.caseRef === caseRef && a.namespace === ctx.namespace);
      if (existing.length > 0) throw workflowProblems.stateChanged();
      const live = must(await ctx.acs.get("AttestationDisclosure", disclosure.contractId));
      return {
        commands: [
          L.createCollateralAssessment({
            lender,
            borrower: live.payload.owner,
            assessmentRef,
            caseRef,
            namespace: ctx.namespace,
            assetId,
            snapshot: snapshotFromDisclosure(live.payload),
            valuation: null,
            policyRef: input.facts?.policyRef || CREDIT_POLICY_REF,
            lastActorRef: ctx.actorRef,
          }),
        ],
      };
    },
    result: (s) => ({ assessmentRef: createdField(s, "CollateralAssessment", "assessmentRef", assessmentRef) }),
  });
}
