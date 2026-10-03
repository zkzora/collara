# ADR-0001 — Collara MVP architecture and pinned versions

- Status: Accepted (2026-10-02)
- Inputs: `docs/_research/synthesis.md` (reconciled requirements, conflict register, version matrix), `docs/_research/research-*.md` (verified on this machine), master brief (`collara-full-stack-master-prompt.md`), system spec (`collara-full-website-system.md`).
- Scope: MVP targeting a reproducible local Canton demo. Cash settlement, real-money transfers, lien registration, global physical-asset uniqueness and ownership transfer are out of scope.

## 1. Context

The starting point is a design-canvas HTML prototype (`Collara Website/*.dc.html`) with simulated state, no backend, no ledger and no auth. The authoring machine is Windows 11 with Node 24, pnpm 11, Java 21 and **no Docker**; WSL2 Ubuntu has PostgreSQL 16. The Daml SDK was installed during research (dpm 1.0.22, SDK 3.5.12, Canton 3.5.19 open source).

## 2. Decisions

### 2.1 Repository shape (pnpm workspace, one backend, one worker)

```text
apps/web            Next.js App Router: public site (Server Components) + authenticated workspace (Client Components)
apps/api            Fastify: auth/session, permission + mandate checks, domain services, Canton commands, evidence storage, OpenAPI
apps/worker         Long-running Node worker: ledger update projection, command reconciliation, export generation
packages/domain     Zod schemas/DTOs, state vocabularies, permission policy, money, display ids, synthetic fixtures
packages/db         Drizzle schema, versioned SQL migrations, scoped query helpers
packages/canton     Typed JSON Ledger API v2 adapter (openapi-fetch + generated types), token provider, template ids, command helpers
packages/api-client Typed Collara API client (HTTP) + UI_MOCK client implementing the same interface
daml/collara        Daml multi-package: governance, contracts, tests, scripts; vendored DM DARs with checksums
infra/              compose (untested here), Keycloak realm, Canton configs, env templates
scripts/            Cross-shell Node scripts (.mjs) for local infrastructure, seeding and checks
docs/               Architecture, permissions, setup, demo, limitations
```

- **No `packages/ui`.** The web app is the only UI consumer; Collara primitives and customised shadcn components live in `apps/web/src/components/{ui,collara}`. Splitting them out is cheap later if a second consumer appears.
- Internal packages export TypeScript source (no per-package build). Next transpiles them (`transpilePackages`); the API and worker run on `tsx`.
- Browser bundles never import `packages/db`, `packages/canton`, storage credentials or signing code (enforced by `server-only` imports and lint rules).

### 2.2 Runtime modes

| Mode | Data path | Banner |
|---|---|---|
| `UI_MOCK` | Web uses the **mock client** (`@collara/api-client/mock`): synthetic fixtures + the same `@collara/domain` policy/presenter functions the API uses. No API, DB or ledger required. Persona switching is local. Mutations are simulated and never claim ledger confirmation. | `Synthetic demo data — UI mockup.` |
| `LOCALNET` | Web → same-origin `/api` (Next Route Handler proxy) → Fastify → permission/mandate checks → Canton JSON Ledger API v2 or private storage. Ledger updates → worker → authorized projections → API → UI. | `Synthetic demo data — Canton LocalNet.` |

- The mode is read **server-side at runtime** (`COLLARA_MODE`) and passed into the client provider; the mock client is code-split and only loaded in `UI_MOCK`.
- In `LOCALNET`, a failed or unavailable ledger action is reported as such. There is **no fallback** to simulated success.
- UI_MOCK ships synthetic fixtures to the browser; it is a UI mockup, not a privacy demonstration. Privacy is enforced and tested only in LOCALNET (server-side field omission, per-party projections).
- The landing keeps the approved pre-build/pilot copy until the LOCALNET demo works end to end (`PUBLIC_DEMO_STATUS=off|ui_mock|localnet`, default `off`). Amended 2026-10-03: `ui_mock` promotes the synthetic UI mockup demo with a no-ledger disclosure (used by the Vercel deployment); `localnet` remains reserved for a working LOCALNET demo.

### 2.3 Ledger and Daml

