# Collara on Canton DevNet (shared participant)

Status, 2026-10-09: **one full synthetic run on the shared participant (2026-10-05, Canton 3.5.19)**: bootstrap, fixture CL-001 and the financing workflow through pledge activation and release, all committed with real update ids and none simulated. On 2026-10-09 the node reported **Canton 3.6.1**; the recorded run was re-read and verified (43/43 receipts) and bootstrap and asset registration committed there, but the rest of the workflow was **not re-run on 3.6.1**. The public website is a UI mockup and is **not connected** to DevNet. Everything below describes the design and the steps; the results, with update ids and the 3.6.1 check, are in [`docs/devnet-evidence.md`](devnet-evidence.md). The credentialed steps are run by the owner, following [`docs/devnet/owner-checklist.md`](devnet/owner-checklist.md) (password only in the owner's own terminal).

## 1. Target

The HackCanton shared DevNet participant hosted by NODERS (organisers' guide: <https://hackmd.io/@IzUWaelHTRa_fG1NRW376w/HkBpCR5YGx>):

| What | Value |
|---|---|
| JSON Ledger API | `https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services` |
| Canton | 3.5.19 (`GET /v2/version`); its `/docs/openapi` is byte-identical to `packages/canton/openapi/canton-3.5.19.yaml` (SHA-256 `3f62d28e…3cf0`), so the typed client is unchanged |
| Console | `https://console.participant.hackcanton-01.devnet.naas.noders.services` (parties, DAR upload) |
| Wallet | `https://wallet.validator.hackcanton-01.devnet.naas.noders.services` (onboarding) |
| OIDC issuer | `https://keycloak.naas.noders.services/realms/noders-appsfactory` |
| Client | public client `web-app-ui-hackcanton-01-devnet`, scope `openid daml_ledger_api offline_access`, audience contains `https://hackcanton-01.devnet.naas.noders.services` |
| Tokens | first via the password grant (team login), then the refresh_token grant; **refresh tokens rotate**; access tokens live 10800 s; `sub` = the team's ledger user id |
| Rights | participant-side (`CanActAs` / `CanReadAs`); onboarding grants one primary party |
| Parties | created **only in the Console** (not through the JSON API); names get a fixed tenant prefix, e.g. `c2ede6f6-alice::1220…`; quota about 20 |
| DARs | uploaded **only in the Console** (Collections → Upload DAR), not through `/v2/dars`; the same name and version with different content is rejected |

Shared-node rules followed by the code: no admin endpoint is ever called (no party allocation, no user management, no DAR upload, no vetting change, no pruning, no reset); reads are scoped to Collara's own parties.

## 2. Architecture on DevNet

```text
Browser ── web (Next, COLLARA_MODE=DEVNET, banner "Synthetic demo data — Canton DevNet.", chip "DevNet")
             │ same-origin /api
             ▼
           api (Fastify) ── session → membership → mandate → party binding (DEVNET bindings)
             │   submits as exactly the actor's org party, through the ONE tenant ledger user
             │   token: OIDC access token from the rotating refresh token in ledger_credentials
             ▼
           JSON Ledger API of the shared DevNet participant (NODERS)
             ▲
           worker ── projects source "devnet" as exactly the 11 bound Collara parties (tenant token)
             │
           PostgreSQL database collara_devnet (its own: bindings, commands, projections, ledger_credentials)
```

- **Mode.** `COLLARA_MODE=DEVNET` in the API, worker and web (`RUNTIME_MODES` in `@collara/domain`). The web treats it as a ledger mode (HTTP client, demo personas from the API, ledger sync from the projection). Banner `Synthetic demo data — Canton DevNet.` and chip `DevNet` are **INFERRED copy, pending approval**. DEVNET never falls back to simulated success: an unavailable ledger or credential is reported as such (commands become `FAILED` with `UNAUTHENTICATED` when no token can be obtained, because nothing was sent).
- **Own configuration namespace.** `DEVNET_*` and `CANTON_DEVNET_JSON_API_URL` variables (`DevnetEnvSchema`, `packages/canton/src/devnet-config.ts`), the env file `.env.devnet` (template [`infra/env/devnet.env.example`](../infra/env/devnet.env.example)), the state file `.local/devnet/state.json` (gitignored) and party bindings stored with `environment = 'DEVNET'`.
- **Guards** (API, worker, scripts and seed refuse to start): `DATABASE_URL` naming `collara` or `collara_test`, or any database whose name does not contain `devnet`; `COLLARA_LOCALNET_STATE` set at all; `COLLARA_DEVNET_STATE` pointing at `.local/localnet/state*.json`; `CANTON_JWT_HMAC_SECRET` set (HMAC tokens are LOCALNET only; `LedgerAccess` also refuses HMAC for a DevNet state). Sandbox party ids and offsets are never reused: the DevNet state is built only from the participant's own answers.
- **Bindings.** `scripts/devnet/import-bindings.mjs` reads the tenant user's rights, matches the Console-created parties to the eleven hints of `scripts/localnet/localnet.config.json` (exact, case-sensitive, tolerating the tenant prefix: `<prefix>-<Hint>`), refuses on a missing, ambiguous or read-only party with the exact list, and writes the state and the DB bindings. It never allocates parties.
- **Seed.** `scripts/devnet/bootstrap.mjs` runs the same seed code as LocalNet (`apps/api/src/seed/localnet.ts`, profiles `clean-start` = B1–B8 and `main` = also M1–M18) through the API's workflow runner, with ledger source `devnet` and run namespace `collara-devnet-<runRef>`. Every step is a durable command record with a deterministic idempotency key, so a re-run replays the stored outcomes and creates nothing twice. A namespace that already has a registry this database did not seed is refused.
- **Upload set.** Two DARs, in order: `governance-core-v1-0.1.0.dar` (DM `GovernanceRules`; embeds `governance-action-v1` and `splice-util` 0.1.4) and `collara-contracts-0.2.0.dar` (embeds `collara-governance` and `governance-action-v1`). See [`docs/devnet/upload-manifest.md`](devnet/upload-manifest.md).

## 3. Trust model

- **One tenant ledger user acts for every organisation.** The team's Keycloak user is the only ledger user Collara has on the shared node. It must hold `CanActAs` on all eleven Collara parties, so **its credential can act as any of them**. This is a privileged **project-operator credential**, held by the API and the worker on one server. It is **not** inter-organisation credential isolation: on LocalNet each organisation has its own least-privilege ledger user; on DevNet they share one.
- **Authority is still server-side and per organisation.** The API derives who may act from session → membership → mandate → party binding and puts exactly that organisation's party in `actAs` (plus the governance party in `readAs` for seat holders). It never takes a party, organisation or role from the browser, and a tenant user is mapped only to the parties passed in (`ledgerUsersByParty`, `apps/api/src/workflow/actors.ts`), so the tenant credential never widens what an actor can do through the API. Anyone with the tenant credential outside the API is not bound by this.
- **Worker scope.** The worker projects with `readAs` = exactly the bound Collara parties from the DevNet state (never `CanReadAsAnyParty`, never the tenant's other parties such as its primary party). `PROJECTION_PARTIES` can narrow that set and is refused if it names any other party.
- **Shared node.** The participant is operated by NODERS and shared with other hackathon teams. Its operator sees every transaction of every party it hosts, including all Collara parties: one participant is not a privacy boundary between Collara's organisations (same caveat as one-participant LocalNet; `docs/limitations.md`). Other tenants' parties are not visible to Collara's queries, which are always party-filtered.
- **Identity provider.** Keycloak is operated by NODERS. Every access token is verified before use: signature against the issuer's JWKS (asymmetric algorithms only; `HS*` is refused), `iss`, `aud` containing `DEVNET_LEDGER_AUDIENCE`, `scope` containing `daml_ledger_api`, `sub` equal to `DEVNET_LEDGER_USER_ID`, `exp` in the future.
- **Credentials at rest.** The rotating refresh token is stored AES-256-GCM encrypted in the DEVNET database (`ledger_credentials`, migration `0005`: key id, 96-bit random nonce per write, ciphertext, tag; the additional authenticated data binds credential id, ledger user id and key id, so a ciphertext moved to another row does not decrypt). The key (`DEVNET_CREDENTIAL_KEY`, 32 bytes, base64, with `DEVNET_CREDENTIAL_KEY_ID`; generated by `node scripts/devnet/gen-key.mjs`) lives outside the database, in `.env.devnet` or the host's secret manager; the API, the worker and every `scripts/devnet` step refuse to run in DEVNET without it, and the API, worker, scripts and `next build` refuse it in any `NEXT_PUBLIC_*` variable. Rotation: `DEVNET_CREDENTIAL_KEY_PREVIOUS` (decrypt only; the next refresh re-encrypts with the current key). Whoever holds both the database and the key can act as the tenant user until the token is rotated or the session ends. Access tokens are cached in process memory only. Loggers redact `refresh_token`, `access_token`, `authorization`, `password`, `DATABASE_URL`, `DEVNET_CREDENTIAL_KEY`, `DEVNET_CREDENTIAL_KEY_PREVIOUS` and related keys (`CREDENTIAL_LOG_KEYS`). Lost, wrong or rotated key: [`devnet/recovery.md`](devnet/recovery.md) §5.
- **Governance stays Tier A** on DevNet: `CollaraGovernance` is an ordinary party the tenant user can act as, so the tenant credential can sign registry contracts without the seat quorum (`docs/governance.md` §4).

## 4. Token rotation

```text
login.mjs (owner, once)          password grant ──► access token (validated, used once for GET /v2/authenticated-user)
                                                 └► refresh token RT1 ──► ledger_credentials (SELECT … FOR UPDATE)
API / worker / scripts, on demand:
  BEGIN; SELECT … FROM ledger_credentials WHERE id = 'devnet:<user>' FOR UPDATE   (other processes wait here)
  POST token endpoint grant_type=refresh_token, refresh_token=RTn ──► access token + RTn+1
  validate the access token; UPDATE refresh_token = RTn+1, rotation_count + 1; COMMIT
```

- **Single flight.** In one process, concurrent callers share one refresh (`OidcRefreshTokenProvider`). Across processes (API + worker + a script), the row lock serialises refreshes, and each refresh reads the token the previous one stored, so **one refresh token is never sent twice** (unit-tested with a mock issuer that rejects reuse; the two-pool PostgreSQL variant is an opt-in test, `DEVNET_CREDENTIALS_PG_URL`).
- **Caching.** An access token is reused until 300 s before `exp` (or halfway through a shorter life). After an HTTP 401 the client drops it and refreshes once.
- **Rotation safety.** Once the identity provider has answered, the new refresh token is stored even if the access token then fails validation, because the old one is spent.
- **Rejection.** `invalid_grant` (revoked, expired or reused token, ended session) marks the credential `REAUTH_REQUIRED`, erases the dead token, and every process reports `The identity provider rejected the stored refresh token (…). Run node scripts/devnet/login.mjs again …`. Commands fail as `FAILED`/`UNAUTHENTICATED`; `GET /api/system/health` reports the ledger `unavailable` with the same instruction.
- **Identity provider down.** `TOKEN_ENDPOINT_UNAVAILABLE`, retryable; the stored token is untouched.

## 5. Restart

All durable state is in PostgreSQL (`collara_devnet`) and on the ledger: command records, projections and checkpoints, bindings and the refresh token. Restarting the API or worker needs nothing else: the first ledger call refreshes the token under the lock. If a process crashed **between** the identity provider issuing RTn+1 and the COMMIT, RTn is spent and RTn+1 was never stored: the next refresh gets `invalid_grant` and the owner runs `login.mjs` again. This window is one HTTP round trip per refresh (about every three hours per process).

## 6. Network reset, pruning and other recovery

Full procedure (detect → decide → commands, for reset, pruning, lost or revoked credential, lost key, lost database, package re-upload with a bumped version): **[`devnet/recovery.md`](devnet/recovery.md)**. Start with `node scripts/devnet/recover.mjs` (read-only; prints the case and the exact next commands).

- **Reset.** Party ids, contract ids and offsets from before a reset are gone. Detected by `assertSameLedger` before every submission (`LEDGER_RESET`), by the worker (participant id change or ledger end behind the checkpoint → `ledger_sources.status = RESET_DETECTED`), and by the worker's periodic recovery check and `recover.mjs`. Recovery: `node scripts/devnet/recover.mjs --new-run --yes` (new run namespace, reset of the `devnet` projection source only, bindings re-imported, clean-start bootstrap; idempotent). The old database rows stay as history.
- **Pruning.** The worker compares its checkpoint with `GET /v2/state/latest-pruned-offsets` before reading, and treats `PARTICIPANT_PRUNED_DATA_ACCESSED` from `/v2/updates` the same way: if updates after the checkpoint were pruned, the source becomes `PRUNED` and stops (it never resumes from, or silently re-projects past, a pruned offset). A projection from before the pruning horizon cannot be rebuilt: the existing projection is kept as history; a checkpoint still within retention simply resumes; otherwise a new run starts the projection at the pruning offset (`history_floor_offset`). Not exercised on DevNet.
- **Credential, key, parties, packages.** Each is its own health state (`CREDENTIAL_MISSING`, `CREDENTIAL_REVOKED`, `CREDENTIAL_KEY`, `PARTIES_MISSING`, `PACKAGES_MISSING`) in the worker's `/healthz`, the API health and `recover.mjs`.
- Collara never calls pruning, reset or any other admin endpoint on the shared node.

## 7. Rollback

- **Stop using DevNet:** stop the API and worker started with `COLLARA_MODE=DEVNET`; switch back to `UI_MOCK` or `LOCALNET` env files. LocalNet is untouched: separate database, state file and token provider.
- **Revoke the credential:** sign out of the team session in the Wallet/Keycloak (ends the refresh token), and/or `UPDATE ledger_credentials SET refresh_token = NULL, status = 'REAUTH_REQUIRED'` in `collara_devnet`, or drop that database.
- **Ledger:** contracts on DevNet cannot be deleted by Collara. A run namespace can be abandoned by starting a new one (`import-bindings.mjs --run-ref <new>`, then `bootstrap.mjs`); its contracts stay on the ledger as synthetic data. Uploaded DARs cannot be removed; a changed contract model needs a new package version (`collara-contracts` 0.3.0), never a re-upload of 0.2.0.

## 8. Files

| Path | Purpose |
|---|---|
| `packages/canton/src/oidc.ts` | `OidcRefreshTokenProvider`, token validation, `RefreshTokenStore`, password/refresh grants |
| `packages/canton/src/devnet-config.ts` | `DevnetEnvSchema`, tenant defaults, `devnetGuardIssues` |
| `packages/db/src/credentials.ts`, `credential-cipher.ts`, migrations `0004_ledger_credentials.sql`, `0005_credential_encryption_recovery.sql` | `PgRefreshTokenStore` (row lock, rotation, rejection, AES-256-GCM envelope) |
| `packages/canton/src/credential-key.ts` | `DEVNET_CREDENTIAL_KEY*` parsing and guards |
| `packages/canton/src/devnet-recovery.ts`, `apps/api/src/devnet/recovery.ts` | recovery cases, diagnosis, `--new-run` plan ([`devnet/recovery.md`](devnet/recovery.md)) |
| `apps/api/src/ledger/devnet.ts` | DEVNET `LedgerAccess` (tenant-only token provider, state checks) |
| `apps/api/src/devnet/*` | bindings matcher, preflight checks, operator CLI |
| `apps/worker/src/ledger.ts` (`connectDevnetLedger`) | DEVNET projection source and completion client |
| `scripts/devnet/*.mjs` | `build-dars`, `gen-key`, `db-setup`, `login`, `preflight`, `import-bindings`, `bootstrap`, `verify-first-tx`, `recover` |
| `apps/api/test/devnet/devnet.it.test.ts` | opt-in read-only DevNet IT (`DEVNET_IT=1`), never in CI |
| `docs/devnet/owner-checklist.md` | the owner's ordered steps |
| `docs/devnet/upload-manifest.md` / `.json` | DAR files, sizes, SHA-256, package ids, upload order |
| `docs/devnet/noders-rights-request.md` | draft (unsent) message to NODERS about party rights |
| `docs/devnet-evidence.md` | filled only from real runs |
