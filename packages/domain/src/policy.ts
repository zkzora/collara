// Canonical permission matrix (synthesis §1.4.1) as typed data, plus `can(actor, action, ctx)`.
// The same rows drive API enforcement, the UI_MOCK client and the Docs page matrix, so they
// cannot silently diverge (CR-21). Cell texts are verbatim from the synthesis table.
import {
  AUDIT_SCOPES,
  AUDIT_SCOPE_OWNERS,
  type AssetFacts,
  type AuditScope,
  type CaseFacts,
} from "./facts";
import { governanceSeatOf, hasMandate, type Actor, type OrgId, type Role } from "./roles";

export const POLICY_COLUMNS = [
  "BORROWER",
  "DEALER",
  "VERIFIER",
  "LENDER_ANALYST",
  "LENDER_APPROVER",
  "UNRELATED_LENDER",
  "AUDITOR",
  "ORG_ADMIN",
  "OPERATOR",
  "GOVERNANCE_MEMBER",
] as const;
export type PolicyColumn = (typeof POLICY_COLUMNS)[number];

export const POLICY_COLUMN_LABELS: Readonly<Record<PolicyColumn, string>> = {
  BORROWER: "Borrower",
  DEALER: "Dealer",
  VERIFIER: "Verifier",
  LENDER_ANALYST: "L. Analyst",
  LENDER_APPROVER: "L. Approver",
  UNRELATED_LENDER: "Lender B (unrelated)",
  AUDITOR: "Auditor",
  ORG_ADMIN: "Org Admin",
  OPERATOR: "Operator / Registrar",
  GOVERNANCE_MEMBER: "Gov member",
};

/**
 * How a permitted cell is checked against the resource context.
 * `unsupported` = specified but not implemented in the MVP (delegation, operator views, …): denied.
 */
export type Requirement =
  | "any"
  | "owner"
  | "invitedDealer"
  | "assignedVerifier"
  | "activeAssignedVerifier"
  | "selectedLender"
  | "designatedLender"
  | "auditGrant"
  | "auditExport"
  | "ownOrg"
  | "seat"
  | "unsupported";

export interface PolicyCell {
  /** Verbatim matrix text ("—" for no access). */
  readonly text: string;
  /** null = no access. */
  readonly requirement: Requirement | null;
}

export interface PolicyRow {
  readonly action: PolicyAction;
  readonly label: string;
  /** Audit scope an auditor's grant must cover (ANY = any active grant). */
  readonly auditScope?: AuditScope | "ANY";
  /** Rows not in the synthesis §1.4.1 table carry their source. */
  readonly source?: string;
  readonly cells: Readonly<Record<PolicyColumn, PolicyCell>>;
}

export const POLICY_ACTIONS = [
  "equipment.view",
  "evidence.view",
  "attestation.view",
  "lenderInternal.view",
  "terms.view",
  "passport.register",
  "evidence.upload",
  "verification.request",
  "verification.perform",
  "sharing.approve",
  "review.assess",
  "review.submitForApproval",
  "review.decide",
  "proposal.draft",
  "proposal.issue",
  "proposal.respond",
  "activation.authorize",
  "pledge.activate",
  "release.request",
  "release.decide",
  "auditGrant.create",
  "history.view",
  "report.export",
  "governance.act",
  "members.manage",
] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

const NO: PolicyCell = { text: "—", requirement: null };

function row(
  action: PolicyAction,
  label: string,
  cells: Partial<Record<PolicyColumn, readonly [text: string, requirement: Requirement | null]>>,
  extra: { auditScope?: AuditScope | "ANY"; source?: string } = {},
): PolicyRow {
  const full = Object.fromEntries(
    POLICY_COLUMNS.map((column) => {
      const cell = cells[column];
      return [column, cell ? { text: cell[0], requirement: cell[1] } : NO];
    }),
  ) as Record<PolicyColumn, PolicyCell>;
  return { action, label, cells: full, ...extra };
}

