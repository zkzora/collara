// The registrar service: registrar/operator actions run server-side under the registrar's ledger user,
// attributed to "system:registrar" (never a browser-controlled authority). It processes a borrower's
// AssetRegistrationRequest (Registry_Reserve top-level, then Request_Accept with the ticket; a duplicate
// identity gets Request_Decline with a generic reason) and maintains CollaraConfig and the verifier
// status mirrors for the governance flow (daml-model.md §4.1, §7, §8.1).
import { nextFreeRef } from "@collara/domain";
import type { Db } from "@collara/db";
import type { AcsReader } from "../ledger/acs";
import { identityCommitmentOf, ledgerCommands, type EquipmentIdentityInput } from "../ledger/builders";
import { IssuanceTicketSchema } from "../ledger/contracts";
import { resolveSystemActor, type WorkflowActor } from "./actors";
import { must } from "./preconditions";
import { workflowProblems } from "./problems";
import { StepNotCommittedError, tupleResult, type WorkflowOutcome, type WorkflowRunner, type WorkflowSequence } from "./run";

/** Generic decline reason: never reveals another party's registration (S L599). */
export const REGISTRATION_DECLINE_REASON = "REGISTRATION_NOT_ACCEPTED";

export interface RegistrationInput {
  /** Owner-side request reference (e.g. "REG-001"); unique per owner. */
  readonly requestRef: string;
  readonly equipmentClass: string;
  readonly equipment: EquipmentIdentityInput;
  readonly yearOfManufacture: number | null;
  readonly locationScope: string;
  readonly ownerClaimRef: string;
  /** Asset id to reserve; default: the lowest free ASSET-DEMO-NNN in the registry. */
  readonly assetId?: string;
}

export type RegistrationResult =
  | { readonly outcome: "REGISTERED"; readonly requestRef: string; readonly assetId: string; readonly controlCid: string; readonly passportCid: string }
  | { readonly outcome: "DECLINED"; readonly requestRef: string; readonly reasonCode: string };

type ReserveResult = { readonly branch: "reserved"; readonly assetId: string; readonly ticketCid: string } | { readonly branch: "declined"; readonly reasonCode: string };

export class RegistrarService {
  readonly #runner: WorkflowRunner;
  readonly #db: Db;
  #actor: Promise<WorkflowActor> | null = null;

  constructor(runner: WorkflowRunner, db: Db) {
    this.#runner = runner;
    this.#db = db;
  }

