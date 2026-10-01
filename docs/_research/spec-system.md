# Research notes: `collara-full-website-system.md` (system/website spec)

- **Source read in full:** `C:\Users\Pongo\Documents\Codex\2026-09-30\ggw\outputs\collara-full-website-system.md` (1,295 lines, 73,086 bytes, dated 2026-09-30 23:44). Title: "Collara Website and Application Specification".
- **Compared against:** `C:\Users\Pongo\Documents\Codex\2026-10-01\oke\outputs\collara-full-stack-master-prompt.md` (212 lines), which is the user's authoritative brief and is called "MP" below.
- **Language convention (READ, L3):** the spec's prose is in **Indonesian**. All **user-facing text is English**. Every backticked English string quoted below is verbatim UI copy. Indonesian rules are paraphrased into English here.
- **Status of the spec (READ, L5, L1295):** "Ini adalah spesifikasi untuk dibangun, bukan daftar fitur yang sudah berjalan. Collara masih pre-build." This is a build spec, not a description of working features. The spec never claims customer validation, legal enforceability, guaranteed financing, or production readiness.
- **Initial focus (READ, L5):** one **US** used-CNC equipment-finance lender team, one equipment class, and one workflow: evidence → pledge → release. **The primary buyer is the lender.** Borrower, dealer, verifier and auditor take part according to their permissions.
- **Markers used below:** **[READ]** means it is stated in the source, with a line reference `Lnnn` into the spec. **[INFERRED]** means it is my derivation and is not stated in the source.
- **Related files beside the source (not read by this task):** `collara-landing-content.md` (11 KB, also named by MP §1), `collara-gtm.md`, `collara-icp.md`, `collara-metrics.md`, `collara-value.md`, `collara-logo.png`, `collara-logo-prompt.md` in the same `ggw\outputs` directory. Text exports of the original .docx inputs are in `C:\Collara\docs\_research\inputs\`.

---

## 0. TL;DR for builders

1. There are **7 public routes, 4 auth routes and 23 workspace routes**, each with a priority tag (§2 below). The main app nav is `Overview`, `Cases`, `Assets`, `Pledges`, `Audit`. `Governance` appears only when the real sponsor module exists **and** the user holds a mandate.
2. There are **9 roles**. The lender is split into **Analyst** (prepares) and **Approver** (decides, issues proposals, authorizes release). Financing terms are visible **only to the borrower and the selected lender** by default. The verifier and dealer never see terms. The auditor sees only an explicitly granted subset. The operator has no default access to financial data.
3. The spec defines **separate state machines** and forbids a single `VERIFIED` status: asset identity (`DRAFT/REGISTERED/ARCHIVED`), verification (`REQUESTED → IN_REVIEW → ATTESTED/CHANGES_REQUESTED/REJECTED`, plus attestation validity `EXPIRED/REVOKED/SUPERSEDED`), lender review (`NOT_SUBMITTED → SUBMITTED → IN_REVIEW → NEEDS_INFORMATION/ELIGIBLE/REJECTED`), proposal (`DRAFT → ISSUED → ACCEPTED/DECLINED/WITHDRAWN/EXPIRED`), pledge/control (`AVAILABLE/ACTIVE/RELEASE_REQUESTED/RELEASE_REJECTED/RELEASED`), case projection (10 states), and command (`PREPARED → SUBMITTED → COMMITTED → PROJECTED` with failures `REJECTED/FAILED/UNKNOWN_OUTCOME/PROJECTION_DELAYED`).
4. **The spec gives no state vocabulary** for sharing/access grants, evidence documents, invitations, organization onboarding, export jobs or governance proposals. Those states are proposed here as [INFERRED] (§4.9–4.13).
5. The spec defines **29 API routes** under `/api/...` (§6.2). MP says to reuse these names.
6. The ten **invariants** in spec §11.7 are the core of the Daml design. The single lock is enforced by consuming one canonical `AssetControl` contract, never by an `if not pledged` check.
7. Labels conflict: the spec's demo label is `Demo data — LocalNet`, while MP's labels are "Synthetic demo data — UI mockup." / "Synthetic demo data — Canton LocalNet." **MP wins** (§11).

---

## 1. Product goals, non-goals and build priority

### 1.1 Problem hypothesis (READ, §1.1, L36–40)
Lender credit and documentation teams must combine equipment evidence from borrower, dealer and verifier, and coordinate pledge and release status. The hypothesis is that this causes repeated follow-ups, out-of-sync document versions, and unclear ownership of the next action. **Frequency, cost per case and willingness to pay are NOT validated.** The website must not claim proven savings without pilot data.

### 1.2 User outcomes the system must support (READ, §1.2, L42–50)
- Create a passport for one CNC machine, with identity and evidence whose source is clear.
- Request an inspection and receive an attestation with **explicit scope**.
- Share an evidence package with a **specific** lender.
- Review collateral and record the decision **without automatic cash settlement**.
- Activate **one collateral lock** per registered asset ID inside Collara's workflow.
- Request a release and get a decision from the **authorized lender**.
- Export case history scoped to the user's permissions.

### 1.3 Things Collara is NOT (READ, §1.3, L52–60)
- It is not a lending marketplace, liquidity pool or automated credit scoring.
- It is not a legal ownership registry and does not replace UCC, lien or title searches.
- It does not custody machines or loan funds.
- Creating a passport does not prove that a physical machine exists.
- It does not prevent pledges made outside Collara, or through another passport not identified as the same physical asset.
- Financing value is never treated as Collara TVL, revenue or valuation.
- The MVP has no disbursement, liquidation or legal enforcement.

### 1.4 Priority tiers (READ, §2 table, L64–72)
| Priority | Content | Done condition |
|---|---|---|
| **P0 — Hackathon MVP** | Landing, demo, login/invite, case queue, asset passport, evidence upload, verification, lender review, pledge lock, release, scoped audit export | One flow runs on **LocalNet** with **negative tests** |
| **P0 — Privacy proof** | Uninvited lender gets no data; verifier gets no loan terms; borrower cannot self-release | Proven **in the API and on the ledger**, not just the UI |
| **P1 — Sponsor module** | Verifier-registry governance, 2-of-3 threshold via the Decentralization Manager integration | Claimed done **only after real integration plus threshold testing** |
| **P1 — Pilot readiness** | Full invitations, access-grant expiry, exception handling, retention config, baseline metrics, scoped CSV import | Customer/security review before real data |
| **P2 — Expansion** | ERP/LOS integration, ownership transfer, insurance feeds, appraisal integration, multi-asset case, advanced reporting | After core workflow and demand are validated |

Rule (L72): not every route must be its own page in the MVP. Drawers, tabs and modals are fine **as long as permission and the destination URL stay clear**. **P1/P2 must never be shown as active features if they are not available.**

---

## 2. Information architecture

### 2.1 Public website routes (READ, §4.1, L94–102)
| Route | Page | Content | Priority |
|---|---|---|---|
| `/` | Landing | Product, workflow, roles, Canton, FAQ, CTA | P0 |
| `/demo` | Guided Demo | Synthetic CNC case and role-based walkthrough | P0 |
| `/pilot` | Request Pilot | Design-partner lead form | P0 |
| `/docs` | Documentation | Product boundaries, setup, demo instructions | P0 |
| `/privacy` | Privacy Notice | Website and app data processing | P0 **before real data** |
| `/terms` | Terms | Usage terms and service limits | P0 **before real data** |
| `/security` | Security Overview | Only controls actually implemented | P1 (may be a docs section in the MVP) |

### 2.2 Authentication routes (READ, §4.2, L106–111)
| Route | Page | Priority |
|---|---|---|
| `/login` | Sign in | P0 |
| `/invite/:token` | Accept organization/case invitation | P0 |
| `/onboarding` | Organization and party setup | P0 |
| `/access-pending` | Waiting for org-admin approval | P0 |

### 2.3 Workspace routes (READ, §4.3, L115–138)
| Route | Page | Priority / note |
|---|---|---|
| `/app` | Overview (role-specific) | P0 |
| `/app/cases` | Case Queue | P0 |
| `/app/cases/new` | Create Financing Case | P0 |
| `/app/cases/:caseId` | Case Workspace | P0 |
| `/app/assets` | Assets | P0 |
| `/app/assets/new` | Register Asset | P0 |
| `/app/assets/:assetId` | Asset Passport | P0 |
| `/app/verifications` | Verification Queue | P0; may be a tab inside Cases |
| `/app/verifications/:verificationId` | Verification Workspace | P0 |
| `/app/reviews` | Lender Review Queue | P0; may be a tab inside Cases |
| `/app/reviews/:reviewId` | Collateral Review | P0 |
| `/app/pledges` | Active and Historical Pledges | P0 |
| `/app/pledges/:pledgeId` | Pledge Detail and Release | P0 |
| `/app/access` | Sharing and Access Requests | P0; may be a case tab |
| `/app/audit` | Scoped Audit Center | P0 |
| `/app/reports` | Export History | P0; may be a tab in Audit |
| `/app/notifications` | Notifications | P1; a header inbox is acceptable |
| `/app/settings` | Workspace Settings | P0 minimal |
| `/app/settings/team` | Team and Mandates | P1; demo uses seeded roles |
| `/app/settings/integrations` | Integrations | P2 |
| `/app/governance` | Governance Proposals | P1 sponsor module |
| `/app/governance/:proposalId` | Governed Action Detail | P1 sponsor module |

Rule (L140): the visible menu is decided by role and scope. **Direct URLs must still be checked by the backend. Hiding a menu item is not enforcement.**

There is **no** route for a "Verifier Registry" list page; only governance proposals exist (see §11, C-4). There is also no `/app/proposals` route; proposals live in the Case Workspace (L681).

### 2.4 Landing navigation (READ, §5.2, L155–164)
| Label | Destination |
|---|---|
| `Collara` | `/` |
| `Product` | `/#product` |
| `Workflow` | `/#workflow` |
| `For Lenders` | `/#for-lenders` |
| `Why Canton` | `/#why-canton` |
| `Docs` | `/docs` |
| `Sign in` | `/login` |
| `Request a pilot` | `/pilot` |

Page anchors: `product` (on the **Problem** section, L211), `workflow` (L265), `for-lenders` (L286) and `why-canton` (L334). The Product section itself has no separate anchor; `#product` points at the Problem section.

### 2.5 Footer (READ, §5.14, L434–452)
- **Product:** `Product` · `Workflow` · `For Lenders` · `Demo`
- **Resources:** `Docs` · `Why Canton`
- **Contact:** `Request a pilot`
- **Legal:** `Privacy` · `Terms`
- **Description:** `Private equipment evidence and collateral workflows. Starting with used CNC financing.`
- **Disclaimer:** `Collara is in development. It is not a lender, custodian, legal lien registry, or provider of guaranteed financing.`
- Rule: no email, business address, social links or GitHub URL that does not exist yet. **No dead links, and no `#` as a final placeholder.**

### 2.6 App navigation (READ, §8.1, L531–535)
- Main menu: `Overview`, `Cases`, `Assets`, `Pledges`, `Audit`.
- `Verification` and `Reviews` may be **saved views of Cases** in the MVP. `Sharing` may be a case tab. `Settings` sits in the workspace menu.
- `Governance` appears **only if the sponsor module is available AND the user has the mandate**.

