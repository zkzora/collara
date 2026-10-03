// Financing proposal and activation authorization (daml-model.md §4.7, §7 W5–W7). Terms live only in
// FinancingProposal / FinancingAgreement (stakeholders: the lender and the borrower).
//   ISSUE: Assessment_IssueProposal on the lender's ELIGIBLE assessment (version 1); an issued proposal that
//          expired unanswered gets a new version through Proposal_Revise (same ref, version + 1).
//   DRAFT: lender-internal and off-ledger: an APPLICATION command record only (no ledger transaction).
//   accept / decline (borrower, exact ref + version), withdraw (lender approver, before acceptance),
//   activation authorization (borrower, Agreement_AuthorizeActivation pinned to the current control version).
import {
  effectiveProposalState,
  latestProposal,
  nextFreeRef,
  STATUS_COPY,
  type CommandStatus,
  type CreateProposalRequestSchema,
} from "@collara/domain";
import type { z } from "zod";
import { ledgerCommands as L } from "../../ledger/builders";
import { PAYLOAD_SCHEMAS } from "../../ledger/contracts";
import { problems } from "../../errors";
import type { ResolvedActor } from "../../plugins/actor";
import { must, sameAnchor } from "../preconditions";
import { workflowProblems } from "../problems";
import type { CommittedStep, WorkflowOutcome } from "../run";
import { latestAssessment } from "../review/assessment";
import { addDays, findCase, guardCase, isPast, isReplay, nextRef, type CaseScope, type FinanceDeps } from "./common";

export type CreateProposalInput = z.output<typeof CreateProposalRequestSchema>;

export interface ProposalRefResult {
  readonly proposalRef: string;
  readonly version: number;
}

/** Copy of the UI_MOCK client for an exact-version mismatch (INFERRED, kept identical for parity). */
export const PROPOSAL_COPY = {
  NEWER_VERSION_ACCEPT: "This proposal has a newer version. Review it before accepting.",
  NEWER_VERSION_DECLINE: "This proposal has a newer version. Review it before declining.",
  AUTHORIZE_ACCEPTED_VERSION: "Authorization must reference the accepted proposal version.",
} as const;

/** Resolves a proposal by ref (FP-…) in the member's view; 404-shaped otherwise. */
export function findProposal(deps: FinanceDeps, member: ResolvedActor, proposalRef: string): Promise<CaseScope> {
  return findCase(deps, member, (c) => c.proposals.some((p) => p.ref === proposalRef));
}

function proposalOf(step: CommittedStep): ProposalRefResult | null {
  const created = step.created.find((c) => c.template === "FinancingProposal");
  if (!created) return null;
  const p = PAYLOAD_SCHEMAS.FinancingProposal.parse(created.argument);
  return { proposalRef: p.proposalRef, version: p.version };
}

const isZero = (amount: string) => /^0+(\.0+)?$/.test(amount);

// --- POST /cases/:id/proposals ----------------------------------------------------------------------------

export type CreateProposalOutcome =
  | { readonly kind: "ledger"; readonly outcome: WorkflowOutcome<ProposalRefResult>; readonly pending: ProposalRefResult }
  | { readonly kind: "application"; readonly command: CommandStatus; readonly result: ProposalRefResult };

