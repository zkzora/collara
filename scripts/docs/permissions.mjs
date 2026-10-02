#!/usr/bin/env node
// Generates docs/permissions.md from the typed policy data in @collara/domain (permission matrix, personas,
// mandates, audit scopes, event audiences), the presenters' disclosure rules evaluated on the synthetic CL-001
// fixture, and scripts/localnet/localnet.config.json (ledger users). The output is deterministic: no
// timestamps, fixed fixture clock, source order preserved.
//
// The domain package exports TypeScript source, so run it with tsx (tsx is a dependency of @collara/api):
//   pnpm --filter @collara/api exec tsx ../../scripts/docs/permissions.mjs           # write docs/permissions.md
//   pnpm --filter @collara/api exec tsx ../../scripts/docs/permissions.mjs --check   # exit 1 if the file is stale
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AUDIT_SCOPE_LABELS,
  AUDIT_SCOPE_OWNERS,
  AUDIT_SCOPES,
  CASE_ACTIONS,
  DEMO_ORGANIZATIONS,
  DEMO_PERSONAS,
  ERROR_COPY,
  EVENT_TYPES,
  MANDATE_LABELS,
  PERMISSION_MATRIX,
  PERSONA_IDS,
  POLICY_COLUMN_LABELS,
  POLICY_COLUMNS,
  PROTOTYPE_NOW,
  ROLE_LABELS,
  ROLES,
  allowedCaseActions,
  buildScenario,
  caseDisclosure,
  permissionMatrixView,
  personaActor,
  presentCaseDetail,
} from "../../packages/domain/src/index.ts";

const ROOT = new URL("../../", import.meta.url);
const TARGET = fileURLToPath(new URL("docs/permissions.md", ROOT));
const LOCALNET_CONFIG = JSON.parse(readFileSync(new URL("scripts/localnet/localnet.config.json", ROOT), "utf8"));

// --- Descriptions transcribed from packages/domain/src/policy.ts (requirementMet, mandateSatisfied) --------
// A requirement or disclosure flag that is missing here fails the run, so the doc cannot silently drift.

const REQUIREMENTS = {
  any: "Always, once the role and mandate match.",
  owner: "The actor's organization owns the asset / is the case borrower.",
  invitedDealer: "The actor's organization is the dealer invited to the case.",
  assignedVerifier: "The actor's organization is the verifier of a (non-declined, non-cancelled) verification request of the case or asset.",
  activeAssignedVerifier: "As `assignedVerifier`, and the verifier's registry entry is ACTIVE (re-checked by the ledger at commit).",
  selectedLender: "The actor's organization is the selected lender **and** the package was shared with it (an invitation alone shares nothing).",
  designatedLender: "The actor's organization is the lender named on the active or historical lock.",
  auditGrant: "An active, unexpired audit grant covers the row's audit scope, granted by every record owner of that scope.",
  auditExport: "As `auditGrant` with `VIEW_EXPORT` permission on every effective scope.",
  ownOrg: "The subject is the actor's own organization.",
  seat: "The actor holds a governance seat mandate (seat 1, 2 or 3).",
  unsupported: "Specified, **not implemented** in the MVP: denied.",
};

const MANDATE_CHECKS = {
  BORROWER: "`BORROWER` mandate",
  LENDER_ANALYST: "`ANALYST` or `APPROVER` mandate",
  LENDER_APPROVER: "`APPROVER` mandate",
  ORG_ADMIN: "`ORG_ADMIN` mandate",
  GOVERNANCE_MEMBER: "a `GOVERNANCE_SEAT` mandate (seat 1–3)",
};