### 2.7 Workspace header (READ, §8.2, L537–545)
- Organization name and the active role/mandate.
- Search that only searches accessible records.
- Notifications within scope.
- Environment indicator: `LocalNet`, `DevNet` or `MainNet`, **matching the real connection**.
- Ledger sync indicator and last-updated timestamp.
- A cross-organization role switcher exists **only in the isolated synthetic demo**. In production a user may switch only between memberships the account actually holds.

### 2.8 Which persona sees which screens (READ from §9.1, §10, §12.1; arrangement [INFERRED])
| Screen | Borrower | Dealer | Verifier | Lender Analyst | Lender Approver | Auditor | Org Admin | Operator | Governance Member |
|---|---|---|---|---|---|---|---|---|---|
| Overview `/app` | yes (borrower widgets) | (not specified) | yes (verifier widgets) | yes (lender widgets) | yes | yes (auditor widgets) | — | — | — |
| Cases / Case Workspace | own cases | invited case, own contributions only; no credit or loan-term screens without a separate mandate (L775) | assigned cases, scoped | shared cases | shared cases | granted cases | not automatically all financials (L84) | not by default | — |
| Assets / Passport | own | scoped | scoped | shared case | shared case | granted | — | minimal registry scope | — |
| Verification Queue / Workspace | request side | — | yes (assigned) | read attestation | read attestation | granted | — | — | — |
| Reviews / Collateral Review | — (receives shared feedback, not internal notes) | no | no | yes | yes (decides) | separate explicit grant for internal notes | — | — | — |
| Proposal tab | own agreement (accept/decline) | no | no | own case | issues/withdraws | separate explicit grant | — | — | — |
| Pledges / Release | own case (request release) | no | no | authorized case role (may request) | authorizes or rejects | granted | — | — | — |
| Sharing / Access | grants consent | — | — | — | — | — | — | — | — |
| Audit / Reports | own scope | granted subset | assigned subset | own scope | own scope | granted subset | — | operational subset | — |
| Settings / Team | own org | own org | own org | own org | own org | own org | manages members/mandates | — | — |
| Governance | — | — | — | — | — | — | — | (operator as member) | yes, if the module is real |

---

## 3. Roles, permissions and field-level disclosure

### 3.1 Roles (READ, §3 table, L76–86)
| Role (exact label) | Who | Responsibilities | Explicitly NOT allowed |
|---|---|---|---|
| **Borrower / Asset Owner** | Company owning the equipment or submitting its evidence | Register asset, submit evidence, consent to sharing, accept proposal, request release | Change verifier results; release a pledge unilaterally |
| **Dealer Contributor** | Invited equipment dealer | Add invoice, specs, photos and specific transaction context | Approve financing; see all loan terms |
| **Verifier** | Assigned inspector/appraiser with **active** status | Review tasks, request changes, submit attestation within scope | Set credit approval or legal lien priority |
| **Lender Analyst** | Credit analyst / documentation officer | Review evidence, request changes, prepare assessment/proposal | Claim the lender's decision without an approver mandate |
| **Lender Approver** | Head of Credit or another mandated officer | Approve/reject collateral, authorize proposal and release | Change a verifier's attestation |
| **Auditor** | Audit party holding a grant | Read and export cases inside the permitted scope | Read the whole ledger; take operational actions |
| **Organization Admin** | Admin of a lender, borrower or verifier org | Invite members, set roles and mandates within the org | Automatically get all financial data; act as a party of another org |
| **Collara Operator** | App/infrastructure operator | Operations, registry identity, diagnostics per access rights | Override lender decisions, approve inspections, or read all orgs because of admin status |
| **Governance Member** | Operator/member party of the governance module | Propose and approve defined administrative actions | Release collateral belonging to another lender |

Further rules (READ, L88):
- One organization can have many users.
- **A web account is not a Canton Party.** The session determines the active organization and mandate, and the backend maps the session to the correct party.
- **Financial roles cannot be self-selected at signup.**
- Persona naming varies [READ]: "Borrower / Asset Owner" (§3), "Equipment owners" (landing §5.9), "Owner" (§11, §14) and the demo org `Demo Manufacturer` (§17.1). MP uses "manufacturers/borrowers".

### 3.2 Access matrix (READ, §12.1, L856–872, verbatim structure)
"`Scoped` means only the assigned or granted records/cases, not all of another organization's records" (L858).

| Data/action | Borrower | Dealer | Verifier | Lender | Auditor | Operator |
|---|---|---|---|---|---|---|
| Equipment identity | Own | Scoped | Scoped | Shared case | Granted | Minimal registry/operational scope |
| Evidence documents | Own/authorized | Own contribution + granted | Assigned scope | Shared package | Granted | Not automatic; hosting model explained |
| Attestation | Case scope | If granted | Issued/assigned | Shared case | Granted | Minimal registry status |
| Internal lender notes | No | No | No | Own organization mandate | Separate explicit grant | No default |
| Loan terms | Own agreement | No default | No default | Own case | Separate explicit grant | No default |
| Create passport | Authorized owner | No, unless delegate of owner | No | No, unless approved delegate | No | Registry approval, not owner impersonation |
| Submit attestation | No | No | Active assigned verifier | No | No | No |
| Approve collateral/proposal | No | No | No | Authorized approver | No | No |
| Request release | Own case | No | No | Authorized case role | No | No |
| Authorize release | No | No | No | Designated lender approver | No | No |
| Export history | Own scope | Granted subset | Assigned subset | Own scope | Granted subset | Operational subset |

### 3.3 Field-level and disclosure rules collected from the whole spec (READ)
- **Loan terms are shared only with the borrower and the selected lender in the MVP** (L729). Verifier and dealer are not broad observers. The auditor needs separate scope and permission. **One party cannot unilaterally share another lender's data.**
- Invariant 9 (L851): loan terms are **not** disclosed to the verifier/dealer when the lock is created.
- Case Queue columns `Borrower` and `Pledge state` show only "bila authorized" (if authorized) (L575).
- Lender Review Queue `requested principal` shows only if authorized (L661).
- Pledges list: `lender/borrower` and `principal reference` show only if authorized (L703).
- Search by asset serial is allowed only for a party that owns that serial (L577).
- Asset duplicate warnings come only from data the user may know, or from a privacy-preserving registry response. Registration by another party must **never** leak through search, autocomplete or error messages (L599).
- Asset Passport `Cases` tab shows only cases the user may know about. Verifier and dealer do not automatically see loan terms or the borrower relationship across cases (L623).
- Evidence: the **document title, raw filename, storage URL and thumbnails also need permission** (L633).
- Collateral Review: **internal notes are separate from feedback shared with the borrower** (L671). A lender's **internal risk score** is not visible to counterparties (L677).
- Notifications (email/push) carry only a generic event plus an authenticated link. **No serial, borrower details, principal, filenames or financing terms** (L1114).
- Analytics: no document contents, borrower identity, serial, party credentials, financing terms or raw ledger payload goes to third-party analytics (L1166).
- API errors must not reveal confidential existence or terms (L1031). An unrelated party gets an "unavailable" response that does not confirm the asset or case exists (L883). The copy is `This record is unavailable to your account.` (L1132).
- Every list, filter count, notification, global search, CSV and activity feed must use **the same scope as the detail view** (L554). Privacy acceptance (L1222) covers Lender B seeing none of Lender A's case, terms, document metadata, files, **counts, search, notifications**, exports or events.
- Separate data owners may require separate consent for one access grant (L905).
- Organization Admin and Operator never get financial data by default (L84–85, L1225).
- Client-supplied party or organization filters are **never** a source of authority (L880). The browser cannot send arbitrary `actAs` or swap party IDs (L525).
- Revocation limits only future app and document access. **Disclosed ledger data and downloaded files cannot be promised to disappear** (L731, L882).

---

## 4. State machines and vocabularies

General rule (READ, L791): "**Jangan memakai satu status `VERIFIED`**". Do not use one `VERIFIED` status to summarize the whole process. These states are app vocabulary; the Daml representation may differ **as long as the invariants hold**. Statuses for evidence, verification, review and pledge are **displayed separately** (L550).

### 4.1 Asset identity lifecycle (READ, §11.1, L793–801)
| State | Meaning | Main transitions |
|---|---|---|
| `DRAFT` | Off-ledger draft | Owner submits registration → `REGISTERED` (only once the ledger command commits, L611) |
| `REGISTERED` | Passport committed; evidence is still only **submitted claims** | Authorized update; verification; case creation |
| `ARCHIVED` | Lifecycle closed after a dependency check | Accepts no new operations; history kept per retention |

- `PLEDGED` is **not** an identity state. Pledge state comes from collateral control.
- Transfer of ownership is **P2** and must be blocked while there is an active lock, a pending release or an unresolved workflow dependency.
- Register Asset form actions: `Save draft` (keeps `DRAFT`) and `Register passport` (submits). The warning shown is `Submitted ownership evidence has not yet been independently verified.` (L609).

### 4.2 Verification request and attestation (READ, §11.2, L803–809)
```
REQUESTED → IN_REVIEW → ATTESTED | CHANGES_REQUESTED | REJECTED
CHANGES_REQUESTED → IN_REVIEW   (after a new evidence version is submitted)
Attestation validity: EXPIRED | REVOKED | SUPERSEDED
```
- Actors: the owner/requester creates the request (L946). **Only the active, assigned verifier** submits the attestation (L868, L947). Registry status is **re-checked at commit time**, not only when the assignment is accepted (L643).
- UI outcome labels (L651): `Attestation issued` ↔ `ATTESTED`, `Changes requested` ↔ `CHANGES_REQUESTED`, `Verification rejected` ↔ `REJECTED`.
- Verification Queue actions (L641): `Accept assignment`, `Open review`, `Request clarification`, `Decline assignment` (with reason). [INFERRED] `Accept assignment` moves `REQUESTED → IN_REVIEW`. The spec has **no state** for a declined assignment or a clarification request (gap, §11 C-9).
- `EXPIRED` is a **validity-time evaluation**, not a ledger state change on a clock tick (L809).
- Correction creates a **new attestation linked to the old one**, which leaves the old one `SUPERSEDED`. Revocation keeps the historical record per retention (L657). **A submitted attestation is never edited silently.**
- A material evidence update needs a new inspection or a new attestation. It does **not** automatically change any lender-review results (L809).
- Verifier suspension does not delete historical attestations. By default, using an attestation after suspension needs re-review before a **new** activation (invariant 7, L849).
- Ownership/lien checklist items are marked `Not checked`, `Reviewed documents`, or an explicit result matching the verifier's mandate. They never become universal "verified ownership" (L647).

### 4.3 Lender review / collateral assessment (READ, §11.3, L811–815)
```
NOT_SUBMITTED → SUBMITTED → IN_REVIEW → NEEDS_INFORMATION | ELIGIBLE | REJECTED
NEEDS_INFORMATION → IN_REVIEW   (once the required change is available)
```
- UI outcomes (L673): `Needs information` ↔ `NEEDS_INFORMATION`, `Eligible for this case` ↔ `ELIGIBLE`, `Rejected for this case` ↔ `REJECTED`.
- Actions (L675): `Request information`, `Save assessment`, `Submit for approval`, `Approve eligibility`, `Reject`, each per mandate. [INFERRED] The Analyst runs `Save assessment` and `Submit for approval`; the Approver runs `Approve eligibility` and `Reject`. There is **no state for "awaiting approval"**, yet the saved view `Awaiting approval` and the Overview item "decisions awaiting approval" need one (gap, §11 C-8).
- **When the evidence snapshot changes, readiness is cancelled until the lender acknowledges the new version** (L815). The copy is `The reviewed evidence has changed. A new review is required.` (L1122).
- Eligibility applies to **this lender and this case only**. It never makes the passport "globally eligible" and never promises funding (L677). The copy is `Eligible for this lender and case. Financing is not yet active.` (L1124).
- Assessment must not change any status to funded (acceptance criterion L1212).

