# Collara

Collara is a private coordination workflow for equipment collateral (used CNC machinery) between borrowers, dealers, verifiers, lenders and auditors, built on Canton. The MVP is a reproducible local demo with synthetic data only. Cash settlement, real-money transfers, lien registration and ownership transfer are out of scope (ADR-0001).

Architecture and pinned versions: [`docs/architecture/ADR-0001-architecture-and-versions.md`](docs/architecture/ADR-0001-architecture-and-versions.md). Build status: [`docs/PROGRESS.md`](docs/PROGRESS.md).

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
