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
  tierB: {
    // Decentralization Manager v1.12.0 nodes and a decentralized governance party, run by scripts (scripts/tierb)
    // on a separate three-participant topology in WSL. The Collara API and UI still use Tier A.
    scriptedChecks: { passed: 10, total: 10 },
    nodes: 3,
    operators: 1,
    integratedInApp: false,
    date: "2026-10-03",
    record: "docs/governance-tier-b.md",
  },
  deployment: {
    // Only the web app, in UI_MOCK mode. No API, worker, database, document storage or ledger is deployed.
    web: { mode: "UI_MOCK", host: "Vercel", url: "https://collara-coral.vercel.app", date: "2026-10-03" },
    localnetHosted: false,
    cantonNetwork: false,
    record: "docs/PROGRESS.md (Stage 7)",
  },
  devnet: {
    // DEVNET mode against the HackCanton shared DevNet participant (NODERS, Canton 3.5.19). The code, scripts and
    // owner checklist exist; nothing has been uploaded, allocated or submitted there yet. Fill in only from a real
    // run recorded in docs/devnet-evidence.md.
    status: "code ready; not yet run on DevNet",
    run: false,
    cantonVersion: "3.5.19",
    // The participant's /docs/openapi matched the committed spec byte for byte (unauthenticated GET).
    openApiIdentical: true,
    firstCommittedUpdateId: null,
    date: "2026-10-04",
    record: "docs/devnet-evidence.md",
  },
} as const;

/** "71/71" */
export function passCount(run: { readonly passed: number; readonly total: number }): string {
  return `${run.passed}/${run.total}`;
}
