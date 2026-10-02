# Collara — engineering conventions

Private equipment-collateral coordination workflow (used CNC machinery) for borrowers, dealers, verifiers, lenders and auditors on Canton. MVP = reproducible local Canton demo with synthetic data.

Read first: `docs/architecture/ADR-0001-architecture-and-versions.md`, `docs/architecture/migration-map.md`, `docs/PROGRESS.md`. Deep references (source of truth for copy, routes, states, design tokens): `docs/_research/synthesis.md` (reconciled requirements — wins over the other notes), `spec-system.md`, `spec-content.md`, `proto-dashboard.md`, `proto-landing-docs.md`, `research-canton.md`, `research-dm.md`, `research-webstack.md`.

## Hard rules

- **Never modify `Collara Website/`** (original prototype, preserved). Copy assets out of it instead.
- **Approved copy is verbatim.** Strings in backticks in the spec notes are approved copy; do not reword them. Do not invent legal/policy text, customer names, metrics, certifications or claims.
- Mode banners exactly: `Synthetic demo data — UI mockup.` (UI_MOCK) and `Synthetic demo data — Canton LocalNet.` (LOCALNET). UI_MOCK must never display `Confirmed on the ledger.`. LOCALNET must never fall back to simulated success.
- Invariants are enforced in Daml and the API, never by a DB flag (`isPledged`), a frontend button state, or contract keys (Daml 3.x keys are not unique). See ADR §2.3.
- Authority is derived server-side (session → membership → mandate → party binding). Never trust a party id, org or role sent by the browser. Omit unauthorized fields server-side; never send-and-hide.
- Money: decimal strings + explicit ISO currency end to end (`decimal.js`, `numeric(18,2)`, Daml `Numeric 2`). Valuation ≠ principal. Unavailable ≠ 0. Never sum across currencies.
- Synthetic fixtures only: case `CL-001`, asset `ASSET-DEMO-001`, `CNC machining center`, model `DEMO-CNC-500`, serial `SYNTH-CNC-001`; orgs Demo Manufacturer, Demo CNC Dealer, Demo Verifier, Demo Lender A (selected), Demo Lender B (unrelated), Demo Auditor; valuation USD 150,000.00; requested principal USD 100,000.00. Dates are relative to seed/now, never hard-coded future dates.
- Do not add dependencies casually. Versions are pinned in the `catalog:` of `pnpm-workspace.yaml` (pnpm 11, `minimumReleaseAge` applies). Packages reference `catalog:`. If a new dependency is truly needed, add it to the catalog with an exact version at least 24 h old and say why.
- Do not claim production readiness or security assurance. Report what was actually run.

## Layout and names

`apps/web` (@collara/web, Next 16), `apps/api` (@collara/api, Fastify 5), `apps/worker` (@collara/worker), `packages/domain` (@collara/domain), `packages/db` (@collara/db), `packages/canton` (@collara/canton), `packages/api-client` (@collara/api-client), `daml/collara` (Daml multi-package), `infra/`, `scripts/` (cross-shell `.mjs`), `docs/`.

Internal packages export TypeScript source (no build step); imports without file extensions (`moduleResolution: bundler`). TypeScript strict, no `any` without a comment explaining why, Zod for every external boundary. Match surrounding style; keep comments sparse and useful.

## Commands

- Install: `pnpm install` (root). Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Per package: `pnpm --filter @collara/web <script>`.
- Daml: SDK at `%APPDATA%\dpm` (not on PATH). PowerShell: `$env:Path = "$env:APPDATA\dpm\bin;$env:Path"; dpm build --all`. Git Bash: `export PATH="$APPDATA/dpm/bin:$PATH"; dpm.cmd build --all` (bash needs `dpm.cmd`). Set `JDK_JAVA_OPTIONS=-Xmx1g` for sandbox/test. Stop a sandbox with `taskkill /PID <pid> /T /F` (Git Bash: `taskkill //PID <pid> //T //F`).
- Windows shells: PowerShell 5.1 has no `&&`; Git Bash rewrites `/mnt/...` paths unless `MSYS_NO_PATHCONV=1`. Keep the repo path short (Daml package-database paths hit Windows MAX_PATH).
- PostgreSQL (dev, WSL Ubuntu 16.14): `postgres://collara:collara_dev@127.0.0.1:5432/collara` (test DB `collara_test`). WSL stops when idle; `pnpm db:up` (`scripts/dev/wsl-postgres.mjs up`) starts it with a keepalive. Unit tests use PGlite.

## Ports

web 3000 · api 4000 · worker health 4100 · Canton JSON API 7575 (extra participants 7576/7577; ledger 6865, admin 6866) · Keycloak 18080/19000 · SeaweedFS S3 8333 (master 9333, volume 9340, filer 8888) · PostgreSQL 5432.
