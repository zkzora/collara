// Assets: GET|POST /assets, GET /assets/:id, GET /assets/:id/evidence, POST /assets/:id/verification-requests
// (API_ENDPOINTS "assets.*"). Registration runs the registrar service (workflow.registrar.registerAsset: owner
// request → Registry_Reserve → Request_Accept, or a generic Request_Decline for an identity already registered by
// someone else). Reads come from the projections through the read model and the domain presenters.
import { createHash } from "node:crypto";
import {
  AssetDetailSchema,
  AssetRefSchema,
  AssetSummarySchema,
  can,
  checkAssetAction,
  COMMAND_COPY,
  CreateVerificationRequestSchema,
  EvidenceDocumentSchema,
  pageSchema,
  PageQuerySchema,
  paginate,
  presentAssetDetail,
  presentAssetSummary,
  presentEvidenceList,
  RegisterAssetRequestSchema,
  type AssetSummary,
} from "@collara/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../../errors";
import { identityCommitmentOf } from "../../ledger/builders";
import { commandProblem, IdempotencyHeadersSchema, replyWithOutcome, workflowResponseSchemas } from "../../workflow";
import { assertCheck, commandExists, findAsset, loadViewerWorld } from "../../workflow/cases/read";
import { requestVerification } from "../../workflow/verification/request";
import type { WorkflowRouteOptions } from "./types";

const AssetParams = z.object({ id: AssetRefSchema });
/** INFERRED copy, same strings as the UI_MOCK client. */
const ALREADY_REGISTERED = "This equipment is already registered by your organization.";
/** INFERRED copy: drafts are application records the LocalNet API does not keep (no asset draft table). */
const DRAFTS_UNAVAILABLE = "Saving a draft is not available in this environment. Register the asset to continue.";

export const assetRoutes: FastifyPluginAsyncZod<WorkflowRouteOptions> = async (app, { services, workflow, mode }) => {
  const db = services.db.db;
  const now = services.clock;

  app.get(
    "/assets",
    { schema: { tags: ["assets"], summary: "Asset passports visible to the viewer", querystring: PageQuerySchema, response: { 200: pageSchema(AssetSummarySchema) } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const items = world.assets.map((asset) => presentAssetSummary(asset, world.cases, member, pctx)).filter((x): x is AssetSummary => x !== null);
      return paginate(items, request.query);
    },
  );

  app.get(
    "/assets/:id",
    { schema: { tags: ["assets"], summary: "Asset passport detail", params: AssetParams, response: { 200: AssetDetailSchema } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const asset = findAsset(world, request.params.id);
      const detail = asset ? presentAssetDetail(asset, world.cases, member, pctx) : null;
      if (!detail) throw problems.unavailable();
      return detail;
    },
  );

  app.get(
    "/assets/:id/evidence",
    { schema: { tags: ["assets"], summary: "Evidence documents of the asset visible to the viewer", params: AssetParams, response: { 200: z.array(EvidenceDocumentSchema) } } },
    async (request) => {
      const member = await request.requireActor();
      const { world, pctx } = await loadViewerWorld(db, member, mode, now());
      const asset = findAsset(world, request.params.id);
      const documents = asset ? presentEvidenceList(asset, world.cases, member, pctx) : null;
      if (!documents) throw problems.unavailable();
      return documents;
    },
  );

  // --- POST /assets (registration) ------------------------------------------------------------------

  app.post(
    "/assets",
    {
      schema: {
        tags: ["assets"],
        summary: "Register an asset passport (owner request, registrar reservation and acceptance on the ledger)",
        headers: IdempotencyHeadersSchema,
        body: RegisterAssetRequestSchema,
        response: workflowResponseSchemas(z.object({ assetRef: AssetRefSchema })),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const input = request.body;
      const key = request.headers["idempotency-key"];
      if (!can(member, "passport.register")) throw problems.forbidden();
      if (input.intent === "DRAFT") throw problems.stateConflict(DRAFTS_UNAVAILABLE);
      const owner = await workflow.actorFor(member);
      const equipment = { manufacturer: input.manufacturer, model: input.model, serialNumber: input.serialNumber };
      if (!(await commandExists(db, member, "asset.register", key)) && workflow.access && owner.business) {
        // Same organisation, same identity (on-ledger exact match of the commitment): say so. Another
        // organisation's registration is never revealed; the registrar declines it generically.
        const commitment = identityCommitmentOf(equipment);
        const acs = workflow.acs(owner);
        const [passports, pending] = await Promise.all([
          acs.list("AssetPassport", (p) => p.identityCommitment === commitment && p.namespace === workflow.namespace),
          acs.list("AssetRegistrationRequest", (r) => r.identityCommitment === commitment && r.namespace === workflow.namespace),
        ]);
        if (passports.length > 0 || pending.length > 0) throw problems.stateConflict(ALREADY_REGISTERED);
      }
      // Deterministic per (organisation, idempotency key): a retry reuses the same ledger request reference.
      const digest = createHash("sha256").update(`${member.orgId}\n${key}`).digest("hex").slice(0, 10).toUpperCase();
      const outcome = await workflow.registrar.registerAsset({
        owner,
        idempotencyKey: key,
        registration: {
          requestRef: `REG-${digest}`,
          equipmentClass: input.equipmentClass,
          equipment,
          yearOfManufacture: input.yearOfManufacture ?? null,
          locationScope: input.locationScope,
          ownerClaimRef: `CLAIM-${digest}`,
        },
      });
      const result = outcome.result;
      if (outcome.committed && result?.outcome === "REGISTERED") {
        return replyWithOutcome(reply, { ...outcome, result: { assetRef: result.assetId } });
      }
      // Declined (identity already registered elsewhere): committed on the ledger, but no asset for this owner.
      if (outcome.committed) throw commandProblem("state_conflict", COMMAND_COPY.STATE_CHANGED, outcome.command);
      return replyWithOutcome(reply, { ...outcome, result: null });
    },
  );

  // --- POST /assets/:id/verification-requests -------------------------------------------------------

  app.post(
    "/assets/:id/verification-requests",
    {
      schema: {
        tags: ["assets"],
        summary: "Request verification of the asset (owner; may precede any case)",
        headers: IdempotencyHeadersSchema,
        params: AssetParams,
        body: CreateVerificationRequestSchema,
        response: workflowResponseSchemas(z.object({ verificationRef: z.string() })),
      },
    },
    async (request, reply) => {
      const member = await request.requireActor();
      const key = request.headers["idempotency-key"];
      const at = now();
      const { world, pctx } = await loadViewerWorld(db, member, mode, at);
      const asset = findAsset(world, request.params.id);
      if (!asset) throw problems.unavailable();
      assertCheck(checkAssetAction(asset, world.cases, member, "verification.request", at, pctx), { replay: await commandExists(db, member, "verification.request", key) });
      const owner = await workflow.actorFor(member);
      const caseRef = request.body.caseId ?? null;
      if (caseRef && !world.cases.some((c) => c.ref === caseRef && c.asset.ref === asset.ref && c.borrowerOrgId === member.orgId)) throw problems.unavailable();
      const outcome = await requestVerification({ db, workflow, owner, asset, caseRef, body: request.body, idempotencyKey: key, now: at });
      return replyWithOutcome(reply, outcome);
    },
  );
};
