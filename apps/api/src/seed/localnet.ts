// LocalNet seed (daml-model.md §7) through the SAME runner, registrar service and evidence pipeline the API
// endpoints use. Every ledger step is a durable command record with a deterministic idempotency key
// ("seed:<namespace>:<step>"), attributed to the demo user who would act (system:registrar /
// system:governance for the registrar and the Tier A governance party). Re-running replays the stored
// outcomes and creates nothing twice. Profiles:
//   clean-start  B1–B8: asset registry, Tier A GovernanceRules (seats 1–3, threshold 2), governed bootstrap
//                of the verifier registry with VER-001 (real propose → 2 confirms → execute), CollaraConfig,
//                verifier status mirror.
//   main         clean-start + case CL-001 (application record), synthetic documents through the evidence
//                pipeline (server SHA-256), and M1–M18: registered, ATT-001, PKG-001 v2 shared with Demo
//                Lender A, review SUBMITTED. No proposal, no lock.
// Dates are relative to now (the sandbox's ledger time follows the wall clock).
import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { allocateRef, cases, commands as commandsTable, evidenceDocuments, type DbHandle } from "@collara/db";
import { CL001_CHECKS, CREDIT_POLICY_REF, DEMO_ORG_IDS, DEMO_PERSONAS, type PersonaId } from "@collara/domain";
import { and, eq } from "drizzle-orm";
import { buildApp, type CollaraApp } from "../app";
import { loadConfig, sessionCookieName, type Config } from "../config";
import { AcsReader } from "../ledger/acs";
import { DEV_HMAC_SECRET, LedgerAccess } from "../ledger/access";
import { LEDGER_DOC_TYPES, ledgerCommands as L, manifestHashOf, type ManifestEntryInput, type SharedDocumentInput } from "../ledger/builders";
import { CantonLedgerGateway, type CantonGatewayOptions } from "../ledger/gateway";
import { ledgerStatePath, loadLedgerState, type LedgerState } from "../ledger/state";
import { createS3Storage, type StorageService } from "../services/storage";
import { businessPartyOfOrg, loadMemberActor, resolveSystemActor, type WorkflowActor } from "../workflow/actors";
import { createWorkflowServices } from "../workflow/context";
import { must, snapshotFromDisclosure } from "../workflow/preconditions";
import { workflowProblems } from "../workflow/problems";
import type { LedgerWorkflowInput, WorkflowOutcome } from "../workflow/run";
import { prepareDatabase } from "./database";
import { cl001Files, type SyntheticFile } from "./documents";

export type SeedProfile = "clean-start" | "main";

export interface SeedLocalnetOptions {
  readonly profile: SeedProfile;
  /** Isolation prefix (state-<prefix>.json). Ignored when statePath is given. */
  readonly prefix?: string | null;
  readonly statePath?: string;
  readonly databaseUrl: string;
  /** Ledger only: synthetic label hashes instead of uploaded files (no object storage needed). */
  readonly skipDocuments?: boolean;
  /** When the namespace already has a registry this database did not seed, move to a fresh namespace. */
  readonly forceNewNamespace?: boolean;
  /** S3 settings, Canton auth (CANTON_JWT_HMAC_SECRET / CANTON_JWT_AUDIENCE). Default process.env. */
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (line: string) => void;
  /** Reuse an existing database handle (harness); otherwise the seed opens and closes its own. */
  readonly db?: DbHandle;
  /** Override object storage (harness); default S3 from env. */
  readonly storage?: StorageService | null;
  readonly gatewayOptions?: CantonGatewayOptions;
}

export interface SeedStepReport {
  readonly step: string;
  readonly operation: string;
  readonly actor: string;
  readonly state: string;
  readonly replayed: boolean;
  readonly ms: number;
  readonly updateId: string | null;
  readonly offset: number | null;
}

export interface SeedReport {
  readonly profile: SeedProfile;
  readonly namespace: string;
  readonly prefix: string | null;
  readonly database: string;
  readonly steps: SeedStepReport[];
  readonly documents: { docRef: string; version: number; fileName: string; sha256: string }[];
  /** Active contracts per visible template, as each organisation's ledger user sees them. */
  readonly contracts: Record<string, Record<string, number>>;
  readonly totalMs: number;
}

export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedRefusedError";
  }
}

export class SeedStepError extends Error {
  constructor(
    readonly step: string,
    readonly outcome: WorkflowOutcome<unknown>,
  ) {
    super(`seed step ${step} did not commit: ${outcome.record.status} ${outcome.record.errorKind ?? ""} ${outcome.record.errorMessage ?? ""}`.trim());
    this.name = "SeedStepError";
  }
}

const DAY = 86_400_000;
const PERSONA_USERS = (id: PersonaId) => DEMO_PERSONAS[id].userId;
const CHECKLIST = ["Serial number consistency", "Equipment photos", "Document consistency", "Inspected condition", "Location evidence", "Maintenance evidence"];
const VERIFICATION_METHOD = "On-site inspection + document review";
const VERIFICATION_LIMITATIONS =
  "Ownership and lien status were reviewed from submitted documents only. No UCC, title, or registry search was performed. Maintenance history verified for Q3 2025 onward.";