### 4.4 Financing proposal (READ, §11.4, L817–821; §9.12 L679–689)
```
DRAFT → ISSUED → ACCEPTED | DECLINED | WITHDRAWN | EXPIRED
```
- Actors: the lender (approver, per L950) runs `Issue proposal`. The borrower runs `Accept` or `Decline`. The lender runs `Withdraw` **before acceptance only**. `EXPIRED` follows from the proposal's expiry field.
- **Changing terms after issue produces a new version/proposal that needs a new acceptance.** Acceptance is bound to the **exact proposal version** (L951, L1005).
- **`ACCEPTED` is not `FUNDED`** (L821). Entering a principal does not activate financing. Pledge activation has its own state and authorization (L689).
- Borrower confirmation copy: `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.` (L687).

### 4.5 Asset control, collateral lock and release (READ, §11.5, L823–833)
| State | Meaning | Next action |
|---|---|---|
| `AVAILABLE` | Asset control has no active Collara lock | Activate using an approved/accepted workflow |
| `ACTIVE` | Lock committed for **one case and the selected lender** | Authorized party requests release |
| `RELEASE_REQUESTED` | Release under review; **lock stays active** | Lender approves, rejects, or requests information |
| `RELEASE_REJECTED` | Request rejected; **lock stays active** | Reapply with a new reason or evidence |
| `RELEASED` | Historical lock finished; current control returns to available | A new workflow is subject to fresh checks |

- "`RELEASE_REJECTED` is a release-request outcome; the current asset lock stays `ACTIVE`" (L833). **Old pledge history is never overwritten when a new pledge is created.**
- [INFERRED] The table merges three objects. A cleaner model is:
  - **AssetControl**: `AVAILABLE ↔ LOCKED`.
  - **CollateralLock / pledge**: `ACTIVE → RELEASED`.
  - **ReleaseRequest**: `REQUESTED → (INFORMATION_REQUESTED →) AUTHORIZED | REJECTED`. `AUTHORIZED` triggers `RELEASED`; `REJECTED` leaves the lock `ACTIVE`.
  - The pledge list filter labels are `Active`, `Release requested`, `Released` (L705).
- **Activation preconditions** (invariant 5, L847): a lender-authorized decision/proposal, **borrower acceptance**, an evidence version and attestation that match, and an **available asset control**. Expired or stale evidence blocks a new activation and raises an exception, but **never silently releases an active pledge** (invariant 8). An expired or revoked attestation does not meet the prerequisites (L1099).
- **Release authority** (invariant 6, L848): only the designated lender authority. The owner, verifier, auditor and Collara admin cannot release on their own, and neither can governance (L721, L1054).
- Release request actors: the borrower on their own case, or an authorized lender case role (L870, L953).
- Lender release actions: `Request information`, `Authorize release`, `Reject release` (L715).
- Release reasons (L717): external loan completion; refinancing; collateral substitution (**P2**); administrative correction subject to lender approval.
- **No auto-release** on a maturity date or on upload of repayment proof (L721).
- Release confirmation: `This releases the Collara workflow lock. Any required legal lien termination must be completed separately.` (L719).
- Pending copy: `Release requested. The collateral lock remains active.` Unauthorized copy: `Release requires the designated lender's authorization.` (L1130–1131).

### 4.6 Case stage, a projection (READ, §11.6, L835–839)
`DRAFT`, `EVIDENCE_COLLECTION`, `VERIFICATION`, `LENDER_REVIEW`, `PROPOSAL`, `PLEDGE_ACTIVE`, `RELEASE_REVIEW`, `CLOSED`, `REJECTED`, `CANCELLED`.
- The case stage is **projected from underlying records**. It is not a separate source of truth that an admin can edit.
- **Cancellation after the pledge is active does not release the lock.** Closing a case needs a dependency check and cannot be used to bypass release.
- [INFERRED] The transition order matches the list order. `REJECTED` follows a lender review `REJECTED` or a verification `REJECTED`; `CANCELLED` is a borrower or lender withdrawal before the lock.

### 4.7 Command lifecycle (READ, §15.3, L1017–1023)
```
PREPARED → SUBMITTED → COMMITTED → PROJECTED
failure/edge: REJECTED | FAILED | UNKNOWN_OUTCOME | PROJECTION_DELAYED
```
- **A timeout is not automatically a failure.** Look up the command/commit receipt by its stable **idempotency key** before retrying.
- Double-submit must not duplicate a pledge or an attestation.
- Idempotency is scoped to **tenant, actor, operation and payload hash**.
- `Submitted` or HTTP accepted ≠ `Committed` (L551). A success status appears only after a confirmed ledger commit **and** once the read model reflects it (invariant 10).
- UI copy per state (L1125–1129, L1136):
  - SUBMITTED: `Submitted. Waiting for ledger confirmation.`
  - COMMITTED: `Confirmed on the ledger.`
  - PROJECTION_DELAYED: `The action is confirmed. This view is still synchronizing.`
  - UNKNOWN_OUTCOME: `Confirmation is delayed. We are checking the original submission before retrying.`
  - Lock conflict: `This action could not complete because the asset workflow state changed.`
  - Ledger down: `The ledger is unavailable. No confirmed state change has been recorded.`

### 4.8 Audit event status (READ, §9.17, L735–741)
- Audit filters include **committed/pending status**.
- **Operational clicks and ledger events are distinguished.** `Evidence uploaded` is not automatically ledger-committed. `Pledge activated` is **only** a ledger-commit event. A failed command never becomes a successful lifecycle event.
- Timestamps distinguish **occurred-at, submitted-at, committed-at and projected-at** (L918).

### 4.9 Sharing / access grant — NOT defined in the spec (READ fields, INFERRED states)
- [READ] Fields (L725): recipient organization, purpose, case/document scope, view/download permission, expiry, **grant status**, consenting parties, grant history.
- [READ] Actions (L727): `Review package`, `Grant access`, `Decline request`, `Revoke future document access` (the last only for the controller matching the record owner).
- [READ] Copy: `Future document access has been revoked. Previously shared copies may still exist.`
- [READ] Expiry is checked on **download** (L1226). Grant expiry does not delete historical ledger disclosures (L1190).
- [INFERRED] Proposed states: `REQUESTED → GRANTED | DECLINED`, then `GRANTED → REVOKED | EXPIRED`. A grant needing multiple data owners may need `PARTIALLY_CONSENTED` (L905).

### 4.10 Evidence document — partial (READ fields, INFERRED states)
- [READ] Fields: "file integrity state", "review status", "scan state", version, hash (L619, L896). Flow: `POST /api/evidence/upload-intents` → client upload → `POST /api/evidence/:id/finalize` (the server checks bytes, hash, scan and version).
- [READ] Copy: `Required evidence is missing. Review the checklist before submitting.` and `The file does not match its recorded integrity reference.`
- [INFERRED] Upload states: `UPLOAD_PENDING → QUARANTINED/SCANNING → AVAILABLE | REJECTED (type/size/scan) | HASH_MISMATCH`. Ledger reference: uncommitted → committed. MP §7 requires "quarantine uploads pending validation".

### 4.11 Invitation / onboarding — partial
- [READ] An invite names the inviting org, target org, role, case scope and expiry. It is addressed to a **specific recipient**. The token only accepts the invite and does not replace authorization on every request (L511).
- [READ] Actions: `Accept invitation` · `Decline`. Errors: `This invitation has expired.` / `This invitation cannot be used with your account.`
- [READ] Organization "onboarding state" field (L890). **Admin approval is required before party binding becomes active** (L519). `/access-pending` is the waiting page.
- [INFERRED] Invitation: `PENDING → ACCEPTED | DECLINED | EXPIRED | REVOKED`. Organization: `DRAFT → PENDING_APPROVAL → ACTIVE → SUSPENDED`. Membership `status`: `PENDING | ACTIVE | DISABLED`.

### 4.12 Export job — partial
- [READ] ExportJob has scope, requester, **cutoff**, state, checksum and signed download ref (L908). Permission is **re-checked at generate time and at download time** (L751).
- [INFERRED] States: `QUEUED → GENERATING → READY → EXPIRED | FAILED`.

### 4.13 Governance proposal — partial
- [READ] GovernanceProposal fields: action, module version, members, threshold, confirmation, expiry, receipt (L909). The page shows proposals, eligible members, threshold, confirmations, **execution state**, referenced module action and execution receipt (L761).
- [READ] Required behaviour: 1 confirmation cannot execute; 2 distinct eligible confirmations can; a duplicate from the same member does not count; an expired or rejected proposal does not execute (L1049–1052).
- [INFERRED] States follow the DM propose/confirm/execute lifecycle named in MP §8: `PROPOSED → CONFIRMING (n/3) → EXECUTABLE → EXECUTED | REJECTED | EXPIRED`. **Verify against the pinned DLC-link Decentralization Manager release.**
- Verifier registry status [INFERRED from L643, L849, L956]: `ACTIVE | SUSPENDED`. "Add verifier" creates `ACTIVE`; "Suspend verifier" sets `SUSPENDED`.

---

## 5. Domain entities, sources of truth, IDs and money

### 5.1 Entities (READ, §13.1 table, L889–909)
| Entity | Main fields | Notes |
|---|---|---|
| Organization | ID, name, type, country, onboarding state, hosting mode | Lender type is **not self-verified** |
| UserMembership | User ID, organization ID, role, mandates, status | Role ≠ arbitrary party impersonation |
| PartyBinding | Organization/mandate, party ID, participant connection, environment | Provisioning approval and **secret reference** |
| AssetPassport | Asset ID, owner claim, equipment class, identity reference, version, lifecycle | Sensitive details may be off-ledger or in a private contract |
| AssetIdentityRegistry | Namespace, canonical asset ID, registration reference, identity-screening state | Boundary for serialization and duplicate screening |
| EvidenceDocument | Opaque ID, source, object reference, hash, version, case linkage, scan state | Storage URL is not public |
| VerificationRequest | Request ID, asset/case, verifier, scope, stage | Explicit assignment |
| VerificationAttestation | Issuer, scope, checked items, limitations, evidence versions, validity, outcome | **Immutable** issued record; corrections are linked |
| FinancingCase | Case ID, borrower, selected lender, asset reference, stage projection | **One asset per case in the MVP** |
| CollateralAssessment | Case, lender, evidence snapshot, valuation source/date, outcome, policy version | Internal notes kept separate |
| FinancingProposal | Parties, case, principal/currency, version, expiry, acceptance state | Not a settlement record |
| AssetControl | Asset ID, version, available/locked state, opaque lock reference | Minimal shared control; **stores no loan terms** |
| CollateralLock | Asset/case linkage, parties, active state, activation reference | One lock per canonical control |
| ReleaseRequest | Lock, requester, reason, version, outcome, authorized lender | Lock stays active while the request is pending |
| AccessGrant | Resource scope, recipient, purpose, view/download, expiry, consent | Separate data owners may require separate consent |
| AuditProjection | Visible event, actor, state change, ledger offset, source category | A projection, not a ledger-wide master history |
| CommandSubmission | Command ID, idempotency key, scope, state, commit reference, error | Retry-safe; no optimistic success |
| ExportJob | Scope, requester, cutoff, state, checksum, signed download ref | Permission re-checked at download |
| GovernanceProposal | Action, module version, members, threshold, confirmation, expiry, receipt | **P1, real integration only** |

