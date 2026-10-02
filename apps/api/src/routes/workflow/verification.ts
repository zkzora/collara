// Verification: GET /verifications, GET /verifications/:id, POST /verifications/:id/assignment,
// /change-requests, /evidence-submissions, /attestations, /rejection; GET /attestations/:id
// (API_ENDPOINTS "verifications.*", "attestations.get"). The verifier acts through VR_* choices with the config
// and its own live accreditation read fresh from its ledger view (the ledger re-checks the registry at commit);
// the owner resubmits evidence through a new manifest version (Manifest_SubmitToVerification).
import {
  AssignmentDecisionRequestSchema,
  AttestationRefSchema,
  AttestationSchema,
  checkVerificationAction,
  IssueAttestationRequestSchema,
  MessageRequestSchema,
  pageSchema,
  PageQuerySchema,
  paginate,
  presentAttestation,
  presentCaseDetail,
  presentVerification,
  ReasonRequestSchema,
  VerificationRefSchema,
  VerificationRequestSchema,
  type VerificationAction,
  type VerificationRequest,
} from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../../errors";
import { ledgerCommands as L } from "../../ledger/builders";
import type { ResolvedActor } from "../../plugins/actor";
import { IdempotencyHeadersSchema, must, replyWithOutcome, workflowProblems, workflowResponseSchemas, type LedgerWorkflowInput } from "../../workflow";
import { commitManifestIfChanged, currentManifest } from "../../workflow/assets/manifest";
import { allocateFreshRef, assertCheck, commandExists, findVerification, loadViewerWorld } from "../../workflow/cases/read";
import { createdField } from "../../workflow/cases/steps";
import { activeRequest, verifierInputs } from "../../workflow/verification/ledger";
import type { WorkflowRouteOptions } from "./types";

const VerificationParams = z.object({ id: VerificationRefSchema });
/** INFERRED copy, same string as the UI_MOCK client. */
const VALIDITY_ORDER = "The validity period must end after the inspection and in the future.";
/** INFERRED copy: VR_SubmitNewEvidence needs a newer version of the package. */
const NO_NEW_EVIDENCE = "Add a new document version before resubmitting the evidence.";