/** Postgres URL with the password removed (for logs and reports). */
export function redactUrl(url: string): string {
  const u = new URL(url);
  if (u.password) u.password = "***";
  return u.toString();
}

export async function seedLocalnet(options: SeedLocalnetOptions): Promise<SeedReport> {
  const started = performance.now();
  const log = options.log ?? ((line: string) => console.log(line));
  const env = options.env ?? process.env;
  const statePath = options.statePath ?? ledgerStatePath(options.prefix);
  let state = await loadLedgerState(statePath);
  if (!state) throw new SeedRefusedError(`no bootstrap state at ${statePath}: run node scripts/localnet/bootstrap.mjs${options.prefix ? ` --prefix ${options.prefix}` : ""}`);

  const prepared = options.db ? null : await prepareDatabase(options.databaseUrl, state);
  const handle = options.db ?? prepared?.handle;
  if (!handle) throw new Error("no database handle");
  if (prepared) log(`database ${redactUrl(options.databaseUrl)}${prepared.created ? " (created)" : ""}: ${prepared.bindings.bindings} party bindings`);
  const db = handle.db;
  let app: CollaraApp | null = null;
  try {
    const secret = env.CANTON_JWT_HMAC_SECRET || DEV_HMAC_SECRET;
    const audience = env.CANTON_JWT_AUDIENCE || undefined;
    const accessFor = (s: LedgerState) => new LedgerAccess({ state: s, secret, ...(audience ? { audience } : {}) });
    let access = accessFor(state);

    // Guard: never reseed a namespace another database (or the lead's demo) already seeded.
    const registrarActor = await resolveSystemActor(db, "registrar");
    const namespace0 = access.namespace;
    const registrarAcs = new AcsReader(access.client(must(registrarActor.business).ledgerUserId), [must(registrarActor.business).party]);
    const existing = await registrarAcs.one("AssetRegistry", (r) => r.namespace === namespace0);
    if (existing && !(await seedRecordCommitted(handle, registrarActor, namespace0, "B1"))) {
      if (!options.forceNewNamespace) {
        throw new SeedRefusedError(
          `namespace ${namespace0} already has an asset registry that this database did not seed; refusing to reseed (nothing is ever wiped). Use --force-new-namespace, another --prefix, or the database that seeded it.`,
        );
      }
      const registries = await registrarAcs.list("AssetRegistry");
      let n = 2;
      while (registries.some((r) => r.payload.namespace === `${namespace0}-r${n}`)) n++;
      state = { ...state, namespace: `${namespace0}-r${n}` };
      await writeStateAtomic(statePath, state);
      access = accessFor(state);
      log(`namespace ${namespace0} is taken: using ${access.namespace} (written to ${statePath})`);
    }
    const ns = access.namespace;
    log(`seed profile ${options.profile} on namespace ${ns} (${state.topology}, participant ${Object.values(state.participants)[0]?.participantId.slice(0, 24)}…)`);

    const gateway = new CantonLedgerGateway(access, options.gatewayOptions);
    const workflow = createWorkflowServices({ db, gateway, access });
    const report: SeedStepReport[] = [];

    async function step<R>(id: string, actor: WorkflowActor, input: Pick<LedgerWorkflowInput<R>, "prepare" | "result"> & { payload?: unknown }): Promise<R | null> {
      const t = performance.now();
      const outcome = await workflow.run<R>({
        actor,
        operation: `seed.${id}`,
        idempotencyKey: seedKey(ns, id),
        payload: { namespace: ns, step: id, ...(input.payload ? { input: input.payload } : {}) },
        prepare: input.prepare,
        ...(input.result ? { result: input.result } : {}),
      });
      return finish(id, actor, outcome, t);
    }

    function finish<R>(id: string, actor: WorkflowActor, outcome: WorkflowOutcome<R>, t: number): R | null {
      const row: SeedStepReport = {
        step: id,
        operation: outcome.record.operation,
        actor: actor.userId,
        state: outcome.record.status,
        replayed: outcome.replayed,
        ms: Math.round(performance.now() - t),
        updateId: outcome.record.updateId,
        offset: outcome.record.completionOffset,
      };
      report.push(row);
      log(`  ${id.padEnd(4)} ${row.state.padEnd(9)} ${row.replayed ? "replayed" : `${row.ms} ms`.padEnd(8)} ${row.operation} (${actor.userId})${row.offset !== null ? ` offset ${row.offset}` : ""}`);
      if (!outcome.committed) throw new SeedStepError(id, outcome);
      return outcome.result;
    }

    // --- actors and parties (server-side bindings, never browser input) ----------------------------
    const governanceActor = await resolveSystemActor(db, "governance");
    const owner = await loadMemberActor(db, PERSONA_USERS("manufacturer-owner"));
    const dealer = await loadMemberActor(db, PERSONA_USERS("dealer-contributor"));
    const verifier = await loadMemberActor(db, PERSONA_USERS("verifier-inspector"));
    const analyst = await loadMemberActor(db, PERSONA_USERS("lender-a-analyst"));
    const seat1 = await loadMemberActor(db, PERSONA_USERS("lender-a-approver"));
    const seat2 = await loadMemberActor(db, PERSONA_USERS("lender-b-approver"));
    const seat3 = await loadMemberActor(db, PERSONA_USERS("auditor"));
    const party = {
      registrar: must(registrarActor.business).party,
      governance: must(governanceActor.business).party,
      seat1: must(seat1.seat).party,
      seat2: must(seat2.seat).party,
      seat3: must(seat3.seat).party,
      owner: must(owner.business).party,
      dealer: must(dealer.business).party,
      verifier: must(verifier.business).party,
      lenderA: must(await businessPartyOfOrg(db, DEMO_ORG_IDS.lenderA)),
      lenderB: must(await businessPartyOfOrg(db, DEMO_ORG_IDS.lenderB)),
    };

    // --- clean-start: B1–B8 ----------------------------------------------------------------------
    log("clean-start (B1–B8)");
    await step("B1", registrarActor, {
      prepare: async (ctx) => {
        if (await ctx.acs.one("AssetRegistry", (r) => r.namespace === ctx.namespace)) throw workflowProblems.stateChanged();
        return { commands: [L.createAssetRegistry({ registrar: party.registrar, namespace: ctx.namespace })] };
      },
      result: (s) => ({ registryCid: s.createdOf("AssetRegistry") }),
    });

    const governanceAcs = workflow.acs(governanceActor);
    const rules = await governanceAcs.list("GovernanceRules", (r) => r.governanceParty === party.governance);
    if (rules.length > 0 && !(await seedRecordCommitted(handle, governanceActor, ns, "B2"))) {
      log("  B2   reusing the existing GovernanceRules of the governance party");
    } else {
      await step("B2", governanceActor, {
        prepare: async (ctx) => {
          if ((await ctx.acs.list("GovernanceRules", (r) => r.governanceParty === party.governance)).length > 0) throw workflowProblems.stateChanged();
          return {
            commands: [
              L.createGovernanceRules({ governanceParty: party.governance, members: [party.seat1, party.seat2, party.seat3], threshold: 2, actionConfirmationTimeoutMs: 30 * 60_000, additionalProposers: null }),
            ],
          };
        },
        result: (s) => ({ rulesCid: s.createdOf("GovernanceRules") }),
      });
    }

    const governed = (acs: AcsReader | null) => must(acs);
    const findRules = async (acs: AcsReader) => must(await acs.one("GovernanceRules", (r) => r.governanceParty === party.governance));
    const findBootstrap = async (acs: AcsReader) =>
      must(await acs.one("BootstrapVerifierRegistryProposal", (p) => p.registryId === ns && p.governanceParty === party.governance));

    await step("B3", seat1, {
      prepare: async (ctx) => {
        const acs = governed(ctx.seatAcs);
        if ((await acs.list("BootstrapVerifierRegistryProposal", (p) => p.registryId === ctx.namespace)).length > 0) throw workflowProblems.stateChanged();
        if ((await acs.list("VerifierRegistry", (r) => r.registryId === ctx.namespace)).length > 0) throw workflowProblems.stateChanged();
        return {
          as: "seat",
          commands: [
            L.createBootstrapVerifierRegistryProposal({
              governanceParty: party.governance,
              proposer: party.seat1,
              operator: party.registrar,
              registryId: ctx.namespace,
              genesisVerifiers: [
                { verifier: party.verifier, verifierRef: "VER-001", orgName: "Demo Verifier", scope: ["CNC_MACHINERY"], validUntil: new Date(ctx.now.getTime() + 365 * DAY) },
              ],
              proposalDeadline: new Date(ctx.now.getTime() + DAY),
              reason: "Synthetic demo bootstrap",
            }),
          ],
        };
      },
      result: (s) => ({ proposalCid: s.createdOf("BootstrapVerifierRegistryProposal") }),
    });

    const confirm = (id: string, member: WorkflowActor) =>
      step(id, member, {
        prepare: async (ctx) => {
          const acs = governed(ctx.seatAcs);
          const seatParty = must(member.seat).party;
          const [r, proposal] = await Promise.all([findRules(acs), findBootstrap(acs)]);
          const mine = await acs.list("GovernanceConfirmation", (c) => c.actionProposalCid === proposal.contractId && c.confirmer === seatParty);
          if (mine.length > 0) throw workflowProblems.stateChanged();
          return { as: "seat", commands: [L.confirmAction(r.contractId, { confirmer: seatParty, actionProposalCid: proposal.contractId })] };
        },
        result: (s) => ({ confirmationCid: s.createdOf("GovernanceConfirmation") }),
      });
    await confirm("B4", seat1);
    await confirm("B5", seat2);

    await step("B6", seat2, {
      prepare: async (ctx) => {
        const acs = governed(ctx.seatAcs);
        const [r, proposal] = await Promise.all([findRules(acs), findBootstrap(acs)]);
        const confirmations = await acs.list("GovernanceConfirmation", (c) => c.actionProposalCid === proposal.contractId && Date.parse(c.expiresAt) > ctx.now.getTime());
        if (confirmations.length < 2) throw workflowProblems.stateChanged();
        return {
          as: "seat",
          commands: [L.executeConfirmedAction(r.contractId, { executor: party.seat2, actionProposalCid: proposal.contractId, confirmations: confirmations.map((c) => c.contractId) })],
        };
      },
      result: (s) => ({
        executionResultCid: s.createdOf("GovernanceExecutionResult"),
        registryCid: s.createdOf("VerifierRegistry"),
        accreditationCid: s.createdOf("VerifierAccreditation"),
      }),
    });

    await step("B7", registrarActor, {
      prepare: async (ctx) => {
        if (await ctx.acs.one("CollaraConfig", (c) => c.namespace === ctx.namespace)) throw workflowProblems.stateChanged();
        return {
          commands: [
            L.createConfig({
              registrar: party.registrar,
              namespace: ctx.namespace,
              governanceParty: party.governance,
              suspensionPolicy: "REQUIRE_ACTIVE_VERIFIER",
              configVersion: 1,
              directory: [party.verifier, party.lenderA, party.lenderB],
            }),
          ],
        };
      },
      result: (s) => ({ configCid: s.createdOf("CollaraConfig") }),
    });

    {
      const t = performance.now();
      const outcome = await workflow.registrar.publishVerifierStatus({ idempotencyKey: seedKey(ns, "B8"), verifierParty: party.verifier, sourceRef: "GP-000" });
      finish("B8", registrarActor, outcome, t);
    }

    const documents: SeedReport["documents"] = [];
    if (options.profile === "main") {
      log("main (case CL-001, documents, M1–M18)");
      const caseRef = await ensureCase(handle, ns);

      // M1–M3: owner request → registrar reserve → registrar accept (one sequence, registrar service).
      {
        const t = performance.now();
        const outcome = await workflow.registrar.registerAsset({
          owner,
          idempotencyKey: seedKey(ns, "M1-M3"),
          operation: "seed.M1-M3",
          registration: {
            requestRef: "REG-001",
            equipmentClass: "CNC machining center",
            equipment: { manufacturer: "Demo Machine Works (synthetic)", model: "DEMO-CNC-500", serialNumber: "SYNTH-CNC-001" },
            yearOfManufacture: 2019,
            locationScope: "Demo Manufacturer facility · Ohio, US (declared)",
            ownerClaimRef: "CLAIM-REG-001",
            assetId: "ASSET-DEMO-001",
          },
        });
        finish("M1-M3", owner, outcome, t);
        if (outcome.result?.outcome !== "REGISTERED") throw new SeedStepError("M1-M3", outcome);
      }
      const assetId = "ASSET-DEMO-001";

      // Documents (application records + private storage, server-computed SHA-256).
      const files = cl001Files();
      const docs = options.skipDocuments ? syntheticDocs() : await (async () => {
        const storage = options.storage === undefined ? createS3Storage(seedConfig(env, options.databaseUrl, statePath)) : options.storage;
        if (!storage) throw new SeedRefusedError("object storage is not configured (COLLARA_S3_*): start SeaweedFS or pass --skip-documents");
        app = await buildApp({
          config: seedConfig(env, options.databaseUrl, statePath),
          db: handle,
          storage,
          ledger: gateway,
          ledgerAccess: access,
          oidc: null,
          logger: false,
          probeLedger: async () => ({ status: "ok", detail: "seed" }),
        });
        await app.ready();
        const uploader = evidenceUploader(app, handle, ns, assetId, caseRef);
        const invoice = await uploader("dealer-contributor", files.invoice);
        const photos = await uploader("manufacturer-owner", files.photos);
        const inspection = await uploader("manufacturer-owner", files.inspectionV1);
        const maintenance = await uploader("manufacturer-owner", files.maintenance);
        const agreement = await uploader("manufacturer-owner", files.purchaseAgreement);
        return { invoice, photos, inspection, maintenance, agreement, inspectionV2: () => uploader("manufacturer-owner", files.inspectionV2, inspection.docRef) };
      })();
      const recordDoc = (d: UploadedDoc) => documents.push({ docRef: d.docRef, version: d.version, fileName: d.fileName, sha256: d.sha256 });
      for (const d of [docs.invoice, docs.photos, docs.inspection, docs.maintenance, docs.agreement]) recordDoc(d);

      const entry = (d: UploadedDoc, source: string, contributorRef: string): ManifestEntryInput => ({
        docRef: d.docRef,
        docType: LEDGER_DOC_TYPES[d.type],
        docVersion: d.version,
        sha256: d.sha256,
        source,
        contributorRef,
      });
      const shared = (e: ManifestEntryInput): SharedDocumentInput => ({ docRef: e.docRef, docVersion: e.docVersion, sha256: e.sha256, source: e.source });
      const v1Entries = [
        entry(docs.invoice, party.dealer, dealer.actorRef),
        entry(docs.photos, party.owner, owner.actorRef),
        entry(docs.inspection, party.owner, owner.actorRef),
        entry(docs.maintenance, party.owner, owner.actorRef),
      ];
      const findControl = async (acs: AcsReader) => must(await acs.one("AssetControl", (c) => c.assetId === assetId && c.namespace === ns));
      const findManifest = (acs: AcsReader, version: number) =>
        acs.one("EvidenceManifest", (m) => m.assetId === assetId && m.namespace === ns && m.packageRef === "PKG-001" && m.version === version);
      const findRequest = async (acs: AcsReader, status?: string) =>
        must(await acs.one("VerificationRequest", (r) => r.requestRef === "VR-001" && r.namespace === ns && (status === undefined || r.status === status)));
      const findConfig = async (acs: AcsReader) => must(await acs.one("CollaraConfig", (c) => c.namespace === ns));
      const findAccreditation = async (acs: AcsReader) =>
        must(await acs.one("VerifierAccreditation", (a) => a.verifier === party.verifier && a.verifierRef === "VER-001" && a.registryId === ns && a.status === "ACTIVE"));

      await step("M4", dealer, {
        payload: { docRef: docs.invoice.docRef, sha256: docs.invoice.sha256 },
        prepare: async (ctx) => {
          if ((await ctx.acs.list("DealerContribution", (c) => c.caseRef === caseRef && c.docRef === docs.invoice.docRef)).length > 0) throw workflowProblems.stateChanged();
          return {
            commands: [
              L.createDealerContribution({
                dealer: party.dealer,
                owner: party.owner,
                caseRef,
                docRef: docs.invoice.docRef,
                docType: LEDGER_DOC_TYPES.DEALER_INVOICE,
                docVersion: docs.invoice.version,
                sha256: docs.invoice.sha256,
                contributorRef: ctx.actorRef,
                verificationUseConsented: true,
              }),
            ],
          };
        },
        result: (s) => ({ contributionCid: s.createdOf("DealerContribution") }),
      });

      await step("M5", owner, {
        payload: { entries: v1Entries },
        prepare: async (ctx) => {
          if ((await ctx.acs.list("EvidenceManifest", (m) => m.assetId === assetId && m.packageRef === "PKG-001")).length > 0) throw workflowProblems.stateChanged();
          return {
            commands: [
              L.createManifest({
                owner: party.owner,
                registrar: party.registrar,
                namespace: ctx.namespace,
                assetId,
                packageRef: "PKG-001",
                version: 1,
                manifestHash: manifestHashOf({ packageRef: "PKG-001", version: 1, entries: v1Entries }),
                entries: v1Entries,
              }),
            ],
          };
        },
        result: (s) => ({ manifestCid: s.createdOf("EvidenceManifest") }),
      });

      await step("M6", owner, {
        prepare: async (ctx) => {
          const manifest = must(await findManifest(ctx.acs, 1));
          const control = await findControl(ctx.acs);
          if (control.payload.evidence !== null) throw workflowProblems.stateChanged();
          return { commands: [L.manifestAnchor(manifest.contractId, { controlCid: control.contractId, actorRef: ctx.actorRef })] };
        },
        result: (s) => ({ controlCid: s.createdOf("AssetControl") }),
      });

      await step("M7", owner, {
        prepare: async (ctx) => {
          const manifest = must(await findManifest(ctx.acs, 1));
          const passport = must(await ctx.acs.one("AssetPassport", (p) => p.assetId === assetId && p.namespace === ns));
          if ((await ctx.acs.list("VerificationRequest", (r) => r.requestRef === "VR-001")).length > 0) throw workflowProblems.stateChanged();
          return {
            commands: [
              L.manifestRequestVerification(manifest.contractId, {
                verifier: party.verifier,
                requestRef: "VR-001",
                passportVersion: passport.payload.passportVersion,
                caseRef,
                equipmentScope: "CNC_MACHINERY",
                checklist: CHECKLIST,
                dueBy: new Date(ctx.now.getTime() + 10 * DAY),
                actorRef: ctx.actorRef,
              }),
            ],
          };
        },
        result: (s) => ({ requestCid: s.createdOf("VerificationRequest") }),
      });

      await step("M8", verifier, {
        prepare: async (ctx) => {
          const [request, config, accreditation] = await Promise.all([findRequest(ctx.acs, "REQUESTED"), findConfig(ctx.acs), findAccreditation(ctx.acs)]);
          return { commands: [L.vrAcceptAssignment(request.contractId, { configCid: config.contractId, accreditationCid: accreditation.contractId, actorRef: ctx.actorRef })] };
        },
      });

      await step("M9", verifier, {
        prepare: async (ctx) => {
          const request = await findRequest(ctx.acs, "IN_REVIEW");
          return {
            commands: [L.vrRequestChanges(request.contractId, { note: "Inspection report v1 does not cover the spindle; please upload the full scoped report.", actorRef: ctx.actorRef })],
          };
        },
      });

      const inspectionV2 = await docs.inspectionV2();
      recordDoc(inspectionV2);
      const v2Entries = v1Entries.map((e) => (e.docRef === inspectionV2.docRef ? entry(inspectionV2, party.owner, owner.actorRef) : e));

      await step("M10", owner, {
        payload: { entries: v2Entries },
        prepare: async (ctx) => {
          const manifest = must(await findManifest(ctx.acs, 1));
          const control = await findControl(ctx.acs);
          return {
            commands: [
              L.manifestNewVersion(manifest.contractId, {
                newEntries: v2Entries,
                newManifestHash: manifestHashOf({ packageRef: "PKG-001", version: 2, entries: v2Entries }),
                controlCid: control.contractId,
                actorRef: ctx.actorRef,
              }),
            ],
          };
        },
        result: (s) => ({ manifestCid: s.createdOf("EvidenceManifest"), controlCid: s.createdOf("AssetControl") }),
      });

      await step("M11", owner, {
        prepare: async (ctx) => {
          const manifest = must(await findManifest(ctx.acs, 2));
          const request = await findRequest(ctx.acs, "CHANGES_REQUESTED");
          return { commands: [L.manifestSubmitToVerification(manifest.contractId, { requestCid: request.contractId, actorRef: ctx.actorRef })] };
        },
      });

      await step("M12", verifier, {
        prepare: async (ctx) => {
          const [request, config, accreditation] = await Promise.all([findRequest(ctx.acs, "IN_REVIEW"), findConfig(ctx.acs), findAccreditation(ctx.acs)]);
          if ((await ctx.acs.list("VerificationAttestation", (a) => a.attestationRef === "ATT-001" && a.namespace === ns)).length > 0) throw workflowProblems.stateChanged();
          return {
            commands: [
              L.vrIssueAttestation(request.contractId, {
                configCid: config.contractId,
                accreditationCid: accreditation.contractId,
                attestationRef: "ATT-001",
                checks: CL001_CHECKS.map((c) => ({ item: c.item, finding: c.finding, result: c.result })),
                limitations: VERIFICATION_LIMITATIONS,
                method: VERIFICATION_METHOD,
                inspectedAt: ctx.now,
                validFrom: ctx.now,
                validUntil: new Date(ctx.now.getTime() + 180 * DAY),
                supersedes: null,
                actorRef: ctx.actorRef,
              }),
            ],
          };
        },
        result: (s) => ({ attestationCid: s.createdOf("VerificationAttestation") }),
      });

      const anchorOf = async (acs: AcsReader) => {
        const manifest = must(await findManifest(acs, 2));
        return { packageRef: manifest.payload.packageRef, manifestVersion: manifest.payload.version, manifestHash: manifest.payload.manifestHash };
      };
      const shareExpiry = (now: Date) => new Date(now.getTime() + 30 * DAY);

      await step("M13", owner, {
        prepare: async (ctx) => {
          if ((await ctx.acs.list("PackageShareProposal", (p) => p.shareRef === "SHR-001")).length > 0) throw workflowProblems.stateChanged();
          return {
            commands: [
              L.createPackageShareProposal({
                owner: party.owner,
                dealer: party.dealer,
                recipient: party.lenderA,
                shareRef: "SHR-001",
                purpose: "LENDER_REVIEW",
                caseRef,
                evidence: await anchorOf(ctx.acs),
                documents: v2Entries.filter((e) => e.source === party.dealer).map(shared),
                permission: "VIEW_DOWNLOAD",
                expiresAt: shareExpiry(ctx.now),
              }),
            ],
          };
        },
        result: (s) => ({ proposalCid: s.createdOf("PackageShareProposal") }),
      });

      await step("M14", dealer, {
        prepare: async (ctx) => {
          const proposal = must(await ctx.acs.one("PackageShareProposal", (p) => p.shareRef === "SHR-001" && p.caseRef === caseRef));
          return { commands: [L.consentGrant(proposal.contractId, { actorRef: ctx.actorRef })] };
        },
        result: (s) => ({ shareCid: s.createdOf("PackageShare") }),
      });

      await step("M15", owner, {
        prepare: async (ctx) => {
          if ((await ctx.acs.list("PackageShare", (p) => p.shareRef === "SHR-002")).length > 0) throw workflowProblems.stateChanged();
          return {
            commands: [
              L.createPackageShare({
                owner: party.owner,
                consenters: [],
                recipient: party.lenderA,
                shareRef: "SHR-002",
                purpose: "LENDER_REVIEW",
                caseRef,
                evidence: await anchorOf(ctx.acs),
                documents: v2Entries.filter((e) => e.source === party.owner).map(shared),
                permission: "VIEW_DOWNLOAD",
                expiresAt: shareExpiry(ctx.now),
              }),
            ],
          };
        },
        result: (s) => ({ shareCid: s.createdOf("PackageShare") }),
      });

      await step("M16", owner, {
        prepare: async (ctx) => {
          const control = await findControl(ctx.acs);
          if (control.payload.sharedLender !== null) throw workflowProblems.stateChanged();
          return { commands: [L.controlShareWithLender(control.contractId, { lender: party.lenderA, actorRef: ctx.actorRef })] };
        },
        result: (s) => ({ controlCid: s.createdOf("AssetControl") }),
      });

      await step("M17", owner, {
        prepare: async (ctx) => {
          const attestation = must(await ctx.acs.one("VerificationAttestation", (a) => a.attestationRef === "ATT-001" && a.namespace === ns));
          return { commands: [L.attDiscloseTo(attestation.contractId, { recipient: party.lenderA, purpose: "LENDER_REVIEW", disclosureCaseRef: caseRef, actorRef: ctx.actorRef })] };
        },
        result: (s) => ({ disclosureCid: s.createdOf("AttestationDisclosure") }),
      });

      await step("M18", analyst, {
        prepare: async (ctx) => {
          const disclosure = must(await ctx.acs.one("AttestationDisclosure", (d) => d.attestation.attestationRef === "ATT-001" && d.caseRef === caseRef));
          if ((await ctx.acs.list("CollateralAssessment", (a) => a.assessmentRef === "CA-001")).length > 0) throw workflowProblems.stateChanged();
          return {
            commands: [
              L.createCollateralAssessment({
                lender: party.lenderA,
                borrower: disclosure.payload.owner,
                assessmentRef: "CA-001",
                caseRef,
                namespace: ctx.namespace,
                assetId: disclosure.payload.attestation.assetId,
                snapshot: snapshotFromDisclosure(disclosure.payload),
                valuation: null,
                policyRef: CREDIT_POLICY_REF,
                lastActorRef: ctx.actorRef,
              }),
            ],
          };
        },
        result: (s) => ({ assessmentCid: s.createdOf("CollateralAssessment") }),
      });
    }

    // --- report: active contracts per organisation's ledger view ----------------------------------
    const views: Record<string, WorkflowActor> = { registrar: registrarActor, owner, dealer, verifier, lenderA: analyst, lenderB: seat2, auditor: seat3 };
    const contracts: SeedReport["contracts"] = {};
    for (const [name, actor] of Object.entries(views)) {
      const acs = workflow.acs(actor);
      const { contracts: active } = await acs.client.activeContracts({ parties: [...acs.parties] });
      const counts: Record<string, number> = {};
      for (const c of active) {
        const template = c.event.templateRef.split(":").slice(1).join(":");
        counts[template] = (counts[template] ?? 0) + 1;
      }
      contracts[name] = counts;
    }
    const totalMs = Math.round(performance.now() - started);
    return { profile: options.profile, namespace: ns, prefix: state.prefix ?? null, database: redactUrl(options.databaseUrl), steps: report, documents, contracts, totalMs };
  } finally {
    const openApp = app as CollaraApp | null;
    if (openApp) await openApp.close();
    if (prepared) await prepared.handle.close();
  }
}

