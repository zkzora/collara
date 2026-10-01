# Collara — Product Content, Positioning, and Concept Research Notes

Research notes for the full-stack migration. They cover approved landing copy, CTA promotion rules, boundaries and disclaimers, ICP/GTM facts that affect the UI, hackathon context, the original Indonesian concept documents in English, and every conflict found between the sources.

- Prepared: 2026-10-01 (research subagent). Read-only research. No source files were modified.
- Convention: **[READ]** means quoted or paraphrased directly from a source. **[INFERRED]** means my interpretation or a recommendation. Exact user-facing strings are in `backticks` and must be copied verbatim.
- All file timestamps are local WIB (+07:00), taken from `stat` mtime.

---

## 0. Source inventory and precedence

| # | Source (absolute path) | mtime (WIB) | Lang | What it is |
|---|---|---|---|---|
| M | `C:\Users\Pongo\Documents\Codex\2026-10-01\oke\outputs\collara-full-stack-master-prompt.md` | 2026-10-01 22:43 | EN | User's authoritative engineering brief (newest). |
| S | `C:\Users\Pongo\Documents\Codex\2026-09-30\ggw\outputs\collara-full-website-system.md` | 2026-09-30 23:44:02 | ID + EN copy | Full website/app spec, 24 sections, 1,295 lines. Section 5 is the landing copy. |
| L | `...\ggw\outputs\collara-landing-content.md` | 2026-09-30 23:44:03 | ID + EN copy | Landing copy only, 311 lines. **Verified by `diff`: its text is identical to S §5 (S lines 144–452), apart from heading numbering.** |
| G | `...\ggw\outputs\collara-gtm.md` | 2026-09-30 23:06 | EN | Go-to-market, written as hackathon judging material. |
| Me | `...\ggw\outputs\collara-metrics.md` (+ `.html` 20:17) | 2026-09-30 20:16 | EN | Metrics and validation plan. |
| I | `...\ggw\outputs\collara-icp.md` (+ `.html`) | 2026-09-30 19:44 | EN | Ideal customer profile. A spot-check showed the HTML text is the same as the md. |
| V | `...\ggw\outputs\collara-value.md` (+ `.html`) | 2026-09-30 19:33 | EN | Value / problem / why Canton. |
| R | `...\ggw\outputs\collara-registration.html` | 2026-09-30 19:21 | EN | HackCanton registration-form draft. |
| H | `...\ggw\outputs\collara-hackcanton-strategy.html` | 2026-09-30 18:31 | ID | "Collara HackCanton Season 3 Strategy Review" (pivot recommendation). |
| X | `...\ggw\.superstack\idea-context.md` | 2026-09-30 18:31 | EN | Auto-generated idea context, derived from H. |
| SL | `...\ggw\outputs\idea-shortlist-20260930-2136.html` | 2026-09-30 21:43 | ID | **Not in the task list. Skimmed for hackathon facts only.** It proposed pivoting away from Collara (to "DamlGuard"). Every later source continues with Collara, so that pivot was not taken [INFERRED]. |
| LP | `...\ggw\outputs\collara-logo-prompt.md` (+ `collara-logo.png`, 1254×1254 RGBA) | 2026-10-01 00:34 | EN | Logo generation prompt. |
| D1–D6 | `C:\Collara\docs\_research\inputs\*.txt` (extracted from .docx) | Original .docx dated 2026-09-19 (per task). The .txt extraction is 2026-10-01 23:15. | ID | Original concept documents: `Collara.txt` (overview), `Collara Canton SMart contract.txt`, `Collara Complete System Design.txt`, `Collara State Transition Design.txt`, `Collara UI.txt`, `Collara Website Content Specification.txt`. |
| RN | `...\ggw\work\renders\{contracts,overview,states,system,website}\page-N.png` | 2026-09-30 18:13 | ID | PDF page renders of 5 of the 6 docx files (no render of `Collara UI`). |

**Renders check [READ]:** I viewed 7 of the 11 PNGs (contracts p1, overview p1 and p3, website p1 and p2, system p2, states p2). They are plain text renders of the same docx content: Word heading styles and bullet text, with no diagrams, tables, mockups, or images. **They contain no information beyond the .txt extractions.** One visual detail is the docx heading style (Calibri-like blue headings, a boxed title), which has no product significance.

**Recommended precedence [INFERRED]:** M (2026-10-01 22:43) > S = L (2026-09-30 23:44) > G (23:06) > Me (20:16) > I (19:44) > V (19:33) > R (19:21) > H = X (18:31) > D1–D6 (2026-09-19).
- S §24 (lines 1273–1286) states explicitly that S keeps the docx concepts (passport, verification, lender assessment, lifecycle, audit), narrows the scope to used CNC, replaces broad observers with case-scoped permissions, and defers ownership transfer and full integrations. It also says the visual direction in `Collara UI.docx` was *not* carried forward ("arahan tampilan tidak dimasukkan").
- M line 15 tells the builder to read S, L, and the system/state documents and to "Reconcile conflicting requirements explicitly."
- Language rule, S line 3 [READ]: implementation notes are in Indonesian, and **all user-facing text is in English.**

**Prototype observation (out of the requested scope; read-only grep, no files modified):** the prototype at `C:\Collara\Collara Website\Collara Landing.dc.html` currently renders the **pre-demo** variant of the approved copy. See §2.4.

---

## (a) Approved landing copy, section by section

Source: L (lines in parentheses). The same text appears at S lines 144–452. Every string below is approved. Copy it verbatim, including the em dash (—) and middle dot (·) characters. L contains no curly apostrophes (verified with grep), so it uses straight `'` in `lender's`, `case's`, and similar words. A typographic upgrade to ’ is a styling choice, not a copy change.

### Global editorial rules (L line 3, translated) [READ]
> "The following order is the landing-copy version. All capability labels are product direction. Publish only claims that have been demonstrated; capabilities that are not yet running get a **planned** label. Do not include savings figures, customer logos, testimonials, market-share claims, or certification badges that are unproven."

### a.1 Metadata (L 5–10)
- Page title: `Collara — Private Equipment Collateral Workflows`
- Meta description: `Coordinate used CNC equipment evidence, lender review, and authorized pledge and release workflows with Collara, built on Canton.`
- Social (OG/Twitter) title: `Equipment evidence. Authorized collateral workflows.`
- Social description: `A private coordination workspace for lenders, equipment owners, and verifiers.`

### a.2 Navigation (L 12–23)
| Label | Destination |
|---|---|
| `Collara` (logo/wordmark) | `/` |
| `Product` | `/#product` |
| `Workflow` | `/#workflow` |
| `For Lenders` | `/#for-lenders` |
| `Why Canton` | `/#why-canton` |
| `Docs` | `/docs` |
| `Sign in` | `/login` |
| `Request a pilot` | `/pilot` (styled as the button CTA [INFERRED from the prototype]) |

There is no `Demo` item in the top nav in either mode [READ: the nav table has none].

### a.3 Hero (L 25–51)
- Eyebrow: `Private equipment collateral workflows`
- Headline (H1): `Equipment evidence and pledge workflows, coordinated privately.`
- Description: `Bring used CNC equipment evidence, verification, and lender review into one coordinated workflow. Share the relevant records with selected counterparties and track who can authorize each pledge and release.`
- Primary CTA (demo-live mode): `Explore the demo` → `/demo`
- Secondary CTA (demo-live mode): `Request a pilot` → `/pilot`
- Supporting text: `Starting with used CNC financing. Built on Canton.`
- Demo disclosure (demo-live mode): `The demo uses synthetic data on LocalNet. No funds are transferred.`
- Pre-demo publication rule: see §(b).

### a.4 Hero product preview card (L 53–66)
Rule (translated): "Shows one illustrative case with demo data, not a real portfolio or traction."
| Field label | Value string |
|---|---|
| Case | `Used CNC financing · CL-001` |
| Asset | `CNC machining center` |
| Current stage | `Awaiting lender review` |
| Evidence | `Inspection report · submitted` |
| Verification | `Attestation issued · scope available` |
| Sharing | `Shared with selected lender` |
| Next action | `Review evidence` |
| Permanent label ("Label permanen") | `Illustrative demo case` |

Rule (L 66, translated): "Serial, borrower name, valuation, and financing amount appearing in the preview must be synthetic. Document images use a sample fixture, not customer documents."
[INFERRED] These values match M §9's seeded main-walkthrough case (CL-001, registered, attested, awaiting lender review, no proposal, no lock). Keep the preview and the seed consistent.

### a.5 Problem section, anchor `product` (L 68–90)
- Heading: `The documents are digital. The coordination can still be fragmented.`
- Body: `Equipment financing can involve borrower records, dealer documents, inspection reports, and lender systems. When these records are reviewed separately, teams may need repeated follow-ups to confirm which evidence is current and who is responsible for the next step.`
- Item 1 title `Evidence across counterparties`, text `Bring case-specific records together without making every document visible to every participant.`
- Item 2 title `Status without guesswork`, text `Track verification, lender review, and pledge status as separate states instead of treating one approval as proof of everything.`
- Item 3 title `Clear authorization`, text `Make the responsible party and required authorization explicit before a workflow transition is submitted.`

Note [READ]: the `product` anchor sits on the **Problem** section, not on the Product section. The Product section has no anchor in L.

