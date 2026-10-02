# Verification record

What was actually run to check the LOCALNET build, with the observed results, and what has **not** been verified.
Synthetic data only. Nothing here is a production-readiness or security claim.

- Date: 2026-10-02, authoring machine (Windows 11, Node 24.16.0, pnpm 11.28.2, Canton 3.5.19 `dpm sandbox` with one
  participant, PostgreSQL 16.14 in WSL, SeaweedFS 4.48).
- Code: HEAD `5ca4faa` plus the uncommitted LOCALNET presentation and verification changes described in
  [LOCALNET presentation fixes](#localnet-presentation-fixes-in-this-change).
- Isolation: every LOCALNET check below ran next to a live demo without touching it. It used its own namespace,
  database and ports: bootstrap `--prefix`, database `collara_<prefix>` or `collara_it_<prefix>`, API 4200,
  worker 4210, web 3100/3103 from `NEXT_DIST_DIR=.next-e2e`. See [`setup.md`](setup.md#a-second-isolated-stack-next-to-the-demo).

## Results

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | Pass, 7 packages |
| Lint | `pnpm lint` | Pass, 0 problems |
| Unit tests | `pnpm test` | Pass, **285 tests**: canton 50, domain 60, api-client 22, db 36, worker 7, web 27, api 83 |
| Daml tests | `node daml/collara/check.mjs --skip-build` (dpm on `PATH`, `JDK_JAVA_OPTIONS=-Xmx1g`) | Pass: vendored DAR checksums ok; tests **60 ok / 0 failed**; scripts **4 ok / 0 failed**. The DARs were not rebuilt (no Daml change) |
| LocalNet integration tests, new adversarial sweep | `LOCALNET_IT=1 pnpm --filter @collara/api exec vitest run --config vitest.localnet.config.ts test/localnet/adversarial.it.test.ts` | Pass, **8/8** with S3 storage, and again 8/8 inside the full-suite run below. The first run found a bug (500 instead of 503 with the ledger down, fixed below) |
| LocalNet integration tests, full suite | `LOCALNET_IT=1 pnpm --filter @collara/api exec vitest run --config vitest.localnet.config.ts` | **55/57 pass with in-memory storage** (`COLLARA_S3_ENDPOINT=` for this run; 9 files, 302 s). The 2 failures are not LOCALNET failures: both assert on a real presigned `http(s)` URL, which in-memory storage cannot produce (`cases.it` "serves shared evidence…", `financing.it` "audit grants … download with checksum"). The run with S3 could not complete because SeaweedFS stopped accepting writes (see [Environment](#environment-issue-found-during-verification)) |
| Playwright, UI_MOCK | `next start` with `COLLARA_MODE=UI_MOCK` on 3103, then `PLAYWRIGHT_BASE_URL=http://localhost:3103 playwright test --workers=2` | Pass: **59 passed, 11 skipped** (2.8 min). 7 skips are the existing viewport guards; 4 are the two LOCALNET tests × two projects, skipped without `E2E_MODE=LOCALNET` |
| Playwright, LOCALNET walkthrough | `E2E_MODE=LOCALNET PLAYWRIGHT_BASE_URL=http://localhost:3100 playwright test e2e/localnet-walkthrough.spec.ts --project=desktop` on a fresh main seed (prefix `e2e2`) | Main journey **passed** (38.3 s). 10 steps through `/login` demo sessions. Each step waited for its projected result: on the 4 case-page actions, the case header's command status reached `PROJECTED` with `Confirmed on the ledger.`, an update id and an offset, and the UI_MOCK copy never appeared; the other steps waited for the projected record to appear. The steps: assessment saved, submitted for approval, ELIGIBLE, FP-001 issued, accepted (v1), activation authorized, pledge activated, release requested (lock still active), release authorized, 2 audit grants. Then the auditor export was downloaded through the presigned link, and the SHA-256 matched the checksum shown in the table |
| Playwright, LOCALNET negatives | same command with `-g negatives` | **Passed** (12.8 s): 5 Lender B direct URLs unavailable and no CL-001 in the list or counts; 7 verifier and 7 dealer pages without `100,000`, `100000` or `FP-001`. The first run failed on a URL in the spec (`/app/proposals/FP-001` is not a page), which was corrected before this run |
| Browser sweep | 9 personas × 33 workspace pages: before the fixes, after them, and after the walkthrough (case closed) | 891 page visits; screenshots and page text in `.local/screens/localnet-e2e/{before,after,advanced}` (git-ignored) |

The two LOCALNET Playwright tests passed in two invocations on the same fresh world: the walkthrough first, then
the corrected negatives test. A final single run of both on a new seed was not possible (the walkthrough ends
with an export written to SeaweedFS, which by then refused writes).

### What the adversarial sweep checks (`apps/api/test/localnet/adversarial.it.test.ts`)

It covers every route of `API_ENDPOINTS` (`packages/api-client/src/client.ts`) that takes an id: **44 routes**
(15 reads, 29 mutations). CL-001's real ids come from a fresh main seed driven through the API to an open
release request: `DOC-001`, `VR-001`, `ATT-001`, `CA-001`, `FP-001`, `PL-001`, `RR-001`, `AG-001`, `RPT-0001`,
`GP-001` and a command id. The test fails if the route table gains an id route that it does not list.

| Assertion | Count |
|---|---|
| The legitimate actor reads every record (the ids are real) | 15 reads, 200 |
| Anonymous → 401 (real and unknown id, valid body and `Idempotency-Key`) | 88 / 88 |
| Unrelated organisation → 404 body byte-identical (except the request id) to an unknown id of the same shape. Demo Lender B for case records; the dealer (no governance seat) for governance proposals. No command record created | 44 / 44 |
| Browser-supplied `x-collara-org/party/act-as/role/user`, body `orgId/party/actAs/readAs/lender/userId/role` and query `orgId/party/actAs` leave the outcome unchanged; no command record created. A spoofed header on the approver's own `GET /cases/CL-001` returns its own view; a spoofing verifier still gets 404 on FP-001 | 44 / 44 identical |
| Mutation without `Idempotency-Key` → 400 `validation_error`, nothing recorded | 29 / 29 |
| Ledger down (a second app whose gateway points at `127.0.0.1:7599`) | 0 successes. 9 ledger mutations answered **503 `ledger_unavailable`** with the approved copy and a **FAILED** command (`cases.requestVerification`, `assets.requestVerification`, `releaseRequests.decide/requestInformation/withdraw`, `accessGrants.revoke`, `governance.confirm/execute/cancel`). 18 were refused from the projections before any ledger call (409). Ledger ACS unchanged; reads still served from the projections |
| Same key, different payload → 409 | 19 routes with a payload: 409. 4 were `idempotency_conflict`, where a command record already existed (one after a committed first call). 15 were `state_conflict`, refused before any record. The 10 routes without a payload replay the stored outcome with the same command |

## LOCALNET presentation fixes in this change

Found by the browser sweep. Each one is covered by tests.

- **Equipment identity for case participants.** The `AssetPassport` is owner-only on the ledger, so the selected
  lender saw an empty class and model (`· · ASSET-DEMO-001`). A deliberate, application-level disclosure now copies
  only class, manufacturer, model, year and serial from the owner's projected passport. It applies when the viewer
  holds an active entitling contract: the selected lender (share recipient, `sharedLender`, lock lender), the invited
  dealer and the assigned verifier (synthesis §1.4.1). Never for Lender B, auditors without the owner's grant, or
  operators. See `packages/db/src/read-model/disclosure.ts` and its README section.
- **No stray separators.** A missing value never renders as `·` or `, `: `joinParts`/`withSeparator` in the web,
  `equipmentSummary()` in the presenters, and no record-id separator before an empty title.
- **Verification status from the lender's disclosure.** The selected lender's Verification tile and list column read
  `Attestation issued · valid to …` from its `AttestationDisclosure` (ATT-001). Previously they showed `—`. It never
  sees the owner↔verifier request.
- **Business role first.** The banner, sidebar and dialogs read `Demo Lender A · Lender Approver` for Morgan Hale,
  not `Governance Member`. The API orders roles; the web uses the primary role. The persona select uses the short
  UI_MOCK labels (`Morgan Hale · Approver`) with the full label as a tooltip; the login list uses the same labels
  as UI_MOCK.
- **Partial views.** A dealer or verifier sees only its slice of the evidence package. It no longer gets a derived
  `Evidence collection` stage, an `Add evidence` call to action, `Incomplete`, `v0 · 0 documents` or
  `0 documents`. These now show `—`, or are left out. The same presenters serve UI_MOCK, so there the dealer's and the
  verifier's package figures (evidence tile, package reference, the passport's evidence row) now also show `—`;
  nothing else changes in UI_MOCK.
- **Timeline wording.** A release request event reads `external loan completion`, not the ledger code.
- **503, never 500, with the ledger down.** A ledger read outside a command's `prepare` (registry lookup in a
  sequence, route-level reads) is now 503 `ledger_unavailable`. A sequence or `prepare` that cannot reach the
  participant records the command FAILED, and a retry with the same key prepares again.

## Environment issue found during verification

From about 11:31 local time, **SeaweedFS refused every write** (`failed to find writable volumes`; a test
`PutObject` returned `InternalError`). The cause is that drive C: is almost full: 3.8 GB, later 2.3 GB, free of
476 GB. The Windows page file grew under memory pressure. SeaweedFS stops allocating volumes when free space is
below its minimum (about 1 % of the disk). The live demo shares this SeaweedFS: **evidence uploads and auditor
export generation fail until space is freed.** Reads, the ledger and the database were unaffected when checked.

## Not verified

- **Witness-level privacy on 3 participants.** Only the 1-participant sandbox was used. The read model filters by
  stakeholder, and the equipment disclosure is an application-level read. Neither proves ledger-level isolation.
- **Tier B governance.** Real Decentralization Manager nodes were not attempted. Governance is Tier A on one
  participant.
- **Docker Compose and the Dockerfiles.** Never run (no Docker on the authoring machine).
- **Keycloak OIDC through the browser.** Every browser check used demo sessions (`POST /api/demo/sessions`).
- **Secure cookies over HTTPS** (`COOKIE_SECURE=true`, `__Host-` cookie behind TLS). Only plain-HTTP local runs.
- The LOCALNET Playwright tests on the mobile project (desktop only), and a single combined run of both LOCALNET
  tests on one fresh seed (see above).
- The full LocalNet suite with S3 after these changes (55/57 with in-memory storage; see above).
- **Known LOCALNET gaps, not fixed:**
  - The verifier's ledger view names the evidence package version but not its documents, so in LOCALNET a
    verifier sees no assigned documents (`Assigned evidence · no loan terms`). This is a model gap.
  - The header sync indicator says `Ledger sync not reported yet` on pages that do not report a sync watermark
    (verifications, assets, pledges, governance, audit) until a case or review page has been opened.
  - The overview's per-currency totals have no endpoint (`Not available`), as before.
