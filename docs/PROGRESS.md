# Collara build progress

Living status file so work can resume across sessions. Update it at the end of every stage.

## Stage status (master brief §10)

| # | Stage | Status | Notes |
|---|---|---|---|
| 1 | Audit, sources of truth, permissions, compatibility, migration plan | Done (2026-10-02) | `docs/_research/*`, ADR-0001, migration map |
| 2 | Frontend migration (Next.js, UI_MOCK walkthrough, typecheck, build) | Done (2026-10-02/03) | Public site, `/login`, full workspace in UI_MOCK and LOCALNET; Create Case (`/app/cases/new`); Overview per-currency figures; form-control borders ≥ 3:1. Open: copy approval (strings marked INFERRED), BPD-1 legal text, landing FAQ/`/demo` copy still says "planned" (approved copy — needs sign-off to change). |
| 3 | Daml state model + invariant tests; typed Canton adapter; LocalNet submission + visibility | Done (2026-10-03) | 60 Daml Script tests; all workflows on Canton 3.5.19 through the adapter; contention proven live; witness-level privacy on five participants (`docs/privacy-verification.md`: 7/7 tests, 80/80 checks, twice). |
| 4 | API services, private evidence, DB migrations, command records, projections | Done (2026-10-03) | All `API_ENDPOINTS` routes + directory/overview; projection worker; migrations 0000–0002; private evidence on SeaweedFS; verifier evidence grants; off-ledger note store; database errors logged without parameters. |
| 5 | Core journey wired to LocalNet; authz failures, concurrency, retry, scoped exports verified | Done on one participant (2026-10-03) | Full LOCALNET IT with S3: 12 files, 71/71 (journey, adversarial 44 routes, concurrency 5 rounds, verifier evidence, notes, create case from clean-start, governance). Browser: LocalNet walkthrough from clean-start 14/14 (46 steps), seeded walkthrough 2/2. |
| 6 | BitSafe governance (DM) | Tier A done (API/UI); Tier B verified by scripts, not wired into the API | Tier A: DM v1.12.0 GovernanceRules 2-of-3 on one participant (10/10 live tests); governance party is an ordinary local party. Tier B (2026-10-03): 3 × `dec-party-manager` v1.12.0 + Canton OSS 3.5.19 (3 participants) in WSL, DM-onboarded decentralized party, DARs + GovernanceRules through DM; Add/Suspend, one/duplicate/stale, attestation blocked, lock untouchable, one-vs-two member participants, namespace and signing-key thresholds all checked (`docs/governance-tier-b.md`, `docs/evidence/tierb-summary.json`). One operator runs every node. |
| 7 | Setup scripts, CI, health checks, deployment config, docs | Done for CI and the UI mockup deployment (2026-10-03) | CI green on GitHub (run 37102909305: checks, UI_MOCK e2e, Daml). Web app deployed to Vercel in UI_MOCK mode: https://collara-coral.vercel.app (project zkzoras-projects/collara, root apps/web, auto-deploy from main). Dockerfiles/compose untested (no Docker); LOCALNET is not hosted anywhere. |

## Verification (2026-10-03, combined tree before commits 16e9b43…b0428c5)

| Command | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | Pass |
| `pnpm test` (packages one at a time, `--maxWorkers=2`) | 363 pass: canton 50, domain 67, api-client 32, db 56, web 47, api 104, worker 7 (+ log-safety tests added after: db 4, api 12 in its file) |
| `LOCALNET_IT=1 … vitest run --config vitest.localnet.config.ts` (Canton 3.5.19 sandbox, 1 participant, S3 storage) | 12 files, 71/71, 496 s |
| Playwright UI_MOCK (reported by builders, separate output dirs) | 70 passed, 14 skipped (viewport guards); marketing 35/35 incl. new docs status test |
| `actionlint` on both workflows | Pass |

## Known gaps