### a.6 Product section, no anchor (L 92–120)
- Heading: `One case workspace. Defined responsibilities.`
- Body: `Collara connects an equipment passport with its supporting evidence, verification scope, lender decision, and collateral workflow. Each participant works with the records and actions relevant to their role.`
- `Equipment Passport`: `Keep the equipment identifier, submitted ownership evidence, inspection references, and document versions linked to the case.`
- `Scoped Evidence Sharing`: `Share a selected evidence package with a named lender or verifier. Keep unrelated records outside that package.`
- `Pledge and Release Workflow`: `Record an active collateral lock for a registered asset within Collara and require the designated lender's authorization for release.`
- `Case History`: `Review the actors, decisions, evidence versions, and committed workflow transitions available within your access scope.`
- Boundary note: `A Collara record is not a legal lien registration, proof of title, or verification of pledges outside Collara.`

### a.7 Workflow section, anchor `workflow` (L 122–141)
- Heading: `From equipment evidence to authorized release.`

| Step | Heading | Copy |
|---|---|---|
| `01` | `Register the equipment` | `Create a passport and attach case-specific equipment records.` |
| `02` | `Request verification` | `Assign an accepted verifier and define what needs to be checked.` |
| `03` | `Share with the lender` | `Provide the selected lender with the approved evidence package.` |
| `04` | `Record review and pledge` | `Capture the lender decision and activate the collateral lock with the required authorizations.` |
| `05` | `Request and authorize release` | `Route a release request to the designated lender and record its decision.` |
| `06` | `Export the case history` | `Generate a permission-scoped record of the evidence and workflow.` |

- Supporting note: `Credit decisions, disbursement, legal filings, and enforcement remain with the lender and its existing processes.`

### a.8 Lender section, anchor `for-lenders` (L 143–171)
- Heading: `Start with one credit and documentation team.`
- Body: `Collara's initial focus is equipment-finance lenders handling used CNC machinery. The first pilot is designed to test one workflow alongside existing origination and servicing systems—not replace the entire lending stack.` (uses an em dash with no spaces)
- `Review queue`: `See which cases need evidence, verification, or a lender decision.`
- `Evidence context`: `Review the source, version, scope, and validity of records before relying on them.`
- `Release control`: `Keep release authority with the lender named on the collateral workflow.`
- `Pilot measurement`: `Compare follow-up cycles and handling time with the current process.`
- CTA: `Discuss your workflow` → `/pilot`

### a.9 Participant section, no anchor (L 173–189)
- Heading: `Different participants. Different permissions.`

| Role label | Copy |
|---|---|
| `Equipment owners` | `Submit equipment evidence, approve sharing, and follow the case's next steps.` |
| `Dealers` | `Contribute relevant equipment records to an invited case.` |
| `Verifiers` | `Review assigned evidence and issue an attestation with an explicit scope.` |
| `Lenders` | `Assess the case, record decisions, and authorize collateral release.` |
| `Auditors` | `Inspect and export the records covered by their access grant.` |

- Supporting text: `Participation does not grant access to every document, every loan term, or every case.`

### a.10 Canton section, anchor `why-canton` (L 191–219)
- Heading: `Shared workflow rules without shared access to everything.`
- Body: `Collara is being built with Daml workflows on Canton. Contract permissions define who can participate in a transition and which records are disclosed to the relevant parties.`
- `Scoped disclosure`: `Design separate records for equipment evidence and financing terms so their recipients can differ.`
- `Explicit authorization`: `Express verifier, owner, and lender responsibilities in the workflow rather than relying only on interface controls.`
- `Recorded transitions`: `Connect case history to committed workflow events instead of treating a clicked button as a completed action.`
- Supporting note: `Privacy depends on the implemented contract model and deployment. The LocalNet demo will include access-denial and authorization tests.`
- Rule (L 219, translated): "Do not display partnership, endorsement, or certification labels from Canton. The technical claims in this section may be promoted as *implemented* only after testing."

### a.11 Pilot section, no anchor (L 221–241)
- Heading: `Help shape the first used CNC financing pilot.`
- Body: `We are looking for a lender team willing to map its current evidence and collateral-status workflow. Together, we will define a limited pilot, agree on the required participants, and measure whether coordination improves.`
- Pilot outline (ordered list): 1. `Map one current workflow.` 2. `Test with historical or approved shadow cases.` 3. `Compare follow-ups, handling time, and onboarding effort.`
- CTA: `Request a pilot` → `/pilot`
- Supporting text: `A pilot request is not a loan application. Do not submit financial documents through this form.`

### a.12 FAQ (L 243–277)
- Heading: `Questions before you start`

| Question | Answer |
|---|---|
| `Is Collara a lender?` | `No. Collara coordinates equipment evidence and collateral workflow. Financing decisions and funding remain with the lender.` |
| `What equipment does Collara support first?` | `The initial scope is used CNC machinery. Other equipment categories are outside the first pilot.` |
| `Does an attestation prove legal ownership?` | `Not automatically. An attestation states what a verifier checked, the evidence used, and its limitations. Legal ownership and lien checks remain separate requirements.` |
| `Can Collara prevent double pledging?` | `The planned workflow blocks a second active lock for the same registered asset within Collara. It does not detect every pledge outside the system or guarantee that duplicate physical-asset registrations cannot occur.` |
| `Who can see my documents?` | `Access depends on your case's grants and the implemented contract permissions. Only selected evidence should be disclosed to selected parties. Your hosting provider's access and trust model must also be considered.` |
| `Can shared information be taken back?` | `Future document access can be limited or revoked according to the workflow. Information already disclosed, downloaded, or stored by a participant cannot be guaranteed to disappear.` |
| `Does Collara replace our lending system?` | `No. The initial pilot is a coordination layer alongside existing credit, documentation, and servicing processes.` |
| `Does the demo move money?` | `No. The demo uses synthetic records on LocalNet. Cash settlement and MainNet wallet payments are outside the initial scope.` |

### a.13 Final CTA (L 279–291)
- Heading: `Make the next step in the case clear.`
- Body: `Explore the equipment evidence workflow, or help us test it with a focused lender team.`
- Primary CTA: `Explore the demo` → `/demo`, "**only after the demo is available**" ("hanya setelah demo tersedia").
- Secondary CTA: `Request a pilot` → `/pilot`

### a.14 Footer (L 293–311)
- Column `Product`: `Product` · `Workflow` · `For Lenders` · `Demo`
- Column `Resources`: `Docs` · `Why Canton`
- Column `Contact`: `Request a pilot`
- Column `Legal`: `Privacy` · `Terms` (routes `/privacy` and `/terms` per S §4.1)
- Description: `Private equipment evidence and collateral workflows. Starting with used CNC financing.`
- Disclaimer: `Collara is in development. It is not a lender, custodian, legal lien registry, or provider of guaranteed financing.`
- Rule (L 311, translated): "Do not add an email address, business address, social links, or GitHub URL that does not exist yet. Do not use dead links or `#` as final placeholders."

### a.15 Other approved public and auth page copy (from S; same author and date as L) [READ]
**`/pilot` Request Pilot (S §6.1, lines 456–474)**
- Heading: `Tell us about your equipment-finance workflow.`
- Description: `We are looking for teams handling used CNC financing to help define and test a focused coordination workflow.`
- Fields (labels are English in S): Full name; Work email; Company; Role; Company type; Country; Equipment category; Approximate cases per month (must include an option `Unknown`); Current workflow challenge; Optional current systems; Consent to be contacted.
- Must NOT request passport files, borrower PII, bank statements, or loan documents. Monthly volume is discovery data, not a qualification fact.
- Submit button: `Request a conversation`
- Success: `Your request has been received. We will contact you using the email provided.`
- Error: `We couldn't submit your request. Please try again.`
- Behaviour: show success only after the backend has persisted the submission. If email delivery fails but the data is stored, the request still counts as received and goes to an operational retry queue. Do not promise a response SLA. API: `POST /api/pilot-requests`, rate-limited (S §15.2).

**`/docs` minimum content (S §6.2):** what Collara does and does not do; the supported demo workflow and synthetic fixtures; roles, evidence scope, and authorization rules; LocalNet prerequisites, versions, and setup/run steps; how to run positive and negative tests; known limitations, operator trust model, and deployment status; data model and API overview; sponsor module instructions **only if actually available**.

**`/security` (S §6.3):** P1, and may be a docs section in the MVP. Distinguish implemented controls from planned ones. No SOC 2, ISO, or "GDPR-compliant" claims without a basis.

**`/privacy` and `/terms` (S §6.4):** need legal review before real data is handled. S is "not legal advice or final legal text".

**`/login` (S §7.1):** copy `Sign in to your Collara workspace.` Invite-only for pilots. Email verification does not prove company authority, lender status, or trusted-verifier status.

**`/invite/:token` (S §7.2):** actions `Accept invitation` · `Decline`. Errors `This invitation has expired.` / `This invitation cannot be used with your account.`

**In-app confirmations (S §9):**
- Register-asset warning: `Submitted ownership evidence has not yet been independently verified.`
- Attestation confirmation: `This attestation records the checks listed above. It does not approve financing or establish legal lien priority.`
- Proposal acceptance: `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.`
- Release: `This releases the Collara workflow lock. Any required legal lien termination must be completed separately.`
- Report label: `Case workflow report — not a legal title or lien certificate.`
- Overview empty state: `No cases require your action.`

