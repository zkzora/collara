# DevNet run evidence

Real, synthetic-data run of the full Collara workflow on the **HackCanton shared DevNet participant** (NODERS). No funds move; a Collara lock does not replace a legal lien registration.

**Two dates, two Canton versions.** The run below was recorded on **2026-10-05 on Canton 3.5.19**. On 2026-10-09 the NODERS node reported **Canton 3.6.1**; the recorded data was re-read from the node on that date and is verified (§ "Re-verification on 2026-10-09"). Anything shown from the 5 October run, in the video or elsewhere, is a walkthrough of **recorded results, not new transactions**. The public website is a UI mockup and is **not connected** to this ledger.

- **Date:** 2026-10-05T04:24Z
- **Repo commit:** `d47f962`
- **Network:** Canton DevNet (not a local sandbox). JSON Ledger API `https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services`, Canton 3.5.19.
- **Participant:** `hackcanton-devnet-3::12204a9d883d1158141d8f099d06dd2e42cb52615deb42da5a46f042c8d0e1dbdf0e`
- **Synchronizer:** `global` (`global-domain::1220be58c29e…`)
- **Tenant ledger user:** `9c376537-054a-4e15-b828-c9eb58c2c64d` — one tenant user holds CanActAs on all 11 project parties (a privileged project-operator credential, **not** credential isolation between organisations).
- **Run namespace:** `collara-devnet-r202610050410`
- **Parties:** `9c376537-<Role>::1220…` for CollaraRegistrar, CollaraGovernance, GovSeat1–3, DemoManufacturer, DemoCNCDealer, DemoVerifier, DemoLenderA, DemoLenderB, DemoAuditor.
- **Packages uploaded + vetted:** governance-core-v1 0.1.0 (`361d1f28…`), collara-contracts 0.2.0 (`1c0e5e62…`), collara-governance 0.1.0, governance-action-v1 0.1.0, splice-util 0.1.4.

## Bootstrap — Tier A governance (clean-start B1–B8, all COMMITTED)

Includes the 2-of-3 governed verifier registry: B3 propose, B4 confirm (seat 1), B5 confirm (seat 2), B6 execute, then config + verifier status mirror.

| Step | Actor | Offset |
|---|---|---|
| B1 create AssetRegistry | registrar | 2097686 |
| B2 create GovernanceRules | governance | 2097693 |
| B3 propose add verifier | gov seat 1 | 2097707 |
| B4 confirm | gov seat 1 | 2097720 |
| B5 confirm | gov seat 2 | 2097723 |
| B6 execute | gov seat 2 | 2097729 |
| B7 create CollaraConfig | registrar | 2097738 |
| B8 publish verifier status | registrar | 2097747 |

First update id: `12205dd84f8eeb9f960bfdd9ee834335b3bce8a12ca36dbe8b9a4a84245eadadbba9` at offset 2097686.

## Main fixture (CL-001, M1–M18, all COMMITTED, offsets 2097816–2097938)

Registration, dealer contribution, evidence manifest v1→v2, verification request + change request + attestation ATT-001, dealer consent, package share to Lender A, control share, attestation disclosure, lender assessment.

## Full workflow through the application API (same endpoints the UI calls; all COMMITTED on DevNet, none simulated)

| Step | Endpoint | Update id |
|---|---|---|
| 1 analyst save assessment | POST /cases/CL-001/assessments | `12207120ffd22014…` |
| 2 analyst submit for approval | POST /reviews/CA-001/submit-for-approval | `1220bf06f943c24b…` |
| 3 approver decide ELIGIBLE | POST /reviews/CA-001/decision | `1220809364126414…` |
| 4 approver issue proposal FP-001 | POST /cases/CL-001/proposals | `12209840729c28e1…` |
| 5 borrower accept v1 | POST /proposals/FP-001/acceptance | `12202a6176b78299…` |
| 6 borrower authorize activation | POST /proposals/FP-001/activation-authorization | `1220ece05aeb45f8…` |
| 7 approver activate pledge PL-001 | POST /cases/CL-001/pledge-activation | `1220f23737949bd0…` |
| 8 borrower request release | POST /pledges/PL-001/release-requests | `1220d9502ebc74ff…` |
| 9 approver authorize release | POST /release-requests/RR-001/decision | `1220e9fa1123736d…` |
| 10 borrower grant audit access | POST /access-grants | `122011231fa5f04e…` |
| 11 lender grant audit access | POST /access-grants | `1220d53a380dc7da…` |

## Screenshot (UI on DevNet)

![CL-001 Closed / Released on DevNet](devnet/evidence/cl-001-devnet-closed.png)

The workspace shows the banner "Synthetic demo data — Canton DevNet.", "Ledger synced · offset 2098852 · Ledger-committed", case **Closed**, pledge **Released**, proposal **Accepted**.

## Final state (read back through the API)

- Pledge PL-001: **RELEASED**; lock RELEASED; asset control consumed v3→v4 at activation, recreated at v5 on release.
- Case CL-001: **Closed / Released**.