// --- helpers -----------------------------------------------------------------------------------------

export function seedKey(namespace: string, step: string): string {
  return `seed:${namespace}:${step}`;
}

async function seedRecordCommitted(handle: DbHandle, actor: WorkflowActor, namespace: string, step: string): Promise<boolean> {
  const [row] = await handle.db
    .select({ status: commandsTable.status })
    .from(commandsTable)
    .where(
      and(
        eq(commandsTable.actorUserId, actor.userId),
        eq(commandsTable.orgId, actor.orgId),
        eq(commandsTable.operation, `seed.${step}`),
        eq(commandsTable.idempotencyKey, seedKey(namespace, step)),
      ),
    )
    .limit(1);
  return !!row && ["COMMITTED", "PROJECTED", "PROJECTION_DELAYED"].includes(row.status);
}

async function writeStateAtomic(path: string, state: LedgerState): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tmp, path);
}

function seedConfig(env: NodeJS.ProcessEnv, databaseUrl: string, statePath: string): Config {
  return loadConfig({
    ...env,
    NODE_ENV: env.NODE_ENV === "production" ? "production" : "development",
    COLLARA_MODE: "LOCALNET",
    DEMO_SESSIONS_ENABLED: "true",
    LOG_LEVEL: "silent",
    DATABASE_URL: databaseUrl,
    COLLARA_LOCALNET_STATE: statePath,
  });
}

