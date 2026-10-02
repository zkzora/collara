# Collara build progress

Living status file so work can resume across sessions. Update it at the end of every stage.

## Stage status (master brief §10)

| # | Stage | Status | Notes |
|---|---|---|---|
| 1 | Audit, sources of truth, permissions, compatibility, migration plan | Done (2026-10-02) | `docs/_research/*`, ADR-0001, migration map |
| 2 | Frontend migration (Next.js, UI_MOCK walkthrough, typecheck, build) | Done (2026-10-02/03) | Public site, `/login`, full workspace in UI_MOCK and LOCALNET; Create Case (`/app/cases/new`); Overview per-currency figures; form-control borders ≥ 3:1. Open: copy approval (strings marked INFERRED), BPD-1 legal text, landing FAQ/`/demo` copy still says "planned" (approved copy — needs sign-off to change). |
| 3 | Daml state model + invariant tests; typed Canton adapter; LocalNet submission + visibility | Done on one participant | 60 Daml Script tests; all workflows submitted on Canton 3.5.19 through the adapter; contention proven live. Open: witness-level privacy on 3 participants. |
| 4 | API services, private evidence, DB migrations, command records, projections | Done (2026-10-03) | All `API_ENDPOINTS` routes + directory/overview; projection worker; migrations 0000–0002; private evidence on SeaweedFS; verifier evidence grants; off-ledger note store; database errors logged without parameters. |
| 5 | Core journey wired to LocalNet; authz failures, concurrency, retry, scoped exports verified | Done on one participant (2026-10-03) | Full LOCALNET IT with S3: 12 files, 71/71 (journey, adversarial 44 routes, concurrency 5 rounds, verifier evidence, notes, create case from clean-start, governance). Open: 3-participant witness privacy; LOCALNET browser walkthrough from clean-start. |
| 6 | BitSafe governance (DM) | Tier A done; Tier B not attempted | DM v1.12.0 GovernanceRules 2-of-3 on one participant (10/10 live tests). Governance party is an ordinary local party. |
| 7 | Setup scripts, CI, health checks, deployment config, docs | CI fixed, green run not yet confirmed | First GitHub run failed in setup-node@v5 (pnpm cache); fixed in bf5e131 (not pushed yet). Dockerfiles/compose untested (no Docker). Docs refreshed to current evidence (f8bf519). |

## Verification (2026-10-03, combined tree before commits 16e9b43…b0428c5)

| Command | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | Pass |
| `pnpm test` (packages one at a time, `--maxWorkers=2`) | 363 pass: canton 50, domain 67, api-client 32, db 56, web 47, api 104, worker 7 (+ log-safety tests added after: db 4, api 12 in its file) |
| `LOCALNET_IT=1 … vitest run --config vitest.localnet.config.ts` (Canton 3.5.19 sandbox, 1 participant, S3 storage) | 12 files, 71/71, 496 s |
| Playwright UI_MOCK (reported by builders, separate output dirs) | 70 passed, 14 skipped (viewport guards); marketing 35/35 incl. new docs status test |
| `actionlint` on both workflows | Pass |

## Known gaps

- **Privacy across participants is unproven.** Every LocalNet check ran on one participant, whose operator sees every transaction.
- **Tier B governance** (DM nodes, decentralized governance party) not attempted; Tier A's governance party credential could act without the seat quorum.
- **Trust boundaries (documented):** attestation revocation is an API precheck before `Control_Activate`, not atomic ledger enforcement; the registrar holds issuance, config and mirror authority; analyst/approver mandates are off-ledger.
- **Not verified:** Docker/compose, Keycloak OIDC through a browser, Secure cookies over HTTPS, JWKS ledger auth for a real participant, ledger persistence across sandbox restarts (in-memory), a green CI run, LOCALNET browser run of the new Create Case / notes / verifier-grant screens.
- **Product gaps:** no web UI for the dealer's verification consent (API route only); only one verifier org in the demo ("a different verifier is refused" is unit-tested only); no retention policy for notes; decision/information-request text on `LenderDecisionNotice.sharedFeedback` is still on-ledger text (changing it needs a Daml change).
- **Copy/legal:** INFERRED strings need approval; BPD-1 (privacy, terms, consent, retention) blocks any public URL that collects personal data.

## Next steps

1. Push `bf5e131…` to GitHub (with the user's go-ahead) and confirm CI is green; fix what the first real run reveals.
2. Three-participant witness privacy: map orgs to participants (Lender B on its own participant), run seed + walkthrough, assert per-party `LEDGER_EFFECTS` streams carry no terms to verifier/dealer/registrar/Lender B and only granted scope to the auditor; record topology and results.
3. LOCALNET browser walkthrough from clean-start (register → evidence → selected-document verification → attestation → create case → share → review → … → export).
4. Tier B DM spike (WSL: Canton OSS 3-participant + DM nodes, decentralized party), time-boxed; record exact blockers if it fails.
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
