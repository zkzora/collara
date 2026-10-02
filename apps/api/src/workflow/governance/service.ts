// Tier A governance write path (daml-model.md §4.8 + §7 "Governed verifier changes", research-dm.md §3–§7):
//   propose  seat creates AddVerifierProposal / SuspendVerifierProposal pinned to the live registry cid + version,
//            then confirms it (DM's propose auto-confirms; the UI_MOCK client does the same)
//   confirm  GovernanceRules_ConfirmAction as the seat party, readAs the governance party
//   execute  GovernanceRules_ExecuteConfirmedAction with the newest live confirmation per member; then the
//            registrar service syncs CollaraConfig.directory / the VerifierStatusMirror (attributed to
//            system:registrar)
//   cancel   GovernableAction_ProposerCancel by the proposer seat
// Every submission acts as the SEAT party (never the organisation's business party). Preconditions are read
// fresh from the seat's ACS; the ledger re-checks all of them at commit. Governance administers the verifier
// registry only: no code path here references collateral contracts or choices (CR-22, static test).
import { organizations, partyBindings, type Db } from "@collara/db";
import { nextFreeRef, type CreateGovernanceProposalRequest } from "@collara/domain";
import { and, eq } from "drizzle-orm";
import { problems } from "../../errors";
import { ledgerCommands as L } from "../../ledger/builders";
import { VerifierAccreditationSchema } from "../../ledger/contracts";
import { LEDGER_ENVIRONMENT, requireIdentity, type WorkflowActor } from "../actors";
import type { WorkflowServices } from "../context";
import { must } from "../preconditions";
import { workflowProblems } from "../problems";
import type { PrepareContext, WorkflowOutcome } from "../run";
import { governedProposalHistory, openProposals, readGovernanceLedger, type GovernanceLedger, type ProposalHistoryEntry } from "./ledger";
import {
  ACCREDITATION_VALID_DAYS,
  executableConfirmations,
  GOVERNANCE_COPY,
  governanceProposalRef,
  ledgerScopeOf,
  PROPOSAL_DEADLINE_DAYS,
  proposalStaleness,
} from "./rules";

const DAY = 86_400_000;

export interface ProposeResult {
  readonly proposalRef: string;
  readonly proposalCid: string | null;
}

export interface ConfirmResult {
  readonly proposalRef: string;
  readonly confirmationCid: string | null;
}

export interface RegistrarSyncState {
  readonly step: "config" | "mirror";
  /** CommandState of the registrar's command record, or FAILED when it could not be attempted. */
  readonly state: string;
  readonly updateId: string | null;
}

export interface ExecuteResult {
  readonly proposalRef: string;
  readonly type: "ADD_VERIFIER" | "SUSPEND_VERIFIER" | null;
  readonly executionResultCid: string | null;
  readonly accreditationCid: string | null;
  readonly verifierRef: string | null;
  /** Registrar follow-ups (directory, mirror). The execute itself is committed either way. */
  readonly registrarSync: readonly RegistrarSyncState[];
}

interface SeatIdentity {
  readonly party: string;
  readonly governanceParty: string;
}

/** The seat identity to act with (503 when the seat or the governance party has no ledger binding). */
function seatOf(actor: WorkflowActor): SeatIdentity {
  const seat = requireIdentity(actor, "seat");
  if (!actor.governanceParty) throw workflowProblems.ledgerUnavailable();
  return { party: seat.party, governanceParty: actor.governanceParty };
}

export interface GovernanceServiceOptions {
  /** Called when a registrar follow-up after an execute could not commit (the execute stays committed). */
  readonly onSyncProblem?: (detail: { proposalRef: string; error: unknown }) => void;
}

export class GovernanceService {
  readonly #workflow: WorkflowServices;
  readonly #db: Db;
  readonly #options: GovernanceServiceOptions;