/** CL-001 application record (borrower, dealer, selected lender, requested principal USD 100,000.00). */
async function ensureCase(handle: DbHandle, namespace: string): Promise<string> {
  const db = handle.db;
  const [existing] = await db.select({ caseRef: cases.caseRef }).from(cases).where(and(eq(cases.assetRef, "ASSET-DEMO-001"), eq(cases.borrowerOrgId, DEMO_ORG_IDS.manufacturer))).limit(1);
  if (existing) return existing.caseRef;
  return db.transaction(async (tx) => {
    const caseRef = await allocateRef(tx, "case");
    await tx.insert(cases).values({
      caseRef,
      title: "Used CNC financing",
      purpose: null,
      assetRef: "ASSET-DEMO-001",
      borrowerOrgId: DEMO_ORG_IDS.manufacturer,
      dealerOrgId: DEMO_ORG_IDS.dealer,
      selectedLenderOrgId: DEMO_ORG_IDS.lenderA,
      requestedPrincipal: "100000.00",
      requestedCurrency: "USD",
      policyRef: CREDIT_POLICY_REF,
      createdByUserId: PERSONA_USERS("manufacturer-owner"),
    });
    if (caseRef !== "CL-001") console.warn(`case ref ${caseRef} allocated (not CL-001): this database already had cases (namespace ${namespace})`);
    return caseRef;
  });
}

