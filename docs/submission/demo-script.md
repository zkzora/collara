# Demo video script (2–5 minutes)

Draft, 2026-10-04. The video limit in the rules is **5 minutes**, and this script aims for about 4:30. The narration is INFERRED copy, pending the team's approval. Strings in backticks are approved UI copy and must appear on screen exactly as written. The click path follows [`docs/demo.md`](../demo.md) (case CL-001). Personas, buttons and dialog texts are the ones that doc and the Playwright specs use.

**Pick one variant, label it on screen for the whole video, and never mix footage from two variants without a visible label change.**

| Variant | Use when | On-screen label (INFERRED) | Banner the UI shows |
|---|---|---|---|
| **A. DevNet** (preferred) | Only after [`docs/devnet-evidence.md`](../devnet-evidence.md) §3 records a committed transaction **and** `EVIDENCE.devnet.run` is `true`. **Not possible today: nothing has run on DevNet yet.** | "Canton DevNet (shared participant) · synthetic data" | `Synthetic demo data — Canton DevNet.` (INFERRED, pending approval) |
| **B. LocalNet** (fallback, works today) | Recorded on the authoring machine with the full stack running ([`docs/demo.md`](../demo.md) §1) | "Local Canton sandbox, one participant, one operator · synthetic data" | `Synthetic demo data — Canton LocalNet.` |
| **C. UI mockup** (last resort) | Only the Vercel site is available | "UI mockup: no ledger, actions simulated in the browser" | `Synthetic demo data — UI mockup.` |

Statements the narration must include, whatever the variant:

1. Everything shown is synthetic data.
2. No money moves: `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.`
3. A Collara lock does not replace legal lien registration: `This releases the Collara workflow lock. Any required legal lien termination must be completed separately.` and `A Collara record is not a legal lien registration, proof of title, or verification of pledges outside Collara.`

Rules: show the ledger confirmation `Confirmed on the ledger.` with its update id only in variants A and B, where the UI shows it after a real commit. Variant C must never show or claim it. Do not describe governance as decentralized on DevNet: on DevNet it is Tier A at most, and Tier B ran only locally.

---

## Variant B: LocalNet (the fallback that works today)