- **Daml SDK 3.5.12** via **dpm 1.0.22**, Canton **3.5.19** open source, Daml-LF target **2.2** (explicit). No contract keys (LF 2.3 keys are non-unique — verified).
- Uniqueness and the single-lock invariant are enforced by **consuming one canonical `AssetControl` contract** per registered asset; the registrar-only `AssetRegistry` set prevents re-issuance. A `CollateralLock` (signatories registrar, owner, lender) has exactly one choice, `Lock_Release`, controlled by the designated lender.
- Every choice has a single controlling party per submission; cross-organisation steps use propose/accept. (Joint `actAs` across participants is rejected by Canton — verified.)
- Financing terms exist only in contracts whose stakeholders are the borrower and the selected lender. Activation consumes a borrower+lender-signed `PledgeActivationAuthorization` that carries references and hashes, never terms.
- Full model: `docs/architecture/daml-model.md` (written with the contracts). Design source: `docs/_research/synthesis.md` §5.
- Local ledger: `dpm sandbox` with `unsafe-jwt-hmac-256` auth and a fixed `target-audience`; DARs uploaded through `POST /v2/dars`; parties/users allocated through the JSON API. Optional 3-participant mode for cross-participant privacy tests.
- **"LocalNet" wording.** On this machine the ledger is a Canton 3.5.19 sandbox (1 or 3 participants), not Splice LocalNet (Docker). Banner text follows the brief; `/docs#setup` and `GET /api/system/health` state the exact topology.

### 2.4 Ledger client

- **openapi-fetch 0.17.0 + openapi-typescript 7.13.0** types generated from the node's `/docs/openapi` (committed spec + generated `.d.ts`). Template ids use package-name references (`#collara-contracts:Module:Template`).
- `@canton-network/core-ledger-client` was evaluated (works against 3.5.19) but not adopted as the primary path: 63 transitive deps, weekly churn, no docs. Revisit later.
- `@daml/ledger` / `@daml/react` (JSON API v1) are incompatible with Canton 3.x and are not used.

### 2.5 Identity, sessions, authority

- OIDC Authorization Code + PKCE with **openid-client 6.8.8** against **Keycloak 26.7.5** (local zip, Java 21). The API owns a server-side session (PostgreSQL) and an HttpOnly cookie; tokens never reach the browser.
- Demo environment only: **isolated demo sessions** (`POST /api/demo/sessions`, enabled by `DEMO_SESSIONS_ENABLED=true`) bind the browser to one seeded demo user. Not a production authorization mechanism.
- Authority is derived server-side from `memberships` → `mandates` → `party_bindings`. The browser never supplies a party id, organisation or role that is trusted.
- Ledger: one least-privilege ledger user per organisation (`CanActAs` own party). The worker uses a read-only projection user with `CanReadAs` over Collara parties — a documented privileged operator credential. Admin credentials are used only by setup scripts.
- Analyst vs approver is a **mandate inside one organisation party**, enforced by the API (ledger sees the org party; choices record an opaque `actorRef`). Per-mandate parties are a documented P1 option.

### 2.6 Command consistency

- Every mutation takes an `Idempotency-Key`; the API stores a durable command record scoped to (actor, organisation, operation, payload hash). Reusing a key with a different payload → `409`.
- Lifecycle `PREPARED → SUBMITTED → COMMITTED → PROJECTED`, plus `REJECTED`, `FAILED` (pre-commit infrastructure), `UNKNOWN_OUTCOME`, `PROJECTION_DELAYED`.
- `commandId` is deterministic from the record; resubmission after a timeout reuses it (Canton dedup returns `DUPLICATE_COMMAND` with the original completion). A timeout is never a failure; the worker reconciles unknown outcomes from command completions.
- Committed success is shown only with an `updateId`. Committed-but-not-projected shows "The action is confirmed. This view is still synchronizing."

### 2.7 Projection worker

- Persistent Node process (never in Next request lifecycles). Reads `/v2/updates` per configured participant source with a durable checkpoint per source; applies events idempotently keyed by `(source, updateId, nodeId)`; stores contracts with their **witness parties** so the API can filter by the caller's party.
- Detects sandbox resets (participant id change or ledger end < checkpoint) and refuses to mix histories.
- Also runs command reconciliation and export jobs from durable PostgreSQL job rows (no separate queue).

### 2.8 Storage and documents

- **SeaweedFS 4.48** (`weed.exe mini`, native Windows binary) as the private S3-compatible store; MinIO community is archived (binary 410, images removed) — verified.
- Uploads go through the API (multipart, 20 MB cap, PDF/JPEG/PNG with magic-byte checks) into `quarantine/`; the API computes SHA-256, validates, then promotes to `evidence/`. Downloads are authorised against projected share/ownership state, then served via 60-second presigned URLs. Buckets are private.
- The synthetic-only MVP **does not virus-scan**; the UI and docs say so (`scanStatus = NOT_SCANNED`).

### 2.9 Web