**Operational microcopy (S §18.2, lines 1116–1138):**
| Condition | Copy |
|---|---|
| New case empty state | `Create a case to coordinate equipment evidence and lender review.` |
| Evidence missing | `Required evidence is missing. Review the checklist before submitting.` |
| Evidence stale | `The reviewed evidence has changed. A new review is required.` |
| Attestation expired | `This attestation is outside its validity period.` |
| Review eligibility | `Eligible for this lender and case. Financing is not yet active.` |
| Submission pending | `Submitted. Waiting for ledger confirmation.` |
| Commit confirmed | `Confirmed on the ledger.` |
| Projection delayed | `The action is confirmed. This view is still synchronizing.` |
| Unknown outcome | `Confirmation is delayed. We are checking the original submission before retrying.` |
| Lock conflict | `This action could not complete because the asset workflow state changed.` |
| Release pending | `Release requested. The collateral lock remains active.` |
| Unauthorized release | `Release requires the designated lender's authorization.` |
| Unauthorized resource | `This record is unavailable to your account.` |
| Future access revoked | `Future document access has been revoked. Previously shared copies may still exist.` |
| Hash mismatch | `The file does not match its recorded integrity reference.` |
| Scoped export | `This report includes only records available within your access scope.` |
| Network unavailable | `The ledger is unavailable. No confirmed state change has been recorded.` |

Rule (S line 1138): confirmations must state what changed, the acting party, the evidence/proposal version, and the external obligations that remain. Never use a generic `Success` for every step.

**Mode banner strings (M §5, lines 99–102), which supersede S's `Demo data — LocalNet`; see conflict C20:**
- `UI_MOCK`: `Synthetic demo data — UI mockup.`
- `LOCALNET`: `Synthetic demo data — Canton LocalNet.`

---

## (b) Pre-build / pilot CTA copy vs. demo CTA copy, and the promotion rules

### b.1 Copy variants
| Element | **Pre-demo (current, default)** | **Demo-live** | Source |
|---|---|---|---|
| Hero primary CTA | `Request a pilot` → `/pilot` | `Explore the demo` → `/demo` | L 39, 51 |
| Hero secondary CTA | `Read the workflow` → `/#workflow` | `Request a pilot` → `/pilot` | L 41, 51 |
| Hero disclosure line | `Collara is currently in development. We are seeking equipment-finance design partners.` | `The demo uses synthetic data on LocalNet. No funds are transferred.` | L 47–51 |
| Hero supporting text | `Starting with used CNC financing. Built on Canton.` (same in both) | same | L 45 |
| Final CTA primary | Not specified in L. The prototype uses `Request a pilot` [INFERRED rule: mirror the hero] | `Explore the demo` → `/demo` | L 289 |
| Final CTA secondary | Not specified in L. The prototype uses `Read the workflow` → `/#workflow` [INFERRED] | `Request a pilot` → `/pilot` | L 291 |
| Footer `Demo` link (Product column) | Omit, because no dead links are allowed (L 311). The prototype omits it. [INFERRED] | `Demo` → `/demo` | L 295 |
| Lender CTA `Discuss your workflow` → `/pilot` | same | same | L 171 |
| Pilot CTA `Request a pilot` → `/pilot` | same | same | L 237 |
| FAQ `Does the demo move money?` | Ambiguous; the prototype keeps it. See open question Q3. | keep | L 275–277 |
| Canton supporting note `...The LocalNet demo will include access-denial and authorization tests.` | keep (future tense) | Keep verbatim until new copy is approved. L 219 allows promotion to "implemented" only after testing, but **no replacement string has been approved.** | L 217–219 |
| FAQ `The planned workflow blocks a second active lock…` | keep | Same as above: "planned" may be dropped only after the lock invariant tests pass, and no replacement string exists. | L 261 |

### b.2 Promotion rules (verbatim, then translated)
1. L 51 (ID), translated: "**Pre-demo publication rule:** If `/demo` is not yet actually running, the primary CTA becomes `Request a pilot`, the secondary CTA `Read the workflow` → `/#workflow`, and the disclosure is replaced with `Collara is currently in development. We are seeking equipment-finance design partners.` **Do not show a dead demo button.**"
2. L 289: Final CTA `Explore the demo` → `/demo` "only after the demo is available".
3. L 3: "Publish only claims that have been demonstrated; capabilities not yet running get a **planned** label."
4. L 219: Canton technical claims are promoted to "implemented" only after testing.
5. S §21.1 acceptance (lines 1198–1205): "All navigation and CTAs lead to real destinations"; "Demo synthetic/LocalNet disclosure is visible"; "Request pilot stores data before success".
6. S §22 step 6 (line 1252), translated: "Build the landing and request-pilot form using the copy in this document; **activate the demo CTA after the flow succeeds**."
7. S §21.4 (line 1235): "Demo states come from the actual workflow, not hardcoded success screens."
8. M §5 line 104 [READ]: "Do not silently fall back from a failed LocalNet action to simulated success. **Promote demo CTAs only when the corresponding demo works; otherwise retain the approved pre-build/pilot copy.**"

### b.3 Implementation recommendation [INFERRED]
- Gate the landing variant with a single server-side flag, for example `PUBLIC_DEMO_STATUS = off | ui_mock | localnet`. The default is `off`. Resolve it in a Server Component so no client flicker occurs and no dead button ships.
- Show `Explore the demo` only when `/demo` exists and completes the walkthrough. The hero disclosure `The demo uses synthetic data on LocalNet. No funds are transferred.` is **only truthful in `LOCALNET` mode**. If only the `UI_MOCK` walkthrough works, either keep the pre-demo copy (the safe default) or obtain new approved disclosure copy from the user. Do not reuse the LocalNet disclosure for a mock. (Open question Q1.)
- When the flag is `off`, the `/demo` route must not be linked anywhere (hero, final CTA, footer). If the route exists, it should show the pre-build state rather than a broken page.
- Each demo page must carry the M mode banner (`Synthetic demo data — UI mockup.` or `Synthetic demo data — Canton LocalNet.`).

---

## (c) Positioning boundaries and disclaimers

### c.1 Positioning statements (newest first)
- **Value proposition (V line 20) [READ]:** "Private, verifiable equipment evidence and coordinated collateral status for manufacturers and their lenders."
- **Positioning sentence (G line 10) [READ]:** "For **credit and documentation teams at equipment-finance lenders handling used CNC deals** who **struggle to reconcile equipment evidence and pledge/release status across counterparties**, **Collara** is a **private multi-party workflow platform** that **aims to reduce repeated follow-ups and inconsistent status records**. Unlike **coordinating separate records through emails, attachments and lender portals**, we **coordinate authorized workflow transitions with role-scoped visibility**."
- **Product definition (M line 7; R elevator pitch line 1) [READ]:** "Collara is a private equipment-collateral coordination workflow for manufacturers, independent verifiers, and equipment-finance lenders on Canton Network. The first use case is used CNC machinery." R's wording is "...private equipment-collateral workflow...".
- **Superseded docx pitch (D1 line 113), not for use:** "Collara transforms physical business assets into trusted, privacy-preserving digital collateral identities, enabling faster institutional financing through Canton Network." It conflicts with the no-unproven-benefit rule ("faster") and the narrowed scope. See C2.

### c.2 What Collara is NOT (consolidated)
From S §1.3 (lines 52–60), translated [READ]:
- Not a lending marketplace, liquidity pool, or automated credit scoring.
- Not a legal ownership registry, and not a replacement for UCC, lien, or title searches.
- Not a custodian of the machines or of loan funds.
- Creating a passport does not prove the physical machine exists.
- Does not prevent pledges made outside the Collara workflow, or through another passport not identified as the same physical asset.
- Does not treat financing amounts as TVL, revenue, or Collara's own valuation.
- Performs no disbursement, liquidation, or legal enforcement in the MVP.

From M line 17 [READ]: outside the first implementation are cash settlement, real-money transfers, automatic legal lien registration, global physical-asset uniqueness, and ownership transfer.
From M line 208 [READ]: "verification does not automatically prove title or valuation, internal pledge prevention does not detect every external pledge, and LocalNet is not MainNet deployment."

### c.3 Exact disclaimer strings already on the landing page
- Product boundary: `A Collara record is not a legal lien registration, proof of title, or verification of pledges outside Collara.`
- Workflow: `Credit decisions, disbursement, legal filings, and enforcement remain with the lender and its existing processes.`
- Participants: `Participation does not grant access to every document, every loan term, or every case.`
- Canton: `Privacy depends on the implemented contract model and deployment. The LocalNet demo will include access-denial and authorization tests.`
- Pilot: `A pilot request is not a loan application. Do not submit financial documents through this form.`
- Footer: `Collara is in development. It is not a lender, custodian, legal lien registry, or provider of guaranteed financing.`
- FAQ answers on lender status, attestation vs. ownership, double pledging, document visibility, revocation, and money movement (see a.12).

