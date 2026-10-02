# Collara build progress

Living status file so work can resume across sessions. Update it at the end of every stage.

## Stage status (master brief §10)

| # | Stage | Status | Notes |
|---|---|---|---|
| 1 | Audit, sources of truth, permissions, compatibility, migration plan | Done (2026-10-02) | `docs/_research/*`, ADR-0001, migration map |
| 2 | Frontend migration (Next.js, UI_MOCK walkthrough, typecheck, build) | Done for UI_MOCK (2026-10-02) | Public site (`/`, `/docs`, `/pilot`, `/demo`, `/privacy`, `/terms`), `/login`, the workspace (Part A: overview, cases, case tabs and actions; Part B: assets, verifications, reviews, pledges, access, audit and exports, governance, settings, notifications). The full walkthrough e2e passes in UI_MOCK. Open: copy approval for strings marked INFERRED, BPD-1. LOCALNET rendering needs stage 4 endpoints. |
| 3 | Daml state model + invariant tests; typed Canton adapter; LocalNet submission + visibility | In progress | Done: Daml model (`daml/collara`, see `docs/architecture/daml-model.md`) with 60 invariant/attack/privacy tests + 4 script tests on the Daml Script IDE ledger; `@collara/canton` adapter; LocalNet scripts (sandbox up/down/status/bootstrap, HMAC JWT auth). Not done: Collara templates submitted through the adapter on LocalNet, witness-level privacy on the 3-participant sandbox, contention on the real `Control_Activate`. |
| 4 | API services, private evidence, DB migrations, command records, projections | In progress | Done: `@collara/db` schema + migration `0000_init`, API foundation (sessions in PostgreSQL, OIDC PKCE, CSRF, demo sessions, pilot requests, private evidence pipeline on SeaweedFS, command lifecycle service, health). Not done: `LedgerGateway` on `@collara/canton`, worker projections, `ProjectionReader`; 54 of the 66 endpoints in the web client's route table (`API_ENDPOINTS`) do not exist in the API yet. |
| 5 | Core journey wired to LocalNet; authz failures, concurrency, retry, scoped exports verified | Done (2026-10-02), except witness-level privacy | 49 LOCALNET IT + 8 adversarial IT (44 id routes: anonymous 401, Lender B byte-identical 404, spoofed org/party ignored, idempotency, ledger down → 503 FAILED); Playwright LOCALNET walkthrough + negatives pass. Open: 3-participant witness privacy; full IT re-run with S3 after disk space is freed. |
| 6 | BitSafe governance (DM) | Tier A done (2026-10-02) | DM v1.12.0 GovernanceRules 2-of-3 via API: 10/10 live tests (one confirmation fails, duplicate seat not counted, stale proposal fails, suspension blocks attestation, non-seats 404). Tier B (real DM nodes, decentralized party) not attempted. |
| 7 | Setup scripts, CI, health checks, deployment config, docs | Done except never executed remotely | CI workflows (actionlint ok, never run on GitHub); Dockerfiles + compose app/canton profiles (untested, no Docker); docs: setup, demo, permissions (generated), governance, limitations, architecture overview, API, verification. Demo sessions refused in production unless explicitly allowed. |

## Integration check (2026-10-02)

Run by the integrator from the repo root on the authoring machine after the parallel build (Node 24.16.0, pnpm 11.28.2). Every command below was run in this session; results are as observed.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Already up to date (lockfile matches) |
| `pnpm typecheck` | Pass: 7 packages |
| `pnpm lint` | Pass: 298 files, 0 errors, 0 warnings |
| `pnpm test` | Pass: 210 tests. canton 50, domain 56, api-client 22, db 7, worker 2, web 25, api 48 |
| `pnpm build` | Pass: `next build` (Turbopack, default `.next`) and typecheck of api and worker |
| `dpm build --all --no-cache` (in `daml/collara`) | Pass: 4 DARs (governance, contracts, scripts, tests), no warnings |
| `node daml/collara/check.mjs --skip-build`, then `pnpm daml:check` | Pass both times: vendored DAR checksums ok; tests 60 ok / 0 failed; scripts 4 ok / 0 failed |
| `next start` (UI_MOCK, port 3000) + `PLAYWRIGHT_BASE_URL=http://localhost:3000 playwright test --workers=2` | Pass: 59 passed, 7 skipped, 0 failed. marketing 33/1 skipped, smoke 4, walkthrough 1/1 skipped, workspace-a 13/1 skipped, workspace-b 8/4 skipped. Each skip is a deliberate viewport guard in the spec (desktop-only flow on the mobile project, or the reverse). Run twice, before and after the integrator's edits, with the same result. |
| `curl -I` on `/app` and `/login` under `next start` | `Cache-Control: private, no-store` on both |
| `pnpm localnet:status`, `pnpm db:status`, `pnpm infra:seaweed status`, `pnpm infra:keycloak status` | Scripts resolve and report "not running" (exit 1), the expected result with nothing started |