interface UploadedDoc {
  readonly docRef: string;
  readonly version: number;
  readonly sha256: string;
  readonly fileName: string;
  readonly type: SyntheticFile["type"];
}

/** Uploads through the real evidence routes (intent → content → finalize) as a demo persona. */
function evidenceUploader(app: CollaraApp, handle: DbHandle, namespace: string, assetRef: string, caseRef: string) {
  const cookies = new Map<PersonaId, string>();
  const login = async (personaId: PersonaId) => {
    const cached = cookies.get(personaId);
    if (cached) return cached;
    const response = await app.inject({ method: "POST", url: "/api/demo/sessions", payload: { personaId } });
    const name = sessionCookieName({ COOKIE_SECURE: false });
    const cookie = response.cookies.find((c) => c.name === name || c.name === "__Host-collara_sid");
    if (response.statusCode !== 200 || !cookie) throw new Error(`demo session for ${personaId} failed: ${response.statusCode} ${response.body}`);
    const value = `${cookie.name}=${cookie.value}`;
    cookies.set(personaId, value);
    return value;
  };
  const storedVersion = async (docRef: string, version: number) => {
    const [row] = await handle.db
      .select({ sha256: evidenceDocuments.sha256, status: evidenceDocuments.status })
      .from(evidenceDocuments)
      .where(and(eq(evidenceDocuments.docRef, docRef), eq(evidenceDocuments.version, version)))
      .limit(1);
    return row ?? null;
  };
  return async (personaId: PersonaId, file: SyntheticFile, replaces?: string): Promise<UploadedDoc> => {
    const cookie = await login(personaId);
    const key = (part: string) => `seed:${namespace}:doc:${file.key}:${part}`;
    const intent = await app.inject({
      method: "POST",
      url: "/api/evidence/upload-intents",
      headers: { cookie, "idempotency-key": key("intent") },
      payload: {
        assetRef,
        caseId: caseRef,
        type: file.type,
        title: file.title,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.bytes.length,
        ...(replaces ? { replacesDocumentId: replaces } : {}),
      },
    });
    if (intent.statusCode !== 200 && intent.statusCode !== 201) throw new Error(`upload intent ${file.key}: ${intent.statusCode} ${intent.body}`);
    const { evidenceId, version } = (intent.json() as { result: { evidenceId: string; version: number } }).result;
    const stored = await storedVersion(evidenceId, version);
    // Replay of a completed upload: the intent replays its stored result; the bytes are already final.
    if (stored?.status === "AVAILABLE" && stored.sha256) return { docRef: evidenceId, version, sha256: stored.sha256, fileName: file.fileName, type: file.type };
    const content = await app.inject({
      method: "PUT",
      url: `/api/evidence/${evidenceId}/content`,
      headers: { cookie, "idempotency-key": key("content"), "content-type": file.contentType },
      payload: file.bytes,
    });
    if (content.statusCode !== 200) throw new Error(`upload content ${file.key}: ${content.statusCode} ${content.body}`);
    const finalize = await app.inject({ method: "POST", url: `/api/evidence/${evidenceId}/finalize`, headers: { cookie, "idempotency-key": key("finalize") }, payload: {} });
    if (finalize.statusCode !== 200) throw new Error(`finalize ${file.key}: ${finalize.statusCode} ${finalize.body}`);
    const row = await storedVersion(evidenceId, version);
    if (!row?.sha256 || row.status !== "AVAILABLE") throw new Error(`${evidenceId} v${version} is not AVAILABLE after finalize`);
    const expected = createHash("sha256").update(file.bytes).digest("hex");
    if (row.sha256 !== expected) throw new Error(`${evidenceId} v${version}: stored SHA-256 differs from the uploaded bytes`);
    return { docRef: evidenceId, version, sha256: row.sha256, fileName: file.fileName, type: file.type };
  };
}

/** --skip-documents: daml-model.md §9 label hashes (no files, no storage). */
function syntheticDocs() {
  const label = (s: string) => createHash("sha256").update(s).digest("hex");
  const doc = (docRef: string, version: number, slug: string, type: SyntheticFile["type"]): UploadedDoc => ({
    docRef,
    version,
    sha256: label(`synthetic:${docRef}:${slug}:v${version}`),
    fileName: `${slug}-v${version} (not uploaded)`,
    type,
  });
  const inspectionV2 = doc("DOC-003", 2, "inspection", "INSPECTION_REPORT");
  return {
    invoice: doc("DOC-001", 1, "invoice", "DEALER_INVOICE"),
    photos: doc("DOC-002", 1, "photos", "EQUIPMENT_PHOTOS"),
    inspection: doc("DOC-003", 1, "inspection", "INSPECTION_REPORT"),
    maintenance: doc("DOC-004", 1, "maintenance", "MAINTENANCE_SUMMARY"),
    agreement: doc("DOC-005", 1, "purchase-agreement", "PURCHASE_AGREEMENT"),
    inspectionV2: async () => inspectionV2,
  };
}