### c.4 Claim and content prohibitions (consolidated rules)
| Rule | Source |
|---|---|
| No unproven savings numbers, customer logos, testimonials, market-share claims, or certification badges. | L 3; S §1.1 line 40 ("must not state proven savings without pilot data") |
| No Canton partnership, endorsement, or certification label. | L 219 |
| No placeholder email, address, social, or GitHub links. No `#` or dead links. | L 311 |
| P1/P2 features must not appear as active features. | S line 72 |
| No `TVL`. Monetary figures must be labeled `Recorded financing principal` or `Recorded collateral valuation`, with currency, coverage, and source. | S §9.1 line 569 |
| Unavailable data must not display as zero. Do not merge outstanding collateral, workflow volume, loan balance, and valuation into one metric. | S §8.3 |
| Do not call the system "trustless" while deployment is centrally hosted. | S §20.4 |
| No SOC 2, ISO, or GDPR-compliant claims. | S §6.3 |
| Seeded LocalNet organizations must not be presented as verified real institutions. | S §7.3 |
| "Three local nodes is not proof of three independent organizations." LocalNet operators must be labeled simulated. | S §9.20; M §8 line 153 |
| Planned integrations (LOS, ERP, e-sign, lien search, appraisal, insurer) are "planned, not available integration logos". | S §16.3 |
| Do not add a wallet "just for a challenge logo" (Grofty, cBTC/cETH, CC fees). | S §16.4; R |
| The ICP and GTM named companies (Crest Capital, Commercial Credit Group, Amur, Resell CNC) are discovery prospects only. They are "not claimed customers or partners." Never show them on the site. | I line 45; G line 21 |
| "LocalNet parties and transactions demonstrate technical execution. They are not evidence of independent companies, real loan volume, or production adoption." | Me line 63 |
| "Not measured" is not the same as zero. | Me line 99 |
| Double-pledge claims are limited to "the registered asset within Collara; it is not a claim of a universal lien registry or legally enforceable collateral." | R line 27 |
| Governance must not be presented as complete if only frontend clicks exist. "Confirmation buttons on the website without Decentralization Manager integration are not challenge proof." | M §8 line 155; S §16.2 line 1056 |
| Do not make improvement percentages from the synthetic happy path. | S §19.2 line 1162 |
| Docs must distinguish UI mockup, implemented LocalNet capability, planned work, and unavailable integrations. | M §12 line 208 |

### c.5 Vocabulary guidance [INFERRED from the sources above]
- Use **Lender**, not "Bank" or "Financial Institution". Use **Equipment owner / Borrower**, **Verifier**, **Dealer**, **Auditor**.
- Use **attestation** (scoped, with limitations), not "verified asset" or "approved asset".
- Use **collateral lock / pledge**, not "loan active" or "funded". `ACCEPTED` is not `FUNDED` (S §11.4).
- Use **Eligible for this lender and case**, never a globally "eligible" asset (S §9.11).
- Use **Request a pilot / design partner**, never "Sign up" or "Get started" for financial roles. Roles cannot be self-selected at signup (S §3 line 88).

---

## (d) ICP, personas, and GTM facts relevant to the UI

### d.1 ICP (I, 2026-09-30 19:44) [READ]
- **Segment:** "Non-bank equipment-finance lenders funding used industrial machinery for small and mid-sized manufacturers, starting with CNC machine financing. Prioritize cases requiring coordination with a dealer or independent verifier."
- **Company stage:** established specialty finance companies with dedicated credit and documentation teams. "The first pilot targets one lending team and one equipment type."
- **Users (daily):** "Credit analysts and documentation officers who review equipment evidence and coordinate approvals; asset-management staff who track pledge and release status."
- **Buyer:** "Head of Credit or COO, with IT/security and legal/compliance approval. Smaller firms may have an owner or CEO as the budget decision-maker."
- **Geography:** United States for discovery. The pilot jurisdiction is TBD. "the hackathon MVP is a LocalNet demonstration."
- **Top pain:** "Confirming that the equipment evidence is reliable and that the current pledge or release status is agreed across borrower, verifier, and lender records, without repeated follow-ups or unnecessary disclosure of commercial information."
- **Frequency:** per financing or refinancing deal, and on every change to evidence, pledge, or release. "can become a daily task across an active portfolio."
- **JTBD (quote):** "When reviewing a used CNC machine financing or refinancing case, I want reliable equipment evidence and a clearly authorized collateral status, so I can complete the collateral review without repeatedly reconciling records across counterparties."
- **Switch triggers:** fewer evidence requests and status follow-ups, accepted verifier attestations, lender-scoped privacy, an auditable pledge-to-release workflow complementing the existing LOS and credit policy.
- **Blockers:** security and compliance review, integration effort, unreliable physical-asset identity or stale attestations, legal collateral-rights uncertainty, counterparty onboarding, price vs. measured savings.
- **Tools they already use:** LOS and leasing/servicing software, lender and dealer portals, CRM, document storage and e-signature, spreadsheets, collateral-search services.
- **Not customers (now):** retail crypto or permissionless lending users; universal banks seeking multi-country rollout; real-estate, invoice, or consumer-vehicle financing; manufacturers wanting only an inventory or maintenance tracker; users expecting automatic valuation, instant credit approval, or a lien-registry replacement.

### d.2 Persona-to-role mapping for the UI [INFERRED, combining I with S §3]
| ICP persona | App role / mandate (S §3) | Primary screens (M §5 priority list) | Key UI needs |
|---|---|---|---|
| Credit analyst / documentation officer (lender) | `Lender Analyst` | Lender-led Overview, Case Queue, Case Workspace, Collateral Review | Queue of "cases need evidence, verification, or a lender decision"; evidence source, version, scope, and validity; request-information flow |
| Head of Credit / approver | `Lender Approver` (mandate) | Collateral Review → Decision, Financing Proposal, Release Decision | Explicit approve/authorize actions with confirmation copy; release authority |
| Asset-management staff | Lender role with pledge scope | Pledges, Pledge Detail and Release | Active / Release requested / Released filters; lock state; release-request reasons |
| Manufacturer / borrower | `Borrower / Asset Owner` | Asset Passport, registration and evidence, Proposal accept, Request release | Next-step clarity; sharing consent; "cannot release unilaterally" |
| Dealer | `Dealer Contributor` | Evidence tabs inside the case | Contribute records only; no loan terms |
| Independent verifier / inspector | `Verifier` | Verification Queue and Workspace | Scope checklist, limitations, validity period, outcomes |
| Auditor | `Auditor` (grant) | Audit Center, scoped export | Granted subset only; export with coverage watermark |
| IT/security, legal/compliance approvers | none (evaluate the product) | `/docs`, `/security` | Honest implemented-vs-planned controls, operator trust model |

### d.3 GTM facts (G, 2026-09-30 23:06) [READ]
- **First segment:** "U.S. independent equipment-finance lenders with dedicated credit/documentation teams handling used CNC machinery and coordinating with external dealers or inspectors. Daily users: credit analysts and documentation officers. Buyer: Head of Credit or Operations."
- **Prospects (research only, not approached):** Commercial Credit Group / Manufacturers Capital; Crest Capital; Resell CNC (a used-CNC dealer, as a referral source). I also lists Amur Equipment Finance.
- **Channels:** direct LinkedIn and email (30 contacts); CNC dealers and inspectors (5); equipment-finance associations (ELFA); HackCanton mentors and the Canton ecosystem (3 intros plus a privacy/hosting design review).
- **Who pays:** "The lender pays for workflow coordination, controlled evidence access, authorization history and audit exports. Dealers and verifiers participate."
- **Pricing hypothesis:** "US$500–1,500 for a four-week, narrowly scoped pilot." This is a willingness-to-pay test. B2B licensing and subscription; "No token is required." Featured App rewards are supplementary. [INFERRED] No pricing page exists in the sitemap, so do not publish prices.
- **90-day plan:** weeks 1–4: 5 interviews, 3 workflow examples, 1 design partner. Weeks 5–8: 10 cases in a sandbox or shadow pilot, with role and privacy tests. Weeks 9–12: paid pilot decision.
- **Risks:** "Collara does not independently verify equipment, establish legal lien priority or detect pledges outside its participating workflow."

### d.4 Value facts (V) [READ]
- Before/after: today users "Collect equipment documents, arrange verification, and reconcile approvals and pledge status...". With Collara they "Review a verifier-signed equipment passport, share evidence with a selected lender, and coordinate pledge and authorized release in one role-based workflow."
- Industry context (V line 28): ELFA says 82% of U.S. companies use financing when acquiring equipment, and $1.34T of equipment and software investment was financed in 2023. V notes "These figures are not Collara's addressable market." [INFERRED] Do not put these on the landing page as a TAM.
- Why now: DTCC, July 2026, production tokenized-securities trades using Canton. This is "evidence of infrastructure readiness, not proof of equipment-lender adoption."
- BitSafe (V line 45): "2-of-3 governance over verifier-registry administration. It must preserve lender authorization for collateral release."

### d.5 Metrics that need in-app instrumentation (Me, plus S §19) [READ]
- **North Star:** "Lender-accepted equipment collateral cases per week." Count unique **real** case IDs with a recorded acceptance by a **non-team** lender user. Acceptance means evidence and status are sufficient for review, **not** credit approval or funding. Count each case once and exclude synthetic or internal cases. [INFERRED] Case records need an `is_synthetic` flag, and acceptance events need actor organization metadata.
- **Hackathon targets:** ≥5 testers, including ≥2 ICP users; ≥3 complete the scripted core flow unassisted; ≥12 committed LocalNet business transactions across ≥3 complete synthetic case lifecycles (register, attest, pledge, release; setup and seed excluded); ≥4 application parties ("owner, verifier, lender, and registry"); **7/7 control checks**.
- **The 7 control checks (Me line 47):** unauthorized read denied; unauthorized action denied; second active pledge rejected, including concurrent attempts; pledged-asset transfer rejected; release without the required lender authorization rejected; below-threshold governance blocked; threshold-satisfied governance executed.
- **S §19.1 workflow events:** case creation, package submission, verification request, changes request, attestation issue, lender review start, decision, proposal acceptance, pledge commit, release request/commit, export, access-denial test. Synthetic events are kept separate. "Committed ledger transactions, not button clicks."
- **Analytics privacy (S §19.3):** never send document contents, borrower identity, serials, credentials, financing terms, or raw ledger payloads to third-party analytics.
- **Status of validation (Me):** no conversations, quotes, or tests completed yet; every checklist item for interviews and numeric tests is unchecked.

---

## (e) Hackathon context