export const PERMISSION_MATRIX: readonly PolicyRow[] = [
  row(
    "equipment.view",
    "Equipment identity",
    {
      BORROWER: ["Own", "owner"],
      DEALER: ["Scoped (invited case)", "invitedDealer"],
      VERIFIER: ["Scoped (assignment)", "assignedVerifier"],
      LENDER_ANALYST: ["Shared case", "selectedLender"],
      LENDER_APPROVER: ["Shared case", "selectedLender"],
      AUDITOR: ["Granted", "auditGrant"],
      ORG_ADMIN: ["Own-org members only, no financials", "unsupported"],
      OPERATOR: ["Minimal registry scope", "unsupported"],
    },
    { auditScope: "ANY" },
  ),
  row(
    "evidence.view",
    "Evidence document metadata + bytes (title, filename, URL, thumbnail all need permission)",
    {
      BORROWER: ["Own / authorized", "owner"],
      DEALER: ["Own contribution + granted", "invitedDealer"],
      VERIFIER: ["Assigned scope", "assignedVerifier"],
      LENDER_ANALYST: ["Shared package", "selectedLender"],
      LENDER_APPROVER: ["Shared package", "selectedLender"],
      AUDITOR: ["Granted", "auditGrant"],
      ORG_ADMIN: ["Not automatic", null],
      OPERATOR: ["Not automatic; hosting model documented", null],
    },
    { auditScope: "EVIDENCE_MANIFEST" },
  ),
  row(
    "attestation.view",
    "Attestation",
    {
      BORROWER: ["Case/asset scope", "owner"],
      DEALER: ["If granted", "unsupported"],
      VERIFIER: ["Issued / assigned", "assignedVerifier"],
      LENDER_ANALYST: ["Shared case", "selectedLender"],
      LENDER_APPROVER: ["Shared case", "selectedLender"],
      AUDITOR: ["Granted", "auditGrant"],
      OPERATOR: ["Minimal registry status", "unsupported"],
    },
    { auditScope: "ATTESTATION" },
  ),
  row("lenderInternal.view", "Internal lender notes, internal risk view", {
    LENDER_ANALYST: ["Own org", "selectedLender"],
    LENDER_APPROVER: ["Own org", "selectedLender"],
    AUDITOR: ["Separate explicit grant", "unsupported"],
  }),
  row(
    "terms.view",
    "Loan terms (proposal, agreement, principal)",
    {
      BORROWER: ["Own agreement", "owner"],
      LENDER_ANALYST: ["Own case", "selectedLender"],
      LENDER_APPROVER: ["Own case", "selectedLender"],
      AUDITOR: ["Separate explicit grant", "auditGrant"],
    },
    { auditScope: "PROPOSAL_TERMS" },
  ),
  row("passport.register", "Register passport / request registration", {
    BORROWER: ["✓ (owner mandate)", "any"],
    DEALER: ["Only as owner's delegate", "unsupported"],
    LENDER_ANALYST: ["Only as approved delegate", "unsupported"],
    LENDER_APPROVER: ["Only as approved delegate", "unsupported"],
    OPERATOR: ["Approves issuance (no impersonation)", "unsupported"],
  }),
  row(
    "evidence.upload",
    "Upload evidence documents",
    {
      BORROWER: ["✓ (own asset)", "owner"],
      DEALER: ["Own contribution (invited case)", "invitedDealer"],
    },
    { source: "S §3 roles (Dealer: add invoice, specs, photos to an invited case)" },
  ),
  row("verification.request", "Request verification, assign verifier", { BORROWER: ["✓", "owner"] }),
  row("verification.perform", "Accept assignment, request changes, issue or reject attestation", {
    VERIFIER: ["Active assigned verifier", "activeAssignedVerifier"],
  }),
  row("sharing.approve", "Approve sharing of a package", {
    BORROWER: ["✓ (record owner)", "owner"],
    DEALER: ["Consent for own records", "invitedDealer"],
  }),
  row("review.assess", "Open shared evidence, record assessment", {
    LENDER_ANALYST: ["✓", "selectedLender"],
    LENDER_APPROVER: ["✓", "selectedLender"],
  }),
  row("review.submitForApproval", "Submit assessment for approval", {
    LENDER_ANALYST: ["✓", "selectedLender"],
    LENDER_APPROVER: ["✓", "selectedLender"],
  }),
  row("review.decide", "Record collateral decision (eligible / rejected)", {
    LENDER_APPROVER: ["✓", "selectedLender"],
  }),
  row("proposal.draft", "Draft proposal", {
    LENDER_ANALYST: ["✓", "selectedLender"],
    LENDER_APPROVER: ["✓", "selectedLender"],
  }),
  row("proposal.issue", "Issue / withdraw proposal (withdraw only before acceptance)", {
    LENDER_APPROVER: ["✓", "selectedLender"],
  }),
  row("proposal.respond", "Accept / decline proposal (exact version)", { BORROWER: ["✓", "owner"] }),
  row("activation.authorize", "Authorize pledge activation (borrower side)", { BORROWER: ["✓", "owner"] }),
  row("pledge.activate", "Activate pledge (consume control)", { LENDER_APPROVER: ["✓", "selectedLender"] }),
  row("release.request", "Request release", {
    BORROWER: ["✓ own case", "owner"],
    LENDER_APPROVER: ["✓ (authorized case role; API-permitted, UI P1)", "designatedLender"],
  }),
  row("release.decide", "Authorize / reject / request info on release", {
    LENDER_APPROVER: ["Designated lender approver only", "designatedLender"],
    GOVERNANCE_MEMBER: ["Never", null],
  }),
  row("auditGrant.create", "Grant audit access", {
    BORROWER: ["✓ (own records)", "owner"],
    LENDER_APPROVER: ["✓ (own records)", "selectedLender"],
  }),
  row(
    "history.view",
    "View case history",
    {
      BORROWER: ["Scoped", "owner"],
      DEALER: ["Scoped", "invitedDealer"],
      VERIFIER: ["Scoped", "assignedVerifier"],
      LENDER_ANALYST: ["Scoped", "selectedLender"],
      LENDER_APPROVER: ["Scoped", "selectedLender"],
      AUDITOR: ["Scoped", "auditGrant"],
      OPERATOR: ["Operational subset", "unsupported"],
    },
    { auditScope: "ANY" },
  ),
  row("report.export", "Export case report", {
    BORROWER: ["Own scope", "owner"],
    DEALER: ["Granted subset", "invitedDealer"],
    VERIFIER: ["Assigned subset", "assignedVerifier"],
    LENDER_ANALYST: ["Own scope", "selectedLender"],
    LENDER_APPROVER: ["Own scope", "selectedLender"],
    AUDITOR: ["Granted subset", "auditExport"],
    OPERATOR: ["Operational subset", "unsupported"],
  }),
  row("governance.act", "Propose / confirm / execute Add or Suspend verifier", {
    OPERATOR: ["Optional additional proposer only", "unsupported"],
    GOVERNANCE_MEMBER: ["✓ (seat mandate)", "seat"],
  }),
  row("members.manage", "Manage members and mandates", { ORG_ADMIN: ["Own org", "ownOrg"] }),
];

