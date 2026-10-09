# Demo video script (2–5 minutes)

Updated 2026-10-09. The video limit in the rules is **5 minutes**; the recommended plan (variant D) aims for about 4:40. The narration is INFERRED copy, pending the team's approval. Strings in backticks are approved UI copy and must appear on screen exactly as written. The click path follows [`docs/demo.md`](../demo.md) (case CL-001). Personas, buttons and dialog texts are the ones that doc and the Playwright specs use.

**Pick one variant, label it on screen whenever the footage changes, and never mix footage from two variants without a visible label change.**

| Variant | Use when | On-screen label (INFERRED) | Banner the UI shows |
|---|---|---|---|
| **D. UI-mockup tour + recorded DevNet run** (recommended) | Today. The public site is a UI mockup; the DevNet run was recorded on 2026-10-05 and re-verified on 2026-10-09 ([`docs/devnet-evidence.md`](../devnet-evidence.md)) | Part 1: "UI mockup: simulated in the browser, no ledger". Part 2: "Canton DevNet · recorded run of 5 Oct 2026 · results, not new transactions" | Part 1: `Synthetic demo data — UI mockup.` Part 2: `Synthetic demo data — Canton DevNet.` |
| **B. LocalNet** (reference) | Recorded on the authoring machine with the full LocalNet stack running ([`docs/demo.md`](../demo.md) §1) | "Local Canton sandbox, one participant, one operator · synthetic data" | `Synthetic demo data — Canton LocalNet.` |
| **C. UI mockup only** (reference) | Only the Vercel site is available | "UI mockup: no ledger, actions simulated in the browser" | `Synthetic demo data — UI mockup.` |
| **A. DevNet, new transactions** | **Not available.** The workflow was not re-run on Canton 3.6.1 and a second full run on the same parties is blocked ([`docs/devnet-evidence.md`](../devnet-evidence.md)) | — | — |

Statements the narration must include, whatever the variant:

1. Everything shown is synthetic data.
2. No money moves: `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.`
3. A Collara lock does not replace legal lien registration: `This releases the Collara workflow lock. Any required legal lien termination must be completed separately.` and `A Collara record is not a legal lien registration, proof of title, or verification of pledges outside Collara.`

Rules:

- Show `Confirmed on the ledger.` with its update id **only** when it comes from a real commit (variant B). Never show or claim it on the UI mockup.
- **DevNet footage is a walkthrough of recorded results, not new transactions.** Say it, and keep the label on screen: the timeline dates read 2026-10-05, while the header's "Ledger synced · offset …" is the live node today.
- The workspace's header shows the node as it is today (Canton 3.6.1). Say that the node was upgraded after the run and that every recorded receipt was re-read from the node.
- Do not describe governance as decentralized on DevNet: it is Tier A there (ordinary parties of one tenant user); Tier B ran only locally, with one operator.
- Do not imply that the public website talks to a ledger.

---

## Variant D: UI-mockup tour, then the recorded DevNet run (recommended)

### Setup

**Part 1 (UI mockup)**: open <https://collara-coral.vercel.app> in a 1920×1080 window. No stack to start.

**Part 2 (recorded DevNet run)**, on the authoring machine:

```
pnpm db:up
node scripts/devnet/record.mjs --env-file .local/devnet/env.localdb --state .local/devnet/state.oct5.json
# wait for "DevNet recording session is ready (loopback only)", then open http://localhost:3000/login
```

The recording mode is local-only (loopback requests only; refused on any hosting). In another terminal, for the verification segment, run `node scripts/devnet/verify-evidence.mjs` with `COLLARA_DEVNET_ENV_FILE` set to the same env file, and show **only** its printed lines. Never show `.env.devnet`, `.local/devnet/env.localdb`, the Wallet session or any token.

### Timeline

