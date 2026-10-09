# Project page text (HackCanton Season 3, RWA & Business Workflows)

Draft for the platform's project page, 2026-10-04. Strings in backticks are approved copy from `docs/_research/spec-content.md` and are used verbatim. **Every other sentence on this page is INFERRED copy, pending the team's approval.** Status facts come from [`packages/domain/src/evidence.ts`](../../packages/domain/src/evidence.ts); if a fact changes there, change it here too. Check every link in a private browser window before submitting ([checklist.md](checklist.md)).

---

## Name

Collara

## Track

Real-World Assets (RWA) & Business Workflows (owner confirms on the platform).

## One-liner

`Equipment evidence and pledge workflows, coordinated privately.`

## Short description

`Bring used CNC equipment evidence, verification, and lender review into one coordinated workflow. Share the relevant records with selected counterparties and track who can authorize each pledge and release.`

Collara is a Daml workflow on Canton for borrowers, dealers, verifiers, lenders and auditors. It runs today as a local demo with synthetic data only.

## Problem

`The documents are digital. The coordination can still be fragmented.`

`Equipment financing can involve borrower records, dealer documents, inspection reports, and lender systems. When these records are reviewed separately, teams may need repeated follow-ups to confirm which evidence is current and who is responsible for the next step.`

The first segment is equipment-finance lenders that finance used CNC machinery and work with outside dealers or inspectors. The daily users are credit analysts and documentation officers. This segment comes from desk research (`docs/_research/spec-content.md` §d.1). No lender has been interviewed yet (see "What is not done").

## Solution

`Collara connects an equipment passport with its supporting evidence, verification scope, lender decision, and collateral workflow. Each participant works with the records and actions relevant to their role.`

The demo case, CL-001, goes through these steps:

1. The borrower registers an asset passport and adds evidence documents.
2. An independent verifier accepts the assignment and issues a scoped attestation.
3. The borrower shares the evidence package with one selected lender.
4. The lender's analyst reviews the case, and the approver records eligibility and issues a financing proposal.
5. The borrower accepts that exact proposal version and authorizes activation.
6. The lender activates the pledge. This consumes the asset's single control token, so a second active Collara lock on the same registered asset cannot exist.
7. The borrower requests release, and only the designated lender can authorize it.
8. Each record owner grants an auditor access, and the auditor exports a permission-scoped case report.

`A Collara record is not a legal lien registration, proof of title, or verification of pledges outside Collara.` No money moves: `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.`

## How Canton is used

- **Daml contracts enforce the invariants.** They include a single consuming `AssetControl` token per registered asset, release controlled only by the lender, version-pinned proposal acceptance, and an activation that checks a live, owner-signed disclosure-validity marker so that a revoked attestation cannot back it. `collara-contracts` 0.2.0 has 68 Daml Script tests (invariants, attacks, privacy, revocation).
- **Party-based privacy.** Financing terms live only in contracts between the borrower and the lender. Verifiers, dealers and the unrelated Lender B never become stakeholders. Witness-level privacy was checked on five participants of one sandbox (8/8 tests, 87/87 checks, two runs). All five participants ran on one machine under one operator, so this run does not show isolation between independent operators.
- **Typed JSON Ledger API v2 client.** The API submits as exactly the acting organisation's party, derived server-side from the session, membership, mandate and party binding. A projection worker reads committed updates, and the UI shows `Confirmed on the ledger.` only when the ledger returned an update id.
- **Decentralization Manager governance** of the verifier registry (add or suspend a verifier). Governance never touches collateral. There are two tiers, kept separate:
  - *Tier A*: DM v1.12.0 `GovernanceRules` with 2-of-3 seats, implemented in the app on one local participant. The governance party is ordinary, not decentralized.
  - *Tier B*: three DM nodes and a decentralized governance party on a local three-participant Canton in WSL, 10/10 scripted checks. Every node is run by one operator, and Tier B is not wired into the app. It ran with `collara-contracts` 0.1.0 and has not been re-run with 0.2.0.
  - On DevNet, Tier A ran once (ordinary parties of one tenant user, not decentralized); Tier B did not run there.