### 5.2 Field lists from the screens (READ, §9; these complement §5.1)
- **Register Asset form (L603):** Equipment class, Manufacturer, Model, Serial number, Year of manufacture (optional), Owner organization, Location scope, Purchase evidence, Equipment photos, Claimed acquisition value/currency (optional).
- **Passport Overview (L617):** equipment identity, source of owner claim, last update, verification scope, evidence validity, current permitted actions.
- **Evidence row (L619):** document type, source organization, uploaded by, version, uploaded date, file integrity state, review status, sharing scope.
- **Evidence viewer (L629):** file preview, document metadata, source, **hash algorithm and integrity result**, version history, relationship to attestation.
- **Attestation (L621, L649):** issuer, inspected date, valid-until, checked items, limitations, supporting evidence versions, replacement/revocation status. In the workspace: inspection method/date, checked items, findings, limitations, supporting versions, validity period, outcome, attesting party.
- **Verification checklist (L647):** serial consistency, photos, document consistency, inspected condition, location evidence, maintenance evidence (if in scope). Ownership/lien items use `Not checked` / `Reviewed documents` / an explicit mandated result.
- **Create Financing Case (L585):** Case name/reference, Borrower, Registered asset, Equipment purpose, Target lender, Requested amount/currency (optional), Selected evidence package.
- **Assessment (L671):** Valuation amount/currency, valuation source/date, valuation limitations, internal assessment notes, required external checks, collateral outcome, policy reference.
- **Proposal (L683):** Lender, Borrower, Case ID, Asset ID, financing reference, principal/currency, term metadata (optional), proposal expiry, external legal-document reference, version, authorized approver.
- **Pledge detail (L711):** linked case, registered asset, lender authority, lock state, activation evidence, release request reason, release decision, committed ledger reference.
- **Access grant (L725):** recipient organization, purpose, case/document scope, view/download permission, expiry, grant status, consenting parties, grant history.
- **Audit row (L737):** event time, case/asset reference, event type, authorized actor, previous state, new state, evidence/proposal version, commit reference.
- **Report (L747):** case identifier, accessible asset identity, evidence manifest, attestation scope/date/version, relevant review decisions, pledge/release events, access scope, generated timestamp, **ledger coverage and sync watermark**, **report schema version**.
- **Organization setup (L519):** organization name, country, organization type, business contact, hosting mode.
- **Pilot request (L464):** see §7.4.

### 5.3 Sources of truth (READ, §13.2, L911–918)
- **Ledger:** committed workflow authorization, control/lock state, issuer attestations, and proposal/consent records per the model.
- **Private storage:** document bytes and sensitive metadata not needed by contract logic.
- **Application DB:** identity/session, read models, invitation delivery, queues, projections, export jobs.
- **External systems:** physical identity, legal title/lien records, repayment/disbursement, source valuations.
- **A projection never overrides the ledger for an active lock or an approval.**

### 5.4 IDs (READ unless marked)
- `CL-001` is the case ID in the hero preview (`Used CNC financing · CL-001`, L198). `ASSET-DEMO-001` is the demo asset ID (L1074). The spec defines **no general ID format** for requests, attestations, pledges, proposals, grants or exports. [INFERRED] Use human-readable display IDs with prefixes (e.g. `CL-###`, `ASSET-…`, `VR-…`, `PL-…`), kept separate from Daml contract IDs.
- **The Asset ID is a stable internal identifier issued by the registry workflow. It is not the serial number used as a public ID** (L605). Serial normalization, issuer namespace and duplicate screening are part of identity review. **Do not claim worldwide serial uniqueness.**
- Use stable asset identifiers instead of changing contract IDs (L1182). Technical/contract IDs appear only under `Technical details` when authorized (L699). Users never need contract IDs to act.
- Evidence uses opaque document IDs (L896).
- Commands have stable command IDs plus idempotency keys (L907).

### 5.5 Money and currency (READ, §13.3 L920–922, §9.1 L569, §8.3 L553)
- Use a **decimal-safe representation with explicit currency**. No floating point for principal.
- **Never sum USD with another currency without an FX source and date.**
- **Asset valuation and financing principal are different fields.**
- Aggregates appear only once data is complete and reconciled. Label them `Recorded financing principal` or `Recorded collateral valuation`, with currency, coverage and source. **Never use `TVL`.**
- Never merge outstanding collateral, annual workflow volume, loan balance and valuation into one metric.
- **Unavailable data is never shown as zero.**
- MP fixtures (not in the spec): valuation USD 150,000; requested principal USD 100,000.

---

## 6. API, services, events and data contracts

### 6.1 Logical services (READ, §15.1, L976–980)
Authentication/Membership; Registry; Case; Evidence; Verification; Lender Review; Pledge/Release; Sharing; Reporting; Ledger Adapter/Indexer; Notification; Governance Adapter (if enabled). **One modular backend is fine; no microservices are needed.**

