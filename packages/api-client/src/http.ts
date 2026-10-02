// HTTP implementation of CollaraClient (LOCALNET): same-origin `/api` through the Next proxy,
// Idempotency-Key on every mutation, Zod-parsed responses, ApiError for every failure.
import {
  AccessGrantSchema,
  AssetDetailSchema,
  AssetSummarySchema,
  AttestationSchema,
  AuditEventSchema,
  CaseDetailSchema,
  CaseListSchema,
  CommandResponseSchema,
  CommandStatusSchema,
  commandResultSchema,
  DemoPersonaSchema,
  EvidenceDocumentSchema,
  EvidenceDownloadSchema,
  GovernanceProposalSchema,
  GovernanceStateSchema,
  MeSchema,
  pageSchema,
  PilotRequestReceiptSchema,
  PledgeSchema,
  ProposalSchema,
  ReleaseRequestSchema,
  ReportDownloadSchema,
  ReportSchema,
  ReviewSchema,
  ReviewSummarySchema,
  SystemHealthSchema,
  UploadIntentSchema,
  VerificationRequestSchema,
  VerifierEntrySchema,
} from "@collara/domain";
import { z } from "zod";
import { API_ENDPOINTS, endpointPath, type CollaraClient, type EndpointName, type MutationOptions, type RequestOptions } from "./client";
import { ApiError } from "./errors";
import { randomId } from "./util";

export interface HttpClientOptions {
  /** Default "/api" (same-origin through the web proxy). Server code may pass an absolute URL. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** Default crypto.randomUUID(). */
  readonly createIdempotencyKey?: () => string;
  /** Extra headers on every request (never credentials from the browser). */
  readonly headers?: Readonly<Record<string, string>>;
}

type Query = Readonly<Record<string, string | number | boolean | undefined>>;

interface CallOptions {
  readonly id?: string;
  readonly query?: Query;
  readonly body?: unknown;
  readonly raw?: Blob;
  readonly options?: RequestOptions | MutationOptions;
}

const result = {
  caseId: commandResultSchema(z.object({ caseId: z.string() })),
  grantId: commandResultSchema(z.object({ grantId: z.string() })),
  verificationRef: commandResultSchema(z.object({ verificationRef: z.string() })),
  pledgeRef: commandResultSchema(z.object({ pledgeRef: z.string() })),
  assetRef: commandResultSchema(z.object({ assetRef: z.string() })),
  attestationRef: commandResultSchema(z.object({ attestationRef: z.string() })),
  releaseRequestRef: commandResultSchema(z.object({ releaseRequestRef: z.string() })),
  proposalRef: commandResultSchema(z.object({ proposalRef: z.string() })),
  proposalVersion: commandResultSchema(z.object({ proposalRef: z.string(), version: z.number().int() })),
};

