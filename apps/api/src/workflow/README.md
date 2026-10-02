# Workflow write path (`apps/api/src/workflow`)

How endpoint builders write LOCALNET routes. Rules: ADR-0001 §2.6, `docs/architecture/daml-model.md` §7 (command sequence) and §8 (trust gaps), synthesis §1.2.5 and §1.5.2.

| Module | Use it for |
| --- | --- |
| `run.ts` | `WorkflowRunner`: `run()` (one submission) and `sequence()` (several submissions under one parent record) |
| `context.ts` | `WorkflowServices` (`app.workflow`, and `opts.workflow` in route modules) |
| `actors.ts` | Maps the session actor to ledger identities. Also: system actors, counterparty parties |
| `preconditions.ts` | `must`, `mustBeVisible`, `assertNotExpired`, `requireActiveAttestationDisclosure`, `snapshotFromDisclosure`, `sameAnchor` |
| `http.ts` | `IdempotencyHeadersSchema`, `workflowResponseSchemas`, `replyWithOutcome`, `lastSync`, `withProjectionState` |
| `problems.ts` | `workflowProblems`: `ledgerUnavailable`, `stateChanged`, `attestationExpired`, `unavailable` |
| `registrar.ts` | `RegistrarService` (`workflow.registrar`) |
| `governance/` | Tier A governance (DM `GovernanceRules` 2-of-3): `GovernanceService` (propose + auto-confirm, confirm, execute + registrar sync, cancel; always `as: "seat"`), fresh seat reads and GP-refs from the ledger (`ledger.ts`), DM confirmation/staleness rules (`rules.ts`), `GET /verifiers` directory (`read.ts`). Routes: `routes/workflow/governance.ts` |
| `cases/` | Read side of the case/asset/verification/access routes: `loadViewerWorld` (read world + presenter context; registry refs and verifier status from the registrar's projected directory), `assertCheck`, `commandExists`, `allocateFreshRef` (DB counter, skipping refs already on the ledger), `createdField` |
| `assets/manifest.ts` | Evidence linkage: the owner's `EvidenceManifest` from the finalized documents (create + `Manifest_Anchor` in one create-and-exercise, or `Manifest_NewVersion`), as the first step of a verification request, evidence resubmission or share |
| `verification/` | Owner verification request sequence (`requestVerification`: manifest → request → grant) and evidence resubmission (`resubmitEvidence`: manifest → submit → grant → revoke the superseded grant); the verifier's evidence grants (`grants.ts`: the selected documents as an owner-signed `PackageShare` with purpose `VERIFICATION` for the assigned verifier only, dealer documents through the dealer's `Consent_Grant`, `dealerVerificationConsent`; daml-model.md §4.6); registry verifier resolution (registrar view), verifier ACS inputs |
| `sharing/` | Owner share sequence and dealer consent (`shareWithLender`, `dealerConsent`), share revocation, share-based evidence access (metadata via the read model, download re-checked on the recipient's fresh ACS: exact version and SHA-256; a `VERIFICATION` grant also needs the VERIFIER role and its open request on the same evidence version), and **`ensureLenderAssessment`**: the M18 trigger (the lender's own CollateralAssessment, created on the selected lender's first `GET /cases/:id`; idempotent, callable from any lender-side route) |
| `../ledger/*` | `AcsReader`, `ledgerCommands` (builders), payload schemas, `TEMPLATES`, `CantonLedgerGateway`, `LedgerAccess` |

## Private notes (`packages/db` `notes.ts`)

Free text never goes on the ledger, into logs or into notifications. Review notes (internal notes: the lender org's
analyst/approver only; shared feedback: lender + borrower) and release notes (request note, servicing reference,
lender question, borrower response: the lock's owner and designated lender only) are rows of the `notes` table:

- **Write.** Create the note PENDING inside the command that carries it with `putPendingNote` (`commandId` = the
  record being prepared, `ctx.record.id`, or the sequence parent `seq.parent.id`); it is unique per command and kind,
  so replays and retries never duplicate it. Where a Daml field exists, put the note id on the ledger
  (`ReleaseRequest.noteRef`, `questionRef`, `responseNoteRef`). Hash note text into the command payload with
  `noteDigest` (the command record never stores the text). Check text first with `isValidNoteBody` (400, see
  `review/notes.ts`). After the outcome call `settleNotes` (committed → ATTACHED, REJECTED → DISCARDED; FAILED,
  PREPARED, SUBMITTED, UNKNOWN_OUTCOME stay PENDING), also when the runner throws (`settleNotesOfCommand`).
- **Read.** `loadReadWorld` overlays readable notes onto the viewer's `CaseFacts` (`withNotes`): only notes whose
  command is COMMITTED/PROJECTED/PROJECTION_DELAYED (LEDGER commands with an update id) and only for the audience of
  the kind. APPLICATION-only commands (no ledger) would show their notes once COMMITTED; none carries a note today.
  Auditors read no note text: no audit scope covers lender-internal notes (`lenderInternal.view` is unsupported for
  AUDITOR) and release notes are the lock parties' only. Presenters still omit fields by role.

## Adding routes to a module

Each module in `src/routes/workflow/` is already registered once, under `/api`, by `routes/workflow/index.ts`. Fill in your module's plugin and declare full paths, for example `"/cases/:id/sharing"`. The plugin receives `{ services, workflow, mode }` (`WorkflowRouteOptions`). Do not edit `index.ts` or `app.ts`.

`workflow` is `null` only when the API runs without a database. In LOCALNET without a bootstrap state, `workflow.access` is `null` and every run is recorded as `FAILED`. It is never simulated.

## Writing a mutation

```ts
import { assertPermitted } from "../../plugins/actor";
import { ledgerCommands as L } from "../../ledger";
import { businessPartyOfOrg, IdempotencyHeadersSchema, mustBeVisible, replyWithOutcome, workflowProblems, workflowResponseSchemas } from "../../workflow";

app.post("/cases/:id/sharing", {
  schema: { params: CaseParams, headers: IdempotencyHeadersSchema, body: ShareBody, response: workflowResponseSchemas(ShareResult) },
}, async (request, reply) => {
  const member = await request.requireActor();                         // 401 if not signed in
  const facts = await loadCaseFacts(db, readViewerOf(member), request.params.id);
  if (!facts) throw problems.unavailable();                             // 404-shaped: not visible to this account
  assertPermitted(member, "case.share", caseContext(facts, now));       // unrelated → 404, related but not allowed → 403
  const actor = await workflow!.actorFor(member);                       // business party / seat identities
  const lender = await businessPartyOfOrg(db, facts.selectedLenderOrgId); // counterparties come from server-side bindings
  const outcome = await workflow!.run({
    actor,
    operation: "case.share",                                            // stable name: part of the idempotency scope
    idempotencyKey: request.headers["idempotency-key"],
    payload: request.body,                                              // same key + different payload → 409 idempotency_conflict
    resourceRef: facts.ref,
    prepare: async (ctx) => {                                           // fresh ACS reads as the actor's ledger user
      const control = mustBeVisible(await ctx.acs.one("AssetControl", (c) => c.assetId === facts.assetRef && c.namespace === ctx.namespace));
      if (control.payload.sharedLender !== null) throw workflowProblems.stateChanged();
      return { commands: [L.controlShareWithLender(control.contractId, { lender: lender!, actorRef: ctx.actorRef })] };
    },
    result: (step) => ({ controlCid: step.createdOf("AssetControl") }), // stored on the record and returned on replay
  });
  return replyWithOutcome(reply, outcome);
});
```

- **Authority.** Use only `request.requireActor()` and the server-side bindings. Never read a party, organisation or role from the body or headers. Mandates are enforced by the API through domain policy (`assertPermitted` / `can` in `@collara/domain`).
- **`prepare(ctx)`.** It runs before every new submission. `ctx.acs` reads as the business party. `ctx.seatAcs` reads as the seat and the governance party (seat holders only). `ctx.now` is wall-clock time; use it for relative dates. `ctx.actorRef` goes on the choice. Throw a `ProblemError` to stop: nothing is submitted, and the record stays `PREPARED`. If a read cannot reach the participant, the record becomes `FAILED` (503 `ledger_unavailable` with the command); a retry with the same key prepares again. Seat actions return `{ as: "seat", commands }`. Use `L.*` builders (`src/ledger/builders.ts`) for commands. Use `TEMPLATES` / `PAYLOAD_SCHEMAS` for ids and decoding. Never use package ids.
- **Sequences.** Use these for multi-step operations, such as share + disclose, or registration:
  ```ts
  workflow.sequence({ actor, operation, idempotencyKey, payload, steps: async (seq) => {
    await seq.step("share", { prepare, result });
    const d = await seq.step("disclose", { actor: other, prepare, result });
    return { … };
  } })
  ```
  Each step is its own command record. Its key is `<parentId>:<step>` and its operation is `<operation>/<step>`. A replay skips steps that already committed. Use `seq.attempt()` to branch on a rejection.
- **Off-ledger checks** (daml-model.md §8). Before `Control_Activate`, call `requireActiveAttestationDisclosure(lenderAcs, snapshot, { now })`. It reads the lender's ACS, so the verifier is not informed.
- **Registrar and operator actions.** These run as `system:registrar` through `workflow.registrar`. They are never reachable from a browser value:
  - `registerAsset({ owner, idempotencyKey, registration })` runs request → `Registry_Reserve` → `Request_Accept`. A duplicate identity gets `Request_Decline`.
  - `process(seq, …)`
  - `publishVerifierStatus(…)`
  - `syncMirror(…)`
  - `updateConfig(…)`

  `workflow.systemActor("governance")` returns the Tier A governance party actor.

### Responses and error mapping (`replyWithOutcome`)

| Outcome | HTTP |
| --- | --- |
| Committed (has an update id) | `200 { command, result? }`. `command` is the domain `CommandStatus` |
| `SUBMITTED` / `UNKNOWN_OUTCOME` | `202 { command }`. The client polls `GET /api/commands/:id` |
| `REJECTED` | `409 state_conflict`, using the approved copy, with `command`. A ledger authorization rejection gives `404 unavailable` |
| `FAILED` (ledger unreachable or no binding) | `503 ledger_unavailable` with `command`. Nothing is simulated. This includes a participant that cannot be reached during `prepare` or between the steps of a sequence |
| Ledger read outside the runner that cannot reach the participant (e.g. a route's fresh ACS lookup) | `503 ledger_unavailable` (app error handler), never 500 |
| Problem thrown in `prepare` | That problem: 404 / 409 / 503 |
| Same key, different payload | `409 idempotency_conflict` |
| Missing or invalid `Idempotency-Key` | `400 validation_error` |

**Headers.** Every mutation needs `Idempotency-Key` (8–200 characters; use `IdempotencyHeadersSchema`). There is no CSRF token. `plugins/security.ts` rejects unsafe requests whose `Sec-Fetch-Site` is not `same-origin`/`none`, or whose `Origin` is untrusted.

**Submission context.** Before submitting, the runner records `ledgerUserId`, `actAs`, `ledgerSource` and (once, before the first attempt) `ledgerEndAtSubmit` on the command row, so the worker reconciles an `UNKNOWN_OUTCOME` from exactly that user's completions.

**Replays.** A replay returns the stored status and result without resubmitting. The ledger `commandId` is deterministic: it is computed from org, user, operation, key and payload hash. `UNKNOWN_OUTCOME` resubmits the same stored submission with the same `commandId`, and the ledger deduplicates it.

## Writing a GET

1. Get the actor with `request.requireActor()`, then the viewer with `readViewerOf(member)` (`@collara/db`).
2. Load facts from the read model (`packages/db/src/read-model`, see its README), for example `loadCaseFacts(db, viewer, ref)`. It filters by stakeholder party (signatory or observer), not by witness.
3. Turn `null` into `throw problems.unavailable()`. This is the 404-shaped "This record is unavailable to your account." It must look the same for an unknown id and an unauthorized one. Lists and counts must not reveal that a record exists.
4. Present the facts with the domain presenters (`presentCaseDetail(facts, member, pctx)` and the others in `@collara/domain`). These omit fields by role and mandate on the server. Never send a field and hide it in the UI. A `null` from a presenter is also a 404.
5. Build `pctx.sync` (`lastSync`) with `readLastSync(db)` or `lastSync(services.projections)`. To show a command against the watermark, use `withProjectionState(command, sync, now)`, which gives `PROJECTED` or `PROJECTION_DELAYED` copy.

## LocalNet integration tests (`apps/api/test/localnet`)

These tests are opt-in. Name them `*.it.test.ts`. The localnet vitest config collects them only when `LOCALNET_IT=1`.

```
LOCALNET_IT=1 pnpm --filter @collara/api test:localnet                          # Git Bash
$env:LOCALNET_IT = "1"; pnpm --filter @collara/api test:localnet                # PowerShell
LOCALNET_IT=1 pnpm --filter @collara/api exec vitest run --config vitest.localnet.config.ts test/localnet/<file>.it.test.ts
```

```ts
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type LocalnetHarness } from "./harness";
describe.skipIf(!LOCALNET_IT_ENABLED)("…", () => {
  let h: LocalnetHarness;
  beforeAll(async () => { h = await startLocalnetHarness({ prefixBase: "ep1" }); await h.seed("main"); });
  afterAll(() => h?.close());
  it("…", async () => {
    const lenderB = await h.loginAs("lender-b-approver");
    expect((await lenderB.inject("GET", "/api/cases/CL-001")).statusCode).toBe(404);
    const owner = await h.loginAs("manufacturer-owner");
    const r = await owner.inject("POST", "/api/cases/CL-001/sharing", { body: {…}, idempotencyKey: "share-1" });
    await h.project();                                          // read model catches up (projectOnce)
    expect(await h.acsAs("lenderA", "AssetControl")).toHaveLength(1);
  });
});
```

What the harness does:

- **Setup.** `startLocalnetHarness` bootstraps a unique prefix (`<base>-<random>`) on the shared sandbox. It creates and migrates the database `collara_it_<prefix>`, then seeds the demo users, the system users and the bindings from the state file. It builds the app with the Canton gateway (`COLLARA_MODE=LOCALNET`, `DEMO_SESSIONS_ENABLED=true`). Storage is S3 when `COLLARA_S3_*` is set in `.env`, otherwise memory.
- **`inject`.** It adds `sec-fetch-site: same-origin`, `Origin` and a fresh `Idempotency-Key` to unsafe methods. Pass `idempotencyKey` to test replays, `idempotencyKey: null` to omit the key, `crossSite: true` to test the CSRF guard, and `headers` to send spoofed values.
- **`close()`.** It drops the database and removes `state-<prefix>.json`. Set `KEEP_IT_DB=1` to keep both. The prefix's parties stay on the ledger, isolated.
- **Environment variables.** `LOCALNET_IT_PREFIX=<p>` reuses an exact prefix. `LOCALNET_IT_LOG=1` prints bootstrap and seed progress; `LOCALNET_IT_LOG=debug` also prints the API request logs. Under an AI agent, vitest switches to a quiet reporter that hides console output from passing tests; add `--reporter=default` to see it. `LOCALNET_IT_DATABASE_URL` overrides the server and credentials (by default these come from `DATABASE_URL`).
- **Other helpers.**
  - `h.actor(persona)` returns a `WorkflowActor` for calling the runner directly.
  - `h.seedCommand("M18")` and `h.command(id)` read command records.
  - `h.party(role)` and `h.acs(role)` give party ids and ACS readers.
  - `h.workflow`, `h.access`, `h.db` and `h.app` are also available.