// Disclosure flags of `caseDisclosure()` and the response fields each one gates (packages/domain/src/presenters.ts).
const DISCLOSURE_FLAGS = {
  related: "Anything at all. False → every case endpoint answers the 404-shaped `unavailable` problem; lists and counts skip the case.",
  isOwner: "Borrower view: blockers, prerequisites, technical refs, review approver/feedback, release and activation actions.",
  isDealer: "Dealer view: own documents only (evidence list, downloads), own consents in access grants.",
  isVerifier: "Verifier view: documents of its own verification scope; verification-scope access grants.",
  isLender: "Selected-lender view: `review.assessment`, `review.analyst`, `review.evidenceSnapshot`, `review.derived`, draft proposals, technical refs.",
  equipment: "`borrower` organization on case summaries (`equipment.view`).",
  evidence: "Evidence tab and the viewer's visible documents (`evidence.view`).",
  packageVisible: "Whole-package fields: `statuses.evidence`, `references.package`, asset `evidence` summary and the package-derived early stages (owner, selected lender, auditor with `EVIDENCE_MANIFEST`; a dealer or verifier sees only its slice).",
  attestation: "Verification tab, `statuses.attestation`, `references.attestation`, verifier participants (`attestation.view`).",
  internalNotes: "`review.internalNotes` (selected lender's own organization only).",
  terms: "Proposal tab, `requestedPrincipal`, `statuses.proposal`, `references.proposal`, `pledge.principalRef` (`terms.view`).",
  history: "Activity tab and case events (`history.view`).",
  export: "Case report export (`report.export`).",
  selectedLender: "`selectedLender` organization and its participant row.",
  review: "Review tab, `review` status (borrower, selected lender, or an auditor with `DECISION_OUTCOME`).",
  pledge: "Pledge tab, `pledge` status and `references.pledge` (borrower, selected lender, or an auditor with `PLEDGE_RELEASE_EVENTS`).",
  technical: "`technical` (control version, package version, namespace) for ledger stakeholders: borrower and selected lender.",
};

// --- Helpers -------------------------------------------------------------------------------------------------

const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const code = (text) => `\`${text}\``;
const table = (header, rows) =>
  [`| ${header.map(cell).join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const yes = (flag) => (flag ? "yes" : "—");

function assertCovered(name, known, used) {
  const missing = [...new Set(used)].filter((key) => !(key in known));
  if (missing.length) throw new Error(`${name}: no description for ${missing.join(", ")}; update scripts/docs/permissions.mjs`);
}

// --- Data ----------------------------------------------------------------------------------------------------

const usedRequirements = PERMISSION_MATRIX.flatMap((row) => POLICY_COLUMNS.map((c) => row.cells[c].requirement).filter((r) => r !== null));
assertCovered("requirements", REQUIREMENTS, usedRequirements);

const view = permissionMatrixView();
const now = new Date(PROTOTYPE_NOW);
const pctx = { now, mode: "UI_MOCK", sync: { offset: null, at: null } };
const world = buildScenario({ now, profile: "main", extraRows: false });
const cl001 = world.cases.find((c) => c.ref === "CL-001");
if (!cl001) throw new Error("the main fixture has no CL-001");

// The documented ledger walkthrough's audit grants (daml-model.md §7 W13/W14), added to a copy of CL-001 so the
// auditor's scoped disclosure is visible. Synthetic; dates relative to the fixture clock.
const inDays = (days) => new Date(now.getTime() + days * 86_400_000).toISOString();
const withGrants = {
  ...cl001,
  auditGrants: [
    { ref: "AG-001", grantorOrgId: cl001.borrowerOrgId, grantorSide: "OWNER", grantedByUserId: DEMO_PERSONAS["manufacturer-owner"].userId, auditorOrgId: "demo-auditor", scopes: ["EVIDENCE_MANIFEST", "ATTESTATION"], permission: "VIEW_EXPORT", purpose: "Synthetic audit", createdAt: now.toISOString(), expiresAt: inDays(30), revokedAt: null },
    { ref: "AG-002", grantorOrgId: cl001.selectedLenderOrgId, grantorSide: "LENDER", grantedByUserId: DEMO_PERSONAS["lender-a-approver"].userId, auditorOrgId: "demo-auditor", scopes: ["DECISION_OUTCOME", "PLEDGE_RELEASE_EVENTS"], permission: "VIEW_EXPORT", purpose: "Synthetic audit", createdAt: now.toISOString(), expiresAt: inDays(30), revokedAt: null },
  ],
};

const disclosures = PERSONA_IDS.map((id) => ({ id, d: caseDisclosure(cl001, personaActor(id), pctx) }));
assertCovered("disclosure flags", DISCLOSURE_FLAGS, Object.keys(disclosures[0].d).filter((k) => typeof disclosures[0].d[k] === "boolean"));
const flagNames = Object.keys(DISCLOSURE_FLAGS);
const auditorWithGrants = caseDisclosure(withGrants, personaActor("auditor"), pctx);

const personaLabel = (id) => {
  const p = DEMO_PERSONAS[id];
  return `${p.displayName} (${DEMO_ORGANIZATIONS[p.orgId].name})`;
};

// --- Document --------------------------------------------------------------------------------------------------

const out = [];
const push = (...lines) => out.push(...lines);

push(
  "# Permissions and disclosure",
  "",
  "<!-- Generated by scripts/docs/permissions.mjs from @collara/domain. Do not edit by hand; re-run the script. -->",
  "",
  "Generated from the typed policy data in `packages/domain/src/policy.ts`, `roles.ts`, `facts.ts` and `presenters.ts`, and from `scripts/localnet/localnet.config.json`. The same data drives the API's enforcement (`apps/api/src/plugins/actor.ts`), the UI_MOCK client and the `/docs#roles` matrix, so they cannot diverge silently. All identities are synthetic.",
  "",
  "Regenerate after any policy change:",
  "",
  "```sh",
  "pnpm --filter @collara/api exec tsx ../../scripts/docs/permissions.mjs          # write",
  "pnpm --filter @collara/api exec tsx ../../scripts/docs/permissions.mjs --check  # CI: fail when stale",
  "```",
  "",
  "## 1. Authority chain",
  "",
  "Authority is derived on the server for every request. The browser never supplies a trusted party id, organization or role (headers, query and body values for these are ignored).",
  "",
  "1. **Session.** A server-side session row in PostgreSQL behind an HttpOnly cookie (`collara_sid`, or `__Host-collara_sid` with `COOKIE_SECURE=true`). It is created by the OIDC code flow (`/api/auth/*`) or, in demo environments only, by `POST /api/demo/sessions` (`DEMO_SESSIONS_ENABLED=true`). Tokens never reach the browser.",
  "2. **Membership.** The session's user → its active organization membership and roles (`memberships`).",
  "3. **Mandate.** Roles are refined by mandates inside the organization (`mandates`): analyst vs approver, borrower, org admin, governance seat. The ledger only sees the organization party; mandates are enforced by the API and recorded on choices as an opaque `actorRef`.",
  "4. **Party binding.** The organization's ACTIVE `party_bindings` row (imported from the LocalNet bootstrap state by `pnpm db:bind-localnet`) gives the business party; a seat mandate adds the separate governance-member party and read access to the governance party.",
  "5. **Policy.** `can(actor, action, context)` evaluates the matrix below against a resource context built from projected ledger facts. Unrelated → 404-shaped `unavailable` (" + code(ERROR_COPY.UNAVAILABLE) + "); related but not allowed → 403 `forbidden`.",
  "6. **Ledger.** Commands are submitted as the organization's least-privilege ledger user (`CanActAs` its own party). The Daml model enforces the invariants again on its own (`docs/architecture/daml-model.md`).",
  "",
  "### Ledger users per organization (LocalNet)",
  "",
  "From `scripts/localnet/localnet.config.json`. Party ids are allocated by Canton and change on every sandbox start; they are never hard-coded. `participant` applies only in 3-participant mode.",
  "",
);