- **Privacy is proven on five participants on one machine and one JVM run by one operator** — not independent infrastructure; sequencer/mediator metadata not examined (`docs/privacy-verification.md`).
- **Revocation race confirmed on the ledger:** an attestation revocation committed after the API precheck does not stop `Control_Activate` (documented, Daml unchanged).
- **Tier B governance runs only through `scripts/tierb/` on a separate WSL topology** (one operator); the API/UI still use Tier A, whose governance party credential could act without the seat quorum. Wiring Tier B into the API needs the whole Collara deployment on the Tier B synchronizer (accreditation fetches need the governance party's participants: 2 of 3 must be online). Canton's rejection of a 1-of-3 party signature set and Tier B expiry/deadline staleness were not exercised.
- **Trust boundaries (documented):** attestation revocation is an API precheck before `Control_Activate`, not atomic ledger enforcement; the registrar holds issuance, config and mirror authority; analyst/approver mandates are off-ledger.
- **Not verified:** Docker/compose, Keycloak OIDC through a browser, Secure cookies over HTTPS, JWKS ledger auth for a real participant, ledger persistence across sandbox restarts (in-memory), a green CI run, the clean-start browser spec on the mobile layout.
- **Product gaps:** no web UI for the dealer's consent to share its records with the lender or for verification (API route only); verification requests are asset-level only in the UI; only one verifier org in the demo ("a different verifier is refused" is unit-tested only); no retention policy for notes; decision/information-request text on `LenderDecisionNotice.sharedFeedback` is still on-ledger text (changing it needs a Daml change).
- **Copy/legal:** INFERRED strings need approval; BPD-1 (privacy, terms, consent, retention) blocks any public URL that collects personal data.

## Next steps

1. Decide whether to move LOCALNET onto the Tier B topology (Collara bootstrap on the WSL participants + a DM REST governance adapter) and accept the availability coupling (`docs/governance-tier-b.md` §5, §9).
2. Dealer consent UI; case-linked verification requests in the UI.
3. Close the revocation race in Daml (activation must see a live disclosure) if the trust note is not acceptable.
4. Host LOCALNET somewhere reachable (API, worker, PostgreSQL, storage, Canton participant) — needs a hosting decision.
5. JWKS/client-credentials ledger token provider for a real participant; copy approval; BPD-1.

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
- 2026-10-02 — Stage 4/5 finished with background subagents (ultracode off): commits 6d3536f (IT harness), 0a3e843 (worker + read model; export lease bug fixed), c9337d3 (all endpoints, governance, app-wide parse serializer). Full LOCALNET stack brought up for the user: sandbox + default seed (24 steps), worker 4100, API 4000, web 3000 (next start, LOCALNET, demo sessions). Running in parallel: LOCALNET polish + Playwright/adversarial tests (own prefix e2e, ports 3100/4200/4210); Stage 7 CI/deploy/docs.
- 2026-10-02 — Stage 7 committed (25265d0), demo-session production guard (ea4ebf2), LOCALNET polish + e2e + adversarial (bbd1548). Running demo restarted with the fixes (API 4000, worker 4100, web 3000). Environment issue: C: has ~3.2 GB free; SeaweedFS refuses writes below 1% free (~4.8 GB), so evidence uploads and export generation fail until the user frees disk space (reads, ledger workflow and governance work). Next: user frees disk → re-run full LOCALNET IT with S3; 3-participant witness privacy; Tier B DM spike (needs several GB RAM, run with the demo stopped); JWKS ledger auth for a real participant; BPD-1 legal text; copy approval.
- 2026-10-03 — Review of e41a83e addressed: CI setup-node fix + bounded test workers (bf5e131); status docs derived from evidence (f8bf519); DB note store + log-safe errors (16e9b43); shared contracts (9ba1bbd); verifier evidence grants (b8bea52); persisted notes (ba0a319); Create Case, overview figures, contrast (b0428c5). Full LOCALNET IT with S3 71/71. Shared infra (sandbox, WSL Postgres, SeaweedFS) was restarted by builders after the machine stopped them overnight.
- 2026-10-03 — Privacy on five participants (4467b41, 997f814; bootstrap and gateway routing bugs fixed); clean-start LocalNet browser walkthrough 14/14 with three fixes (c5ecb9a, f126857). Regression after each: LocalNet IT 71/71 with S3; unit tests green.
- 2026-10-03 — Governance Tier B in WSL (uncommitted at the time of writing): `scripts/tierb/` + `infra/tierb/` install Canton OSS 3.5.19 and DM v1.12.0 (digests verified), onboard a decentralized party across 3 participants with 3 DM nodes, distribute DARs, create GovernanceRules via DM `/contracts`, and run the governance scenario (10/10), namespace and signing-key threshold checks (`docs/governance-tier-b.md`, `docs/evidence/tierb-summary.json`). Final clean run exit 0. Finding: accreditation fetches need 2 of 3 governance participants online. API stays on Tier A. Regression after stopping Tier B: sandbox restored, typecheck + lint pass, domain 68 + web 49 unit tests, LocalNet IT 71/71 (425 s, S3).
- 2026-10-03 — Pushed 17 commits; CI green on GitHub (37102909305) after fixing setup-node caching and generated-docs drift (5c4fb52). Web deployed to Vercel (UI mockup) at https://collara-coral.vercel.app; repo connected for auto-deploy. Tier B scripted on WSL (6c2a89c, f7ddeba).
