// UI_MOCK client: an in-memory state machine over the @collara/domain fixtures that implements the
// same CollaraClient contract as the HTTP client. Reads go through the shared presenters and writes
// through the shared workflow checks, so a persona sees exactly what the API would return; an
// unrelated party gets the same 404-shaped `unavailable` error. Commands are simulated: they carry
// `simulated: true`, never an updateId, and never the copy `Confirmed on the ledger.`
import {
  AUDIT_SCOPE_OWNERS,
  AssignmentDecisionRequestSchema,
  ConsentDecisionRequestSchema,
  ConsentRequestQuerySchema,
  CreateAuditGrantRequestSchema,
  CreateCaseRequestSchema,
  CreateGovernanceProposalRequestSchema,
  CreateProposalRequestSchema,
  CreateReleaseRequestSchema,
  CreateReportRequestSchema,
  CreateVerificationRequestSchema,
  DeclineProposalRequestSchema,
  DEFAULT_PERSONA_ID,
  DEMO_ORGANIZATIONS,
  DEMO_PERSONAS,
  DemoSessionRequestSchema,
  ERROR_COPY,
  EVIDENCE_MAX_BYTES,
  EventLog,
  ExpectedVersionRequestSchema,
  IssueAttestationRequestSchema,
  MessageRequestSchema,
  PERSONA_IDS,
  PilotRequestSchema,
  REPORT_SCHEMA_VERSION,
  ReasonRequestSchema,
  RegisterAssetRequestSchema,
  ReleaseDecisionRequestSchema,
  ReviewDecisionRequestSchema,
  SaveAssessmentRequestSchema,
  ShareCaseRequestSchema,
  SIMULATED_COPY,
  SubmitEvidenceRequestSchema,
  UploadIntentRequestSchema,
  ASSET_NAMESPACE,
  buildCaseReport,
  buildScenario,
  canDownloadReport,
  can,
  checkAssetAction,
  checkCaseAction,
  checkConsentAction,
  checkVerificationAction,
  currentAttestation,
  effectiveProposalState,
  exportAuditScopes,
  governanceProposalState,
  governanceSeatOf,
  isOpenGovernanceProposal,
  latestDocumentVersion,
  latestProposal,
  nextFreeRef,
  orgName,
  paginate,
  personaActor,
  personaSummary,
  pilotRequestStates,
  presentAccessGrants,
  presentAssetActivity,
  presentAssetDetail,
  presentAssetSummary,
  presentAttestation,
  presentCaseActivity,
  presentCaseDetail,
  presentCaseEvidence,
  presentCaseList,
  presentCaseSummary,
  presentConsentRequests,
  presentEvidenceDocument,
  presentEvidenceList,
  presentGovernanceProposal,
  presentGovernanceState,
  presentMe,
  presentPledge,
  presentProposal,
  presentReport,
  presentReview,
  presentReviewSummary,
  presentVerification,
  presentOverview,
  presentVerifierEntries,
  primaryRole,
  releaseReasons,
  verificationGrantRef,
  verifierActiveLookup,
  type ActionCheck,
  type Actor,
  type AssetFacts,
  type AuditEvent,
  type CaseAction,
  type CaseFacts,
  type CommandResult,
  type ConsentFacts,
  type CommandStatus,
  type DemoWorld,
  type EventFacts,
  type EvidenceContentType,
  type ExportFacts,
  type PersonaId,
  type PresentContext,
  type SeedProfile,
  type VerificationAction,
  type VerificationFacts,
} from "@collara/domain";
import type { z } from "zod";
import type { CollaraClient, MutationOptions } from "../client";
import { ApiError } from "../errors";
import { randomId, sha256Hex } from "../util";

export interface MockClientOptions {
  /** Demo persona acting in the mock. Default: Demo Lender A approver (MP #2). */
  readonly personaId?: PersonaId;
  /**
   * A Date freezes the mock clock at that instant (it then advances one second per write, so event
   * order is deterministic); a function supplies the time on each call. Default: wall clock.
   */
  readonly now?: Date | (() => Date);
  /** Artificial latency per call in ms. Default 250; use 0 in tests. */
  readonly latencyMs?: number;
  readonly profile?: SeedProfile;
  readonly extraRows?: boolean;
  /** Start from a prepared world instead of the seed (it is cloned). */
  readonly world?: DemoWorld;
}

export interface MockCollaraClient extends CollaraClient {
  readonly kind: "mock";
  getPersona(): PersonaId;
  /** Changes the viewer only; the in-memory state is kept. Clear the query cache after switching. */
  setPersona(personaId: PersonaId): void;
  /** Live in-memory state, for dev tools and tests. Do not mutate. */
  readonly world: DemoWorld;
}

type EventInput = Omit<Parameters<EventLog["event"]>[0], "at" | "orgId" | "role" | "userId"> &
  Partial<Pick<Parameters<EventLog["event"]>[0], "orgId" | "role" | "userId">>;

interface PendingUpload {
  readonly orgId: string;
  readonly version: number;
  readonly contentType: EvidenceContentType;
}

const MAGIC: Readonly<Record<EvidenceContentType, readonly number[]>> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
};

const clone = <T>(value: T): T => structuredClone(value);