const orgByHint = new Map(Object.values(DEMO_ORGANIZATIONS).map((org) => [org.partyHint, org]));
const seatHolders = new Map(
  PERSONA_IDS.flatMap((id) => DEMO_PERSONAS[id].mandates.filter((m) => m.code === "GOVERNANCE_SEAT").map((m) => [m.seat, DEMO_PERSONAS[id]])),
);
push(
  table(
    ["Party hint", "Organization / purpose", "Ledger user", "Rights", "3-participant placement"],
    LOCALNET_CONFIG.parties.map((p) => {
      const seat = /^GovSeat([123])$/.exec(p.hint)?.[1];
      const org = orgByHint.get(p.hint);
      const holder = seat ? seatHolders.get(Number(seat)) : undefined;
      const purpose = org
        ? `${org.name} (business party)`
        : p.hint === "CollaraGovernance"
          ? "Governance party (Tier A: a local party)"
          : holder
            ? `Governance seat ${seat}, held by ${DEMO_ORGANIZATIONS[holder.orgId].name}`
            : "—";
      const rights = ["CanActAs + CanReadAs own party", ...(p.readAs ?? []).map((r) => `CanReadAs ${r}`)].join("; ");
      return [code(p.hint), purpose, code(p.user), rights, p.participant];
    }),
  ),
  "",
  `Service users: ${code(LOCALNET_CONFIG.projectorUser)} (worker projection; \`CanReadAs\` every party hosted on its participant, a privileged read-only operator credential) and ${code(LOCALNET_CONFIG.adminUser)} (\`ParticipantAdmin\`, setup scripts only).`,
  "",
  "### Demo personas",
  "",
  "Synthetic users seeded by `pnpm db:seed` (and the Keycloak realm `infra/keycloak/collara-realm.json`).",
  "",
  table(
    ["Persona id", "User", "Organization", "Roles", "Mandates"],
    PERSONA_IDS.map((id) => {
      const p = DEMO_PERSONAS[id];
      return [code(id), `${p.displayName}${p.title ? `, ${p.title}` : ""} · ${p.email}`, DEMO_ORGANIZATIONS[p.orgId].name, p.roles.map((r) => ROLE_LABELS[r]).join(", "), p.mandates.map((m) => m.label).join(", ") || "—"];
    }),
  ),
  "",
  "## 2. Permission matrix",
  "",
  "Rows are policy actions; columns are matrix columns. A role maps to its column; the column's mandate check must also pass. Cell text is verbatim from the specification; the requirement in brackets is what the code checks. `not enforced` marks cells that are specified but treated as denied in the MVP.",
  "",
);