### 6.2 Proposed API surface (READ, §15.2 table, L986–1015, verbatim)
"These are Collara's designed APIs, not official Canton or sponsor-SDK endpoints." MP §7: "Reuse established route names from the system specification where present."
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/me` | Session, memberships, mandates |
| POST | `/api/pilot-requests` | Public lead request; **rate-limited** |
| POST | `/api/invitations/:token/accept` | Bind a verified recipient to the approved scope |
| GET / POST | `/api/assets` | Scoped list / registry submission |
| GET | `/api/assets/:id` | Authorized passport |
| POST | `/api/assets/:id/versions` | Authorized version change |
| POST | `/api/evidence/upload-intents` | Scoped private upload authorization |
| POST | `/api/evidence/:id/finalize` | Server checks bytes, hash, scan and version |
| GET | `/api/evidence/:id/download` | Access check and short-lived download |
| GET / POST | `/api/cases` | Scoped queue / create case |
| GET | `/api/cases/:id` | Case projection with the permitted tabs/actions |
| POST | `/api/cases/:id/sharing` | Consent / scoped package submission |
| POST | `/api/cases/:id/verification-requests` | Create an assigned verification workflow |
| POST | `/api/verifications/:id/attestations` | Submit an immutable issued attestation |
| POST | `/api/verifications/:id/change-requests` | Request evidence changes |
| POST | `/api/cases/:id/assessments` | Lender assessment/decision |
| POST | `/api/cases/:id/proposals` | Issue an authorized proposal |
| POST | `/api/proposals/:id/acceptance` | Exact-version borrower acceptance |
| POST | `/api/cases/:id/pledge-activation` | Activate against the canonical available control |
| POST | `/api/pledges/:id/release-requests` | Request without unlocking |
| POST | `/api/release-requests/:id/decision` | Authorized designated-lender decision |
| GET / POST | `/api/access-grants` | Scoped grants / grant request |
| POST | `/api/access-grants/:id/revoke` | Revoke future app/document access |
| GET | `/api/audit/events` | Scoped audit projection |
| POST | `/api/reports` | Generate a permission-scoped export |
| GET | `/api/commands/:id` | Submission/commit/projection status |
| GET | `/api/system/health` | Sanitized infrastructure status |
| POST | `/api/governance/proposals` | P1 adapter; real module action |

**[INFERRED] Endpoints the screens need that the spec does not list** (proposed names follow the same style):
- `GET /api/verifications`, `GET /api/verifications/:id`, `POST /api/verifications/:id/assignment` (accept/decline), `POST /api/verifications/:id/clarifications`, and attestation revoke/correct (e.g. `POST /api/attestations/:id/revocation`, `/corrections`).
- `GET /api/reviews`, `GET /api/reviews/:id`, plus assessment submit-for-approval and approve endpoints.
- `GET /api/proposals/:id`, `POST /api/proposals/:id/decline`, `POST /api/proposals/:id/withdraw`.
- `GET /api/pledges`, `GET /api/pledges/:id`, `GET /api/release-requests/:id`, and release request-information.
- `GET /api/evidence/:id`, `POST /api/evidence/:id/versions`, `GET /api/cases/:id/evidence`.
- `GET /api/reports`, `GET /api/reports/:id/download`.
- Invitations: create, `GET /api/invitations/:token` preview, decline.
- Organization onboarding and party-binding admin.
- `GET /api/notifications`.
- Governance: `GET /api/governance/proposals[/:id]`, `POST …/:id/confirmations`, `POST …/:id/execute`.
- Verifier registry: `GET /api/verifiers`.

### 6.3 API behaviour rules (READ, §15.4, L1027–1033)
- Pagination with a stable cursor on lists.
- **The server computes allowed actions.** The client is not the authority. `GET /api/cases/:id` returns the permitted tabs and actions.
- Access checks run on every object and every associated document.
- Return a **conflict response** when canonical state has changed.
- Errors never reveal confidential existence or terms.
- Data copied into projections is party- and tenant-scoped.
- Archive, retention and export rules also apply to backups and derived data.

### 6.4 Notification events (READ, §18.1, L1112)
Verification assignment; changes requested; attestation issued; package shared; lender decision; proposal issued; acceptance; pledge commit; release requested; release decision; access expiry; export completed; failed command; verifier suspension exception. **A failed email is not a failed ledger transaction.**

### 6.5 Analytics workflow events (READ, §19.1, L1144)
Track: case creation, package submission, verification request, changes request, attestation issue, lender review start, decision, proposal acceptance, pledge commit, release request/commit, export, access-denial test. **Synthetic demo events stay separate from discovery/pilot events.**

### 6.6 Metrics (READ, §19.2, L1150–1162)
- **Discovery metric:** "qualified lender workflows observed with documented reconciliation delays".
- **Pilot North Star:** "lender-accepted real-equipment collateral cases per week". Count unique real case IDs accepted by a non-team lender user. Acceptance means evidence/status was sufficient for review; it does not mean funding or credit approval. Exclude synthetic and internal cases, and count each case once.
- Other metrics: follow-up cycles per case (consistent definition); active handling minutes, distinguished from elapsed calendar time; time to evidence completeness; time to release decision; participants completing assigned tasks; core-flow completion rate with a clear denominator; **committed ledger transactions, not button clicks**; active parties per environment and period; privacy/authorization tests passed; onboarding/integration effort and support time.
- **No percentage improvements derived from the synthetic happy path.**

---

## 7. Screen-by-screen requirements

### 7.0 Global rules (READ, §8.3 L547–554, §20.6 L1192–1194)
- Every page answers: **current status, blocker, who must act, next action**. MP adds **data source and last sync time**.
- Status for evidence, verification, review and pledge is shown separately.
- `Submitted` ≠ `Committed`. Unavailable data ≠ 0. Never merge monetary metrics.
- All lists, counts, notifications, search, CSV and activity feeds share the detail view's scope.
- Accessibility and recovery: keyboard-operable forms and actions; labels with associated errors; **status never shown by color alone**; sensible focus after submit; readable file alternative; expired-session handling; safe retry; **unsaved-draft warning**; **empty, error, loading and sync-delayed states on every critical screen**. MP adds forbidden, network-error and pending-command states.
- Confirmation dialogs state **what changes, the acting party, the evidence/proposal version, and the external obligations that remain**. **Never use a generic `Success`** (L1138).
- No bulk approve or bulk release in the MVP. Sensitive reviews are explicit per case (L581).

### 7.1 Overview `/app` (READ, §9.1 L558–571)
- Purpose: work requiring action, **not vanity metrics**.
- Content per role:
  - **Borrower:** My cases; evidence requested; verification pending; proposals awaiting acceptance; active pledges.
  - **Verifier:** Assigned inspections; changes awaiting response; attestations issued; attestations nearing expiry.
  - **Lender:** Cases awaiting review; missing evidence; decisions awaiting approval; active pledges; release requests.
  - **Auditor:** Granted cases; expiring access; report exports.
- Counts include only records the role may know about. Nominal values appear only after reconciliation, with labels `Recorded financing principal` / `Recorded collateral valuation`. No TVL.
- Empty state: `No cases require your action.`
- MP §5 priority 2: "Lender-led Overview and Case Queue".

### 7.2 Case Queue `/app/cases` (READ, §9.2 L573–581)
- Columns: Case ID, Asset summary, Borrower (if authorized), Verification stage, Lender review stage, Pledge state (if authorized), Next actor, Last update.
- Filters: My actions, Assigned to me, Stage, Missing evidence, Updated date. Serial search only for the serial's owner.
- Actions: `Open case`, `Create case`, `Export accessible records` (if authorized).
- New-case empty state: `Create a case to coordinate equipment evidence and lender review.`

### 7.3 Create Financing Case `/app/cases/new` (READ, §9.3 L583–591)
- Fields: see §5.2.
- Actions: `Save draft` · `Review sharing` · `Submit to lender`.
- Required validation: borrower mandate; asset identity; evidence package; selected lender; **no conflicting active case workflow that would violate the lock rule**.
- A lender invitation does **not** automatically share all asset data. The scope is sent only after package review and consent.

### 7.4 Assets `/app/assets` and Register Asset `/app/assets/new` (READ, §9.4–9.5 L593–611)
- List columns: Asset ID, Equipment type, Manufacturer/model, Authorized owner organization, Verification summary, Lifecycle state.
- List actions: `Register asset`, `Open passport`.
- Register actions: `Save draft` · `Register passport`.
- Register warning: `Submitted ownership evidence has not yet been independently verified.`
- No leakage of other parties' registrations through duplicate warnings. Committed only after the ledger command succeeds.

### 7.5 Asset Passport `/app/assets/:assetId` (READ, §9.6 L613–625)
- Tabs: `Overview`, `Evidence`, `Verification`, `Cases`, `Activity` (contents filtered by permission). Tab fields are in §5.2.
- Actions: `Add evidence`, `Request verification`, `Create case`, `Review sharing`.
- `Transfer ownership` is **P2 only** and blocked while a lock is active.

### 7.6 Evidence Viewer (READ, §9.7 L627–635; drawer/modal, no route)
- Actions: `Download` (if granted), `Request correction`, `Add new version` (if authorized).
- **Hash match** means the bytes match the committed reference. It does **not** mean the document is original, not forged, or legally enforceable.
- Downloads use a **short-lived URL issued after a server-side access check**. No public bucket and no permanent URLs.
- File policy (L1178): **PDF, JPEG, PNG; max 20 MB per file** (a product policy, not a Canton limit). Without a scanner, real-customer uploads are not production-safe.

### 7.7 Verification Queue `/app/verifications` (READ, §9.8 L637–643)
- Columns: Request ID, assigned equipment summary, scope, due date (if agreed), request stage, requester, last activity.
- Actions: `Accept assignment`, `Open review`, `Request clarification`, `Decline assignment` (with reason).

### 7.8 Verification Workspace `/app/verifications/:verificationId` (READ, §9.9 L645–657)
- Checklist and fields: see §5.2.
- Outcomes: `Attestation issued`, `Changes requested`, `Verification rejected`.
- Actions: `Request changes`, `Submit attestation`, `Reject with reason`.
- Confirmation copy: `This attestation records the checks listed above. It does not approve financing or establish legal lien priority.`

### 7.9 Lender Review Queue `/app/reviews` (READ, §9.10 L659–665)
- Columns: Case ID, equipment summary, evidence completeness, attestation validity, requested principal (if authorized), review stage, analyst, age.
- Saved views: `Ready for review`, `Needs evidence`, `Awaiting approval`, `Release requests`.
- Action: `Open review`.

### 7.10 Collateral Review `/app/reviews/:reviewId` (READ, §9.11 L667–677)
- Tabs: `Evidence`, `Verification scope`, `Assessment`, `Decision`, `Activity`.
- Assessment fields, outcomes and actions: see §4.3 and §5.2.
- Copy for an expired attestation: `This attestation is outside its validity period.`

### 7.11 Financing Proposal, a Case Workspace tab (READ, §9.12 L679–689)
See §4.4. It appears in the Case Workspace **after collateral review**. It is a workflow record, not a disbursement.

### 7.12 Case Workspace `/app/cases/:caseId` (READ, §9.13 L691–699)
- Header: Case ID, equipment reference, organization context, next actor, state summaries, ledger sync timestamp.
- **Tabs:** `Summary`, `Evidence`, `Verification`, `Review`, `Proposal`, `Pledge`, `Sharing`, `Activity`. MP lists "Evidence, Verification, Sharing & Access, Review, Proposal, and Activity" (see §11, C-2).
- Summary tab: current step, missing prerequisites, responsible party, permitted next action.
- This is the **center of the flow**. Contract IDs appear only under `Technical details` when authorized.

### 7.13 Pledges `/app/pledges` (READ, §9.14 L701–707)
- Columns: Pledge ID, accessible asset/case reference, lender/borrower (if authorized), principal reference (if authorized), activated date, state, release stage.
- Filters: `Active`, `Release requested`, `Released`.
- Actions: `Open pledge`, `Request release` (if authorized).

### 7.14 Pledge Detail and Release `/app/pledges/:pledgeId` (READ, §9.15 L709–721)
- Content: see §5.2.
- Borrower action: `Request release`.
- Lender actions: `Request information`, `Authorize release`, `Reject release`.
- Release reasons and confirmation copy: see §4.5.

### 7.15 Sharing and Access `/app/access` or case tab (READ, §9.16 L723–731)
See §4.9.

### 7.16 Audit Center `/app/audit` (READ, §9.17 L733–741)
- Filters: accessible case, event type, actor (only if knowable), date range, committed/pending status.
- Columns: see §5.2.
- Actions: `Open event`, `Export case report`.

### 7.17 Reports / Export History `/app/reports` (READ, §9.18 L743–751)
- The MVP exports **JSON or CSV**. PDF is optional and comes later.
- Fixed label: `Case workflow report — not a legal title or lien certificate.`
- Scoped-export copy: `This report includes only records available within your access scope.`
- A report is never called a complete global history. It has a cutoff and a retention caveat, covers only records the requester may see, and has access evaluated at both generate and download time.

### 7.18 Settings `/app/settings` (READ, §9.19 L753–757)
- Sections: organization profile, members, role/mandates, party binding, environment, notification preferences, integration status.
- Sensitive role changes need org-admin authorization **and** an audit event.
- Secrets, signing keys, participant tokens and raw credentials are never shown or stored through a general profile form.

### 7.19 Governance `/app/governance`, `/app/governance/:proposalId` (READ, §9.20 L759–765)
- Available **only once the real module is integrated**.
- Content: verifier-registry proposals, eligible member list, threshold, confirmations, execution state, referenced module action, execution receipt.
- **MVP governance actions are only `Add verifier` and `Suspend verifier`.** Governance never handles collateral release, credit approval, fund transfer or automatic upgrades of all contracts.
- LocalNet operators must be **labelled as simulated**. **Three local nodes do not prove three independent organizations.**
- MP §8 adds: if the integration is blocked, keep the adapter and **visibly mark governance as simulated or unavailable** (see §11, C-3).

### 7.20 Auth screens (READ, §7 L499–527)
- `/login`: fields are work email plus the chosen auth method. Copy: `Sign in to your Collara workspace.` **Invite-only for the pilot.** Email verification proves neither company authority, lender status, nor trusted-verifier status.
- `/invite/:token`: see §4.11.
- `/onboarding`: see §5.2. Seeded LocalNet organizations **must not be claimed as verified real institutions**.
- Party binding: the backend links user → membership → mandate → approved Canton Party. **Wallet connect is not part of MVP onboarding.**

### 7.21 Demo `/demo` and privacy-proof panel (READ, §17.1, §17.4)
- Role-based walkthrough. The demo role selector is **not connected to production memberships**. Reset applies only to the isolated fixture environment.
- Optional explanatory panel: role, resource attempted, permitted outcome, test result (synthetic fixtures only). **No debug route that leaks hidden records to real users.**

### 7.22 Request Pilot `/pilot` (READ, §6.1 L456–474)
- Heading: `Tell us about your equipment-finance workflow.`
- Description: `We are looking for teams handling used CNC financing to help define and test a focused coordination workflow.`
- Fields: Full name; Work email; Company; Role; Company type; Country; Equipment category; Approximate cases per month (includes an `Unknown` option); Current workflow challenge; Optional current systems; Consent to be contacted.
- **Never ask for** passport files, borrower PII, bank statements or loan documents. Monthly volume is discovery data, not a qualification fact.
- Submit button: `Request a conversation`.
- Success: `Your request has been received. We will contact you using the email provided.` Show it **only after the backend has stored the submission**. If email delivery fails but the data is stored, the request still counts as received and goes into an operational retry queue. **No response-time SLA promises.**
- Error: `We couldn't submit your request. Please try again.`

### 7.23 Docs `/docs` minimum content (READ, §6.2 L480–489)
- What Collara does and does not do.
- The supported demo workflow and synthetic fixtures.
- Roles, evidence scope and authorization rules.
- LocalNet prerequisites, environment versions, and setup/run instructions.
- How to run positive and negative tests.
- Known limitations, the operator trust model and deployment status.
- Data model and an API overview for developers.
- Sponsor-module instructions **only if the module really exists**.

### 7.24 Security, Privacy, Terms (READ, §6.3–6.4 L491–497)
- Security: organization-scoped authorization, party mapping, document access, secret handling, retention, audit visibility and the incident-contact path, all **actually active**. Separate implemented controls from planned ones. **No SOC 2, ISO or "GDPR-compliant" claims without basis.**
- Privacy covers: lead forms, user identity, documents, hosting providers, retention, analytics, contact and rights requests.
- Terms cover: not a lender, custodian or legal registry; each party's responsibilities; evidence limitations; service terms. **Legal review is needed before real data; the spec is not legal text.**

---

## 8. Copy, positioning and labelling (landing copy verbatim, READ §5 L142–452)

General rules (L144): every capability label describes product direction. **Publish only claims that have been demoed. Label anything not running as planned.** No savings figures, customer logos, testimonials, market-share claims or certification badges.

### 8.1 Metadata (L148–151)
- Title: `Collara — Private Equipment Collateral Workflows`
- Meta description: `Coordinate used CNC equipment evidence, lender review, and authorized pledge and release workflows with Collara, built on Canton.`
- Social title: `Equipment evidence. Authorized collateral workflows.`
- Social description: `A private coordination workspace for lenders, equipment owners, and verifiers.`