Reported by the builders, **not** re-run in the integration check: Canton adapter integration tests (`CANTON_IT=1`, 6 tests, cold start and reuse, against a `dpm sandbox`, Canton 3.5.19); the API against PostgreSQL 16.14 in WSL and SeaweedFS 4.48; the Keycloak PKCE code-flow check for every demo user (`keycloak.mjs check`).

Integrator changes: root scripts (`env:init`, `db:*`, `infra:*`, `localnet:*`, `daml:check`, `test:e2e`), `.env.example` aligned with the API config (added `PUBLIC_ORIGIN`, `COOKIE_SECURE`, `COLLARA_OIDC_ALLOW_INSECURE_HTTP=true` for the local http issuer, and the optional settings; removed the unused `COLLARA_OIDC_POST_LOGOUT_REDIRECT_URI`; corrected the Canton and worker comments), README commands and configuration, breadcrumb labels for `/app/access` and `/app/notifications` (with a unit test), `data-scroll-behavior="smooth"` on `<html>`.

## Known gaps and blockers

- **LOCALNET is not usable end to end.** The API has no ledger gateway (the default reports the ledger unavailable). The worker only serves health and has no projection loop. Case, asset, verification, review, proposal, pledge, release, access-grant, audit, report and governance endpoints do not exist yet. In LOCALNET the workspace pages have no endpoints to read from.
- **Ledger privacy at witness level is untested.** IDE-ledger tests check active-contract visibility only. They need per-party update streams on the 3-participant sandbox, with priority on `Control_Activate`, `VR_IssueAttestation` and `Release_Reject`.
- **Attestation revocation is not checked on-ledger at activation** (by design, to keep the verifier unaware of pledges). The API must check that the lender still holds the `AttestationDisclosure` before `Control_Activate` (`daml-model.md` §8).
- **Not exercised:**
  - an OIDC code exchange through the API against Keycloak (only with a fake OIDC service)
  - Secure-cookie mode behind HTTPS
  - API calls through the Next `/api` proxy with real sessions
- **Copy approval:** strings marked INFERRED in `packages/domain/src/copy.ts` and in the web screens (login, dialogs, error states, governance notices, pilot form errors, docs footnotes). BPD-1 (privacy notice, terms, consent text, retention) blocks any public URL that collects personal data.
- **Product and model gaps:**
  - dealer consent step (`PARTIALLY_CONSENTED`) is not modelled in the API or the mock
  - no `/app/cases/new` route
  - Overview per-currency totals have no endpoint (they show "Not available")
  - the projection checkpoint is only reported per case
- **Accessibility:** input, select and checkbox borders are 1.21:1 against the surface (prototype look), below WCAG 1.4.11's 3:1. This needs a design decision.
- **Environment:**
  - Node 24.16.0 is installed; `.node-version` recommends 24.21.0
  - `next build` downloads Google fonts (needs network)
  - `infra/compose/compose.yaml` was never run
- **CLAUDE.md still names `scripts/dev/wsl-keepalive`**, which does not exist. The current command is `pnpm db:up` (`node scripts/dev/wsl-postgres.mjs up`). The lead should update CLAUDE.md.

## Next steps

1. Commit the parallel build (nothing from it is committed yet), including `apps/web/AGENTS.md`, which `next dev` regenerates.
2. Implement `LedgerGateway` on `@collara/canton`:
   - deterministic `commandId` per idempotency record and a new `submissionId` per attempt
   - `UNKNOWN_OUTCOME` handled by resubmitting or reading completions
3. Seed the main fixture on LocalNet through real choices.
4. Worker projection loop with `projector-svc`:
   - poll `/v2/updates` per participant and persist `nextBeginExclusive`
   - key events by `(updateId, nodeId)` and store witness parties
   - read terminal outcomes from exercised events
   - refuse to mix histories after a participant reset
