# Pitch deck outline (≈10 slides)

Draft outline, 2026-10-04. It uses only facts from this repository and `docs/_research/` (spec-content.md §c–§e, synthesis.md). Approved copy is in backticks. **All other slide text is INFERRED and pending the team's approval.** Where evidence does not exist, the slide says so and names what the team must add. Do not fill these gaps with estimates. The research notes forbid unproven savings, customer logos, testimonials, market-share claims and improvement percentages from the synthetic happy path (spec-content.md §c.4).

Judging criteria (rules read 2026-10-04): Value / problem, ICP / audience, Metrics / validation, GTM materials, MVP materials, Pitch materials. In the research notes' own self-assessment, the weakest criteria are **Metrics / validation** and **ICP**. Those self-scores are not judge scores (spec-content.md §e.3).

---

## 1. Title

- `Equipment evidence and pledge workflows, coordinated privately.`
- `Starting with used CNC financing. Built on Canton.`
- Footer: "Synthetic demo data. Not a lender, custodian or lien registry."

## 2. Problem

- `The documents are digital. The coordination can still be fragmented.`
- Equipment financing involves borrower records, dealer documents, inspection reports and lender systems. The ICP's top pain, from desk research (spec-content.md §d.1): confirming that the equipment evidence is reliable, and that borrower, verifier and lender records agree on the current pledge or release status, without repeated follow-ups or unnecessary disclosure of commercial information.
- **Gap:** this pain statement is a hypothesis from desk research. No user has confirmed it yet. Before you present, add 1–3 short quotes from real interviews, with each interviewee's permission and only their role, not their name.

## 3. Why now

- Canton is used in production for tokenized securities. The research notes cite DTCC, July 2026, as "evidence of infrastructure readiness, not proof of equipment-lender adoption" (spec-content.md §d.4). Before using this point, cite the primary source on the slide.
- Industry context only: ELFA reports that 82% of U.S. companies use financing to acquire equipment, and that $1.34T of equipment and software investment was financed in 2023 (spec-content.md §d.4). **These figures are not Collara's addressable market**, and the slide must say so. No market-size estimate for used CNC financing exists in the repo.

## 4. ICP and users

- First segment: U.S. independent equipment-finance lenders whose credit and documentation teams handle used CNC machinery and coordinate with outside dealers or inspectors (spec-content.md §d.3).
- Daily users: credit analysts and documentation officers. Buyer: the Head of Credit or COO, with approval from IT/security and legal/compliance.
- Participants who do not pay: the manufacturer (borrower), the dealer, the independent verifier and the auditor.
- Not customers now: retail crypto lending, universal banks, real-estate, invoice or consumer-vehicle financing, and anyone who expects automatic valuation or a replacement for a lien registry.
- Named companies in the research notes are discovery prospects that have not been approved. **Do not show them** (spec-content.md §c.4).

## 5. Solution and demo flow

- `One case workspace. Defined responsibilities.`
- Flow (approved workflow headings): `Register the equipment` → `Request verification` → `Share with the lender` → `Record review and pledge` → `Request and authorize release` → `Export the case history`.
- Roles: `Different participants. Different permissions.`
- Boundary: `A Collara record is not a legal lien registration, proof of title, or verification of pledges outside Collara.`
- Show the demo here (see [demo-script.md](demo-script.md)), before the architecture slide. The research notes advise "Demo first; architecture and vision after the proof".

## 6. How Canton is used and the privacy model

- `Shared workflow rules without shared access to everything.`
- Invariants in Daml, not in a database flag:
  - one consuming control token per registered asset, so there is at most one active Collara lock;
  - release is controlled by the lender;
  - proposal acceptance is pinned to a version;
  - activation fails if the attestation disclosure was revoked first.
- Disclosure by stakeholders:
  - Terms are visible only to the borrower and the lender.
  - The verifier and the dealer never see principal or terms.
  - The unrelated Lender B gets the same 404 for CL-001 records as for a record that does not exist.
- Witness-level privacy was checked on five participants (8/8 tests, 87/87 checks). **One machine, one operator.**
- Governance (BitSafe / Decentralization Manager): 2-of-3 seats administer the verifier registry only, and never touch collateral.
  - Tier A is in the app, on one local participant.
  - Tier B (a decentralized party on three DM nodes, one operator) is scripted locally and not in the app.
  - Neither tier has run on DevNet.

## 7. Evidence (what was actually run)