const ROW_BY_ACTION = new Map(PERMISSION_MATRIX.map((r) => [r.action, r]));

export function policyRow(action: PolicyAction): PolicyRow {
  const found = ROW_BY_ACTION.get(action);
  if (!found) throw new Error(`Unknown policy action: ${action}`);
  return found;
}

// --- Resource context ---------------------------------------------------------------------------

export interface EffectiveAuditAccess {
  readonly scopes: readonly AuditScope[];
  readonly canExport: boolean;
  readonly expiresAt: string | null;
}

/** Relations between organizations and one resource, derived server-side from facts. */
export interface PolicyContext {
  readonly ownerOrgIds?: readonly OrgId[];
  readonly dealerOrgIds?: readonly OrgId[];
  readonly verifierOrgIds?: readonly OrgId[];
  /** Assigned verifiers whose registry entry is ACTIVE (re-checked at commit, S L643). */
  readonly activeVerifierOrgIds?: readonly OrgId[];
  /** Selected lenders that received the package (an invitation alone shares nothing). */
  readonly lenderOrgIds?: readonly OrgId[];
  /** Lender named on an active or historical lock. */
  readonly designatedLenderOrgIds?: readonly OrgId[];
  readonly auditAccess?: Readonly<Record<OrgId, EffectiveAuditAccess>>;
  /** For org-level actions (members). */
  readonly subjectOrgId?: OrgId;
}

const ROLE_COLUMN: Readonly<Record<Role, PolicyColumn>> = {
  BORROWER: "BORROWER",
  DEALER: "DEALER",
  VERIFIER: "VERIFIER",
  LENDER_ANALYST: "LENDER_ANALYST",
  LENDER_APPROVER: "LENDER_APPROVER",
  AUDITOR: "AUDITOR",
  ORG_ADMIN: "ORG_ADMIN",
  OPERATOR: "OPERATOR",
  GOVERNANCE_MEMBER: "GOVERNANCE_MEMBER",
};

/** Mandates are checked in addition to roles (analyst vs approver is a mandate inside one org). */
function mandateSatisfied(actor: Actor, column: PolicyColumn): boolean {
  switch (column) {
    case "BORROWER":
      return hasMandate(actor, "BORROWER");
    case "LENDER_ANALYST":
      return hasMandate(actor, "ANALYST") || hasMandate(actor, "APPROVER");
    case "LENDER_APPROVER":
      return hasMandate(actor, "APPROVER");
    case "ORG_ADMIN":
      return hasMandate(actor, "ORG_ADMIN");
    case "GOVERNANCE_MEMBER":
      return governanceSeatOf(actor) !== null;
    default:
      return true;
  }
}