  constructor(workflow: WorkflowServices, db: Db, options: GovernanceServiceOptions = {}) {
    this.#workflow = workflow;
    this.#db = db;
    this.#options = options;
  }

  /** POST /governance/proposals: create (pinned) + the proposer's own confirmation, one sequence. */
  async propose(input: { actor: WorkflowActor; idempotencyKey: string; request: CreateGovernanceProposalRequest }): Promise<WorkflowOutcome<ProposeResult>> {
    const { actor, request } = input;
    const seat = seatOf(actor);
    // Add: the verifier party comes from an onboarded organisation's server-side binding, never from the body.
    const org = request.type === "ADD_VERIFIER" ? await this.onboardedVerifier(request.orgName) : null;
    return this.#workflow.sequence<ProposeResult>({
      actor,
      operation: "governance.propose",
      idempotencyKey: input.idempotencyKey,
      payload: request,
      steps: async (seq) => {
        let planned: string | null = null;
        const created = await seq.step<ProposeResult>("create", {
          payload: { request, verifierOrgId: org?.orgId ?? null },
          prepare: async (ctx) => {
            const gov = await this.#load(ctx, seat);
            const registry = must(gov.registry);
            const history = await governedProposalHistory(must(ctx.seatAcs).client, { governanceParty: seat.governanceParty, members: gov.members });
            planned = governanceProposalRef(history.length);
            const open = openProposals(gov, ctx.now);
            const openFor = (verifier: string) => open.some((p) => p.proposal.payload.verifier === verifier);
            const proposalDeadline = new Date(ctx.now.getTime() + PROPOSAL_DEADLINE_DAYS * DAY);
            const pinned = { governanceParty: seat.governanceParty, proposer: seat.party, registryCid: registry.contractId, expectedVersion: registry.payload.version };

            if (request.type === "ADD_VERIFIER") {
              const verifier = must(org);
              if (registry.payload.activeVerifiers.includes(verifier.party) || openFor(verifier.party)) throw problems.stateConflict(GOVERNANCE_COPY.CANNOT_ADD);
              // Re-accreditation of a known verifier keeps its ref (one registry entry per organisation).
              const known = gov.accreditations.filter((a) => a.payload.verifier === verifier.party).at(-1);
              const taken = [
                ...gov.accreditations.map((a) => a.payload.verifierRef),
                ...open.flatMap((p) => (p.proposal.type === "ADD_VERIFIER" ? [p.proposal.payload.verifierRef] : [])),
              ];
              return {
                as: "seat",
                commands: [
                  L.createAddVerifierProposal({
                    ...pinned,
                    verifier: verifier.party,
                    verifierRef: known?.payload.verifierRef ?? nextFreeRef("verifier", taken),
                    orgName: verifier.name,
                    scope: ledgerScopeOf(request.scope),
                    validUntil: new Date(ctx.now.getTime() + ACCREDITATION_VALID_DAYS * DAY),
                    proposalDeadline,
                    reason: request.rationale,
                  }),
                ],
              };
            }

            const matching = gov.accreditations.filter((a) => a.payload.verifierRef === request.verifierRef);
            if (matching.length === 0) throw workflowProblems.unavailable();
            const active = matching.filter((a) => a.payload.status === "ACTIVE").at(-1);
            if (!active || !registry.payload.activeVerifiers.includes(active.payload.verifier) || openFor(active.payload.verifier)) {
              throw problems.stateConflict(GOVERNANCE_COPY.CANNOT_SUSPEND);
            }
            return {
              as: "seat",
              commands: [
                L.createSuspendVerifierProposal({
                  ...pinned,
                  accreditationCid: active.contractId,
                  verifier: active.payload.verifier,
                  proposalDeadline,
                  reason: request.rationale,
                }),
              ],
            };
          },
          result: async (step) => {
            const template = request.type === "ADD_VERIFIER" ? "AddVerifierProposal" : "SuspendVerifierProposal";
            const entry = await this.#historyEntry(actor, seat, { contractId: step.createdOf(template), offset: step.offset }).catch(() => null);
            return { proposalRef: entry?.ref ?? planned ?? "", proposalCid: entry?.contractId ?? step.createdOf(template) };
          },
        });

        const proposalCid = must(created.proposalCid);
        await seq.step("confirm", {
          payload: { proposalCid },
          prepare: async (ctx) => {
            const gov = await this.#load(ctx, seat);
            if (!gov.proposals.some((p) => p.contractId === proposalCid)) throw workflowProblems.stateChanged();
            return { as: "seat", commands: [L.confirmAction(gov.rules.contractId, { confirmer: seat.party, actionProposalCid: proposalCid })] };
          },
          result: (step) => ({ confirmationCid: step.createdOf("GovernanceConfirmation") }),
        });
        return created;
      },
    });
  }

  /** POST /governance/proposals/:id/confirmations: one confirmation by the seat (never twice while live). */
  async confirm(input: { actor: WorkflowActor; idempotencyKey: string; proposalRef: string }): Promise<WorkflowOutcome<ConfirmResult>> {
    const { actor, proposalRef } = input;
    const seat = seatOf(actor);
    return this.#workflow.run<ConfirmResult>({
      actor,
      operation: "governance.confirm",
      idempotencyKey: input.idempotencyKey,
      payload: { proposalRef },
      resourceRef: proposalRef,
      prepare: async (ctx) => {
        const { gov, active } = await this.#resolve(ctx, seat, proposalRef);
        if (!active || this.#stale(gov, active.proposal.payload, ctx.now)) throw problems.stateConflict(GOVERNANCE_COPY.CANNOT_CONFIRM);
        const live = executableConfirmations(gov.confirmations.map(flatConfirmation), { proposalCid: active.contractId, members: gov.members, now: ctx.now });
        if (live.some((c) => c.confirmer === seat.party)) throw problems.stateConflict(GOVERNANCE_COPY.CANNOT_CONFIRM);
        return { as: "seat", commands: [L.confirmAction(gov.rules.contractId, { confirmer: seat.party, actionProposalCid: active.contractId })] };
      },
      result: (step) => ({ proposalRef, confirmationCid: step.createdOf("GovernanceConfirmation") }),
    });
  }

  /** POST /governance/proposals/:id/execute: execute with the live confirmations, then the registrar sync. */
  async execute(input: { actor: WorkflowActor; idempotencyKey: string; proposalRef: string }): Promise<WorkflowOutcome<ExecuteResult>> {
    const { actor, proposalRef } = input;
    const seat = seatOf(actor);
    return this.#workflow.sequence<ExecuteResult>({
      actor,
      operation: "governance.execute",
      idempotencyKey: input.idempotencyKey,
      payload: { proposalRef },
      resourceRef: proposalRef,
      steps: async (seq) => {
        let planned: { type: ExecuteResult["type"]; verifier: string } | null = null;
        const executed = await seq.step<Omit<ExecuteResult, "registrarSync"> & { verifierParty: string | null }>("execute", {
          payload: { proposalRef },
          prepare: async (ctx) => {
            const { gov, active } = await this.#resolve(ctx, seat, proposalRef);
            if (!active || this.#stale(gov, active.proposal.payload, ctx.now)) throw workflowProblems.stateChanged();
            const live = executableConfirmations(gov.confirmations.map(flatConfirmation), { proposalCid: active.contractId, members: gov.members, now: ctx.now });
            if (live.length < gov.threshold) throw problems.stateConflict(GOVERNANCE_COPY.needsConfirmations(gov.threshold));
            planned = { type: active.proposal.type, verifier: active.proposal.payload.verifier };
            return {
              as: "seat",
              commands: [L.executeConfirmedAction(gov.rules.contractId, { executor: seat.party, actionProposalCid: active.contractId, confirmations: live.map((c) => c.contractId) })],
            };
          },
          result: (step) => {
            const created = step.created.find((c) => c.template === "VerifierAccreditation");
            const accreditation = created ? VerifierAccreditationSchema.safeParse(created.argument) : null;
            const decoded = accreditation?.success ? accreditation.data : null;
            const type = planned?.type ?? (decoded ? (decoded.status === "SUSPENDED" ? "SUSPEND_VERIFIER" : "ADD_VERIFIER") : null);
            return {
              proposalRef,
              type,
              executionResultCid: step.createdOf("GovernanceExecutionResult"),
              accreditationCid: created?.contractId ?? null,
              verifierRef: decoded?.verifierRef ?? null,
              verifierParty: decoded?.verifier ?? planned?.verifier ?? null,
            };
          },
        });
        const { verifierParty, ...rest } = executed;
        const registrarSync = verifierParty ? await this.#syncRegistrar(seq.parent.id, { verifierParty, sourceRef: proposalRef, addToDirectory: rest.type === "ADD_VERIFIER" }) : [];
        return { ...rest, registrarSync };
      },
    });
  }

  /** POST /governance/proposals/:id/cancel: GovernableAction_ProposerCancel by the proposer seat. */
  async cancel(input: { actor: WorkflowActor; idempotencyKey: string; proposalRef: string }): Promise<WorkflowOutcome<{ proposalRef: string }>> {
    const { actor, proposalRef } = input;
    const seat = seatOf(actor);
    return this.#workflow.run({
      actor,
      operation: "governance.cancel",
      idempotencyKey: input.idempotencyKey,
      payload: { proposalRef },
      resourceRef: proposalRef,
      prepare: async (ctx) => {
        const { gov, entry, active } = await this.#resolve(ctx, seat, proposalRef);
        if (entry.proposal.payload.proposer !== seat.party) throw problems.forbidden();
        if (!active || this.#stale(gov, active.proposal.payload, ctx.now)) throw problems.stateConflict(GOVERNANCE_COPY.ONLY_OPEN_WITHDRAWN);
        return { as: "seat", commands: [L.proposerCancel(active.contractId)] };
      },
      result: () => ({ proposalRef }),
    });
  }

  /** The onboarded verifier organisation with this name (business party from the server-side bindings). */
  async onboardedVerifier(orgName: string): Promise<{ orgId: string; name: string; party: string }> {
    const rows = await this.#db
      .select({ orgId: organizations.id, name: organizations.name, party: partyBindings.partyId })
      .from(organizations)
      .innerJoin(
        partyBindings,
        and(eq(partyBindings.orgId, organizations.id), eq(partyBindings.kind, "business"), eq(partyBindings.state, "ACTIVE"), eq(partyBindings.environment, LEDGER_ENVIRONMENT)),
      )
      .where(and(eq(organizations.type, "VERIFIER"), eq(organizations.state, "ACTIVE")));
    const wanted = orgName.trim().toLowerCase();
    const match = rows.find((r) => r.name.trim().toLowerCase() === wanted);
    if (!match) throw problems.validation([{ path: "orgName", message: GOVERNANCE_COPY.ORG_NOT_ONBOARDED }]);
    return match;
  }

  // --- helpers ---------------------------------------------------------------------------------------

  async #load(ctx: PrepareContext, seat: SeatIdentity): Promise<GovernanceLedger> {
    const acs = must(ctx.seatAcs, workflowProblems.ledgerUnavailable);
    const gov = await readGovernanceLedger(acs, { governanceParty: seat.governanceParty, namespace: ctx.namespace });
    // A seat mandate whose party is not (or no longer) a member of the rules may not act.
    if (!gov.members.includes(seat.party)) throw problems.forbidden();
    return gov;
  }

  /** The proposal behind a display ref: 404 for an unknown ref, `active` null once executed or cancelled. */
  async #resolve(ctx: PrepareContext, seat: SeatIdentity, proposalRef: string) {
    const gov = await this.#load(ctx, seat);
    const history = await governedProposalHistory(must(ctx.seatAcs).client, { governanceParty: seat.governanceParty, members: gov.members });
    const entry = history.find((h) => h.ref === proposalRef);
    if (!entry) throw workflowProblems.unavailable();
    const active = gov.proposals.find((p) => p.contractId === entry.contractId) ?? null;
    return { gov, entry, active };
  }

  #stale(gov: GovernanceLedger, payload: { registryCid: string; expectedVersion: number; proposalDeadline: string }, now: Date): boolean {
    const registry = gov.registry ? { contractId: gov.registry.contractId, version: gov.registry.payload.version } : null;
    return proposalStaleness(payload, registry, now) !== null;
  }

  /** History entry of a just-created proposal (by contract id, else by its creation offset). */
  async #historyEntry(actor: WorkflowActor, seat: SeatIdentity, created: { contractId: string | null; offset: number }): Promise<ProposalHistoryEntry | null> {
    const acs = this.#workflow.acs(actor, "seat");
    const rules = must(await acs.one("GovernanceRules", (r) => r.governanceParty === seat.governanceParty));
    const history = await governedProposalHistory(acs.client, { governanceParty: seat.governanceParty, members: rules.payload.members, endInclusive: created.offset });
    return history.find((h) => h.contractId === created.contractId) ?? history.find((h) => h.offset === created.offset) ?? null;
  }

  /**
   * Registrar follow-ups after an executed proposal (daml-model.md §7): an Add puts the verifier in
   * CollaraConfig.directory, then the verifier's status mirror is published or re-synced from its live
   * accreditation. Failures are reported, never thrown: the governed execute is already committed (mirror
   * latency is a documented trust assumption, daml-model.md §8.3).
   */
  async #syncRegistrar(parentId: string, input: { verifierParty: string; sourceRef: string; addToDirectory: boolean }): Promise<RegistrarSyncState[]> {
    const states: RegistrarSyncState[] = [];
    const registrar = this.#workflow.registrar;
    try {
      const acs = this.#workflow.acs(await this.#workflow.systemActor("registrar"));
      const namespace = this.#workflow.namespace;
      if (input.addToDirectory) {
        const config = await acs.one("CollaraConfig", (c) => c.namespace === namespace);
        if (config && !config.payload.directory.includes(input.verifierParty)) {
          const outcome = await registrar.updateConfig({ idempotencyKey: `${parentId}:config`, addToDirectory: [input.verifierParty] });
          states.push({ step: "config", state: outcome.record.status, updateId: outcome.record.updateId });
        }
      }
      const mirror = await acs.one("VerifierStatusMirror", (m) => m.namespace === namespace && m.verifier === input.verifierParty);
      const outcome = mirror
        ? await registrar.syncMirror({ idempotencyKey: `${parentId}:mirror`, verifierParty: input.verifierParty, newSourceRef: input.sourceRef })
        : await registrar.publishVerifierStatus({ idempotencyKey: `${parentId}:mirror`, verifierParty: input.verifierParty, sourceRef: input.sourceRef });
      states.push({ step: "mirror", state: outcome.record.status, updateId: outcome.record.updateId });
      if (!outcome.committed) this.#options.onSyncProblem?.({ proposalRef: input.sourceRef, error: new Error(`mirror sync ${outcome.record.status}`) });
    } catch (error) {
      states.push({ step: "mirror", state: "FAILED", updateId: null });
      this.#options.onSyncProblem?.({ proposalRef: input.sourceRef, error });
    }
    return states;
  }
}

function flatConfirmation(c: { contractId: string; offset: number; payload: { confirmer: string; actionProposalCid: string; expiresAt: string } }) {
  return { contractId: c.contractId, offset: c.offset, confirmer: c.payload.confirmer, actionProposalCid: c.payload.actionProposalCid, expiresAt: c.payload.expiresAt };
}