### e.1 Event and track [READ]
- **Event:** HackCanton **Season 3**, at `https://hackathon.appsfactory.cc/season-3` (H, sources section).
- **Track:** "Track 1 — Real-World Assets (RWA) & Business Workflows" (R line 17). H line 232 says Track 1 "explicitly asks for issuance → state changes → transfer/fulfillment → audit"; the wishlist mentions "tokenized collateral management".
- Other tracks seen in SL (for context only): Track 3 "Investment Infrastructure: Funds, DAOs & Governance Tools"; Track 4 (unnamed, "larger prize pool"); Track 5 "Open Track".
- **Challenge / sponsor:** "BitSafe — Decentralizing Apps on Canton" (R line 18). Target route: **Contribution Pool**, "through decentralizing Collara with a reproducible LocalNet demo." "If the form only lists the sponsor, choose BitSafe. **Do not add Gold or Grofty to the current scope.**"
  - Gold requires a suitable own node and deployment eligibility (H line 215: "apply Gold only if you really have a suitable node"; S §16.2: Gold "is not assumed").
  - Grofty is excluded: it is MainNet invitation-only and needs real-fund approvals (H line 228; R; S §16.4).
  - SL notes for the BitSafe Contribution Pool: use a real Decentralized Party and show a governed action under and over the threshold. "Several containers on the same laptop are not independent operators." "Re-running the bundled test suite is not a differentiated contribution." [READ, translated]

### e.2 Deadlines [READ]
- **Submission deadline: 2026-10-09 23:59 UTC = 2026-10-10 06:59 WIB** (H line 219; X line 64; SL: "deadline 9 Oktober 2026 23:59 UTC, bukan Grand Final 21 Oktober", i.e. the Grand Final on 21 Oct is a separate, later event).
- [INFERRED] Eight days remain from today, 2026-10-01.
- **Eligibility to verify (SL sources note):** "check account eligibility, registration and **1,000 Mana / 10 activity days**". Unverified; confirm with the official rules.

### e.3 Judging criteria (H line 98 onward, "six official criteria", each /5, total /30) [READ]
| Criterion | Self-estimate in H (now → target) | What H says must change |
|---|---|---|
| Value / Problem | 4 → 4.5 | Pick one asset class; measure verification cost and time |
| ICP / Audience | 2 → 4.5 | Buyer: equipment-finance underwriter. User: manufacturer borrower and accredited verifier |
| Metrics / Validation | 0.5 → 3–4 | 3–5 interviews, workflow baseline, privacy test, double-pledge test |
| GTM Materials | 1.5 → 3.5 | Pilot with 1 lender, 1 verifier, and 1 manufacturer, not "all banks" |
| MVP Materials | 1.5 → 4.5 | LocalNet/DevNet, Daml choices, API, role UI, tests, clean-run script |
| Pitch Materials | 3 → 4.5 | Demo first; architecture and vision after the proof |

The overall estimate was 12.5/30 now and 24–26/30 potential. These are not judge scores. Verdict: "Go, with pivot", confidence 0.83. G, I, V, and Me each open with "What judges look for", so they are written to these criteria.

### e.4 Submission artefacts [READ]
- R line 32: "A working demo link, public repo with setup instructions, pitch, and other HackCanton submission requirements remain to be completed."
- Demo video: **5 minutes** in H line 218 ("pitch, 5-minute video") and X ("five minute demo"), but R gives a **2 min 30 s** "Planned demo outline". Conflict C18.
- R's demo outline:
  - 0:00–0:20 problem
  - 0:20–0:50 register one asset and obtain a verifier-signed attestation
  - 0:50–1:20 lender-scoped evidence and financing terms; an unauthorized party cannot read the private contract
  - 1:20–1:45 create a pledge; show a second pledge and a transfer rejected; authorized release
  - 1:45–2:15 governance proposal: one confirmation is insufficient, two satisfy 2-of-3
  - 2:15–2:30 ledger receipts or test evidence plus the reproducible LocalNet setup; "State which operator roles are simulated."
- Registration fields (R): Project name `Collara`; Elevator pitch "Under the form's 2,000-character limit"; Logo upload **480 × 480 px PNG or JPG**; Tech Stack "Planned: Canton Network (LocalNet), Daml, Canton Ledger API, React, TypeScript, Tailwind CSS, Docker Compose, Decentralization Manager." R adds: "Remove tools that are not actually selected or used before the final submission."
- R's full elevator pitch (paragraphs 1–5) is a usable "About" text:
  > "Collara is a private equipment-collateral workflow for manufacturers, independent verifiers, and equipment-finance lenders on Canton Network. / Equipment financing often relies on fragmented documents and manual checks, making collateral review slow and pledge status difficult to coordinate across firms. / We are building an end-to-end workflow to register equipment, obtain a verifier-signed attestation, share evidence with a selected lender, and record a collateral pledge and authorized release. Daml contracts will enforce permissions and prevent a second active pledge against the same registered asset within Collara. Canton's party-based privacy will keep asset evidence and financing terms scoped to the relevant participants. / For the BitSafe challenge, we plan to use a decentralized party and Decentralization Manager for 2-of-3 governance over verifier-registry administration. / Our initial MVP targets one equipment type and a reproducible LocalNet demo. Physical ownership, valuation, and legal enforceability remain dependent on off-ledger verification."

### e.5 BitSafe proof requirements (M §8 plus S §16.2) [READ]
- Governance scope: verifier-registry administration only, with `Add verifier` and `Suspend verifier` actions. It must not cover collateral release, credit approval, fund transfer, or blanket upgrades.
- Use the actual DLC-link Decentralization Manager (`https://github.com/DLC-link/decentralization-manager`, custom-action guide `docs/CUSTOM_DAML_TEMPLATES.md`, `GovernableAction` interface), with the real propose → confirm → execute lifecycle and execution evidence.
- Three eligible members with a 2-of-3 threshold. Tests:
  1. One approval fails.
  2. Two distinct approvals execute.
  3. Duplicates don't count twice.
  4. Stale or expired proposals cannot execute.
  5. Suspension blocks new attestations.
  6. Governance cannot bypass the lender's release authority (S).
- If blocked: keep the adapter boundary, visibly mark governance "simulated or unavailable", and report the blocker. "Do not replace the sponsor integration with two frontend clicks and claim completion."

### e.6 Strategy timeline and gates (H lines 205–228), with their status as of today [READ, status INFERRED]
| Date | Planned output (H) |
|---|---|
| 30 Sep | Freeze wedge, pick one asset ("mis. forklift", later CNC), invariants, party-visibility matrix |
| 1 Oct | Daml templates, proposal/accept pattern, one-active-passport/lock rule |
| 2 Oct | Daml Script happy path plus unauthorized viewer/action tests |
| 3 Oct | CN Quickstart LocalNet, seed 6 parties, clean deploy/run command |
| 4 Oct | Decentralization Manager shared-control demo |
| 5–6 Oct | Role UI plus Ledger API; side-by-side views; end-to-end pledge |
| 7 Oct | 3–5 validation calls, pilot one-pager, metric baseline, UX fixes |
| 8 Oct | Fresh-machine reproduction, public README, pitch, 5-minute video |
| 9 Oct | Submission audit; deadline 23:59 UTC |

Go/no-go gates (H lines 224–228):
- Persist with Collara if a Daml happy path plus one privacy test exist **before 2 Oct**.
- Narrow to "**Collara Lockbox**" (passport, verification, pledge lock, governed release only) if the frontend or loan flow is too big.
- Full pivot to a "Daml lifecycle/authorization visualizer" only if the contract workflow isn't running by 3 Oct.

[INFERRED] M (2026-10-01 22:43) asks for a full-stack build, which goes against H's Lockbox fallback advice. That is a schedule risk; see C33.

### e.7 Lessons H drew from past winners [READ]
Projects cited (H lines 105–115): Pulla, Tirai, Umbra, Rocky Exchange, IRSForge. The winning pattern (H line 115): "specific problem → irreplaceable Canton reason → real transactions/state transitions → per-party proof → negative tests → reproducible demo." Collara was strong only on the first two steps. [INFERRED] For the UI, this argues for a side-by-side party-view "privacy proof" screen (S §17.4) and visible negative-path results.

H's party-view matrix for the video (H line 180 onward) [READ]:
| Party | Can see | Must not see |
|---|---|---|
| Owner | passport, verification, own applications | unrelated parties' data |
| Verifier | needed identity/evidence and own attestation | offer, interest rate, lender decision |
| Lender A | disclosure package and offer A | offer B, verifier internal notes outside scope |
| Lender B | disclosure package and offer B | offer A |
| Auditor | permitted report while grant is active | all raw asset records permanently |
| Collara operator | minimal operational status | business terms and evidence when not a stakeholder |

Lender B semantics differ from M; see C16.

---

## (f) The docx concept model in English (D1–D6, dated 2026-09-19)

