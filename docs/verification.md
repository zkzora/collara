# Verification record

What was actually run to check the LOCALNET build, with the observed results, and what has **not** been verified.
Synthetic data only. Nothing here is a production-readiness or security claim.

## 2026-10-03: governance Tier B (scripted, WSL), then regression on the sandbox

- Tier B: Canton open-source 3.5.19 inside WSL Ubuntu 24.04 (one JVM: one sequencer, one mediator, three
  participants), plus three `dec-party-manager` v1.12.0 nodes in `--insecure` mode. All downloads were verified by
  digest. One operator runs every node. Details, thresholds and what was not verified:
  [`governance-tier-b.md`](governance-tier-b.md). Compact evidence: [`evidence/tierb-summary.json`](evidence/tierb-summary.json).
  Full receipts: `.local/tierb/receipts/` (git-ignored).
- Code: HEAD `324796d` plus the uncommitted Tier B scripts and docs.

| Check | Command | Result |
|---|---|---|
| Install | `pnpm tierb:install` | JRE 21.0.12.1 via apt. Canton tarball sha256 matched; its jar is identical to the dpm SDK's 3.5.19 jar. DM image index, amd64 manifest and binary layer digests matched. |
| Full Tier B run, clean | `pnpm tierb:down && pnpm tierb:up && pnpm tierb:onboard && pnpm tierb:scenario && pnpm tierb:topology && pnpm tierb:signing && pnpm tierb:summary && pnpm tierb:status` | **Exit 0.** DM onboarding, DAR distribution and `/contracts` completed. The four DARs were vetted on all three participants. `GovernanceRules` (threshold 2 of 3) was signed by the decentralized party and seen identically by the three DM nodes. Scenario: **10/10 checks passed** (bootstrap; one confirmation fails; duplicate does not count; two members execute Add; stale proposal fails; attestation before suspension; two members execute Suspend; suspension blocks issuance; governance cannot release a lock; one member participant fails, two commit). Accreditation fetch with only p1 connected: rejected (`MEDIATOR_SAYS_TX_TIMED_OUT`, governance party unresponsive); with all three: committed. Namespace threshold: 1 owner signature leaves the change pending, 2 apply it. Signing keys: 2 of 3 accepted; DM never submits with 1. |
| Earlier Tier B runs | earlier versions of the same scripts, on two other fresh topologies | The same governance results. The first run checked the accreditation fetch with submit-and-wait, which hit the JSON API's ~20 s HTTP timeout (HTTP 503); the Canton log showed the same mediator rejection. The script now waits for the command completion. The configuration fixes found along the way are in governance-tier-b.md §3. |
| Typecheck, lint | `pnpm typecheck`, `pnpm lint` | Pass (7 packages; 0 lint problems, including `scripts/tierb`) |
| Unit tests of the touched packages | `pnpm --filter @collara/domain run test --maxWorkers=2`, same for `@collara/web` | domain 68/68, web 49/49 |
| Sandbox restored | `pnpm localnet:up && pnpm localnet:bootstrap` (default namespace not seeded) | Ready after 31.9 s; 11 parties, 13 users, 3 DARs |
| LocalNet integration tests, full suite | `LOCALNET_IT=1 pnpm --filter @collara/api exec vitest run --config vitest.localnet.config.ts` | **12 files, 71/71 passed, 425 s** (S3 from `.env`), after Tier B was stopped |

Not verified in this record: the Collara API, worker and UI on Tier B (they still use Tier A); Canton rejecting a
1-of-3 signature set for the decentralized party; Tier B expiry and deadline staleness; DM with real
authentication; independent operators.

## 2026-10-03: clean start through the browser, full LOCALNET IT with S3