push(
  table(
    ["Column", "Label", "Mandate check"],
    POLICY_COLUMNS.map((c) => [code(c), POLICY_COLUMN_LABELS[c], MANDATE_CHECKS[c] ?? "none (role only)"]),
  ),
  "",
);

for (const row of PERMISSION_MATRIX) {
  const rendered = view.rows.find((r) => r.action === row.action);
  push(`### ${code(row.action)}: ${row.label}`, "");
  const extra = [row.auditScope ? `Audit scope: ${code(row.auditScope)}.` : null, row.source ? `Source: ${row.source}.` : null].filter(Boolean);
  if (extra.length) push(extra.join(" "), "");
  push(
    table(
      ["Column", "Specification", "Checked as"],
      POLICY_COLUMNS.filter((c) => row.cells[c].requirement !== null).map((c) => {
        const r = row.cells[c].requirement;
        const enforced = rendered?.cells.find((x) => x.column === c)?.enforced ?? false;
        return [POLICY_COLUMN_LABELS[c], row.cells[c].text, `${code(r)}${enforced ? "" : " (not enforced)"}`];
      }),
    ),
    "",
  );
  const denied = POLICY_COLUMNS.filter((c) => row.cells[c].requirement === null);
  if (denied.length) push(`No access: ${denied.map((c) => `${POLICY_COLUMN_LABELS[c]}${row.cells[c].text !== "—" ? ` (${row.cells[c].text})` : ""}`).join(", ")}.`, "");
}

