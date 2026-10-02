// The CollaraClient contract. Implemented over HTTP (`createHttpClient`, LOCALNET) and in memory
// (`createMockClient` from "@collara/api-client/mock", UI_MOCK). Every mutation accepts an
// idempotency key and returns a CommandStatus (plus a domain result where one exists).
import type {
  AccessGrant,
  AccessGrantQuery,
  AssetDetail,
  AssetSummary,
  AssignmentDecisionRequest,
  Attestation,
  AuditEvent,
  AuditEventQuery,
  CaseDetail,
  CaseList,
  CaseListQuery,
  CommandResponse,
  CommandResult,
  CommandStatus,
  CreateAuditGrantRequest,
  CreateCaseRequest,
  CreateGovernanceProposalRequest,
  CreateProposalRequest,
  CreateReleaseRequest,
  CreateReportRequest,
  CreateVerificationRequest,
  DeclineProposalRequest,
  DemoPersona,
  DemoSessionRequest,
  EvidenceDocument,
  EvidenceDownload,
  ExpectedVersionRequest,
  GovernanceProposal,
  GovernanceState,
  IssueAttestationRequest,
  Me,
  MessageRequest,
  OrgRef,
  Overview,
  Page,
  PageQuery,
  PilotRequest,
  PilotRequestReceipt,
  Pledge,
  PledgeListQuery,
  Proposal,
  ReasonRequest,
  RegisterAssetRequest,
  ReleaseDecisionRequest,
  ReleaseRequest,
  Report,
  ReportDownload,
  Review,
  ReviewDecisionRequest,
  ReviewSummary,
  SaveAssessmentRequest,
  ShareCaseRequest,
  SubmitEvidenceRequest,
  SystemHealth,
  UploadIntent,
  UploadIntentRequest,
  VerificationRequest,
  VerifierEntry,
} from "@collara/domain";

export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface MutationOptions extends RequestOptions {
  /** Reuse the same key when retrying the same action (Idempotency-Key header). */
  readonly idempotencyKey?: string;
}

export interface CollaraClient {
  readonly kind: "http" | "mock";

  me(options?: RequestOptions): Promise<Me>;

  demo: {
    personas(options?: RequestOptions): Promise<DemoPersona[]>;
    createSession(body: DemoSessionRequest, options?: MutationOptions): Promise<Me>;
  };

  cases: {
    list(query?: CaseListQuery, options?: RequestOptions): Promise<CaseList>;
    get(caseId: string, options?: RequestOptions): Promise<CaseDetail>;
    create(body: CreateCaseRequest, options?: MutationOptions): Promise<CommandResult<{ caseId: string }>>;
    evidence(caseId: string, options?: RequestOptions): Promise<EvidenceDocument[]>;
    share(caseId: string, body: ShareCaseRequest, options?: MutationOptions): Promise<CommandResult<{ grantId: string }>>;
    requestVerification(
      caseId: string,
      body: CreateVerificationRequest,
      options?: MutationOptions,
    ): Promise<CommandResult<{ verificationRef: string }>>;
    saveAssessment(caseId: string, body: SaveAssessmentRequest, options?: MutationOptions): Promise<CommandResult<Review>>;
    createProposal(
      caseId: string,
      body: CreateProposalRequest,
      options?: MutationOptions,
    ): Promise<CommandResult<{ proposalRef: string; version: number }>>;
    activatePledge(caseId: string, options?: MutationOptions): Promise<CommandResult<{ pledgeRef: string }>>;
  };

  assets: {
    list(query?: PageQuery, options?: RequestOptions): Promise<Page<AssetSummary>>;
    get(assetRef: string, options?: RequestOptions): Promise<AssetDetail>;
    register(body: RegisterAssetRequest, options?: MutationOptions): Promise<CommandResult<{ assetRef: string }>>;
    evidence(assetRef: string, options?: RequestOptions): Promise<EvidenceDocument[]>;
    requestVerification(
      assetRef: string,
      body: CreateVerificationRequest,
      options?: MutationOptions,
    ): Promise<CommandResult<{ verificationRef: string }>>;
  };

