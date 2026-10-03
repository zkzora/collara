// Collara application database (PostgreSQL 16). The ledger, not this database, is authoritative for
// attestations, consent, proposals, control, lock and release (ADR-0001 §4): tables prefixed `ledger_`
// are projections written by the worker, everything else is an application record.
// Money is numeric(18,2) + an explicit ISO currency; display refs (CL-001, DOC-001) are kept here and
// carried as Daml Text, separate from contract ids.
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const tsz = (name: string) => timestamp(name, { withTimezone: true });
/** Ledger offsets are int64 on the wire; JavaScript numbers are exact up to 2^53. */
const offset = (name: string) => bigint(name, { mode: "number" });

// --- Identity, organizations, authority ------------------------------------------------------------

export const organizations = pgTable(
  "organizations",
  {
    /** Stable slug, e.g. "demo-lender-a" (DEMO_ORG_IDS). */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** OrgType: OPERATOR | BORROWER | DEALER | VERIFIER | LENDER | AUDITOR (self-declared, never verified). */
    type: text("type").notNull(),
    country: char("country", { length: 2 }),
    /** OrganizationState: DRAFT | PENDING_APPROVAL | ACTIVE | SUSPENDED. */
    state: text("state").notNull().default("ACTIVE"),
    hostingMode: text("hosting_mode"),
    /** Seeded synthetic organizations are never presented as verified real institutions. */
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("organizations_country_iso", sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`)],
);

export const users = pgTable(
  "users",
  {
    /** "user-lender-a-approver" for seeded demo users, a UUID string otherwise. */
    id: text("id").primaryKey(),
    /** Lower-cased. */
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    displayName: text("display_name").notNull(),
    title: text("title"),
    oidcIssuer: text("oidc_issuer"),
    oidcSubject: text("oidc_subject"),
    /** PersonaId for seeded demo users (demo sessions bind to these only). */
    personaId: text("persona_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    disabledAt: tsz("disabled_at"),
    lastLoginAt: tsz("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_oidc_identity_key").on(t.oidcIssuer, t.oidcSubject),
    uniqueIndex("users_persona_key").on(t.personaId),
  ],
);

/** One row per (user, organization, role). A web account is not a Canton party. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    /** Role (domain ROLES). */
    role: text("role").notNull(),
    /** MembershipState: PENDING | ACTIVE | DISABLED. */
    state: text("state").notNull().default("PENDING"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("memberships_user_org_role_key").on(t.userId, t.orgId, t.role), index("memberships_org_idx").on(t.orgId)],
);

/** Mandates inside one organization (analyst vs approver is a mandate, not a separate party). */
export const mandates = pgTable(
  "mandates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    /** MandateCode: BORROWER | ANALYST | APPROVER | AUDIT_LEAD | ORG_ADMIN | GOVERNANCE_SEAT. */
    code: text("code").notNull(),
    /** 1–3 for GOVERNANCE_SEAT; 0 otherwise (keeps the unique key simple). */
    seat: smallint("seat").notNull().default(0),
    label: text("label").notNull(),
    /** ACTIVE | REVOKED */
    state: text("state").notNull().default("ACTIVE"),
    grantedByUserId: text("granted_by_user_id"),
    createdAt: createdAt(),
    revokedAt: tsz("revoked_at"),
  },
  (t) => [
    uniqueIndex("mandates_user_org_code_seat_key").on(t.userId, t.orgId, t.code, t.seat),
    check("mandates_seat_range", sql`${t.seat} between 0 and 3`),
  ],
);

/**
 * Organization ↔ Canton party. Party ids change on every sandbox restart, so bindings are re-imported
 * from .local/localnet/state.json (see importLocalnetState) and never hard-coded.
 * kind: business (the org's own party) | governance-member (a seat party, never the business party)
 *       | governance (the shared CollaraGovernance party; members read it, nobody acts as it from the API).
 */
export const partyBindings = pgTable(
  "party_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    kind: text("kind").notNull(),
    governanceSeat: smallint("governance_seat"),
    partyId: text("party_id").notNull(),
    partyHint: text("party_hint").notNull(),
    /** Ledger source (participant alias), e.g. "sandbox". */
    source: text("source").notNull(),
    participantId: text("participant_id").notNull(),
    environment: text("environment").notNull().default("LOCALNET"),
    /** PartyBindingState: REQUESTED | ACTIVE | REVOKED. */
    state: text("state").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revokedAt: tsz("revoked_at"),
  },
  (t) => [
    uniqueIndex("party_bindings_party_key").on(t.environment, t.partyId),
    index("party_bindings_org_idx").on(t.orgId, t.state),
    check("party_bindings_kind", sql`${t.kind} in ('business', 'governance-member', 'governance')`),
  ],
);

/** Least-privilege ledger users (one per organization) plus the worker's read-only projector user. */
export const ledgerUsers = pgTable(
  "ledger_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").references(() => organizations.id),
    ledgerUserId: text("ledger_user_id").notNull(),
    source: text("source").notNull(),
    /** org | projector | admin */
    role: text("role").notNull(),
    primaryParty: text("primary_party"),
    actAs: text("act_as").array().notNull().default(sql`'{}'::text[]`),
    readAs: text("read_as").array().notNull().default(sql`'{}'::text[]`),
    environment: text("environment").notNull().default("LOCALNET"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ledger_users_source_user_key").on(t.environment, t.source, t.ledgerUserId)],
);

/**
 * Server-side sessions. `id` is the SHA-256 of the session id (a leaked table row cannot be replayed as a
 * cookie). `data` is the serialized @fastify/session object; user/org/persona are copied out for queries.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    activeOrgId: text("active_org_id").references(() => organizations.id),
    personaId: text("persona_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    data: jsonb("data").notNull(),
    expiresAt: tsz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_expires_idx").on(t.expiresAt), index("sessions_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the invitation token; the token itself is only ever in the invitation link. */
    tokenHash: text("token_hash").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    roles: text("roles").array().notNull(),
    mandates: jsonb("mandates").notNull().default(sql`'[]'::jsonb`),
    /** InvitationState: PENDING | ACCEPTED | DECLINED | EXPIRED | REVOKED. */
    state: text("state").notNull().default("PENDING"),
    invitedByUserId: text("invited_by_user_id").references(() => users.id),
    acceptedByUserId: text("accepted_by_user_id").references(() => users.id),
    expiresAt: tsz("expires_at").notNull(),
    respondedAt: tsz("responded_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invitations_token_key").on(t.tokenHash), index("invitations_org_idx").on(t.orgId)],
);

// --- Public intake --------------------------------------------------------------------------------

/** /pilot submissions (S §6.1). Stored before any notification; the honeypot is never stored. */
export const pilotRequests = pgTable(
  "pilot_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    workEmail: text("work_email").notNull(),
    company: text("company").notNull(),
    role: text("role").notNull(),
    companyType: text("company_type").notNull(),
    country: text("country").notNull(),
    equipmentCategory: text("equipment_category").notNull(),
    casesPerMonth: text("cases_per_month").notNull(),
    workflowChallenge: text("workflow_challenge").notNull(),
    currentSystems: text("current_systems"),
    consentAt: tsz("consent_at").notNull(),
    /** PilotRequestState: RECEIVED | NOTIFIED | NOTIFY_RETRY. */
    status: text("status").notNull().default("RECEIVED"),
    notifyAttempts: integer("notify_attempts").notNull().default(0),
    lastNotifyError: text("last_notify_error"),
    notifiedAt: tsz("notified_at"),
    /** Client Idempotency-Key, so a double submit stores one request. */
    idempotencyKey: text("idempotency_key"),
    receivedAt: tsz("received_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pilot_requests_idempotency_key").on(t.idempotencyKey), index("pilot_requests_status_idx").on(t.status)],
);

// --- Application records --------------------------------------------------------------------------

/** Display-ref allocation (CL, DOC, RPT, …): one atomic counter per ref kind. */
export const refCounters = pgTable("ref_counters", {
  kind: text("kind").primaryKey(),
  value: integer("value").notNull(),
});

/**
 * Financing case application record. The case stage is a projection (synthesis §1.5.1) and is never
 * stored; only application-owned fields live here.
 */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseRef: text("case_ref").notNull(),
    title: text("title").notNull(),
    purpose: text("purpose"),
    assetRef: text("asset_ref").notNull(),
    borrowerOrgId: text("borrower_org_id")
      .notNull()
      .references(() => organizations.id),
    dealerOrgId: text("dealer_org_id").references(() => organizations.id),
    selectedLenderOrgId: text("selected_lender_org_id").references(() => organizations.id),
    /** Financing-term data: borrower and selected lender only. */
    requestedPrincipal: numeric("requested_principal", { precision: 18, scale: 2 }),
    requestedCurrency: char("requested_currency", { length: 3 }),
    policyRef: text("policy_ref").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    cancelledAt: tsz("cancelled_at"),
    closedAt: tsz("closed_at"),
    /** The case.create command whose transaction inserted this row: a retry of that command finds this case. */
    createCommandId: uuid("create_command_id"),
    /**
     * Set by the transaction that creates the asset's next case, after the ledger showed this case finished
     * (pledge released or review rejected). Display-neutral: the case stage is still derived from the ledger.
     */
    supersededAt: tsz("superseded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("cases_ref_key").on(t.caseRef),
    uniqueIndex("cases_create_command_key").on(t.createCommandId),
    // One active case per asset, also in the database (backstop of the API's domain check, which runs first).
    uniqueIndex("cases_active_asset_key")
      .on(t.assetRef)
      .where(sql`${t.cancelledAt} is null and ${t.closedAt} is null and ${t.supersededAt} is null`),
    index("cases_asset_idx").on(t.assetRef),
    index("cases_borrower_idx").on(t.borrowerOrgId),
    index("cases_lender_idx").on(t.selectedLenderOrgId),
    check(
      "cases_money_pair",
      sql`(${t.requestedPrincipal} is null) = (${t.requestedCurrency} is null) and (${t.requestedCurrency} is null or ${t.requestedCurrency} ~ '^[A-Z]{3}$')`,
    ),
    check("cases_principal_positive", sql`${t.requestedPrincipal} is null or ${t.requestedPrincipal} > 0`),
  ],
);

/** One row per document version. Bytes live in private object storage (quarantine/ → evidence/). */
export const evidenceDocuments = pgTable(
  "evidence_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docRef: text("doc_ref").notNull(),
    version: integer("version").notNull(),
    assetRef: text("asset_ref").notNull(),
    caseRef: text("case_ref"),
    ownerOrgId: text("owner_org_id")
      .notNull()
      .references(() => organizations.id),
    contributorOrgId: text("contributor_org_id")
      .notNull()
      .references(() => organizations.id),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => users.id),
    /** DocumentType (domain DOCUMENT_TYPES). */
    type: text("type").notNull(),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    /** Declared at intent; finalize requires the detected type to match. */
    contentType: text("content_type").notNull(),
    declaredSizeBytes: bigint("declared_size_bytes", { mode: "number" }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Hex SHA-256 computed while receiving the upload. */
    uploadSha256: text("upload_sha256"),
    /** Hex SHA-256 recomputed by the server from stored bytes at finalize (the integrity reference). */
    sha256: text("sha256"),
    storageKey: text("storage_key"),
    /** EvidenceUploadState: UPLOAD_PENDING | QUARANTINED | AVAILABLE | REJECTED | HASH_MISMATCH. */
    status: text("status").notNull().default("UPLOAD_PENDING"),
    /** EvidenceScanState: the synthetic-only MVP does not scan. */
    scanStatus: text("scan_status").notNull().default("NOT_SCANNED"),
    rejectionReason: text("rejection_reason"),
    intentExpiresAt: tsz("intent_expires_at").notNull(),
    /** The upload-intent command that created this version (makes intent creation replay-safe). */
    intentCommandId: uuid("intent_command_id"),
    uploadedAt: tsz("uploaded_at"),
    finalizedAt: tsz("finalized_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("evidence_documents_ref_version_key").on(t.docRef, t.version),
    uniqueIndex("evidence_documents_intent_command_key").on(t.intentCommandId),
    index("evidence_documents_asset_idx").on(t.assetRef),
    index("evidence_documents_owner_idx").on(t.ownerOrgId),
    check("evidence_documents_version_positive", sql`${t.version} > 0`),
    check("evidence_documents_sha256_hex", sql`${t.sha256} is null or ${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * Durable command records (ADR-0001 §2.6). One row per (actor, org, operation, idempotency key); reusing
 * the key with a different payload is a 409. Error text is redacted before it is stored.
 */
export const commands = pgTable(
  "commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    operation: text("operation").notNull(),
    /** LEDGER | APPLICATION */
    target: text("target").notNull(),
    payloadHash: text("payload_hash").notNull(),
    /** Kept so a timed-out submission can be resubmitted with the same command id. */
    payload: jsonb("payload").notNull(),
    /** CommandState: PREPARED → SUBMITTED → COMMITTED → PROJECTED; REJECTED, FAILED, UNKNOWN_OUTCOME, PROJECTION_DELAYED. */
    status: text("status").notNull().default("PREPARED"),
    /** Deterministic Canton command id, reused on every resubmission. */
    ledgerCommandId: text("ledger_command_id").notNull(),
    /** New per attempt. */
    submissionId: text("submission_id"),
    updateId: text("update_id"),
    completionOffset: offset("completion_offset"),
    errorKind: text("error_kind"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    /** Display ref of the resource the command acts on (e.g. CL-001, DOC-006). */
    resourceRef: text("resource_ref"),
    /** Operation result returned on idempotent replay (e.g. { evidenceId, version }). */
    result: jsonb("result"),
    /**
     * Ledger submission context, recorded by the gateway at submit time so the worker can reconcile an
     * UNKNOWN_OUTCOME exactly: the ledger user that submitted, its actAs parties, the participant source and
     * the ledger end observed just before the first submission (completions are read after it).
     */
    ledgerUserId: text("ledger_user_id"),
    actAs: text("act_as").array(),
    ledgerSource: text("ledger_source"),
    ledgerEndAtSubmit: offset("ledger_end_at_submit"),
    /** Worker reconciliation of UNKNOWN_OUTCOME (attempts are recorded even when the outcome stays unknown). */
    reconcileAttempts: integer("reconcile_attempts").notNull().default(0),
    lastReconcileAt: tsz("last_reconcile_at"),
    reconcileNote: text("reconcile_note"),
    createdAt: createdAt(),
    submittedAt: tsz("submitted_at"),
    committedAt: tsz("committed_at"),
    projectedAt: tsz("projected_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("commands_idempotency_key").on(t.actorUserId, t.orgId, t.operation, t.idempotencyKey),
    uniqueIndex("commands_ledger_command_key").on(t.ledgerCommandId),
    index("commands_status_idx").on(t.status),
    index("commands_update_idx").on(t.updateId),
    check("commands_target", sql`${t.target} in ('LEDGER', 'APPLICATION')`),
  ],
);

/**
 * Private off-ledger notes (synthesis §1.4.2 item 5): free text never goes on the ledger, into logs or into
 * notifications. A note belongs to one command (the request that carried it; unique per command and kind, so a
 * replay never duplicates) and is readable only once that command is COMMITTED/PROJECTED; a REJECTED, FAILED or
 * still-pending command never shows its text. Where a Daml field exists (ReleaseRequest.noteRef, questionRef,
 * responseNoteRef) the ledger carries the note id as an opaque reference. Read rules: `notes.ts`.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** NoteKind: ASSESSMENT_INTERNAL | ASSESSMENT_SHARED_FEEDBACK | RELEASE_REQUEST_NOTE | RELEASE_SERVICING_REF | RELEASE_QUESTION | RELEASE_RESPONSE. */
    kind: text("kind").notNull(),
    /** The author's organization (the owner of the text). */
    ownerOrgId: text("owner_org_id")
      .notNull()
      .references(() => organizations.id),
    /** ORG_ONLY (the owner org's lender members) | CASE_COUNTERPARTIES (the two parties of the subject). */
    audience: text("audience").notNull(),
    caseRef: text("case_ref").notNull(),
    /** The record the note is about: the assessment (CA-…) or the release request (RR-…). */
    subjectRef: text("subject_ref").notNull(),
    /** Plain text, length-limited per kind; "" records that the author cleared the text. */
    body: text("body").notNull(),
    commandId: uuid("command_id")
      .notNull()
      .references(() => commands.id),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    /** NoteState: PENDING (command not settled) → ATTACHED (committed) | DISCARDED (rejected). */
    state: text("state").notNull().default("PENDING"),
    createdAt: createdAt(),
    settledAt: tsz("settled_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("notes_command_kind_key").on(t.commandId, t.kind),
    index("notes_case_idx").on(t.caseRef, t.subjectRef),
    check(
      "notes_kind",
      sql`${t.kind} in ('ASSESSMENT_INTERNAL', 'ASSESSMENT_SHARED_FEEDBACK', 'RELEASE_REQUEST_NOTE', 'RELEASE_SERVICING_REF', 'RELEASE_QUESTION', 'RELEASE_RESPONSE')`,
    ),
    check("notes_audience", sql`(${t.kind} = 'ASSESSMENT_INTERNAL') = (${t.audience} = 'ORG_ONLY') and ${t.audience} in ('ORG_ONLY', 'CASE_COUNTERPARTIES')`),
    check("notes_state", sql`${t.state} in ('PENDING', 'ATTACHED', 'DISCARDED')`),
    check("notes_body_length", sql`char_length(${t.body}) <= 4000`),
  ],
);

// --- Ledger projections (written by the worker) ----------------------------------------------------

/** One row per participant source the worker reads (/v2/updates), with its durable checkpoint. */
export const ledgerSources = pgTable("ledger_sources", {
  /** Participant alias, e.g. "sandbox". */
  source: text("source").primaryKey(),
  participantId: text("participant_id").notNull(),
  jsonApiUrl: text("json_api_url").notNull(),
  /** Last fully applied offset (exclusive start for the next read). */
  checkpointOffset: offset("checkpoint_offset").notNull().default(0),
  lastUpdateId: text("last_update_id"),
  lastAppliedAt: tsz("last_applied_at"),
  /** Ledger end observed at the last poll; < checkpoint means the ledger was reset. */
  ledgerEndSeen: offset("ledger_end_seen"),
  /** ACTIVE | RESET_DETECTED | PAUSED. A reset source is never mixed with a new history. */
  status: text("status").notNull().default("ACTIVE"),
  resetDetectedAt: tsz("reset_detected_at"),
  resetReason: text("reset_reason"),
  /**
   * Sorted parties the projection reads as (set on the first pass). A different party set would mix two
   * histories (contracts created before a party was added are missing), so a change is treated as a reset.
   */
  partyFilter: text("party_filter").array(),
  /** Ledger user the projection reads with (e.g. projector-svc). */
  ledgerUserId: text("ledger_user_id"),
  /** Last pass that reached the ledger end without error. */
  lastPolledAt: tsz("last_polled_at"),
  lastError: text("last_error"),
  lastErrorAt: tsz("last_error_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * One row per applied transaction (including those without Collara events), written in the same database
 * transaction as its events and the checkpoint. Command records are matched to it by update id, so a command
 * committed after the worker already applied its update still becomes PROJECTED.
 */
export const ledgerUpdates = pgTable(
  "ledger_updates",
  {
    source: text("source")
      .notNull()
      .references(() => ledgerSources.source),
    updateId: text("update_id").notNull(),
    offset: offset("offset").notNull(),
    /** Empty for non-submitting readers (the projector never submits). */
    commandId: text("command_id"),
    workflowId: text("workflow_id"),
    effectiveAt: tsz("effective_at").notNull(),
    recordTime: tsz("record_time"),
    /** Events kept (Collara and governance packages) / events received. */
    projectedEvents: integer("projected_events").notNull(),
    totalEvents: integer("total_events").notNull(),
    appliedAt: tsz("applied_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "ledger_updates_pk", columns: [t.source, t.updateId] }),
    uniqueIndex("ledger_updates_offset_key").on(t.source, t.offset),
    index("ledger_updates_update_idx").on(t.updateId),
  ],
);

/** Contracts as seen by the projector, with the parties allowed to see them (witness filtering). */
export const ledgerContracts = pgTable(
  "ledger_contracts",
  {
    source: text("source")
      .notNull()
      .references(() => ledgerSources.source),
    contractId: text("contract_id").notNull(),
    /** Package-id form as served: "<pkgId>:Module:Template". */
    templateId: text("template_id").notNull(),
    /** Package-name form: "#collara-contracts:Module:Template" (use this for queries). */
    templateRef: text("template_ref").notNull(),
    packageName: text("package_name").notNull(),
    payload: jsonb("payload").notNull(),
    signatories: text("signatories").array().notNull(),
    observers: text("observers").array().notNull().default(sql`'{}'::text[]`),
    witnessParties: text("witness_parties").array().notNull(),
    /**
     * signatories ∪ observers. Read models filter on this (stakeholder membership), never on witness
     * parties, so a party that only witnessed a contract through divulgence or a fetch does not see it.
     */
    stakeholders: text("stakeholders")
      .array()
      .notNull()
      .generatedAlwaysAs(sql`signatories || observers`),
    /** Business reference extracted at projection time (requestRef, attestationRef, lockRef, …). */
    businessRef: text("business_ref"),
    caseRef: text("case_ref"),
    assetRef: text("asset_ref"),
    createdUpdateId: text("created_update_id").notNull(),
    createdOffset: offset("created_offset").notNull(),
    createdNodeId: integer("created_node_id").notNull(),
    /** Ledger effective time of the creating transaction. */
    createdAt: tsz("created_at").notNull(),
    archivedUpdateId: text("archived_update_id"),
    archivedOffset: offset("archived_offset"),
    archivedAt: tsz("archived_at"),
    /** The consuming choice that archived the contract (null for a plain ACS_DELTA archive). */
    archivedChoice: text("archived_choice"),
    archivedNodeId: integer("archived_node_id"),
  },
  (t) => [
    primaryKey({ name: "ledger_contracts_pk", columns: [t.source, t.contractId] }),
    index("ledger_contracts_template_idx").on(t.templateRef, t.archivedOffset),
    index("ledger_contracts_witness_gin").using("gin", t.witnessParties),
    index("ledger_contracts_stakeholders_gin").using("gin", t.stakeholders),
    index("ledger_contracts_case_idx").on(t.caseRef),
    index("ledger_contracts_asset_idx").on(t.assetRef),
    index("ledger_contracts_business_ref_idx").on(t.templateRef, t.businessRef),
  ],
);

/** Every projected event node, applied idempotently by (source, update_id, node_id). */
export const ledgerEvents = pgTable(
  "ledger_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source")
      .notNull()
      .references(() => ledgerSources.source),
    updateId: text("update_id").notNull(),
    offset: offset("offset").notNull(),
    nodeId: integer("node_id").notNull(),
    /** created | archived | exercised */
    kind: text("kind").notNull(),
    contractId: text("contract_id").notNull(),
    templateId: text("template_id").notNull(),
    templateRef: text("template_ref").notNull(),
    choice: text("choice"),
    consuming: boolean("consuming"),
    actingParties: text("acting_parties").array().notNull().default(sql`'{}'::text[]`),
    witnessParties: text("witness_parties").array().notNull(),
    /** Empty for non-submitting stakeholders; correlate by update id. */
    commandId: text("command_id"),
    effectiveAt: tsz("effective_at").notNull(),
    recordTime: tsz("record_time"),
    /** Choice argument / result where the projection needs it. */
    detail: jsonb("detail"),
    projectedAt: tsz("projected_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_events_node_key").on(t.source, t.updateId, t.nodeId),
    index("ledger_events_offset_idx").on(t.source, t.offset),
    index("ledger_events_contract_idx").on(t.contractId),
    index("ledger_events_witness_gin").using("gin", t.witnessParties),
  ],
);

// --- Audit, exports, notifications -----------------------------------------------------------------

/**
 * Application-level (operational) audit trail: uploads, downloads, logins, denials. Never evidence of a
 * workflow state change; committed workflow events come from ledger_events.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: tsz("occurred_at").notNull().defaultNow(),
    actorUserId: text("actor_user_id").references(() => users.id),
    orgId: text("org_id").references(() => organizations.id),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceRef: text("resource_ref"),
    /** SUCCEEDED | DENIED | FAILED */
    outcome: text("outcome").notNull(),
    requestId: text("request_id"),
    /** Redacted detail; never document contents, terms or credentials. */
    detail: jsonb("detail"),
  },
  (t) => [index("audit_events_resource_idx").on(t.resourceRef), index("audit_events_org_idx").on(t.orgId, t.occurredAt)],
);

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportRef: text("report_ref").notNull(),
    caseRef: text("case_ref").notNull(),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => users.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    format: text("format").notNull().default("JSON"),
    /** Access scope at request time (e.g. audit scopes); re-checked at generation and download. */
    scope: jsonb("scope").notNull(),
    /** ExportJobState: QUEUED | GENERATING | READY | EXPIRED | FAILED. */
    state: text("state").notNull().default("QUEUED"),
    cutoffOffset: offset("cutoff_offset"),
    /** Sync watermark per source at generation, e.g. { sandbox: { offset, at } }. */
    watermark: jsonb("watermark"),
    schemaVersion: text("schema_version").notNull(),
    checksumSha256: text("checksum_sha256"),
    storageKey: text("storage_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    /** Worker lease: the job is GENERATING under this worker until lease_expires_at (then it can be re-claimed). */
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: tsz("lease_expires_at"),
    requestedAt: tsz("requested_at").notNull().defaultNow(),
    generatedAt: tsz("generated_at"),
    expiresAt: tsz("expires_at"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("export_jobs_ref_key").on(t.reportRef), index("export_jobs_state_idx").on(t.state), index("export_jobs_case_idx").on(t.caseRef)],
);

/** Generic event + authenticated link only: no serial, borrower, principal, filename or terms (S L1114). */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientUserId: text("recipient_user_id").references(() => users.id, { onDelete: "cascade" }),
    recipientOrgId: text("recipient_org_id")
      .notNull()
      .references(() => organizations.id),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type"),
    resourceRef: text("resource_ref"),
    linkPath: text("link_path").notNull(),
    createdAt: createdAt(),
    readAt: tsz("read_at"),
  },
  (t) => [index("notifications_recipient_idx").on(t.recipientOrgId, t.recipientUserId, t.createdAt)],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type MandateRow = typeof mandates.$inferSelect;
export type PartyBindingRow = typeof partyBindings.$inferSelect;
export type LedgerUserRow = typeof ledgerUsers.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type PilotRequestRow = typeof pilotRequests.$inferSelect;
export type CaseRow = typeof cases.$inferSelect;
export type EvidenceDocumentRow = typeof evidenceDocuments.$inferSelect;
export type CommandRow = typeof commands.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type LedgerSourceRow = typeof ledgerSources.$inferSelect;
export type LedgerContractRow = typeof ledgerContracts.$inferSelect;
export type LedgerEventRow = typeof ledgerEvents.$inferSelect;
export type LedgerUpdateRow = typeof ledgerUpdates.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type ExportJobRow = typeof exportJobs.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