| Time | Screen | Narration (INFERRED) |
|---|---|---|
| 0:00–0:20 | Landing page, banner `Synthetic demo data — UI mockup.`, label "UI mockup: simulated in the browser, no ledger" | "Collara coordinates equipment evidence and pledge workflows for used CNC financing on Canton. Everything you see is synthetic data. This public site is a UI mockup: it is not connected to a ledger." |
| 0:20–0:40 | Problem (landing section) | "Borrower records, dealer documents, inspection reports and lender systems are reviewed separately. Teams follow up repeatedly to learn which evidence is current and who acts next." |
| 0:40–2:05 | Variant C flow, condensed, on the mockup: **Dana Reyes** reviews CA-001 (valuation USD 150,000.00 and requested principal USD 100,000.00 shown separately) → **Morgan Hale** approves eligibility and issues the proposal → **Plant manager** accepts v1 (dialog `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.`) and authorizes activation → **Morgan Hale** activates the pledge → release requested and authorized (dialog `This releases the Collara workflow lock. Any required legal lien termination must be completed separately.`). Use the mockup's own status text; never show a ledger confirmation. | "Here is the whole journey as a mockup. The analyst can't approve: that mandate belongs to the approver. The borrower accepts that exact version. No money moves in Collara, and a Collara lock is a workflow lock: it doesn't replace legal lien registration." |
| 2:05–2:20 | Full-screen card: "Canton DevNet · recorded run of 5 Oct 2026 · results, not new transactions" | "Now the same workflow as it actually ran on the Canton DevNet shared participant. This is a recorded run, shown from its results; no new transaction is submitted in this video." |
| 2:20–3:10 | Local recording stack, banner `Synthetic demo data — Canton DevNet.`. **Morgan Hale** → `/app/cases/CL-001` (Closed, Pledge Released, `Ledger-committed`) → **Activity** tab: entries dated 2026-10-05 with short update ids and offsets. | "Every step is a Daml command that was committed on the ledger, with an update id. The case is closed and the pledge is released. The evidence tile says Incomplete: this run did not upload documents. The header shows the node as it is today: it has since been upgraded to Canton 3.6.1." |
| 3:10–3:40 | Terminal: `verify-evidence` output: `found on the ledger at the recorded offset: 43` of 43, the final state lines, `VERIFIED`. | "We re-read the recorded run from the node itself after the upgrade: all forty-three command records are there, at the recorded offsets, with the recorded final state. Forty-three records are thirty-nine ledger updates." |
| 3:40–4:05 | **Lender B approver**: `/app/cases/CL-001` → `This record is unavailable to your account.` Then the terminal line `privacy: Demo Lender B (unrelated) holds 0 case contracts across 13 templates`. | "An unrelated lender gets the same answer as for a record that doesn't exist, and its own ledger view holds none of the case contracts. This is privacy between parties on one participant run by the node operator; one team credential acts for every party here." |
| 4:05–4:40 | Evidence slide from `packages/domain/src/evidence.ts` (tests, DevNet receipts), then governance. | "The verifier registry is governed two-of-three with Decentralization Manager contracts. On DevNet that ran as ordinary parties of one credential, so it is not decentralized there. A separate scripted run used three Decentralization Manager nodes and a decentralized party, all run by one operator, locally. After the node upgrade we re-verified the recorded run and committed new bootstrap transactions; the full workflow has not been re-run on the new version. Code, tests and receipts are in the repository." |

### What not to say or show

- Do not say the website, or any hosted service, runs on DevNet.
- Do not say "live" or "just now" about DevNet footage.
- Do not present the persona switch as authentication: personas are a recording convenience for synthetic roles.
- If the evidence tile or any tab looks incomplete, say so; do not edit data to make it look complete.

---

## Variant B: LocalNet (reference; works on the authoring machine)

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

## Variant A: DevNet with new transactions (not available)

Would need the whole workflow re-run on Canton 3.6.1: the fixture identifiers must first be namespaced, or new parties created (Console only), because a second run on the same parties stops at fixture step M5 ([`docs/devnet-evidence.md`](../devnet-evidence.md)). Until then, use variant D and its labels.

## Variant C: UI mockup only (reference)

- Use the same flow as variant B, at <https://collara-coral.vercel.app>, with the banner `Synthetic demo data — UI mockup.` visible throughout.
- 0:00 narration: "This is a UI mockup. Actions are simulated in the browser, and no ledger transaction is submitted. The ledger-backed version runs locally and is shown in the test evidence."
- After an action, show the mock's own status text. Never claim a ledger confirmation.
- End on the evidence slide and state that LocalNet runs only on the authoring machine.

## Recording checklist

- [ ] The variant's on-screen label is visible for the whole video and changes with the footage.
- [ ] Statements 1–3 above are spoken, and the approved strings are visible.
- [ ] DevNet segments say "recorded run of 5 October, results, not new transactions", and the 3.6.1 upgrade is mentioned.
- [ ] No real names, documents, emails or credentials appear on screen. Crop out tokens, `.env.devnet`, the env profile path contents and the Wallet session.
- [ ] Length ≤ 5:00. The upload is publicly viewable, without "request access", and checked in a private window.
