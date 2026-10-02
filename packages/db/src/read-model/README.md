# Read model (`@collara/db` → `read-model/`)

Viewer → stakeholder-filtered projections → domain facts (`CaseFacts`, `AssetFacts`, `GovernanceFacts`, …).
The API presents the facts with the domain presenters (`@collara/domain` `present*`, which omit fields by role
and mandate) and answers the 404-shaped `This record is unavailable to your account.` whenever a lookup
returns `null`. The read model never decides what a role may *see inside* a record; it decides which records
exist for the viewer.

The data comes from the worker's projection (`../projection`, run by `apps/worker`): `ledger_contracts`
(every created contract of the packages `collara-contracts`, `collara-governance`, `governance-core-v1`, with
signatories, observers, archive info and the business columns `business_ref`, `case_ref`, `asset_ref`),
`ledger_events` (created / archived / exercised nodes, LEDGER_EFFECTS shape: choice, argument, acting parties,
result) and `ledger_sources` (per-participant checkpoint), plus application records (`cases`,
`evidence_documents`, `export_jobs`, `audit_events`, `party_bindings`).

## Visibility rule

A contract is visible when one of the viewer's readable parties is a **stakeholder** (signatory or observer;
the generated column `ledger_contracts.stakeholders`). Witness parties (divulgence, fetch informees, the
actors of an exercise) never grant visibility. An event is visible when the viewer is a stakeholder of the
contract it acts on. Consequences, all covered by `read-model.test.ts`:

- Demo Lender B (with or without governance seat 2) sees no case, asset, verification, review, pledge or event
  of CL-001 at any stage; only the directory contracts (`CollaraConfig`, `VerifierStatusMirror`) and, as a
  seat holder, the governance contracts.
- The verifier and the dealer never see `FinancingProposal`, `FinancingAgreement`,
  `PledgeActivationAuthorization`, `CollateralAssessment`, `LenderDecisionNotice`, `CollateralLock` or release
  contracts, so their `CaseFacts` have no proposals, activation, lock, release requests or assessment.
- Auditors: an active, unexpired `AuditGrant` observed by the auditor adds the **grantor's** view of that one
  case (and its asset) to the auditor's world; other auditors' grants are dropped. The presenters then keep
  only the scopes every record owner granted (`AUDIT_SCOPE_OWNERS`). Without a grant the auditor sees nothing.
- The legacy helpers `visibleContracts` / `visibleEvents` in `queries.ts` filter by **witness** parties. Do not
  use them to decide what a user may read.

## Viewer

```ts
import { readViewerOf, type ReadViewer, type ReadOptions } from "@collara/db";

interface ReadViewer {
  orgId: string;                       // the organization the session acts for
  readableParties: readonly string[];  // business party (+ seat party and governance party for seat holders)
  roles?: readonly string[];           // e.g. ["AUDITOR"]; auditor delegation only runs for AUDITOR (or when roles are omitted)
  mandates?: readonly { code: string; seat?: number }[];
}
interface ReadOptions { now?: Date; sources?: readonly string[]; environment?: string /* party_bindings env, default "LOCALNET" */ }

const viewer = readViewerOf(actor); // actor = the API's ResolvedActor ({ orgId, roles, mandates, parties: { readAs } })
```