  evidence: {
    createUploadIntent(body: UploadIntentRequest, options?: MutationOptions): Promise<CommandResult<UploadIntent>>;
    /** Streams bytes into quarantine through the API (PDF/JPEG/PNG, 20 MB). */
    uploadContent(evidenceId: string, file: Blob, options?: MutationOptions): Promise<CommandResult<EvidenceDocument>>;
    /** Server hashes, checks type/size and assigns the version. */
    finalize(evidenceId: string, options?: MutationOptions): Promise<CommandResult<EvidenceDocument>>;
    get(evidenceId: string, options?: RequestOptions): Promise<EvidenceDocument>;
    /** Short-lived link issued after a server-side access check. */
    download(evidenceId: string, options?: RequestOptions): Promise<EvidenceDownload>;
  };

  verifications: {
    list(query?: PageQuery, options?: RequestOptions): Promise<Page<VerificationRequest>>;
    get(verificationRef: string, options?: RequestOptions): Promise<VerificationRequest>;
    decideAssignment(verificationRef: string, body: AssignmentDecisionRequest, options?: MutationOptions): Promise<CommandResponse>;
    requestChanges(verificationRef: string, body: MessageRequest, options?: MutationOptions): Promise<CommandResponse>;
    /** `body.documentIds`: the documents granted to the verifier at the new version (default: the previous grant's). */
    submitEvidence(verificationRef: string, body?: SubmitEvidenceRequest, options?: MutationOptions): Promise<CommandResponse>;
    issueAttestation(
      verificationRef: string,
      body: IssueAttestationRequest,
      options?: MutationOptions,
    ): Promise<CommandResult<{ attestationRef: string }>>;
    reject(verificationRef: string, body: ReasonRequest, options?: MutationOptions): Promise<CommandResponse>;
  };

  attestations: {
    get(attestationRef: string, options?: RequestOptions): Promise<Attestation>;
  };

  reviews: {
    list(query?: PageQuery, options?: RequestOptions): Promise<Page<ReviewSummary>>;
    get(reviewRef: string, options?: RequestOptions): Promise<Review>;
    submitForApproval(reviewRef: string, options?: MutationOptions): Promise<CommandResponse>;
    decide(reviewRef: string, body: ReviewDecisionRequest, options?: MutationOptions): Promise<CommandResponse>;
    requestInformation(reviewRef: string, body: MessageRequest, options?: MutationOptions): Promise<CommandResponse>;
  };

  proposals: {
    get(proposalRef: string, options?: RequestOptions): Promise<Proposal>;
    accept(proposalRef: string, body: ExpectedVersionRequest, options?: MutationOptions): Promise<CommandResponse>;
    decline(proposalRef: string, body: DeclineProposalRequest, options?: MutationOptions): Promise<CommandResponse>;
    withdraw(proposalRef: string, body?: { reason?: string }, options?: MutationOptions): Promise<CommandResponse>;
    authorizeActivation(proposalRef: string, body: ExpectedVersionRequest, options?: MutationOptions): Promise<CommandResponse>;
  };

  pledges: {
    list(query?: PledgeListQuery, options?: RequestOptions): Promise<Page<Pledge>>;
    get(pledgeRef: string, options?: RequestOptions): Promise<Pledge>;
    requestRelease(
      pledgeRef: string,
      body: CreateReleaseRequest,
      options?: MutationOptions,
    ): Promise<CommandResult<{ releaseRequestRef: string }>>;
  };

  releaseRequests: {
    get(releaseRequestRef: string, options?: RequestOptions): Promise<ReleaseRequest>;
    decide(releaseRequestRef: string, body: ReleaseDecisionRequest, options?: MutationOptions): Promise<CommandResponse>;
    requestInformation(releaseRequestRef: string, body: MessageRequest, options?: MutationOptions): Promise<CommandResponse>;
    respond(releaseRequestRef: string, body: MessageRequest, options?: MutationOptions): Promise<CommandResponse>;
    withdraw(releaseRequestRef: string, options?: MutationOptions): Promise<CommandResponse>;
  };

  accessGrants: {
    list(query?: AccessGrantQuery, options?: RequestOptions): Promise<Page<AccessGrant>>;
    /** Audit grants: one per record owner (borrower and/or lender). */
    create(body: CreateAuditGrantRequest, options?: MutationOptions): Promise<CommandResult<{ grantId: string }>>;
    revoke(grantId: string, options?: MutationOptions): Promise<CommandResponse>;
  };