Before you record: start the stack and seed the `main` profile (CL-001 is awaiting the lender's review), as in [`docs/demo.md`](../demo.md) §1. Use a 1920×1080 browser window with the banner visible.

| Time | Screen | Narration (INFERRED) |
|---|---|---|
| 0:00–0:20 | Landing page, then `/login` with the banner `Synthetic demo data — Canton LocalNet.` | "Collara coordinates equipment evidence and pledge workflows for used CNC financing on Canton. Everything you see is synthetic data, running on a local Canton sandbox with one participant, run by one operator." |
| 0:20–0:40 | Problem (landing section) | "Borrower records, dealer documents, inspection reports and lender systems are reviewed separately. Teams follow up repeatedly to learn which evidence is current and who acts next." |
| 0:40–1:10 | **Dana Reyes** (Lender Analyst), `/app/reviews` → CA-001. Point at the attestation scope, the evidence version, valuation USD 150,000.00 and requested principal USD 100,000.00 shown separately. **Start review**, then **Submit for approval**. Show the mandate notice on Decision. | "The lender's analyst sees the verifier's scoped attestation and the evidence version it covers. Valuation and principal are separate figures. The analyst can't approve: that mandate belongs to the approver." |
| 1:10–1:40 | **Morgan Hale** (Lender Approver): **Approve eligibility** (`Eligible for this lender and case. Financing is not yet active.`), then **Issue proposal** (FP-001 v1). Show `Confirmed on the ledger.` with the update id. | "Each action is a Daml command. The UI says confirmed only when the ledger returns an update id." |
| 1:40–2:10 | **Plant manager** (borrower): **Accept v1**, with the dialog `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.` visible, then **Authorize pledge activation**. | "The borrower accepts that exact version. No money moves in Collara." |
| 2:10–2:40 | **Morgan Hale**: **Activate pledge** → `Lock and activation evidence · PL-001`. Open the asset: `Locked`. | "Activation consumes the asset's single control token. A second active Collara lock on this registered asset can't exist, and concurrent activations are tested: exactly one commits." |
| 2:40–3:10 | Negative checks: **Lender B approver** opens `/app/cases/CL-001/summary` → `This record is unavailable to your account.`; **Inspector** opens the proposal → no `100,000.00`. | "An unrelated lender gets the same answer as for a record that doesn't exist. The verifier never sees the loan terms; on the ledger, it isn't a stakeholder of those contracts." |
| 3:10–3:45 | **Plant manager**: **Request release** → `Release requested. The collateral lock remains active.` Show `Release requires the designated lender's authorization.` **Morgan Hale**: **Authorize release**, with the dialog `This releases the Collara workflow lock. Any required legal lien termination must be completed separately.` → `Released`. | "Only the designated lender can release. And a Collara lock is a workflow lock: it doesn't replace legal lien registration or termination." |
| 3:45–4:05 | **Audit lead**: `/app/audit/exports` → **Export case report** (`Case workflow report — not a legal title or lien certificate.`). | "Each record owner grants the auditor access to its own records, and the export covers only those." |
| 4:05–4:30 | `/app/governance` (seat view), then a slide of evidence numbers from `packages/domain/src/evidence.ts`. | "The verifier registry is governed 2-of-3 with Decentralization Manager contracts. Here, on one local participant, the governance party is not decentralized. Separately, a scripted Tier B run used three Decentralization Manager nodes and a decentralized party, all run by one operator, and the app doesn't use it yet. Governance never touches collateral. Code and test evidence are in the repository." |

## Variant A: DevNet (record only after a real DevNet run)

Preconditions:

- The owner has completed [`docs/devnet/owner-checklist.md`](../devnet/owner-checklist.md).
- [`docs/devnet-evidence.md`](../devnet-evidence.md) §2–§3 are filled.
- The API, worker and web are running with `COLLARA_MODE=DEVNET`, and the bootstrap ran with `--profile main` (`--skip-documents` if no document storage is configured).

Use the same timeline as variant B, with these changes:

- 0:00–0:20: "…running on the HackCanton shared Canton DevNet participant, operated by NODERS. All eleven Collara parties are used through our single team ledger user, and the API picks the acting party server-side. Synthetic data only." Show the banner `Synthetic demo data — Canton DevNet.`
- At 1:10–1:40, also show the update id in the NODERS Console, if `verify-first-tx.mjs` or the Console shows it.
- 4:05–4:30, the governance segment: "On DevNet, governance is Tier A: Decentralization Manager GovernanceRules with ordinary parties on a shared participant. Decentralized governance (Tier B) ran only locally, with one operator; the shared DevNet node can't host Decentralized Parties." **Do not show Tier B as DevNet.**
- If evidence downloads or exports are not configured on DevNet, skip the export segment and say so. Do not switch to LocalNet footage without a label change.

## Variant C: UI mockup (last resort)

- Use the same flow as variant B, at <https://collara-coral.vercel.app>, with the banner `Synthetic demo data — UI mockup.` visible throughout.
- 0:00 narration: "This is a UI mockup. Actions are simulated in the browser, and no ledger transaction is submitted. The ledger-backed version runs locally and is shown in the test evidence."
- After an action, show the mock's own status text. Never claim a ledger confirmation.
- End on the evidence slide and state that LocalNet runs only on the authoring machine.

## Recording checklist

- [ ] The variant's on-screen label is visible for the whole video.
- [ ] Statements 1–3 above are spoken, and the approved strings are visible.
- [ ] No real names, documents, emails or credentials appear on screen. On DevNet, crop out tokens, `.env.devnet` and the Wallet session.
- [ ] Length ≤ 5:00. The upload is publicly viewable, without "request access", and checked in a private window.