## What is real, what is a mockup, what is not done

| | Status (2026-10-09) |
|---|---|
| Public web demo | **UI mockup** on Vercel: <https://collara-coral.vercel.app>. Synthetic data, simulated in the browser, no ledger transaction. Banner `Synthetic demo data — UI mockup.` |
| LocalNet demo | **Real ledger commands** against a Canton 3.5.19 `dpm sandbox` with one participant (not Splice LocalNet), with an API, a worker, PostgreSQL and S3 storage. **Runs only on the authoring machine.** LocalNet integration tests 71/71 before contracts 0.2.0. After 0.2.0, the activation suites pass 10/10, and the full suite with S3 storage has not been re-run. Browser walkthrough from a clean start: 14/14. |
| Tests and CI | 410 unit tests; GitHub Actions CI green (run 37108297524): typecheck, lint, unit tests, build, Playwright UI-mockup e2e, Daml build and tests. |
| Canton DevNet | **One full synthetic run on the shared HackCanton participant on 2026-10-05** (Canton 3.5.19): bootstrap, fixture CL-001 and the financing workflow through pledge activation and release, 43 command records / 39 ledger updates, all committed with real update ids. The pledge is released and the case closed; Demo Lender B's own ledger view holds none of the case contracts. On 2026-10-09 the node reported Canton 3.6.1: the recorded run was re-verified (43/43 receipts) and bootstrap and asset registration committed on 3.6.1, but the **workflow was not re-run on 3.6.1**. One tenant credential acts for every party (not isolation between operators), and the public site is **not connected** to DevNet. Governance there is Tier A only. Evidence: `docs/devnet-evidence.md`. |
| Governance Tier B | Scripted locally, one operator, not in the app; not attempted on DevNet, because the shared DevNet participant cannot host Decentralized Parties. |
| Not done | Tier B in the app; the workflow re-run on DevNet 3.6.1; a DevNet sign-in for reviewers; a hosted LocalNet or DevNet stack; Docker/Compose (written, never run); legal pages (privacy, terms) and approval of copy marked INFERRED; independent node operators; **user validation (no interviews, no measured metrics)**. |

Collara is not production-ready and makes no security claims. It is not a lender, custodian or lien registry, and it does not detect pledges made outside Collara.

## Links

| Link | Status |
|---|---|
| Repository: `https://github.com/zkzora/collara` | **Private today.** The rules require a public repository; making it public is the owner's decision ([checklist.md](checklist.md)). Replace this link with the public repository's URL; the existing repository's history contains a third-party capture, so publish a clean copy ([`docs/publication.md`](../publication.md)). |
| Demo (UI mockup): <https://collara-coral.vercel.app> | Public. |
| Documentation: <https://collara-coral.vercel.app/docs> | Public. The repository documents are [`README.md`](../../README.md), [`docs/verification.md`](../verification.md) and [`docs/limitations.md`](../limitations.md). |
| Video | Not recorded yet ([demo-script.md](demo-script.md)). |
| Pitch | Outline only ([pitch.md](pitch.md)). |

## Tech stack (only what is used)

Canton 3.5.19 (`dpm sandbox`; Canton open-source 3.5.19 for Tier B), Daml SDK 3.5.12, JSON Ledger API v2, DLC-link Decentralization Manager v1.12.0, TypeScript, Next.js 16, Fastify 5, Zod, Drizzle with PostgreSQL 16, SeaweedFS (S3), Keycloak (OIDC; not tested through a browser), Vitest, Playwright, GitHub Actions, Vercel. Docker Compose files exist but have never been run, so do not list Docker as used.

## AI assistance

See [ai-disclosure.md](ai-disclosure.md).