  audit: {
    events(query?: AuditEventQuery, options?: RequestOptions): Promise<Page<AuditEvent>>;
  };

  reports: {
    list(query?: PageQuery, options?: RequestOptions): Promise<Page<Report>>;
    create(body: CreateReportRequest, options?: MutationOptions): Promise<CommandResult<Report>>;
    /** Access is re-checked at download. */
    download(reportRef: string, options?: RequestOptions): Promise<ReportDownload>;
  };

  verifiers: {
    list(options?: RequestOptions): Promise<VerifierEntry[]>;
  };

  /** Onboarded counterparties a borrower may select on a new case (organization id and name only). */
  directory: {
    lenders(options?: RequestOptions): Promise<OrgRef[]>;
    dealers(options?: RequestOptions): Promise<OrgRef[]>;
  };

  /** Recorded figures for the Overview, per currency, from the viewer's own scope. */
  overview: {
    get(options?: RequestOptions): Promise<Overview>;
  };

  governance: {
    state(options?: RequestOptions): Promise<GovernanceState>;
    proposals(options?: RequestOptions): Promise<GovernanceProposal[]>;
    proposal(proposalRef: string, options?: RequestOptions): Promise<GovernanceProposal>;
    propose(body: CreateGovernanceProposalRequest, options?: MutationOptions): Promise<CommandResult<{ proposalRef: string }>>;
    confirm(proposalRef: string, options?: MutationOptions): Promise<CommandResponse>;
    execute(proposalRef: string, options?: MutationOptions): Promise<CommandResponse>;
    cancel(proposalRef: string, options?: MutationOptions): Promise<CommandResponse>;
  };

  commands: {
    get(commandId: string, options?: RequestOptions): Promise<CommandStatus>;
  };

  pilotRequests: {
    create(body: PilotRequest, options?: MutationOptions): Promise<CommandResult<PilotRequestReceipt>>;
  };

  system: {
    health(options?: RequestOptions): Promise<SystemHealth>;
  };
}

/**
 * Canonical API routes (synthesis §1.2.5; S §15.2 names kept verbatim, additions marked there as
 * INFERRED). Paths are relative to the API base (`/api`). The API builder registers these.
 */