All translations are mine. Original Indonesian is paraphrased faithfully; English terms in the originals are kept as is. Line numbers refer to the `.txt` extractions in `C:\Collara\docs\_research\inputs\`.

### f.1 `Collara.txt`, the overall concept (D1)
- **Title/tagline:** "Collara — Privacy-Preserving Collateral Infrastructure for Real-World Assets" (line 3).
- **Overview (line 5–6):** Canton-based digital infrastructure that lets companies turn high-value physical assets into a *verified digital collateral identity* usable by financial institutions for financing. "Not a loan marketplace and not merely an asset-tokenization platform"; a **trust layer** connecting asset owners, verifiers, lenders, and auditors in a secure, transparent, access-controlled workflow.
- **Problem (7–13):** industrial firms own high-value assets (manufacturing machines, heavy equipment, commercial vehicles, energy equipment, medical equipment). Pain points: asset data scattered across parties; slow verification; fraud and invalid-document risk; no shared trust between organizations.
- **Solution (14–23):** a **Digital Collateral Passport** per asset containing asset identity, ownership record, maintenance history, verification status, insurance status, and collateral eligibility.
- **Why Canton (24–31):** privacy-preserving data sharing (each party sees only what it is entitled to); trusted multi-party workflow; institutional compatibility (permissioned access, auditability, compliance workflow).
- **Roles (32–47):**
  - Asset Owner: register asset, update asset status, request verification.
  - Asset Verifier: validate ownership, verify condition, submit verification report.
  - Financial Institution: review collateral passport, assess financing eligibility, approve financing.
  - Auditor: review history, generate compliance report.
- **End-to-end workflow (48–60):** 1 Asset Registration → 2 Verification (ownership and condition) → 3 Collateral Assessment (bank) → 4 Financing Decision (bank) → 5 Lifecycle Update (every change recorded) → 6 Audit Reporting (auditor inspects full history).
- **MVP scope (61–69):** use case Equipment Financing. Features: Asset Registry, Verification Workflow, Collateral Dashboard, Status Update, Audit Report.
- **Tech architecture (70–78):** Frontend dashboards for owner, bank, and auditor. Backend: workflow engine, user management, API. Canton layer: contracts for asset creation, ownership state, verification state, collateral status. Data layer: asset metadata, permissions, event history.
- **Contract objects (79–85):** Asset Contract (identity), Verification Contract (validation process), Collateral Contract (eligibility status).
- **Business model (86–94):** targets commercial banks, equipment-finance companies, industrial enterprises, insurers, auditors. Revenue: enterprise subscription plus transaction fee.
- **Competitive positioning (95–103):** vs. asset registry, Collara adds collateral readiness; vs. ERP asset management, an inter-organization trust layer; vs. RWA tokenization, a focus on financing workflow; vs. loan marketplaces, a focus on asset verification.
- **Hackathon demo (104–111):** a manufacturer needs financing. Company registers asset → verifier validates → bank reviews passport → bank approves financing → auditor generates report.
- **Pitch (113), English original:** see c.1 (superseded).
- **Vision (114–115):** become the trust infrastructure connecting RWAs and institutional finance.

### f.2 `Collara Canton SMart contract.txt`, contract structure (D2)
Overview: contract-based DLT model managing asset identity, verification, collateral assessment, financing, and audit.

| Contract | Purpose | Data fields | Signatory | Observers | Lifecycle |
|---|---|---|---|---|---|
| **AssetPassport** | Digital identity of a physical asset | Asset ID, Asset category, Manufacturer, Serial number, Owner, Purchase value, Current valuation, Location, Asset status, Creation date | Asset Owner | Verifier, Bank, Auditor | Created → Verified → Active → Transferred → Archived |
| **Verification** | Inspection and validation process | Asset reference, Verification provider, Inspection result, Condition score, Supporting documents, Approval status | Verifier | Asset Owner, Financial Institution, Auditor | Requested → Review → Approved/Rejected |
| **CollateralAssessment** | Whether the asset qualifies as collateral | Asset reference, Lender, Valuation, Risk score, Eligibility status | Financial Institution | (none stated) | Submitted → Evaluated → Eligible/Rejected |
| **Financing** | Financing relationship between lender and owner | Loan ID, Borrower, Lender, Asset collateral, Amount, Duration, Status | (none stated) | (none stated) | Requested → Approved → Active → Completed |
| **AuditRecord** | Records all system activity | Event, Actor, Timestamp, Previous state, New state | (none stated) | (none stated) | "An audit record is created every time a contract changes." |

No choices or controllers are defined. Lifecycles are labels only. H's critique ("Masalah teknis pada desain sekarang", H lines 132–138) [READ, translated]:
- observers are too broad, leaking the whole passport;
- an owner-only signatory can claim any asset, serial, or value;
- "Created → Verified → Active" is a label, not Daml; every transition must be a consuming choice;
- Financing and AuditRecord lack signatory, observer, controller, preconditions, timeouts, and failure paths;
- double pledge is not prevented;
- the loan has no economic action;
- AuditRecord risks becoming a duplicate source of truth.

### f.3 `Collara Complete System Design.txt` (D3)
- Overview: an infrastructure system linking RWAs and institutional financing via Canton.
- **Frontend layer:** dashboards for Asset Owner, Verifier, Bank, Auditor. Functions: asset management, verification request, collateral review, audit reporting.
- **Backend application layer:** Authentication Service (login and roles); Asset Service (asset data); Verification Service (validation); Collateral Service (eligibility); Reporting Service (audit reports).
- **Canton blockchain layer:** runs AssetPassport, Verification, CollateralAssessment, Financing, and Audit contracts; stores state transitions and the inter-party workflow.
- **Data layer:** user profile, asset metadata, document reference, transaction history, analytics data.
- **Integration layer:** banking systems, company ERP, insurance providers, valuation services, "to broaden data sources for collateral verification".
- **Security model:** RBAC, permissioned data sharing, audit trail, identity verification.
- **MVP architecture flow:** User Interface → Backend API → Canton Workflow Engine → Daml Contracts → Audit and Reporting System.

### f.4 `Collara State Transition Design.txt` (D4)
| # | State | Actor | Action | Input / checks | Output |
|---|---|---|---|---|---|
| 1 | Asset Creation | Asset Owner | Company creates a new asset in Collara | Asset info and ownership documents | AssetPassport created with status **CREATED** |
| 2 | Verification Requested | Asset Owner | Owner requests validation | — | Verification contract created and given to the verifier |
| 3 | Asset Verified | Verifier | Inspects the asset | Checks ownership, condition, documents, maintenance | Asset status → **VERIFIED** |
| 4 | Collateral Assessment | Bank / Financial Institution | Evaluates collateral | Asset value, risk, verification status, ownership | **Eligible** or **Rejected** |
| 5 | Financing Active | Financial Institution | Approves financing | — | Financing contract active; asset linked as collateral |
| 6 | Asset Update | Authorized Owner | Changes maintenance, insurance, location, condition | — | Asset history grows |
| 7 | Ownership Transfer | Current Owner and New Owner | Transfers ownership | — | Owner changes; full history retained |
| 8 | Archive | Owner or administrator | Closes the asset lifecycle | — | Asset archived; immutable without a new workflow |

### f.5 `Collara UI.txt`, UI/UX improvement guide (D5)
1. **Readiness:** the documents suffice to *start* MVP development. Already available: product concept, business workflow, Canton/Daml contract structure, state transitions, system architecture, website content. Still needed: UI/UX flow, user journey, screen specification, API specification, database schema, Daml implementation detail. [INFERRED] S, dated 2026-09-30, fills these gaps.
2. **Principles:** enterprise application; users are companies, banks, verifiers, auditors.
   - **Clarity:** users understand asset status without understanding blockchain.
   - **Workflow-driven:** views follow the user's work process.
   - **Role-based:** each user sees relevant features.
   - **Trust Visibility:** verification status, ownership, and audit history must be easy to find.
3. **User journeys:**
   - Owner: Login → Dashboard → Register Asset → Submit Verification → Request Financing.
   - Verifier: Login → Verification Queue → Review Asset → Submit Result.
   - Bank: Login → Collateral Dashboard → Review Passport → Approve Financing.
   - Auditor: Login → Audit Center → Review History → Generate Report.
4. **MVP pages:**
   - Dashboard (Total assets, Pending verification, Eligible collateral, Active financing).
   - Asset Registry (asset list, status, owner, verification state).
   - Asset Detail (identity, verification status, collateral info, timeline history).
   - Workflow Center (activities needing action).
   - Audit Center (reports and history).
5. **UI references:** SAP Asset Management (asset lifecycle, enterprise workflow); Stripe Dashboard (financial dashboard, status management, transaction workflow); Fireblocks (institutional blockchain workflow, permission management); Dune (analytics dashboard, data presentation).
6. **MVP recommendation:** focus on 1) Asset Registration, 2) Verification Workflow, 3) Collateral Review, 4) Audit Timeline. "Don't create too many menus." Add status indicators, approval workflow, timeline history, permission control, report export.
7. **Final UX flow:** Owner creates asset → Verifier validates → Bank reviews collateral → Bank approves financing → Auditor verifies history. Goal: "every user knows what to do, the process status, and the next step."

[INFERRED] Principles 2, 6, and 7 survive into M and S: next actor, next action, blockers, separate states, timeline, export, and few menus (S main nav is 5 items). The dashboard KPIs and the visual references do not survive (C11, C12).

### f.6 `Collara Website Content Specification.txt` (D6)
- **Homepage:** "Collara" / "Privacy-Preserving Collateral Infrastructure for Real-World Assets" / (ID) "Collara helps companies turn physical assets into a trusted digital collateral identity to accelerate access to institutional financing."
- **Problem:** high-value assets are hard to use as collateral because data is scattered, verification is manual, and there is no shared trust between organizations. Collara provides a secure, auditable digital workflow.
- **Solution, "How Collara works":** 1. Register Asset (company creates the asset's digital identity); 2. Verify Asset (an independent party validates); 3. Assess Collateral (bank evaluates eligibility); 4. Enable Financing (financing based on trusted data); 5. Audit Lifecycle (all activity traceable).
- **Canton Advantage:** Privacy (data only to permitted parties); Trust (all parties use the same data source); Auditability (every change recorded in the asset lifecycle).
- **Use case:** Industrial Equipment Financing. Example assets: manufacturing machines, heavy equipment, energy equipment, commercial vehicles. Parties: Asset Owner, Verifier, Bank, Auditor.
- **Role dashboards:**
  - Owner: My Assets, Register Asset, Verification Request, Financing Request, Asset History.
  - Verifier: Pending Verification, Inspection, Approved Assets, Reports.
  - Bank: Collateral Review, Eligible Assets, Financing Status.
  - Auditor: Audit Trail, Compliance Report, History (feature: "see **all** asset changes and generate reports").
- **Contact section:** "Request Pilot". Collara is open to collaboration with companies, banks, and institutions developing Canton-based asset-financing workflows. [INFERRED] This is the origin of the approved `Request a pilot` CTA.

### f.7 Where each docx concept ended up in S and M [READ from S §24, S §11, S §14, and M §6; mapping INFERRED]
| Docx concept | Current treatment |
|---|---|
| AssetPassport (owner signatory, broad observers) | Split into a controlled registry / canonical `AssetControl`, a private `AssetPassport`, and scoped attestation, assessment, proposal, and audit records (S §12.2, §14.1; M §6). Identity lifecycle `DRAFT → REGISTERED → ARCHIVED`; `PLEDGED` is not an identity state (S §11.1). |
| Verification contract (score, approval) | `VerificationRequest` + `VerificationAttestation`: `REQUESTED → IN_REVIEW → ATTESTED / CHANGES_REQUESTED / REJECTED`; attestations can be `EXPIRED / REVOKED / SUPERSEDED` (S §11.2). Issued only by an active, assigned verifier (M §6). |
| CollateralAssessment (risk score, eligibility) | Lender-scoped and case-specific: `NOT_SUBMITTED → SUBMITTED → IN_REVIEW → NEEDS_INFORMATION / ELIGIBLE / REJECTED` (S §11.3). Internal notes and risk score are not shared. |
| Financing contract (Requested→Approved→Active→Completed) | `FinancingProposal`: `DRAFT → ISSUED → ACCEPTED / DECLINED / WITHDRAWN / EXPIRED`; exact-version acceptance; "ACCEPTED is not FUNDED" (S §11.4; M §6). Plus `CollateralLock` (`AVAILABLE / ACTIVE / RELEASE_REQUESTED / RELEASE_REJECTED / RELEASED`) and `ReleaseRequest` (S §11.5). |
| AuditRecord (global) | Removed. Scoped `AuditAccessGrant` plus a projection from the ledger stream; "no global audit contract disclosed to every auditor" (M §6; S §14.1). |
| Ownership Transfer state | Out of the first implementation (M line 17); P2 in S. Transfer paths must not bypass a lock. |
| Asset Update state | Kept as authorized versioning (`POST /api/assets/:id/versions`); a material evidence change triggers re-review (S §11.2–11.3). |
| Archive by owner or admin | Allowed only after a dependency check; generic archive cannot remove a lender lock (S §11.7 #4; M §6). |
| Integration layer | P2, planned only (S §2, §16.3). |
| 4 dashboards (Owner/Verifier/Bank/Auditor) | Role-scoped views within one workspace: nav `Overview, Cases, Assets, Pledges, Audit` (S §8.1). M asks for a lender-led Overview. |

---

## (g) Conflicts, with which source is newer and a recommended resolution

Format: **ID — topic.** Side A (source, date) vs. side B (source, date). The newer side is marked ★. Recommendation [INFERRED].

**C1 — Asset scope.** D1/D6 (09-19) cover a broad set of machinery, heavy equipment, energy equipment, commercial vehicles, and medical equipment. H line 211 (09-30 18:31) uses "e.g. forklift". X line 37 says "forklifts or CNC machines". ★ R, V, I, G, S, L, and M (09-30 19:21 → 10-01) say **used CNC machinery only**. → Use CNC only. The FAQ says other categories are outside the first pilot.

**C2 — Tagline and claims.** D1/D6 use "Privacy-Preserving Collateral Infrastructure for Real-World Assets" and "accelerate access to institutional financing" / "faster institutional financing". ★ L/S use `Private equipment collateral workflows`, with no unproven speed or savings claims. → Do not use the docx tagline or the speed claim anywhere.

**C3 — Lender naming and segment.** D1–D6 say "Bank" / "Financial Institution" and target commercial banks. ★ I/G/S/M say equipment-finance **lenders** (non-bank, specialty finance); I excludes universal banks. → UI says "Lender" everywhere.

**C4 — Roles.** D1–D6 have 4 roles: Owner, Verifier, Bank, Auditor. ★ S §3 has 9: Borrower/Asset Owner, Dealer Contributor, Verifier, Lender Analyst, Lender Approver, Auditor, Organization Admin, Collara Operator, Governance Member. M §5 calls for "borrower, verifier, and auditor views" with dealer contributions inside case/evidence tabs. → Follow S/M.

**C5 — Passport authorization and visibility.** D2: owner-only signatory, with Verifier, Bank, and Auditor as permanent observers. ★ H, S §12.2, and M §6: a controlled registry, separated minimal shared control vs. private records, and no broad observers. → Follow M.

**C6 — Single "VERIFIED" status.** D2/D4 use `CREATED → VERIFIED → Active…`. ★ S §11 line 791: "Do not use one `VERIFIED` status to summarize the whole process." M §5 keeps evidence, verification, review, proposal, and pledge separate. → Separate state machines; the landing copy (`Status without guesswork`) depends on this.

**C7 — Financing lifecycle.** D2 uses `Requested → Approved → Active → Completed` with Amount and Duration. ★ S §11.4 / M §6 use proposal/acceptance states; no disbursement; `ACCEPTED ≠ FUNDED`; no "Completed" loan state. → No loan "active" or "completed" states in the UI.

**C8 — AuditRecord.** D2 creates a global AuditRecord on every change. ★ M line 121: "no global audit contract disclosed to every auditor." S §14.1 says the same. → Scoped grants plus a projection.

**C9 — Ownership transfer.** D4 state 7 and H's AssetPassport `Transfer` choice treat transfer as a feature. Me check #4 says "pledged-asset transfer rejected", and R's demo says "show a second pledge and transfer are rejected". ★ M line 17 puts ownership transfer outside the first implementation, while line 119 says "future transfer paths cannot bypass a lock". S makes it P2. → No transfer feature in the MVP. Me check #4 then has nothing to exercise; substitute "replacement-control / generic-archive bypass rejected" (M §11). The hackathon metrics checklist and R's demo script need updating (open question Q8).

**C10 — Archive authority.** D4 says "Owner or administrator" can archive. ★ M/S: archive, cancellation, or corrections cannot bypass a lock, and admins cannot override. → Follow M.

**C11 — Dashboard KPIs.** D5 Dashboard shows "Total assets, Pending verification, Eligible collateral, Active financing". D6 has "Eligible Assets". ★ S §9.1: "show work requiring action, not vanity metrics"; no `TVL`; money only as labeled recorded principal or valuation. M asks for a "Lender-led Overview" and "Recharts only for useful, implemented metrics". → Action-queue overview.

**C12 — Visual references.** D5 references SAP, Stripe Dashboard, Fireblocks, and Dune. ★ M line 74: the dashboard is "Mercury-inspired" and the landing follows the "previously approved Collara direction". S §24 excludes D5's visual direction. LP says "do not imitate Linear, Mercury, Canton". → Follow M; do not copy any brand.

**C13 — Governance scope (major).** H lines 159–160: make "CollateralAdmin" a decentralized party with 2-of-3 approval for "verifier revocation, dispute override, emergency freeze, **and collateral release**". X line 30: "Demonstrate **governed release** through a decentralized CollateralAdmin party". H line 226 "Lockbox": "...governed release". ★ R (19:21), V, S §9.20/§16.2, and M §8: **verifier-registry administration only (Add Verifier, Suspend Verifier)**; "Release requires the designated lender's authorization. Borrower, verifier, application admin, and governance cannot release it independently" (M line 118). → Governance never touches release.

**C14 — Default / cure / enforcement.** H line 175: `CollateralLock` choices `Release, DeclareDefault, Cure`, and the flow "Release / default". ★ S §1.3 / L: no liquidation or enforcement; enforcement remains with the lender. M has no default path. → No default or cure in the MVP.

**C15 — Acceptance vs. activation.** H line 174: `FinancingProposal.AcceptAndLock`, "acceptance locks the passport atomically". ★ S §14.2 and M's journey have separate steps: "borrower acceptance → activate collateral pledge". M line 113: "Activation consumes the same available control contract atomically". → Separate Accept and Activate steps; atomicity applies at activation. Combining them is a design option only if M's journey and the tabs still show both. M is authoritative: keep them separate.

**C16 — Meaning of "Lender B".** H's party matrix (lines 185–187) treats Lender B as a competing lender holding "Disclosure package and offer B". ★ M line 164/169 and S §17.3: `Demo Lender B` is an **unrelated lender that cannot access the case**. → Follow M. A competing-offer scenario is not in scope.

**C17 — Revenue model and customers.** D1: enterprise subscription plus **transaction fee**; customers include banks, insurers, and auditors. ★ G: the lender pays; paid pilot US$500–1,500 then subscription; "No token is required." → Do not mention transaction fees or pricing on the site.

**C18 — Demo video length.** H line 218 and X: a 5-minute video and demo. R (19:21, newer): a 2:30 outline. The official limit is not found in the sources. → Open question Q5.

**C19 — Tech stack and Docker.** R lists "React, TypeScript, Tailwind CSS, Docker Compose" with no backend or database. ★ M §3: Next.js App Router, Fastify, PostgreSQL + Drizzle, OIDC (Keycloak default), S3/MinIO, worker, TanStack, shadcn, and "Docker Compose". **Environment fact (task context):** there is no Docker on Windows or WSL. CN Quickstart LocalNet (named in R and H) and Keycloak/MinIO via Compose assume Docker [INFERRED]. → Major environment conflict for the infra researcher. The registration Tech Stack field must be updated before final submission (R itself says so).

**C20 — Demo data labels.** S §17.1 line 1074: "All pages show `Demo data — LocalNet`". The prototype hero card uses `Demo data — LocalNet`. ★ M lines 101–102: `Synthetic demo data — UI mockup.` / `Synthetic demo data — Canton LocalNet.` → Use M's strings for in-app banners. Keep the landing preview's `Illustrative demo case` (L). Whether the landing preview chip should read `Synthetic demo data — UI mockup.` is open question Q6.

**C21 — Case Workspace tabs.** S §9.13 has 8 tabs: `Summary`, `Evidence`, `Verification`, `Review`, `Proposal`, `Pledge`, `Sharing`, `Activity`. ★ M line 84 has 6: "Evidence, Verification, Sharing & Access, Review, Proposal, and Activity", with Pledge Detail as a separate screen (M #6). → Use M's six (label `Sharing & Access`). Add a header summary (next actor, next action, blockers, data source, last sync; M line 93) in place of a Summary tab. Optionally link the active pledge from the header.

**C22 — Navigation and Governance visibility.** S §8.1: main menu `Overview`, `Cases`, `Assets`, `Pledges`, `Audit`; Governance "only appears if the sponsor module is available and the user has a mandate". ★ M #8 lists a "Verifier Registry and Governance" screen and §8: "If sponsor integration is blocked... **visibly mark governance as simulated or unavailable**." → Show the Governance entry to mandated users with an explicit `unavailable` or `simulated` status rather than hiding it. Add a Verifier Registry screen; S has no route for it (it only has `/app/governance`). See Q7.

**C23 — Priority of `/demo`.** S §4.1: `/demo` is P0. M priority #1 is "Landing, Docs, and Request a Pilot", and step 2 is the "mock walkthrough". Not a hard conflict. → Build `/demo` as a walkthrough but keep it unlinked until §(b) gating passes.

**C24 — Command lifecycle failure states.** S §15.3: `REJECTED`, `FAILED`, `UNKNOWN_OUTCOME`, `PROJECTION_DELAYED`. ★ M line 141: "explicit rejected, unknown-outcome, and projection-delayed handling" (no FAILED). → Minor. Keep `FAILED` for pre-submit or infra errors if useful. Copy for each is in S §18.2.

**C25 — Prospect lists.** I names Crest Capital, Commercial Credit Group, and Amur. ★ G names Commercial Credit Group / Manufacturers Capital, Crest Capital, and Resell CNC. → Not a UI issue; never display either list.

**C26 — Parties count and the "registry" party.** Me targets "≥4 application parties: owner, verifier, lender, and registry". H plans to "seed 6 parties". ★ M fixtures: Demo Manufacturer, Demo CNC Dealer, Demo Verifier, Demo Lender A, Demo Lender B, Demo Auditor (6 orgs), plus 3 governance members. M also requires controlled registration with "bootstrap/registrar trust". → The fixture list needs a **registrar/operator party** that M names only implicitly (open question Q9).

**C27 — Valuation placement.** D2: `Purchase value` and `Current valuation` on the AssetPassport. ★ S §9.5/§9.11: an optional "Claimed acquisition value" on registration, with valuation recorded in the lender's assessment. M §7/§9: "distinguish equipment valuation from financing principal"; illustrative valuation USD 150,000 vs. requested principal USD 100,000. → Valuation is lender-assessment data; principal is proposal data. Never on the passport as truth.

**C28 — Scores.** D2 has a "Condition score" (verification) and a "Risk score" (assessment). ★ S: a verification checklist with findings and limitations, no score; "Lender internal risk score is not a field all counterparties may see." → No condition score in the MVP; risk score only in lender-internal notes, if at all.

**C29 — "Trust: all parties use the same data source."** D6 Canton Advantage. ★ L Canton section: `Shared workflow rules without shared access to everything.` → Use the L copy.

**C30 — Auditor visibility.** D6: the auditor sees "all asset changes"; D1: the auditor "can inspect the entire history". ★ L/S/M: an explicit, scoped grant only. → Follow M.

**C31 — Integrations.** D3 integration layer (banking, ERP, insurance, valuation). ★ S: P2, planned, no logos. → Exclude from the MVP UI, or show only as "planned" in docs.

**C32 — Hackathon schedule vs. scope.** H's 9-day plan has Daml templates on 1 Oct, a happy path plus privacy test by 2 Oct (go/no-go), and LocalNet on 3 Oct. ★ M (1 Oct 22:43) asks for a full-stack migration and a complete journey first, then BitSafe. [INFERRED] The H gates are effectively at risk. The submission is due 9 Oct 23:59 UTC.

**C33 — Lockbox fallback vs. full scope.** H recommends narrowing to "Collara Lockbox" if the frontend or loan flow is too big. ★ M: implement the full journey, including proposal and acceptance. → M governs, but the time risk should be surfaced to the user (Q10).

**C34 — Pivot recommendation.** SL (09-30 21:43) recommended pivoting to "DamlGuard". ★ G (23:06), S/L (23:44), LP (10-01 00:34), and M (10-01 22:43) all continue with Collara. → Treat SL as superseded [INFERRED].

**C35 — Logo color and brand palette.** LP: one flat **deep teal `#0F766E`** C monogram, "consistent with the Collara direction". The output `collara-logo.png` is teal on transparent, 1254×1254. The prototype's `C:\Collara\Collara Website\assets\collara-mark.png` is the **same C shape rendered white/near-white** (384,138 bytes, the same file as `uploads\ChatGPT Image Oct 1, 2026, 12_36_04 AM.png`). The prototype landing and dashboard CSS contain **no teal**: they use a dark monochrome palette (`#08090A`, `#0E0F11`, `#F7F8F8`, `#9C9DA1`, `#62666D`) with fonts **Geist** and **Red Hat Mono**. M: "Preserve the approved Collara logo". → The prototype is the later artefact, using the 00:36 white mark vs. the 00:33 teal PNG [INFERRED from file names]. Which mark and colorway is "approved", and whether teal is a brand accent, needs user confirmation (Q4).