function includes(list: readonly OrgId[] | undefined, orgId: OrgId): boolean {
  return list?.includes(orgId) ?? false;
}

function requirementMet(requirement: Requirement, row: PolicyRow, actor: Actor, ctx: PolicyContext): boolean {
  const audit = ctx.auditAccess?.[actor.orgId];
  switch (requirement) {
    case "any":
      return true;
    case "owner":
      return includes(ctx.ownerOrgIds, actor.orgId);
    case "invitedDealer":
      return includes(ctx.dealerOrgIds, actor.orgId);
    case "assignedVerifier":
      return includes(ctx.verifierOrgIds, actor.orgId);
    case "activeAssignedVerifier":
      return includes(ctx.verifierOrgIds, actor.orgId) && includes(ctx.activeVerifierOrgIds, actor.orgId);
    case "selectedLender":
      return includes(ctx.lenderOrgIds, actor.orgId);
    case "designatedLender":
      return includes(ctx.designatedLenderOrgIds, actor.orgId);
    case "auditGrant": {
      if (!audit || audit.scopes.length === 0) return false;
      const scope = row.auditScope ?? "ANY";
      return scope === "ANY" || audit.scopes.includes(scope);
    }
    case "auditExport":
      return !!audit && audit.canExport && audit.scopes.length > 0;
    case "ownOrg":
      return ctx.subjectOrgId === actor.orgId;
    case "seat":
      return governanceSeatOf(actor) !== null;
    case "unsupported":
      return false;
  }
}

export interface PolicyDecision {
  readonly allowed: boolean;
  /** The matrix column that granted access. */
  readonly column: PolicyColumn | null;
  readonly cell: PolicyCell | null;
}

export function explain(actor: Actor, action: PolicyAction, ctx: PolicyContext = {}): PolicyDecision {
  const r = policyRow(action);
  for (const role of actor.roles) {
    const column = ROLE_COLUMN[role];
    const cell = r.cells[column];
    if (!cell.requirement || !mandateSatisfied(actor, column)) continue;
    if (requirementMet(cell.requirement, r, actor, ctx)) return { allowed: true, column, cell };
  }
  return { allowed: false, column: null, cell: null };
}

export function can(actor: Actor, action: PolicyAction, ctx: PolicyContext = {}): boolean {
  return explain(actor, action, ctx).allowed;
}

// --- Contexts from facts -------------------------------------------------------------------------

function isActiveAt(expiresAt: string | null, revokedAt: string | null, now: Date): boolean {
  return !revokedAt && (expiresAt === null || Date.parse(expiresAt) > now.getTime());
}

/** Auditor access per auditor org. A scope counts only when every record owner granted it. */
export function effectiveAuditAccess(facts: CaseFacts, now: Date): Record<OrgId, EffectiveAuditAccess> {
  const active = facts.auditGrants.filter((g) => isActiveAt(g.expiresAt, g.revokedAt, now));
  const result: Record<OrgId, EffectiveAuditAccess> = {};
  for (const auditorOrgId of new Set(active.map((g) => g.auditorOrgId))) {
    const grants = active.filter((g) => g.auditorOrgId === auditorOrgId);
    const sideGrants = (side: "OWNER" | "LENDER") =>
      grants.filter((g) =>
        side === "OWNER"
          ? g.grantorSide === "OWNER" && g.grantorOrgId === facts.borrowerOrgId
          : g.grantorSide === "LENDER" && g.grantorOrgId === facts.selectedLenderOrgId,
      );
    const scopes = AUDIT_SCOPES.filter((scope) =>
      AUDIT_SCOPE_OWNERS[scope].every((side) => sideGrants(side).some((g) => g.scopes.includes(scope))),
    );
    const canExport =
      scopes.length > 0 &&
      scopes.every((scope) =>
        AUDIT_SCOPE_OWNERS[scope].every((side) =>
          sideGrants(side).some((g) => g.scopes.includes(scope) && g.permission === "VIEW_EXPORT"),
        ),
      );
    const expiries = grants.map((g) => g.expiresAt).sort();
    result[auditorOrgId] = { scopes, canExport, expiresAt: expiries[0] ?? null };
  }
  return result;
}

/** True once the package was shared with the selected lender (revocation limits future documents only). */
export function lenderHasCaseAccess(facts: CaseFacts): boolean {
  return (
    facts.selectedLenderOrgId !== null &&
    facts.shares.some(
      (s) => s.recipientOrgId === facts.selectedLenderOrgId && ["GRANTED", "REVOKED", "EXPIRED"].includes(s.state),
    )
  );
}

