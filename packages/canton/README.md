# @collara/canton

Server-only adapter for the **Canton JSON Ledger API v2** (Canton 3.5.19). It covers the typed client (openapi-fetch over types generated from the node's own OpenAPI spec), the ledger token providers, the command builders, the Daml JSON value helpers, the error classification for the command lifecycle, and the loader for the LocalNet bootstrap state.

Use it from `apps/api` and `apps/worker` only. ESLint blocks imports from browser code.

## Quick start

```ts
import {
  LedgerClient, createHmacTokenProviders, create, exercise, templateId,
  damlValue, isLedgerError, loadLocalnetState, localnetParty,
} from "@collara/canton";

const state = await loadLocalnetState();             // .local/localnet/state.json, or null
if (!state) throw new Error("run scripts/localnet/bootstrap.mjs");
const borrower = localnetParty(state, "DemoManufacturer"); // { party, userId, jsonApiUrl, participantId }

const tokens = createHmacTokenProviders({
  secret: process.env.CANTON_JWT_HMAC_SECRET!,         // dev only (unsafe-jwt-hmac-256)
  audience: state.audience,
});
const ledger = new LedgerClient({ baseUrl: borrower.jsonApiUrl, tokenProvider: tokens(borrower.userId) });

// Detect a sandbox restart before trusting party ids from state.json.
if ((await ledger.participantId()) !== borrower.participantId) {
  throw new Error("ledger was reset: re-run bootstrap");
}

const T = templateId("collara-contracts", "Collara.Control", "AssetControl"); // "#pkg:Module:Template"
try {
  const tx = await ledger.submitAndWaitForTransaction({
    commandId: "cmd-<deterministic hash>",           // reuse on retry: the ledger deduplicates
    actAs: [borrower.party],
    commands: [exercise(T, contractId, "SomeChoice", { amount: damlValue.numeric("100000.00", 2) })],
  });
  // committed: tx.updateId, tx.offset, tx.events
} catch (error) {
  if (isLedgerError(error)) {
    error.info.commandState;                         // COMMITTED | REJECTED | FAILED | UNKNOWN_OUTCOME
  }
  throw error;
}
```

## API

`new LedgerClient({ baseUrl, tokenProvider?, timeoutMs = 30000, submitTimeoutMs = 60000, fetch? })`. `client.withTokenProvider(p)` gives the same endpoint as another ledger user. Every method accepts `{ signal?, timeoutMs? }` as the last argument. Every ledger or network failure is thrown as `LedgerError` (with `error.info` set; see below). An invalid `SubmitRequest` throws a `ZodError` before anything is sent. On HTTP 401 the client invalidates the token and retries once.

| Method | Endpoint | Notes |
|---|---|---|
| `readyz()` | `GET /readyz` | `{ ready, status, detail }`; never throws |
| `version()` | `GET /v2/version` | |
| `participantId()` | `GET /v2/parties/participant-id` | changes on every sandbox start |
| `ledgerEnd()` | `GET /v2/state/ledger-end` | `0` on an empty ledger |
| `allocateParty({ partyIdHint, userId?, synchronizerId? })` | `POST /v2/parties` | admin |
| `listParties({ pageSize?, pageToken? })` | `GET /v2/parties` | admin |
| `createUser({ id, primaryParty?, rights })`, `getUser(id)` (null if missing), `listUserRights(id)`, `grantUserRights(id, rights)` | `/v2/users…` | admin; build rights with `rights.canActAs(p)`, `rights.canReadAs(p)`, `rights.participantAdmin()` |
| `uploadDar(bytes, { vetAllPackages = true })` | `POST /v2/dars` | admin |
| `submitAndWait(req)` | `POST /v2/commands/submit-and-wait` | `{ updateId, completionOffset }` |
| `submitAndWaitForTransaction(req & { shape? })` | `POST /v2/commands/submit-and-wait-for-transaction` | normalized `LedgerTransaction`; events visible to `actAs` ∪ `readAs` |
| `activeContracts({ parties, templateIds?, activeAtOffset?, includeCreatedEventBlob? })` | `POST /v2/state/active-contracts-page` | all pages, at the current ledger end by default |
| `updates({ beginExclusive, endInclusive?, parties, templateIds?, shape?, limit? })` | `POST /v2/updates` | one bounded poll; continue from `nextBeginExclusive` until `complete` |
| `commandCompletions({ parties, beginExclusive, limit?, idleTimeoutMs? })` | `POST /v2/commands/command-completions` | completions of the token's user; for reconciling unknown outcomes |

`SubmitRequest`: `commandId` (deterministic per idempotency record), `submissionId` (defaults to a new UUID per attempt), `actAs`, `readAs?`, `commands`, `userId?` (defaults to the token's `sub`), `workflowId?`, `deduplicationPeriod?` (`deduplication.duration(s)` / `deduplication.sinceOffset(o)`; the ledger default is PT168H), `disclosedContracts?`, `synchronizerId?`.

Commands: `create(templateId, payload)`, `exercise(templateId, contractId, choice, argument = {})` and `createAndExercise(...)`. Template ids use the package-name form `#<package-name>:<Module>:<Template>` (`templateId(pkg, module, entity)`). Responses carry package-id template ids; normalized events also carry `templateRef` in the package-name form.

Events (`LedgerEvent`): `created` (`createArgument`, `signatories`, `observers`, `witnessParties`, `createdEventBlob?`), `archived`, and `exercised` (`choice`, `consuming`, `actingParties`, `exerciseResult`; LEDGER_EFFECTS shape only). `witnessParties` lists the requesting parties that saw the event. `shape: "ACS_DELTA"` (default) includes only create and archive events for stakeholders; `"LEDGER_EFFECTS"` includes every witnessed event. Non-submitting parties see `commandId: ""`, so correlate by `updateId`.

`loadLocalnetState(path?)` reads and validates `.local/localnet/state.json` (override with `COLLARA_LOCALNET_STATE`) and returns null when it is missing. `localnetParty(state, hint)` returns `{ party, userId, jsonApiUrl, participantId }`.

## Tokens

- `HmacTokenProvider(userId, { secret, audience, ttlSeconds = 240, refreshBeforeSeconds = 30, issuer? })` mints HS256 JWTs with jose. Claims: `aud` = audience, `sub` = ledger user, `iat`, `exp`. `ttlSeconds` must be at most 300, Canton's default `max-token-lifetime`. Tokens are cached and re-minted 30 s before expiry, and concurrent callers share one mint. `createHmacTokenProviders(settings)` returns one cached provider per user.
- `StaticTokenProvider(token)` wraps a token minted elsewhere.
- The `LedgerTokenProvider` interface is `{ userId?, getToken(signal?), invalidate?() }`. A JWKS / OAuth client-credentials provider (Keycloak) is not implemented yet; it would implement the same interface.
- Tokens go only into the `Authorization` header. They never appear in `LedgerError` messages or `info`, and providers serialize as `{ type, userId }`.
- `unsafe-jwt-hmac-256` is for a developer machine only (see `infra/canton/README.md`).

## Error classification

`classifyLedgerError({ status, body } | { error })` returns `{ kind, commandState, definite, retryable, code?, httpStatus?, grpcCode?, errorCategory?, retryAfterMs?, serverDefiniteAnswer?, duplicate?, message, original }`. `commandState` is the state to record when you stop there. `retryable` means resubmitting the **same commandId** (or repeating a read) may succeed. The mapping follows `docs/_research/synthesis.md` §1.5.2. Rows marked "recorded" come from real 3.5.19 responses in `src/__fixtures__/errors/`.

| Observation | kind | commandState | definite | retryable |
|---|---|---|---|---|
| 409 `DUPLICATE_COMMAND`, `context.accepted:"true"` (recorded) | DUPLICATE_COMMAND | **COMMITTED** (`duplicate.completionOffset`, `existingSubmissionId`) | yes | no |
| 409 `DUPLICATE_COMMAND` not accepted, or `SUBMISSION_ALREADY_IN_FLIGHT` | DUPLICATE_COMMAND | UNKNOWN_OUTCOME | no | yes |
| 409 `LOCAL_VERDICT_LOCKED_CONTRACTS` (recorded; `retryInfo` "1 second") | LOCKED_CONTRACTS | REJECTED | yes | **yes** (bounded, same commandId) |
| 404 `CONTRACT_NOT_FOUND` (recorded) | CONTRACT_NOT_FOUND | REJECTED | yes | no |
| 400 `DAML_AUTHORIZATION_ERROR` (recorded) | AUTHORIZATION | REJECTED | yes | no |
| 400 `DAML_FAILURE` (`ensure`/`assert`; recorded), other category 9 | FAILED_PRECONDITION | REJECTED | yes | no |
| 400 `INVALID_ARGUMENT`, `COMMAND_PREPROCESSING_FAILED` (too many decimals), plain-text 400 for a malformed body (all recorded), category 8/12/14 | INVALID_ARGUMENT | REJECTED | yes | no |
| 404 `TEMPLATES_OR_INTERFACES_NOT_FOUND`, `USER_NOT_FOUND`, `PACKAGE_NAMES_NOT_FOUND` (recorded), category 11 | NOT_FOUND | REJECTED | yes | no |
| category 10 (other than duplicates) | ALREADY_EXISTS | REJECTED | yes | no |
| 401, redacted body `code:"NA"`, `grpcCodeValue:16` (recorded) | UNAUTHENTICATED | FAILED | yes | no |
| 403, redacted body, `grpcCodeValue:7` (recorded) | PERMISSION_DENIED | FAILED | yes | no |
| connection refused / DNS failure (request never sent) | UNAVAILABLE | FAILED | yes | yes |
| connection reset mid-request, 502/503, category 1 | UNAVAILABLE | UNKNOWN_OUTCOME | no | yes |
| client timeout (`AbortSignal.timeout`), 504, category 3 | TIMEOUT | UNKNOWN_OUTCOME | no | yes |
| 500 `LEDGER_API_INTERNAL_ERROR`, category 4 (recorded: `Int` sent as a JSON number) | UNKNOWN | UNKNOWN_OUTCOME | no | no: reconcile through completions |

Notes:
- Canton's own `definite_answer` is `"false"` even for plain rejections, so `definite` is Collara's reading of the outcome. The server's flag is kept in `serverDefiniteAnswer`.
- Interpretation failures (authorization, contract not found, Daml failures) produce **no completion**. Deduplication rejections do.
- The JSON API answers some malformed payloads with **HTTP 500** `LEDGER_API_INTERNAL_ERROR` (observed: `Int` sent as a number, `null` for a nested Optional, `"true"` for a Bool, an invalid date). Others get 400 (`true` for a Numeric). Encode payloads with `damlValue` and validate inputs before submitting.
- `cause` can contain party ids and contract arguments. Do not show it to other organisations.

## Daml JSON values (`damlValue`)

Observed on 3.5.19 and re-checked end to end by the integration test (`Describe` returns the Daml `show` of the decoded value):

| Daml | JSON | Helper |
|---|---|---|
| Party, Text, ContractId | string | `party()`, `contractId()` validate |
| Int | `"42"` (a JSON number is rejected) | `int64()` |
| Numeric n / Decimal | `"150000.00"` (echoed padded to scale; too many decimals → 400) | `numeric(v, n)`, `decimal(v)` |
| Bool | `true` | |
| Time | `"2026-01-15T08:30:00.123456Z"` (offsets normalized to UTC; more than 6 decimals truncated) | `time()` rejects more than 6 |
| Date | `"2026-01-15"` | `date()` |
| Optional a | `null` / value | `optional()` |
| Optional (Optional a) | `[]` / `[[]]` / `[[x]]` (`null` → HTTP 500) | `nestedOptional()`, `decodeNestedOptional()` |
| DA.Set.Set a | `{"map": [[x, {}], …]}` (deduplicated, sorted) | `damlSet()`, `decodeSet()` |
| DA.Map.Map k v | `[[k, v], …]` (sorted by key; last duplicate wins) | `damlMap()`, `decodeMap()` |
| record / unit / variant / enum | object / `{}` / `{"tag","value"}` / `"Ctor"` | `variant()`, `unit` |

`damlValue.damlSchemas` has Zod schemas (`party`, `int64`, `numeric(scale)`, `time`, `date`, `optional`, `set`, `map`) for decoding contract payloads.

## Environment variables

The package reads only `COLLARA_LOCALNET_STATE`. Callers pass everything else explicitly. The conventions used by the scripts and tests:

| Variable | Meaning |
|---|---|
| `CANTON_JSON_API_URL` | JSON API base URL (default `http://127.0.0.1:7575`) |
| `CANTON_JWT_HMAC_SECRET` | HS256 secret; must match `infra/canton/sandbox-auth.conf` (dev only) |
| `CANTON_JWT_AUDIENCE` | token audience (default `https://collara.local/ledger-api`) |
| `COLLARA_LOCALNET_STATE` | path of the bootstrap `state.json` |
| `CANTON_IT=1` | enables the integration tests |
| `CANTON_IT_KEEP=1` | keep a sandbox the integration tests started |

## Generated types

`openapi/canton-3.5.19.yaml` is the spec served by the node at `/docs/openapi`. `src/generated/ledger-api.d.ts` is generated from it with openapi-typescript 7.13.0. To regenerate against a running sandbox:

```bash
pnpm --filter @collara/canton fetch-openapi          # writes openapi/canton-<version>.yaml
pnpm --filter @collara/canton gen                    # regenerates src/generated/ledger-api.d.ts
node packages/canton/scripts/fetch-openapi.mjs --check   # exit 1 if the node serves a different spec
```

If the Canton version changes, update the file name in the `gen` script.

## Tests

- Unit (no ledger): `pnpm --filter @collara/canton test`. Covers the classifier with recorded error bodies, token claims, expiry and caching, value encoders, normalizers and the client with a fake `fetch`.
- Integration: `test/integration/ledger.it.test.ts`, skipped unless `CANTON_IT=1`. The global setup builds the test DAR (`test/fixtures/it-daml`, via `dpm build`), reuses a ready ledger or starts one with `scripts/localnet/up.mjs`, and stops it afterwards.
  - PowerShell: `$env:CANTON_IT = "1"; pnpm --filter @collara/canton test:it`
  - Git Bash: `CANTON_IT=1 pnpm --filter @collara/canton test:it`

  It proves:
  - create and exercise with per-user tokens;
  - 10 rounds of two concurrent consuming exercises: exactly one commits, and the loser is `LOCKED_CONTRACTS` (all 10 rounds in the observed runs), whose retry with the same commandId is `CONTRACT_NOT_FOUND`;
  - a resubmitted commandId is a committed `DUPLICATE_COMMAND` at the original offset, and the original completion is found;
  - a user without rights gets `PERMISSION_DENIED`, a missing Daml authority gets `AUTHORIZATION`, and a wrong secret gets `UNAUTHENTICATED`;
  - the observer sees created/archived (ACS_DELTA) and created/exercised (LEDGER_EFFECTS) with itself as the only witness, while a non-stakeholder sees no transactions;
  - every value encoder round-trips through Daml.
- If you change `test/fixtures/it-daml` while reusing a running sandbox, restart the sandbox: the DAR keeps the same name and version.