### 8.2 Hero (L166–192)
- Eyebrow: `Private equipment collateral workflows`
- Headline: `Equipment evidence and pledge workflows, coordinated privately.`
- Description: `Bring used CNC equipment evidence, verification, and lender review into one coordinated workflow. Share the relevant records with selected counterparties and track who can authorize each pledge and release.`
- Primary CTA: `Explore the demo` → `/demo`. Secondary CTA: `Request a pilot` → `/pilot`.
- Supporting text: `Starting with used CNC financing. Built on Canton.`
- Demo disclosure: `The demo uses synthetic data on LocalNet. No funds are transferred.`
- **Pre-demo publication rule (L192):** if `/demo` is not actually working, the primary CTA becomes `Request a pilot`, the secondary becomes `Read the workflow` → `/#workflow`, and the disclosure becomes `Collara is currently in development. We are seeking equipment-finance design partners.` **No dead demo button.**

### 8.3 Hero product preview card (L194–207)
- `Used CNC financing · CL-001`
- Asset: `CNC machining center`
- Current stage: `Awaiting lender review`
- Evidence: `Inspection report · submitted`
- Verification: `Attestation issued · scope available`
- Sharing: `Shared with selected lender`
- Next action: `Review evidence`
- Permanent label: `Illustrative demo case`
- Any serial, borrower name, valuation or amount shown must be synthetic. Document images come from sample fixtures.

### 8.4 Problem section (anchor `product`, L209–231)
- Heading: `The documents are digital. The coordination can still be fragmented.`
- Body: `Equipment financing can involve borrower records, dealer documents, inspection reports, and lender systems. When these records are reviewed separately, teams may need repeated follow-ups to confirm which evidence is current and who is responsible for the next step.`
- Items:
  - `Evidence across counterparties`: `Bring case-specific records together without making every document visible to every participant.`
  - `Status without guesswork`: `Track verification, lender review, and pledge status as separate states instead of treating one approval as proof of everything.`
  - `Clear authorization`: `Make the responsible party and required authorization explicit before a workflow transition is submitted.`

### 8.5 Product section (L233–261)
- Heading: `One case workspace. Defined responsibilities.`
- Body: `Collara connects an equipment passport with its supporting evidence, verification scope, lender decision, and collateral workflow. Each participant works with the records and actions relevant to their role.`
- Cards:
  - `Equipment Passport`: `Keep the equipment identifier, submitted ownership evidence, inspection references, and document versions linked to the case.`
  - `Scoped Evidence Sharing`: `Share a selected evidence package with a named lender or verifier. Keep unrelated records outside that package.`
  - `Pledge and Release Workflow`: `Record an active collateral lock for a registered asset within Collara and require the designated lender's authorization for release.`
  - `Case History`: `Review the actors, decisions, evidence versions, and committed workflow transitions available within your access scope.`
- Boundary note: `A Collara record is not a legal lien registration, proof of title, or verification of pledges outside Collara.`

### 8.6 Workflow section (anchor `workflow`, L263–282)
- Heading: `From equipment evidence to authorized release.`
- Steps:
  - 01 `Register the equipment`: `Create a passport and attach case-specific equipment records.`
  - 02 `Request verification`: `Assign an accepted verifier and define what needs to be checked.`
  - 03 `Share with the lender`: `Provide the selected lender with the approved evidence package.`
  - 04 `Record review and pledge`: `Capture the lender decision and activate the collateral lock with the required authorizations.`
  - 05 `Request and authorize release`: `Route a release request to the designated lender and record its decision.`
  - 06 `Export the case history`: `Generate a permission-scoped record of the evidence and workflow.`
- Supporting note: `Credit decisions, disbursement, legal filings, and enforcement remain with the lender and its existing processes.`

### 8.7 Lender section (anchor `for-lenders`, L284–312)
- Heading: `Start with one credit and documentation team.`
- Body: `Collara's initial focus is equipment-finance lenders handling used CNC machinery. The first pilot is designed to test one workflow alongside existing origination and servicing systems—not replace the entire lending stack.`
- Cards:
  - `Review queue`: `See which cases need evidence, verification, or a lender decision.`
  - `Evidence context`: `Review the source, version, scope, and validity of records before relying on them.`
  - `Release control`: `Keep release authority with the lender named on the collateral workflow.`
  - `Pilot measurement`: `Compare follow-up cycles and handling time with the current process.`
- CTA: `Discuss your workflow` → `/pilot`

### 8.8 Participants section (L314–330)
- Heading: `Different participants. Different permissions.`
- Rows:
  - `Equipment owners`: `Submit equipment evidence, approve sharing, and follow the case's next steps.`
  - `Dealers`: `Contribute relevant equipment records to an invited case.`
  - `Verifiers`: `Review assigned evidence and issue an attestation with an explicit scope.`
  - `Lenders`: `Assess the case, record decisions, and authorize collateral release.`
  - `Auditors`: `Inspect and export the records covered by their access grant.`
- Supporting text: `Participation does not grant access to every document, every loan term, or every case.`

### 8.9 Canton section (anchor `why-canton`, L332–360)
- Heading: `Shared workflow rules without shared access to everything.`
- Body: `Collara is being built with Daml workflows on Canton. Contract permissions define who can participate in a transition and which records are disclosed to the relevant parties.`
- Cards:
  - `Scoped disclosure`: `Design separate records for equipment evidence and financing terms so their recipients can differ.`
  - `Explicit authorization`: `Express verifier, owner, and lender responsibilities in the workflow rather than relying only on interface controls.`
  - `Recorded transitions`: `Connect case history to committed workflow events instead of treating a clicked button as a completed action.`
- Supporting note: `Privacy depends on the implemented contract model and deployment. The LocalNet demo will include access-denial and authorization tests.`
- Rule: **no Canton partnership, endorsement or certification label.** This section's technical claims may be promoted as implemented **only after testing**.

### 8.10 Pilot section (L362–382)
- Heading: `Help shape the first used CNC financing pilot.`
- Body: `We are looking for a lender team willing to map its current evidence and collateral-status workflow. Together, we will define a limited pilot, agree on the required participants, and measure whether coordination improves.`
- Outline:
  1. `Map one current workflow.`
  2. `Test with historical or approved shadow cases.`
  3. `Compare follow-ups, handling time, and onboarding effort.`
- CTA: `Request a pilot` → `/pilot`
- Supporting text: `A pilot request is not a loan application. Do not submit financial documents through this form.`

### 8.11 FAQ (heading `Questions before you start`, L384–418)
| Question | Answer (verbatim) |
|---|---|
| `Is Collara a lender?` | `No. Collara coordinates equipment evidence and collateral workflow. Financing decisions and funding remain with the lender.` |
| `What equipment does Collara support first?` | `The initial scope is used CNC machinery. Other equipment categories are outside the first pilot.` |
| `Does an attestation prove legal ownership?` | `Not automatically. An attestation states what a verifier checked, the evidence used, and its limitations. Legal ownership and lien checks remain separate requirements.` |
| `Can Collara prevent double pledging?` | `The planned workflow blocks a second active lock for the same registered asset within Collara. It does not detect every pledge outside the system or guarantee that duplicate physical-asset registrations cannot occur.` |
| `Who can see my documents?` | `Access depends on your case's grants and the implemented contract permissions. Only selected evidence should be disclosed to selected parties. Your hosting provider's access and trust model must also be considered.` |
| `Can shared information be taken back?` | `Future document access can be limited or revoked according to the workflow. Information already disclosed, downloaded, or stored by a participant cannot be guaranteed to disappear.` |
| `Does Collara replace our lending system?` | `No. The initial pilot is a coordination layer alongside existing credit, documentation, and servicing processes.` |
| `Does the demo move money?` | `No. The demo uses synthetic records on LocalNet. Cash settlement and MainNet wallet payments are outside the initial scope.` |

[INFERRED] Once the LocalNet path is implemented, the double-pledging answer's word "planned" should be revisited; keep it until it is tested.

### 8.12 Final CTA (L420–432)
- Heading: `Make the next step in the case clear.`
- Body: `Explore the equipment evidence workflow, or help us test it with a focused lender team.`
- Primary: `Explore the demo` → `/demo`, **only once the demo is available**. Secondary: `Request a pilot` → `/pilot`.

### 8.13 Other in-app boundary and confirmation copy (READ)
- Attestation confirm: `This attestation records the checks listed above. It does not approve financing or establish legal lien priority.`
- Proposal accept: `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.`
- Release confirm: `This releases the Collara workflow lock. Any required legal lien termination must be completed separately.`
- Report label: `Case workflow report — not a legal title or lien certificate.`
- The operational copy table (L1118–1136) is quoted in full in §4.3, §4.5, §4.7, §4.9, §4.10, §7.1, §7.2, §7.10 and §7.17.

### 8.14 Demo labelling and modes
- [READ] Spec (L1074): "Semua halaman menampilkan `Demo data — LocalNet`". Every demo page shows this.
- [READ] Spec (L190): `The demo uses synthetic data on LocalNet. No funds are transferred.`
- [READ] Spec (L205): `Illustrative demo case` on the hero preview.
- [READ] Header environment indicator: `LocalNet` / `DevNet` / `MainNet` per the real connection (L542).
- [READ, MP §5] Modes `UI_MOCK` → label **"Synthetic demo data — UI mockup."** and `LOCALNET` → label **"Synthetic demo data — Canton LocalNet."** **No silent fallback from a failed LocalNet action to simulated success.**
- The spec has **no UI_MOCK concept**. Resolution is in §11, C-1.
- Other "never claim" items (READ, L1201, L1187): customers, partners, metrics, certifications, settlement, MainNet deployment. Never say "trustless" while hosting is centralized. LocalNet ≠ DevNet/MainNet. Never mix seeded parties with real customers (L1041). Integration targets (LOS, ERP, e-signature, lien search, appraisal, insurer) are **planned, not available integration logos** (L1060).

---

## 9. Canton / Daml design, parties, privacy and BitSafe

### 9.1 Proposed contract families (READ, §14.1 L926–939)
1. Registry authorization and canonical asset-control issuance.
2. Private AssetPassport version/reference.
3. VerificationRequest and VerificationAttestation.
4. EvidenceSharing/Consent, or a scoped disclosure package.
5. CollateralAssessment (lender-scoped).
6. FinancingProposal and acceptance.
7. AssetControl and CollateralLock.
8. ReleaseRequest and the release decision.
9. AuditAccessGrant / scoped summary, if needed.
10. Verifier-registry governance module (sponsor path).

"This is a design model, not compiled Daml." **Do not add a global `AuditRecord` holding every event for all auditors.** The transaction stream plus a scoped projection can serve as the audit source.

### 9.2 Workflow actions and required authority (READ, §14.2 L943–958)
| Action | Required authority | Expected output |
|---|---|---|
| Register passport/control | Owner mandate + controlled registry issuance | Canonical passport/control for the asset ID |
| Request verification | Owner/requester and a permitted assignment | Request with explicit scope |
| Submit attestation | Active assigned verifier | Issued attestation linked to the evidence version |
| Share package | Authority of the record owner + case consent | Selected-recipient package/grant |
| Record assessment | Lender mandate | Case-scoped decision |
| Issue proposal | Lender approver | Private borrower-lender proposal |
| Accept proposal | Borrower mandate | Acceptance linked to the exact proposal version |
| Activate pledge | Required borrower/lender authorization via the workflow | Available control consumed; active control and lock |
| Request release | Authorized borrower/lender case role | Request **without unlocking** |
| Authorize release | Designated lender approver | Active lock/control transition; available control; release event |
| Grant audit access | Authority of each record's owner | Scoped audit package; not a universal observer |
| Suspend verifier | Governed registry authority, if the module is active | Future registry state update; history kept |

