# Collara

Collara is a private coordination workflow for equipment collateral (used CNC machinery) between borrowers, dealers, verifiers, lenders and auditors, built on Canton. A borrower registers an asset passport and evidence, a verifier attests it, the selected lender reviews it and issues a proposal, and an accepted proposal activates a pledge that locks the asset's single control token on the ledger until the designated lender releases it. The MVP is a reproducible local demo with **synthetic data only**. Cash settlement, real-money transfers, lien registration and ownership transfer are out of scope (ADR-0001). It is not production-ready.

## Status (2026-10-03; DevNet rows 2026-10-09)

Every check named below ran on one authoring machine (Windows 11) or in GitHub Actions, with synthetic data; [`docs/verification.md`](docs/verification.md) has the commands and results. "LocalNet" here is a Canton 3.5.19 `dpm sandbox` with **one participant**, not Splice LocalNet; the DevNet rows below are the one exception (a recorded run on the shared NODERS participant, not a deployment of Collara). Nothing here is a production-readiness or security claim. The same facts feed the public `/docs` page from one typed record, [`packages/domain/src/evidence.ts`](packages/domain/src/evidence.ts); change both together.

| Area | Status |
|---|---|
| `UI_MOCK` (web only, in-browser synthetic fixtures) | Implemented. Playwright UI_MOCK suite green in CI on desktop and mobile viewports (run 37108297524: 79 passed; the skips are viewport guards and LOCALNET-only tests); the full CL-001 walkthrough runs on desktop. Actions are simulated in the browser; no ledger transaction is submitted. |
| `LOCALNET` (web → API → Canton 3.5.19 sandbox, worker projections, PostgreSQL, SeaweedFS) | Implemented: every workflow endpoint runs on the sandbox. LocalNet integration tests **71/71** (12 files, S3 storage, 2026-10-03, before contracts 0.2.0; after 0.2.0 the activation suites pass 10/10 and the full suite ran only with in-memory storage, 68/73 — the 5 failures need S3-backed downloads; S3 re-run pending disk space), including the adversarial sweep over 44 id routes. Browser: the clean-start walkthrough of CL-001 **14/14** (46 steps) and the main-seed walkthrough and negatives 2/2 (desktop). Runs only on the authoring machine. |
| Unit tests | **410** passed (canton 50, domain 72, api-client 32, db 66, web 55, api 128, worker 7; api also skips 4 opt-in PostgreSQL concurrency tests) in CI run 37108297524 on `4eff547` (2026-10-03). |
| Daml model | Implemented (`collara-contracts` 0.2.0): 68 invariant, attack, privacy and revocation tests + 4 script tests (also in CI). Activation depends on a live disclosure, so a revocation committed first makes the ledger reject it. |
| Ledger privacy (witness level) | Checked on **five participants** of one sandbox: 8/8 tests, 87/87 checks, in two runs with contracts 0.2.0 (2026-10-03, [`docs/privacy-verification.md`](docs/privacy-verification.md)). One machine, one JVM, one operator: this is not isolation between independent operators. The LOCALNET demo itself runs on one participant. |
| Governance Tier A on LocalNet (`EVIDENCE.governance.tierA.localnet`: DLC-link DM v1.12.0 `GovernanceRules`, 2-of-3 seats, one local participant) | **Done.** Implemented and tested on the sandbox (LocalNet integration tests 10/10, part of the 71/71 run); the API and UI use it. The governance party is an ordinary local party: its credential could act without the seat quorum. |
| Verifier suspension | Default policy `REQUIRE_ACTIVE_VERIFIER` (`CollaraConfig.suspensionPolicy`): a suspended verifier cannot accept assignments or issue attestations (the ledger checks the governance-signed accreditation). Its issued attestations are not revoked, but `Control_Activate` requires the registrar's `VerifierStatusMirror` for that verifier to be `ACTIVE`, so they cannot back a new activation once the registrar has synced the mirror (it can lag the suspension). Existing locks are unaffected. |
| Governance Tier B on LocalNet (`EVIDENCE.governance.tierB.localnet`: Decentralization Manager nodes, decentralized party) | **Scripted, one operator, not in the app:** **10/10** governance checks (`scripts/tierb/`, [`docs/governance-tier-b.md`](docs/governance-tier-b.md)) with 3 × DM v1.12.0 + Canton OSS 3.5.19 with 3 participants in WSL; every node run by one operator (not independent). The API and UI use Tier A. Ran with `collara-contracts` 0.1.0; not re-run with 0.2.0. |
| Governance on DevNet (`EVIDENCE.governance.tierA.devnet`, `tierB.devnet`) | **Tier A: ran once** on 2026-10-05 (bootstrap B2–B6 created the Tier A `GovernanceRules` and the governed verifier registry on the shared NODERS participant, as ordinary parties of one tenant user, so **not decentralized**). **Tier B: not attempted** — the shared DevNet participant cannot host teams' Decentralized Parties. Nothing in this repository is decentralized governance on DevNet. |
| Canton DevNet (shared NODERS participant) | **One full synthetic run on 2026-10-05 (Canton 3.5.19)**: bootstrap, fixture CL-001 and the financing workflow through pledge activation and release (43 command records, 39 ledger updates), all committed with real update ids, none simulated; final state read from the ledger (pledge released, no active lock); Demo Lender B's participant view holds 0 of the case contracts. One tenant ledger user acts for every party (not isolation between operators). On 2026-10-09 the NODERS node reported **Canton 3.6.1**: the recorded run was re-read and verified (**43/43** receipts, `node scripts/devnet/verify-evidence.mjs`), bootstrap and asset registration committed on 3.6.1, and the API differences for the endpoints we use are added fields only. The rest of the workflow was **not re-run on 3.6.1**, and the preflight pin to 3.5.19 is unchanged. The public website is **not connected** to DevNet. Details: [`docs/devnet-evidence.md`](docs/devnet-evidence.md), [`docs/devnet.md`](docs/devnet.md). |
| CI (GitHub Actions) | **Green** on `main` (latest: run 37103384764 on `d1af714`, 2026-10-03): typecheck, lint, unit tests, generated-docs check, build; Playwright UI_MOCK e2e; Daml build and tests (SDK 3.5.12). The LocalNet IT workflow is manual and has not been run on GitHub. |
| Container images, Compose `app`/`canton` profiles, the Tier B Compose draft (`infra/tierb/compose.yaml`), hosting | Written; **untested** (no Docker on the authoring machine). |
| Public web deployment | The web app only, in **UI mockup** mode, on Vercel: https://collara-coral.vercel.app (auto-deployed from `main`). Synthetic data in the browser; no API, ledger, database or document storage is deployed, and `/api/*` answers `not_available_in_ui_mockup`. Its pilot form submits nothing. `PUBLIC_DEMO_STATUS=ui_mock` promotes the mockup as the public demo (see Configuration). |
| Demo sessions | The API refuses to start with `DEMO_SESSIONS_ENABLED=true` under `NODE_ENV=production` unless `DEMO_SESSIONS_ALLOW_IN_PRODUCTION=true`. |
| Not done | Tier B in the API/UI; the workflow re-run on DevNet 3.6.1; a hosted DevNet or LOCALNET stack (no API, worker or database is hosted); a working DevNet sign-in for reviewers (the DevNet identity is the team's single account; a local recording mode exists, [`docs/devnet-evidence.md`](docs/devnet-evidence.md)). |
| Legal pages (BPD-1), INFERRED copy | Pending. Any deployment that collects real data, including a working pilot form, stays blocked until they are resolved. |

**Not verified:** independent operators (the five-participant privacy run and Tier B ran on one machine, one operator), Tier B governance in the API/UI (only scripted), Docker/Compose, Keycloak OIDC through a browser, Secure cookies over HTTPS, JWKS ledger auth for a real participant, persistence across sandbox restarts (the sandbox keeps state in memory).

Evidence: [`docs/verification.md`](docs/verification.md) (what was run and observed) and [`docs/PROGRESS.md`](docs/PROGRESS.md). Commits cited in older notes (`e320c59`, `5ca4faa`, `8384a2b`, `3a3dd85`) are the same trees as `c9337d3`, `ea4ebf2`, `bbd1548` and `25265d0` on `main`, before a history rewrite.

## HackCanton submission

HackCanton Season 3, track "Real-World Assets (RWA) & Business Workflows", deadline 2026-10-09 23:59 UTC. The rules and what they mean for Collara are in [`docs/hackcanton-submission.md`](docs/hackcanton-submission.md). These are drafts; text outside approved copy is INFERRED and pending approval.

| Document | Contents |
|---|---|
| [`docs/submission/project-page.md`](docs/submission/project-page.md) | Platform text: problem, solution, how Canton is used, what is real vs mockup vs not done, links |
| [`docs/submission/pitch.md`](docs/submission/pitch.md) | Deck outline; validation evidence (interviews, metrics) is listed as a gap, not invented |
| [`docs/submission/demo-script.md`](docs/submission/demo-script.md) | Video script with timestamps. Recommended: UI-mockup tour plus the recorded DevNet run, each labeled on screen; LocalNet and DevNet-only variants as references |
| [`docs/submission/checklist.md`](docs/submission/checklist.md) | Mandatory items with status and owner, including a private-window link check |
| [`docs/submission/ai-disclosure.md`](docs/submission/ai-disclosure.md) | AI-assisted tooling statement (draft for the team to edit) |

**Public repository: pending the owner's decision.** The rules require a public repository with all code and this README; `zkzora/collara` is private as of 2026-10-04. Until it is public, the repository counts as missing for judging.

## Documentation

| Document | Contents |
|---|---|
| [`docs/setup.md`](docs/setup.md) | Local bring-up: PostgreSQL, SeaweedFS, Keycloak, environment |
| [`scripts/localnet/README.md`](scripts/localnet/README.md) | Canton sandbox, bootstrap, ledger users |
| [`docs/demo.md`](docs/demo.md) | Demo script for CL-001 per persona (LOCALNET and UI_MOCK) |
| [`docs/architecture/overview.md`](docs/architecture/overview.md) | Request flow, sources of truth, command lifecycle, projection worker, privacy model |
| [`docs/architecture/ADR-0001-architecture-and-versions.md`](docs/architecture/ADR-0001-architecture-and-versions.md) | Architecture decisions and pinned versions |
| [`docs/architecture/daml-model.md`](docs/architecture/daml-model.md) | Daml templates, choices, invariants and trust assumptions |
| [`docs/permissions.md`](docs/permissions.md) | Permission matrix, authority chain, field-level disclosure (generated from `@collara/domain`) |
| [`docs/api.md`](docs/api.md) | OpenAPI, authentication, CSRF, idempotency, error shape |
| [`docs/verification.md`](docs/verification.md) | What was run, observed results, and what was not verified |
| [`docs/privacy-verification.md`](docs/privacy-verification.md) | Witness-level ledger privacy on five participants: method, results, limits |
| [`docs/governance-tier-b.md`](docs/governance-tier-b.md) | Tier B governance (DM nodes, decentralized party): scripted run, thresholds, what is not integrated |
| [`docs/governance.md`](docs/governance.md) | Tier A governance, thresholds, Tier B and what a real deployment needs |
| [`docs/limitations.md`](docs/limitations.md) | What Collara does not do or prove |
| [`infra/deploy/README.md`](infra/deploy/README.md) | Deployment proposal and requirements (untested) |

## Workspace layout

| Path | Package | What it is |
|---|---|---|
| `apps/web` | `@collara/web` | Next.js 16 App Router: public site and the workspace (`/app`). Same-origin `/api/*` proxy to the API. |
| `apps/api` | `@collara/api` | Fastify 5 API with Zod validation and OpenAPI at `/api/docs`. |
| `apps/worker` | `@collara/worker` | Long-running worker (projection, reconciliation, exports). Health at `:4100/healthz`. |
| `packages/domain` | `@collara/domain` | Shared Zod schemas, state vocabularies, permission policy, money, fixtures. |
| `packages/db` | `@collara/db` | Drizzle schema and migrations (server only). |
| `packages/canton` | `@collara/canton` | Typed Canton JSON Ledger API v2 client (server only). |
| `packages/api-client` | `@collara/api-client` | Typed API client and the UI mock client. |
| `daml/` | | Daml packages. |
| `docs/` | | Architecture, research and setup notes. |
| `Collara Website/` | | Original HTML prototype. Read-only reference; do not modify. |

Internal packages export TypeScript source (no build step). Next.js transpiles them; the API and worker run on [`tsx`](https://tsx.is) in both `dev` (watch) and `start`. A compiled production build of the API and worker is not set up yet.

## Prerequisites

- Node.js 24 LTS (`>=24.15.0 <25`; `.node-version` pins 24.21.0).
- pnpm 11. `packageManager` pins `pnpm@11.28.2`; an installed pnpm 11 downloads that version automatically. Do not use pnpm 12.
- Dependency versions are exact pins in the `catalog:` of `pnpm-workspace.yaml`. New versions must be at least 24 hours old (`minimumReleaseAge`).

## Commands

Run from the repository root (PowerShell 5.1 and Git Bash both work):

```sh
pnpm install            # install the workspace
pnpm typecheck          # tsc in every package (web runs `next typegen` first)
pnpm lint               # ESLint 9 flat config over the whole repo
pnpm test               # Vitest in every package
pnpm build              # next build for the web app + typecheck of api and worker
pnpm peers check        # peer dependency report (expected: no issues)

pnpm dev:web            # http://localhost:3000
pnpm dev:api            # http://127.0.0.1:4000  (OpenAPI UI: /api/docs)
pnpm dev:worker         # http://127.0.0.1:4100/healthz
```

Single package: `pnpm --filter @collara/web <script>` (scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:e2e`).

Local services and the ledger (thin wrappers around the cross-shell scripts in `scripts/` and `daml/collara/check.mjs`; details in [`docs/setup.md`](docs/setup.md) and [`scripts/localnet/README.md`](scripts/localnet/README.md)):

```sh
pnpm env:init                      # create .env from .env.example with random dev-only secrets
pnpm db:up | db:status | db:down   # PostgreSQL 16 in WSL (Windows); db:down stops the keepalive
pnpm db:migrate                    # apply packages/db migrations (needs DATABASE_URL)
pnpm db:seed                       # demo organizations, users, memberships and mandates
pnpm db:bind-localnet              # import .local/localnet/state.json (after localnet:bootstrap)
pnpm infra:seaweed <cmd>           # SeaweedFS S3: install | start | status | check | stop
pnpm infra:keycloak <cmd>          # Keycloak OIDC: install | start | status | check | stop | reset
pnpm localnet:up                   # Canton sandbox (add --bootstrap); localnet:up:3 for 3 participants
pnpm localnet:bootstrap            # upload DARs, allocate parties and ledger users
pnpm localnet:status | localnet:down
pnpm daml:check                    # verify vendored DARs, dpm build --all, run the Daml Script tests
```

Generated files (re-run after changing routes or the domain policy; CI checks the permissions doc):

```sh
pnpm --filter @collara/api openapi:export                                    # apps/api/openapi.json (no server needed)
pnpm --filter @collara/api exec tsx ../../scripts/docs/permissions.mjs       # docs/permissions.md (add --check to verify)
```

`next build` and `next dev` lock their output directory, so two builds of `apps/web` cannot share it. Set `NEXT_DIST_DIR` (for example `.next-landing`; any `.next*` name is gitignored) to give a build or dev server its own directory. `next start` and `test:e2e` must be given the same value as the build they serve.

End-to-end tests use Playwright (Chromium; a desktop project and a 390×844 mobile-viewport project). Install the browser once, build, then run:

```sh
pnpm --filter @collara/web exec playwright install chromium
pnpm --filter @collara/web build
pnpm --filter @collara/web test:e2e
```

## Configuration

Run `pnpm env:init` to create `.env` at the root for the API, worker and infrastructure scripts (it copies `.env.example` and fills the empty dev-only secrets; if you copy it by hand, fill those secrets: the API does not start while `COLLARA_S3_ENDPOINT` is set without `COLLARA_S3_SECRET_KEY`). For the web app, copy `infra/env/web.env.example` to `apps/web/.env.local`. The web app reads `API_INTERNAL_ORIGIN` (default `http://127.0.0.1:4000`) at request time, so one build works against any API origin. `COLLARA_MODE` is `UI_MOCK` (default) or `LOCALNET`.

`PUBLIC_DEMO_STATUS` (read per request) decides whether the public site promotes a demo: `off` (default; pre-demo copy, `/demo` linked nowhere), `ui_mock` (the in-browser UI mockup, honoured only with `COLLARA_MODE=UI_MOCK`, with a disclosure that it has no ledger connection) or `localnet` (honoured only with `COLLARA_MODE=LOCALNET`). Any other combination resolves to `off`. When running `marketing.spec.ts` against a server, give Playwright the same `PUBLIC_DEMO_STATUS`.

Ports: web 3000, API 4000, worker health 4100.

## Web app notes

- **`/api` proxy.** `apps/web/src/app/api/[...path]/route.ts` forwards every `/api/*` request to `API_INTERNAL_ORIGIN` with the same path and query. It streams bodies, forwards cookies and `Set-Cookie`, sets `X-Forwarded-Host`/`X-Forwarded-Proto`, drops hop-by-hop headers, `Expect` and any browser `Authorization` header, adds `Cache-Control: private, no-store` when the API sets none, and returns `502 {"error":"upstream_unavailable"}` (or `504` after 60 s) when the API cannot be reached. Next fills `X-Forwarded-For` only when the client did not send one, so the API ignores it unless `TRUST_PROXY` is set.
- **Caching.** `next.config.ts` sets `Cache-Control: private, no-store` on `/app/*` and `/login` in production (`next start`). `next dev` replaces it with `no-cache, must-revalidate`.
- **Design tokens** live in `apps/web/src/app/globals.css`: one set of semantic names in two scopes, `[data-surface="app"]` (also the `:root` default) and `[data-surface="marketing"]`, mapped onto shadcn's variables. The theme is dark only. Customised shadcn (Base UI) components are in `apps/web/src/components/ui`.
- `next dev` writes `apps/web/AGENTS.md`. Commit it; deleting it only brings it back.
