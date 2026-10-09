// Verification evidence behind the public status statements: /docs (status card, capability table) and the
// README. One typed source, so the site and the repository documents cannot drift apart. Change a value only
// after the run it describes, and keep `record` pointing at where that run is written down. Facts only: what was
// run, where and when. Nothing here is a production-readiness or security claim.

// Dates are ISO (YYYY-MM-DD), local to the authoring machine; `record` names where each run is written down.
export const EVIDENCE = {
  unitTests: {
    // Every package's Vitest suite in one run. Source: the "Typecheck, lint, unit tests, build" job of CI run
    // 37108297524 on 4eff547 (2026-10-03). api also skips 4 opt-in PostgreSQL concurrency tests.
    total: 410,
    byPackage: { canton: 50, domain: 72, "api-client": 32, db: 66, web: 55, api: 128, worker: 7 },
    commit: "4eff547",
    date: "2026-10-03",
    record: "GitHub Actions CI run 37108297524",
  },
  ci: {
    // GitHub Actions workflow `CI` on main (.github/workflows/ci.yml). The LocalNet IT workflow is manual and has
    // never run on GitHub.
    passed: true,
    runId: "37108297524",
    commit: "4eff547",
    date: "2026-10-03",
    jobs: ["Typecheck, lint, unit tests, build", "Playwright e2e (UI_MOCK)", "Daml build and tests (SDK 3.5.12)"],
    playwrightUiMock: { passed: 79, skipped: 47 },
    record: "GitHub Actions run 37108297524",
  },
  damlTests: {
    // collara-contracts 0.2.0 (activation depends on a live disclosure; 8 revocation tests added).
    passed: 68,
    total: 68,
    scripts: 4,
    date: "2026-10-03",
    record: "CI run 37108297524 (Daml job); docs/verification.md",
  },
  localnetIntegration: {
    // Through the API against a Canton 3.5.19 `dpm sandbox` with one participant (not Splice LocalNet), S3 storage.
    passed: 71,
    total: 71,
    files: 12,
    adversarialRoutes: 44,
    participants: 1,
    date: "2026-10-03",
    // That full run predates collara-contracts 0.2.0. After 0.2.0 the activation suites (pledge, concurrency) pass
    // 10/10; the full suite ran only with in-memory evidence storage (68/73: the 5 failures need S3-backed
    // download links) because the authoring machine lacked disk space for SeaweedFS. Not yet re-run with S3.
    afterContracts020: { activationSuites: { passed: 10, total: 10 }, fullSuiteWithS3: false },
    record: "docs/verification.md",
  },
  cleanStartBrowser: {
    // e2e/localnet-clean-start.spec.ts, desktop project, LOCALNET from a clean-start seed.
    passed: 14,
    total: 14,
    steps: 46,
    date: "2026-10-03",
    record: "docs/verification.md",
  },
  privacy: {
    // Witness-level privacy on five participants of one sandbox: one machine, one JVM, one operator. It shows what
    // each participant's ledger holds, not isolation between independent operators.
    participants: 5,
    // Re-run with collara-contracts 0.2.0, including the owner and verifier revocation races (now rejected).
    tests: { passed: 8, total: 8 },
    checks: { passed: 87, total: 87 },
    runs: 2,
    operators: 1,
    date: "2026-10-03",
    record: "docs/privacy-verification.md",
  },
  // Governance of the verifier registry, one record per tier and network. Kept apart so that no statement built
  // from it can read as "decentralized governance on DevNet": Tier A is DM GovernanceRules with an ordinary
  // governance party; Tier B adds Decentralization Manager nodes and a decentralized party. Only tierA.localnet is
  // used by the app today.
  governance: {
    tierA: {
      localnet: {
        // DM v1.12.0 GovernanceRules, 2-of-3 seats, on the Canton 3.5.19 sandbox with one participant. The governance
        // party is an ordinary local party: its credential could act without the seat quorum. Used by the API and UI.
        status: "implemented on the local sandbox",
        run: true,
        // apps/api/test/localnet/governance.it.test.ts, part of the 71/71 LocalNet run (before contracts 0.2.0).
        integrationTests: { passed: 10, total: 10 },
        participants: 1,
        operators: 1,
        threshold: { required: 2, of: 3 },
        decentralizedParty: false,
        integratedInApp: true,
        date: "2026-10-03",
        record: "docs/governance.md",
      },
      devnet: {
        // Run on the shared NODERS participant on 2026-10-05: the bootstrap created the same Tier A GovernanceRules and
        // the governed verifier registry (B2–B6: propose, two confirmations, execute), as ordinary parties of one
        // tenant ledger user. Not decentralized: one credential controls every party.
        status: "ran once on DevNet (2026-10-05) as ordinary parties of one tenant user; not decentralized",
        run: true,
        participants: 1,
        decentralizedParty: false,
        firstGovernedExecuteUpdateId: "12209cb8f4bd725becd551b47b9688954e44d4c080a27cb9b4ef5f7fc09815e2ec13",
        date: "2026-10-05",
        record: "docs/devnet-evidence.md",
      },
    },
    tierB: {
      localnet: {
        // Decentralization Manager v1.12.0 nodes and a decentralized governance party, run by scripts (scripts/tierb)
        // on a separate three-participant Canton OSS 3.5.19 topology in WSL. One operator runs every node. The run
        // used collara-contracts 0.1.0 (package 66efe1ca…); it was not re-run with 0.2.0.
        status: "scripted on a separate local topology, one operator, not in the app",
        run: true,
        scriptedChecks: { passed: 10, total: 10 },
        nodes: 3,
        participants: 3,
        operators: 1,
        independentOperators: false,
        threshold: { required: 2, of: 3 },
        decentralizedParty: true,
        integratedInApp: false,
        collaraContractsVersion: "0.1.0",
        rerunWithContracts020: false,
        date: "2026-10-03",
        record: "docs/governance-tier-b.md",
      },
      devnet: {
        // Not attempted. The shared HackCanton DevNet participant (NODERS) is not set up to host teams'
        // Decentralized Parties (BitSafe challenge rules, read 2026-10-04); it would need our own node.
        status: "not attempted: the shared DevNet participant cannot host Decentralized Parties",
        run: false,
        attempted: false,
        date: "2026-10-04",
        record: "docs/hackcanton-submission.md",
      },
    },
  },
  deployment: {
    // Only the web app, in UI_MOCK mode. No API, worker, database, document storage or ledger is deployed.
    web: { mode: "UI_MOCK", host: "Vercel", url: "https://collara-coral.vercel.app", date: "2026-10-03" },
    localnetHosted: false,
    cantonNetwork: false,
    record: "docs/PROGRESS.md (Stage 7)",
  },
  devnet: {
    // DEVNET mode against the HackCanton shared DevNet participant (NODERS). One full synthetic run on 2026-10-05
    // (Canton 3.5.19): bootstrap, fixture CL-001 and the financing workflow through pledge activation and release,
    // 43 recorded commands. One tenant ledger user holds every party, so this is not isolation between operators.
    // The public site is not connected to it (UI mockup only). See docs/devnet-evidence.md.
    status: "one full synthetic run on the shared participant (2026-10-05); the public site is not connected to it",
    run: true,
    // The participant's version when the run was recorded.
    cantonVersion: "3.5.19",
    // On 2026-10-04 the participant's /docs/openapi matched the committed 3.5.19 spec byte for byte.
    openApiIdentical: true,
    firstCommittedUpdateId: "12205dd84f8eeb9f960bfdd9ee834335b3bce8a12ca36dbe8b9a4a84245eadadbba9",
    // Re-read on 2026-10-09 from the participant's own update stream, after NODERS upgraded the node to Canton 3.6.1
    // (docs/devnet/evidence/receipts-r202610050410.json). Existing data survived the upgrade.
    receiptsVerified: { passed: 43, total: 43, date: "2026-10-09", cantonVersion: "3.6.1" },
    // Compatibility with 3.6.1 (observed 2026-10-09): the API differences for the endpoints Collara uses are added
    // fields only; bootstrap and asset registration committed on 3.6.1. The remaining workflow was NOT re-run there
    // (the fixture ids collide with the 5 October run on the same parties), and the CLI pin to 3.5.19 is unchanged.
    canton361: { observed: "2026-10-09", newTransactions: "bootstrap (B1–B8) and asset registration (M1–M4) committed", fullWorkflowRerun: false },
    // Governance on DevNet is Tier A only (see governance.tierA.devnet / governance.tierB.devnet).
    governanceTier: "A",
    date: "2026-10-05",
    record: "docs/devnet-evidence.md",
  },
} as const;

/** "71/71" */
export function passCount(run: { readonly passed: number; readonly total: number }): string {
  return `${run.passed}/${run.total}`;
}
