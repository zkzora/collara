# Collara: research synthesis and reconciled build baseline

- **Author:** synthesis subagent. **Written:** 2026-10-01 UTC (2026-10-02 WIB).
- **Inputs, all read for this synthesis:**
  - `C:\Users\Pongo\Documents\Codex\2026-10-01\oke\outputs\collara-full-stack-master-prompt.md` (**MP**, 212 lines). This is the authoritative brief.
  - `C:\Collara\docs\_research\spec-system.md` (**SYS**). Notes on `collara-full-website-system.md` (**S**). S line refs are written `S Lnnn`.
  - `C:\Collara\docs\_research\spec-content.md` (**CON**). Notes on the landing copy (**L**), ICP/GTM/metrics, hackathon context and the docx files (**D**, dated 2026-09-19).
  - `C:\Collara\docs\_research\proto-dashboard.md` (**PDB**). Prototype `Collara Dashboard.dc.html` (**P-Dash**).
  - `C:\Collara\docs\_research\proto-landing-docs.md` (**PLD**). Prototype Landing, Docs and Mobile Preview (**P-Land**, **P-Docs**).
  - `C:\Collara\docs\_research\uploads.md` (**UPL**). Logo mark, screenshots and the Linear/Mercury web capture.
  - `C:\Collara\docs\_research\research-canton.md` (**CAN**). Daml SDK / Canton / ledger client.
  - `C:\Collara\docs\_research\research-dm.md` (**DM**). DLC-link Decentralization Manager.
  - `C:\Collara\docs\_research\research-webstack.md` (**WEB**). Web, API and infrastructure stack.
  - S §11.7 (the 10 invariants, S L841–852) was re-read directly from the source, because the SYS notes cite the invariants without listing them.
- **Evidence markers:**
  - **[READ: src]**: stated in a source.
  - **[VERIFIED: who]**: executed on this machine. `CAN`/`WEB` = by those research agents. `SPIKE` = by me during this synthesis (see §3.4).
  - **[INFERRED]**: my reasoning, not stated or tested anywhere.
- **New verification done here (SPIKE, 2026-10-01 ~17:10 UTC):**
  - A Daml package built with **SDK 3.5.12 / LF 2.2** data-depends on DM's `governance-action-v1-0.1.0.dar` and implements `GovernableAction`.
  - The interface package id stays `48acd500…`.
  - A Daml Script 2-of-3 test **passed on the IDE ledger and against a live Canton 3.5.19 `dpm sandbox`**. It ran DM's real `GovernanceRules` from `governance-core-v1-0.1.0.dar` and checked four things: one approval fails, a duplicate confirmer aborts, two distinct approvals execute, and a stale proposal fails.
  - This resolves the main SDK-mismatch risk raised in CAN §8.1 and DM §8. Details are in §3.4.

---

## 0. Source precedence (how conflicts were decided)

1. **MP (2026-10-01 22:43 WIB)** wins on scope, stack, modes, invariants, fixtures, governance scope and build order.
2. **S = L (2026-09-30 23:44)**. S is the system/website spec; its §5 is L verbatim (CON confirmed this by diff). S wins on routes, roles, state vocabularies, API names, approved copy and acceptance criteria wherever MP is silent. MP §1 and §7 tell the builder to reuse them: "Reuse established route names from the system specification where present."
3. **The prototype** (`C:\Collara\Collara Website\*.dc.html`, iterated through 2026-10-01) is the reference for visual design, layout, interaction patterns, the fixture detail that S/MP lack, and copy that S does not cover (for example the pre-demo final CTA and dashboard microcopy).
   - Its file times are later than S, but it is an *implementation artefact of S*. Where it deviates from S or MP (labels, principal, tabs, simulated "Confirmed on the ledger"), **S/MP win**.
4. **GTM/ICP/metrics/registration/strategy docs (2026-09-30 18:31–23:06)** give context only. Where they are broader than S/MP (governed release, transfer, Lockbox fallback), the later and narrower S/MP win.
5. **docx concept documents (2026-09-19)** are superseded on scope, authorization and vocabulary. Use them only for intent.
6. **Narrowing exception.** If a later source is explicitly narrower, it wins even over an older higher-ranked statement. Examples: CNC-only scope (CON C1); governance limited to the verifier registry (CON C13); ownership transfer excluded (MP L17).

Language rule [READ: S L3]: S prose is Indonesian, **all user-facing copy is English**, and every backticked string is verbatim approved copy.

---

## 1. Reconciled requirements

### 1.1 Modes, labels and capability status (cross-cutting)

| Item | Canonical value | Source |
|---|---|---|
| Runtime modes | `UI_MOCK` and `LOCALNET` (env `COLLARA_MODE`) | [READ: MP L99–104] |
| UI_MOCK banner | `Synthetic demo data — UI mockup.` | [READ: MP L101] |
| LOCALNET banner | `Synthetic demo data — Canton LocalNet.` | [READ: MP L102] |
| Prototype/S label `Demo data — LocalNet` | **Retired** (superseded by MP) | [READ: S L1074, P-Dash L28] |
| Header environment chip | `UI mockup` / `LocalNet` (later `DevNet`, `MainNet`), **matching the real connection** | [READ: S L542]; `UI mockup` value [INFERRED] |
| No silent fallback | A failed LOCALNET action must never fall back to simulated success. UI_MOCK must never say `Confirmed on the ledger.` | [READ: MP L104; PDB bug 20] |
| Public demo gate | Server-side flag `PUBLIC_DEMO_STATUS = off \| localnet`, default `off`. `Explore the demo` and the footer `Demo` link appear **only** when `localnet` works end to end. | [INFERRED from MP L104, L L51, S L192; CON §b.3] |
| Capability chips (Docs, Settings › integrations, Governance) | `UI mockup` · `Specified` · `Planned` · `Implemented` · `Not available`, driven by one typed `capabilityStatus` config. An item flips to `Implemented` only after verification. | [READ: P-Docs legend; MP L208]; config [INFERRED] |
| Governance integration status | `Simulated` (UI_MOCK) / `Partial — governance contracts on one local participant` (Tier A) / `Decentralization Manager · local 3-node topology · one operator` (Tier B) / `Unavailable` | [READ: MP L153–155; DM §10.5]; exact strings [INFERRED, need copy approval] |

**Truth-in-labelling caveat [INFERRED].** On this machine the "LocalNet" is a **Canton 3.5.19 `dpm sandbox`** (1 or 3 participants), not Splice LocalNet (cn-quickstart, Docker). Keep MP's banner string. `/docs#setup` and `/api/system/health` must state the exact topology. See CR-02.

### 1.2 Canonical routes

#### 1.2.1 Public (marketing) routes. App Router group `app/(marketing)`, Server Components

| Route | Page | Priority | Status / notes |
|---|---|---|---|
| `/` | Landing. Anchors `#product` (on **The problem** section), `#workflow`, `#for-lenders`, `#why-canton`, plus unlinked `#pilot`, `#faq` | P0 | Copy verbatim from L / CON §a. Pre-demo variant by default. [READ: S §5, P-Land] |
| `/docs` | Single page. Anchors `#overview`, `#workflow`, `#roles`, `#demo`, `#governance`, `#setup` (keep these ids stable) | P0 | Capability table config-driven. `#setup` is written only after verified commands exist. [READ: P-Docs; S §6.2] |
| `/pilot` | Request a pilot form | P0 | Fields and copy from **S §6.1** (§1.2.4). Success only after DB persist. `POST /api/pilot-requests`, rate-limited. [READ: S L456–474] |
| `/demo` | Guided demo: role-based walkthrough of CL-001 | P0 (S) | Build it, but leave it **unlinked** until `PUBLIC_DEMO_STATUS=localnet`. If visited while off, show the pre-build state, not a broken page. [CON C23] |
| `/privacy`, `/terms` | Legal pages | P0 "before real data" | **Blocked on legal content** (BPD-1). They are linked from the footer, so they must exist. Do not invent policy text. |
| `/security` | Implemented controls only | P1 | Not linked anywhere today. Defer, or make it a `/docs` section later. [READ: S L102] |

Header nav [READ: S L155–164]: `Collara`→`/`, `Product`→`/#product`, `Workflow`→`/#workflow`, `For Lenders`→`/#for-lenders`, `Why Canton`→`/#why-canton`, `Docs`→`/docs`, `Sign in`→`/login`, `Request a pilot`→`/pilot` (button). There is no top-nav Demo item.

Footer [READ: S L434–452]:
- Product column: `Product` · `Workflow` · `For Lenders` · `Demo`. `Demo` is shown only when the demo gate is on (CR-04).
- Resources column: `Docs` · `Why Canton`.
- Contact column: `Request a pilot`.
- Legal column: `Privacy` · `Terms`.
- Description and disclaimer are verbatim from L.
- No placeholder email, address, social or GitHub links.

#### 1.2.2 Authentication routes

| Route | Purpose | Notes |
|---|---|---|
| `/login` | `Sign in to your Collara workspace.` Starts OIDC through `GET /api/auth/login` | Invite-only for the pilot. The prototype `Sign in → Dashboard` is an artefact. [READ: S §7.1; CON C36] |
| `/invite/[token]` | `Accept invitation` · `Decline` | Errors: `This invitation has expired.` / `This invitation cannot be used with your account.` [READ: S §7.2] |
| `/onboarding` | Organization name, country, type, business contact, hosting mode | Seeded orgs must not be presented as verified real institutions. [READ: S §7.3] |
| `/access-pending` | Waiting for org-admin approval of membership/party binding | [READ: S §4.2] |
| API: `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout` | openid-client 6 Authorization Code + PKCE (S256), server session cookie `__Host-collara_sid` | [VERIFIED: WEB §10.1]; route names [INFERRED] |
| Demo sessions (demo environment only) | `/demo` role selector creates **isolated authorized demo sessions** (one Keycloak user per persona) | [READ: MP L171; S §17.1]. Not a production authorization path. |

#### 1.2.3 Workspace routes (`app/app/...`; dynamic, `Cache-Control: private, no-store`)

Rule [READ: S L140]: the visible menu depends on role and scope, but **every URL is checked by the backend**.