export const API_ENDPOINTS = {
  me: { method: "GET", path: "/me" },
  "demo.personas": { method: "GET", path: "/demo/personas" },
  "demo.createSession": { method: "POST", path: "/demo/sessions" },
  "cases.list": { method: "GET", path: "/cases" },
  "cases.get": { method: "GET", path: "/cases/:id" },
  "cases.create": { method: "POST", path: "/cases" },
  "cases.evidence": { method: "GET", path: "/cases/:id/evidence" },
  "cases.share": { method: "POST", path: "/cases/:id/sharing" },
  "cases.requestVerification": { method: "POST", path: "/cases/:id/verification-requests" },
  "cases.saveAssessment": { method: "POST", path: "/cases/:id/assessments" },
  "cases.createProposal": { method: "POST", path: "/cases/:id/proposals" },
  "cases.activatePledge": { method: "POST", path: "/cases/:id/pledge-activation" },
  "assets.list": { method: "GET", path: "/assets" },
  "assets.get": { method: "GET", path: "/assets/:id" },
  "assets.register": { method: "POST", path: "/assets" },
  "assets.evidence": { method: "GET", path: "/assets/:id/evidence" },
  "assets.requestVerification": { method: "POST", path: "/assets/:id/verification-requests" },
  "evidence.createUploadIntent": { method: "POST", path: "/evidence/upload-intents" },
  "evidence.uploadContent": { method: "PUT", path: "/evidence/:id/content" },
  "evidence.finalize": { method: "POST", path: "/evidence/:id/finalize" },
  "evidence.get": { method: "GET", path: "/evidence/:id" },
  "evidence.download": { method: "GET", path: "/evidence/:id/download" },
  "verifications.list": { method: "GET", path: "/verifications" },
  "verifications.get": { method: "GET", path: "/verifications/:id" },
  "verifications.decideAssignment": { method: "POST", path: "/verifications/:id/assignment" },
  "verifications.requestChanges": { method: "POST", path: "/verifications/:id/change-requests" },
  "verifications.submitEvidence": { method: "POST", path: "/verifications/:id/evidence-submissions" },
  "verifications.issueAttestation": { method: "POST", path: "/verifications/:id/attestations" },
  "verifications.reject": { method: "POST", path: "/verifications/:id/rejection" },
  "attestations.get": { method: "GET", path: "/attestations/:id" },
  "reviews.list": { method: "GET", path: "/reviews" },
  "reviews.get": { method: "GET", path: "/reviews/:id" },
  "reviews.submitForApproval": { method: "POST", path: "/reviews/:id/submit-for-approval" },
  "reviews.decide": { method: "POST", path: "/reviews/:id/decision" },
  "reviews.requestInformation": { method: "POST", path: "/reviews/:id/information-requests" },
  "proposals.get": { method: "GET", path: "/proposals/:id" },
  "proposals.accept": { method: "POST", path: "/proposals/:id/acceptance" },
  "proposals.decline": { method: "POST", path: "/proposals/:id/decline" },
  "proposals.withdraw": { method: "POST", path: "/proposals/:id/withdraw" },
  "proposals.authorizeActivation": { method: "POST", path: "/proposals/:id/activation-authorization" },
  "pledges.list": { method: "GET", path: "/pledges" },
  "pledges.get": { method: "GET", path: "/pledges/:id" },
  "pledges.requestRelease": { method: "POST", path: "/pledges/:id/release-requests" },
  "releaseRequests.get": { method: "GET", path: "/release-requests/:id" },
  "releaseRequests.decide": { method: "POST", path: "/release-requests/:id/decision" },
  "releaseRequests.requestInformation": { method: "POST", path: "/release-requests/:id/information-requests" },
  "releaseRequests.respond": { method: "POST", path: "/release-requests/:id/responses" },
  "releaseRequests.withdraw": { method: "POST", path: "/release-requests/:id/withdraw" },
  "accessGrants.list": { method: "GET", path: "/access-grants" },
  "accessGrants.create": { method: "POST", path: "/access-grants" },
  "accessGrants.revoke": { method: "POST", path: "/access-grants/:id/revoke" },
  "audit.events": { method: "GET", path: "/audit/events" },
  "reports.list": { method: "GET", path: "/reports" },
  "reports.create": { method: "POST", path: "/reports" },
  "reports.download": { method: "GET", path: "/reports/:id/download" },
  "verifiers.list": { method: "GET", path: "/verifiers" },
  "directory.lenders": { method: "GET", path: "/directory/lenders" },
  "directory.dealers": { method: "GET", path: "/directory/dealers" },
  "overview.get": { method: "GET", path: "/overview" },
  "governance.state": { method: "GET", path: "/governance/state" },
  "governance.proposals": { method: "GET", path: "/governance/proposals" },
  "governance.proposal": { method: "GET", path: "/governance/proposals/:id" },
  "governance.propose": { method: "POST", path: "/governance/proposals" },
  "governance.confirm": { method: "POST", path: "/governance/proposals/:id/confirmations" },
  "governance.execute": { method: "POST", path: "/governance/proposals/:id/execute" },
  "governance.cancel": { method: "POST", path: "/governance/proposals/:id/cancel" },
  "commands.get": { method: "GET", path: "/commands/:id" },
  "pilotRequests.create": { method: "POST", path: "/pilot-requests" },
  "system.health": { method: "GET", path: "/system/health" },
} as const satisfies Record<string, { method: "GET" | "POST" | "PUT"; path: string }>;

export type EndpointName = keyof typeof API_ENDPOINTS;

/** "/cases/:id" + "CL-001" → "/cases/CL-001" (path params are URI-encoded). */
export function endpointPath(name: EndpointName, id?: string): string {
  const { path } = API_ENDPOINTS[name];
  if (!path.includes(":id")) return path;
  if (id === undefined || id === "") throw new Error(`Endpoint ${name} needs an id.`);
  return path.replace(":id", encodeURIComponent(id));
}
