// Workflow services shared by the route modules (app.workflow) and the seed.
import type { Db } from "@collara/db";
import type { AcsReader } from "../ledger/acs";
import type { LedgerAccess } from "../ledger/access";
import type { ResolvedActor } from "../plugins/actor";
import type { LedgerGateway } from "../services/ledger";
import { readableParties, requireIdentity, resolveSystemActor, resolveWorkflowActor, type SystemActorKind, type WorkflowActor } from "./actors";
import { RegistrarService } from "./registrar";
import { WorkflowRunner, type LedgerWorkflowInput, type WorkflowOutcome, type WorkflowSequence } from "./run";

export interface WorkflowServices {
  readonly runner: WorkflowRunner;
  readonly registrar: RegistrarService;
  /** null in UI_MOCK or without a LocalNet bootstrap state (every command is then recorded as FAILED). */
  readonly access: LedgerAccess | null;
  /** Collara namespace (null without a ledger). */
  readonly namespace: string | null;
  /** Ledger identities of a signed-in member (business party, seat party + readAs governance). */
  actorFor(actor: ResolvedActor): Promise<WorkflowActor>;
  /** The registrar or Tier A governance service actor (server-side only). */
  systemActor(kind: SystemActorKind): Promise<WorkflowActor>;
  /** Fresh ACS reads as one of the actor's identities (throws 503 when the ledger or binding is missing). */
  acs(actor: WorkflowActor, as?: "business" | "seat"): AcsReader;
  /** Shorthand for runner.run(). */
  run<R>(input: LedgerWorkflowInput<R>): Promise<WorkflowOutcome<R>>;
  /** Shorthand for runner.sequence(). */
  sequence<R>(input: Parameters<WorkflowRunner["sequence"]>[0] & { steps: (seq: WorkflowSequence) => Promise<R> }): Promise<WorkflowOutcome<R>>;
  /** Parties the read model may use for this actor (stakeholder filtering). */
  readableParties: typeof readableParties;
}

export function createWorkflowServices(options: { db: Db; gateway: LedgerGateway; access: LedgerAccess | null; clock?: () => Date }): WorkflowServices {
  const runner = new WorkflowRunner({ db: options.db, gateway: options.gateway, access: options.access, ...(options.clock ? { clock: options.clock } : {}) });
  const registrar = new RegistrarService(runner, options.db);
  return {
    runner,
    registrar,
    access: options.access,
    namespace: options.access?.namespace ?? null,
    actorFor: (actor) => resolveWorkflowActor(options.db, actor),
    systemActor: (kind) => (kind === "registrar" ? registrar.actor() : resolveSystemActor(options.db, kind)),
    acs: (actor, as = "business") => runner.acsFor(requireIdentity(actor, as)),
    run: (input) => runner.run(input),
    sequence: (input) => runner.sequence(input),
    readableParties,
  };
}

declare module "fastify" {
  interface FastifyInstance {
    /** Ledger write path (runner, registrar service, ACS reads). Null when the API runs without a database. */
    workflow: WorkflowServices | null;
  }
}