- Final signatories and controllers must be tested on the chosen runtime.
- **Check generic `Archive` choices and create authority for bypasses.**
- **The admin service must not get unrestricted `actAs`.**

### 9.3 Single-lock enforcement (READ, §14.3 L960–966)
- **Consuming the same canonical control contract is the contention boundary** for activation.
- Registry issuance must prevent more than one canonical control per asset ID in the namespace, **including after correction or archive**.
- **Never** rely on a backend `if not pledged` check followed by a create; two requests can race.
- Serial numbers and **contract keys** do not give global physical-asset uniqueness. **Contract-key support and semantics must be verified on the target Canton runtime before use.** [INFERRED, outside knowledge, verify] Daml 3.x / Canton 3.x (the spec links docs 3.4) does not support classic unique contract keys. Plan on the consumed-control pattern with no key-based uniqueness, and a registrar-controlled issuance contract (for example a registry contract that tracks issued asset IDs, or a per-asset "issuance token" consumed once).
- Required tests: two concurrent activations → at most one commits. Also attempt minting a replacement control, archiving via a generic choice, transfer, replay, and release without the lender. **All bypasses must fail or leave the active lock in place.**

### 9.4 Privacy and disclosure (READ, §12.2 L874–883, §14.4 L968–972)
- **Do not build one passport contract holding equipment evidence, all loan terms, and every bank/verifier/auditor as observers.**
- Separate:
  - the canonical minimal asset control
  - the private passport details
  - the attestation package
  - the lender assessment
  - the financing proposal
  - the scoped audit summary
- Avoid transaction shapes that disclose sensitive consequences to broad stakeholders. **Test witness and observer visibility on consuming choices.** A private field that is never rendered can still leak through a ledger event.
- API and object storage must enforce grants. A hash or opaque document ID on the ledger does not make the file storage private.
- Operator and node-hosting access is a trust dependency that must be stated. The UI does not guarantee privacy against a server holding plaintext or credentials. Document who holds keys, who authorizes mandates, who operates nodes and who can read off-ledger files (L1186).
- **Disclosure test matrix:**
  - Parties: borrower, assigned verifier, selected lender, **unrelated lender**, scoped auditor, operator.
  - Lender B must not see Lender A's terms via parent-transaction consequences, aggregation, logs or the observer set.
- Daml changes use **archive/create** per the chosen choice semantics, not row updates. References: https://docs.digitalasset.com/build/3.4/reference/daml/choices.html and https://docs.digitalasset.com/build/3.4/tutorials/smart-contracts/choices.html, plus https://www.canton.network/protocol.

### 9.5 Parties [READ demo orgs §17.1; party mapping INFERRED]
- Demo orgs: `Demo Manufacturer` (borrower), `Demo CNC Dealer`, `Demo Verifier`, `Demo Lender A` (selected), `Demo Lender B` (unrelated), `Demo Auditor`.
- [INFERRED] Add a Collara operator/registrar party, plus 3 governance member parties for BitSafe (possibly a decentralized/shared-control party hosted across 3 LocalNet nodes).
- [READ] A web account ≠ a party. Party binding is approved by an admin. The session maps to the party server-side. Ledger credentials are narrow. **Signing authority is separate** (L1172).

### 9.6 BitSafe / DLC-link Decentralization Manager (READ, §16.2 L1043–1056, §21.5 L1237–1243)
- Plan: a **shared-control party for verifier-registry administration with a 2-of-3 threshold**. The first action is `Add verifier`; the next is `Suspend verifier`.
- The demo must prove:
  1. One confirmation cannot execute.
  2. Two distinct eligible confirmations can execute **via the real module**.
  3. A duplicate approval from one member does not raise the count.
  4. An expired or rejected proposal does not execute.
  5. A suspended verifier cannot issue new attestations, per policy.
  6. Governance cannot bypass lender authorization for release.
- "Confirmation buttons on the website without the Decentralization Manager integration are **not challenge proof**."
- Record: node names, operator names, package/module versions, threshold, setup instructions and simulation limitations.
- The **Contribution Pool** uses a reproducible LocalNet per the challenge sheet. **Gold** needs a separate deployment path and eligibility, which this spec does not assume.
- Repo: https://github.com/DLC-link/decentralization-manager ("integration starting point named by the challenge; not proof Collara is integrated"). MP adds `docs/CUSTOM_DAML_TEMPLATES.md` and the `GovernableAction` interface.
- Acceptance: a real DM integration exists; thresholds below and at the requirement are tested; operator names and simulation boundaries are explained; **registry admin cannot override a lender release**; challenge/deployment eligibility is verified before submission.
- §23: the BitSafe default is "P1 shared-control verifier registry"; still to confirm are the current module API, setup and challenge eligibility.

### 9.7 Wallets and payments (READ, §16.4 L1064–1066)
**Grofty, token settlement, cBTC/cETH collateral and fees in CC are not needed for the MVP.** Do not add a wallet just to earn a challenge logo.

---

## 10. Demo, tests, acceptance criteria, implementation order and open decisions

### 10.1 Demo fixtures (READ, §17.1 L1070–1076)
- Organizations: listed in §9.5. Asset: one `CNC machining center`, asset ID `ASSET-DEMO-001`, synthetic serial, sample invoice/photo/inspection fixtures.
- MP adds: case `CL-001`, model `DEMO-CNC-500`, serial `SYNTH-CNC-001`, valuation USD 150,000, principal USD 100,000, a maintenance summary, and a seeded "registered, attested, awaiting-lender-review" case with no proposal and no lock, plus a clean-start demo.

### 10.2 Happy path (READ, §17.2 L1078–1090)
1. Borrower registers the asset and evidence.
2. Verifier accepts the task, reviews the scope and issues an attestation.
3. Borrower creates a case and shares the selected package with Lender A.
4. Lender analyst reviews; the approver issues a proposal.
5. Borrower accepts the exact proposal version.
6. Required parties activate the pledge; the active lock is visible within authorized scope.
7. Borrower requests release; the lock stays active.
8. Lender A authorizes release.
9. Auditor receives a scoped grant and exports the case history.

Recording `external repayment confirmed` is **synthetic manual input** in the demo. It is not a banking integration or proof of payment.

### 10.3 Negative path (READ, §17.3 L1092–1102)
- Lender B cannot read Case A, its loan terms, documents, export or events.
- The verifier cannot read the proposal principal or terms.
- A borrower's self-release is **rejected by ledger authority**.
- Two concurrent activations → at most one commits.
- An asset transfer or archive that bypasses the lock is rejected.
- An expired or revoked attestation does not meet activation prerequisites.
- Changing the organization/party ID in an API request is still rejected.
- A new document version is not treated as identical to the previously attested evidence.
- A timeout produces no duplicate command success.

### 10.4 Acceptance criteria (READ, §21 L1196–1243)
- **Public:** every nav item and CTA reaches a real destination; no unearned claims; the synthetic/LocalNet disclosure is visible; the pilot form stores data before showing success; no loan docs are collected; mobile nav and forms work.
- **Core:** passport and evidence refs actually committed; attestation has issuer, scope, limitations, evidence versions and validity; the selected lender gets only the approved package; assessment ≠ funded; exact-version acceptance is checked; activate and release use real Daml authority; no two active locks; registry issuance and implicit archive/create cannot bypass the lock; a release request does not unlock; a failed or unknown command never appears as success.
- **Privacy:** Lender B sees none of Lender A's case, terms, doc metadata, files, counts, search, notifications, exports or events; verifier/dealer get no terms via transaction consequences; the auditor gets only the granted subset; the operator has no universal financial access; revoked or expired grants are checked at download; session/party manipulation and direct URL access are rejected.
- **Audit/demo:** exports carry access scope, evidence versions, timestamps, commit refs and a coverage watermark; the audit report is distinguished from a legal certificate; the demo is reproducible from a clean environment; the README gives exact runtime/package versions and test commands; **demo states come from the actual workflow, not hardcoded success screens.**

### 10.5 Implementation order (READ, §22 L1245–1255)
1. Freeze the actor/party mapping, field sensitivity, the one-asset workflow and the canonical asset-control model.
2. Build the Daml lifecycle and its tests: activation/release authority, privacy witnesses, duplicate issuance, concurrent activation, implicit archive bypass.
3. Build the authenticated backend, command lifecycle, party-scoped indexer and private documents.
4. Build the screens: Case Workspace, Passport, Verification, Lender Review, Proposal, Pledge/Release, Audit export.
5. Add demo fixtures and the isolated role walkthrough; verify each displayed state against the ledger.
6. Build the landing page and pilot form; **enable the demo CTA only after the flow works.**
7. Add sponsor governance only after the core flow is stable.
8. Run a clean setup, the negative demo, accessibility and error-state checks, and a docs review.
9. Run discovery/pilot with consent and security/legal requirements; never move the synthetic demo straight into production.

MP's order differs: frontend migration with a **mock walkthrough** comes before Daml (see C-6).

### 10.6 Open decisions (READ, §23 L1257–1271)
| Decision | Default | Still to confirm |
|---|---|---|
| Pilot buyer | One used-CNC lender team | Interviews and a named sponsor |
| Geography | US for discovery | Pilot jurisdiction and legal obligations |
| Runtime | Supported Canton/Daml LocalNet release | Compatibility with the starter/sponsor module |
| Identity namespace | Controlled canonical registry | Duplicate physical-identity review; issuer authority |
| Hosting | Explicitly documented pilot hosting mode | Operator trust, cost, key custody, counterparties |
| Verifier acceptance | **Lender-approved scoped verifier** | Professional mandate, policy, revocation behaviour |
| Evidence retention | Private storage under an agreed policy | Counterparty/legal/security review |
| Signing delegation | Narrow organizational mandates | Technical implementation; customer acceptance |
| BitSafe | P1 shared-control verifier registry | Current module API, setup, challenge eligibility |
| Pricing | Paid-pilot hypothesis from GTM | Benefit, buyer budget, support/hosting cost |
| Public contact/repository | No placeholders shown | Real project address/URL |

### 10.7 Security and reliability (READ, §20 L1168–1194)
- **Authorization:** membership checks; org mandates; narrow ledger credentials; separate signing authority; no client `actAs`; all associated resources checked.
- **Files:** private storage; encryption in transit and at rest per deployment; type and size allow-list; malware scanning **or explicit blocking until the scan completes**; server-side hash; safe filenames; versioned objects; expiring URLs; **no content logging**.
- **Consistency:** commit receipts; idempotency; concurrent-lock tests; replay protection; stable IDs vs contract IDs; projection reconciliation; stale indicator; unknown-outcome recovery.
- **Retention:** set together with pilot counterparties. Grant expiry does not delete historical disclosures. Audit continuity is limited by retained source data, projection completeness and participant pruning. **Exports must record coverage.**

---

## 11. Contradictions, tensions and gaps