- Machine and services as in the 2026-10-02 record below (Canton 3.5.19 `dpm sandbox`, one participant, shared and
  left running; PostgreSQL 16.14 in WSL; SeaweedFS 4.48 on 8333). Code: HEAD `997f814` plus the uncommitted changes
  listed under [Defects found by the clean-start walkthrough and fixed](#defects-found-by-the-clean-start-walkthrough-and-fixed).
- Isolated stack (setup.md, "A second, isolated stack"): bootstrap `--prefix e2e3`, database `collara_e2e`, worker
  4210, API 4200 (`DEMO_SESSIONS_ENABLED=true`, `PUBLIC_ORIGIN=http://localhost:3100`), web 3100 from
  `NEXT_DIST_DIR=.next-e2e` built with `COLLARA_MODE=LOCALNET`. Prefixes `e2e` and `e2e2` were development worlds
  (see the development notes). Every database, state file and build directory of this run was removed afterwards.

### Commands

```bash
# Git Bash, repo root
node scripts/localnet/bootstrap.mjs --prefix e2e3
pnpm localnet:seed --prefix e2e3 --profile clean-start --database-url postgres://collara:collara_dev@127.0.0.1:5432/collara_e2e
COLLARA_MODE=LOCALNET WORKER_PORT=4210 DATABASE_URL=postgres://collara:collara_dev@127.0.0.1:5432/collara_e2e \
  COLLARA_LOCALNET_STATE=C:/Collara/.local/localnet/state-e2e3.json pnpm --filter @collara/worker start
COLLARA_MODE=LOCALNET PORT=4200 DATABASE_URL=postgres://collara:collara_dev@127.0.0.1:5432/collara_e2e \
  COLLARA_LOCALNET_STATE=C:/Collara/.local/localnet/state-e2e3.json DEMO_SESSIONS_ENABLED=true \
  PUBLIC_ORIGIN=http://localhost:3100 pnpm --filter @collara/api start
cd apps/web
COLLARA_MODE=LOCALNET NEXT_DIST_DIR=.next-e2e pnpm exec next build
COLLARA_MODE=LOCALNET NEXT_DIST_DIR=.next-e2e API_INTERNAL_ORIGIN=http://127.0.0.1:4200 pnpm exec next start --port 3100
E2E_MODE=LOCALNET PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/localnet-clean-start.spec.ts --project=desktop --output=<private dir>
```

### Results

| Check | Command | Result |
|---|---|---|
| Clean-start walkthrough, browser, LOCALNET | `e2e/localnet-clean-start.spec.ts` on the fresh `clean-start` seed above | **14/14 passed, 46 recorded steps, 2.0 min** (desktop project; the mobile project skips it). Detail below |
| Main-seed walkthrough and negatives, browser, LOCALNET | `e2e/localnet-walkthrough.spec.ts --project=desktop` on a fresh `main` seed (prefix `e2e4`, database `collara_e2e4`), same worker, API and web setup | **2/2 passed** (40.8 s and 13.5 s): both tests in one invocation on one fresh seed |
| LocalNet integration tests, full suite, S3 storage | `LOCALNET_IT=1 pnpm --filter @collara/api exec vitest run --config vitest.localnet.config.ts` | **12 files, 71/71 passed, 389 s** on the final tree (S3 from `.env`; the two tests that need a real presigned URL passed). An earlier run with the same API and read-model changes, before one presenter change was reverted, also gave 71/71 (400 s) |
| Playwright, UI_MOCK, full suite | `COLLARA_MODE=UI_MOCK NEXT_DIST_DIR=.next-mock` build, `next start --port 3110`, `PLAYWRIGHT_BASE_URL=http://localhost:3110 playwright test --workers=2` | **70 passed, 42 skipped, 0 failed** (3.4 min). Skips: 32 LOCALNET-only tests (the two LOCALNET files × two projects) and 10 viewport guards |
| Typecheck, lint | `pnpm typecheck`, `pnpm lint` | Pass (7 packages; 0 lint problems) |
| Unit tests of the touched packages | `pnpm --filter @collara/<p> run test --maxWorkers=2` | domain 68, db 62, api 112, web 49: all pass |

What the clean-start walkthrough did in the browser, with demo sessions from `/login` (a new session at every
persona switch, so every switch is also a re-login). Every sign-in checked the banner `Synthetic demo data — Canton
LocalNet.` and the absence of the UI_MOCK banner and simulated copy. Every ledger action waited for its command to be
committed and projected; the confirmations read `Confirmed on the ledger.` with an update id and an offset.

1. Borrower: the clean start has no asset and `0 of 0 accessible cases`; registers `ASSET-DEMO-001`
   (`CNC machining center`, `DEMO-CNC-500`, `SYNTH-CNC-001`) through `/app/assets/new`.
2. Borrower: uploads four synthetic files on the passport (`DOC-001`…`DOC-004`: a dealer invoice copy, photos as
   PNG, inspection report, maintenance summary); each row shows `v1` and the SHA-256 prefix of the uploaded bytes.
3. Borrower: requests verification from the passport overview with **3 of the 4 documents** (the invoice copy left
   out); `VR-001` Requested.
4. Verifier: accepts; **Assigned evidence lists exactly the 3 selected documents**, never the invoice copy, and no
   terms; downloads the inspection report through the presigned link: 665 bytes, SHA-256 equal to the uploaded file,
   `%PDF-` header; requests changes.
5. Borrower: reads the change request, uploads `DOC-003` v2, resubmits (selection preselected, invoice copy still
   off). Verifier: sees `DOC-003` v2 among the same 3 documents and submits the attestation; `ATT-001` lists the
   supporting versions inspection report v2, photos v1 and maintenance summary v1, not the invoice copy. The
   borrower's passport shows the same.
6. Borrower: `/app/cases/new` with Demo Lender A, invited dealer Demo CNC Dealer and `100000.00` USD → `CL-001` on
   Sharing & Access (no ledger transaction); shares the package with Demo Lender A. The invited dealer opens `CL-001`:
   participants, no principal, no proposal reference.
7. Lender analyst: opens the case (which creates `CA-001`); review snapshot `PKG-001 v2 · matches attested versions`;
   the disclosed `ATT-001` shows the same 3 reviewed versions; saves the assessment (valuation 150,000.00, internal
   notes, shared feedback), both notes read back after a reload; submits for approval; the analyst gets the mandate
   notice and no approve button.
8. Approver: ELIGIBLE; issues `FP-001` v1 (principal prefilled `100000.00`). Borrower: accepts exactly v1 and
   authorizes activation. Approver: activates; `Confirmed on the ledger.` with the update id; `Lock and activation
   evidence · PL-001`.
9. Overview after activation: the approver sees `Recorded financing principal` USD 100,000.00 and `Recorded
   collateral valuation` USD 150,000.00 separately, with `1 of 1 active pledge with a recorded principal.`; the
   borrower sees the principal only; Lender B `No active pledges in your organization's scope.`; the verifier, the
   dealer and the auditor get no figures panel.
10. Borrower: requests release with a note (the lock stays active). Approver: requests information with a question.
    Borrower: responds. Approver: sees the 3-item thread and authorizes; the pledge shows `Released`, and the owner's
    passport shows the collateral control `Available` (v5).
11. Borrower and approver each grant audit access; the auditor exports `RPT-0001` and downloads it through the
    presigned link: SHA-256 equal to the checksum on screen, watermark `Synthetic demo data — Canton LocalNet.`, no
    note text in the report.
12. Dealer: on the case's Evidence tab adds its own invoice (`DOC-005`); the tab lists only that record (none of the
    owner's four) and the download is intact. The borrower sees it with Demo CNC Dealer as source; the lender does
    not.
13. New sign-ins: the analyst sees internal notes and shared feedback; the borrower sees the shared feedback, never
    the internal notes, and the release thread in order; the verifier and the dealer see no `100,000`, `100000`,
    `FP-…` or note text, and no simulated copy, on 11 pages each (overview, cases, case tabs, pledge, review,
    passport, verification); the auditor sees no note text on 5 pages; Lender B has no case in the list or counts and
    gets `This record is unavailable to your account.` on 7 direct URLs, without owner data.

### Defects found by the clean-start walkthrough and fixed

| Defect | Fix | Tests |
|---|---|---|
| **Evidence could not be uploaded to a passport without a case** (404 `unavailable` on `POST /api/evidence/upload-intents`). The route takes the owner from the projections, and the projection reader's `assetOwnerOrgId` was a stub that returned null; only case rows supplied an owner. The API-level clean-start test creates the case first, so it never hit this. | `apps/api/src/services/ledger.ts`: `assetOwnerOrgId` reads the asset's active projected `AssetPassport` among the caller's stakeholder contracts and maps its owner party to the organization. | `apps/api/src/services/ledger.test.ts` (3, PGlite); browser steps 2 and 5 |
| **The selected lender's copy of the attestation listed every document of the package version as supporting**, including the invoice copy the verifier never received. Only the owner and the verifier see the verification grants, so a disclosure holder fell back to the package entries. | `packages/db/src/read-model/disclosure.ts` (`discloseReviewedVersions`, applied in `read-model/index.ts`): for an attestation the viewer holds a disclosure of, the document refs and versions of the owner's matching VERIFICATION grants (same request, owner, verifier and evidence anchor; owner-signed) replace the fallback. A read-side disclosure of refs and versions only; the lender still sees no grant contract. | `verification-grants.test.ts` (new case); browser step 7 |
| **The invited dealer could not see the case it was invited to** until it held a contract of it, so it had no screen to contribute from; and the case's Evidence tab had no upload control. | `packages/db/src/read-model/index.ts` and `world.ts`: an invited dealer (dealer role) gets the case's application record; the presenters still give it only the dealer's slice (no terms, only its own documents, no equipment identity without an entitling contract). `world.ts`: a case participant without the owner-only passport sees the asset as registered (a case exists only for a registered asset) instead of `Draft`; the passport's `Registered` row then reads `Not disclosed`. `apps/web/src/components/workspace/case/evidence-tab.tsx` and `assets/evidence-upload-dialog.tsx`: **Add evidence** on the case's Evidence tab when the server allows `evidence.upload` (owner, invited dealer); the document is recorded for the case. | `read-model.test.ts` (new case), `evidence-tab.test.tsx` (2); browser steps 6, 12 and 13 |

Development notes: the walkthrough first ran phase by phase on prefix `e2e` while the fixes were made. A first
fresh run on `e2e2` failed at registration because the `e2e` worker was still bound to port 4210 and projected the
old prefix into the recreated database; that world was discarded and the recorded run used a fresh `e2e3`. A
presenter change that showed the owner the passport's Verification section before any request was reverted: the
UI_MOCK suite asserts that the section appears once a request exists, and the request is made from the overview.

### Gaps found, not fixed

- **Dealer consent has no screen.** The invited dealer's consent to share its records with the lender
  (`POST /api/cases/{id}/sharing` as the dealer) and to their use for verification are API-only, so a dealer document
  reaches neither the lender nor the verifier through the UI. *Addressed since (2026-10-03, not re-run in this
  walkthrough): the dealer's Consent requests (case Sharing & Access tab and `/app/access`) and the owner's Dealer
  consent status; see `docs/PROGRESS.md`.*
- **Verification requests from the UI are asset-level.** No screen passes a case to the request, so the verifier never
  becomes a case participant and dealer documents are never granted to it. *Addressed since (2026-10-03, not re-run
  in this walkthrough): the passport's Request verification dialog has an optional Case field.*
- **Order matters for the dealer.** In the passport-first order the dealer is invited after the attestation. Per the
  share workflow (read, not run), a dealer document added before sharing enters a new manifest version, so the
  attestation would no longer match it and activation would be refused until a new attestation. The walkthrough adds
  the dealer's document after the journey.
- Before any request, `/app/assets/<ref>/verification` tells the owner `This section of … is not disclosed to your
  organization.`, which is misleading for the owner (the request itself is on the overview).
- The passport header shows the owner claim reference in lower case (`claim-…`), a technical id.

### Items of the 2026-10-02 lists covered by this run

- A single run of both `localnet-walkthrough.spec.ts` tests on one fresh `main` seed (above).
- The full LocalNet suite with S3 storage after the changes (above).
- "A verifier sees no assigned documents" and "the overview's per-currency totals have no endpoint": in the
  clean-start run the verifier lists its granted documents (step 4) and the Overview shows per-currency figures
  (step 9). Both were fixed in earlier commits; this run checked them in the browser.

### Not verified in this run

- The clean-start spec on the mobile project (desktop only); the UI_MOCK suite covers the mobile layouts.
- Witness-level privacy of the two new read-side disclosures (the invited dealer's case record, the reviewed
  versions): they are application reads over projected contracts on one participant, not ledger visibility.
- What the 2026-10-02 record lists as not verified and this run did not touch: Docker, Keycloak OIDC through a
  browser, Secure cookies over HTTPS, Tier B governance, JWKS ledger auth.

## 2026-10-02 record

- Date: 2026-10-02, authoring machine (Windows 11, Node 24.16.0, pnpm 11.28.2, Canton 3.5.19 `dpm sandbox` with one
  participant, PostgreSQL 16.14 in WSL, SeaweedFS 4.48).
- Code: HEAD `ea4ebf2` plus the uncommitted LOCALNET presentation and verification changes described in
  [LOCALNET presentation fixes](#localnet-presentation-fixes-in-this-change).
- Isolation: every LOCALNET check below ran next to a live demo without touching it. It used its own namespace,
  database and ports: bootstrap `--prefix`, database `collara_<prefix>` or `collara_it_<prefix>`, API 4200,
  worker 4210, web 3100/3103 from `NEXT_DIST_DIR=.next-e2e`. See [`setup.md`](setup.md#a-second-isolated-stack-next-to-the-demo).

### Results

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

#### What the adversarial sweep checks (`apps/api/test/localnet/adversarial.it.test.ts`)

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

### LOCALNET presentation fixes in this change

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

### Environment issue found during verification

From about 11:31 local time, **SeaweedFS refused every write** (`failed to find writable volumes`; a test
`PutObject` returned `InternalError`). The cause is that drive C: is almost full: 3.8 GB, later 2.3 GB, free of
476 GB. The Windows page file grew under memory pressure. SeaweedFS stops allocating volumes when free space is
below its minimum (about 1 % of the disk). The live demo shares this SeaweedFS: **evidence uploads and auditor
export generation fail until space is freed.** Reads, the ledger and the database were unaffected when checked.

### Not verified

- **Witness-level privacy across participants** (as of this record). Since checked once on five participants run by
  one operator: see [`privacy-verification.md`](privacy-verification.md) for what it shows and what it does not. The
  read model filters by stakeholder, and the equipment disclosure is an application-level read. Neither proves
  ledger-level isolation.
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