export interface ContextOptions {
  /** Registry status lookup (VER-001 → active?). Defaults to treating every verifier as active. */
  readonly isVerifierActive?: (verifierRegistryRef: string) => boolean;
}

export function caseContext(facts: CaseFacts, now: Date, options: ContextOptions = {}): PolicyContext {
  const isActive = options.isVerifierActive ?? (() => true);
  const caseVerifications = facts.asset.verifications.filter(
    (v) => v.caseRef === facts.ref && v.state !== "DECLINED" && v.state !== "CANCELLED",
  );
  return {
    ownerOrgIds: [facts.borrowerOrgId],
    dealerOrgIds: facts.dealerOrgId ? [facts.dealerOrgId] : [],
    verifierOrgIds: caseVerifications.map((v) => v.verifierOrgId),
    activeVerifierOrgIds: caseVerifications.filter((v) => isActive(v.verifierRegistryRef)).map((v) => v.verifierOrgId),
    lenderOrgIds: lenderHasCaseAccess(facts) && facts.selectedLenderOrgId ? [facts.selectedLenderOrgId] : [],
    designatedLenderOrgIds: facts.lock ? [facts.lock.lenderOrgId] : [],
    auditAccess: effectiveAuditAccess(facts, now),
  };
}

/** Asset (passport) context: union over the asset's own verifications and the cases that use it. */
export function assetContext(
  asset: AssetFacts,
  cases: readonly CaseFacts[],
  now: Date,
  options: ContextOptions = {},
): PolicyContext {
  const isActive = options.isVerifierActive ?? (() => true);
  const verifications = asset.verifications.filter((v) => v.state !== "DECLINED" && v.state !== "CANCELLED");
  const related = cases.filter((c) => c.asset.ref === asset.ref);
  const caseContexts = related.map((c) => caseContext(c, now, options));
  const auditAccess: Record<OrgId, EffectiveAuditAccess> = {};
  for (const ctx of caseContexts) {
    for (const [orgId, access] of Object.entries(ctx.auditAccess ?? {})) {
      const prev = auditAccess[orgId];
      auditAccess[orgId] = prev
        ? {
            scopes: [...new Set([...prev.scopes, ...access.scopes])],
            canExport: prev.canExport || access.canExport,
            expiresAt: prev.expiresAt,
          }
        : access;
    }
  }
  return {
    ownerOrgIds: [asset.ownerOrgId],
    dealerOrgIds: caseContexts.flatMap((c) => c.dealerOrgIds ?? []),
    verifierOrgIds: verifications.map((v) => v.verifierOrgId),
    activeVerifierOrgIds: verifications.filter((v) => isActive(v.verifierRegistryRef)).map((v) => v.verifierOrgId),
    lenderOrgIds: caseContexts.flatMap((c) => c.lenderOrgIds ?? []),
    designatedLenderOrgIds: caseContexts.flatMap((c) => c.designatedLenderOrgIds ?? []),
    auditAccess,
  };
}

/** Whether the actor's organization is related to the resource at all. Unrelated parties get 404s. */
export function isRelated(actor: Actor, ctx: PolicyContext): boolean {
  return can(actor, "equipment.view", ctx) || can(actor, "history.view", ctx);
}

// --- Docs view -----------------------------------------------------------------------------------

export type CellAccess = "ALLOWED" | "SCOPED" | "DENIED";

export interface PermissionMatrixView {
  readonly columns: readonly { key: PolicyColumn; label: string }[];
  readonly rows: readonly {
    action: PolicyAction;
    label: string;
    source: string | null;
    cells: readonly {
      column: PolicyColumn;
      text: string;
      access: CellAccess;
      /** False when the cell is specified but not enforced in the MVP (treated as denied). */
      enforced: boolean;
    }[];
  }[];
}

/** The matrix as rendered on /docs#roles, from the same typed source the API tests use. */
export function permissionMatrixView(): PermissionMatrixView {
  return {
    columns: POLICY_COLUMNS.map((key) => ({ key, label: POLICY_COLUMN_LABELS[key] })),
    rows: PERMISSION_MATRIX.map((r) => ({
      action: r.action,
      label: r.label,
      source: r.source ?? null,
      cells: POLICY_COLUMNS.map((column) => {
        const cell = r.cells[column];
        const access: CellAccess = cell.requirement === null ? "DENIED" : cell.text.startsWith("✓") ? "ALLOWED" : "SCOPED";
        return { column, text: cell.text, access, enforced: cell.requirement !== null && cell.requirement !== "unsupported" };
      }),
    })),
  };
}