### 11.1 Spec vs master prompt (MP is authoritative; proposed resolution in italics)
- **C-1 Demo/mode labels.**
  - Spec L1074: all pages show `Demo data — LocalNet`. Spec L190: `The demo uses synthetic data on LocalNet. No funds are transferred.` The spec has no UI_MOCK mode.
  - MP §5: `UI_MOCK` → "Synthetic demo data — UI mockup." and `LOCALNET` → "Synthetic demo data — Canton LocalNet."
  - *Use MP's two labels, driven by the actual mode. In UI_MOCK, the landing disclosure and the FAQ "Does the demo move money?" ("synthetic records on LocalNet") would be false. Make the disclosure mode-aware, or use the spec's pre-demo copy (L192) until LOCALNET works. The header environment indicator (spec L542, `LocalNet/DevNet/MainNet`) also needs a `UI mockup` value.*
- **C-2 Case Workspace tabs.**
  - Spec L695: `Summary`, `Evidence`, `Verification`, `Review`, `Proposal`, `Pledge`, `Sharing`, `Activity`.
  - MP §5.3: "Evidence, Verification, Sharing & Access, Review, Proposal, and Activity". MP drops Summary and Pledge and renames Sharing → "Sharing & Access".
  - The tab order also differs: the spec puts Sharing after Pledge, while MP puts Sharing & Access after Verification, which matches the workflow order.
  - *Build the union: Summary, Evidence, Verification, Sharing & Access, Review, Proposal, Pledge, Activity. The Pledge tab links to `/app/pledges/:pledgeId`.*
- **C-3 Governance visibility when the module is unavailable.**
  - Spec L535 and L761: Governance appears only if the real module is integrated and the user has a mandate.
  - MP §8: "If sponsor integration is blocked, retain the adapter boundary and visibly mark governance as simulated or unavailable."
  - Spec L765 itself requires LocalNet operators to be labelled "simulated".
  - *Show the Governance/Verifier Registry page with an explicit `Unavailable` or `Simulated` banner. Never show working confirmation buttons without the DM; the spec says these are "not challenge proof".*
- **C-4 Verifier Registry screen.** MP priority 8 is "Verifier Registry and Governance". The spec has no verifier-registry list route, only `/app/governance` and `/app/governance/:proposalId`. *Add a registry view (e.g. `/app/governance` tab "Verifier registry", or `/app/governance/verifiers`) listing verifiers with `ACTIVE/SUSPENDED` status.*
- **C-5 Screen priority emphasis.** MP puts "Lender-led Overview" first. The spec's demo journey is borrower-first: the borrower registers, attests and creates the case (§17.2). Both are compatible, but the default demo persona should be the lender per MP. The MP seed (attested, awaiting lender review) matches the spec's hero preview (`Awaiting lender review`).
- **C-6 Build order.**
  - Spec §22: Daml and backend first, then screens, then landing. The **demo CTA is enabled only after the flow works**.
  - MP §10: frontend migration and **mock walkthrough first** (step 2), then Daml.
  - *Follow MP's order, but keep the landing on pre-demo copy (spec L192) until the LOCALNET demo works. MP §5 agrees: "Promote demo CTAs only when the corresponding demo works".*
  - Open question: does a UI_MOCK walkthrough count as "demo works" for the `Explore the demo` CTA? *Suggest no for LocalNet claims. A UI_MOCK walkthrough may be linked only with the UI-mockup label and a disclosure that does not mention LocalNet.*
- **C-7 Command failure states.** Spec L1021 lists `REJECTED`, `FAILED`, `UNKNOWN_OUTCOME`, `PROJECTION_DELAYED`. MP §7 names only rejected, unknown-outcome and projection-delayed. *Keep `FAILED` (pre-submit/infrastructure failure).*
- **C-8 Fixture detail.** MP adds model `DEMO-CNC-500`, serial `SYNTH-CNC-001`, USD 150,000 / 100,000 and a maintenance summary. The spec only says "serial synthetic". There is no conflict; use MP's values.
- **C-9 Docker.** MP §3 assumes "Docker Compose" for local infra and MinIO; **this machine has no Docker**. The spec is silent. This is an environment conflict with MP, not with the spec. *Use native or WSL services (PostgreSQL 16 in WSL is already running; MinIO and Keycloak run as standalone binaries / Java 21). Canton LocalNet is normally Docker-based (cn-quickstart), so it needs a non-Docker path such as the Daml SDK sandbox or Canton jar. Verify.*
- **C-10 Auth specifics.** The spec only says "work email + chosen auth method; invite-only for pilot". MP specifies OIDC Authorization Code + PKCE, backend cookie sessions and Keycloak by default. No conflict; MP is more specific.
- **C-11 Idempotency scope wording.** Spec: "tenant, actor, operation, payload hash". MP: "actor, organization, operation, and payload". These are equivalent (tenant = organization).
- **C-12 Visual direction.** Spec §24 explicitly **excludes** the visual direction from "Collara UI.docx". MP §5 sets "Mercury-inspired" for the dashboard and "previously approved Collara direction" for the landing. No conflict; the spec is simply silent.
- **C-13 Personas.** MP §1 lists "manufacturers, independent verifiers, and equipment-finance lenders". The spec has 9 roles, including Dealer, Analyst/Approver split, Auditor, Org Admin, Operator and Governance Member. MP §5 says dealer contributions may stay inside case/evidence tabs, consistent with spec §10.2. *Implement the spec's roles; at minimum, seed separate Analyst and Approver users for Demo Lender A.*

### 11.2 Internal contradictions and gaps in the spec
- **I-1 Verification before or after case creation.**
  - Journey §10.1 (L771) and the happy path §17.2 run verification **before** case creation: register → verify → create case → share.
  - The Asset Passport has `Request verification` (L625), and `VerificationRequest` has "asset/case" (L897).
  - But the only API is **case-scoped**: `POST /api/cases/:id/verification-requests` (L1000). The case state machine also puts `VERIFICATION` after `EVIDENCE_COLLECTION` inside a case (L837).
  - *Support asset-level verification requests (e.g. `POST /api/assets/:id/verification-requests`) as well as case-scoped ones, or create a draft case early. Decide explicitly.*
- **I-2 Pledge-state table mixes three objects.** `AVAILABLE` (asset control), `ACTIVE`/`RELEASED` (lock) and `RELEASE_REQUESTED`/`RELEASE_REJECTED` (release request) sit in one table (L825–831). L833 then says `RELEASE_REJECTED` is a request outcome while the lock stays `ACTIVE`. *Model AssetControl, CollateralLock and ReleaseRequest states separately (§4.5).*
- **I-3 Release "Request information" has no state.** Lender actions include `Request information` (L715) and the next action from `RELEASE_REQUESTED` includes "requests information" (L829), but no state exists for it.
- **I-4 Lender review has no "awaiting approval" state.** The Analyst→Approver split (`Submit for approval` → `Approve eligibility`), the saved view `Awaiting approval` (L663) and the Overview item "decisions awaiting approval" (L566) all need one, but none exists in §11.3. *Add something like `PENDING_APPROVAL` between `IN_REVIEW` and `ELIGIBLE/REJECTED`, or model the approval as a separate record.*
- **I-5 Verification assignment states missing.** `Accept assignment`, `Decline assignment` and `Request clarification` (L641) have no states in §11.2.
- **I-6 No state vocabulary for:** access grants/sharing, evidence documents (scan/integrity/review), invitations, organization onboarding, membership, export jobs, governance proposals, or verifier registry status. The fields reference "grant status", "scan state", "onboarding state", "state" and "execution state" without enumerations. Proposals are in §4.9–4.13 [INFERRED].
- **I-7 Who approves a verifier.** §23 defaults "Verifier acceptance" to **"Lender-approved scoped verifier"**. §14.2, §16.2 and §9.20 make the verifier registry **governed by 2-of-3 governance members** (Add/Suspend verifier). Landing step 02 says "Assign an accepted verifier". Lender approval and governance registry admission are different trust anchors. *Possible reading: governance controls global registry admission and suspension; the lender separately accepts or chooses the verifier per case. Confirm with the user.*
- **I-8 Who issues a proposal.** §3 says the Lender Analyst "prepares assessment/proposal" and the Approver "authorizes proposal". §9.12 says lender `Issue proposal`. §14.2 says "Issue proposal — Lender approver". *Analyst drafts (`DRAFT`), approver issues (`ISSUED`).*
- **I-9 Who requests release.** §9.15 lists only "Borrower action: Request release". §12.1 and §14.2 also allow an "Authorized case role" on the lender side. Minor; the more permissive version applies.
- **I-10 Case `REJECTED` and `CANCELLED` transitions are not specified.** Neither is who can cancel. Only "cancellation after pledge active does not release the lock" is stated.
- **I-11 Activation actors are vague.** "Required borrower/lender authorization via the workflow" (L952) and "Required parties activate pledge" (L1085). It is unclear whether activation needs both signatures (borrower acceptance as pre-authorization plus a lender exercise) or a multi-party submission. *Inferred: the borrower's accepted proposal carries borrower authority, and the lender approver exercises activation consuming `AssetControl`. Verify against Daml authorization rules.*
- **I-12 Route granularity vs P0.** `/app/verifications`, `/app/reviews` and `/app/access` are each P0 but "may be a tab inside Cases" (L124–130). The nav (L533) excludes them. Both are allowed; keep the URLs working, at least as redirects or filtered views.
- **I-13 Footer `Demo` link vs the pre-demo rule.** The footer always lists `Demo` (L436), while the hero and final CTA hide the demo until it works (L192, L430). *Hide or relabel the footer Demo link under the same condition. "No dead links" (L452).*
- **I-14 Anchor naming.** The nav item `Product` → `/#product`, but the anchor `product` sits on the **Problem** section, not the "Product" section (L211 vs L233). Probably intentional; note it for implementation.
- **I-15 ID formats** are given only for the demo (`CL-001`, `ASSET-DEMO-001`). Nothing defines format or generation for request, attestation, pledge, proposal, grant or export IDs.
- **I-16 Missing read and other API endpoints** for most queues and details (§6.2 [INFERRED] list): proposal decline/withdraw, assignment accept/decline, attestation revoke/correct, governance confirm/execute, invitation creation, onboarding.
- **I-17 "Planned" language in the FAQ.** "The planned workflow blocks a second active lock…" must remain until it is tested. After LocalNet tests pass, the wording should change per the L144/L360 promotion rule. Not a contradiction, but a copy-update trigger.

---

## 12. Quick cross-reference: spec section → line ranges
| Spec § | Topic | Lines |
|---|---|---|
| 1 | Goals and boundaries | 34–60 |
| 2 | Priorities | 62–72 |
| 3 | Roles | 74–88 |
| 4 | Routes | 90–140 |
| 5 | Landing copy | 142–452 |
| 6 | Pilot, docs, security, legal | 454–497 |
| 7 | Auth and onboarding | 499–527 |
| 8 | App shell rules | 529–554 |
| 9 | App pages | 556–765 |
| 10 | Journeys | 767–787 |
| 11 | States and invariants | 789–852 |
| 12 | Permissions and privacy | 854–883 |
| 13 | Data model and money | 885–922 |
| 14 | Canton/Daml | 924–972 |
| 15 | API and command lifecycle | 974–1033 |
| 16 | Integrations and BitSafe | 1035–1066 |
| 17 | Demo | 1068–1106 |
| 18 | Notifications and microcopy | 1108–1138 |
| 19 | Analytics | 1140–1166 |
| 20 | Security | 1168–1194 |
| 21 | Acceptance | 1196–1243 |
| 22 | Implementation order | 1245–1255 |
| 23 | Open decisions | 1257–1271 |
| 24 | Sources | 1273–1295 |
