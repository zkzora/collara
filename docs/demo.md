# Demo script: CL-001

A walkthrough of the synthetic case **CL-001** (`ASSET-DEMO-001`, a `CNC machining center`, model `DEMO-CNC-500`, serial `SYNTH-CNC-001`) for each persona, in LOCALNET (a local Canton sandbox) and in UI_MOCK (no backend). Everything is synthetic: Demo Manufacturer, Demo CNC Dealer, Demo Verifier, Demo Lender A (selected), Demo Lender B (unrelated), Demo Auditor; valuation USD 150,000.00; requested principal USD 100,000.00.

What has been verified, and how:

- **UI_MOCK:** the full click path below is automated by `apps/web/e2e/walkthrough.spec.ts` (Playwright), which passed in the integration check recorded in `docs/PROGRESS.md`. Button and dialog names in this script are the ones that spec asserts.
- **LOCALNET:** the same steps were verified at the API level against the Canton 3.5.19 sandbox by `apps/api/test/localnet/*.it.test.ts` (49/49 at commit `e320c59`), with assertions on the ledger's active contracts. An automated browser walkthrough in LOCALNET is not part of this document's evidence; screen labels can change while the UI is being finished.

## 1. Before you start

**LOCALNET.** Bring-up commands are in [`docs/setup.md`](setup.md), [`scripts/localnet/README.md`](../scripts/localnet/README.md) and the root [`README.md`](../README.md). For this script you need, running: PostgreSQL (migrated, demo identities seeded, party bindings imported after the ledger bootstrap), SeaweedFS, the Canton sandbox (bootstrapped and seeded with the `main` profile), the API with `COLLARA_MODE=LOCALNET` and `DEMO_SESSIONS_ENABLED=true`, the worker, and the web app with `COLLARA_MODE=LOCALNET`. Then open **http://localhost:3000/login**. The banner reads `Synthetic demo data — Canton LocalNet.`

**UI_MOCK.** Only the web app (`COLLARA_MODE=UI_MOCK`, the default). Open `/login`; the banner reads `Synthetic demo data — UI mockup.` The mock world lives in the browser tab: switch personas with the sidebar selector and navigate with links. A full page reload starts a fresh world.

**Starting state (`main` seed).** CL-001's asset is registered; the evidence package `PKG-001` is at version 2; the verifier issued `ATT-001` on it; the package is shared with Demo Lender A (with the dealer's consent for its own document), the control token is shared with Demo Lender A at control version 3, Demo Lender A holds a disclosure of `ATT-001`, and its review `CA-001` is `SUBMITTED`. No proposal, no lock (daml-model.md §7, M1–M18).

**Where the ledger evidence shows (LOCALNET):**

- After each action the command status reads `Confirmed on the ledger.` with `Update <id> · offset <n>` only when the ledger returned an update id. While the projection catches up: `The action is confirmed. This view is still synchronizing.` A rejection reads `This action could not complete because the asset workflow state changed.`; an unreachable ledger reads `The ledger is unavailable. No confirmed state change has been recorded.` Nothing is ever simulated.
- The workspace header and sidebar show the projection watermark (`Ledger synced · offset <n> · <time>`).
- `/app/audit/events` lists committed events (with update ids) within the viewer's scope.
- `GET /api/commands/{id}` returns a command's lifecycle; `GET /api/system/health` reports the exact ledger topology.

## 2. Personas

Sign in at `/login` by choosing a persona under "Demo persona (synthetic)" and pressing **Continue to workspace**. Switch later with the sidebar's "Demo persona (synthetic)" selector (in LOCALNET each switch opens a new isolated demo session; the ledger state stays).

| Persona | Organization | Role and mandates | Used for |
|---|---|---|---|
| Dana Reyes | Demo Lender A | Lender Analyst (analyst mandate) | Review, assessment, submit for approval |
| Morgan Hale, Head of Credit | Demo Lender A | Lender Approver (approver mandate) + governance seat 1 | Eligibility, proposal, activation, release decisions, lender audit grant |
| Plant manager | Demo Manufacturer | Borrower / Asset Owner (borrower mandate) | Acceptance, activation authorization, release request, owner audit grant |
| Audit lead | Demo Auditor | Auditor + governance seat 3 | Scoped export |
| Lender B approver | Demo Lender B | Lender Approver + governance seat 2 | Negative checks (unrelated lender), governance |
| Inspector | Demo Verifier | Verifier | Negative checks (no terms) |
| Sales desk | Demo CNC Dealer | Dealer Contributor | Negative checks (no terms) |

Full matrix: [`docs/permissions.md`](permissions.md).

## 3. Walkthrough