| Route | Page | Tabs / sub-routes | Source and reconciliation |
|---|---|---|---|
| `/app` | Overview (role-specific action queue) | — | S §9.1. The lender view is the default demo persona (MP #2). |
| `/app/cases` | Case Queue | `?view=all\|mine\|ready-for-review\|needs-evidence\|awaiting-approval\|release-requests` | Saved views from S L663 / P-Dash. Counts come from the server under the same scope. |
| `/app/cases/new` | Create Financing Case | — | S §9.3 |
| `/app/cases/[caseId]` | Case Workspace. Header shows next actor, next action, blockers, data source and last sync. | Segments: `summary` (default), `evidence`, `verification`, `sharing` (label **`Sharing & Access`**), `review`, `proposal`, `pledge`, `activity` | **Union** of S (8 tabs), MP (6) and P-Dash (8). Order follows the workflow. See CR-06. |
| `/app/assets` | Assets list | — | S §9.4. The prototype had no list page. |
| `/app/assets/new` | Register Asset | — | S §9.5 |
| `/app/assets/[assetId]` | Asset Passport | `overview` (default), `evidence`, `verification`, `cases`, `activity` (scoped to asset, passport, verification and control events only) | S §9.6; PDB bug 14 |
| `/app/verifications` | Verification Queue (verifier's primary page) | — | S §9.8. May also be a saved view. |
| `/app/verifications/[verificationId]` | Verification Workspace | — | S §9.9 |
| `/app/reviews` | Lender Review Queue | same saved views as Cases | S §9.10 |
| `/app/reviews/[reviewId]` | Collateral Review | `evidence`, `verification-scope`, `assessment` (default), `decision`, `activity` | S §9.11; P-Dash §3.5 tab set |
| `/app/pledges` | Pledges list | filters `Active`, `Release requested`, `Released` | S §9.14. The prototype had no list page. |
| `/app/pledges/[pledgeId]` | Pledge Detail and Release | — | S §9.15. **Only real locks** (e.g. `PL-001`). An available control is shown in the case `pledge` tab and on the passport, not as a fake `CONTROL-…` pledge page (PDB bug 11). |
| `/app/access` | Sharing and access requests across cases | — | S §9.16. The case tab is the main entry. |
| `/app/audit` | Scoped Audit Center | `events` (default), `exports` | S §9.17, P-Dash §3.7 |
| `/app/reports` | Export History | redirects to `/app/audit/exports` | S L130 ("may be a tab in Audit") |
| `/app/notifications` | Notifications | — | P1. MVP uses a header inbox only (S L131). |
| `/app/settings` | Workspace Settings (minimal) | — | S §9.19 |
| `/app/settings/team` | Team and Mandates | — | P1. The demo uses seeded roles. |
| `/app/settings/integrations` | Integrations | — | P2. Never show as active. |
| `/app/governance` | Governance landing; redirects to `registry` | `registry` (**Verifier Registry**, default), `proposals`, `members` | MP #8 needs a Verifier Registry screen that S lacks (CR-08). Static segments take precedence over `[proposalId]` in Next routing [INFERRED]. |
| `/app/governance/[proposalId]` | Governed Action Detail (e.g. `GP-004`) | — | Keeps S's route name `/app/governance/:proposalId` (S L136). |

Main nav [READ: S L531–535]: `Overview`, `Cases`, `Assets`, `Pledges`, `Audit`. `Governance` is shown to users holding a governance mandate, **always with its integration status badge** (CR-07). `Settings` sits at the bottom of the sidebar. Per-role nav [INFERRED]:
- the verifier sees `Overview`, `Verifications`, `Assets` (scoped), `Audit`;
- the auditor sees `Overview`, `Cases` (granted), `Audit`;
- the dealer sees `Overview`, `Cases` (invited).

#### 1.2.4 `/pilot` form (canonical; S §6.1 wins over PLD's "no fields exist")

PLD §4 says no source defines the fields. That is incorrect: S §6.1 does.
- **Heading:** `Tell us about your equipment-finance workflow.`
- **Description:** `We are looking for teams handling used CNC financing to help define and test a focused coordination workflow.`
- **Fields:** Full name, Work email, Company, Role, Company type, Country, Equipment category, Approximate cases per month (must include `Unknown`), Current workflow challenge, Optional current systems, Consent to be contacted.
- **Never collect:** passport files, borrower PII, bank statements, loan documents.
- **Submit:** `Request a conversation`.
- **Success:** `Your request has been received. We will contact you using the email provided.` Show it only after the DB write. Email failure goes to a retry queue.
- **Error:** `We couldn't submit your request. Please try again.`
- **Disclaimer above submit:** `A pilot request is not a loan application. Do not submit financial documents through this form.`
- **Still needed:** the consent text, retention period and notification inbox (BPD-1). Add a honeypot field and rate-limit by IP/session at the API [INFERRED].

#### 1.2.5 API surface (Fastify, all under `/api`, same-origin through the Next Route Handler proxy)

**From S §15.2, verbatim names (29 routes)** [READ]:
- Session and onboarding: `GET /api/me`; `POST /api/pilot-requests`; `POST /api/invitations/:token/accept`.
- Assets: `GET|POST /api/assets`; `GET /api/assets/:id`; `POST /api/assets/:id/versions`.
- Evidence: `POST /api/evidence/upload-intents`; `POST /api/evidence/:id/finalize`; `GET /api/evidence/:id/download`.
- Cases: `GET|POST /api/cases`; `GET /api/cases/:id`; `POST /api/cases/:id/sharing`; `POST /api/cases/:id/verification-requests`.
- Verification: `POST /api/verifications/:id/attestations`; `POST /api/verifications/:id/change-requests`.
- Review and financing: `POST /api/cases/:id/assessments`; `POST /api/cases/:id/proposals`; `POST /api/proposals/:id/acceptance`.
- Pledge and release: `POST /api/cases/:id/pledge-activation`; `POST /api/pledges/:id/release-requests`; `POST /api/release-requests/:id/decision`.
- Access grants: `GET|POST /api/access-grants`; `POST /api/access-grants/:id/revoke`.
- Audit, reports and system: `GET /api/audit/events`; `POST /api/reports`; `GET /api/commands/:id`; `GET /api/system/health`; `POST /api/governance/proposals`.

**Additions the screens need** [INFERRED; naming follows S style; SYS §6.2]:
- **Asset-level verification:** `POST /api/assets/:id/verification-requests`. This resolves CR-14: the journey verifies before a case exists.
- **Verification:** `GET /api/verifications`; `GET /api/verifications/:id`; `POST /api/verifications/:id/assignment` (accept/decline + reason); `POST /api/verifications/:id/rejection`; `POST /api/attestations/:id/revocation`; `POST /api/attestations/:id/corrections`.
- **Reviews:** `GET /api/reviews`; `GET /api/reviews/:id`; `POST /api/reviews/:id/submit-for-approval`; `POST /api/reviews/:id/decision`; `POST /api/reviews/:id/information-requests`.
- **Proposals:** `GET /api/proposals/:id`; `POST /api/proposals/:id/decline`; `POST /api/proposals/:id/withdraw`; `POST /api/proposals/:id/activation-authorization` (borrower authorizes the lock; see §5.3).
- **Pledges and release:** `GET /api/pledges`; `GET /api/pledges/:id`; `GET /api/release-requests/:id`; `POST /api/release-requests/:id/information-requests`; `POST /api/release-requests/:id/withdraw`.
- **Evidence:** `GET /api/evidence/:id`; `POST /api/evidence/:id/versions`; `GET /api/cases/:id/evidence`.
- **Reports:** `GET /api/reports`; `GET /api/reports/:id/download` (permission re-checked).
- **Invitations:** `POST /api/invitations`; `GET /api/invitations/:token`; `POST /api/invitations/:token/decline`.
- **Notifications:** `GET /api/notifications`.
- **Auth:** `/api/auth/login|callback|logout`.
- **Governance:** `GET /api/governance/state`; `GET /api/governance/proposals[/:id]`; `POST /api/governance/proposals/:id/confirmations`; `POST /api/governance/proposals/:id/execute`; `POST /api/governance/proposals/:id/cancel`.
- **Verifier registry:** `GET /api/verifiers`.
- **Demo environment only:** `POST /api/demo/sessions` (persona switch) and `POST /api/demo/reset`.

Rules [READ: S §15.4; MP §7]:
- The **server computes allowed actions**. `GET /api/cases/:id` returns the permitted tabs and actions.
- Lists use stable cursors.
- A changed canonical state returns `409`.
- Errors never reveal existence. Use `This record is unavailable to your account.` with **404-shaped responses for unrelated parties** [INFERRED status code].
- Every mutating endpoint takes an `Idempotency-Key` and returns a `commandId` [INFERRED header name].

### 1.3 Personas, roles, mandates and parties

#### 1.3.1 Roles (S §3, 9 roles; MP §5 personas fold into them)

| Role (exact label) | Who | May | Must not | Demo identity |
|---|---|---|---|---|
| Borrower / Asset Owner | Equipment-owning manufacturer | Register asset, submit evidence, request verification, consent to sharing, accept or decline the proposal, **authorize pledge activation**, request release | Change verifier results; release unilaterally | Demo Manufacturer. User "Plant manager" [INFERRED name] |
| Dealer Contributor | Invited dealer | Add invoice, specs, photos and transaction context to an invited case; consent to onward sharing of own records | Approve financing; see loan terms | Demo CNC Dealer ("Sales desk") |
| Verifier | **Active, assigned** inspector | Accept or decline the assignment, request changes, issue or reject an attestation within scope | Credit approval; lien priority | Demo Verifier (`VER-001`) |
| Lender Analyst | Credit analyst / documentation officer | Review evidence, request information, save assessment, submit for approval, draft proposal, request export | Record decisions; issue proposals; release | **Dana Reyes**, Demo Lender A [READ: P-Dash] |
| Lender Approver | Head of Credit / mandated officer | Approve or reject eligibility, issue or withdraw proposal, **activate pledge**, authorize or reject release; may request release | Change an attestation | **Morgan Hale**, Head of Credit, Demo Lender A [READ: P-Dash] |
| Auditor | Holder of a scoped grant | Read and export within the grant | Read the whole ledger; take actions | Demo Auditor |
| Organization Admin | Admin of any org | Invite members, set roles and mandates in own org | Automatically see financials; act as another org | one per org [INFERRED] |
| Collara Operator (+ **Registrar**) | App/infra operator; runs the registry | Operations, registry issuance, diagnostics | Override lender decisions, approve inspections, read all orgs | `Collara Registry (demo)` party [INFERRED; MP L114 "registrar trust"; CON Q9] |
| Governance Member | Seat-holding member | Propose, confirm and execute **Add verifier / Suspend verifier** only | Release collateral; credit decisions | Seats 1/2/3 = Demo Lender A / Demo Lender B / Demo Auditor [READ: P-Dash §4.8; confirm, CR-29] |

Further rules:
- A **web account is not a Canton party**. Financial roles are never self-selected [READ: S L88].
- **Demo Lender B** is an *unrelated lender with no access to CL-001* [READ: MP L164, L169]. Its governance seat is held through a **separate governance-member party**, never through its business party [INFERRED, DM §2.2].

#### 1.3.2 Organization → Canton party → ledger user (LOCALNET) [INFERRED, built on CAN §9.2 and DM §2.2]

| Org | Business party hint | Ledger user (least privilege) | Governance member party |
|---|---|---|---|
| Collara (operator/registrar) | `CollaraRegistrar` | `registrar-svc`: CanActAs registrar only | — (optionally an `additionalProposer`, DM §3.2) |
| Demo Manufacturer | `DemoManufacturer` | `borrower-svc`: CanActAs + CanReadAs own party | — |
| Demo CNC Dealer | `DemoCNCDealer` | `dealer-svc` | — |
| Demo Verifier | `DemoVerifier` | `verifier-svc` | — |
| Demo Lender A | `DemoLenderA` | `lender-a-svc` | `gov-seat-1` (`gov-seat-1-svc`) |
| Demo Lender B | `DemoLenderB` | `lender-b-svc` | `gov-seat-2` |
| Demo Auditor | `DemoAuditor` | `auditor-svc` | `gov-seat-3` |
| Governance | `CollaraGovernance`: a local party (Tier A) or the DM decentralized party `collara-gov::1220…` (Tier B) | read-only for members (`readAs`) | — |

- Party IDs **change on every sandbox restart** [VERIFIED: CAN §3]. The `party_bindings` table is re-seeded on start; never hard-code party ids.
- **Analyst vs Approver is a mandate inside one org party.** The ledger sees only `DemoLenderA`; the **API enforces the mandate**, and choices record an opaque `actorRef` [INFERRED]. Making the ledger itself enforce approver-only release would need a separate `DemoLenderA-Approvals` party. That is P1, see R-10.
- The worker needs read access across parties to build projections. It is a privileged server-side credential; document it as an operator trust dependency [INFERRED; MP L131].

#### 1.3.3 Demo user accounts (Keycloak realm `collara`) [INFERRED; only the Morgan Hale and Dana Reyes names come from sources]

`manufacturer.owner@demo.test`, `manufacturer.admin@demo.test`, `dealer.contributor@demo.test`, `verifier.inspector@demo.test`, `lender-a.analyst@demo.test` (Dana Reyes), `lender-a.approver@demo.test` (Morgan Hale; also the seat-1 mandate), `lender-b.approver@demo.test` (seat-2 mandate), `auditor@demo.test` (seat-3 "Audit lead mandate"), `operator@collara.test`.
- Org membership, role, mandate and party binding live in **Collara's DB**, not in IdP roles [READ: MP L129; WEB §10.2].
- `accessTokenLifespan: 300` matches the Canton 300 s JWT cap [VERIFIED: CAN §3, WEB §10.2].

### 1.4 Canonical permission matrix

#### 1.4.1 Object and action level

Merged from S §12.1 (11 rows), S §14.2 (authority) and the P-Docs matrix (15 rows). Where P-Docs and S differ, S wins (CR-21). "Scoped" = only assigned or granted records. "—" = no.

| Data / action | Borrower | Dealer | Verifier | L. Analyst | L. Approver | Lender B (unrelated) | Auditor | Org Admin | Operator / Registrar | Gov member |
|---|---|---|---|---|---|---|---|---|---|---|
| Equipment identity | Own | Scoped (invited case) | Scoped (assignment) | Shared case | Shared case | — | Granted | Own-org members only, no financials | Minimal registry scope | — |
| Evidence document metadata + bytes (title, filename, URL, thumbnail all need permission) | Own / authorized | Own contribution + granted | Assigned scope | Shared package | Shared package | — | Granted | Not automatic | **Not automatic**; hosting model documented | — |
| Attestation | Case/asset scope | If granted | Issued / assigned | Shared case | Shared case | — | Granted | — | Minimal registry status | — |
| Internal lender notes, internal risk view | — | — | — | Own org | Own org | — | Separate explicit grant | — | — | — |
| Loan terms (proposal, agreement, principal) | Own agreement | — | — | Own case | Own case | — | Separate explicit grant | — | — | — |
| Register passport / request registration | ✓ (owner mandate) | Only as owner's delegate | — | Only as approved delegate | Only as approved delegate | — | — | — | Approves issuance (no impersonation) | — |
| Request verification, assign verifier | ✓ | — | — | — | — | — | — | — | — | — |
| Accept assignment, request changes, issue or reject attestation | — | — | Active assigned verifier | — | — | — | — | — | — | — |
| Approve sharing of a package | ✓ (record owner) | Consent for own records | — | — | — | — | — | — | — | — |
| Open shared evidence, record assessment | — | — | — | ✓ | ✓ | — | — | — | — | — |
| Submit assessment for approval | — | — | — | ✓ | ✓ | — | — | — | — | — |
| Record collateral decision (eligible / rejected) | — | — | — | — | ✓ | — | — | — | — | — |
| Draft proposal | — | — | — | ✓ | ✓ | — | — | — | — | — |
| Issue / withdraw proposal (withdraw only before acceptance) | — | — | — | — | ✓ | — | — | — | — | — |
| Accept / decline proposal (exact version) | ✓ | — | — | — | — | — | — | — | — | — |
| Authorize pledge activation (borrower side) | ✓ | — | — | — | — | — | — | — | — | — |
| Activate pledge (consume control) | — | — | — | — | ✓ | — | — | — | — | — |
| Request release | ✓ own case | — | — | — | ✓ (authorized case role; API-permitted, UI P1) | — | — | — | — | — |
| Authorize / reject / request info on release | — | — | — | — | **Designated lender approver only** | — | — | — | — | **Never** |
| Grant audit access | ✓ (own records) | — | — | — | ✓ (own records) | — | — | — | — | — |
| View case history | Scoped | Scoped | Scoped | Scoped | Scoped | — | Scoped | — | Operational subset | — |
| Export case report | Own scope | Granted subset | Assigned subset | Own scope | Own scope | — | Granted subset | — | Operational subset | — |
| Propose / confirm / execute Add or Suspend verifier | — | — | — | — | — | — | — | — | Optional additional proposer only | ✓ (seat mandate) |
| Manage members and mandates | — | — | — | — | — | — | — | Own org | — | — |

#### 1.4.2 Field-level and disclosure rules (all [READ] unless marked)

1. Loan terms are disclosed **only** to the borrower and the selected lender. Verifier and dealer are never observers, including through transaction consequences (S L729, L851; MP L120).
2. Case Queue `Borrower` and `Pledge state` columns, the Review Queue `requested principal`, and Pledges `lender/borrower` and `principal reference` render **only when authorized** (S L575, L661, L703). The server omits the field. It must not send it and hide it in the client (MP L97).
3. Serial-number search works only for the owner of that serial (S L577). Duplicate warnings must never reveal another party's registration (S L599).
4. Passport `Cases` tab lists only cases known to the viewer (S L623).
5. Collateral Review: internal notes and the internal risk view are separate from borrower-shared feedback (S L671, L677). Assessment ≠ funded.
6. Notifications carry only a generic event plus an authenticated link. No serial, borrower, principal, filename or terms (S L1114).
7. Analytics never receive document contents, borrower identity, serial, credentials, terms or raw ledger payloads. Synthetic events are kept separate (S L1166).
8. Lists, counts, search, notifications, CSV and activity feeds all use **the same scope as the detail view** (S L554). Lender B sees **no** counts, search hits, notifications, exports or events for CL-001 (S L1222).
9. Org Admin and Operator get no financial data by default (S L84–85; MP L135).
10. Browser-supplied party, organization or `actAs` is never authority (S L525, L880; MP L129).
11. Revocation limits **future** access only. Copy: `Future document access has been revoked. Previously shared copies may still exist.` (S L731, L882; MP L139)
12. Technical and contract ids appear only under `Technical details` when authorized (S L699).
13. Money:
    - decimal strings plus explicit ISO currency end to end;
    - Daml `Numeric 2`; PostgreSQL `numeric(18,2)`; `decimal.js`;
    - valuation ≠ principal;
    - no TVL;
    - unavailable ≠ 0;
    - aggregates only per currency, labelled `Recorded financing principal` / `Recorded collateral valuation`, with coverage and source (S §13.3, §9.1; WEB §12).

### 1.5 State vocabularies (one per state machine; shared through `packages/domain`)

General rule [READ: S L791]: **never a single `VERIFIED` status**. Evidence, verification, review, proposal and pledge are displayed separately (S L550; MP L93). UI labels are sentence case. Raw enums appear only in technical mode (PDB bug 11).

| # | Machine | States (canonical) | Transitions / notes | Source |
|---|---|---|---|---|
| 1 | Asset identity | `DRAFT` → `REGISTRATION_REQUESTED`* → `REGISTERED` → `ARCHIVED`; `REGISTRATION_DECLINED`* | `REGISTERED` is set only after the ledger commit. `PLEDGED` is **not** an identity state. Transfer is P2. | S §11.1; *[INFERRED] for the registrar propose/accept step (§5.2) |
| 2 | Evidence document (off-ledger) | `UPLOAD_PENDING` → `QUARANTINED` → `AVAILABLE` \| `REJECTED` (type/size) \| `HASH_MISMATCH` | Scan state: `NOT_SCANNED`. **The MVP is synthetic-only and does not scan**, and says so (MP L137). Ledger reference: `UNCOMMITTED` \| `COMMITTED` (in a manifest). | S L619, L896 fields; states [INFERRED] |
| 3 | Evidence review (per document, display) | `Submitted`, `Reviewed`, `Reviewed · gap noted`, `Correction requested`, `Attested` | Display labels from P-Dash. | [READ: P-Dash §4.3]; enum [INFERRED] |
| 4 | Verification request | `REQUESTED` → `IN_REVIEW` → `CHANGES_REQUESTED` → `IN_REVIEW` → `ATTESTED` \| `REJECTED`; plus `DECLINED`*, `CANCELLED`* | `Accept assignment` = `REQUESTED → IN_REVIEW`. Clarification is a message/event, not a state. Registry status is re-checked **at commit** (S L643). | S §11.2; *[INFERRED] (S gap I-5) |
| 5 | Attestation validity | `VALID`* \| `EXPIRED` (computed from `validUntil`, not a ledger event) \| `REVOKED` \| `SUPERSEDED` | Immutable. A correction creates a new attestation linked to the old. | S §11.2, L809; `VALID` label from P-Dash |
| 6 | Lender review / assessment | `NOT_SUBMITTED` → `SUBMITTED` (package shared) → `IN_REVIEW` → `NEEDS_INFORMATION` ↔ `IN_REVIEW` → `PENDING_APPROVAL`* → `ELIGIBLE` \| `REJECTED` | A changed evidence snapshot returns the review to `NEEDS_INFORMATION` (copy `The reviewed evidence has changed. A new review is required.`). UI: `Needs information` / `Eligible for this case` / `Rejected for this case`. | S §11.3; *[INFERRED] (S gap I-4; needed by the `Awaiting approval` view) |
| 7 | Financing proposal | `DRAFT` → `ISSUED` → `ACCEPTED` \| `DECLINED` \| `WITHDRAWN` \| `EXPIRED` | A terms change means a new version and a new acceptance. **`ACCEPTED` ≠ `FUNDED`.** The analyst drafts; the approver issues. | S §11.4; SYS I-8 |
| 8 | Activation authorization (borrower) | `NONE` → `AUTHORIZED` → `CONSUMED` (by activation) \| `EXPIRED` | Separate borrower step (§5.3, CR-20). | [INFERRED] |
| 9 | Asset control | `AVAILABLE` \| `LOCKED` (the control token is held inside the lock) | One canonical control per asset at any time. | S §11.5 split per SYS §4.5 [INFERRED] |
| 10 | Collateral lock (pledge) | `ACTIVE` → `RELEASED` | History is never overwritten. | S §11.5 |
| 11 | Release request | `REQUESTED` → `INFORMATION_REQUESTED`* → `REQUESTED` → `AUTHORIZED` (lock → `RELEASED`) \| `REJECTED` (lock stays `ACTIVE`); `WITHDRAWN`* | Copies: `Release requested. The collateral lock remains active.` / `Release requires the designated lender's authorization.` | S §11.5; *[INFERRED] (S gap I-3) |
| 11a | **Pledge display composite** (list filter, pill) | `Available` · `Active` · `Active · release requested` · `Active · release rejected` · `Released` | Derived from #9–#11. These are S's `AVAILABLE/ACTIVE/RELEASE_REQUESTED/RELEASE_REJECTED/RELEASED`. | S L825–833; P-Dash |
| 12 | Case stage (projection, never editable) | `DRAFT`, `EVIDENCE_COLLECTION`, `VERIFICATION`, `LENDER_REVIEW`, `PROPOSAL`, `PLEDGE_ACTIVE`, `RELEASE_REVIEW`, `CLOSED`, `REJECTED`, `CANCELLED` | Cancelling after the lock does **not** release it. Close needs a dependency check. Derivation rules: §1.5.1. | S §11.6 |
| 13 | Command | `PREPARED` → `SUBMITTED` → `COMMITTED` → `PROJECTED`; `REJECTED`, `FAILED`, `UNKNOWN_OUTCOME`, `PROJECTION_DELAYED` | Mapping from Canton responses: §1.5.2. A timeout is `UNKNOWN_OUTCOME`, never a failure. | S §15.3; MP L141–143 |
| 14 | Access grant | `REQUESTED` → `PARTIALLY_CONSENTED`* → `GRANTED` \| `DECLINED`; `GRANTED` → `REVOKED` \| `EXPIRED` | Expiry is checked at download. Multiple data owners may need separate consent. | S L725, L905; states [INFERRED] |
| 15 | Invitation | `PENDING` → `ACCEPTED` \| `DECLINED` \| `EXPIRED` \| `REVOKED` | | [INFERRED] |
| 16 | Organization / membership / party binding | Org `DRAFT → PENDING_APPROVAL → ACTIVE → SUSPENDED`; membership `PENDING \| ACTIVE \| DISABLED`; binding `REQUESTED → ACTIVE → REVOKED` | Admin approval is required before a binding becomes active. | S L519, L890; states [INFERRED] |
| 17 | Export job | `QUEUED` → `GENERATING` → `READY` → `EXPIRED` \| `FAILED` | Access is re-checked at generation and at download. Reports carry cutoff, watermark, schema version and checksum. | S L908, L751; states [INFERRED] |
| 18 | Governance proposal (DM lifecycle) | `OPEN (n of 3 confirmations)` → `EXECUTABLE` (≥2 live, distinct, member confirmations) → `EXECUTED`; `CANCELLED` (proposer cancel); `STALE` (registry version moved, or deadline passed; derived; execute fails) | **DM has no "reject" vote** and proposals have no native expiry; confirmations expire after `actionConfirmationTimeout`. See CR-28. | [READ: DM §3–§4]; Collara states [INFERRED] |
| 18a | Seat confirmation | `NONE` \| `CONFIRMED (expires at …)` \| `EXPIRED` | | DM §3.3 |
| 19 | Verifier registry entry | `ACTIVE` \| `SUSPENDED` (+ display-only `Proposed` for an open Add proposal) | Suspension blocks new assignments and new attestations; issued attestations stay historical. | P-Dash §3.8; DM §7.3 |
| 20 | Pilot request | `RECEIVED` → `NOTIFIED` \| `NOTIFY_RETRY` | Stored first. Email failure is not a failed request. | S L632; states [INFERRED] |

#### 1.5.1 Case-stage derivation and "next actor" (projection rules) [INFERRED, consistent with S §11.6 and P-Dash §5.3]

Evaluate top-down; the first match wins.
1. `CANCELLED` if the case was cancelled before any lock.
2. `CLOSED` if the lock is `RELEASED`, or the case was closed after a dependency check. Next action: `Export case history`.
3. `RELEASE_REVIEW` if a lock is `ACTIVE` and a release request is `REQUESTED`/`INFORMATION_REQUESTED`. Next actor: lender approver (or the borrower when information was requested).
4. `PLEDGE_ACTIVE` if a lock is `ACTIVE`.
5. `PROPOSAL` if the review is `ELIGIBLE`. Sub-steps: issue (approver), accept (borrower), authorize activation (borrower), activate (approver).
6. `REJECTED` if the review or the verification is `REJECTED`.
7. `LENDER_REVIEW` if the package is shared (review `SUBMITTED`/`IN_REVIEW`/`NEEDS_INFORMATION`/`PENDING_APPROVAL`). Next actor: `IN_REVIEW` → analyst; `PENDING_APPROVAL` → approver; `NEEDS_INFORMATION` → borrower.
8. `VERIFICATION` if a verification request is open.
9. `EVIDENCE_COLLECTION` if the case exists but required evidence is missing (copy `Required evidence is missing. Review the checklist before submitting.`).
10. Otherwise `DRAFT`.

Every case header shows: `Next actor`, next-action CTA, blocker, data source (`Ledger-committed` / `Application record`), and `Ledger synced · offset N · HH:MM:SS UTC` from the worker checkpoint (MP L93).

#### 1.5.2 Command lifecycle ↔ JSON Ledger API v2 responses [VERIFIED codes: CAN §5; mapping INFERRED]

| Observation | Command state | UI copy (S §18.2, verbatim) |
|---|---|---|
| Row persisted, deterministic `commandId` = hash(org, actor, operation, payload hash); new `submissionId` per attempt | `PREPARED` | — |
| HTTP call in flight | `SUBMITTED` | `Submitted. Waiting for ledger confirmation.` |
| `200 {updateId, completionOffset}` | `COMMITTED` | `Confirmed on the ledger.` (**only** in LOCALNET, with an update id) |
| Worker applied the update (same `updateId`) | `PROJECTED` | (normal view) |
| Committed but not yet projected after N s | `PROJECTION_DELAYED` | `The action is confirmed. This view is still synchronizing.` |
| Timeout or 5xx | `UNKNOWN_OUTCOME`. Reconcile by resubmitting the same change id: `409 DUPLICATE_COMMAND` with `context.accepted:"true"` and `completion_offset` means it was committed. Or read `/v2/commands/command-completions`. | `Confirmation is delayed. We are checking the original submission before retrying.` |
| `409 LOCAL_VERDICT_LOCKED_CONTRACTS` (retryInfo 1 s) | Retry the same change id, bounded | — |
| `404 CONTRACT_NOT_FOUND` after contention | `REJECTED` (definite) | `This action could not complete because the asset workflow state changed.` |
| `400 DAML_AUTHORIZATION_ERROR` | `REJECTED` (definite; no completion is emitted) | `This record is unavailable to your account.` / `Release requires the designated lender's authorization.` |
| 401/403 from the ledger, or ledger down | `FAILED` (pre-commit, infrastructure) | `The ledger is unavailable. No confirmed state change has been recorded.` |

Additional facts:
- The dedup window defaults to `PT168H` [VERIFIED: CAN].
- Non-submitting stakeholders see `commandId: ""`, so correlate by `updateId` [VERIFIED: CAN].
- Never show a generic `Success` (S L1138).

### 1.6 Synthetic fixtures (canonical)

| Item | Value | Source |
|---|---|---|
| Case / asset | `CL-001` / `ASSET-DEMO-001`, namespace `collara-localnet` | MP L161; P-Dash |
| Equipment | `CNC machining center`, model `DEMO-CNC-500`, serial `SYNTH-CNC-001`, year 2019, manufacturer `Demo Machine Works (synthetic)`, location `Demo Manufacturer facility · Ohio, US (declared)` | MP L162; P-Dash §3.4 |
| Orgs | Demo Manufacturer (borrower), Demo CNC Dealer, Demo Verifier, Demo Lender A (selected), Demo Lender B (unrelated), Demo Auditor, plus the Collara registrar/operator [INFERRED] | MP L163–164 |
| Money | Valuation **USD 150,000.00**; requested principal **USD 100,000.00** (66.7%, under policy `CP-2026-CNC-01` max 70%) | MP L165 wins over the prototype's 105,000 (CR-12) |
| Documents | Synthetic invoice, photos (6 JPEG), scoped inspection report (v1→v2), **maintenance summary** (MP wording; the prototype called it "Maintenance log"), plus purchase agreement v1 (prototype; optional) | MP L167; P-Dash §4.3 |
| Ids | `VR-001`, `ATT-001`, `PKG-001 v2`, `CA-001`, `FP-001`, `PL-001`, `RR-001`, `RPT-0001…`, `GP-001…`, `VER-001…`. Display ids are kept in the DB and carried as Daml `Text` refs, separate from contract ids. | P-Dash §4.6 vocabulary; S L1182 |
| Seed profile **main** | Registered, attested (`ATT-001`), `PKG-001 v2` shared with Lender A, lender review `SUBMITTED` ("Awaiting lender review"), **no proposal, no lock** | MP L167; L hero preview |
| Seed profile **clean-start** | Orgs, parties, users and registry only. The demo exercises registration and verification. | MP L167 |
| Walkthrough | review → eligible → proposal → borrower acceptance → activation authorization → pledge activation → release request → lender authorization → auditor grant → scoped export | MP L169 (+ the §5.3 authorization step) |
| Negative checks | Lender B cannot access; verifier/dealer see no terms; auditor sees only granted records; borrower self-release fails; concurrent activation commits at most once; replacement-control, archive and replay bypasses fail | MP L169, §11 |
| Dates | In LOCALNET, **every date is real ledger time or seed-relative** (e.g. proposal expiry = seed + 14 days). Do **not** hard-code `2026-10-05` (FP-001 expiry in the prototype), or the demo breaks after judging begins (R-08). | [INFERRED] |
| Prototype filler rows CL-002…CL-005 | Create in LOCALNET **only through real workflows**: CL-004 awaiting approval, CL-002 needs information, CL-003 active, CL-005 released. Drop any row that cannot be produced. UI_MOCK fixtures must mirror the LOCALNET seeds. | MP L171; PDB §4.2 |

---

## 2. Conflict register

**Format:** **ID — topic.** Sources (★ marks the newer or winning side). **Resolution.** Items tagged **BLOCKING** are collected in §2.1.

| ID | Topic | Sources | Resolution |
|---|---|---|---|
| CR-01 | Demo/mode label | S L1074 and P-Dash/P-Land use `Demo data — LocalNet`; ★MP L101–102 uses two mode labels | Use MP's strings, driven by `COLLARA_MODE`. Retire `Demo data — LocalNet` everywhere, including the hero preview chip. Keep `Illustrative demo case` there. |
| CR-02 | "Canton LocalNet" wording vs actual runtime | MP L102 and the hackathon's "reproducible LocalNet demo" vs this machine (no Docker → `dpm sandbox`, not Splice LocalNet) | Keep MP's banner string. Docs and health state the exact topology: "Canton 3.5.19 sandbox via dpm (1 or 3 participants), not Splice LocalNet". Flag to the user, because judges may expect cn-quickstart. Not product-blocking. |
| CR-03 | Promoting `Explore the demo` when only UI_MOCK works | L L51, S L192, ★MP L104 | Default: keep pre-demo copy until LOCALNET works end to end. The LocalNet disclosure is true only in LOCALNET. Ask the user (Q-01) whether a UI_MOCK walkthrough may be promoted with new disclosure copy. |
| CR-04 | Footer `Demo` link | S L436 always lists it; S L452 forbids dead links | Show it only when `PUBLIC_DEMO_STATUS=localnet`. The prototype already omits it. |
| CR-05 | Pre-demo final CTA unspecified | L L289 vs prototype | Mirror the hero: `Request a pilot` + `Read the workflow` (decorative arrow is `aria-hidden`). Confirm (Q-02). |
| CR-06 | Case Workspace tabs | S: 8 (Summary…Sharing…Activity); ★MP: 6 incl. `Sharing & Access`; P-Dash: 8 | Union, in this order: Summary · Evidence · Verification · Sharing & Access · Review · Proposal · Pledge · Activity. |
| CR-07 | Governance visibility when the module is not real | S L535/L761 hide it; ★MP L155 says show it as simulated/unavailable | Show the entry to mandated users with an integration-status badge (§1.1). UI_MOCK keeps the prototype's `SIMULATION` callout. Working confirm buttons appear only with Tier A/B ledger integration. |
| CR-08 | Verifier Registry screen | ★MP #8 requires it; S has no route | `/app/governance/registry` (default tab) plus `GET /api/verifiers`. |
| CR-09 | Build order | S §22 Daml-first; ★MP §10 frontend mock first | Follow MP. Keep the landing on pre-demo copy until LOCALNET works. |
| CR-10 | Docker Compose | MP L42 assumes it; this machine has no Docker | Native Windows + WSL path here (§4). Ship a compose file for other machines, marked **untested here**. |
| CR-11 | MinIO | MP L37 "may use MinIO"; ★reality: MinIO community is archived, the Windows binary returns HTTP 410, Docker Hub repos return 404 [VERIFIED: WEB §11.1] | SeaweedFS 4.48. Record it in the ADR. |
| CR-12 | CL-001 principal | P-Dash, P-Land, P-Docs: USD 105,000 (70%); ★MP L165: USD 100,000 | **USD 100,000.00** everywhere, including the hero preview `Requested principal (illustrative)`. Derived ratio 66.7%. |
| CR-13 | Overview sums principal and valuation across cases vs "never summed" copy | P-Dash L1286 vs its own Review copy; S §9.1 allows per-currency aggregates with coverage once reconciled | Show per-currency `Recorded financing principal` / `Recorded collateral valuation` only from projected, ledger-committed records, with a coverage line. Otherwise show `Not available` (never 0). Reword the Review note to "not summed with other currencies" (needs copy approval) or drop it. |
| CR-14 | Verification before a case exists | S journeys verify first; S API is case-scoped | Asset-level requests (`POST /api/assets/:id/verification-requests`) with an optional case ref. The case's Verification tab shows the asset's attestation. |
| CR-15 | Pledge table mixes three objects | S L825–833 | Split into control, lock and release request (§1.5 #9–#11) plus a display composite. |
| CR-16 | Missing states | S gaps I-3, I-4, I-5 | Add `PENDING_APPROVAL`, release `INFORMATION_REQUESTED`/`WITHDRAWN`, verification `DECLINED`/`CANCELLED` [INFERRED]. |
| CR-17 | Verifier trust anchor | S §23 "Lender-approved scoped verifier" vs S §14/§16 governance registry | Both layers. The governance registry (2-of-3) admits and suspends, and is a hard on-ledger gate for issuance. The lender separately accepts or rejects a case's attestation in review. Not blocking. |
| CR-18 | Who issues the proposal | S §3 vs §14.2 | Analyst drafts (`DRAFT`); approver issues (`ISSUED`). |
| CR-19 | Who requests release | S §9.15 borrower only; S §12.1/§14.2 also lender case role; P-Docs: owner only | Ledger and API allow the borrower and the lender approver. The MVP UI exposes the borrower path (the lender path is P1). |
| CR-20 | Activation actors | S L952/L1085 vague; P-Dash "Authorized by Demo Manufacturer (borrower mandate) · Demo Lender A (approver mandate)"; P-Docs "co-authorizes" for both | The borrower authorizes (an explicit step creating `PledgeActivationAuthorization`), then the lender approver activates (consumes `AssetControl`). Forced by Daml authority plus the cross-participant rule (§5.3). The approved acceptance copy stays accurate. Confirm (Q-04). |
| CR-21 | P-Docs permission matrix vs S §12.1 | Export: P-Docs says dealer/verifier "—"; S says granted/assigned subset. Request release: P-Docs owner only. | S wins (§1.4.1). Update the Docs page matrix from the same typed source as the API permission tests. |
| CR-22 | Governance scope | Strategy H / idea-context: governed release, dispute, freeze; ★R, V, S, MP: registry only | Registry only (`Add verifier`, `Suspend verifier`). Governance can never release (test it). |
| CR-23 | Ownership transfer | D4, H, metrics check #4, registration demo; ★MP L17 excludes it | No transfer feature or choice. Replace check #4 with "replacement-control / generic-archive / replay bypass rejected". Update the metrics checklist and demo script (Q-08). |
| CR-24 | Lender B semantics | H: competing lender with offer B; ★MP: unrelated, no access | Unrelated. The prototype's governance seat for Lender B goes through a separate `gov-seat-2` party. |
| CR-25 | `AcceptAndLock` atomic | H; ★S/MP: separate steps | Separate accept, authorize and activate. Atomicity applies to consuming the control. |
| CR-26 | Default / cure / enforcement | H; ★S/L/MP | Excluded. |
| CR-27 | Command `FAILED` state | S has it; MP lists rejected/unknown/delayed | Keep `FAILED` for pre-commit infrastructure failures. |
| CR-28 | Governance votes and expiry semantics | P-Dash/P-Docs: "Reject proposal", "2 rejections close", "expiry 14 days"; ★DM: confirm-only, confirmations expire, proposals never expire natively | Model DM truthfully. Seats can **Confirm**; the proposer can **Withdraw** (`GovernableAction_ProposerCancel`). No reject votes. Proposal deadline enforced in Collara's `executeImpl` (default 14 days, from the prototype). Confirmation timeout is configurable (DM tests use 30 min; choose ≥ demo length) [INFERRED]. |
| CR-29 | Governance seat holders | P-Dash: Lender A, Lender B, Auditor ("Audit lead mandate"); MP: "three eligible members" | Keep the prototype seats through separate member parties. Note the privacy coupling (R-06). Confirm (Q-06). |
| CR-30 | Pilot form fields | PLD §4 "no source"; ★S §6.1 defines them | Use S §6.1 (§1.2.4). |
| CR-31 | `Sign in` target | P-Land → dashboard file; ★L → `/login` | `/login`. Signed-in users may see `Open workspace` [INFERRED; needs copy approval]. |
| CR-32 | `Product` nav anchor sits on The problem section | L | Keep as approved. |
| CR-33 | Two palettes and breakpoints | Marketing #08090A… with 920/560 px; app #101116… with 900/560 px | Two token scopes in `packages/ui` (`[data-surface=marketing\|app]`) with shared semantic names. Unification is optional later. |
| CR-34 | Contrast failures in approved visuals | P-Land `#62666D` 3.45:1; P-Dash `#676A75` 3.32:1, `#4E515B` 2.45:1; white on danger red 2.88:1 vs ★MP L95 accessibility | Raise to AA: marketing subtle ≈ `#7E828A` (5.17:1), app tertiary ≈ `#8A8D98`; dark text on danger, or a darker red. Visual hierarchy shifts slightly; tell design. |
| CR-35 | Logo colorway | `collara-logo.png` teal `#0F766E` (00:33) vs `collara-mark.png` white (00:36, used by the prototype) | Use the prototype's white mark (MP: "preserve the approved logo"). Derive an SVG `currentColor` master, a dark variant and a small-size variant. Teal stays an open question (Q-07). |
| CR-36 | Hero status dots (earlier screenshot) | `pasted-1790817851444-0.png` vs current HTML | The current HTML is authoritative (no dots). |
| CR-37 | Dashboard nav icons | P-Dash uses the logo mark for every item; the earlier screenshot used dots | Lucide icons (MP L34). |
| CR-38 | Linear/Mercury values copied near-verbatim | UPL §6 vs ★MP L74 | Collara-owned semantic tokens. Generic neutrals may stay close. Never use Arcadia fonts, brand assets or copy. |
| CR-39 | ESLint version | "v9 flat config" (task) vs ESLint 9 EOL 2026-08-06; ESLint 10 crashes `eslint-config-next` [VERIFIED: WEB §13] | ESLint 9.39.5 + eslint-config-next 16.3.8 (dev-only exposure). Revisit later. |
| CR-40 | TypeScript "latest" 7.0.2 | typescript-eslint needs <6.1 [VERIFIED: WEB] | TS 6.0.3, no `baseUrl`. |
| CR-41 | Keycloak and DM ports | Keycloak defaults 8080/9000 = DM HTTP/Noise defaults; WEB's PS example used 8081 = DM node 1 | Port map in §4.2 (Keycloak 18080/19000). |
| CR-42 | DM SDK 3.4.11 vs Collara 3.5.12 | CAN §8.1, DM §8 | **Resolved by SPIKE:** SDK 3.5.12 / LF 2.2 consumes the DM DARs and runs `GovernanceRules` on Canton 3.5.19. Keep a single SDK, 3.5.12. |
| CR-43 | DM tested runtime 3.5.8 vs ours 3.5.19 | DM §8 | Tier A verified on 3.5.19. Tier B: try 3.5.19 first (same as dev), fall back to Canton OSS 3.5.8 (DM's CI target). |
| CR-44 | Contract keys | S L966 "verify"; CAN: present in LF 2.3 but **non-unique** [VERIFIED] | No keys. LF target 2.2 explicit. |
| CR-45 | Docs page claims "Pre-build / Implemented: None" | P-Docs vs the build | Config-driven capability status. `#setup` is written only from verified commands. |
| CR-46 | Docs timeline vs workflow-table state names | P-Docs: CA-001 `SUBMITTED → IN_REVIEW`; package `NOT_SUBMITTED → SUBMITTED` | Consistent once read as *lender-review* states: sharing moves review `NOT_SUBMITTED→SUBMITTED`; the analyst starts `SUBMITTED→IN_REVIEW`. |
| CR-47 | Prototype fixture defects | Missing `CHANGES_REQUESTED→IN_REVIEW` event; verifier checks cite the purchase agreement although it is outside the verifier's scope; Asset Activity shows lender-internal events; "Verifier seat 1" naming; RPT-0007 watermark in scenario A; `auditGrant` binding bug | Fix in the rebuild: add the event; share the purchase agreement with the verifier **or** change the finding; scope the asset feed; rename to "Inspector · Demo Verifier"; derive watermarks from data. |
| CR-48 | Prototype pre-baked scenario B | P-Dash tweak `Release review` vs ★MP L167 seed "awaiting review, no proposal, no lock" | LOCALNET reaches release review only by walking the flow. UI_MOCK may keep a dev-only scenario switch. |
| CR-49 | Auditor grant timing | P-Dash grants automatically after release vs S happy path step 9 (explicit grant) | Explicit `Grant audit access` by each record owner (borrower and lender). |
| CR-50 | Release reasons | S L717 includes collateral substitution (P2) | MVP select: External loan completion · Refinancing · Administrative correction (lender approval). |
| CR-51 | MP doc list vs prototype package | MP: invoice, photos, inspection report, maintenance summary; prototype: + purchase agreement | Required: MP's four. Purchase agreement is optional fifth (owner-claim source). |
| CR-52 | Demo video length | H/X: 5 min; R: 2:30 | Hackathon logistics; confirm the official limit (Q-09). Not product. |
| CR-53 | Registration form tech stack field | R: React/Tailwind/Docker Compose | Update to the actual stack before submission. |
| CR-54 | Notifications | S §18.1 lists email events | MVP: in-app header inbox only. Email is P1 (no PII in either). |
| CR-55 | `/security` | S P1 vs no link | Defer. Never claim certifications. |
| CR-56 | Stray artefact | `C:\Collara\docs\_research\daml.yaml` (0 bytes, 2026-10-01 23:39) | Delete it. If `dpm` is ever run in that folder, an empty `daml.yaml` could be mistaken for a project root [INFERRED]. I did not touch it (my scope is this notes file). |

### 2.1 Genuinely blocking product decisions (guessing would make the build incorrect)

- **BPD-1 — Legal and consent content.** Needed: Privacy notice, Terms, pilot-form consent wording, retention period for pilot submissions, and the operational inbox or contact for notifications.
  - Why blocking: S says these are legal texts requiring review ("not legal text"). The footer links `/privacy` and `/terms`, and "no dead links" applies. Any guessed text would be an invented legal commitment.
  - Until resolved, `/privacy` and `/terms` cannot be published, and the pilot form must not go live on a public URL collecting real personal data.
  - Everything else (DB table, API, validation, local testing) can proceed.

Nothing else in the sources is blocking in that strict sense: every other conflict has an authoritative or safe default. The items below are **"confirm, but proceed with the default"** decisions. Proceed now and ask in parallel:

| Q | Decision | Default used here |
|---|---|---|
| Q-01 | May a UI_MOCK walkthrough be promoted on the landing, and with what disclosure? | No. Pre-demo copy until LOCALNET works (MP L104). |
| Q-02 | Pre-demo final CTA | Mirror the hero (prototype). |
| Q-03 | FAQ `Does the demo move money?` in pre-demo mode | Keep (approved copy; true once the LOCALNET demo exists). |
| Q-04 | Activation as two steps (borrower `Authorize pledge activation`, then lender `Activate pledge`) vs folding borrower consent into proposal acceptance | Two steps. Folding would change the meaning of the approved acceptance copy. |
| Q-05 | Suspension policy for **existing** attestations at a **new** activation | S default: a suspended verifier's attestation needs re-review before a new activation (S L849). Issued attestations stay historical. |
| Q-06 | Governance seat holders and node operators | Prototype seats (Lender A, Lender B, Auditor) through separate member parties. The UI states that one operator runs all local nodes. |
| Q-07 | Logo colorway (teal vs white), and AI-logo IP / trademark clearance | White mark; SVG redraw; raise IP as a non-engineering item. |
| Q-08 | Replace metrics check #4 (transfer) | Replacement-control / archive / replay bypass tests. |
| Q-09 | Hackathon video length and eligibility rules ("1,000 Mana / 10 activity days") | Unknown; verify the official rules. |
| Q-10 | Accept the "Lockbox" narrowing if the schedule slips | Not assumed. MP scope governs; see R-01 for the slice order. |
| Q-11 | Replacement copy for "planned"/"will include" phrases once tests pass | Keep the current tense until approved copy exists. |

---

## 3. Pinned version matrix

### 3.1 Daml / Canton / ledger / governance

| Component | Pin | Evidence | Compatibility notes |
|---|---|---|---|
| Installer | **dpm 1.0.22** | [VERIFIED: CAN] `%APPDATA%\dpm` (not `.dpm`); Git Bash needs `dpm.cmd` | The legacy `daml` assistant is gone. |
| Daml SDK | **3.5.12** (stable, 2026-09-24) | [VERIFIED: CAN] | Bundles damlc / daml-script / codegen **3.5.3**. |
| Canton | **3.5.19** open source (inside SDK; `dpm sandbox`) | [VERIFIED: CAN] `/v2/version` = 3.5.19 | Protocol version 35. In-memory; identities rotate on restart. |
| Daml-LF target | **2.2, explicit** `build-options: [--target=2.2]` | [VERIFIED: CAN, SPIKE] | Must stay 2.2: DM DARs are LF 2.2 and keys (2.3) are not unique. |
| Contracts package flags | `-Werror=template-interface-depends-on-daml-script` | [VERIFIED: CAN] | Tests and scripts live in separate packages. |
| DM governance DARs | **DLC-link decentralization-manager v1.12.0** (commit `4d650edbbf851852311a4921af8f5df608450a6b`) `releases/v1/governance-action-v1-0.1.0.dar` (pkg `48acd500…`, sha256 `4fc7912d…1e485`), `governance-core-v1-0.1.0.dar` (pkg `361d1f28…`, sha256 `b8d05903…a9544`; bundles `splice-util-0.1.4` `b7356fbb…`) | [READ: DM §1]; sha256 re-checked [VERIFIED: SPIKE] | HEAD `63a7898` has identical DARs. Vendor them into `daml/collara/vendor-dars/` and commit checksums. |
| DM SDK vs Collara SDK | DM builds with 3.4.11; **Collara stays on 3.5.12** | **[VERIFIED: SPIKE]** data-dependency keeps interface pkg id `48acd500…`; 2-of-3 Daml Script passes on the IDE ledger and on live Canton 3.5.19 | No need to install SDK 3.4.11. |
| DM application (Tier B only) | `dec-party-manager` **v1.12.0**, image `public.ecr.aws/dlc-link/decentralization-manager:v1.12.0@sha256:54ec6ce6783d7bc32f765f40e541b9584d32dd737a12434c8f426df381d7039d` (amd64 manifest `sha256:563f1ae1…`; binary layer `sha256:4f06a12e…` ≈19.7 MB) | [READ: DM §1] | Linux amd64 only. Run in WSL. Tested by DM against Canton 3.5.8 / PV35; untested against plain Canton OSS. |
| Canton for Tier B (WSL) | **3.5.19 OSS tarball** (first try) / **3.5.8** (fallback = DM CI) | [INFERRED] | 3 participants + sequencer + mediator, synchronizer alias `global`, PV35, unsafe-HMAC auth. |
| JSON Ledger API client | **openapi-fetch 0.17.0** + types generated by **openapi-typescript 7.13.0** from the node's `/docs/openapi` (commit `openapi-3.5.19.yaml` + `.d.ts`; CI re-fetches and diffs) | [VERIFIED: CAN §6] | Use package-name template ids `#collara-contracts:Module:Template`. |
| Daml payload types | `dpm codegen-js` output + **@daml/types 3.5.3** (override the non-existent 3.5.12 peer) | [VERIFIED: CAN] | Or hand-written Zod schemas in `packages/canton`. |
| Optional client | `@canton-network/core-ledger-client` **1.13.0**, exact pin | [VERIFIED: CAN] works against 3.5.19 | 63 deps, weekly churn, empty README. Not the primary path. |
| Do not use | `@daml/ledger`, `@daml/react` 2.10.6 (JSON API v1) | [READ: CAN] | Incompatible with Canton 3.x. |
| Ledger auth (local) | `unsafe-jwt-hmac-256` with `target-audience`; HS256 tokens `aud`=audience, `sub`=ledger user; **TTL ≤ 300 s** (or raise `max-token-lifetime`) | [VERIFIED: CAN §3] | `--dar` with auth enabled makes the sandbox exit. Upload DARs through `POST /v2/dars` with an admin token. |
| Ledger auth (prod) | `jwt-jwks` against Keycloak | [READ: CAN] | Scope-based tokens are deprecated (removal planned for 3.7). |
| Java | Temurin **21.0.12.1** | [VERIFIED] | Canton and Keycloak both run on it. `JDK_JAVA_OPTIONS=-Xmx1g` for the sandbox. |

### 3.2 Web / API / data (from WEB §3, verified install with pnpm 11.13 and no peer issues)

| Area | Pin |
|---|---|
| Runtime | **Node 24.21.0** (`engines >=24.15.0 <25`). The machine has 24.16.0, which works but lacks security releases 24.17.0 and 24.18.1. Node 24 enters maintenance 2026-10-20; Node 26 becomes LTS 2026-10-28. |
| Package manager | **pnpm 11** (`packageManager: pnpm@11.28.2`; machine 11.13.0). Settings live in `pnpm-workspace.yaml`. `allowBuilds: {esbuild: true, unrs-resolver: true, sharp: true}`. `minimumReleaseAge: 1440` (strict once set). `catalogMode: strict`. Not pnpm 12. |
| Web | next **16.3.8**, react / react-dom **19.3.0** (fallback 19.2.8), typescript **6.0.3**, @types/node 24.19.0 |
| Styling and UI | tailwindcss + @tailwindcss/postcss **4.3.3**, postcss 8.5.28, **shadcn 4.21.0** with base **Base UI** (`-b base -p nova`; the style cannot change after init), **@base-ui/react 1.8.0**, **cn 0.4.0**, class-variance-authority 0.7.1, tw-animate-css 1.4.0, lucide-react 1.49.0 |
| Client data, forms, utilities | @tanstack/react-query (+devtools) **5.104.0**, @tanstack/react-table **9.2.4** (v9 API), react-hook-form **7.89.0**, @hookform/resolvers **5.9.1**, zod **4.6.5**, date-fns **4.4.0**, decimal.js **10.6.0**; optional recharts 3.10.1 (+ react-is 19.3.0) and motion 13.4.6 |
| API | fastify **5.12.5**, fastify-plugin 6.0.0, @fastify/{cookie 11.1.2, session 11.1.3, swagger 9.9.1, swagger-ui 6.1.1, multipart 10.1.2, helmet 13.1.1, rate-limit 11.2.0, csrf-protection 8.0.1}, **fastify-type-provider-zod 7.0.0** (zod ≥4.2 semantics), openapi-types 12.1.3, pino 10.3.1 |
| Data | drizzle-orm **0.45.3**, drizzle-kit **0.31.11**, pg **8.23.1**; session store connect-pg-simple 10.0.0 or a small Drizzle store; PGlite **0.5.8** (PostgreSQL 18.3) for unit tests only |
| Auth | openid-client **6.8.8**, jose 6.2.12; tests may use oidc-provider 9.12.2 |
| Storage SDK | @aws-sdk/client-s3 + s3-request-presigner **3.1143.0** (`forcePathStyle: true`, checksum calculation and validation `WHEN_REQUIRED`) |
| Tests | vitest **5.0.3** + vite **8.3.1** (explicit dependency) + @vitejs/plugin-react 6.1.1 + jsdom **30.1.1** + Testing Library (react 16.3.3, dom 10.4.2, user-event 14.6.7, jest-dom 7.0.1) + **@playwright/test 1.63.0**. Daml tests via `dpm test` (non-zero exit on failure, JUnit with `--junit`). |
| Lint | **eslint 9.39.5** + eslint-config-next 16.3.8 + typescript-eslint 8.71.0 |
| Dev runner | tsx 4.23.15. Node `--env-file-if-exists`; no dotenv. |
| Local infrastructure | **Keycloak 26.7.5** zip (Java 21) [VERIFIED: WEB]; **SeaweedFS 4.48** `weed.exe mini` [VERIFIED: WEB]; **PostgreSQL 16** (WSL 16.14; compose `postgres:16.15-alpine`) |

### 3.3 Compatibility notes and unresolved items

- **Same-origin `/api`.** Use a Next **Route Handler proxy** (`app/api/[...path]/route.ts`). Rewrites freeze the upstream origin at build time, cap bodies at 10 MB and drop `X-Forwarded-For` [VERIFIED: WEB §7]. `proxy.ts` must never match `/api`. Strip the `expect` header.
- **Large evidence uploads.** Browser → presigned PUT into `quarantine/` → `POST /api/evidence/:id/finalize` (server hashes, checks type and size, assigns the version) [INFERRED, WEB §7.1; MP L137].
- **Caching.** `cacheComponents` stays off. Workspace pages are dynamic `private, no-store`. Query keys are prefixed by org/user. Call `queryClient.clear()` on logout or org switch [WEB §7.2].
- **Unresolved:**
  - (a) Tier B (DM against plain Canton OSS in WSL) is untested.
  - (b) Explicit disclosure through the JSON API `disclosedContracts` is untested (it works in Daml Script). The §5 design avoids depending on it.
  - (c) Canton Postgres persistence is untested.
  - (d) Production build of the API and worker (tsc `nodenext` vs a bundler) is unverified.
  - (e) SeaweedFS IAM and least-privilege keys are untested.
  - (f) The `cn` package is 0.x and TanStack Table v9 is two months old.
  - (g) ESLint 9 is EOL.
  - (h) Several components need re-pinning on 2026-10-20/28 (Node 24 maintenance, Node 26 LTS); keep one upgrade window after submission.

### 3.4 Spike performed for this synthesis (evidence for CR-42)

- **Location:** `C:\Collara\.spike\dmi\` (throwaway; the same convention as CAN's `C:\Collara\.spike\`). Its first copy in the session scratchpad failed to build because of Windows path length.
  - The cause was the `.daml\package-database\2.2\daml-script-3.5.3-<64-hex>\…` nesting under a ~100-char base path.
  - **Implication:** keep the repo at a short path such as `C:\Collara\...` [VERIFIED].
- **Layout:** `vendor/` holds both DM DARs (sha256 matched DM §1). `gov/` is SDK 3.5.12, LF 2.2, data-depends on `governance-action-v1`, and defines `VerifierRegistry`, `VerifierAccreditation` and `AddVerifierProposal implements GovernableAction`. `test/` data-depends on both DM DARs plus `gov`.
- **Result:** `dpm build --all` OK. The built DAR contains `governance-action-v1-0.1.0-48acd500fc0bc9e4f00d52270122a104a68157f6d5561328f059f5eb6a63fd61.dalf`, so the interface identity is preserved.
- **`dpm test`:** `test_two_of_three: ok, 8 active contracts, 13 transactions`. It exercises five behaviours:
  - `GovernanceRules` threshold 2;
  - one confirmation → execute fails;
  - duplicate m1 confirmations → execute fails;
  - m1 + m2 → execute succeeds and `GovernanceExecutionResult.actionLabel == "CollaraAddVerifier"`, with the accreditation created;
  - a second proposal pinned to the archived registry v0 → execute fails.
- **Live node:** `dpm sandbox --dar …` (Canton 3.5.19, `-Xmx1g`), then `dpm script --wall-clock-time … --script-name Test:test_two_of_three` → `SUCCESS`. `GET /v2/packages` listed `splice-util` `b7356fbb…`. The sandbox was stopped with `taskkill /T`.
- **Not covered:**
  - deadline and confirmation-timeout staleness (it needs `passTime`; ledger time is not controllable on the live node);
  - suspension blocking attestation;
  - multi-participant topology;
  - the DM application itself.

---

## 4. Environment plan

### 4.1 This machine (Windows 11, no Docker; WSL2 Ubuntu 24.04 is currently **Stopped** [VERIFIED 17:1x UTC via `wsl -l -v`])

| Service | Plan here | Verified? | Notes / risks |
|---|---|---|---|
| **PostgreSQL** | **Option A (default):** WSL PostgreSQL 16.14 with a dedicated DB and role (`collara_dev`). | Partially. The cluster exists (WEB/CAN). `127.0.0.1:5432` is **not reachable from Windows** [VERIFIED: CAN; re-checked: `Test-NetConnection` False while WSL is stopped]. | Needed: (1) start WSL and keep it alive (WSL stops idle distros [INFERRED]; `scripts/db-up.ps1` runs a keepalive, e.g. `wsl -d Ubuntu --exec sleep infinity` in the background); (2) connect through the WSL IP (`wsl hostname -I`, 172.30.86.106 on 2026-10-01; it changes) **or** enable mirrored networking in `%UserProfile%\.wslconfig` (a user-level change; ask first); (3) `listen_addresses`/`pg_hba.conf` for the WSL subnet; (4) `sudo` inside WSL to create the role and DB (password requirement unknown). |
| | **Option B (fallback, unverified):** Windows-native PostgreSQL 16 binaries (EDB zip) via `initdb` + `pg_ctl` in user space, no admin. | No | Avoids WSL networking. Same major version as prod. [INFERRED] |
| | **PGlite 0.5.8** is for unit and repository tests only. | [VERIFIED: WEB] | Single connection, in-process, PostgreSQL 18.3. It cannot back API and worker together; not for migration checks. |
| **Object storage** | **SeaweedFS 4.48** `weed.exe mini -dir=.\.data\s3 -ip=127.0.0.1 -ip.bind=127.0.0.1 -bucket=collara-evidence -admin.ui=false` with `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` set (never run without them). | [VERIFIED: WEB] anonymous GET 403; presigned GET/PUT 200; private by default | Prefixes `quarantine/` and `evidence/`. Least-privilege IAM untested. |
| **OIDC** | **Keycloak 26.7.5** zip: `kc.bat start-dev --http-port=18080 --http-management-port=19000 --import-realm`, realm `infra/keycloak/collara-realm.json` with `${COLLARA_OIDC_CLIENT_SECRET}` | [VERIFIED: WEB] full Auth Code + PKCE | ~27 s start. `accessTokenLifespan 300`. HTTP issuer needs `allowInsecureRequests` (dev only). Use `oidc-provider` in CI. |
| **Canton ledger (LOCALNET)** | `dpm sandbox` (SDK 3.5.12 / Canton 3.5.19), `JDK_JAVA_OPTIONS=-Xmx1g`, `--json-api-port 7575 --canton-port-file …`, `-c infra/canton/auth.conf` (HMAC). Gate on the ports file or `/readyz` 200. Upload DARs via `POST /v2/dars`; allocate parties and users; write `party_bindings`; run seed workflows through real commands. | [VERIFIED: CAN] incl. auth, contention, dedup, WebSocket updates | Ready in 36–54 s, 1.0–1.6 GB. **State and party ids reset on restart**, so the worker detects a reset (participantId change or ledger-end < checkpoint) and the scripts reseed. |
| | **3-participant mode** `-c infra/canton/extra-participants.conf` (JSON 7575/7576/7577) for cross-participant privacy and propose/accept tests | [VERIFIED: CAN] privacy holds; a joint `actAs` across participants is rejected | ~1.3 GB. Default for the privacy test suite [INFERRED]. |
| **BitSafe DM, Tier A** | DM DARs + Collara governance package on the same sandbox; a local `CollaraGovernance` party and 3 member parties; Collara's backend runs propose / confirm / execute through the JSON API. | **[VERIFIED: SPIKE]** 2-of-3 on Canton 3.5.19 | UI label: "Partial — governance contracts on one local participant; decentralized party not demonstrated". |
| **BitSafe DM, Tier B** | Inside WSL: Canton OSS 3.5.19 (fallback 3.5.8) with 3 participants + sequencer + mediator (alias `global`, PV35, unsafe HMAC); 3 × `dec-party-manager` v1.12.0 `--insecure` (binary extracted from the ECR layer with `curl`, no Docker); onboarding → `/dars/distribute` → `/contracts` (GovernanceRules) → Collara proposals via the Ledger API, confirm and execute via DM REST `core_domain`. | **No**; untested by DM maintainers too | Needs a JRE in WSL, ~282 MB Canton tarball, ~20 MB DM layer, several GB of RAM. Time-box it; Tier A is the guaranteed floor. |
| Web / API / worker | Next dev (Turbopack) on 3000; Fastify on 4000; worker (health on 4100) [INFERRED ports] | Next/Fastify [VERIFIED: WEB scratch] | Scripts in both PowerShell 5.1 (`.ps1`, no `&&`) and Git Bash (`.sh`, `dpm.cmd`). Stop sandboxes with `taskkill /PID <dpm> /T /F`. |

**Memory budget [INFERRED].** The machine has 16 GB; 2.8 GB was free when I checked.
- Sandbox: ~1.1–1.6 GB (3-participant mode ~1.3 GB).
- Keycloak: ~0.5–1 GB.
- Next dev: ~1 GB.
- API + worker: ~0.3 GB.
- SeaweedFS: ~0.2 GB.
- WSL VM with PostgreSQL: ~0.5–1 GB.
- Tier B adds several GB.

Running everything at once will not fit unless other apps are closed. Run Tier B separately, or use `next start` builds for demos.

**Disk.** About 15 GB free on C: after the 2.7 GB SDK install [READ: CAN].

### 4.2 Port map (one table for all local services) [INFERRED; avoids every collision listed in CAN/WEB/DM]

| Service | Ports |
|---|---|
| Next web | 3000 |
| Fastify API | 4000 (`API_INTERNAL_ORIGIN=http://127.0.0.1:4000`) |
| Worker health | 4100 |
| Keycloak | 18080 HTTP, 19000 management |
| SeaweedFS | S3 8333; master 9333; volume 9340; filer 8888; WebDAV 7333; Iceberg 8181; Lance 9101 (gRPC typically +10000: 19333/19340/18888) |
| Canton sandbox (Windows) | ledger 6865, admin 6866, sequencer 6867/6868, mediator 6869, JSON **7575**; extra participants 6875/6876/**7576**, 6885/6886/**7577** |
| Canton Tier B (WSL; reachable from Windows through localhost forwarding) | ledger 5001/5011/5021, admin 5002/5012/5022, JSON **7585/7586/7587**. Not 7575–7577, which would collide with the Windows sandbox. |
| DM nodes (WSL) | HTTP 8081/8082/8083, Noise 9001/9002/9003, metrics 9464/9465/9466 |
| PostgreSQL (WSL) | 5432, through the WSL IP or mirrored networking |

### 4.3 Documented path for other machines (Docker Compose) [INFERRED; **cannot be run or verified here**]

`infra/compose/compose.yaml` contains:
- `postgres:16.15-alpine`
- `chrislusf/seaweedfs:4.48` (`weed mini`, credentials from env)
- `quay.io/keycloak/keycloak:26.7.5` (`start-dev --import-realm`, realm mounted read-only)
- a **Canton** service, choosing one of:
  - (a) the same `dpm sandbox` inside a JDK 21 container, with SDK 3.5.12 installed by `dpm install` from the OCI registry (no Docker-in-Docker);
  - (b) Splice LocalNet 0.8.4 through cn-quickstart (Canton 3.5.19, ~12 GB of container limits, real "LocalNet").
- optionally 3 DM containers pinned by digest `@sha256:54ec…`.

Mark every compose file **"untested on the authoring machine"**. Only commands actually run go into `/docs#setup` (MP L200, L204).

### 4.4 What can and cannot be verified on this machine

- **Can be verified:**
  - Daml build and test;
  - sandbox command submission, contention, dedup, auth, update streaming and witness visibility (1 and 3 participants);
  - DM Tier A quorum;
  - Keycloak PKCE login;
  - SeaweedFS private presign;
  - Next build, Vitest and Playwright (Chromium);
  - API tests with PGlite;
  - full-stack LOCALNET once PostgreSQL connectivity is solved.
- **Probably verifiable with effort:** DM Tier B in WSL; Windows-native PostgreSQL zip.
- **Cannot be verified:** Docker Compose files; Splice LocalNet; DM's exact CI topology (Splice 0.6.12); multi-machine independent operators (and no local setup proves operator independence: MP L153).

---

## 5. Daml model sketch

All templates below are **[INFERRED] designs** built on verified mechanics: consuming-control contention [VERIFIED: CAN §4], the cross-participant single-submitter rule [VERIFIED: CAN §7], and the DM interface [VERIFIED: SPIKE]. They must be compiled, tested and **witness-checked** before anything is claimed (MP L125).

### 5.1 Packages and parties

```
daml/collara/multi-package.yaml          packages: contracts, governance, tests, scripts
daml/collara/vendor-dars/                governance-action-v1-0.1.0.dar, governance-core-v1-0.1.0.dar (+ SHA256SUMS)
daml/collara/governance/   (collara-governance-v0)   data-deps: governance-action-v1  -> registry, accreditation, proposals
daml/collara/contracts/    (collara-contracts)       deps: collara-governance-v0       -> core workflow
daml/collara/tests/        Daml Script invariant + privacy tests (data-deps: governance-core-v1 for GovernanceRules)
daml/collara/scripts/      seed profiles (main, clean-start) run with `dpm script` against the node
```
- Every `daml.yaml`: `sdk-version: 3.5.12`, `build-options: [--target=2.2]`. Contracts also use `-Werror=template-interface-depends-on-daml-script`.
- No contract keys anywhere.
- **Design rules:**
  - Every choice has **one controlling party per submission** (no `controller a, b` across organizations; CAN §7).
  - Cross-org steps use propose → accept.
  - Authority needed by a create comes from *signatories of the exercised contract ∪ controllers of the choice* in that frame. Authority does not accumulate across nested frames. This is why §5.3 needs a lender-controlled choice on a registrar-and-owner-signed control.

### 5.2 Contract families

Legend: **S** = signatories, **O** = observers, **C** = controller, (c) = consuming, (nc) = nonconsuming.

**A. Configuration**
- `CollaraConfig` — S: registrar; O: onboarded org parties (non-sensitive directory). Fields: `namespace` (`collara-localnet`), `governanceParty` (the **trusted** governance party), `suspensionPolicy`, `configVersion`. It pins the governance party so a forged accreditation cannot be used (DM §7.3 security point). Changed only by registrar (c) with version+1.

**B. Controlled registration and canonical control**
- `AssetRegistrationRequest` — S: owner; O: registrar. Fields: requestRef, namespace, identityCommitment (hash of normalized manufacturer/model/serial; details off-ledger or in the passport), ownerClaimRef.
  - `Request_Accept(ticketCid)` (c, C registrar): consumes an `IssuanceTicket`; creates `AssetControl` (v1) and `AssetPassport` (v1).
  - `Request_Decline(reasonCode)` (c, C registrar): generic reason; never reveals a duplicate owner.
  - `Request_Withdraw` (c, C owner).
- `AssetRegistry` — S: registrar; O: none. Fields: namespace, `issuedAssetIds : Set Text`, version.
  - `Registry_Reserve(assetId, owner)` (c, C registrar): asserts `assetId ∉ issued`, recreates with the id added, creates an `IssuanceTicket`.
  - **Exercised top-level by registrar**, never nested under an owner-signed choice. That keeps the owner from witnessing the set (privacy; R-05).
- `IssuanceTicket` — S: registrar; O: owner. Single-use (consumed in `Request_Accept`).
- `AssetPassport` — S: owner; O: none. Fields: assetId, namespace, passportVersion, equipment class, identity commitment, document refs as opaque ids plus hashes. **No valuation, no terms.**
  - `Passport_NewVersion` (c, C owner).
  - Archiving the passport never touches control or lock (they are separate contracts).
- `AssetControl` — **the canonical control token**. S: registrar, owner. O: `sharedLenders : Set Party`. Fields: namespace, assetId, controlVersion. **No loan terms, no lender notes.**
  - `Control_ShareWithLender(lender)` (c, C owner): recreates with the lender as observer. This is the "share with selected lender" ledger step, so the lender can later exercise without explicit disclosure.
    - **At most one shared lender at a time.** Assert `sharedLenders` is empty, and require `Control_RevokeLenderView` first. Otherwise a previously shared lender, as an observer of the consumed contract, would witness the recreated control and learn the next lender [INFERRED; see §5.6 #8].
  - `Control_RevokeLenderView(lender)` (c, C owner).
  - `Control_Activate(lender, authCid, statusCid, approverRef)` (c, **C lender**, a flexible controller taken from the argument):
    - asserts `lender ∈ sharedLenders`;
    - fetches and consumes `PledgeActivationAuthorization` (S: lender + owner) and asserts that assetId, controlVersion, lender, owner and expiry match;
    - asserts `now ≤ auth.attestationValidUntil` and that the authorization's manifest hash equals the current package version. The attestation fields were copied into the lender+borrower-signed authorization, and the lender's backend validates them against its verifier-signed `AttestationDisclosure` before submitting.
      - **Do not fetch the verifier-signed attestation inside activation.** Under Daml ledger-model rules, a fetch informs the fetched contract's **signatories** plus the actors [INFERRED; verify with a witness test]. That would tell the verifier about the pledge.
    - enforces the suspension policy by fetching the `VerifierStatusMirror` (see G) via `statusCid`;
    - **creates `CollateralLock`**. The frame authority is {registrar, owner, lender}.
  - `Control_Correct` (c, C owner): recreates with controlVersion+1. Only possible while available, because a locked asset has no `AssetControl`.
  - `Control_Retire` (c, C owner): creates a `RetiredControl` record. The id stays in the registry set, so it is never reissued.
  - The built-in `Archive` needs registrar **and** owner jointly.

**C. Collateral lock and release**
- `CollateralLock` — S: **registrar, owner, lender**; O: none. Fields: namespace, assetId, controlVersion (consumed+1, e.g. v3→v4 as in the prototype), lockRef (`PL-001`), caseRef, activatedAt, `authorizationRef` (hash or ref, **never terms**).
  - The **only** choice is `Lock_Release(releaseRequestRef, approverRef)` (c, **C lender**). It recreates `AssetControl` (controlVersion+1, observers reset to {}) and creates a `CollateralLockReleased` historical record (S: lender, owner; O: registrar).
  - No other choice exists. The built-in `Archive` needs all three signatories, so the borrower, the registrar, governance or the borrower+registrar pair cannot remove it.
- `ReleaseRequest` — S: requester (owner, or the lender acting as case role); O: counterparty. Fields: lockRef, lockCid, reason (`EXTERNAL_LOAN_COMPLETION | REFINANCING | ADMINISTRATIVE_CORRECTION`), noteRef, version, status (`REQUESTED | INFORMATION_REQUESTED`).
  - Creating it **never exercises the lock**, so the lock stays `ACTIVE` (invariant 6).
  - `Release_Authorize` (c, C the lock's designated lender): fetches the lock, asserts `lock.lender == lender` and that the asset matches, exercises `Lock_Release`, and creates `ReleaseDecision{Authorized}` (S: lender; O: owner).
  - `Release_Reject(reason)` (c, C lender): creates `ReleaseDecision{Rejected}`. **The lock is untouched.**
  - `Release_RequestInformation` (c, C lender) and `Release_Respond` (c, C owner): status toggle with version+1.
  - `Release_Withdraw` (c, C requester).

**D. Verification**
- `VerificationRequest` — S: owner; O: verifier. Fields: requestRef (`VR-001`), assetId, passportVersion, evidence package ref, version and manifest hash, scope checklist, optional caseRef, due date, status (`REQUESTED | IN_REVIEW | CHANGES_REQUESTED`).
  - `VR_AcceptAssignment(configCid, accCid)` (c, C verifier): re-checks the accreditation.
  - `VR_DeclineAssignment(reason)` (c, C verifier).
  - `VR_RequestChanges` (c, C verifier).
  - `VR_SubmitNewEvidence` (c, C owner).
  - `VR_IssueAttestation(configCid, accCid, …)` (c, **C verifier**):
    - fetches `CollaraConfig` and `VerifierAccreditation`;
    - asserts `acc.governanceParty == config.governanceParty`, `acc.verifier == verifier`, `status == Active`, `validUntil`, scope `CNC_MACHINERY`;
    - asserts the evidence version equals the request's;
    - creates `VerificationAttestation`.
  - `VR_Reject(reason)` (c, C verifier).
  - `VR_Cancel` (c, C owner).
- `VerificationAttestation` — S: **verifier**; O: owner. Immutable. Fields: attestationRef, assetId, passportVersion, evidence versions and manifest hash, checks (item, finding, result: `Checked | Checked · noted | Reviewed documents | Not checked`), limitations, method, inspectedAt, validFrom, validUntil, `supersedes`, verifier registry ref.
  - `Att_DiscloseTo(recipient, purpose, caseRef)` (**nc, C owner**): creates `AttestationDisclosure` (S: verifier + owner; O: recipient) carrying a copy plus the original cid. The verifier pre-authorizes owner-controlled sharing by signing a template that has this choice, so the lender sees a **verifier-signed** record without explicit disclosure. `AttDisc_Revoke` (c, C owner) limits future visibility only.
  - `Att_Revoke(reason)` (c, C verifier): creates a `RevokedAttestation` record.
  - A correction is a new attestation with `supersedes` that consumes the old one, making it `SUPERSEDED`.
  - `EXPIRED` is computed from `validUntil`.

**E. Evidence and scoped sharing (hashes and opaque refs only; bytes stay in private storage)**
- `EvidenceManifest` — S: owner; O: none. Fields: package ref (`PKG-001`), version, entries (docRef, type, version, sha256, sourceOrg, contributorRef). New version = consume + recreate.
- `DealerContribution` — S: dealer; O: owner. One per contributed document (docRef, sha256, version).
- `PackageShareProposal` — S: owner; O: dealer. Used only when the package contains dealer documents.
  - `Consent_Grant` (c, C dealer): creates a `PackageShare` signed by owner + dealer (frame authority {owner, dealer}). Grant state is `PARTIALLY_CONSENTED` until the dealer acts.
- `PackageShare` — S: owner (+ dealer when consented); O: recipient (lender or verifier). Fields: recipient, purpose, caseRef, manifest subset (docRef + hash + version), permission `VIEW | VIEW_DOWNLOAD`, expiresAt.
  - `Share_Revoke` (c, C owner).
  - The API checks an active `PackageShare` (projected) **at every download**; expiry is evaluated at download.
- The owner's "share with Lender A" action submits `PackageShare` creation, `Control_ShareWithLender` and `Att_DiscloseTo(lender)`, all owner-controlled [INFERRED].

**F. Lender review and financing (terms live only here)**
- `CollateralAssessment` — S: lender; O: none. Fields: caseRef, evidence snapshot (manifest version + hash), attestationRef, valuation (`Numeric 2`) + currency + source + date, limitations, outcome (`NEEDS_INFORMATION | ELIGIBLE | REJECTED`), policyRef, version, decidedByRef. **Internal notes and the internal risk view are off-ledger** (lender-org-scoped DB rows).
- `LenderDecisionNotice` — S: lender; O: owner. Outcome plus shared feedback only.
- `FinancingProposal` — S: lender; O: borrower. Fields: proposalRef, version, caseRef, assetId, principal (`Numeric 2`), currency, termMetadata, expiresAt, externalLegalRef, approverRef, evidence manifest hash, attestationRef, assessmentRef.
  - `Proposal_Accept(expectedVersion)` (c, C borrower): asserts the version and `now ≤ expiresAt`; creates `FinancingAgreement`. The frame authority is {lender, borrower}.
  - `Proposal_Decline` (c, C borrower).
  - `Proposal_Withdraw` (c, C lender). It exists only while the proposal exists, which means before acceptance.
- `FinancingAgreement` — S: lender, borrower; O: none. Holds the terms.
  - `Agreement_AuthorizeActivation(controlVersion, attestationRef, manifestHash, expiresAt)` (nc, **C borrower**): creates `PledgeActivationAuthorization`.
- `PledgeActivationAuthorization` — S: lender, borrower; O: none. Fields: assetId, expected controlVersion, lender, borrower, caseRef, agreementRef + version, attestationRef + validUntil + manifestHash, expiresAt. **No principal, currency or terms.** Single-use (consumed by `Control_Activate`).

**G. Verifier registry and governance** (package `collara-governance-v0`; DM pattern, partly verified by SPIKE)
- `VerifierRegistry` — S: governanceParty; O: operator. Fields: registryId, version, `activeVerifiers : Set Party`.
  - `Registry_Add` / `Registry_Remove` (c, C governanceParty). Version+1, with duplicate checks.
- `VerifierAccreditation` — S: governanceParty; O: operator, verifier. Fields: verifier, orgName, scope, status `Active | Suspended`, validUntil, registryVersion, reason.
  - `Accreditation_Suspend` (c, C governanceParty).
- `AddVerifierProposal`, `SuspendVerifierProposal` — S: proposer (a seat member, or the operator as `additionalProposer`); O: governanceParty. Both implement `GovernableAction`.
  - `executeImpl` checks the deadline, fetches the pinned `registryCid`, and asserts `version == expectedVersion`, the governance party and the accreditation match.
  - The labels `CollaraAddVerifier` / `CollaraSuspendVerifier` are permanent audit keys (DM §5).
- Bootstrap: a `BootstrapVerifierRegistryProposal` (governed) creates registry v0 and the genesis `VER-001` accreditation [DM §7.2(b)].
- **`VerifierStatusMirror`** — S: registrar; O: onboarded org parties. Registry status is non-sensitive directory data. The lender must be an observer so the **lender's participant holds the contract** and can use it as an input in a cross-participant submission. Fields: verifier, status, registryVersion, sourceExecutionRef.
  - Updated by the registrar's worker from `GovernanceExecutionResult` events.
  - Fetched in `Control_Activate` for the suspension-policy check, **instead of** the governance-signed accreditation (R-06).
  - A fetch informs signatories plus actors, not observers [INFERRED], so the other orgs are not told about the activation.
  - Trade-off: activation trusts the registrar's mirror (with latency). Issuance still checks the real accreditation on-ledger.

**H. Audit**
- `AuditGrant` — S: grantor (one grant per record owner: borrower for owner records, lender for lender records); O: auditor. Fields: grantRef, caseRef, resource scope (`EVIDENCE_MANIFEST | ATTESTATION | DECISION_OUTCOME | PROPOSAL_TERMS | PLEDGE_RELEASE_EVENTS`), permission `VIEW | EXPORT`, purpose, expiresAt.
  - `Grant_Revoke` (c, C grantor).
- Exports are produced off-ledger by the API/worker from projections visible to the grantor, filtered to the grant. Access is re-checked at generation and download. Each export carries cutoff, watermark (offset), schema version and checksum.
- **There is no global audit contract** (MP L121; S L928).

### 5.3 Happy-path transaction sequence and who submits (all single-submitter)

1. **Registration:** owner creates `AssetRegistrationRequest` → registrar `Registry_Reserve` (top-level) → registrar `Request_Accept(ticket)`. The asset becomes `REGISTERED`.
2. **Verification:** owner creates `EvidenceManifest` v1, then `VerificationRequest` → verifier `VR_AcceptAssignment` → `VR_RequestChanges` → owner manifest v2 + `VR_SubmitNewEvidence` → verifier `VR_IssueAttestation` (the attestation becomes `ATT-001`).
3. **Case:** created in the DB (off-ledger). Then sharing: owner [dealer `Consent_Grant`] → `PackageShare` to Lender A + `Control_ShareWithLender(LenderA)` + `Att_DiscloseTo(LenderA)`. Review moves to `SUBMITTED`.
4. **Review:** lender `CollateralAssessment`, then `IN_REVIEW → PENDING_APPROVAL` (analyst, via API mandate) → `ELIGIBLE` (approver) + `LenderDecisionNotice`.
5. **Proposal:** lender `FinancingProposal` v1 (approver) → borrower `Proposal_Accept(1)` → `FinancingAgreement`.
6. **Activation:** borrower `Agreement_AuthorizeActivation` → lender approver `Control_Activate`. This creates `PL-001`; the control goes from v3 to the lock at v4.
7. **Release:** borrower `ReleaseRequest` (lock untouched) → lender `Release_Authorize`, which runs `Lock_Release` and creates `AssetControl` v5. Rejection leaves the lock active.
8. **Audit:** borrower and lender each create an `AuditGrant` for Demo Auditor → the auditor runs the export via the API.

### 5.4 Invariant enforcement (MP §6, with S §11.7 cross-reference)

| MP invariant | S §11.7 | Enforcement (ledger first) | Required test (Daml Script and/or live node) |
|---|---|---|---|
| One active pledge per canonical asset in the namespace | #1 | Exactly one control token per asset (an `AssetControl` *or* a `CollateralLock`), maintained by consuming transitions. Issuance is unique through the registrar-only `AssetRegistry` set. **Not** a DB flag, UI check or key. | Two activations: second fails. Registry reserve of a duplicate id fails. |
| Activation consumes the same available control atomically | #2 | `Control_Activate` is consuming. Contention gives `409 LOCAL_VERDICT_LOCKED_CONTRACTS`, then `404 CONTRACT_NOT_FOUND` [VERIFIED mechanism: CAN §4]. | Live sandbox: two parallel `submit-and-wait` → exactly one 200 (repeat N times). Daml Script `concurrently` is **not** a contention test (CAN). |
| Controlled registration prevents a replacement control | #3 | An `AssetControl` create needs registrar **and** owner. The registrar's credential is used only by the registry service, which only creates controls through `Registry_Reserve` + `Request_Accept`. `Control_Correct` consumes the existing control. | Owner-only create of `AssetControl` → auth error. Duplicate reserve → fails. Correction while locked → no control exists, so it fails. **Documented trust:** registrar+owner collusion or credential theft could mint a second control. Duplicate physical-asset screening is off-ledger and best-effort (MP L114). |
| Exact-version acceptance; material evidence changes need handling | #5 | `Proposal_Accept(expectedVersion)` on the exact cid; a new version is a new contract. Activation asserts the manifest hash matches the attestation and the authorization. A new manifest version returns the review to `NEEDS_INFORMATION` (projection rule) and makes old authorizations unusable. | Accept with a wrong version fails. Activation after a manifest bump fails. |
| Only an active assigned verifier issues; expiry and suspension checked for new activation | #7, #8 | `VR_IssueAttestation` controller = the request's verifier. It fetches the governance-signed accreditation, pinned to `CollaraConfig.governanceParty`. Activation checks `attestationValidUntil` (copied into the lender+borrower-signed authorization) and the `VerifierStatusMirror` per the configured policy (default: re-review required). | Suspend through governance, then issuance with the old accreditation cid → inactive; with the new cid → "Verifier suspended". Expired attestation → activation fails. Forged accreditation with a rogue governance party → fails. |
| A release request leaves the lock active; so does rejection | — (S §11.5) | `ReleaseRequest` never references the lock as an exercise target. `Release_Reject` does not touch the lock. | After a request and after a rejection, ACS still holds the same lock cid. |
| Only the designated lender releases | #6 | `Lock_Release` C = `lock.lender`. `Archive` needs registrar+owner+lender. Governance, verifier and auditor are not stakeholders. | Borrower `Lock_Release` → auth error. Borrower+registrar archive → auth error. A governance execute that tries to release → impossible (no authority; DM `executeImpl` may only use {proposer, governanceParty}). |
| Cancellation, archive, corrections, retries and transfer cannot bypass a lock | #4 | No transfer choice. Passport archive is independent of the lock. Case cancel is off-ledger and never touches ledger contracts. Retries reuse the same `commandId` → `DUPLICATE_COMMAND`. Corrections need an available control. | Replay of the activation command → 409 duplicate with no second lock. Passport archive → lock remains. Owner archive of the lock → fails. |
| Financing terms scoped to borrower and lender | #9 | Terms exist only in `FinancingProposal` / `FinancingAgreement` (stakeholders: lender, borrower). The authorization, lock, release and notices carry refs or hashes only. | **Witness test:** the verifier's, dealer's, registrar's and Lender B's update streams (`TRANSACTION_SHAPE_LEDGER_EFFECTS`) contain no proposal or agreement events or values, including after activation and release. |
| Auditor access explicit and scoped; no global audit contract | — | `AuditGrant` per record owner, plus API-side filtering. | The auditor's ACS shows only grants; the API returns only the granted subset; a revoked or expired grant blocks download. |
| Status success only after commit and projection | #10 | Command lifecycle (§1.5.2). The UI shows committed success only with an `updateId`. | Kill the worker mid-stream: the UI shows `PROJECTION_DELAYED`, then recovers. Duplicate delivery is idempotent (keyed by `(updateId, nodeId)`). |

### 5.5 Disclosure consequences (who is informed of what) [INFERRED from Daml/Canton projection rules; each row needs a witness test]

| Transaction | Informed parties | What they learn | Watch-outs |
|---|---|---|---|
| Registry reserve (top-level) | registrar | registry set | Never nest it under an owner choice, or the owner witnesses the whole set (R-05). |
| `Request_Accept` | owner, registrar | ticket, new control and passport | — |
| `VR_IssueAttestation` | owner, verifier; **governance party's hosting participants** (accreditation fetch: governance party is its signatory); registrar (`CollaraConfig` fetch: registrar is its signatory) | Governance nodes and the registrar see a fetch and **its acting parties** (likely verifier + owner) at time T | Privacy and availability coupling: issuance may need the governance P2P threshold of member nodes online in Tier B. Measure it (DM §7.3, R-06). The registrar metadata exposure is acceptable as "minimal registry scope"; document it. |
| `Control_ShareWithLender` | owner, registrar, the new lender | minimal control fields (asset id, version) | Lender B is never added. |
| `Att_DiscloseTo` | verifier, owner, recipient | attestation copy | The verifier learns that the owner shared it with recipient X (metadata). Acceptable; document it. |
| Proposal / accept / authorize | lender, borrower | terms | No third party is a stakeholder. |
| `Control_Activate` | registrar, owner, lender | control, authorization (no terms), lock, mirror fetch (mirror signatory = registrar) | The registrar learns that "asset X is locked to lender Y" (operator "minimal registry status"). Fetching the governance-signed accreditation here would let governance nodes, **including Lender B's seat**, learn the borrower–lender relationship. Fetching the verifier-signed attestation would tell the verifier. Hence the authorization copy and the mirror. |
| Release authorize/reject | owner, lender (+ registrar on authorize, as a lock signatory) | decision | Reject leaves the registrar uninformed. |
| Governance confirm/execute | member parties, governance party (all member nodes) | proposal, confirmations, accreditation changes | Keep business data out of governance-visible contracts (DM §5 gotcha). |
| Audit grant | grantor, auditor | grant scope | Exports are off-ledger. |

Also: participant operators see everything hosted on their node, and the single-participant sandbox is not a privacy boundary between organizations (CAN §7). The privacy test suite must run in **3-participant mode**, with orgs mapped to participants (e.g. P1: registrar + governance; P2: borrower + dealer + verifier; P3: Lender A + Lender B + auditor) [INFERRED].

### 5.6 Risky points in the model (test early)

1. **Lender visibility at activation.** This design relies on observer recreation (`Control_ShareWithLender`) and verifier-signed disclosure copies, not on JSON API explicit disclosure (untested). Validate cross-participant on the 3-participant sandbox.
2. **Accreditation fetch informees.** Who is informed, and whether the decentralized party becomes a *confirming* party, is unverified (DM Q4).
3. **The registry `Set` grows and serializes registrations.** Fine for the MVP; shard by hash prefix later.
4. **Mandate (analyst vs approver) is enforced off-ledger.** On-ledger, `DemoLenderA` acts. If MP's "designated lender's authorization" must be ledger-enforced per approver, add a per-mandate party.
5. **Ledger time vs expiry.** `getTime` is ledger time with skew bounds. Expiry is evaluated approximately. The UI computes `EXPIRED` from wall time and shows `This attestation is outside its validity period.`
6. **Flexible controller on `Control_Activate`.** Safe only because it requires the borrower-signed authorization and `lender ∈ sharedLenders`. Keep both asserts and test with a rogue lender.
7. **Identity rotation on sandbox restart.** Contract and party ids are meaningless across restarts. Display ids must come from Daml `Text` refs, never contract ids.
8. **Informee semantics assumed throughout §5.5.**
   - Create informs signatories and observers.
   - A consuming exercise informs signatories, observers and actors.
   - A non-consuming exercise or a fetch informs signatories and actors only.
   - Consequences are visible to the informees of the parent action.

   This is Daml ledger-model knowledge, **not verified in these notes** [INFERRED]. The first witness test should confirm it on Canton 3.5.19 in 3-participant mode, because several design choices depend on it: the mirror, the authorization copy and top-level registry reservation.
9. **Input-contract availability across participants.** The submitter's participant must hold every fetched or exercised contract, unless it is passed through explicit disclosure. That is why the mirror, the control (after `Control_ShareWithLender`) and the attestation copy all name the lender as observer. Check each cross-org choice for this.
10. **Observer churn leaks.** Any consuming choice that recreates a contract with a changed observer set informs the *old* observers of the new contract, including the new observers. This affects `Control_ShareWithLender`, `PackageShare` revocation and recreation, and `EvidenceManifest` new versions if they have observers. Prefer revoke-then-grant in two transactions, and keep observer sets single-recipient.

---

## 6. Risks and blockers (ranked)

| # | Risk / blocker | Severity | Mitigation |
|---|---|---|---|
| R-01 | **Schedule.** HackCanton S3 submission is due **2026-10-09 23:59 UTC** (CON §e.2). MP asks for the full stack, LOCALNET journey, BitSafe, CI and docs. The strategy's go/no-go gates (Daml happy path by 10-02) are already at risk. | Critical | Build vertical slices in MP order, but get the **Daml core + invariant tests + sandbox seed** in front of the UI early: they are the claims judges test. Keep a demoable LOCALNET slice (review → proposal → accept → authorize → activate → release) before secondary screens. Tier A governance first; Tier B time-boxed. |
| R-02 | **BitSafe Tier B (real DM topology) is unverified** on this machine: plain Canton OSS + 3 DM nodes in a stopped WSL with no Docker; untested by DM maintainers. | High | Tier A is verified (SPIKE) and becomes the floor, honestly labelled "partial". Attempt Tier B in WSL with fixed ports (§4.2). Report the exact blocker if it fails (MP L155). |
| R-03 | **"LocalNet" expectation mismatch.** The judges' and the Contribution Pool's "reproducible LocalNet" may mean Splice/cn-quickstart; this machine can run only the `dpm sandbox`. | High | Disclose the topology in the banner tooltip, `/docs#setup` and the README. Provide the compose path for Docker machines (untested). Ask the user (CR-02). |
| R-04 | **Cross-participant authorization and visibility.** The single-participant sandbox hides issues (joint `actAs` works there but fails across participants). | High | Single-submitter propose/accept everywhere (§5.1). Run the privacy and authorization suite in 3-participant mode [VERIFIED feasible: CAN]. |
| R-05 | **Privacy leaks through transaction witnesses**: registry set exposure, terms in activation subtrees, logs. | High | §5.5 rules. Witness tests with `LEDGER_EFFECTS` for verifier, dealer, registrar, Lender B and auditor. Pino redaction (`req.headers.cookie`, `authorization`). No terms in logs or errors. |
| R-06 | **Governance coupling**: accreditation fetches inform governance member nodes (including Lender B's seat) and may need member nodes online. | Medium-high | Issuance fetches the governance accreditation (required proof). Activation uses the registrar `VerifierStatusMirror`. Measure in Tier B. Document the trade-off. |
| R-07 | **PostgreSQL connectivity**: WSL is stopped, `127.0.0.1:5432` is unreachable from Windows, the WSL IP changes, and DB/role creation needs sudo. | Medium-high | `db-up.ps1` (start, keepalive, discover IP, write `DATABASE_URL`). Option: mirrored networking (ask the user). Fallback: Windows-native PostgreSQL zip. PGlite for unit tests. |
| R-08 | **Hard-coded fixture dates** (FP-001 expiry 2026-10-05, governance expiries, "valid to" values) would expire during judging. | Medium-high | Seed-relative dates in LOCALNET. UI_MOCK fixtures computed relative to "now". |
| R-09 | **Ephemeral sandbox**: identities and state reset on restart; worker checkpoints become invalid. | Medium | Reset detection plus automatic reseed. Demo runbook: never restart mid-demo. Canton Postgres persistence is optional (untested). |
| R-10 | **Within-org mandate is not ledger-enforced** (analyst could act as `DemoLenderA` through a compromised API). | Medium | API mandate checks plus audit. Recorded `actorRef`. P1 option of per-mandate parties. State the limitation in docs. |
| R-11 | **Registrar trust**: registrar+owner can mint a replacement control; physical duplicates are not detected globally. | Medium (inherent) | Document it as required by MP L114. Registrar credential isolation. Off-ledger duplicate screening with non-leaking responses. |
| R-12 | **Legal content missing** (BPD-1). | Medium (blocks publication, not the build) | Build the pages behind a flag; ask the user for texts. |
| R-13 | **Ledger-auth operational gotchas**: 300 s JWT cap; `--dar` with auth kills the sandbox; opaque 401 bodies. | Medium | Token provider with refresh. DAR upload via API. Surface Canton logs in `scripts/ledger-logs`. |
| R-14 | **Memory and disk pressure** (~2.8 GB free; several JVMs). | Medium | `-Xmx1g`. Run Tier B separately. `next start` for demos. Watch the ~15 GB free disk. |
| R-15 | **Toolchain churn and EOL**: ESLint 9 EOL; `cn` 0.x; TanStack Table v9 new; core-ledger-client weekly; Node 24 maintenance 10-20 and Node 26 LTS 10-28; Keycloak 26.8.0 and shadcn 4.21.1 released 10-01. | Low-medium | Exact pins + lockfile + `minimumReleaseAge`. One post-submission upgrade window. |
| R-16 | **Accessibility debt** inherited from prototype tokens and patterns (contrast, focus, row links, dialogs, tabs). | Medium (MP §11 checks it) | Fix in shared primitives (Base UI dialog/tabs, `focus-visible` ring, link rows, `<dl>`, captions). Playwright with axe at 390×844 and desktop [INFERRED tooling]. |
| R-17 | **Windows path length** for Daml builds (`.daml\package-database` nesting) [VERIFIED: SPIKE]. | Low | Keep the repo at `C:\Collara\…`. Document it. |
| R-18 | **AI-generated logo**: limited copyright, no trademark clearance (UPL §1.3). | Low (non-engineering) | Human SVG redraw; raise with the user. |
| R-19 | **Next 16 pitfalls**: rewrites body cap and build-time origin; `proxy.ts` body buffering. | Low (known) | Route Handler proxy; `proxy.ts` matcher excludes `/api`. |
| R-20 | **DM v1.12.0 UI over-count bug** (fixed after the tag). | Low | The Collara adapter computes executable confirmations itself (newest live per current member). The on-ledger execute rejects bad sets anyway. |

**Next concrete step (recommendation):**
1. Scaffold the monorepo at `C:\Collara\` with the §3 pins.
2. Port the spike to `daml/collara/{governance,contracts,tests}`.
3. Implement §5.2 B–C first (control, lock, release, with tests for every §5.4 row involving locks).
4. In parallel, start the UI_MOCK migration of Landing, Docs, Pilot and the lender Overview/Queue/Case Workspace with the corrected fixtures (§1.6).
5. Ask the user BPD-1 and Q-01 to Q-11 in one message.
