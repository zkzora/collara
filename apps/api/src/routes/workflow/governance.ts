// Governance: GET /verifiers, GET /governance/state, GET /governance/proposals[/:id], POST /governance/proposals,
// POST /governance/proposals/:id/confirmations, /execute, /cancel (API_ENDPOINTS "verifiers.list", "governance.*").
// Registered once under the /api prefix by ./index.ts: declare full paths here.
// Write path: GovernanceService (seat party, readAs governance) through the workflow runner + replyWithOutcome();
// read path: projections → domain GovernanceFacts → presenters. Only governance-seat holders (policy
// `governance.act`) see or act on governance; everyone else gets the 404-shaped `unavailable` problem.
// Governance administers the verifier registry only and can never release collateral (CR-22).
import { governanceState, readLastSync, readViewerOf } from "@collara/db";
import {
  CreateGovernanceProposalRequestSchema,
  GovernanceProposalSchema,
  GovernanceStateSchema,
  presentGovernanceProposal,
  presentGovernanceState,
  VerifierEntrySchema,
  type GovernanceFacts,
} from "@collara/domain";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../../errors";
import { assertPermitted, type ResolvedActor } from "../../plugins/actor";
import { IdempotencyHeadersSchema, replyWithOutcome, workflowResponseSchemas } from "../../workflow";
import { GovernanceService, UNPROJECTED_GOVERNANCE, verifierDirectory } from "../../workflow/governance";
import type { WorkflowRouteOptions } from "./types";

const ProposalParams = z.object({ id: z.string().min(1).max(32) });
/** Browser-supplied fields (party ids, seats, organisations) are accepted and ignored: authority is server-side. */
const IgnoredBody = z.looseObject({}).nullish();

export const governanceRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, { services, workflow, mode }) => {
  const db = services.db.db;
  const governance = new GovernanceService(workflow, db, {
    onSyncProblem: ({ proposalRef, error }) => app.log.warn({ proposalRef, err: error }, "registrar sync after a governed execute did not commit"),
  });

  /** Seat holders only: anyone else gets the 404-shaped `unavailable` (401 when not signed in). */
  const seatHolder = async (request: FastifyRequest): Promise<ResolvedActor> => {
    const member = await request.requireActor();
    assertPermitted(member, "governance.act", {});
    return member;
  };

  const facts = async (member: ResolvedActor, now: Date): Promise<GovernanceFacts> =>
    (await governanceState(db, readViewerOf(member), { now })) ?? UNPROJECTED_GOVERNANCE;

  const pctx = async (now: Date) => ({ now, mode, sync: await readLastSync(db) });

  app.get(
    "/verifiers",
    {
      schema: {
        tags: ["governance"],
        summary: "Verifier registry (governance-administered); open proposals only for governance seats",
        response: { 200: z.array(VerifierEntrySchema) },
      },
    },
    async (request) => {
      const member = await request.requireActor();
      return verifierDirectory(db, member, { now: services.clock(), mode });
    },
  );

  app.get(
    "/governance/state",
    { schema: { tags: ["governance"], summary: "Tier A governance: threshold, seats, registry version, integration status", response: { 200: GovernanceStateSchema } } },
    async (request) => {
      const member = await seatHolder(request);
      const now = services.clock();
      return presentGovernanceState(await facts(member, now), member, await pctx(now));
    },
  );

  app.get(
    "/governance/proposals",
    { schema: { tags: ["governance"], summary: "Governed verifier proposals (newest first)", response: { 200: z.array(GovernanceProposalSchema) } } },
    async (request) => {
      const member = await seatHolder(request);
      const now = services.clock();
      const gov = await facts(member, now);
      const context = await pctx(now);
      return [...gov.proposals]
        .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt) || b.ref.localeCompare(a.ref))
        .map((p) => presentGovernanceProposal(p, gov, member, context));
    },
  );

  app.get(
    "/governance/proposals/:id",
    { schema: { tags: ["governance"], summary: "One governed proposal with live confirmations", params: ProposalParams, response: { 200: GovernanceProposalSchema } } },
    async (request) => {
      const member = await seatHolder(request);
      const now = services.clock();
      const gov = await facts(member, now);
      const proposal = gov.proposals.find((p) => p.ref === request.params.id);
      if (!proposal) throw problems.unavailable();
      return presentGovernanceProposal(proposal, gov, member, await pctx(now));
    },
  );

  app.post(
    "/governance/proposals",
    {
      schema: {
        tags: ["governance"],
        summary: "Propose Add / Suspend verifier (seat), pinned to the live registry; the proposer's confirmation is included",
        headers: IdempotencyHeadersSchema,
        body: CreateGovernanceProposalRequestSchema,
        response: workflowResponseSchemas(z.object({ proposalRef: z.string() })),
      },
    },
    async (request, reply) => {
      const member = await seatHolder(request);
      const actor = await workflow.actorFor(member);
      const outcome = await governance.propose({ actor, idempotencyKey: request.headers["idempotency-key"], request: request.body });
      const result = outcome.result ? { proposalRef: outcome.result.proposalRef } : null;
      return replyWithOutcome(reply, { ...outcome, result });
    },
  );

  const proposalAction = (path: string, summary: string, run: (input: { actor: Awaited<ReturnType<typeof workflow.actorFor>>; idempotencyKey: string; proposalRef: string }) => Promise<Parameters<typeof replyWithOutcome>[1]>) =>
    app.post(
      path,
      { schema: { tags: ["governance"], summary, params: ProposalParams, headers: IdempotencyHeadersSchema, body: IgnoredBody, response: workflowResponseSchemas() } },
      async (request, reply) => {
        const member = await seatHolder(request);
        const actor = await workflow.actorFor(member);
        const outcome = await run({ actor, idempotencyKey: request.headers["idempotency-key"], proposalRef: request.params.id });
        return replyWithOutcome(reply, { ...outcome, result: null });
      },
    );

  proposalAction("/governance/proposals/:id/confirmations", "Confirm a proposal as your governance seat (GovernanceRules_ConfirmAction)", (input) => governance.confirm(input));
  proposalAction("/governance/proposals/:id/execute", "Execute with the live confirmations of distinct seats (GovernanceRules_ExecuteConfirmedAction)", (input) => governance.execute(input));
  proposalAction("/governance/proposals/:id/cancel", "Withdraw your own open proposal (GovernableAction_ProposerCancel)", (input) => governance.cancel(input));
};