- **Next 16.3.8 / React 19.3.0**, App Router, Turbopack. Marketing routes are Server Components; the workspace is dynamic, `Cache-Control: private, no-store`, with Client Components for interaction.
- **Tailwind 4.3.3** (CSS-first, `@theme inline`), **shadcn 4.21.0 on Base UI** (`@base-ui/react 1.8.0`); components are edited to Collara tokens. Two token scopes (`marketing`, `app`) with shared semantic names; contrast raised to WCAG AA where the prototype failed.
- **TanStack Query 5** (query keys prefixed by session scope; `queryClient.clear()` on logout/persona switch), **TanStack Table 9**, **React Hook Form 7 + Zod 4**, **lucide-react**, **date-fns 4**. Recharts/Motion only if a real metric/orientation need appears.
- Same-origin `/api` via a Route Handler proxy (`app/api/[...path]/route.ts`), not rewrites (build-time origin, 10 MB body cap).

### 2.10 Data

- **PostgreSQL 16**, **Drizzle ORM 0.45.3 / drizzle-kit 0.31.11**, `pg 8.23.1`. Versioned SQL migrations committed. Money as `numeric(18,2)` + ISO currency; `decimal.js` in TS; decimal strings on the wire; Daml `Numeric 2`.
- Tests use **PGlite 0.5.8** for hermetic repository/API tests; integration runs against real PostgreSQL.

## 3. Pinned versions (summary — exact pins live in `pnpm-workspace.yaml` catalog and `pnpm-lock.yaml`)

| Area | Pin |
|---|---|
| Node / pnpm | Node 24 LTS (`>=24.15.0 <25`; 24.21.0 recommended), pnpm 11.28.2 (`packageManager`) |
| Web | next 16.3.8, react 19.3.0, typescript 6.0.3, tailwindcss 4.3.3, shadcn 4.21.0 (Base UI), @base-ui/react 1.8.0, lucide-react 1.49.0 |
| Client data | @tanstack/react-query 5.104.0, @tanstack/react-table 9.2.4, react-hook-form 7.89.0, @hookform/resolvers 5.9.1, zod 4.6.5, date-fns 4.4.0, decimal.js 10.6.0 |
| API | fastify 5.12.5, fastify-type-provider-zod 7.0.0, @fastify/{cookie 11.1.2, session 11.1.3, swagger 9.9.1, swagger-ui 6.1.1, multipart 10.1.2, helmet 13.1.1, rate-limit 11.2.0}, pino 10.3.1, openid-client 6.8.8, jose 6.2.12 |
| Data/storage | drizzle-orm 0.45.3, drizzle-kit 0.31.11, pg 8.23.1, @electric-sql/pglite 0.5.8, @aws-sdk/client-s3 3.1143.0 |
| Ledger client | openapi-fetch 0.17.0, openapi-typescript 7.13.0 |
| Tests/lint | vitest 5.0.3, vite 8.3.1, jsdom 30.1.1, @testing-library/react 16.3.3, @playwright/test 1.63.0, eslint 9.39.5 (+ eslint-config-next 16.3.8, typescript-eslint 8.71.0), tsx 4.23.15 |
| Daml/Canton | dpm 1.0.22, Daml SDK 3.5.12, Canton 3.5.19 OSS, LF 2.2 |
| Governance | DLC-link decentralization-manager v1.12.0 (commit `4d650edb…`): `governance-action-v1-0.1.0.dar`, `governance-core-v1-0.1.0.dar` vendored with SHA-256 |
| Local infra | PostgreSQL 16 (WSL 16.14 here; compose `postgres:16.15-alpine`), SeaweedFS 4.48, Keycloak 26.7.5, Java 21 (Temurin 21.0.12.1) |

Known trade-offs: ESLint 9 is EOL (ESLint 10 breaks eslint-config-next); TS 7 is skipped (no JS API, typescript-eslint caps at <6.1); Node 24 enters maintenance on 2026-10-20 — schedule one upgrade window after the MVP.

## 4. Consequences

- The UI can be built and demonstrated before the backend exists (UI_MOCK), while LOCALNET exercises the real path. Both share `@collara/domain` presenters and policy, so permission semantics cannot silently diverge.
- The ledger, not PostgreSQL, is authoritative for attestations, consent, proposals/acceptance, control, lock and release. Editing a projection never changes ledger truth.
- The local topology is not proof of independent operators. Single-participant mode is not a privacy boundary between organisations; privacy claims are tested in 3-participant mode.
- Docker Compose files are provided for other machines and marked **untested on the authoring machine** until someone runs them.