## Privacy check on DevNet

- Demo Lender B (unrelated lender): `GET /api/cases/CL-001` → **404**, case list → **0 cases**. The unrelated lender sees nothing of CL-001 on the shared participant.

## Not covered in this run

- **The 3.6.1 compatibility check above is partial** (new transactions: bootstrap and asset registration only).

- Document uploads and the auditor export: object storage (S3) was not configured for this local run (health "degraded" on storage only). The seed used `--skip-documents`. Evidence-document and export flows are proven on LOCALNET (`docs/verification.md`), not here.
- Witness-level privacy across independent participants: not applicable here — one shared participant, one tenant credential.
- The participant had pruned history up to offset 175012; the projection was started at that floor (the run's commits are well above it). See `docs/devnet/recovery.md`.

## Re-verification on 2026-10-09 (Canton 3.6.1)

Command: `node scripts/devnet/verify-evidence.mjs --out docs/devnet/evidence/receipts-r202610050410.json` (read-only; the same tenant ledger user, its stored credential, no new transaction). The non-secret receipts are committed in [`devnet/evidence/receipts-r202610050410.json`](devnet/evidence/receipts-r202610050410.json).

| Check | Result |
|---|---|
| Node version at verification | Canton **3.6.1** (it was 3.5.19 on 2026-10-05) |
| Command records in the run's database | **43** (composite commands have a parent and child record, so these are **39 distinct ledger updates**) |
| Found in the participant's own update stream at the recorded offset | **43 / 43** (offsets 2097686 to 2098661, record times 2026-10-05T04:10Z to 04:23Z) |
| The 12 update ids quoted in this document | **12 / 12** present in those receipts |
| Final state read from the ledger (namespace `collara-devnet-r202610050410`) | `AssetControl` active at version **5**; **0** active `CollateralLock`; `CollateralLockReleased` for CL-001 (lock v4, released v5); **1** `ReleaseDecision` AUTHORIZED |
| Privacy, read from the ledger (Demo Lender B's own ACS, not through the application) | **0** case contracts across 13 case templates (AssetControl, EvidenceManifest, DealerContribution, VerificationRequest, VerificationAttestation, CollateralAssessment, FinancingProposal, FinancingAgreement, CollateralLock, CollateralLockReleased, ReleaseRequest, ReleaseDecision, PackageShare) |

What this proves and does not prove: the recorded transactions exist on the shared participant, in that order, with the recorded final state, and the unrelated lender's participant view holds none of the case contracts. It does **not** prove isolation between independent operators: one tenant credential acts for every party, and the node operator can see everything on its participant.

## Canton 3.6.1 compatibility (2026-10-09), as observed

Checked in this order; nothing here was assumed.

1. **API spec.** The node's `/docs/openapi` (3.6.1, 57 paths) differs from the committed 3.5.19 spec (54 paths). Compared for the 16 endpoints Collara uses: 15 are identical; the 16th (ledger end) gained one field. No path or schema was removed; 3 paths and 5 schemas were added. The legacy `filter`/`verbose` request fields are deprecated and disabled by default in 3.6.1; Collara's client sends `eventFormat`/`updateFormat` only.
2. **Existing setup survived.** After the upgrade the tenant user still authenticates, holds CanActAs on all 11 parties, and all five required packages are still present and vetted.
3. **New transactions on 3.6.1.** In a fresh run namespace the clean-start bootstrap (B1–B8, including a governed execute) committed, and the fixture's asset registration and dealer contribution (M1–M4) committed. The projection of 3.6.1 events and the application's ledger reads worked.
4. **Not re-run on 3.6.1.** The rest of the fixture and the financing workflow (evidence manifest, verification, consent, lender review, proposal, activation, release) were **not** re-run on 3.6.1. A second full run on the same parties stops at M5: the seed's precondition looks up an `EvidenceManifest` for `ASSET-DEMO-001`/`PKG-001` without a namespace filter and finds the 5 October one (an application-level check, not a ledger rejection). The fixture identifiers are fixed by the project's synthetic-fixture rules, so a second run needs new parties.
5. **Version pin.** `scripts/devnet/preflight.mjs` still expects 3.5.19 and reports a version mismatch against 3.6.1. It was left unchanged on purpose: it should not be relaxed until the whole workflow has been re-run on the new version.

## Local recording of the recorded run

The workspace in DevNet mode has no sign-in that works for reviewers (the DevNet identity is the team's single NODERS account). For a screen recording, `node scripts/devnet/record.mjs` starts the worker, API and web on `127.0.0.1` with demo persona sessions enabled for loopback requests only. The opt-in (`DEVNET_RECORDING_PERSONAS`) is off by default, is refused on any other host, behind a proxy, on Vercel, in production or in the embedded API, is never written to `.env.devnet`, and the API answers 404 to any request that is not loopback end to end. It must not be used for hosting. The recorded 5 October case is shown from its own local database; the footage shows **recorded results**, not new transactions.