push(
  "### Requirements",
  "",
  table(["Requirement", "Meaning"], Object.entries(REQUIREMENTS).map(([k, v]) => [code(k), v])),
  "",
  "## 3. Roles and mandates",
  "",
  table(["Role", "Label"], ROLES.map((r) => [code(r), ROLE_LABELS[r]])),
  "",
  table(["Mandate", "Label"], Object.entries(MANDATE_LABELS).map(([k, v]) => [code(k), v])),
  "",
  "## 4. Audit scopes",
  "",
  "An auditor sees nothing without a grant. A scope is effective only when **every** record owner of that scope granted it, so one owner cannot disclose another owner's records.",
  "",
  table(
    ["Scope", "Label", "Record owners who must grant it"],
    AUDIT_SCOPES.map((s) => [code(s), AUDIT_SCOPE_LABELS[s], AUDIT_SCOPE_OWNERS[s].map((o) => (o === "OWNER" ? "borrower" : "selected lender")).join(" + ")]),
  ),
  "",
  "## 5. Field-level disclosure",
  "",
  "The presenters (`packages/domain/src/presenters.ts`) build every response from facts and the viewer. They **omit** what the viewer may not see (null or absent fields); nothing is sent and then hidden in the UI. `caseDisclosure()` computes the flags below from the policy; each flag gates these fields:",
  "",
  table(["Flag", "Gates"], flagNames.map((f) => [code(f), DISCLOSURE_FLAGS[f]])),
  "",
  "Other field rules in the presenters:",
  "",
  "- Proposal drafts are lender-internal; the borrower only ever sees issued versions.",
  "- Evidence documents: the owner sees all; a verifier sees the documents of its own verification requests (downloads only while the request is open); the dealer sees its own contributions; the selected lender sees documents in a share addressed to it (downloads need an active, unexpired `VIEW_DOWNLOAD` share, re-checked at download); an auditor with `EVIDENCE_MANIFEST` sees shared documents (metadata).",
  "- Access grants: package shares are visible to the owner, consenting dealers and the recipient; verification scopes to the owner and that verifier; audit grants to grantor, auditor, owner and selected lender.",
  "- Reports: only the requesting organization sees its reports; auditor exports keep the scopes effective at generation and each must still be granted at download.",
  "- Pledge: lender and borrower organizations are shown to the borrower, the selected lender and a granted auditor; `principalRef` needs `terms`.",
  "",
  "### Flags on the synthetic CL-001 main seed",
  "",
  "Computed by the script with `caseDisclosure()` on `buildScenario({ profile: \"main\" })` (registered, attested, `PKG-001 v2` shared with Demo Lender A, review `SUBMITTED`, no proposal, no lock, no audit grants).",
  "",
  table(
    ["Persona", ...flagNames.map(code)],
    disclosures.map(({ id, d }) => [personaLabel(id), ...flagNames.map((f) => yes(d[f]))]),
  ),
  "",
  `Verifier note: in this UI_MOCK fixture ${cl001.asset.verifications.map((v) => `${code(v.ref)} has \`caseRef\` ${v.caseRef === null ? "null (an asset-level request)" : code(v.caseRef)}`).join("; ")}, so the verifier is related to the asset and its verification but not to the case. The LOCALNET seed (\`apps/api/src/seed/localnet.ts\`) requests VR-001 with \`caseRef\` CL-001, which makes the verifier a case participant there.`,
  "",
  "The same case with the walkthrough's audit grants added (AG-001 by the borrower: `EVIDENCE_MANIFEST`, `ATTESTATION`; AG-002 by Demo Lender A: `DECISION_OUTCOME`, `PLEDGE_RELEASE_EVENTS`; both `VIEW_EXPORT`). `PLEDGE_RELEASE_EVENTS` is not effective because only one of its two record owners granted it.",
  "",
  table(
    ["Persona", "Effective scopes", ...flagNames.map(code)],
    [[personaLabel("auditor"), (auditorWithGrants.audit?.scopes ?? []).map(code).join(", ") || "none", ...flagNames.map((f) => yes(auditorWithGrants[f]))]],
  ),
  "",
  "### Case detail fields on the main seed",
  "",
  "`presentCaseDetail()` output per persona: which optional fields are present, the allowed tabs and the allowed case actions. `404` = the presenter returned null (the API answers `unavailable`).",
  "",
);

const detailRows = PERSONA_IDS.map((id) => {
  const actor = personaActor(id);
  const detail = presentCaseDetail(cl001, actor, pctx);
  if (!detail) return [personaLabel(id), "404", "—", "—", "—", "—", "—"];
  const present = (v) => (v === null || v === undefined ? "—" : "yes");
  return [
    personaLabel(id),
    present(detail.borrower),
    present(detail.selectedLender),
    present(detail.requestedPrincipal),
    present(detail.technical),
    detail.allowedTabs.join(", "),
    allowedCaseActions(cl001, actor, now, pctx).join(", ") || "—",
  ];
});
push(
  table(["Persona", "`borrower`", "`selectedLender`", "`requestedPrincipal`", "`technical`", "Tabs", "Allowed case actions"], detailRows),
  "",
  `Case actions known to the domain: ${CASE_ACTIONS.map(code).join(", ")}. Each maps to a policy action and is also checked against workflow preconditions (\`packages/domain/src/workflow.ts\`).`,
  "",
  "## 6. Event audiences",
  "",
  "Who sees each workflow event in activity feeds and audit exports. The acting organization always sees its own events. `ANY` = any active audit grant; `NONE` = never shown to auditors.",
  "",
  table(
    ["Event", "Summary", "Audience", "Auditor scope"],
    Object.entries(EVENT_TYPES).map(([type, meta]) => [code(type), meta.summary, meta.audience.length ? meta.audience.join(", ") : "acting organization only", code(meta.auditScope)]),
  ),
  "",
);

const markdown = `${out.join("\n").trimEnd()}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8").replaceAll("\r\n", "\n");
  } catch {
    // Missing file: reported as stale below.
  }
  if (current !== markdown) {
    console.error("docs/permissions.md is stale; run scripts/docs/permissions.mjs and commit the result");
    process.exit(1);
  }
  console.log("docs/permissions.md is up to date");
} else {
  writeFileSync(TARGET, markdown);
  console.log(`wrote ${TARGET}`);
}