**C36 — `Sign in` destination.** L: `Sign in` → `/login`. Prototype: `Sign in` → `Collara Dashboard.dc.html`. → Migrate to `/login` (OIDC). The prototype link is an artefact.

**C37 — Pre-demo Final CTA unspecified.** L specifies the pre-demo swap only for the hero (line 51). For the Final CTA it only says "Explore the demo… only after the demo is available". Prototype: `Request a pilot` + `Read the workflow →`. → Mirror the hero rule (as in §b.1) and confirm with the user (Q2).

**C38 — Arrow glyph.** The prototype renders `Read the workflow →`; approved copy is `Read the workflow`. → Treat a trailing arrow as a decorative icon (Lucide `ArrowRight`, `aria-hidden`), not as text.

**C39 — "Verifier-signed passport" wording.** V line 17: "Review a verifier-signed equipment passport". ★ S/M: the passport is registered by the owner through a controlled registry; the **attestation** is what the verifier signs. → Avoid "verifier-signed passport" in the UI; say "attestation".

**C40 — Core flow in Metrics omits proposal.** Me line 45: "register equipment → verifier attestation → lender pledge → authorized release". ★ M: includes sharing, review, proposal, acceptance, and export. → Follow M; the Me tester script needs updating.

**C41 — "Lifecycle labels Active/Transferred" vs. `REGISTERED`.** D2 vs. S §11.1. → Use S's vocabulary, as shared through `packages/domain` (M §4).