export function createMockClient(options: MockClientOptions = {}): MockCollaraClient {
  let frozen = options.now instanceof Date ? options.now.getTime() : null;
  const nowFn = typeof options.now === "function" ? options.now : null;
  const now = (): Date => (nowFn ? nowFn() : frozen !== null ? new Date(frozen) : new Date());
  const tick = (): string => {
    if (frozen !== null) frozen += 1000;
    return now().toISOString();
  };
  const latency = options.latencyMs ?? 250;

  const world: DemoWorld = clone(
    options.world ??
      buildScenario({ now: now(), profile: options.profile ?? "main", extraRows: options.extraRows ?? true }),
  );
  let personaId: PersonaId = options.personaId ?? DEFAULT_PERSONA_ID;
  let commandSeq = 0;
  const commands = new Map<string, CommandStatus>();
  const idempotency = new Map<string, { fingerprint: string; response: unknown }>();
  const uploads = new Map<string, PendingUpload>();
  const blobs = new Map<string, Blob>();
  const reportContent = new Map<string, { body: string; contentType: string }>();
  const pilotRequests: { id: string; receivedAt: string }[] = [];

  // --- plumbing ---------------------------------------------------------------------------------

  const actor = (): Actor => personaActor(personaId);
  const pctx = (): PresentContext => ({
    now: now(),
    mode: "UI_MOCK",
    sync: { offset: null, at: null },
    isVerifierActive: verifierActiveLookup(world.governance),
  });
  const sleep = () => (latency > 0 ? new Promise<void>((resolve) => setTimeout(resolve, latency)) : Promise.resolve());

  async function read<T>(fn: () => T): Promise<T> {
    const value = fn();
    await sleep();
    return clone(value);
  }

  const unavailable = () => ApiError.problem("unavailable", ERROR_COPY.UNAVAILABLE);
  function must<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw unavailable();
    return value;
  }
  const conflict = (detail: string) => ApiError.problem("state_conflict", detail);
  const invalid = (detail: string) => ApiError.problem("validation_error", detail);

  function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw ApiError.problem(
        "validation_error",
        ERROR_COPY.VALIDATION,
        result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      );
    }
    return result.data;
  }

  function guard(check: ActionCheck): void {
    if (check.ok) return;
    const code = check.reason === "UNAVAILABLE" ? "unavailable" : check.reason === "FORBIDDEN" ? "forbidden" : "state_conflict";
    throw ApiError.problem(code, check.message);
  }

  async function mutate<T>(
    operation: string,
    input: unknown,
    opts: MutationOptions | undefined,
    apply: () => T | Promise<T>,
    meta: { target?: "LEDGER" | "APPLICATION"; message?: string } = {},
  ): Promise<CommandResult<T>> {
    const key = opts?.idempotencyKey;
    const fingerprint = JSON.stringify([personaId, operation, input ?? null]);
    if (key) {
      const prior = idempotency.get(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw ApiError.problem("idempotency_conflict", ERROR_COPY.IDEMPOTENCY_CONFLICT);
        await sleep();
        return clone(prior.response as CommandResult<T>);
      }
    }
    const result = await apply();
    const at = tick();
    commandSeq += 1;
    const command: CommandStatus = {
      commandId: `mock-${String(commandSeq).padStart(6, "0")}`,
      operation,
      target: meta.target ?? "LEDGER",
      state: "PROJECTED",
      simulated: true,
      message: meta.message ?? SIMULATED_COPY.RECORDED_IN_MOCKUP,
      submittedAt: at,
      updatedAt: at,
    };
    commands.set(command.commandId, command);
    const response = { command, result };
    if (key) idempotency.set(key, { fingerprint, response: clone(response) });
    await sleep();
    return clone(response);
  }

  const asCommand = async (promise: Promise<CommandResult<unknown>>) => ({ command: (await promise).command });

  // --- lookups -------------------------------------------------------------------------------------

  /** The onboarded directory (GET /api/directory/*): demo organizations of one type, id and name only. */
  const directoryOf = (type: "LENDER" | "DEALER") =>
    Object.values(DEMO_ORGANIZATIONS)
      .filter((o) => o.type === type)
      .map((o) => ({ id: o.id, name: o.name }))
      .sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));

  const allEvents = () => [...world.assets.flatMap((a) => a.events), ...world.cases.flatMap((c) => c.events)];
  const casesOf = (asset: AssetFacts) => world.cases.filter((c) => c.asset.ref === asset.ref);

  function event(input: EventInput): EventFacts {
    const a = actor();
    return EventLog.after(allEvents()).event({
      ...input,
      at: tick(),
      orgId: input.orgId ?? a.orgId,
      role: input.role === undefined ? primaryRole(a) : input.role,
      userId: input.userId ?? a.userId,
    });
  }
  const caseEvent = (facts: CaseFacts, input: EventInput) => facts.events.push(event(input));
  const assetEvent = (asset: AssetFacts, input: EventInput) => {
    asset.events.push(event(input));
    asset.updatedAt = now().toISOString();
  };

  function visibleCase(caseId: string): CaseFacts {
    const facts = world.cases.find((c) => c.ref === caseId);
    if (!facts || !presentCaseSummary(facts, actor(), pctx())) throw unavailable();
    return facts;
  }
  const findCase = (predicate: (c: CaseFacts) => boolean) => must(world.cases.find(predicate));
  const caseOfReview = (ref: string) => findCase((c) => c.review.ref === ref);
  const caseOfProposal = (ref: string) => findCase((c) => c.proposals.some((p) => p.ref === ref));
  const caseOfPledge = (ref: string) => findCase((c) => c.lock?.ref === ref);
  function releaseRequest(ref: string) {
    const facts = findCase((c) => c.releaseRequests.some((r) => r.ref === ref));
    return { facts, rr: must(facts.releaseRequests.find((r) => r.ref === ref)) };
  }
  const findAsset = (predicate: (a: AssetFacts) => boolean) => must(world.assets.find(predicate));
  function verification(ref: string): { asset: AssetFacts; vr: VerificationFacts } {
    const asset = findAsset((a) => a.verifications.some((v) => v.ref === ref));
    return { asset, vr: must(asset.verifications.find((v) => v.ref === ref)) };
  }

  const checkCase = (facts: CaseFacts, action: CaseAction) => guard(checkCaseAction(facts, actor(), action, now(), pctx()));
  const checkVerification = (asset: AssetFacts, vr: VerificationFacts, action: VerificationAction) =>
    guard(checkVerificationAction(asset, vr, actor(), action, now(), pctx()));

  const allRefs = {
    asset: () => world.assets.map((a) => a.ref),
    case: () => world.cases.map((c) => c.ref),
    document: () => world.assets.flatMap((a) => a.documents.map((d) => d.ref)),
    package: () => world.assets.map((a) => a.package.ref),
    verification: () => world.assets.flatMap((a) => a.verifications.map((v) => v.ref)),
    attestation: () => world.assets.flatMap((a) => a.attestations.map((x) => x.ref)),
    assessment: () => world.cases.map((c) => c.review.ref),
    proposal: () => world.cases.flatMap((c) => c.proposals.map((p) => p.ref)),
    pledge: () => world.cases.flatMap((c) => (c.lock ? [c.lock.ref] : [])),
    releaseRequest: () => world.cases.flatMap((c) => c.releaseRequests.map((r) => r.ref)),
    accessGrant: () =>
      world.cases.flatMap((c) => [
        ...c.shares.map((s) => s.ref),
        ...c.auditGrants.map((g) => g.ref),
        ...c.consents.filter((x) => x.purpose === "LENDER_REVIEW").map((x) => x.ref),
      ]),
    report: () => world.cases.flatMap((c) => c.exports.map((e) => e.ref)),
    governanceProposal: () => world.governance.proposals.map((p) => p.ref),
    verifier: () => [...world.governance.verifiers.map((v) => v.ref), ...world.governance.proposals.map((p) => p.target.verifierRef)],
  };

  /** The manifest entries the available documents would commit (latest available version of each). */
  function manifestEntriesOf(asset: AssetFacts): { documentRef: string; version: number }[] {
    return asset.documents.flatMap((doc) => {
      const available = doc.versions.filter((v) => v.uploadState === "AVAILABLE");
      const latest = available.reduce<number | null>((max, v) => (max === null || v.version > max ? v.version : max), null);
      return latest === null ? [] : [{ documentRef: doc.ref, version: latest }];
    });
  }

  function manifestUnchanged(asset: AssetFacts): boolean {
    const entries = manifestEntriesOf(asset);
    return entries.length === asset.package.entries.length && entries.every((e) => asset.package.entries.some((p) => p.documentRef === e.documentRef && p.version === e.version));
  }

  /** Commit the evidence manifest from every available document; bump the version on change. */
  function commitManifest(asset: AssetFacts): void {
    const entries = manifestEntriesOf(asset);
    if (manifestUnchanged(asset)) return;
    asset.package.version += 1;
    asset.package.entries = entries;
    asset.package.history.push({ version: asset.package.version, committedAt: now().toISOString() });
    for (const doc of asset.documents) if (entries.some((e) => e.documentRef === doc.ref)) doc.ledgerState = "COMMITTED";
  }

  /**
   * Verification grants (same rules as the API, workflow/verification/grants.ts): every selected document must be
   * available. INFERRED copy, same string as the API. (The API also refuses a selection with nothing grantable: no
   * owner document and no dealer document that may be requested; dealer documents of a case-linked request are
   * requested from their dealer below, so that refusal does not occur here.)
   */
  function checkGrantSelection(asset: AssetFacts, documentIds: readonly string[]): void {
    for (const id of documentIds) {
      const doc = asset.documents.find((d) => d.ref === id);
      if (!doc || !doc.versions.some((v) => v.uploadState === "AVAILABLE")) throw invalid(`Document ${id} is not available on ${asset.ref}.`);
    }
  }

  /**
   * The exact versions granted to the verifier: the selected OWNER documents at their committed package version.
   * Dealer documents reach the verifier only through the dealer's own consent (requestDealerConsent below).
   */
  function grantedVersions(asset: AssetFacts, documentIds: readonly string[]): { documentRef: string; version: number }[] {
    return asset.package.entries
      .filter((e) => documentIds.includes(e.documentRef) && asset.documents.find((d) => d.ref === e.documentRef)?.sourceOrgId === asset.ownerOrgId)
      .map((e) => ({ documentRef: e.documentRef, version: e.version }))
      .sort((a, b) => a.documentRef.localeCompare(b.documentRef));
  }

  /** The case's invited dealer's selected documents at their committed package version (case-linked requests only). */
  function dealerEntries(asset: AssetFacts, facts: CaseFacts | null, documentIds: readonly string[]): ConsentFacts["documents"] {
    const dealer = facts?.dealerOrgId;
    if (!facts || !dealer || dealer === asset.ownerOrgId) return [];
    return asset.package.entries
      .filter((e) => documentIds.includes(e.documentRef) && asset.documents.find((d) => d.ref === e.documentRef)?.sourceOrgId === dealer)
      .map((e) => ({
        documentRef: e.documentRef,
        version: e.version,
        sha256: asset.documents.find((d) => d.ref === e.documentRef)?.versions.find((v) => v.version === e.version)?.sha256 ?? "",
      }))
      .sort((a, b) => a.documentRef.localeCompare(b.documentRef));
  }

  /**
   * The owner's consent request to the case's dealer (LOCALNET: a PackageShareProposal listing only that dealer's
   * documents; daml-model.md §4.6). Nothing reaches the recipient before the dealer grants it.
   */
  function requestDealerConsent(
    facts: CaseFacts,
    input: Pick<ConsentFacts, "ref" | "purpose" | "recipientOrgId" | "verificationRef" | "documents" | "permission" | "expiresAt">,
  ): void {
    if (!facts.dealerOrgId || input.documents.length === 0) return;
    facts.consents = facts.consents.filter((c) => c.ref !== input.ref);
    facts.consents.push({
      ...input,
      dealerOrgId: facts.dealerOrgId,
      ownerOrgId: facts.borrowerOrgId,
      packageRef: facts.asset.package.ref,
      packageVersion: facts.asset.package.version,
      state: "PENDING",
      requestedAt: now().toISOString(),
      decidedAt: null,
    });
  }

  /** A resubmission ends the request's earlier verification consents (LOCALNET: ShareProposal_Withdraw / Share_Revoke). */
  function retireVerificationConsents(facts: CaseFacts | null, verificationRef: string): void {
    for (const c of facts?.consents ?? []) {
      if (c.purpose !== "VERIFICATION" || c.verificationRef !== verificationRef) continue;
      if (c.state === "PENDING") c.state = "CANCELLED";
      else if (c.state === "GRANTED") c.state = "REVOKED";
      else continue;
      c.decidedAt = now().toISOString();
    }
  }

  const DAY_MS = 86_400_000;
  /** Grant lifetime as the API: the request's due date, else 30 days. */
  const grantExpiry = (dueAt: string | null | undefined) =>
    dueAt && Date.parse(dueAt) > now().getTime() ? new Date(Date.parse(dueAt)).toISOString() : new Date(now().getTime() + 30 * DAY_MS).toISOString();

  /** The consent request `id` as the viewer may see it (presenter-scoped) and its case; 404-shaped otherwise. */
  function visibleConsent(id: string): { facts: CaseFacts; consent: ConsentFacts } {
    for (const facts of world.cases) {
      const consent = facts.consents.find((c) => c.ref === id);
      if (consent && presentConsentRequests(facts, actor(), pctx())?.some((r) => r.id === id)) return { facts, consent };
    }
    throw unavailable();
  }

  function requestVerificationOn(asset: AssetFacts, caseRef: string | null, body: unknown, opts?: MutationOptions) {
    const input = parse(CreateVerificationRequestSchema, body);
    const entry = world.governance.verifiers.find((v) => v.ref === input.verifierRegistryRef);
    if (!entry || entry.status !== "ACTIVE" || !entry.orgId) {
      // INFERRED copy; the registry status is re-checked at commit (S L643).
      throw conflict("The selected verifier is not active in the verifier registry.");
    }
    const verifierOrgId = entry.orgId;
    checkGrantSelection(asset, input.documentIds);
    return mutate("verification.request", { asset: asset.ref, caseRef, input }, opts, () => {
      commitManifest(asset);
      const ref = nextFreeRef("verification", allRefs.verification());
      const at = now().toISOString();
      const granted = grantedVersions(asset, input.documentIds);
      const facts = caseRef ? (world.cases.find((c) => c.ref === caseRef) ?? null) : null;
      if (facts) {
        requestDealerConsent(facts, {
          ref: verificationGrantRef(ref, asset.package.version, 1),
          purpose: "VERIFICATION",
          recipientOrgId: verifierOrgId,
          verificationRef: ref,
          documents: dealerEntries(asset, facts, input.documentIds),
          permission: "VIEW_DOWNLOAD",
          expiresAt: grantExpiry(input.dueAt),
        });
      }
      asset.verifications.push({
        ref,
        assetRef: asset.ref,
        caseRef,
        verifierOrgId,
        verifierRegistryRef: entry.ref,
        requestedByOrgId: actor().orgId,
        scope: input.scope,
        documentRefs: granted.map((e) => e.documentRef),
        documentVersions: granted,
        packageVersion: asset.package.version,
        state: "REQUESTED",
        requestedAt: at,
        updatedAt: at,
        dueAt: input.dueAt ?? null,
        attestationRef: null,
        lastMessage: null,
      });
      assetEvent(asset, { ref, type: "VERIFICATION_REQUESTED", from: null, to: "REQUESTED", version: `package v${asset.package.version}` });
      return { verificationRef: ref };
    });
  }

  function exportScopeLabel(): string {
    const a = actor();
    const role = primaryRole(a);
    if (role === "AUDITOR") return `Granted subset · ${orgName(a.orgId)}`;
    if (role === "DEALER") return `Granted subset · ${orgName(a.orgId)}`;
    if (role === "VERIFIER") return `Assigned subset · ${orgName(a.orgId)}`;
    return `Own scope · ${orgName(a.orgId)}`;
  }

  function toCsv(events: readonly AuditEvent[] | null | undefined): string {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = (events ?? []).map((e) =>
      [e.occurredAt, e.ref, e.label, e.actor, e.stateChange ? `${e.stateChange.from ?? "—"} → ${e.stateChange.to}` : "", e.version ?? "", e.kind.label]
        .map(quote)
        .join(","),
    );
    return ["occurredAt,ref,event,actor,stateChange,version,kind", ...rows].join("\n");
  }

  function dataUrl(contentType: string, body: string): string {
    return `data:${contentType};charset=utf-8,${encodeURIComponent(body)}`;
  }

  // --- the client --------------------------------------------------------------------------------

  const client: MockCollaraClient = {
    kind: "mock",
    get world() {
      return world;
    },
    getPersona: () => personaId,
    setPersona: (id) => {
      personaId = id;
    },

    me: () => read(() => presentMe(DEMO_PERSONAS[personaId], "UI_MOCK")),

    demo: {
      personas: () => read(() => PERSONA_IDS.map((id) => personaSummary(DEMO_PERSONAS[id]))),
      createSession: async (body) => {
        const { personaId: next } = parse(DemoSessionRequestSchema, body);
        personaId = next;
        return read(() => presentMe(DEMO_PERSONAS[personaId], "UI_MOCK"));
      },
    },

    cases: {
      list: (query) =>
        read(() => {
          const { items, counts } = presentCaseList(world.cases, actor(), pctx(), query?.view ?? "all");
          return { ...paginate(items, query), counts };
        }),
      get: (caseId) => read(() => must(presentCaseDetail(visibleCase(caseId), actor(), pctx()))),
      evidence: (caseId) => read(() => must(presentCaseEvidence(visibleCase(caseId), world.cases, actor(), pctx()))),

      create: async (body, opts) => {
        const input = parse(CreateCaseRequestSchema, body);
        const asset = world.assets.find((a) => a.ref === input.assetRef);
        if (!asset || !presentAssetSummary(asset, world.cases, actor(), pctx())) throw unavailable();
        const a = actor();
        // Owner organization + borrower mandate (S §9.3), registered, no case holding the asset (same check as the API).
        const check = checkAssetAction(asset, world.cases, a, "case.create", now(), pctx());
        if (!check.ok && check.reason !== "CONFLICT") guard(check);
        const issues = [
          ...(directoryOf("LENDER").some((o) => o.id === input.selectedLenderOrgId) ? [] : [{ path: "body.selectedLenderOrgId", message: "Select a lender organization." }]),
          ...(input.dealerOrgId === undefined || directoryOf("DEALER").some((o) => o.id === input.dealerOrgId)
            ? []
            : [{ path: "body.dealerOrgId", message: "Select a dealer organization." }]),
        ];
        if (issues.length > 0) throw ApiError.problem("validation_error", ERROR_COPY.VALIDATION, issues);
        guard(check);
        return mutate(
          "case.create",
          input,
          opts,
          () => {
            const ref = nextFreeRef("case", allRefs.case());
            const at = now().toISOString();
            const facts: CaseFacts = {
              ref,
              title: input.title,
              purpose: input.purpose ?? null,
              createdAt: at,
              createdByUserId: a.userId,
              borrowerOrgId: a.orgId,
              dealerOrgId: input.dealerOrgId ?? null,
              selectedLenderOrgId: input.selectedLenderOrgId,
              requestedPrincipal: input.requestedPrincipal ?? null,
              policyRef: "CP-2026-CNC-01",
              asset,
              shares: [],
              consents: [],
              review: {
                ref: nextFreeRef("assessment", allRefs.assessment()),
                lenderOrgId: input.selectedLenderOrgId,
                state: "NOT_SUBMITTED",
                analystUserId: null,
                approverUserId: null,
                startedAt: null,
                submittedForApprovalAt: null,
                evidenceSnapshot: null,
                snapshotPackageVersion: null,
                assessment: null,
                internalNotes: null,
                sharedFeedback: null,
                informationRequest: null,
                decision: null,
              },
              proposals: [],
              activation: null,
              lock: null,
              releaseRequests: [],
              auditGrants: [],
              exports: [],
              events: [],
              cancelledAt: null,
              closedAt: null,
            };
            world.cases.push(facts);
            caseEvent(facts, { ref, type: "CASE_CREATED", from: null, to: "DRAFT", version: "case v1", kind: "OPERATIONAL" });
            return { caseId: ref };
          },
          { target: "APPLICATION" },
        );
      },

      share: async (caseId, body, opts) => {
        const facts = visibleCase(caseId);
        const input = parse(ShareCaseRequestSchema, body);
        checkCase(facts, "sharing.share");
        if (input.recipientOrgId !== facts.selectedLenderOrgId) throw invalid("Only the selected lender can receive this package.");
        return mutate("case.share", { caseId, input }, opts, () => {
          const asset = facts.asset;
          commitManifest(asset);
          const ref = nextFreeRef("accessGrant", allRefs.accessGrant());
          // Same split as the API: the owner shares its own records; the dealer's records wait for its consent.
          const dealerDocs = dealerEntries(asset, facts, asset.package.entries.map((e) => e.documentRef));
          facts.shares.push({
            ref,
            recipientOrgId: input.recipientOrgId,
            purpose: "LENDER_REVIEW",
            packageRef: asset.package.ref,
            packageVersion: asset.package.version,
            entries: asset.package.entries.filter((e) => !dealerDocs.some((d) => d.documentRef === e.documentRef)).map((e) => ({ ...e })),
            permission: input.permission,
            state: "GRANTED",
            consentingOrgIds: [facts.borrowerOrgId],
            createdAt: now().toISOString(),
            expiresAt: input.expiresAt ?? null,
            revokedAt: null,
          });
          requestDealerConsent(facts, {
            ref: nextFreeRef("accessGrant", allRefs.accessGrant()),
            purpose: "LENDER_REVIEW",
            recipientOrgId: input.recipientOrgId,
            verificationRef: null,
            documents: dealerDocs,
            permission: input.permission,
            expiresAt: input.expiresAt ?? new Date(now().getTime() + 30 * DAY_MS).toISOString(),
          });
          facts.review.state = "SUBMITTED";
          facts.review.evidenceSnapshot = asset.package.entries.map((e) => ({ ...e }));
          facts.review.snapshotPackageVersion = asset.package.version;
          caseEvent(facts, {
            ref: asset.package.ref,
            type: "PACKAGE_SHARED",
            detail: `${orgName(input.recipientOrgId)} · ${asset.package.entries.length} documents`,
            from: "NOT_SUBMITTED",
            to: "SUBMITTED",
            version: `package v${asset.package.version}`,
          });
          return { grantId: ref };
        });
      },

      requestVerification: async (caseId, body, opts) => {
        const facts = visibleCase(caseId);
        checkCase(facts, "verification.request");
        return requestVerificationOn(facts.asset, facts.ref, body, opts);
      },

      saveAssessment: async (caseId, body, opts) => {
        const facts = visibleCase(caseId);
        const input = parse(SaveAssessmentRequestSchema, body);
        checkCase(facts, "review.saveAssessment");
        return mutate(
          "review.saveAssessment",
          { caseId, input },
          opts,
          () => {
            const a = actor();
            const review = facts.review;
            if (review.state === "SUBMITTED" || review.state === "NEEDS_INFORMATION") {
              const from = review.state;
              review.state = "IN_REVIEW";
              review.startedAt ??= now().toISOString();
              caseEvent(facts, { ref: review.ref, type: "REVIEW_STARTED", from, to: "IN_REVIEW" });
            }
            if (a.roles.includes("LENDER_ANALYST")) review.analystUserId = a.userId;
            review.evidenceSnapshot = facts.asset.package.entries.map((e) => ({ ...e }));
            review.snapshotPackageVersion = facts.asset.package.version;
            review.assessment = {
              valuation: input.valuation,
              valuationSource: input.valuationSource,
              valuationDate: input.valuationDate,
              limitations: input.limitations,
              outcome: input.outcome,
              policyRef: input.policyRef,
              version: (review.assessment?.version ?? 0) + 1,
              savedAt: now().toISOString(),
              savedByUserId: a.userId,
              requiredExternalChecks: review.assessment?.requiredExternalChecks ?? [
                { label: "UCC lien search", status: "Pending · external" },
                { label: "Title and ownership confirmation", status: "Outside Collara" },
              ],
            };
            // Private notes (the API's off-ledger note store): "" clears a note; the presenters omit them by role.
            if (input.internalNotes !== undefined) review.internalNotes = input.internalNotes || null;
            if (input.sharedFeedback !== undefined) review.sharedFeedback = input.sharedFeedback || null;
            caseEvent(facts, { ref: review.ref, type: "ASSESSMENT_SAVED", version: "draft", kind: "OPERATIONAL" });
            return must(presentReview(facts, a, pctx()));
          },
          { target: "APPLICATION" },
        );
      },

      createProposal: async (caseId, body, opts) => {
        const facts = visibleCase(caseId);
        const input = parse(CreateProposalRequestSchema, body);
        checkCase(facts, input.intent === "ISSUE" ? "proposal.issue" : "proposal.draft");
        return mutate("proposal.create", { caseId, input }, opts, () => {
          const a = actor();
          const at = now().toISOString();
          const latest = latestProposal(facts);
          const expiresAt = new Date(now().getTime() + input.expiresInDays * 86_400_000).toISOString();
          const terms = {
            principal: input.principal,
            termMetadata: input.termMetadata ?? null,
            financingRef: input.financingRef ?? null,
            externalLegalRef: input.externalLegalRef ?? null,
            expiresAt,
          };
          let target = latest?.state === "DRAFT" ? latest : null;
          if (target) Object.assign(target, terms);
          else {
            target = {
              ref: latest?.ref ?? nextFreeRef("proposal", allRefs.proposal()),
              version: (latest?.version ?? 0) + 1,
              state: "DRAFT",
              lenderOrgId: facts.review.lenderOrgId,
              ...terms,
              draftedAt: at,
              draftedByUserId: a.userId,
              issuedAt: null,
              issuedByUserId: null,
              respondedAt: null,
              respondedByUserId: null,
              withdrawnAt: null,
              note: latest ? `Replaces v${latest.version}` : null,
            };
            facts.proposals.push(target);
            caseEvent(facts, { ref: target.ref, type: "PROPOSAL_DRAFTED", to: "DRAFT", version: `v${target.version}`, kind: "OPERATIONAL" });
          }
          if (input.intent === "ISSUE") {
            target.state = "ISSUED";
            target.issuedAt = at;
            target.issuedByUserId = a.userId;
            caseEvent(facts, { ref: target.ref, type: "PROPOSAL_ISSUED", from: "DRAFT", to: "ISSUED", version: `v${target.version}` });
          }
          return { proposalRef: target.ref, version: target.version };
        });
      },

      activatePledge: async (caseId, opts) => {
        const facts = visibleCase(caseId);
        checkCase(facts, "pledge.activate");
        return mutate("pledge.activate", { caseId }, opts, () => {
          // Re-checked inside the write: a second activation finds the control consumed (single lock).
          checkCase(facts, "pledge.activate");
          const auth = must(facts.activation);
          const asset = facts.asset;
          const ref = nextFreeRef("pledge", allRefs.pledge());
          const consumed = asset.control.version;
          facts.lock = {
            ref,
            state: "ACTIVE",
            lenderOrgId: facts.review.lenderOrgId,
            borrowerOrgId: facts.borrowerOrgId,
            activatedAt: now().toISOString(),
            activatedByUserId: actor().userId,
            proposalRef: auth.proposalRef,
            proposalVersion: auth.proposalVersion,
            attestationRef: auth.attestationRef,
            packageRef: asset.package.ref,
            packageVersion: asset.package.version,
            controlVersionConsumed: consumed,
            controlVersionLocked: consumed + 1,
            releasedAt: null,
            releasedByUserId: null,
            controlVersionAfterRelease: null,
          };
          asset.control = { version: consumed + 1, state: "LOCKED", lockRef: ref };
          auth.state = "CONSUMED";
          auth.consumedAt = now().toISOString();
          caseEvent(facts, {
            ref,
            type: "PLEDGE_ACTIVATED",
            actorLabel: `${orgName(facts.borrowerOrgId)} + ${orgName(facts.review.lenderOrgId)}`,
            from: "AVAILABLE",
            to: "ACTIVE",
            version: `control v${consumed} → v${consumed + 1}`,
          });
          return { pledgeRef: ref };
        });
      },
    },

    assets: {
      list: (query) =>
        read(() =>
          paginate(
            world.assets.map((asset) => presentAssetSummary(asset, world.cases, actor(), pctx())).filter((x) => x !== null),
            query,
          ),
        ),
      get: (ref) => read(() => must(presentAssetDetail(findAsset((a) => a.ref === ref), world.cases, actor(), pctx()))),
      evidence: (ref) => read(() => must(presentEvidenceList(findAsset((a) => a.ref === ref), world.cases, actor(), pctx()))),

      register: async (body, opts) => {
        const input = parse(RegisterAssetRequestSchema, body);
        const a = actor();
        if (!can(a, "passport.register")) throw ApiError.problem("forbidden", ERROR_COPY.FORBIDDEN);
        const key = (x: { manufacturer: string; model: string; serialNumber: string }) =>
          `${x.manufacturer}|${x.model}|${x.serialNumber}`.trim().toUpperCase();
        const duplicates = world.assets.filter((x) => key(x) === key(input));
        if (duplicates.some((x) => x.ownerOrgId === a.orgId)) throw conflict("This equipment is already registered by your organization.");
        return mutate(
          "asset.register",
          input,
          opts,
          () => {
            const ref = nextFreeRef("asset", allRefs.asset());
            const at = now().toISOString();
            // A duplicate held by another party is declined generically, never revealed (S L599).
            const lifecycle = input.intent === "DRAFT" ? "DRAFT" : duplicates.length > 0 ? "REGISTRATION_DECLINED" : "REGISTERED";
            const asset: AssetFacts = {
              ref,
              namespace: ASSET_NAMESPACE,
              equipmentClass: input.equipmentClass,
              manufacturer: input.manufacturer,
              model: input.model,
              serialNumber: input.serialNumber,
              yearOfManufacture: input.yearOfManufacture ?? null,
              ownerOrgId: a.orgId,
              ownerClaimSource: "Submitted evidence",
              locationScope: input.locationScope,
              claimedAcquisitionValue: input.claimedAcquisitionValue ?? null,
              lifecycle,
              createdAt: at,
              registeredAt: lifecycle === "REGISTERED" ? at : null,
              updatedAt: at,
              passportVersion: 1,
              documents: [],
              package: { ref: nextFreeRef("package", allRefs.package()), version: 0, entries: [], history: [] },
              verifications: [],
              attestations: [],
              control: { version: 1, state: "AVAILABLE", lockRef: null },
              events: [],
            };
            world.assets.push(asset);
            if (lifecycle === "REGISTERED") {
              assetEvent(asset, { ref, type: "PASSPORT_REGISTERED", from: "DRAFT", to: "REGISTERED", version: "passport v1" });
            }
            return { assetRef: ref };
          },
          { target: input.intent === "DRAFT" ? "APPLICATION" : "LEDGER" },
        );
      },

      requestVerification: async (assetRef, body, opts) => {
        const asset = findAsset((a) => a.ref === assetRef);
        guard(checkAssetAction(asset, world.cases, actor(), "verification.request", now(), pctx()));
        const caseId = (body as { caseId?: unknown } | null)?.caseId;
        const caseRef = typeof caseId === "string" && caseId ? caseId : null;
        // The case must be one of this asset's cases owned by the caller (the API's check).
        if (caseRef && !world.cases.some((c) => c.ref === caseRef && c.asset.ref === asset.ref && c.borrowerOrgId === actor().orgId)) throw unavailable();
        return requestVerificationOn(asset, caseRef, body, opts);
      },
    },

    evidence: {
      createUploadIntent: async (body, opts) => {
        const input = parse(UploadIntentRequestSchema, body);
        const asset = findAsset((a) => a.ref === input.assetRef);
        guard(checkAssetAction(asset, world.cases, actor(), "evidence.upload", now(), pctx()));
        const a = actor();
        const existing = input.replacesDocumentId ? asset.documents.find((d) => d.ref === input.replacesDocumentId) : undefined;
        if (input.replacesDocumentId && (!existing || (existing.sourceOrgId !== a.orgId && asset.ownerOrgId !== a.orgId))) throw unavailable();
        return mutate(
          "evidence.uploadIntent",
          input,
          opts,
          () => {
            const doc =
              existing ??
              (() => {
                const created = {
                  ref: nextFreeRef("document", allRefs.document()),
                  type: input.type,
                  title: input.title,
                  mediaSummary: input.contentType === "application/pdf" ? "PDF" : input.contentType === "image/png" ? "PNG" : "JPEG",
                  sourceOrgId: a.orgId,
                  versions: [],
                  reviewState: "SUBMITTED" as const,
                  ledgerState: "UNCOMMITTED" as const,
                };
                asset.documents.push(created);
                return created;
              })();
            const version = doc.versions.length === 0 ? 1 : latestDocumentVersion(doc).version + 1;
            doc.versions.push({
              version,
              uploadedAt: now().toISOString(),
              uploadedBy: { orgId: a.orgId, userId: a.userId, label: `${DEMO_PERSONAS[personaId].displayName} · ${orgName(a.orgId)}` },
              fileName: input.fileName,
              contentType: input.contentType,
              sizeBytes: input.sizeBytes,
              sha256: null,
              uploadState: "UPLOAD_PENDING",
              integrity: "NOT_CHECKED",
            });
            uploads.set(doc.ref, { orgId: a.orgId, version, contentType: input.contentType });
            return {
              evidenceId: doc.ref,
              version,
              uploadPath: `/api/evidence/${doc.ref}/content`,
              maxBytes: EVIDENCE_MAX_BYTES,
              expiresAt: new Date(now().getTime() + 15 * 60_000).toISOString(),
            };
          },
          { target: "APPLICATION" },
        );
      },

      uploadContent: async (evidenceId, file, opts) => {
        const pending = uploads.get(evidenceId);
        if (!pending || pending.orgId !== actor().orgId) throw unavailable();
        if (file.size > EVIDENCE_MAX_BYTES) throw invalid("Files are limited to 20 MB.");
        if (file.type && file.type !== pending.contentType) throw invalid("The file type does not match the upload request.");
        const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
        if (!MAGIC[pending.contentType].every((byte, i) => head[i] === byte)) throw invalid("The file content does not match its declared type.");
        const hash = await sha256Hex(await file.arrayBuffer());
        return mutate(
          "evidence.uploadContent",
          { evidenceId, size: file.size, hash },
          opts,
          () => {
            const asset = findAsset((x) => x.documents.some((d) => d.ref === evidenceId));
            const doc = must(asset.documents.find((d) => d.ref === evidenceId));
            const version = must(doc.versions.find((v) => v.version === pending.version));
            version.uploadState = "QUARANTINED";
            version.sha256 = hash;
            version.sizeBytes = file.size;
            blobs.set(`${evidenceId}:v${pending.version}`, file);
            return must(presentEvidenceDocument(asset, evidenceId, world.cases, actor(), pctx()));
          },
          { target: "APPLICATION" },
        );
      },

      uploadDirect: async () => {
        // The UI mockup never issues presigned uploads (its intents have no directUpload).
        throw new ApiError(501, "upstream_unavailable", "Direct uploads are not available in the UI mockup.");
      },

      finalize: async (evidenceId, opts) => {
        const pending = uploads.get(evidenceId);
        if (!pending || pending.orgId !== actor().orgId) throw unavailable();
        const asset = findAsset((x) => x.documents.some((d) => d.ref === evidenceId));
        const doc = must(asset.documents.find((d) => d.ref === evidenceId));
        const version = must(doc.versions.find((v) => v.version === pending.version));
        if (version.uploadState !== "QUARANTINED") throw conflict("Upload the file content before finalizing.");
        return mutate(
          "evidence.finalize",
          { evidenceId },
          opts,
          () => {
            version.uploadState = "AVAILABLE";
            version.integrity = version.sha256 ? "VERIFIED" : "NOT_CHECKED";
            uploads.delete(evidenceId);
            assetEvent(asset, {
              ref: evidenceId,
              type: pending.version === 1 ? "EVIDENCE_UPLOADED" : "EVIDENCE_VERSION_ADDED",
              detail: pending.version === 1 ? doc.title : `${doc.title} v${pending.version}`,
              version: pending.version === 1 ? "v1" : `v${pending.version - 1} → v${pending.version}`,
              kind: "OPERATIONAL",
            });
            return must(presentEvidenceDocument(asset, evidenceId, world.cases, actor(), pctx()));
          },
          { target: "APPLICATION" },
        );
      },

      get: (evidenceId) =>
        read(() => {
          const asset = findAsset((a) => a.documents.some((d) => d.ref === evidenceId));
          return must(presentEvidenceDocument(asset, evidenceId, world.cases, actor(), pctx()));
        }),

      download: (evidenceId) =>
        read(() => {
          const asset = findAsset((a) => a.documents.some((d) => d.ref === evidenceId));
          const doc = must(presentEvidenceDocument(asset, evidenceId, world.cases, actor(), pctx()));
          if (!doc.canDownload) throw unavailable();
          const blob = blobs.get(`${evidenceId}:v${doc.version}`);
          const url =
            blob && typeof URL.createObjectURL === "function"
              ? URL.createObjectURL(blob)
              : dataUrl("text/plain", `Synthetic fixture ${evidenceId} v${doc.version} (UI mockup). No file content is stored.`);
          return { url, expiresAt: new Date(now().getTime() + 60_000).toISOString() };
        }),
    },

    verifications: {
      list: (query) =>
        read(() =>
          paginate(
            world.assets
              .flatMap((asset) => asset.verifications.map((vr) => presentVerification(asset, vr, actor(), pctx())))
              .filter((x) => x !== null)
              .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
            query,
          ),
        ),
      get: (ref) =>
        read(() => {
          const { asset, vr } = verification(ref);
          return must(presentVerification(asset, vr, actor(), pctx()));
        }),

      decideAssignment: async (ref, body, opts) => {
        const { asset, vr } = verification(ref);
        const input = parse(AssignmentDecisionRequestSchema, body);
        checkVerification(asset, vr, input.decision === "ACCEPT" ? "verification.acceptAssignment" : "verification.declineAssignment");
        return asCommand(
          mutate("verification.assignment", { ref, input }, opts, () => {
            vr.state = input.decision === "ACCEPT" ? "IN_REVIEW" : "DECLINED";
            vr.updatedAt = now().toISOString();
            if (input.decision === "DECLINE") vr.lastMessage = input.reason;
            assetEvent(asset, {
              ref,
              type: input.decision === "ACCEPT" ? "ASSIGNMENT_ACCEPTED" : "ASSIGNMENT_DECLINED",
              from: "REQUESTED",
              to: vr.state,
            });
          }),
        );
      },

      requestChanges: async (ref, body, opts) => {
        const { asset, vr } = verification(ref);
        const input = parse(MessageRequestSchema, body);
        checkVerification(asset, vr, "verification.requestChanges");
        return asCommand(
          mutate("verification.requestChanges", { ref, input }, opts, () => {
            vr.state = "CHANGES_REQUESTED";
            vr.lastMessage = input.message;
            vr.updatedAt = now().toISOString();
            assetEvent(asset, { ref, type: "CHANGES_REQUESTED", detail: input.message, from: "IN_REVIEW", to: "CHANGES_REQUESTED" });
          }),
        );
      },

      submitEvidence: async (ref, body, opts) => {
        const { asset, vr } = verification(ref);
        const input = parse(SubmitEvidenceRequestSchema, body ?? {});
        checkVerification(asset, vr, "verification.submitEvidence");
        // The new grant covers the owner's selection, else the previously granted documents (never the whole package).
        let selection = input.documentIds;
        if (selection) checkGrantSelection(asset, selection);
        else {
          selection = vr.documentRefs.filter((id) => asset.documents.some((d) => d.ref === id && d.versions.some((v) => v.uploadState === "AVAILABLE")));
          if (selection.length === 0) throw invalid("Select the documents to share with the verifier.");
        }
        if (manifestUnchanged(asset) && asset.package.version <= vr.packageVersion) {
          throw conflict("Add a new document version before resubmitting the evidence.");
        }
        const chosen = selection;
        return asCommand(
          mutate("verification.submitEvidence", { ref, documentIds: input.documentIds ?? null }, opts, () => {
            commitManifest(asset);
            vr.packageVersion = asset.package.version;
            const granted = grantedVersions(asset, chosen);
            vr.documentRefs = granted.map((e) => e.documentRef);
            vr.documentVersions = granted;
            const facts = vr.caseRef ? (world.cases.find((c) => c.ref === vr.caseRef) ?? null) : null;
            retireVerificationConsents(facts, vr.ref);
            if (facts) {
              requestDealerConsent(facts, {
                ref: verificationGrantRef(vr.ref, asset.package.version, 1),
                purpose: "VERIFICATION",
                recipientOrgId: vr.verifierOrgId,
                verificationRef: vr.ref,
                documents: dealerEntries(asset, facts, chosen),
                permission: "VIEW_DOWNLOAD",
                expiresAt: grantExpiry(vr.dueAt),
              });
            }
            vr.state = "IN_REVIEW";
            vr.updatedAt = now().toISOString();
            assetEvent(asset, { ref, type: "EVIDENCE_RESUBMITTED", from: "CHANGES_REQUESTED", to: "IN_REVIEW", version: `package v${asset.package.version}` });
          }),
        );
      },

      issueAttestation: async (ref, body, opts) => {
        const { asset, vr } = verification(ref);
        const input = parse(IssueAttestationRequestSchema, body);
        checkVerification(asset, vr, "verification.issueAttestation");
        if (Date.parse(input.validUntil) <= Math.max(Date.parse(input.inspectedAt), now().getTime())) {
          throw invalid("The validity period must end after the inspection and in the future.");
        }
        return mutate("verification.issueAttestation", { ref, input }, opts, () => {
          const attestationRef = nextFreeRef("attestation", allRefs.attestation());
          const previous = currentAttestation(asset);
          const at = now().toISOString();
          if (previous) previous.supersededBy = attestationRef;
          asset.attestations.push({
            ref: attestationRef,
            verificationRef: vr.ref,
            assetRef: asset.ref,
            issuerOrgId: vr.verifierOrgId,
            verifierRegistryRef: vr.verifierRegistryRef,
            method: input.method,
            inspectedAt: input.inspectedAt,
            issuedAt: at,
            validFrom: at,
            validUntil: input.validUntil,
            checks: input.checks,
            limitations: input.limitations,
            packageRef: asset.package.ref,
            packageVersion: vr.packageVersion,
            // The versions granted for the reviewed evidence version (as the LOCALNET read model derives them).
            supportingVersions: vr.documentVersions
              ? vr.documentVersions.map((e) => ({ ...e }))
              : asset.package.entries.filter((e) => vr.documentRefs.includes(e.documentRef)),
            supersedes: previous?.ref ?? null,
            supersededBy: null,
            revokedAt: null,
          });
          vr.state = "ATTESTED";
          vr.attestationRef = attestationRef;
          vr.updatedAt = at;
          assetEvent(asset, { ref: attestationRef, type: "ATTESTATION_ISSUED", from: "IN_REVIEW", to: "ATTESTED", version: `evidence v${vr.packageVersion}` });
          return { attestationRef };
        });
      },

      reject: async (ref, body, opts) => {
        const { asset, vr } = verification(ref);
        const input = parse(ReasonRequestSchema, body);
        checkVerification(asset, vr, "verification.reject");
        return asCommand(
          mutate("verification.reject", { ref, input }, opts, () => {
            vr.state = "REJECTED";
            vr.lastMessage = input.reason;
            vr.updatedAt = now().toISOString();
            assetEvent(asset, { ref, type: "VERIFICATION_REJECTED", detail: input.reason, from: "IN_REVIEW", to: "REJECTED" });
          }),
        );
      },
    },

    attestations: {
      get: (ref) =>
        read(() => {
          const asset = findAsset((a) => a.attestations.some((x) => x.ref === ref));
          const attestation = must(asset.attestations.find((x) => x.ref === ref));
          const a = actor();
          const visible =
            (asset.ownerOrgId === a.orgId && a.roles.includes("BORROWER")) ||
            (attestation.issuerOrgId === a.orgId && a.roles.includes("VERIFIER")) ||
            casesOf(asset).some((c) => presentCaseDetail(c, a, pctx())?.allowedTabs.includes("verification"));
          if (!visible) throw unavailable();
          return presentAttestation(asset, attestation, pctx());
        }),
    },

    reviews: {
      list: (query) =>
        read(() => paginate(world.cases.map((c) => presentReviewSummary(c, actor(), pctx())).filter((x) => x !== null), query)),
      get: (ref) => read(() => must(presentReview(caseOfReview(ref), actor(), pctx()))),

      submitForApproval: async (ref, opts) => {
        const facts = caseOfReview(ref);
        checkCase(facts, "review.submitForApproval");
        return asCommand(
          mutate("review.submitForApproval", { ref }, opts, () => {
            facts.review.state = "PENDING_APPROVAL";
            facts.review.submittedForApprovalAt = now().toISOString();
            caseEvent(facts, { ref, type: "SUBMITTED_FOR_APPROVAL", from: "IN_REVIEW", to: "PENDING_APPROVAL", version: `assessment v${facts.review.assessment?.version ?? 1}` });
          }),
        );
      },

      decide: async (ref, body, opts) => {
        const facts = caseOfReview(ref);
        const input = parse(ReviewDecisionRequestSchema, body);
        checkCase(facts, "review.decide");
        return asCommand(
          mutate("review.decide", { ref, input }, opts, () => {
            const from = facts.review.state;
            facts.review.state = input.outcome;
            facts.review.approverUserId = actor().userId;
            facts.review.decision = { outcome: input.outcome, decidedAt: now().toISOString(), decidedByUserId: actor().userId };
            if (input.sharedFeedback !== undefined) facts.review.sharedFeedback = input.sharedFeedback;
            caseEvent(facts, {
              ref,
              type: "DECISION_RECORDED",
              detail: input.outcome === "ELIGIBLE" ? "Eligible for this case" : "Rejected for this case",
              from,
              to: input.outcome,
              version: `assessment v${facts.review.assessment?.version ?? 1}`,
            });
          }),
        );
      },

      requestInformation: async (ref, body, opts) => {
        const facts = caseOfReview(ref);
        const input = parse(MessageRequestSchema, body);
        checkCase(facts, "review.requestInformation");
        return asCommand(
          mutate("review.requestInformation", { ref, input }, opts, () => {
            const from = facts.review.state;
            facts.review.state = "NEEDS_INFORMATION";
            facts.review.informationRequest = input.message;
            facts.review.sharedFeedback = input.message;
            // Free text stays out of activity events (as in LOCALNET).
            caseEvent(facts, { ref, type: "INFORMATION_REQUESTED", from, to: "NEEDS_INFORMATION" });
          }),
        );
      },
    },

    proposals: {
      get: (ref) => read(() => must(presentProposal(caseOfProposal(ref), actor(), pctx()))),

      accept: async (ref, body, opts) => {
        const facts = caseOfProposal(ref);
        const input = parse(ExpectedVersionRequestSchema, body);
        checkCase(facts, "proposal.accept");
        const latest = must(latestProposal(facts));
        if (latest.version !== input.expectedVersion) throw conflict("This proposal has a newer version. Review it before accepting.");
        return asCommand(
          mutate("proposal.accept", { ref, input }, opts, () => {
            latest.state = "ACCEPTED";
            latest.respondedAt = now().toISOString();
            latest.respondedByUserId = actor().userId;
            caseEvent(facts, { ref, type: "PROPOSAL_ACCEPTED", from: "ISSUED", to: "ACCEPTED", version: `v${latest.version}` });
          }),
        );
      },

      decline: async (ref, body, opts) => {
        const facts = caseOfProposal(ref);
        const input = parse(DeclineProposalRequestSchema, body);
        checkCase(facts, "proposal.decline");
        const latest = must(latestProposal(facts));
        if (latest.version !== input.expectedVersion) throw conflict("This proposal has a newer version. Review it before declining.");
        return asCommand(
          mutate("proposal.decline", { ref, input }, opts, () => {
            latest.state = "DECLINED";
            latest.respondedAt = now().toISOString();
            latest.respondedByUserId = actor().userId;
            latest.note = input.reason ?? latest.note;
            caseEvent(facts, { ref, type: "PROPOSAL_DECLINED", from: "ISSUED", to: "DECLINED", version: `v${latest.version}` });
          }),
        );
      },

      withdraw: async (ref, body, opts) => {
        const facts = caseOfProposal(ref);
        checkCase(facts, "proposal.withdraw");
        return asCommand(
          mutate("proposal.withdraw", { ref, body: body ?? null }, opts, () => {
            const latest = must(latestProposal(facts));
            latest.state = "WITHDRAWN";
            latest.withdrawnAt = now().toISOString();
            if (body?.reason) latest.note = body.reason;
            caseEvent(facts, { ref, type: "PROPOSAL_WITHDRAWN", from: "ISSUED", to: "WITHDRAWN", version: `v${latest.version}` });
          }),
        );
      },

      authorizeActivation: async (ref, body, opts) => {
        const facts = caseOfProposal(ref);
        const input = parse(ExpectedVersionRequestSchema, body);
        checkCase(facts, "activation.authorize");
        const latest = must(latestProposal(facts));
        if (latest.version !== input.expectedVersion || effectiveProposalState(latest, now()) !== "ACCEPTED") {
          throw conflict("Authorization must reference the accepted proposal version.");
        }
        return asCommand(
          mutate("activation.authorize", { ref, input }, opts, () => {
            const attestation = must(currentAttestation(facts.asset));
            facts.activation = {
              state: "AUTHORIZED",
              proposalRef: latest.ref,
              proposalVersion: latest.version,
              attestationRef: attestation.ref,
              packageVersion: facts.asset.package.version,
              controlVersion: facts.asset.control.version,
              authorizedAt: now().toISOString(),
              authorizedByUserId: actor().userId,
              expiresAt: new Date(now().getTime() + 7 * 86_400_000).toISOString(),
              consumedAt: null,
            };
            caseEvent(facts, { ref, type: "ACTIVATION_AUTHORIZED", from: "NONE", to: "AUTHORIZED", version: `v${latest.version}` });
          }),
        );
      },
    },

    pledges: {
      list: (query) =>
        read(() => {
          const pledges = world.cases
            .map((c) => presentPledge(c, actor(), pctx()))
            .filter((p) => p !== null)
            .filter((p) => {
              if (!query?.filter) return true;
              if (query.filter === "released") return p.state.value === "RELEASED";
              if (query.filter === "release-requested") return p.state.value === "RELEASE_REQUESTED";
              return p.lockState.value === "ACTIVE" && p.state.value !== "RELEASE_REQUESTED";
            })
            .sort((a, b) => Date.parse(b.activatedAt) - Date.parse(a.activatedAt));
          return paginate(pledges, query);
        }),
      get: (ref) => read(() => must(presentPledge(caseOfPledge(ref), actor(), pctx()))),

      requestRelease: async (ref, body, opts) => {
        const facts = caseOfPledge(ref);
        const input = parse(CreateReleaseRequestSchema, body);
        checkCase(facts, "release.request");
        return mutate("release.request", { ref, input }, opts, () => {
          const rrRef = nextFreeRef("releaseRequest", allRefs.releaseRequest());
          const a = actor();
          const requestedAt = now().toISOString();
          facts.releaseRequests.push({
            ref: rrRef,
            lockRef: ref,
            state: "REQUESTED",
            reason: input.reason,
            note: input.note ?? null,
            servicingRef: input.servicingRef ?? null,
            requestedByOrgId: a.orgId,
            requestedByUserId: a.userId,
            requestedAt,
            informationRequest: null,
            decidedAt: null,
            decidedByUserId: null,
            decisionReason: null,
            // Private note thread (lock owner and designated lender only, enforced by presentPledge).
            thread: input.note ? [{ kind: "NOTE", body: input.note, authorOrgId: a.orgId, authorUserId: a.userId, at: requestedAt }] : [],
          });
          // The lock is not touched: a release request never unlocks (invariant 6).
          caseEvent(facts, {
            ref: rrRef,
            type: "RELEASE_REQUESTED",
            detail: releaseReasons.label(input.reason).toLowerCase(),
            from: "ACTIVE",
            to: "RELEASE_REQUESTED",
          });
          return { releaseRequestRef: rrRef };
        });
      },
    },

    releaseRequests: {
      get: (ref) =>
        read(() => {
          const { facts } = releaseRequest(ref);
          return must(must(presentPledge(facts, actor(), pctx())).releaseRequests.find((r) => r.ref === ref));
        }),

      decide: async (ref, body, opts) => {
        const { facts, rr } = releaseRequest(ref);
        const input = parse(ReleaseDecisionRequestSchema, body);
        checkCase(facts, input.decision === "AUTHORIZE" ? "release.authorize" : "release.reject");
        return asCommand(
          mutate("release.decide", { ref, input }, opts, () => {
            const lock = must(facts.lock);
            const at = now().toISOString();
            const from = "RELEASE_REQUESTED";
            rr.decidedAt = at;
            rr.decidedByUserId = actor().userId;
            if (input.decision === "AUTHORIZE") {
              const before = facts.asset.control.version;
              rr.state = "AUTHORIZED";
              lock.state = "RELEASED";
              lock.releasedAt = at;
              lock.releasedByUserId = actor().userId;
              lock.controlVersionAfterRelease = before + 1;
              facts.asset.control = { version: before + 1, state: "AVAILABLE", lockRef: null };
              caseEvent(facts, { ref, type: "RELEASE_AUTHORIZED", from, to: "RELEASED", version: `control v${before} → v${before + 1}` });
            } else {
              rr.state = "REJECTED";
              rr.decisionReason = input.reason;
              // A rejection is a release-request outcome; the lock stays ACTIVE.
              caseEvent(facts, { ref, type: "RELEASE_REJECTED", detail: input.reason, from, to: "RELEASE_REJECTED" });
            }
          }),
        );
      },

      requestInformation: async (ref, body, opts) => {
        const { facts, rr } = releaseRequest(ref);
        const input = parse(MessageRequestSchema, body);
        checkCase(facts, "release.requestInformation");
        return asCommand(
          mutate("release.requestInformation", { ref, input }, opts, () => {
            const a = actor();
            rr.state = "INFORMATION_REQUESTED";
            rr.informationRequest = input.message;
            rr.thread = [...(rr.thread ?? []), { kind: "QUESTION", body: input.message, authorOrgId: a.orgId, authorUserId: a.userId, at: now().toISOString() }];
            // Free text stays out of activity events (as in LOCALNET).
            caseEvent(facts, { ref, type: "RELEASE_INFORMATION_REQUESTED", from: "REQUESTED", to: "INFORMATION_REQUESTED" });
          }),
        );
      },

      respond: async (ref, body, opts) => {
        const { facts, rr } = releaseRequest(ref);
        const input = parse(MessageRequestSchema, body);
        checkCase(facts, "release.respond");
        return asCommand(
          mutate("release.respond", { ref, input }, opts, () => {
            const a = actor();
            rr.state = "REQUESTED";
            rr.informationRequest = null;
            rr.thread = [...(rr.thread ?? []), { kind: "RESPONSE", body: input.message, authorOrgId: a.orgId, authorUserId: a.userId, at: now().toISOString() }];
            caseEvent(facts, { ref, type: "RELEASE_INFORMATION_PROVIDED", from: "INFORMATION_REQUESTED", to: "REQUESTED" });
          }),
        );
      },

      withdraw: async (ref, opts) => {
        const { facts, rr } = releaseRequest(ref);
        checkCase(facts, "release.withdraw");
        return asCommand(
          mutate("release.withdraw", { ref }, opts, () => {
            const from = rr.state;
            rr.state = "WITHDRAWN";
            caseEvent(facts, { ref, type: "RELEASE_WITHDRAWN", from, to: "WITHDRAWN" });
          }),
        );
      },
    },

    accessGrants: {
      list: (query) =>
        read(() => {
          const cases = query?.caseId ? [visibleCase(query.caseId)] : world.cases;
          return paginate(cases.flatMap((c) => presentAccessGrants(c, actor(), pctx()) ?? []), query);
        }),

      create: async (body, opts) => {
        const input = parse(CreateAuditGrantRequestSchema, body);
        const facts = visibleCase(input.caseId);
        checkCase(facts, "auditGrant.create");
        const a = actor();
        const side = a.orgId === facts.borrowerOrgId ? "OWNER" : "LENDER";
        const notOwned = input.scopes.filter((scope) => !AUDIT_SCOPE_OWNERS[scope].includes(side));
        if (notOwned.length > 0) throw invalid(`Only the record owner can grant: ${notOwned.join(", ")}.`);
        if (DEMO_ORGANIZATIONS[input.auditorOrgId]?.type !== "AUDITOR") throw invalid("Select an auditor organization.");
        if (Date.parse(input.expiresAt) <= now().getTime()) throw invalid("The grant must expire in the future.");
        return mutate("auditGrant.create", input, opts, () => {
          const ref = nextFreeRef("accessGrant", allRefs.accessGrant());
          facts.auditGrants.push({
            ref,
            grantorOrgId: a.orgId,
            grantorSide: side,
            grantedByUserId: a.userId,
            auditorOrgId: input.auditorOrgId,
            scopes: input.scopes,
            permission: input.permission,
            purpose: input.purpose,
            createdAt: now().toISOString(),
            expiresAt: input.expiresAt,
            revokedAt: null,
          });
          caseEvent(facts, { ref, type: "AUDIT_GRANT_CREATED", detail: orgName(input.auditorOrgId), to: "GRANTED" });
          return { grantId: ref };
        });
      },

      revoke: async (grantId, opts) => {
        const facts = findCase((c) => c.shares.some((s) => s.ref === grantId) || c.auditGrants.some((g) => g.ref === grantId));
        if (!presentCaseSummary(facts, actor(), pctx())) throw unavailable();
        const share = facts.shares.find((s) => s.ref === grantId);
        if (share) checkCase(facts, "sharing.revoke");
        else {
          checkCase(facts, "auditGrant.revoke");
          const grant = must(facts.auditGrants.find((g) => g.ref === grantId));
          if (grant.grantorOrgId !== actor().orgId) throw ApiError.problem("forbidden", ERROR_COPY.FORBIDDEN);
          if (grant.revokedAt) throw conflict("This grant is already revoked.");
        }
        return asCommand(
          mutate("accessGrant.revoke", { grantId }, opts, () => {
            const at = now().toISOString();
            if (share) {
              share.state = "REVOKED";
              share.revokedAt = at;
              // A dealer consent held in this share ends with it (LOCALNET: Share_Revoke of the dealer's share).
              for (const c of facts.consents) {
                if (c.ref === grantId && c.purpose === "LENDER_REVIEW" && c.state === "GRANTED") {
                  c.state = "REVOKED";
                  c.decidedAt = at;
                }
              }
              caseEvent(facts, { ref: grantId, type: "ACCESS_REVOKED", detail: orgName(share.recipientOrgId), from: "GRANTED", to: "REVOKED" });
            } else {
              const grant = must(facts.auditGrants.find((g) => g.ref === grantId));
              grant.revokedAt = at;
              caseEvent(facts, { ref: grantId, type: "AUDIT_GRANT_REVOKED", detail: orgName(grant.auditorOrgId), from: "GRANTED", to: "REVOKED" });
            }
          }),
        );
      },
    },

    consentRequests: {
      list: (query) =>
        read(() => {
          const q = parse(ConsentRequestQuerySchema, query ?? {});
          const cases = q.caseId ? [visibleCase(q.caseId)] : world.cases;
          return paginate(
            cases.flatMap((c) => presentConsentRequests(c, actor(), pctx()) ?? []),
            q,
          );
        }),

      decide: async (id, body, opts) => {
        const { facts, consent } = visibleConsent(id);
        const input = parse(ConsentDecisionRequestSchema, body);
        guard(checkConsentAction(facts, consent, actor(), input.decision === "GRANT" ? "consent.grant" : "consent.decline", now(), pctx()));
        return asCommand(
          mutate("consent.decision", { id, decision: input.decision }, opts, () => {
            const at = now().toISOString();
            consent.decidedAt = at;
            if (input.decision === "DECLINE") {
              consent.state = "DECLINED";
              return;
            }
            consent.state = "GRANTED";
            const entries = consent.documents.map((d) => ({ documentRef: d.documentRef, version: d.version }));
            if (consent.purpose === "LENDER_REVIEW") {
              // LOCALNET: Consent_Grant creates the PackageShare signed by owner + dealer, observed by the lender.
              facts.shares.push({
                ref: consent.ref,
                recipientOrgId: consent.recipientOrgId,
                purpose: "LENDER_REVIEW",
                packageRef: consent.packageRef,
                packageVersion: consent.packageVersion,
                entries,
                permission: consent.permission,
                state: "GRANTED",
                consentingOrgIds: [consent.ownerOrgId, consent.dealerOrgId],
                createdAt: at,
                expiresAt: consent.expiresAt,
                revokedAt: null,
              });
              caseEvent(facts, { ref: consent.ref, type: "PACKAGE_SHARED", detail: `${orgName(consent.recipientOrgId)} · ${entries.length} documents`, to: "GRANTED" });
              return;
            }
            // VERIFICATION: the assigned verifier receives exactly these versions for this request.
            const vr = facts.asset.verifications.find((v) => v.ref === consent.verificationRef);
            if (vr && vr.packageVersion === consent.packageVersion) {
              const versions = [...(vr.documentVersions ?? []), ...entries].sort((a, b) => a.documentRef.localeCompare(b.documentRef));
              vr.documentVersions = versions;
              vr.documentRefs = [...new Set(versions.map((e) => e.documentRef))];
            }
          }),
        );
      },

      withdraw: async (id, opts) => {
        const { facts, consent } = visibleConsent(id);
        guard(checkConsentAction(facts, consent, actor(), "consent.withdraw", now(), pctx()));
        return asCommand(
          mutate("consent.withdraw", { id }, opts, () => {
            const at = now().toISOString();
            consent.state = "WITHDRAWN";
            consent.decidedAt = at;
            const docs = new Set(consent.documents.map((d) => d.documentRef));
            if (consent.purpose === "LENDER_REVIEW") {
              // The dealer's share ends (LOCALNET: Share_WithdrawConsent archives it). The seed's AG-001 holds the
              // owner's and the dealer's records together: only the dealer's records leave it.
              const share = facts.shares.find((x) => x.ref === consent.ref && x.state === "GRANTED");
              if (share) {
                share.entries = share.entries.filter((e) => !docs.has(e.documentRef));
                share.consentingOrgIds = share.consentingOrgIds.filter((o) => o !== consent.dealerOrgId);
                if (share.entries.length === 0) {
                  share.state = "REVOKED";
                  share.revokedAt = at;
                }
              }
              caseEvent(facts, { ref: consent.ref, type: "ACCESS_REVOKED", detail: "Dealer consent withdrawn", from: "GRANTED", to: "REVOKED" });
            } else {
              // Verification grants are not case events for the lender (LOCALNET: owner, dealer and verifier only).
              const vr = facts.asset.verifications.find((v) => v.ref === consent.verificationRef);
              if (vr) {
                vr.documentVersions = (vr.documentVersions ?? []).filter((e) => !docs.has(e.documentRef));
                vr.documentRefs = vr.documentRefs.filter((ref) => !docs.has(ref));
              }
            }
          }),
        );
      },
    },

    audit: {
      events: (query) =>
        read(() => {
          const a = actor();
          let events: AuditEvent[];
          if (query?.caseId) events = must(presentCaseActivity(visibleCase(query.caseId), a, pctx()));
          else if (query?.assetRef) {
            events = must(presentAssetActivity(findAsset((x) => x.ref === query.assetRef), world.cases, a, pctx()));
          } else {
            const byId = new Map<string, AuditEvent>();
            for (const c of world.cases) for (const e of presentCaseActivity(c, a, pctx()) ?? []) byId.set(e.id, e);
            for (const asset of world.assets) for (const e of presentAssetActivity(asset, world.cases, a, pctx()) ?? []) byId.set(e.id, e);
            events = [...byId.values()];
          }
          const from = query?.from ? Date.parse(query.from) : -Infinity;
          const to = query?.to ? Date.parse(query.to) : Infinity;
          const filtered = events
            .filter((e) => (!query?.kind || e.kind.value === query.kind) && Date.parse(e.occurredAt) >= from && Date.parse(e.occurredAt) <= to)
            .sort((x, y) => Date.parse(y.occurredAt) - Date.parse(x.occurredAt));
          return paginate(filtered, query);
        }),
    },

    reports: {
      list: (query) =>
        read(() =>
          paginate(
            world.cases
              .flatMap((c) => c.exports)
              .map((exp) => presentReport(exp, actor(), pctx()))
              .filter((x) => x !== null)
              .sort((x, y) => Date.parse(y.requestedAt) - Date.parse(x.requestedAt)),
            query,
          ),
        ),

      create: async (body, opts) => {
        const input = parse(CreateReportRequestSchema, body);
        const facts = visibleCase(input.caseId);
        checkCase(facts, "report.export");
        const a = actor();
        const content = buildCaseReport(facts, world.cases, a, pctx());
        const generatedAt = now().toISOString();
        const document = { ...content, schemaVersion: REPORT_SCHEMA_VERSION, generatedAt, cutoff: { offset: null, at: generatedAt } };
        const bodyText = input.format === "CSV" ? toCsv(content?.events) : JSON.stringify(document, null, 2);
        const checksum = await sha256Hex(bodyText);
        return mutate(
          "report.create",
          input,
          opts,
          () => {
            const ref = nextFreeRef("report", allRefs.report());
            const exp: ExportFacts = {
              ref,
              caseRef: facts.ref,
              format: input.format,
              state: "READY",
              requestedByOrgId: a.orgId,
              requestedByUserId: a.userId,
              requestedRole: primaryRole(a),
              requestedAt: generatedAt,
              generatedAt,
              cutoff: { offset: null, at: generatedAt },
              checksum: checksum ? `sha256 ${checksum}` : null,
              scopeLabel: exportScopeLabel(),
              schemaVersion: REPORT_SCHEMA_VERSION,
              expiresAt: new Date(now().getTime() + 7 * 86_400_000).toISOString(),
              auditScopes: exportAuditScopes(facts, a, now(), pctx()),
            };
            facts.exports.push(exp);
            reportContent.set(ref, { body: bodyText, contentType: input.format === "CSV" ? "text/csv" : "application/json" });
            caseEvent(facts, { ref, type: "REPORT_GENERATED", detail: `${input.format} · ${REPORT_SCHEMA_VERSION}`, kind: "OPERATIONAL" });
            return must(presentReport(exp, a, pctx()));
          },
          { target: "APPLICATION" },
        );
      },

      download: (ref) =>
        read(() => {
          const facts = findCase((c) => c.exports.some((e) => e.ref === ref));
          const exp = must(facts.exports.find((e) => e.ref === ref));
          must(presentReport(exp, actor(), pctx()));
          // Access is re-evaluated at download (grants revoked or expired since generation block it).
          if (!canDownloadReport(facts, exp, actor(), now(), pctx())) throw unavailable();
          const stored = must(reportContent.get(ref));
          return { url: dataUrl(stored.contentType, stored.body), expiresAt: new Date(now().getTime() + 60_000).toISOString() };
        }),
    },

    verifiers: {
      list: () => read(() => presentVerifierEntries(world.governance, world.assets, pctx())),
    },

    directory: {
      lenders: () => read(() => directoryOf("LENDER")),
      dealers: () => read(() => directoryOf("DEALER")),
    },

    overview: {
      // presentOverview applies the same disclosure as the API's stakeholder-filtered read model.
      get: () => read(() => presentOverview(world.cases, actor(), pctx())),
    },

    governance: {
      state: () => read(() => presentGovernanceState(world.governance, actor(), pctx())),
      proposals: () =>
        read(() =>
          [...world.governance.proposals]
            .sort((x, y) => Date.parse(y.openedAt) - Date.parse(x.openedAt))
            .map((p) => presentGovernanceProposal(p, world.governance, actor(), pctx())),
        ),
      proposal: (ref) =>
        read(() => presentGovernanceProposal(must(world.governance.proposals.find((p) => p.ref === ref)), world.governance, actor(), pctx())),

      propose: async (body, opts) => {
        const input = parse(CreateGovernanceProposalRequestSchema, body);
        const gov = world.governance;
        const seat = governanceSeatOf(actor());
        if (!can(actor(), "governance.act") || seat === null || !gov.seats.some((s) => s.seat === seat && s.orgId === actor().orgId)) {
          throw ApiError.problem("forbidden", ERROR_COPY.FORBIDDEN);
        }
        const openFor = (verifierRef: string) =>
          gov.proposals.some((p) => p.target.verifierRef === verifierRef && isOpenGovernanceProposal(governanceProposalState(p, gov, now())));
        let target: { verifierRef: string; orgName: string; scope: string };
        if (input.type === "SUSPEND_VERIFIER") {
          const entry = gov.verifiers.find((v) => v.ref === input.verifierRef);
          if (!entry) throw unavailable();
          if (entry.status !== "ACTIVE" || openFor(entry.ref)) throw conflict("This verifier cannot be suspended in its current state.");
          target = { verifierRef: entry.ref, orgName: entry.orgName, scope: entry.scope };
        } else {
          target = { verifierRef: nextFreeRef("verifier", allRefs.verifier()), orgName: input.orgName, scope: input.scope };
        }
        return mutate(
          "governance.propose",
          input,
          opts,
          () => {
            const ref = nextFreeRef("governanceProposal", allRefs.governanceProposal());
            const at = now().toISOString();
            gov.proposals.push({
              ref,
              type: input.type,
              target,
              proposerSeat: seat,
              rationale: input.rationale,
              effect:
                input.type === "ADD_VERIFIER"
                  ? `${target.orgName} is added to the registry as ACTIVE and becomes assignable to verification requests.`
                  : `${target.verifierRef} set to SUSPENDED. Existing attestations remain valid; no new assignments can be accepted.`,
              openedAt: at,
              deadlineAt: new Date(now().getTime() + gov.proposalDeadlineDays * 86_400_000).toISOString(),
              expectedRegistryVersion: gov.registryVersion,
              confirmations: [{ seat, confirmedAt: at }],
              executedAt: null,
              executedBySeat: null,
              cancelledAt: null,
            });
            return { proposalRef: ref };
          },
          { message: SIMULATED_COPY.GOVERNANCE_PROPOSED },
        );
      },

      confirm: async (ref, opts) => {
        const gov = world.governance;
        const proposal = must(gov.proposals.find((p) => p.ref === ref));
        const view = presentGovernanceProposal(proposal, gov, actor(), pctx());
        if (!view.allowedActions.includes("confirm")) {
          if (governanceSeatOf(actor()) === null) throw ApiError.problem("forbidden", ERROR_COPY.FORBIDDEN);
          throw conflict("This proposal cannot be confirmed by your seat in its current state.");
        }
        const seat = governanceSeatOf(actor());
        return asCommand(
          mutate(
            "governance.confirm",
            { ref },
            opts,
            () => {
              if (seat !== null) proposal.confirmations.push({ seat, confirmedAt: now().toISOString() });
            },
            { message: SIMULATED_COPY.GOVERNANCE_RECORDED },
          ),
        );
      },

      execute: async (ref, opts) => {
        const gov = world.governance;
        const proposal = must(gov.proposals.find((p) => p.ref === ref));
        const seat = governanceSeatOf(actor());
        if (seat === null || !can(actor(), "governance.act")) throw ApiError.problem("forbidden", ERROR_COPY.FORBIDDEN);
        if (governanceProposalState(proposal, gov, now()) !== "EXECUTABLE") {
          throw conflict(`Execution needs ${gov.threshold} live confirmations from distinct seats.`);
        }
        return asCommand(
          mutate(
            "governance.execute",
            { ref },
            opts,
            () => {
              const at = now().toISOString();
              if (proposal.type === "ADD_VERIFIER") {
                gov.verifiers.push({
                  ref: proposal.target.verifierRef,
                  orgName: proposal.target.orgName,
                  orgId: null,
                  scope: proposal.target.scope,
                  status: "ACTIVE",
                  since: at,
                  via: proposal.ref,
                });
              } else {
                const entry = must(gov.verifiers.find((v) => v.ref === proposal.target.verifierRef));
                entry.status = "SUSPENDED";
                entry.since = at;
                entry.via = proposal.ref;
              }
              gov.registryVersion += 1;
              proposal.executedAt = at;
              proposal.executedBySeat = seat;
              // Governance administers the registry only; it never touches collateral (CR-22).
            },
            { message: SIMULATED_COPY.GOVERNANCE_EXECUTED },
          ),
        );
      },

      cancel: async (ref, opts) => {
        const gov = world.governance;
        const proposal = must(gov.proposals.find((p) => p.ref === ref));
        if (governanceSeatOf(actor()) !== proposal.proposerSeat) throw ApiError.problem("forbidden", ERROR_COPY.FORBIDDEN);
        if (!isOpenGovernanceProposal(governanceProposalState(proposal, gov, now()))) throw conflict("Only an open proposal can be withdrawn.");
        return asCommand(
          mutate(
            "governance.cancel",
            { ref },
            opts,
            () => {
              proposal.cancelledAt = now().toISOString();
            },
            { message: SIMULATED_COPY.GOVERNANCE_RECORDED },
          ),
        );
      },
    },

    commands: {
      get: (commandId) => read(() => must(commands.get(commandId))),
    },

    pilotRequests: {
      create: async (body, opts) => {
        parse(PilotRequestSchema, body);
        return mutate(
          "pilotRequest.create",
          body,
          opts,
          () => {
            const receipt = { id: `pilot-${randomId()}`, receivedAt: now().toISOString() };
            pilotRequests.push(receipt);
            return { id: receipt.id, state: pilotRequestStates.badge("RECEIVED"), receivedAt: receipt.receivedAt };
          },
          { target: "APPLICATION" },
        );
      },
    },

    system: {
      health: () =>
        read(() => ({
          status: "ok" as const,
          mode: "UI_MOCK" as const,
          version: "ui-mock",
          checks: {
            mock: { status: "ok" as const, detail: "In-memory UI mockup client. No API, database or ledger is connected." },
          },
        })),
    },
  };
  return client;
}