All counts come from `packages/domain/src/evidence.ts`. Show the record name next to each number.

| Evidence | Result |
|---|---|
| Daml Script tests (`collara-contracts` 0.2.0) | 68/68 |
| LocalNet integration tests (sandbox, 1 participant, S3) | 71/71, before contracts 0.2.0. After 0.2.0: activation suites 10/10; the full S3 re-run is pending. |
| LocalNet browser walkthrough from a clean start | 14/14 (46 steps) |
| Witness-level privacy, 5 participants, one operator | 8/8 tests, 87/87 checks |
| Governance Tier A on LocalNet | 10/10 integration tests |
| Governance Tier B on LocalNet (3 DM nodes, one operator, not in the app, contracts 0.1.0) | 10/10 scripted checks |
| Unit tests / CI | 410 / green (run 37108297524) |
| DevNet | Code ready; **not yet run** |

The research notes list seven control checks (spec-content.md §d.5). Their status from the repo:

- covered by tests:
  - unauthorized read denied;
  - unauthorized action denied;
  - second active pledge rejected, including concurrent attempts;
  - release without the lender's authorization rejected;
  - governance below the threshold blocked;
  - governance at the threshold executed;
- open: "pledged-asset transfer rejected". Transfer is out of scope, and the proposed replacement check needs the team's decision (spec-content.md C9, Q8).

## 8. Go-to-market

From the GTM research note (spec-content.md §d.3); none of it has been executed yet:

- Start with one lender team, one verifier and one manufacturer, and one equipment type. Do not pitch "all banks".
- Channels: direct LinkedIn and email (30 contacts), CNC dealers and inspectors (5), equipment-finance associations, and HackCanton mentors and the Canton ecosystem.
- Who pays: the lender, for workflow coordination, controlled evidence access, authorization history and audit exports. Dealers and verifiers participate. No token is required.
- Pilot shape: a four-week, narrowly scoped pilot alongside the lender's existing origination and servicing systems. The research note has a pricing hypothesis for this pilot. It is a willingness-to-pay test and must not be presented as a price.
- **Gap:** no prospect has been contacted (spec-content.md §d.5: "no conversations, quotes, or tests completed yet"). Before you present, add the real outreach count and the responses, or say plainly that outreach has not started.

## 9. Metrics and validation status

- North Star (defined, not measured): lender-accepted equipment collateral cases per week. It counts real cases accepted by non-team lender users and excludes synthetic cases (spec-content.md §d.5).
- Hackathon targets from the metrics note:
  - ≥ 5 testers, including ≥ 2 ICP users;
  - ≥ 3 who complete the core flow unassisted;
  - ≥ 12 committed LocalNet business transactions across ≥ 3 complete synthetic lifecycles;
  - 7/7 control checks.
- **Status today:**
  - interviews: 0 recorded;
  - testers: 0 recorded;
  - workflow baseline (follow-ups, handling time): not measured;
  - synthetic lifecycles: only the test suites have run them, and no tester counts have been recorded.
  - "Not measured" is not the same as zero (metrics note); this applies to every item.
- **What the team must add before submitting** (each with a date and a source):
  1. The interviews held: count, roles, the questions asked, and quotes, anonymised with consent.
  2. The tester sessions: count, how many were ICP users, and how many completed the flow unassisted.
  3. Any workflow baseline a lender shared (for example, follow-ups per case today). Do not quote one without a source.
  4. Pilot or design-partner interest, if any, with written permission before you name anyone.
- If none of these exist by the deadline, the slide says "Validation not started" and lists the plan from slide 10.

## 10. Roadmap and asks

- Done: the Daml model, the API, the worker, the UI, LocalNet tests, five-participant privacy, Tier A governance in the app, and the Tier B scripted proof.
- Next, in the repository's order (`docs/PROGRESS.md`):
  1. the first DevNet run on the shared participant (Tier A);
  2. Tier B in the app, which needs the whole Collara deployment on the Tier B synchronizer;
  3. legal pages (BPD-1) and approval of the copy;
  4. hosting the LocalNet stack.
- Plan from the GTM note (not started): weeks 1–4, 5 interviews, 3 workflow examples and 1 design partner; weeks 5–8, 10 cases in a sandbox or shadow pilot; weeks 9–12, a decision on a paid pilot.
- Asks:
  - introductions to equipment-finance lenders with used CNC exposure, and to independent inspectors;
  - a review of the privacy and hosting design by Canton practitioners;
  - a path to independent node operators for Tier B.