Build the viewer **only** from the server-side session → membership → mandate → party binding resolution
(the API's actor). Never from anything the browser sends. An empty `readableParties` sees no ledger data.

## Functions

All take `(db: DbOrTx, viewer: ReadViewer, …, options?: ReadOptions)` and are exported from `@collara/db`.
Each call builds the viewer's world once (`loadReadWorld`); call `loadReadWorld` yourself when an endpoint needs
several of these at once.

| Function | Returns |
| --- | --- |
| `loadReadWorld(db, viewer, opts)` | `ReadWorld { viewer, now, assets, cases, pendingRegistrations, governance, events, lastSync, view, parties }` |
| `listVisibleCaseRefs(db, viewer, opts)` | `string[]` |
| `listCaseFacts(db, viewer, opts)` | `readonly CaseFacts[]` (sorted by ref) |
| `loadCaseFacts(db, viewer, caseRef, opts)` | `CaseFacts \| null` (null: no stakeholder view and not the case's borrower org) |
| `listAssets` / `loadAsset(db, viewer, assetRef, opts)` | `AssetFacts[]` / `AssetFacts \| null` |
| `listVerifications` / `loadVerification(db, viewer, ref, opts)` | `{ asset, verification }[]` / `… \| null` |
| `listReviews` / `loadReview(db, viewer, reviewRef, opts)` | cases with a review the viewer sees (`review.ref !== ""`) |
| `listPledges` / `loadPledge(db, viewer, lockRef, opts)` | cases with a lock |
| `loadReleaseRequest(db, viewer, ref, opts)` | `{ facts, request } \| null` |
| `listAuditEvents(db, viewer, { caseRef?, limit?, …opts })` | `{ ledger: MappedEvent[]; operational: AuditEventRow[] }` (operational = own org only) |
| `governanceState(db, viewer, opts)` | `GovernanceFacts \| null` (null when the viewer sees no governance/registry contract) |
| `verifierEntries(db, viewer, opts)` | `VerifierEntry[]` (accreditations, else the registrar's mirrors) |
| `readLastSync(db, sources?)` | `LastSync { offset: number \| null; at: string \| null }` |
| `loadLedgerView(db, viewer, { sources?, templateRefs? })` | raw `LedgerView { contracts, events, byId }` (stakeholder-filtered) |
| `loadPartyDirectory(db, environment?)` | `PartyDirectory` (party → org, seat, hint) |

`ReadWorld.view` holds the raw visible contracts (contract ids, payloads) for endpoint needs such as choosing a
contract id for display or cross-checks. The **write path does not use it**: commands read the ACS fresh as the
acting org's ledger user (apps/api `workflow/`), never projections. Never send `view` to the browser.

`lastSync` is the checkpoint of the ACTIVE source with the oldest sync time (the `Ledger synced · offset N`
watermark). A source in `RESET_DETECTED` is excluded; when nothing was projected yet both fields are null.

## Template → facts

Field names follow `daml/collara/**/*.daml` (daml-model.md §4). Decoders (`decode.ts`, exported as `payloads`)
are lenient: a missing field decodes to a neutral default; money that does not decode is left out (unavailable,
never 0). Terminal outcomes without a successor contract (daml-model D14) come from the archiving event
(`VisibleContract.archived.choice/argument/actingParties`).

| Template | Facts |
| --- | --- |
| `AssetRegistrationRequest` | `pendingRegistrations[]` (state: active → `REGISTRATION_REQUESTED`; archived by `Request_Accept` → `REGISTERED`, `Request_Decline` → `REGISTRATION_DECLINED`); identity fallback for `AssetFacts` |
| `IssuanceTicket` | `requestRef` → `assetId` link; asset counts as `REGISTERED` |
| `AssetPassport` | `AssetFacts` identity (class, manufacturer, model, serial, year, location), `passportVersion`, `registeredAt` (owner only: lenders/verifiers see no serial) |
| `AssetControl` / `CollateralLock` | `asset.control`: newest active token; lock → `LOCKED` + `lockRef`, control → `AVAILABLE`; version = `controlVersion` |
| `CollateralLockReleased` | `lock.state = RELEASED`, `releasedAt`, `releasedByUserId`, `controlVersionAfterRelease`; control `AVAILABLE` |
| `RetiredControl` | `asset.lifecycle = ARCHIVED` |
| `EvidenceManifest` | `asset.package` (ref, version, entries, history); documents' `ledgerState` (`COMMITTED` when in the current manifest); ledger-only document references when no app row is visible |
| `DealerContribution` | dealer's ledger-only document reference; dealer org of the case |
| `PackageShareProposal` / `PackageShare` | `case.shares[]` (proposal → `REQUESTED`/`DECLINED`; share → `GRANTED`, `EXPIRED` past `expiresAt`, archived → `REVOKED`); recipient's package entries; which app document rows a recipient may see |
| `VerificationRequest` | `asset.verifications[]` grouped by `requestRef`, latest `version`; active → `status` (`REQUESTED`/`IN_REVIEW`/`CHANGES_REQUESTED`); archived by `VR_IssueAttestation` → `ATTESTED`, `VR_Reject` → `REJECTED`, `VR_DeclineAssignment` → `DECLINED`, `VR_Cancel` → `CANCELLED`; `lastMessage` = terminal reason or `changeNote` |
| `VerificationAttestation` / `AttestationDisclosure` | `asset.attestations[]` (original preferred over recipient copies); `supersededBy` (`supersedesRef`, `Att_Supersede`); `revokedAt` (`RevokedAttestation`, `Att_Revoke`, a disclosure withdrawn without supersession) |
| `CollateralAssessment` | lender's `case.review` (latest `version`; `status` → `ReviewState`; valuation → `assessment`; snapshot → `evidenceSnapshot`/`snapshotPackageVersion`; analyst/approver from the `Assessment_*` choice `actorRef`s) |
| `LenderDecisionNotice` | borrower's `case.review` (state = `outcome`), `sharedFeedback`, `informationRequest`, `decision` (both sides) |
| `FinancingProposal` | `case.proposals[]` per version (active → `ISSUED`; `Proposal_Decline` → `DECLINED`; `Proposal_Withdraw`/`Proposal_Revise` → `WITHDRAWN`) |
| `FinancingAgreement` | the accepted version (`agreementRef` = proposalRef, `proposalVersion`): state `ACCEPTED`, `respondedAt` = `acceptedAt`, `respondedByUserId` from `acceptedByRef`; yields the version on its own when the proposal is not in the view |
| `PledgeActivationAuthorization` | `case.activation` (`AUTHORIZED`; `EXPIRED` past `expiresAt`; `CONSUMED` once `Control_Activate` archived it / a lock references it); authorizations archived by `Auth_Withdraw` are ignored |
| `CollateralLock` | `case.lock` (ref, lender/borrower orgs, versions consumed/locked, attestation, package) |
| `ReleaseRequest` / `ReleaseDecision` | `case.releaseRequests[]` (`AUTHORIZED`/`REJECTED` from the decision or the archiving choice, `WITHDRAWN`, `INFORMATION_REQUESTED`, else `REQUESTED`); `decisionReason` = `sharedReason` |
| `AuditGrant` | `case.auditGrants[]` (`grantorSide` OWNER when the grantor is the borrower org; `EXPORT` → `VIEW_EXPORT`; `Grant_Revoke` → `revokedAt`) and auditor delegation (above) |
| `GovernanceRules`, `VerifierRegistry`, `VerifierAccreditation`, `*Proposal`, `GovernanceConfirmation`, `GovernanceExecutionResult`, `VerifierStatusMirror`, `CollaraConfig` | `GovernanceFacts` (`governance.ts`): seats, threshold, timeout, registry version, verifiers (`via` genesis/governed/mirror), proposals with confirmations (only proposals whose proposer is a seat party; numbered GP-001… in creation order, the same numbering the API derives from the ledger) |

Events (`events.ts`, `mapLedgerEvent`): created and exercised nodes map to domain `EventFacts` (type, ref,
actor from `actorRef`, from/to state, commit `{ offset, updateId }`). Asset-level events (passport, evidence,
verification) land on `asset.events`, case events on `case.events`; the presenters apply the audiences.

Application records: the `cases` row supplies title, purpose, requested principal (borrower org and the
selected lender only, enforced by the presenters), policy and lifecycle dates; a case also exists for its
borrower org before anything is on the ledger. `evidence_documents` rows are visible to their owner org, their
contributor org, and to recipients of a share that lists that document version. `export_jobs` are the
viewer's org's own.

## Extending (endpoint builders)

1. **New template**: add it to `T` and `TEMPLATE_MAPPINGS` in `../projection/templates.ts` (business ref,
   and `caseRef`/`assetRef` extractors when the fields are not named `caseRef`/`assetId`). Contracts projected
   before the change keep null business columns: reset the projection of the source (`pnpm --filter
   @collara/worker projection:reset -- --source sandbox --yes`) to backfill them.
2. **Decoder**: add a function to `decode` in `decode.ts` with the Daml field names.
3. **Facts**: per-asset data in `buildAsset` and per-case data in `buildCase` (`world.ts`) using the local
   `pick(template)` (already scoped to the asset/case and stakeholder-filtered). If the domain type needs a new
   field, add it additively in `@collara/domain` `facts.ts` (and the UI_MOCK fixtures) first.
4. **Events**: add a `case` to `onCreate`/`onExercise` in `events.ts` if the change should show on timelines.
5. **Tests**: extend `scenario-fixture.ts` (the daml-model §7 sequence as LEDGER_EFFECTS transactions;
   `buildScenario(stage)` stops at `main`, `eligible`, `proposal`, `authorized`, `pledged`,
   `release-requested`, `release-rejected`, `full`) and assert in `read-model.test.ts` for the selected lender,
   borrower, verifier, dealer, auditor and Lender B. Other packages import the fixture from
   `@collara/db/testing` (`FakeLedger`, `buildScenario`, `scenarioParties`, `scenarioBindingState`).

## Tests and integration tests

Unit tests (PGlite):

```ts
import { createPgliteDatabase, importLocalnetState, loadCaseFacts, projectOnce, seedDemoIdentities } from "@collara/db";
import { buildScenario, scenarioBindingState, scenarioParties } from "@collara/db/testing";

const db = await createPgliteDatabase();
await seedDemoIdentities(db.db);
await importLocalnetState(db.db, scenarioBindingState());
const { ledger, parties } = buildScenario("pledged");
await projectOnce(db.db, ledger, { source: "sandbox", jsonApiUrl: "http://127.0.0.1:7575", parties: Object.values(parties) });
const facts = await loadCaseFacts(db.db, { orgId: "demo-lender-a", readableParties: [parties.lenderA] }, "CL-001");
```

LocalNet integration tests (real ledger): after the commands under test have committed, run **one synchronous
projection pass** with the projector user of the prefix's state file, then assert reads. The read model only
sees what has been projected; without the pass, reads lag the ledger (in the app, the worker does this
continuously and the API shows `PROJECTION_DELAYED` copy meanwhile).

```ts
import { createHmacTokenProviders, LedgerClient, loadLocalnetState } from "@collara/canton";
import { projectOnce } from "@collara/db";

const state = await loadLocalnetState(".local/localnet/state-<prefix>.json");
const projector = state.users.find((u) => u.role === "projector" && u.participant === "sandbox")!;
const tokens = createHmacTokenProviders({ secret: process.env.CANTON_JWT_HMAC_SECRET ?? "collara-local-dev-secret-change-me", audience: state.audience });
const client = new LedgerClient({ baseUrl: state.participants.sandbox.jsonApiUrl, tokenProvider: tokens(projector.id) });
await projectOnce(db, client, { source: "sandbox", jsonApiUrl: state.participants.sandbox.jsonApiUrl, parties: projector.readAs, ledgerUserId: projector.id });
// projectOnce also moves COMMITTED commands whose update was applied to PROJECTED.
```

One database must project one party set per source: a different party filter for the same source is treated as
a reset (`RESET_DETECTED`), so use one database per prefix (the IT harness's `collara_it_<prefix>`).

The worker's live test (`apps/worker/test/projection.it.test.ts`, `PROJECTION_IT=1 pnpm --filter
@collara/worker test:it`) projects a seeded prefix through a hard-killed and restarted worker process,
compares row counts and hashes with an uninterrupted reference projection, replays from an older checkpoint,
checks command advancement (PROJECTED, PROJECTION_DELAYED, UNKNOWN_OUTCOME reconciliation) and reads CL-001 as
Demo Lender A and Demo Lender B.