  /** The registrar service actor (system:registrar, CollaraRegistrar party, registrar ledger user). */
  actor(): Promise<WorkflowActor> {
    this.#actor ??= resolveSystemActor(this.#db, "registrar").catch((error: unknown) => {
      this.#actor = null;
      throw error;
    });
    return this.#actor;
  }

  /**
   * Owner registration as one sequence (parent record attributed to the owner):
   *   "request"  owner creates AssetRegistrationRequest (identity commitment computed like the ledger does)
   *   "reserve"  registrar: Registry_Reserve, or Request_Decline when the identity is already registered
   *   "accept"   registrar: Request_Accept with the ticket → control v1 + passport v1
   */
  async registerAsset(input: { owner: WorkflowActor; idempotencyKey: string; operation?: string; registration: RegistrationInput }): Promise<WorkflowOutcome<RegistrationResult>> {
    const { owner, registration } = input;
    const registrar = await this.actor();
    return this.#runner.sequence({
      actor: owner,
      operation: input.operation ?? "asset.register",
      idempotencyKey: input.idempotencyKey,
      payload: registration,
      resourceRef: registration.requestRef,
      steps: async (seq) => {
        await seq.step("request", {
          payload: registration,
          prepare: async (ctx) => {
            const ownerParty = must(owner.business).party;
            const registrarParty = must(registrar.business).party;
            const pending = await ctx.acs.list("AssetRegistrationRequest", (r) => r.owner === ownerParty && r.requestRef === registration.requestRef && r.namespace === ctx.namespace);
            if (pending.length > 0) throw workflowProblems.stateChanged();
            return {
              commands: [
                ledgerCommands.createRegistrationRequest({
                  owner: ownerParty,
                  registrar: registrarParty,
                  namespace: ctx.namespace,
                  requestRef: registration.requestRef,
                  equipmentClass: registration.equipmentClass,
                  equipment: registration.equipment,
                  yearOfManufacture: registration.yearOfManufacture,
                  locationScope: registration.locationScope,
                  ownerClaimRef: registration.ownerClaimRef,
                }),
              ],
            };
          },
          result: (step) => ({ requestCid: step.createdOf("AssetRegistrationRequest") }),
        });
        return this.process(seq, { ownerParty: must(owner.business).party, requestRef: registration.requestRef, ...(registration.assetId ? { assetId: registration.assetId } : {}) });
      },
    });
  }

  /**
   * Registrar processing of one pending request inside a sequence ("reserve" then "accept"). The branch
   * taken (reserve or decline) is stored on the "reserve" step, so a replay follows the same branch.
   */
  async process(seq: WorkflowSequence, input: { ownerParty: string; requestRef: string; assetId?: string }): Promise<RegistrationResult> {
    const registrar = await this.actor();
    const findRequest = (ctx: { acs: AcsReader; namespace: string }) =>
      ctx.acs.one("AssetRegistrationRequest", (r) => r.owner === input.ownerParty && r.requestRef === input.requestRef && r.namespace === ctx.namespace);

    const decline = (name: string) =>
      seq.step<ReserveResult>(name, {
        actor: registrar,
        payload: { requestRef: input.requestRef },
        prepare: async (ctx) => {
          const request = must(await findRequest(ctx));
          return { commands: [ledgerCommands.requestDecline(request.contractId, { reasonCode: REGISTRATION_DECLINE_REASON, actorRef: ctx.actorRef })] };
        },
        result: () => ({ branch: "declined", reasonCode: REGISTRATION_DECLINE_REASON }),
      });

    const reserveOutcome = await seq.attempt<ReserveResult>("reserve", {
      actor: registrar,
      payload: { requestRef: input.requestRef, assetId: input.assetId ?? null },
      prepare: async (ctx) => {
        const request = must(await findRequest(ctx));
        const registry = must(await ctx.acs.one("AssetRegistry", (r) => r.namespace === ctx.namespace));
        const commitment = identityCommitmentOf(request.payload.equipment);
        if (registry.payload.issuedIdentityCommitments.includes(commitment)) {
          return { commands: [ledgerCommands.requestDecline(request.contractId, { reasonCode: REGISTRATION_DECLINE_REASON, actorRef: ctx.actorRef })] };
        }
        const assetId = input.assetId ?? nextFreeRef("asset", registry.payload.issuedAssetIds);
        if (registry.payload.issuedAssetIds.includes(assetId)) throw workflowProblems.stateChanged();
        return {
          commands: [
            ledgerCommands.registryReserve(registry.contractId, {
              assetId,
              owner: request.payload.owner,
              requestRef: request.payload.requestRef,
              identityCommitment: request.payload.identityCommitment,
              actorRef: ctx.actorRef,
            }),
          ],
        };
      },
      result: (step) => {
        const ticket = step.created.find((c) => c.template === "IssuanceTicket");
        if (!ticket) return { branch: "declined", reasonCode: REGISTRATION_DECLINE_REASON };
        return { branch: "reserved", assetId: IssuanceTicketSchema.parse(ticket.argument).assetId, ticketCid: ticket.contractId };
      },
    });

    let reserved: ReserveResult;
    if (reserveOutcome.committed && reserveOutcome.result) {
      reserved = reserveOutcome.result;
    } else if (reserveOutcome.record.status === "REJECTED" && reserveOutcome.record.errorKind === "FAILED_PRECONDITION") {
      // Lost a race on the registry (identity or asset id issued concurrently): decline generically.
      reserved = await decline("decline");
    } else {
      throw new StepNotCommittedError("reserve", reserveOutcome);
    }
    if (reserved.branch === "declined") return { outcome: "DECLINED", requestRef: input.requestRef, reasonCode: reserved.reasonCode };

    const accepted = await seq.step<{ controlCid: string; passportCid: string }>("accept", {
      actor: registrar,
      payload: { requestRef: input.requestRef, assetId: reserved.assetId },
      prepare: async (ctx) => {
        const request = must(await findRequest(ctx));
        const ticket = must(await ctx.acs.one("IssuanceTicket", (t) => t.requestRef === input.requestRef && t.owner === input.ownerParty && t.assetId === reserved.assetId));
        return { commands: [ledgerCommands.requestAccept(request.contractId, { ticketCid: ticket.contractId, actorRef: ctx.actorRef })] };
      },
      result: (step) => {
        const [controlCid = "", passportCid = ""] = tupleResult(step.exerciseResult, 2);
        return { controlCid, passportCid };
      },
    });
    return { outcome: "REGISTERED", requestRef: input.requestRef, assetId: reserved.assetId, ...accepted };
  }

  /** B8 / after an Add: publish one verifier's status mirror from its live accreditation. */
  async publishVerifierStatus(input: { idempotencyKey: string; verifierParty: string; sourceRef: string }): Promise<WorkflowOutcome<{ mirrorCid: string }>> {
    const registrar = await this.actor();
    return this.#runner.run({
      actor: registrar,
      operation: "registrar.publishVerifierStatus",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      prepare: async (ctx) => {
        const config = must(await ctx.acs.one("CollaraConfig", (c) => c.namespace === ctx.namespace));
        const accreditation = must(
          await ctx.acs.latest("VerifierAccreditation", (a) => a.verifier === input.verifierParty && a.governanceParty === config.payload.governanceParty && a.registryId === ctx.namespace),
        );
        const existing = await ctx.acs.list("VerifierStatusMirror", (m) => m.namespace === ctx.namespace && m.verifier === input.verifierParty);
        if (existing.length > 0) throw must(null); // one mirror per verifier: use syncMirror
        return { commands: [ledgerCommands.publishVerifierStatus(config.contractId, { accreditationCid: accreditation.contractId, sourceRef: input.sourceRef })] };
      },
      result: (step) => ({ mirrorCid: must(step.createdOf("VerifierStatusMirror")) }),
    });
  }

  /** After a governed Suspend (or any registry change): re-derive a verifier's mirror from its live accreditation. */
  async syncMirror(input: { idempotencyKey: string; verifierParty: string; newSourceRef: string }): Promise<WorkflowOutcome<{ mirrorCid: string }>> {
    const registrar = await this.actor();
    return this.#runner.run({
      actor: registrar,
      operation: "registrar.syncMirror",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      prepare: async (ctx) => {
        const config = must(await ctx.acs.one("CollaraConfig", (c) => c.namespace === ctx.namespace));
        const mirror = must(await ctx.acs.one("VerifierStatusMirror", (m) => m.namespace === ctx.namespace && m.verifier === input.verifierParty));
        const accreditation = must(
          await ctx.acs.latest("VerifierAccreditation", (a) => a.verifier === input.verifierParty && a.governanceParty === config.payload.governanceParty && a.registryId === ctx.namespace),
        );
        return { commands: [ledgerCommands.mirrorSync(mirror.contractId, { configCid: config.contractId, accreditationCid: accreditation.contractId, newSourceRef: input.newSourceRef })] };
      },
      result: (step) => ({ mirrorCid: must(step.createdOf("VerifierStatusMirror")) }),
    });
  }

  /** After a governed Add: Config_Update (e.g. add the verifier to the directory). Unchanged fields are kept. */
  async updateConfig(input: {
    idempotencyKey: string;
    addToDirectory?: readonly string[];
    removeFromDirectory?: readonly string[];
    newSuspensionPolicy?: "REQUIRE_ACTIVE_VERIFIER" | "ALLOW_ISSUED_ATTESTATIONS";
  }): Promise<WorkflowOutcome<{ configCid: string }>> {
    const registrar = await this.actor();
    return this.#runner.run({
      actor: registrar,
      operation: "registrar.updateConfig",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      prepare: async (ctx) => {
        const config = must(await ctx.acs.one("CollaraConfig", (c) => c.namespace === ctx.namespace));
        const removed = new Set(input.removeFromDirectory ?? []);
        const directory = [...new Set([...config.payload.directory, ...(input.addToDirectory ?? [])])].filter((p) => !removed.has(p));
        return {
          commands: [
            ledgerCommands.configUpdate(config.contractId, {
              newGovernanceParty: config.payload.governanceParty,
              newSuspensionPolicy: input.newSuspensionPolicy ?? config.payload.suspensionPolicy,
              newDirectory: directory,
            }),
          ],
        };
      },
      result: (step) => ({ configCid: must(step.createdOf("CollaraConfig")) }),
    });
  }
}