---

## Open questions for the user

- **Q1:** If only `UI_MOCK` works, may the landing promote `Explore the demo`? If yes, what disclosure replaces `The demo uses synthetic data on LocalNet. No funds are transferred.`? (Default: keep the pre-demo copy.)
- **Q2:** Confirm the pre-demo Final CTA: `Request a pilot` + `Read the workflow`, mirroring the hero as the prototype does.
- **Q3:** In pre-demo mode, keep or hide FAQ `Does the demo move money?`. Also confirm that the footer `Demo` link should be omitted.
- **Q4:** Which logo asset and colorway is approved: the teal `#0F766E` (`collara-logo.png`) or the white mark on dark (`collara-mark.png`)? Is teal a brand accent token?
- **Q5:** What are the official HackCanton S3 demo-video length and submission requirements (5 min vs. 2:30)? What is the eligibility rule ("1,000 Mana / 10 activity days")?
- **Q6:** Should the landing hero preview chip use M's `Synthetic demo data — UI mockup.`, or keep only `Illustrative demo case`?
- **Q7:** Verifier Registry route naming (for example `/app/governance` plus `/app/verifiers`), and governance entry visibility when the integration is unavailable.
- **Q8:** Replace Metrics check #4 ("pledged-asset transfer rejected") with replacement-control and archive bypass tests, since transfer is out of scope?
- **Q9:** Which party acts as registrar/operator for controlled registration in the fixtures?
- **Q10:** Given the 2026-10-09 23:59 UTC deadline and no Docker, should the build accept H's "Lockbox" narrowing if LocalNet setup slips?
- **Q11:** Approved replacement copy for the Canton section and the FAQ double-pledge answer once the tests pass, or keep the future/planned tense through the submission?
