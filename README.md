# Collara

Collara is a private coordination workflow for equipment collateral (used CNC machinery) between borrowers, dealers, verifiers, lenders and auditors, built on Canton. A borrower registers an asset passport and evidence, a verifier attests it, the selected lender reviews it and issues a proposal, and an accepted proposal activates a pledge that locks the asset's single control token on the ledger until the designated lender releases it. The MVP is a reproducible local demo with **synthetic data only**. Cash settlement, real-money transfers, lien registration and ownership transfer are out of scope (ADR-0001). It is not production-ready.

## Status (2026-10-02)

Every check named below ran on one authoring machine (Windows 11) with synthetic data; [`docs/verification.md`](docs/verification.md) has the commands and results. "LocalNet" here is a Canton 3.5.19 `dpm sandbox` with **one participant**, not Splice LocalNet; nothing is deployed to a Canton Network. Nothing here is a production-readiness or security claim.

| Area | Status |
|---|---|
| `UI_MOCK` (web only, in-browser synthetic fixtures) | Implemented. Playwright UI_MOCK suite passed on desktop and mobile viewports (59 passed; the skips are viewport guards and LOCALNET-only tests); the full CL-001 walkthrough runs on desktop. Actions are simulated in the browser; no ledger transaction is submitted. |
| `LOCALNET` (web → API → Canton 3.5.19 sandbox, worker projections, PostgreSQL, SeaweedFS) | Implemented: every workflow endpoint runs on the sandbox. 49 LOCALNET integration tests passed at commit `c9337d3`; the 8-test adversarial sweep (44 id routes) passed with S3 storage. The last full run (57 tests, in-memory storage) passed 55: the 2 failures assert presigned S3 URLs, which in-memory storage cannot produce; the full re-run with S3 is pending free disk space. A Playwright LOCALNET walkthrough of CL-001 and the negative checks passed in the browser (desktop). 285 unit tests passed. |
| Daml model | Implemented: 60 invariant, attack and privacy tests + 4 script tests on the IDE ledger. |
| Governance Tier A (DLC-link DM v1.12.0 `GovernanceRules`, 2-of-3 seats, one local participant) | Implemented and tested on the sandbox. The governance party is an ordinary local party: its credential could act without the seat quorum. |
| Verifier suspension | Default policy `REQUIRE_ACTIVE_VERIFIER` (`CollaraConfig.suspensionPolicy`): a suspended verifier cannot accept assignments or issue attestations (the ledger checks the governance-signed accreditation). Its issued attestations are not revoked, but `Control_Activate` requires the registrar's `VerifierStatusMirror` for that verifier to be `ACTIVE`, so they cannot back a new activation once the registrar has synced the mirror (it can lag the suspension). Existing locks are unaffected. |
| Governance Tier B (Decentralization Manager nodes, decentralized party) | Exercised by scripts only (`scripts/tierb/`, `docs/governance-tier-b.md`): 3 × DM v1.12.0 + Canton OSS 3.5.19 with 3 participants in WSL, one operator. Governance checks passed; the API and UI do not use it. |
| CI (GitHub Actions) | **Green** on `main` since 2026-10-03 (run 37102909305): typecheck, lint, unit tests, generated-docs check, build; Playwright UI_MOCK e2e; Daml build and tests (SDK 3.5.12). The LocalNet IT workflow is manual and has not been run on GitHub. |
| Container images, Compose `app`/`canton` profiles, hosting | Written; **untested** (no Docker on the authoring machine). |
| Public web deployment | The web app only, in **UI mockup** mode, on Vercel: https://collara-coral.vercel.app (auto-deployed from `main`). Synthetic data in the browser; no API, ledger, database or document storage is deployed, and `/api/*` answers `not_available_in_ui_mockup`. |
| Demo sessions | The API refuses to start with `DEMO_SESSIONS_ENABLED=true` under `NODE_ENV=production` unless `DEMO_SESSIONS_ALLOW_IN_PRODUCTION=true`. |
| In progress (not done) | Verifier scoped evidence assignment; Create Case UI, overview per-currency totals and input contrast; persisted internal and release notes. |
| Legal pages (BPD-1), INFERRED copy | Pending. The public deployment is a UI mockup whose pilot form submits nothing; any deployment that collects real data stays blocked until they are resolved. |

**Not verified:** independent operators (the five-participant privacy run and Tier B ran on one machine, one operator — see [`docs/privacy-verification.md`](docs/privacy-verification.md)), Tier B governance in the API/UI (only scripted), Docker/Compose, Keycloak OIDC through a browser, Secure cookies over HTTPS, JWKS ledger auth for a real participant, persistence across sandbox restarts (the sandbox keeps state in memory).

Evidence: [`docs/verification.md`](docs/verification.md) (what was run and observed) and [`docs/PROGRESS.md`](docs/PROGRESS.md). Commits cited in older notes (`e320c59`, `5ca4faa`, `8384a2b`, `3a3dd85`) are the same trees as `c9337d3`, `ea4ebf2`, `bbd1548` and `25265d0` on `main`, before a history rewrite.

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

Ports: web 3000, API 4000, worker health 4100.

## Web app notes

- **`/api` proxy.** `apps/web/src/app/api/[...path]/route.ts` forwards every `/api/*` request to `API_INTERNAL_ORIGIN` with the same path and query. It streams bodies, forwards cookies and `Set-Cookie`, sets `X-Forwarded-Host`/`X-Forwarded-Proto`, drops hop-by-hop headers, `Expect` and any browser `Authorization` header, adds `Cache-Control: private, no-store` when the API sets none, and returns `502 {"error":"upstream_unavailable"}` (or `504` after 60 s) when the API cannot be reached. Next fills `X-Forwarded-For` only when the client did not send one, so the API ignores it unless `TRUST_PROXY` is set.
- **Caching.** `next.config.ts` sets `Cache-Control: private, no-store` on `/app/*` and `/login` in production (`next start`). `next dev` replaces it with `no-cache, must-revalidate`.
- **Design tokens** live in `apps/web/src/app/globals.css`: one set of semantic names in two scopes, `[data-surface="app"]` (also the `:root` default) and `[data-surface="marketing"]`, mapped onto shadcn's variables. The theme is dark only. Customised shadcn (Base UI) components are in `apps/web/src/components/ui`.
- `next dev` writes `apps/web/AGENTS.md`. Commit it; deleting it only brings it back.