export function createHttpClient(config: HttpClientOptions = {}): CollaraClient {
  const baseUrl = (config.baseUrl ?? "/api").replace(/\/+$/, "");
  const doFetch = config.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const newKey = config.createIdempotencyKey ?? randomId;

  async function call<S extends z.ZodType>(name: EndpointName, schema: S, req: CallOptions = {}): Promise<z.output<S>> {
    const { method } = API_ENDPOINTS[name];
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query ?? {})) if (value !== undefined) search.set(key, String(value));
    const qs = search.toString();
    const url = `${baseUrl}${endpointPath(name, req.id)}${qs ? `?${qs}` : ""}`;

    const headers: Record<string, string> = { accept: "application/json", ...config.headers };
    let body: BodyInit | undefined;
    if (req.raw) {
      body = req.raw;
      headers["content-type"] = req.raw.type || "application/octet-stream";
    } else if (req.body !== undefined) {
      body = JSON.stringify(req.body);
      headers["content-type"] = "application/json";
    }
    if (method !== "GET") {
      const key = (req.options as MutationOptions | undefined)?.idempotencyKey ?? newKey();
      headers["idempotency-key"] = key;
    }

    let response: Response;
    try {
      response = await doFetch(url, { method, headers, body, credentials: "same-origin", signal: req.options?.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "network_error", "The request could not reach the server.");
    }

    const text = await response.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (response.ok) throw new ApiError(response.status, "invalid_response", "The server returned an unreadable response.");
      }
    }
    if (!response.ok) throw ApiError.fromResponse(response.status, json);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(response.status, "invalid_response", `Unexpected response shape for ${name}: ${parsed.error.issues[0]?.message ?? ""}`);
    }
    return parsed.data;
  }

  const page = <S extends z.ZodType>(item: S) => pageSchema(item);

  return {
    kind: "http",
    me: (options) => call("me", MeSchema, { options }),
    demo: {
      personas: (options) => call("demo.personas", z.array(DemoPersonaSchema), { options }),
      createSession: (body, options) => call("demo.createSession", MeSchema, { body, options }),
    },
    cases: {
      list: (query, options) => call("cases.list", CaseListSchema, { query, options }),
      get: (id, options) => call("cases.get", CaseDetailSchema, { id, options }),
      create: (body, options) => call("cases.create", result.caseId, { body, options }),
      evidence: (id, options) => call("cases.evidence", z.array(EvidenceDocumentSchema), { id, options }),
      share: (id, body, options) => call("cases.share", result.grantId, { id, body, options }),
      requestVerification: (id, body, options) =>
        call("cases.requestVerification", result.verificationRef, { id, body, options }),
      saveAssessment: (id, body, options) => call("cases.saveAssessment", commandResultSchema(ReviewSchema), { id, body, options }),
      createProposal: (id, body, options) =>
        call("cases.createProposal", result.proposalVersion, { id, body, options }),
      activatePledge: (id, options) => call("cases.activatePledge", result.pledgeRef, { id, body: {}, options }),
    },
    assets: {
      list: (query, options) => call("assets.list", page(AssetSummarySchema), { query, options }),
      get: (id, options) => call("assets.get", AssetDetailSchema, { id, options }),
      register: (body, options) => call("assets.register", result.assetRef, { body, options }),
      evidence: (id, options) => call("assets.evidence", z.array(EvidenceDocumentSchema), { id, options }),
      requestVerification: (id, body, options) =>
        call("assets.requestVerification", result.verificationRef, { id, body, options }),
    },
    evidence: {
      createUploadIntent: (body, options) => call("evidence.createUploadIntent", commandResultSchema(UploadIntentSchema), { body, options }),
      uploadContent: (id, file, options) => call("evidence.uploadContent", commandResultSchema(EvidenceDocumentSchema), { id, raw: file, options }),
      finalize: (id, options) => call("evidence.finalize", commandResultSchema(EvidenceDocumentSchema), { id, body: {}, options }),
      get: (id, options) => call("evidence.get", EvidenceDocumentSchema, { id, options }),
      download: (id, options) => call("evidence.download", EvidenceDownloadSchema, { id, options }),
    },
    verifications: {
      list: (query, options) => call("verifications.list", page(VerificationRequestSchema), { query, options }),
      get: (id, options) => call("verifications.get", VerificationRequestSchema, { id, options }),
      decideAssignment: (id, body, options) => call("verifications.decideAssignment", CommandResponseSchema, { id, body, options }),
      requestChanges: (id, body, options) => call("verifications.requestChanges", CommandResponseSchema, { id, body, options }),
      submitEvidence: (id, options) => call("verifications.submitEvidence", CommandResponseSchema, { id, body: {}, options }),
      issueAttestation: (id, body, options) =>
        call("verifications.issueAttestation", result.attestationRef, { id, body, options }),
      reject: (id, body, options) => call("verifications.reject", CommandResponseSchema, { id, body, options }),
    },
    attestations: {
      get: (id, options) => call("attestations.get", AttestationSchema, { id, options }),
    },
    reviews: {
      list: (query, options) => call("reviews.list", page(ReviewSummarySchema), { query, options }),
      get: (id, options) => call("reviews.get", ReviewSchema, { id, options }),
      submitForApproval: (id, options) => call("reviews.submitForApproval", CommandResponseSchema, { id, body: {}, options }),
      decide: (id, body, options) => call("reviews.decide", CommandResponseSchema, { id, body, options }),
      requestInformation: (id, body, options) => call("reviews.requestInformation", CommandResponseSchema, { id, body, options }),
    },
    proposals: {
      get: (id, options) => call("proposals.get", ProposalSchema, { id, options }),
      accept: (id, body, options) => call("proposals.accept", CommandResponseSchema, { id, body, options }),
      decline: (id, body, options) => call("proposals.decline", CommandResponseSchema, { id, body, options }),
      withdraw: (id, body, options) => call("proposals.withdraw", CommandResponseSchema, { id, body: body ?? {}, options }),
      authorizeActivation: (id, body, options) => call("proposals.authorizeActivation", CommandResponseSchema, { id, body, options }),
    },
    pledges: {
      list: (query, options) => call("pledges.list", page(PledgeSchema), { query, options }),
      get: (id, options) => call("pledges.get", PledgeSchema, { id, options }),
      requestRelease: (id, body, options) =>
        call("pledges.requestRelease", result.releaseRequestRef, { id, body, options }),
    },
    releaseRequests: {
      get: (id, options) => call("releaseRequests.get", ReleaseRequestSchema, { id, options }),
      decide: (id, body, options) => call("releaseRequests.decide", CommandResponseSchema, { id, body, options }),
      requestInformation: (id, body, options) => call("releaseRequests.requestInformation", CommandResponseSchema, { id, body, options }),
      respond: (id, body, options) => call("releaseRequests.respond", CommandResponseSchema, { id, body, options }),
      withdraw: (id, options) => call("releaseRequests.withdraw", CommandResponseSchema, { id, body: {}, options }),
    },
    accessGrants: {
      list: (query, options) => call("accessGrants.list", page(AccessGrantSchema), { query, options }),
      create: (body, options) => call("accessGrants.create", result.grantId, { body, options }),
      revoke: (id, options) => call("accessGrants.revoke", CommandResponseSchema, { id, body: {}, options }),
    },
    audit: {
      events: (query, options) => call("audit.events", page(AuditEventSchema), { query, options }),
    },
    reports: {
      list: (query, options) => call("reports.list", page(ReportSchema), { query, options }),
      create: (body, options) => call("reports.create", commandResultSchema(ReportSchema), { body, options }),
      download: (id, options) => call("reports.download", ReportDownloadSchema, { id, options }),
    },
    verifiers: {
      list: (options) => call("verifiers.list", z.array(VerifierEntrySchema), { options }),
    },
    governance: {
      state: (options) => call("governance.state", GovernanceStateSchema, { options }),
      proposals: (options) => call("governance.proposals", z.array(GovernanceProposalSchema), { options }),
      proposal: (id, options) => call("governance.proposal", GovernanceProposalSchema, { id, options }),
      propose: (body, options) => call("governance.propose", result.proposalRef, { body, options }),
      confirm: (id, options) => call("governance.confirm", CommandResponseSchema, { id, body: {}, options }),
      execute: (id, options) => call("governance.execute", CommandResponseSchema, { id, body: {}, options }),
      cancel: (id, options) => call("governance.cancel", CommandResponseSchema, { id, body: {}, options }),
    },
    commands: {
      get: (id, options) => call("commands.get", CommandStatusSchema, { id, options }),
    },
    pilotRequests: {
      create: (body, options) => call("pilotRequests.create", commandResultSchema(PilotRequestReceiptSchema), { body, options }),
    },
    system: {
      health: (options) => call("system.health", SystemHealthSchema, { options }),
    },
  };
}