export async function createProposal(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  input: CreateProposalInput,
  idempotencyKey: string,
): Promise<CreateProposalOutcome> {
  if (isZero(input.principal.amount)) {
    throw problems.validation([{ path: "body.principal.amount", message: "The principal must be greater than zero." }]);
  }
  const caseRef = scope.facts.ref;
  const latest = latestProposal(scope.facts);

  if (input.intent === "DRAFT") {
    // Drafts are lender-internal working copies: recorded as an application command, never on the ledger.
    const operation = "proposal.draft";
    const service = deps.workflow.runner.commands;
    const command = { actor: member, operation, idempotencyKey, payload: { caseId: caseRef, input }, target: "APPLICATION", resourceRef: caseRef } as const;
    // Only a settled command replays without the precondition; an unfinished one is checked like a new request.
    const prior = await service.findCommand(command);
    if (!prior || prior.status === "PREPARED") guardCase(scope, member, "proposal.draft");
    const { record } = await service.createOrGetCommand(command);
    const result: ProposalRefResult = {
      proposalRef: latest?.ref ?? nextFreeRef("proposal", scope.facts.proposals.map((p) => p.ref)),
      version: (latest?.version ?? 0) + 1,
    };
    const committed = await service.completeApplicationCommand(record, result, caseRef);
    const stored = (committed.result ?? result) as ProposalRefResult;
    return { kind: "application", command: service.toStatus(committed), result: stored };
  }

  const operation = "proposal.issue";
  if (!(await isReplay(deps.db, member, operation, idempotencyKey))) guardCase(scope, member, "proposal.issue");
  const actor = await deps.workflow.actorFor(member);
  const outcome = await deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { caseId: caseRef, input },
    resourceRef: caseRef,
    prepare: async (ctx) => {
      const lender = ctx.acs.parties[0] ?? "";
      const ofCase = (p: { caseRef: string; namespace: string }) => p.caseRef === caseRef && p.namespace === ctx.namespace;
      if ((await ctx.acs.list("FinancingAgreement", (a) => ofCase(a) && a.lender === lender)).length > 0) throw workflowProblems.stateChanged();
      const active = await ctx.acs.list("FinancingProposal", (p) => ofCase(p) && p.lender === lender);
      if (active.some((p) => !isPast(p.payload.expiresAt, ctx.now))) throw workflowProblems.stateChanged();
      const expiresAt = addDays(ctx.now, input.expiresInDays);
      const expired = active.sort((a, b) => a.payload.version - b.payload.version).at(-1);
      if (expired) {
        // An issued version expired unanswered: the new terms are its next version (a new acceptance is needed).
        return {
          commands: [
            L.proposalRevise(expired.contractId, {
              newPrincipal: input.principal,
              newTermMetadata: input.termMetadata ?? "",
              newExternalLegalRef: input.externalLegalRef ?? "",
              newExpiresAt: expiresAt,
              actorRef: ctx.actorRef,
            }),
          ],
        };
      }
      const assessment = must(await latestAssessment(ctx.acs, ctx.namespace, (a) => a.caseRef === caseRef && a.lender === lender));
      if (assessment.payload.status !== "ELIGIBLE") throw workflowProblems.stateChanged();
      if (isPast(assessment.payload.snapshot.attestationValidUntil, ctx.now)) throw workflowProblems.attestationExpired();
      const taken = [
        ...(await ctx.acs.list("FinancingProposal")).map((p) => p.payload.proposalRef),
        ...(await ctx.acs.list("FinancingAgreement")).map((a) => a.payload.agreementRef),
      ];
      const proposalRef = await nextRef(deps.db, "proposal", taken);
      return {
        commands: [
          L.assessmentIssueProposal(assessment.contractId, {
            proposalRef,
            principal: input.principal,
            termMetadata: input.termMetadata ?? "",
            externalLegalRef: input.externalLegalRef ?? "",
            expiresAt,
            actorRef: ctx.actorRef,
          }),
        ],
      };
    },
    result: (step) => proposalOf(step) ?? { proposalRef: latest?.ref ?? "", version: (latest?.version ?? 0) + 1 },
  });
  return { kind: "ledger", outcome, pending: { proposalRef: latest?.ref ?? "", version: (latest?.version ?? 0) + 1 } };
}

// --- POST /proposals/:id/acceptance | /decline | /withdraw ----------------------------------------------------

export async function respondToProposal(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  proposalRef: string,
  input: { readonly decision: "ACCEPT" | "DECLINE"; readonly expectedVersion: number; readonly reason?: string },
  idempotencyKey: string,
): Promise<WorkflowOutcome<{ proposalRef: string; version: number }>> {
  const accept = input.decision === "ACCEPT";
  const operation = accept ? "proposal.accept" : "proposal.decline";
  const newer = accept ? PROPOSAL_COPY.NEWER_VERSION_ACCEPT : PROPOSAL_COPY.NEWER_VERSION_DECLINE;
  if (!(await isReplay(deps.db, member, operation, idempotencyKey))) {
    guardCase(scope, member, accept ? "proposal.accept" : "proposal.decline");
    const latest = latestProposal(scope.facts);
    if (!latest || latest.ref !== proposalRef || latest.version !== input.expectedVersion) throw problems.stateConflict(newer);
  }
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { proposalRef, expectedVersion: input.expectedVersion, ...(input.reason ? { reason: input.reason } : {}) },
    resourceRef: proposalRef,
    prepare: async (ctx) => {
      const borrower = ctx.acs.parties[0] ?? "";
      const proposal = must(await ctx.acs.latest("FinancingProposal", (p) => p.proposalRef === proposalRef && p.borrower === borrower && p.namespace === ctx.namespace));
      // Exact version: the borrower accepts (or declines) precisely the version it reviewed.
      if (proposal.payload.version !== input.expectedVersion) throw problems.stateConflict(newer);
      if (accept && isPast(proposal.payload.expiresAt, ctx.now)) throw workflowProblems.stateChanged();
      return {
        commands: [
          accept
            ? L.proposalAccept(proposal.contractId, { expectedProposalRef: proposalRef, expectedVersion: input.expectedVersion, actorRef: ctx.actorRef })
            : L.proposalDecline(proposal.contractId, { reason: input.reason ?? "", actorRef: ctx.actorRef }),
        ],
      };
    },
    result: () => ({ proposalRef, version: input.expectedVersion }),
  });
}