5. API read endpoints for the workspace, then the case and verification commands. Use the domain policy, workflow checks and presenters (404 for unrelated records), in the order of the walkthrough.
6. Run the 3-participant witness privacy tests and a live `Control_Activate` contention test. Then run the e2e walkthrough in LOCALNET.
7. Set up CI: `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`, `build`, Playwright in UI_MOCK, and `daml:check`.
8. Get approval for the INFERRED copy and resolve BPD-1 before any public deployment.

## Environment facts (authoring machine)

- Windows 11, Node 24.16.0, pnpm 11.28.2 (via `packageManager`), Java 21, Python 3.12, git. No Docker.
- dpm 1.0.22 / Daml SDK 3.5.12 / Canton 3.5.19 installed at `%APPDATA%\dpm` (not on PATH).
- WSL2 Ubuntu 24.04 with PostgreSQL 16.14: role `collara` / `collara_dev`, DBs `collara`, `collara_test` (created 2026-10-01). Reachable from Windows on 127.0.0.1:5432 only while WSL is running (`pnpm db:up` keeps it running).
- SeaweedFS 4.48 and Keycloak 26.7.5 install into `.local/` on first `install`/`start` (gitignored). Playwright Chromium 1243 is installed.
- DM v1.12.0 cloned at `.vendor/decentralization-manager` (gitignored). Research spikes in `.spike/` (gitignored).

## Open product questions (defaults in use — see synthesis §2.1)

- BPD-1: privacy notice, terms, pilot consent text, retention period, notification inbox — **blocking for publication only**; pages say "pending legal review".
- Q-01…Q-11 defaults as listed in `docs/_research/synthesis.md` §2.1.

## Log

- 2026-10-01/02 — Repository audited; research + synthesis written; git initialised with prototype baseline; ADR-0001 and migration map written.
- 2026-10-02 — Parallel build of the foundation, Daml model, Canton adapter + LocalNet scripts, domain + api-client, infra scripts, marketing site, DB + API foundation, and workspace Parts A and B. The integration check passed (see above). Committed as `3430e3c`.
- 2026-10-02 — Stage 4/5 started (ledger core + projections); interrupted by a session restart. Partial work committed as `ac423a2` (typecheck + 229 unit tests green; lint: unused vars in `packages/db/src/read-model/world.ts`). Verified on the live sandbox by the builder: `localnet:seed --profile clean-start|main --prefix core` commits B1–B8 + M1–M18 and replays idempotently (24/24). Remaining in order: finish read model + worker loop; IT harness; endpoints (assets/verification/cases, review→release→audit/exports, governance); LOCALNET verification (e2e, adversarial, concurrency, restart, 3-participant privacy); then run the full stack locally for the user.
- Resume tip: shared infra is started with `pnpm db:up`, `pnpm infra:seaweed start`, `pnpm localnet:up`, `pnpm localnet:bootstrap`. Builder prompts for Stage 4/5 are saved in `docs/_research/build-prompts/stage-4-5-localnet.js` (constants `COMMON`, `PROJECTION`, `LEDGER_CORE`, `EP_*`, `VERIFY`).
- 2026-10-02 — Stage 4/5 finished with background subagents (ultracode off): commits abd89a4 (IT harness), 1107971 (worker + read model; export lease bug fixed), e320c59 (all endpoints, governance, app-wide parse serializer). Full LOCALNET stack brought up for the user: sandbox + default seed (24 steps), worker 4100, API 4000, web 3000 (next start, LOCALNET, demo sessions). Running in parallel: LOCALNET polish + Playwright/adversarial tests (own prefix e2e, ports 3100/4200/4210); Stage 7 CI/deploy/docs.
- 2026-10-02 — Stage 7 committed (3a3dd85), demo-session production guard (5ca4faa), LOCALNET polish + e2e + adversarial (8384a2b). Running demo restarted with the fixes (API 4000, worker 4100, web 3000). Environment issue: C: has ~3.2 GB free; SeaweedFS refuses writes below 1% free (~4.8 GB), so evidence uploads and export generation fail until the user frees disk space (reads, ledger workflow and governance work). Next: user frees disk → re-run full LOCALNET IT with S3; 3-participant witness privacy; Tier B DM spike (needs several GB RAM, run with the demo stopped); JWKS ledger auth for a real participant; BPD-1 legal text; copy approval.