Each step lists what to do, the Daml choice the API submits (daml-model.md §7, W1–W14), and what the ledger enforces at that point.

### Step 1: Dana Reyes (Lender Analyst) starts the review

1. Go to `/app/reviews` and open **CA-001** for CL-001 (`/app/reviews/CA-001/assessment`).
2. Press **Start review**. In the dialog enter the valuation `150,000.00` (USD), a valuation source, internal notes and feedback for the borrower, choose the collateral outcome, and confirm **Start review**.
3. Press **Submit for approval** and confirm.

Ledger: `Assessment_StartReview` and `Assessment_Save` (W1, W2), then `Assessment_SubmitForApproval` (W3) on `CollateralAssessment`, which is signed by Demo Lender A only: the valuation exists only in the lender's contract. Valuation (USD 150,000.00) and requested principal (USD 100,000.00) are separate figures; the review shows the ratio against the policy maximum.

Check: on the **Decision** section the analyst sees `Your mandate (Lender Analyst) does not include collateral approval.` and no approve button. The analyst/approver split is a mandate enforced by the API (403); the ledger sees only the Demo Lender A party (see [limitations](limitations.md#authority)). In LOCALNET the internal notes are not stored.

### Step 2: Morgan Hale (Lender Approver) records eligibility and issues the proposal

1. Switch to Morgan Hale; on the review's **Decision** section press **Approve eligibility** and confirm. The page shows `Eligible for this lender and case. Financing is not yet active.`
2. Follow **Continue to the proposal** (`/app/cases/CL-001/proposal`), press **Issue proposal** (principal `100000.00`) and confirm. The proposal shows `FP-001 · v1`.

Ledger: `Assessment_Approve` (W4) creates a `LenderDecisionNotice` for the borrower (outcome and shared feedback only); `Assessment_IssueProposal` (W5) creates `FinancingProposal` v1, whose only stakeholders are Demo Lender A and the borrower. It is issued only from an `ELIGIBLE` assessment and binds the reviewed evidence and attestation snapshot.

### Step 3: Plant manager (borrower) accepts the exact version and authorizes activation

1. Switch to the Plant manager; on the proposal press **Accept v1**. The dialog says `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.` Confirm **Accept this version**.
2. Open the case's **Pledge** section, press **Authorize pledge activation** and confirm **Authorize activation**.

Ledger: `Proposal_Accept` (W6) checks the expected reference and version and creates the `FinancingAgreement`; accepting a stale version fails on the ledger as well as in the API (`financing.it.test.ts`). `Agreement_AuthorizeActivation` (W7) creates a borrower+lender-signed `PledgeActivationAuthorization` that carries references, the expected control version (3) and an expiry, but no principal or terms.

### Step 4: Morgan Hale activates the pledge

1. Switch to Morgan Hale; on the case's Pledge section press **Activate pledge** and confirm. The page shows `Lock and activation evidence · PL-001`, and the activate button disappears.
2. Optionally open `/app/assets/ASSET-DEMO-001/overview`: the asset is `Locked`, linked to `PL-001`.

Ledger: before submitting, the API confirms that Demo Lender A still holds an active disclosure of the attestation (this check is off-ledger by design; `pledge.it.test.ts`). `Control_Activate` (W8) **consumes** the asset's single `AssetControl` (v3) and the authorization and creates `CollateralLock` (control version 4). It fails if the control is not shared with this lender, the control version or evidence anchor changed, the authorization or attestation expired, or the verifier is suspended. A second activation is impossible because the control no longer exists; parallel activations commit at most once (`concurrency.it.test.ts`: two parallel activations per round, exactly one lock, the other 409).

### Step 5: Plant manager requests release

1. Switch to the Plant manager; go to `/app/pledges`, open **PL-001**, press **Request release** (reason `EXTERNAL_LOAN_COMPLETION`, optional note and servicing reference) and confirm.
2. The page shows `Release requested. The collateral lock remains active.` and the status `Active · release requested`.

Ledger: a `ReleaseRequest` (W9) signed by the requester. Creating it never touches the lock. In LOCALNET the free-text note is not stored.

Checks:

- The borrower cannot release: `Release requires the designated lender's authorization.` The API refuses (403), and a direct `Release_Authorize` submitted by the borrower is rejected by the ledger: that choice and `Lock_Release` are controlled by the lender (`financing.it.test.ts`).
- Switch to Dana Reyes: `Your mandate (Lender Analyst) does not include release approval.` and no **Authorize release** button.
- Optional branch: Morgan Hale can reject the request (`Release_Reject`, W10). The lock stays `ACTIVE`; the borrower then requests again (W11).

### Step 6: Morgan Hale authorizes the release

Switch to Morgan Hale and press **Authorize release**. The dialog says `This releases the Collara workflow lock. Any required legal lien termination must be completed separately.` Confirm. The pledge shows `Released`.

Ledger: `Release_Authorize` (W12) exercises `Lock_Release` and creates a new `AssetControl` (version 5, available, not shared), a `CollateralLockReleased` record and a `ReleaseDecision`.

### Step 7: Each record owner grants the auditor access

1. As the Plant manager, go to `/app/access?caseId=CL-001`, press **Grant audit access** and confirm **Grant access** (the borrower's own record types).
2. Repeat as Morgan Hale (the lender's own record types).
3. The access list shows two audit grants to Demo Auditor.

Ledger: one `AuditGrant` per grantor (W13, W14), signed by the grantor and observed by the auditor. A scope is effective only when every owner of that record type granted it; an owner cannot grant another owner's records (the API answers 400, `financing.it.test.ts`).

### Step 8: Audit lead exports the case report

1. Switch to the Audit lead; go to `/app/audit/exports` and press **Export case report**. The dialog says `Case workflow report — not a legal title or lien certificate.` and lists the granted record types. Confirm **Generate export**.
2. The export row shows `RPT-<n> · CL-001`, the scope `Granted subset · Demo Auditor`, a SHA-256 checksum and the cut-off. Download it.

This is not a ledger transaction: the worker generates the report (JSON or CSV) from the grantor's projected records, filtered to the effective scopes, with the projection cut-off and a watermark, and stores it privately. The download link (60 s) is issued only after access is re-checked; after a grant is revoked, the link is no longer issued.

## 4. Negative checks

| Check | How | Expected | Enforced by |
|---|---|---|---|
| Unrelated lender | As Lender B approver, open `/app/cases/CL-001/summary`, `/app/pledges/PL-001`, `/app/reviews/CA-001/assessment`, `/app/audit?caseId=CL-001`; look at `/app/pledges` | `This record is unavailable to your account.` on each; PL-001 not listed; no Demo Manufacturer data | Lender B's party is a stakeholder of no CL-001 contract; the API answers the same 404 for unknown and unrelated records |
| Verifier and dealer see no terms | As Inspector, then Sales desk, open `/app/cases/CL-001/proposal` and `/app/pledges/PL-001` | No `100,000.00` anywhere; the proposal is unavailable | Terms live only in borrower+lender contracts; presenters omit them |
| Auditor scope | As Audit lead before any grant | Nothing about CL-001 | The auditor observes only `AuditGrant`s |
| Analyst limits | As Dana Reyes, try to decide the review or the release | Mandate notices; no buttons; API 403 | API mandate check |
| Borrower self-release | As Plant manager on PL-001 | No authorize action; API 403 with `Release requires the designated lender's authorization.` | API policy and the `Lock_Release` controller |
| Double activation | After step 4 | No **Activate pledge** button; a replayed request returns the original command | Consumed control token; idempotency record |
| UI_MOCK honesty | Any action in UI_MOCK | `Recorded in the UI mockup. No ledger transaction was submitted.` (INFERRED copy), never `Confirmed on the ledger.` | Mock client |

## 5. Optional: governance (verifier registry)

Seat holders: Morgan Hale (seat 1), Lender B approver (seat 2), Audit lead (seat 3). Go to `/app/governance`. A seat proposes **Suspend verifier** for `VER-001`; a second seat confirms; any seat executes. One confirmation is not enough to execute, and a seat cannot count twice. Do this **last**: suspending the only demo verifier blocks new attestations and, under the `REQUIRE_ACTIVE_VERIFIER` policy, new activations. Re-adding Demo Verifier through an **Add verifier** proposal is covered by `governance.it.test.ts`. Governance never touches collateral. Details: [`docs/governance.md`](governance.md).

## 6. Optional: from a clean start

With the `clean-start` seed profile (organizations, parties, users and the registry only), the earlier steps can be shown too: registering the asset (`POST /api/assets`: owner request, registrar reservation and acceptance; a duplicate identity is declined), creating the case, uploading evidence as the owner and the invited dealer, requesting verification, the verifier accepting, requesting changes and attesting a new evidence version, and sharing the package with Demo Lender A with the dealer's consent. These are covered at the API level by `apps/api/test/localnet/cases.it.test.ts`. Uploads are not virus-scanned; use only the synthetic files.

## 7. What this demo does not show

Legal title, lien registration, money movement, external pledge detection, independent node operators, Splice LocalNet or any Canton Network. See [`docs/limitations.md`](limitations.md).