export const verificationRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, { services, workflow, mode }) => {
  const db = services.db.db;
  const now = services.clock;

  app.get(
    "/verifications",
    { schema: { tags: ["verifications"], summary: "Verification requests of the viewer (owner or assigned verifier)", querystring: PageQuerySchema, response: { 200: pageSchema(VerificationRequestSchema) } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const items = world.assets
        .flatMap((asset) => asset.verifications.map((v) => presentVerification(asset, v, member, pctx)))
        .filter((x): x is VerificationRequest => x !== null)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      return paginate(items, request.query);
    },
  );

  app.get(
    "/verifications/:id",
    { schema: { tags: ["verifications"], summary: "Verification request detail", params: VerificationParams, response: { 200: VerificationRequestSchema } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const found = findVerification(world, request.params.id);
      const dto = found ? presentVerification(found.asset, found.verification, member, pctx) : null;
      if (!dto) throw problems.unavailable();
      return dto;
    },
  );

  app.get(
    "/attestations/:id",
    { schema: { tags: ["verifications"], summary: "Attestation (owner, issuing verifier, or case participants with verification access)", params: z.object({ id: AttestationRefSchema }), response: { 200: AttestationSchema } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      for (const asset of world.assets) {
        const attestation = asset.attestations.find((a) => a.ref === request.params.id);
        if (!attestation) continue;
        const visible =
          (asset.ownerOrgId === member.orgId && member.roles.includes("BORROWER")) ||
          (attestation.issuerOrgId === member.orgId && member.roles.includes("VERIFIER")) ||
          world.cases.some((c) => c.asset.ref === asset.ref && presentCaseDetail(c, member, pctx)?.allowedTabs.includes("verification"));
        if (visible) return presentAttestation(asset, attestation, pctx);
      }
      throw problems.unavailable();
    },
  );

  /** Shared guard: the request as the viewer sees it, policy + state, then the runner. */
  async function act<R>(
    member: ResolvedActor,
    ref: string,
    action: VerificationAction,
    input: { key: string; operation: string; payload: unknown; build: (ctx: { at: Date }) => Pick<LedgerWorkflowInput<R>, "prepare" | "result"> },
  ) {
    const at = now();
    const { world, pctx } = await loadViewerWorld(db, member, mode, at);
    const found = findVerification(world, ref);
    if (!found) throw problems.unavailable();
    assertCheck(checkVerificationAction(found.asset, found.verification, member, action, at, pctx), { replay: await commandExists(db, member, input.operation, input.key) });
    const actor = await workflow.actorFor(member);
    return { found, outcome: await workflow.run<R>({ actor, operation: input.operation, idempotencyKey: input.key, payload: input.payload, resourceRef: ref, ...input.build({ at }) }) };
  }

  const verifierOf = async (member: ResolvedActor) => must((await workflow.actorFor(member)).business, workflowProblems.ledgerUnavailable).party;

  app.post(
    "/verifications/:id/assignment",
    {
      schema: { tags: ["verifications"], summary: "Accept or decline an assignment (assigned verifier)", headers: IdempotencyHeadersSchema, params: VerificationParams, body: AssignmentDecisionRequestSchema, response: workflowResponseSchemas() },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const ref = request.params.id;
      const input = request.body;
      const { outcome } = await act(member, ref, input.decision === "ACCEPT" ? "verification.acceptAssignment" : "verification.declineAssignment", {
        key: request.headers["idempotency-key"],
        operation: "verification.assignment",
        payload: { ref, input },
        build: () => ({
          prepare: async (ctx) => {
            const vr = await activeRequest(ctx.acs, { ref, namespace: ctx.namespace });
            if (vr.payload.status !== "REQUESTED") throw workflowProblems.stateChanged();
            if (input.decision === "DECLINE") return { commands: [L.vrDeclineAssignment(vr.contractId, { reason: input.reason, actorRef: ctx.actorRef })] };
            const { config, accreditation } = await verifierInputs(ctx.acs, { verifierParty: await verifierOf(member), namespace: ctx.namespace });
            return { commands: [L.vrAcceptAssignment(vr.contractId, { configCid: config.contractId, accreditationCid: accreditation.contractId, actorRef: ctx.actorRef })] };
          },
        }),
      });
      return replyWithOutcome(reply, outcome);
    },
  );

  app.post(
    "/verifications/:id/change-requests",
    {
      schema: { tags: ["verifications"], summary: "Request changes to the evidence (assigned verifier)", headers: IdempotencyHeadersSchema, params: VerificationParams, body: MessageRequestSchema, response: workflowResponseSchemas() },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const ref = request.params.id;
      const input = request.body;
      const { outcome } = await act(member, ref, "verification.requestChanges", {
        key: request.headers["idempotency-key"],
        operation: "verification.requestChanges",
        payload: { ref, input },
        build: () => ({
          prepare: async (ctx) => {
            const vr = await activeRequest(ctx.acs, { ref, namespace: ctx.namespace });
            if (vr.payload.status !== "IN_REVIEW") throw workflowProblems.stateChanged();
            return { commands: [L.vrRequestChanges(vr.contractId, { note: input.message, actorRef: ctx.actorRef })] };
          },
        }),
      });
      return replyWithOutcome(reply, outcome);
    },
  );

  app.post(
    "/verifications/:id/rejection",
    {
      schema: { tags: ["verifications"], summary: "Reject the verification (assigned verifier)", headers: IdempotencyHeadersSchema, params: VerificationParams, body: ReasonRequestSchema, response: workflowResponseSchemas() },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const ref = request.params.id;
      const input = request.body;
      const { outcome } = await act(member, ref, "verification.reject", {
        key: request.headers["idempotency-key"],
        operation: "verification.reject",
        payload: { ref, input },
        build: () => ({
          prepare: async (ctx) => {
            const vr = await activeRequest(ctx.acs, { ref, namespace: ctx.namespace });
            if (vr.payload.status !== "IN_REVIEW") throw workflowProblems.stateChanged();
            return { commands: [L.vrReject(vr.contractId, { reason: input.reason, actorRef: ctx.actorRef })] };
          },
        }),
      });
      return replyWithOutcome(reply, outcome);
    },
  );

  app.post(
    "/verifications/:id/attestations",
    {
      schema: {
        tags: ["verifications"],
        summary: "Issue the attestation (active assigned verifier); supersedes the verifier's previous attestation of the asset",
        headers: IdempotencyHeadersSchema,
        params: VerificationParams,
        body: IssueAttestationRequestSchema,
        response: workflowResponseSchemas(z.object({ attestationRef: AttestationRefSchema })),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const ref = request.params.id;
      const input = request.body;
      if (Date.parse(input.validUntil) <= Math.max(Date.parse(input.inspectedAt), now().getTime())) {
        throw problems.validation([{ path: "body.validUntil", message: VALIDITY_ORDER }], VALIDITY_ORDER);
      }
      let attestationRef = "";
      const { outcome } = await act<{ attestationRef: string }>(member, ref, "verification.issueAttestation", {
        key: request.headers["idempotency-key"],
        operation: "verification.issueAttestation",
        payload: { ref, input },
        build: ({ at }) => ({
          prepare: async (ctx) => {
            const verifier = await verifierOf(member);
            const vr = await activeRequest(ctx.acs, { ref, namespace: ctx.namespace });
            if (vr.payload.status !== "IN_REVIEW") throw workflowProblems.stateChanged();
            const { config, accreditation } = await verifierInputs(ctx.acs, { verifierParty: verifier, namespace: ctx.namespace });
            const issued = await ctx.acs.list("VerificationAttestation", (a) => a.namespace === ctx.namespace);
            const previous = issued.filter((a) => a.payload.assetId === vr.payload.assetId && a.payload.verifier === verifier).sort((a, b) => a.offset - b.offset).at(-1);
            const disclosures = previous ? await ctx.acs.list("AttestationDisclosure", (d) => d.attestationCid === previous.contractId) : [];
            attestationRef = await allocateFreshRef(db, "attestation", issued.map((a) => a.payload.attestationRef));
            return {
              commands: [
                L.vrIssueAttestation(vr.contractId, {
                  configCid: config.contractId,
                  accreditationCid: accreditation.contractId,
                  attestationRef,
                  checks: input.checks,
                  limitations: input.limitations,
                  method: input.method,
                  inspectedAt: input.inspectedAt,
                  validFrom: at,
                  validUntil: input.validUntil,
                  supersedes: previous ? { previousCid: previous.contractId, previousDisclosureCids: disclosures.map((d) => d.contractId) } : null,
                  actorRef: ctx.actorRef,
                }),
              ],
            };
          },
          result: (step) => ({ attestationRef: createdField(step, "VerificationAttestation", "attestationRef", attestationRef) }),
        }),
      });
      return replyWithOutcome(reply, outcome);
    },
  );

  app.post(
    "/verifications/:id/evidence-submissions",
    {
      schema: { tags: ["verifications"], summary: "Resubmit a new evidence version after a change request (owner)", headers: IdempotencyHeadersSchema, params: VerificationParams, response: workflowResponseSchemas() },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const ref = request.params.id;
      const key = request.headers["idempotency-key"];
      const at = now();
      const { world, pctx } = await loadViewerWorld(db, member, mode, at);
      const found = findVerification(world, ref);
      if (!found) throw problems.unavailable();
      assertCheck(checkVerificationAction(found.asset, found.verification, member, "verification.submitEvidence", at, pctx), {
        replay: await commandExists(db, member, "verification.submitEvidence", key),
      });
      const owner = await workflow.actorFor(member);
      const assetRef = found.asset.ref;
      const outcome = await workflow.sequence({
        actor: owner,
        operation: "verification.submitEvidence",
        idempotencyKey: key,
        payload: { ref },
        resourceRef: ref,
        steps: async (seq) => {
          const namespace = must(workflow.namespace, workflowProblems.ledgerUnavailable);
          const ownerParty = must(owner.business, workflowProblems.ledgerUnavailable).party;
          const ownerAcs = workflow.acs(owner);
          const vr = await activeRequest(ownerAcs, { ref, namespace });
          const committed = await commitManifestIfChanged(seq, { db, ownerAcs, namespace, assetRef, ownerOrgId: owner.orgId, ownerParty });
          const manifest = must(await currentManifest(ownerAcs, { assetRef, ownerParty, namespace }));
          if (!committed && manifest.payload.version <= vr.payload.evidence.manifestVersion) throw problems.stateConflict(NO_NEW_EVIDENCE);
          await seq.step("submit", {
            prepare: async (ctx) => {
              const live = await activeRequest(ctx.acs, { ref, namespace: ctx.namespace });
              if (live.payload.status !== "CHANGES_REQUESTED") throw workflowProblems.stateChanged();
              const latest = must(await currentManifest(ctx.acs, { assetRef, ownerParty, namespace: ctx.namespace }));
              return { commands: [L.manifestSubmitToVerification(latest.contractId, { requestCid: live.contractId, actorRef: ctx.actorRef })] };
            },
          });
          return null;
        },
      });
      return replyWithOutcome(reply, outcome);
    },
  );
};
