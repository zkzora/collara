# Collara build progress

Living status file so work can resume across sessions. Update it at the end of every stage.

## Stage status (master brief §10)

| # | Stage | Status | Notes |
|---|---|---|---|
| 1 | Audit, sources of truth, permissions, compatibility, migration plan | Done (2026-10-02) | `docs/_research/*`, ADR-0001, migration map |
| 2 | Frontend migration (Next.js, UI_MOCK walkthrough, typecheck, build) | In progress | |
| 3 | Daml state model + invariant tests; typed Canton adapter; LocalNet submission + visibility | In progress | |
| 4 | API services, private evidence, DB migrations, command records, projections | Not started | |
| 5 | Core journey wired to LocalNet; authz failures, concurrency, retry, scoped exports verified | Not started | |
| 6 | BitSafe governance (DM) | Not started | Tier A (DM DARs on sandbox) verified in a spike; Tier B (real DM nodes in WSL) time-boxed |
| 7 | Setup scripts, CI, health checks, deployment config, docs | Not started | |

## Environment facts (authoring machine)

- Windows 11, Node 24.16.0, pnpm 11.13.0, Java 21, Python 3.12, git. No Docker.
- dpm 1.0.22 / Daml SDK 3.5.12 / Canton 3.5.19 installed at `%APPDATA%\dpm` (not on PATH).
- WSL2 Ubuntu 24.04 with PostgreSQL 16.14: role `collara` / `collara_dev`, DBs `collara`, `collara_test` (created 2026-10-01). Reachable from Windows on 127.0.0.1:5432 only while WSL is running.
- DM v1.12.0 cloned at `.vendor/decentralization-manager` (gitignored). Research spikes in `.spike/` (gitignored).

## Open product questions (defaults in use — see synthesis §2.1)

- BPD-1: privacy notice, terms, pilot consent text, retention period, notification inbox — **blocking for publication only**; pages say "pending legal review".
- Q-01…Q-11 defaults as listed in `docs/_research/synthesis.md` §2.1.

## Log

- 2026-10-01/02 — Repository audited; research + synthesis written; git initialised with prototype baseline; ADR-0001 and migration map written.