export async function withdrawProposal(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  proposalRef: string,
  input: { readonly reason?: string | undefined },
  idempotencyKey: string,
): Promise<WorkflowOutcome<{ proposalRef: string }>> {
  const operation = "proposal.withdraw";
  if (!(await isReplay(deps.db, member, operation, idempotencyKey))) guardCase(scope, member, "proposal.withdraw");
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { proposalRef, reason: input.reason ?? null },
    resourceRef: proposalRef,
    prepare: async (ctx) => {
      const lender = ctx.acs.parties[0] ?? "";
      const proposal = must(await ctx.acs.latest("FinancingProposal", (p) => p.proposalRef === proposalRef && p.lender === lender && p.namespace === ctx.namespace));
      return { commands: [L.proposalWithdraw(proposal.contractId, { reason: input.reason ?? "", actorRef: ctx.actorRef })] };
    },
    result: () => ({ proposalRef }),
  });
}

// --- POST /proposals/:id/activation-authorization ---------------------------------------------------------------

export async function authorizeActivation(
  deps: FinanceDeps,
  member: ResolvedActor,
  scope: CaseScope,
  proposalRef: string,
  input: { readonly expectedVersion: number },
  idempotencyKey: string,
): Promise<WorkflowOutcome<{ authorizationRef: string; expectedControlVersion: number }>> {
  const operation = "activation.authorize";
  if (!(await isReplay(deps.db, member, operation, idempotencyKey))) {
    guardCase(scope, member, "activation.authorize");
    const latest = latestProposal(scope.facts);
    if (!latest || latest.ref !== proposalRef || latest.version !== input.expectedVersion || effectiveProposalState(latest, scope.now) !== "ACCEPTED") {
      throw problems.stateConflict(PROPOSAL_COPY.AUTHORIZE_ACCEPTED_VERSION);
    }
  }
  const actor = await deps.workflow.actorFor(member);
  return deps.workflow.run({
    actor,
    operation,
    idempotencyKey,
    payload: { proposalRef, expectedVersion: input.expectedVersion },
    resourceRef: proposalRef,
    prepare: async (ctx) => {
      const borrower = ctx.acs.parties[0] ?? "";
      const agreement = must(
        await ctx.acs.latest(
          "FinancingAgreement",
          (a) => a.agreementRef === proposalRef && a.proposalVersion === input.expectedVersion && a.borrower === borrower && a.namespace === ctx.namespace,
        ),
        () => problems.stateConflict(PROPOSAL_COPY.AUTHORIZE_ACCEPTED_VERSION),
      );
      const a = agreement.payload;
      // The authorization pins the control version and evidence the activation will consume.
      const control = must(await ctx.acs.one("AssetControl", (c) => c.assetId === a.assetId && c.namespace === ctx.namespace));
      if (control.payload.sharedLender !== a.lender) throw workflowProblems.stateChanged();
      if (!sameAnchor(control.payload.evidence, a.snapshot.evidence)) throw workflowProblems.stateChanged(STATUS_COPY.EVIDENCE_STALE);
      if (isPast(a.snapshot.attestationValidUntil, ctx.now)) throw workflowProblems.attestationExpired();
      const open = await ctx.acs.list("PledgeActivationAuthorization", (x) => x.caseRef === a.caseRef && x.namespace === ctx.namespace && !isPast(x.expiresAt, ctx.now));
      if (open.length > 0) throw workflowProblems.stateChanged();
      const taken = (await ctx.acs.list("PledgeActivationAuthorization")).map((x) => x.payload.authorizationRef);
      const authorizationRef = await nextRef(deps.db, "activationAuthorization", taken);
      return {
        commands: [
          L.agreementAuthorizeActivation(agreement.contractId, {
            authorizationRef,
            expectedControlVersion: control.payload.controlVersion,
            expiresAt: addDays(ctx.now, 7),
            actorRef: ctx.actorRef,
          }),
        ],
      };
    },
    result: (step) => {
      const created = step.created.find((c) => c.template === "PledgeActivationAuthorization");
      const auth = created ? PAYLOAD_SCHEMAS.PledgeActivationAuthorization.parse(created.argument) : null;
      return { authorizationRef: auth?.authorizationRef ?? "", expectedControlVersion: auth?.expectedControlVersion ?? 0 };
    },
  });
}
