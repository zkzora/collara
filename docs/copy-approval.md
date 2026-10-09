# Copy approval — every public-facing string marked INFERRED

Status, 2026-10-05: **nothing in this list is approved.** Built from `grep -rn INFERRED` over `apps/`, `packages/` and `docs/submission/` at a894f8b. No copy in code was changed while writing this file. Approved copy (backticks in `docs/_research/spec-*.md`, `packages/domain/src/copy.ts` without an INFERRED tag) is out of scope and must stay verbatim.

**Summary: 179 approval items (+7 changed or added on 2026-10-09, §9)** (some items group closely related strings, e.g. one dialog or one list; about 250 individual strings in all) — §1 domain copy constants 26, §2 global UI states 8, §3 public demo gate (`/`, `/demo`, `/pilot` notice, incl. the replaced approved FAQ answer) 19, §4 `/pilot` form 25, §5 `/docs` incl. capability table 57, §6 workspace 24, §7 API refusals shared with the UI mockup client 18 (strings present in both are counted once), §8 submission documents 2 (whole-document approval). Two items propose a wording change (30, 63); all others keep the current text. Line numbers are the line where the string starts (or the INFERRED marker for a group).

"Proposed final text" is `= same` unless a change is clearly better; no proposal adds a claim. Where a proposal differs, approving the item means approving the proposed text (someone then edits the code).

- [ ] **Approve all items below as proposed** (owner initials and date: ________)

Not listed (INFERRED marker but not user-facing text): API endpoint paths (`packages/api-client/src/client.ts:252`, `:306`), the `dealerOrgId` field (`packages/domain/src/dto.ts:370`), navigation rules (`dto.ts:209`), fixture values (`packages/domain/src/fixtures/extra.ts:3`), code comments (`apps/api/src/workflow/governance/rules.ts:2`).

## 1. Domain copy constants (`packages/domain/src/copy.ts`)

1. [ ] approve — `copy.ts:13` DEVNET banner — current: "Synthetic demo data — Canton DevNet." — proposed: = same (follows the approved banner pattern)
2. [ ] approve — `copy.ts:18` UI_MOCK environment chip — "UI mockup" — = same
3. [ ] approve — `copy.ts:21` DEVNET environment chip — "DevNet" — = same
4. [ ] approve — `copy.ts:37` — "Recorded in the UI mockup. No ledger transaction was submitted." — = same
5. [ ] approve — `copy.ts:38` — "Saved as an application record. No ledger transaction was submitted." — = same
6. [ ] approve — `copy.ts:40` — "Recorded in the governance simulation." — = same
7. [ ] approve — `copy.ts:41` — "Executed in the governance simulation. Registry updated." — = same
8. [ ] approve — `copy.ts:42` — "Proposal opened in the governance simulation." — = same
9. [ ] approve — `copy.ts:55` — "Your role or mandate does not permit this action." — = same
10. [ ] approve — `copy.ts:57` — "This request key was already used for a different action." — = same
11. [ ] approve — `copy.ts:59` — "Some fields need attention." — = same
12. [ ] approve — `copy.ts:117` (adapted, "needs copy approval") — "Eligibility applies to this lender and case only. It does not make the passport eligible elsewhere and it does not promise funding." — = same
13. [ ] approve — `copy.ts:123` — "Uploads are not virus-scanned in this synthetic-only demo." — = same
14. [ ] approve — `copy.ts:137` — "Simulated" — = same
15. [ ] approve — `copy.ts:139` — "Partial — governance contracts on one local participant; decentralized party not demonstrated" — = same
16. [ ] approve — `copy.ts:140` — "Decentralization Manager · local 3-node topology · one operator" — = same
17. [ ] approve — `copy.ts:141` — "Unavailable" — = same
18. [ ] approve — `copy.ts:150` — "Use plain text without control characters." — = same
19. [ ] approve — `copy.ts:152` — "Stored as a private application record. The ledger records a reference only, never the text." — = same
20. [ ] approve — `copy.ts:154` — "The note is shown once the action is confirmed." — = same
21. [ ] approve — `copy.ts:155` — "Notes and questions" — = same
22. [ ] approve — `copy.ts:156` — "No notes or questions on this request." — = same
23. [ ] approve — `copy.ts:157` — "Visible to the borrower and the designated lender only." — = same
24. [ ] approve — `copy.ts:162` — "Request note" — = same
25. [ ] approve — `copy.ts:163` — "Lender question" — = same
26. [ ] approve — `copy.ts:164` — "Borrower response" — = same

## 2. Global UI states (`apps/web/src`)

27. [ ] approve — `lib/commands.ts:20` — "Recording in the UI mockup…" — = same
28. [ ] approve — `components/collara/ledger-sync.tsx:12` — "No ledger connection · UI mockup" — = same
29. [ ] approve — `components/collara/ledger-sync.tsx:13` — "Ledger sync not reported yet" — = same
30. [ ] approve — `components/collara/error-state.tsx:227` — "This action is not permitted for your role." — proposed: "Your role or mandate does not permit this action." (same wording as item 9; mandates also gate actions)
31. [ ] approve — `error-state.tsx:228` — "Your session has ended." — = same
32. [ ] approve — `error-state.tsx:229` — "The Collara service could not be reached." — = same
33. [ ] approve — `error-state.tsx:230` — "This page does not exist." — = same
34. [ ] approve — `error-state.tsx:231` — "Something went wrong while loading this view." — = same

## 3. Public demo gate (`/`, `/demo`, `/pilot` notice)

35. [ ] approve — `components/marketing/public-demo.ts:33` hero and demo disclosure (UI mockup promoted) — "The demo is a UI mockup with synthetic data. It is not connected to a ledger, and no funds are transferred." — = same
36. [ ] approve — **replaced approved FAQ answer** `components/marketing/landing.tsx:441` — approved original (`landing.tsx:432`, kept for LocalNet): "No. The demo uses synthetic records on LocalNet. Cash settlement and MainNet wallet payments are outside the initial scope." — current UI-mockup replacement: "No. The demo is a UI mockup with synthetic records and no ledger connection. Cash settlement and MainNet wallet payments are outside the initial scope." — = same (only the middle sentence differs)
37. [ ] approve — `components/marketing/demo-content.tsx:43` chip — "Synthetic UI mockup" — = same
38. [ ] approve — `demo-content.tsx:47` — "{disclosure} The workspace runs entirely in your browser. The LocalNet version of the demo, with Daml contracts on a local Canton sandbox, runs only on a developer machine and is not available here." — = same
39. [ ] approve — `demo-content.tsx:58` heading — "The case" — = same
40. [ ] approve — `demo-content.tsx:60` — "CL-001 is one used CNC financing case. Demo Manufacturer, the borrower, has registered a CNC machining center (ASSET-DEMO-001, model DEMO-CNC-500, serial SYNTH-CNC-001). Demo Verifier has attested its evidence, and the evidence package is shared with Demo Lender A, the selected lender. The requested principal is USD 100,000.00; the lender's collateral valuation of USD 150,000.00 is a separate figure." — = same
41. [ ] approve — `demo-content.tsx:70` heading — "Walk through it in this order" — = same
42. [ ] approve — `demo-content.tsx:72` — "On the sign-in page, choose a demo persona. Switch personas later with the selector in the workspace sidebar." — = same
43. [ ] approve — `demo-content.tsx:15` step 1 — "Dana Reyes · Lender Analyst, Demo Lender A. Starts the review of CA-001 and submits it for approval." — = same
44. [ ] approve — `demo-content.tsx:16` step 2 — "Morgan Hale · Lender Approver, Demo Lender A. Records the collateral decision and issues the proposal." — = same
45. [ ] approve — `demo-content.tsx:17` step 3 — "Plant manager · Borrower, Demo Manufacturer. Accepts the exact proposal version and authorizes pledge activation." — = same
46. [ ] approve — `demo-content.tsx:18–20` steps 4–6 — "Morgan Hale · Lender Approver. Activates the pledge." / "Plant manager · Borrower. Requests release. The collateral lock stays active." / "Morgan Hale · Lender Approver. Authorizes the release." — = same
47. [ ] approve — `demo-content.tsx:21–22` steps 7–8 — "Plant manager, then Morgan Hale. Each grants the auditor access to their own records." / "Audit lead · Auditor, Demo Auditor. Exports the case report within the granted scope." — = same
48. [ ] approve — `demo-content.tsx:87` — "To see what an unrelated party gets, switch to Lender B approver: the case is unavailable to Demo Lender B." — = same
49. [ ] approve — `demo-content.tsx:92` heading — "Where your changes live" — = same
50. [ ] approve — `demo-content.tsx:26` — "Changes you make are kept in memory in this browser tab only. Reloading the page, or opening the workspace in another tab, starts again from the seeded CL-001 data; only the persona you chose is remembered for the tab. Your actions are not sent to a server or a ledger." — = same
51. [ ] approve — `demo-content.tsx:51` button — "Start the demo" — = same
52. [ ] approve — `demo-content.tsx:109` `/pilot` notice title — "This form is an example on this deployment." — = same
53. [ ] approve — `demo-content.tsx:111` — "This site runs as a UI mockup. Nothing you enter here is sent or stored, and no one will contact you." (+ approved link "Explore the demo" + "instead.") — = same

Note on the gate (`public-demo.ts`): `PUBLIC_DEMO_STATUS` accepts only `off`, `ui_mock`, `localnet`; there is no DevNet promotion copy. A DEVNET deployment resolves to `off` (pre-demo hero line, `/demo` unlinked). DevNet promotion copy would be new INFERRED copy and is not proposed here.

## 4. `/pilot` form (`components/marketing/pilot-form.tsx`, `packages/domain/src/dto.ts`)

54. [ ] approve — `pilot-form.tsx:31` — "Enter your full name." — = same
55. [ ] approve — `:32` — "Enter a valid work email address." — = same
56. [ ] approve — `:33` — "Enter your company name." — = same
57. [ ] approve — `:34` — "Enter your role." — = same
58. [ ] approve — `:35` — "Choose a company type." — = same
59. [ ] approve — `:36` — "Enter your country." — = same
60. [ ] approve — `:37` — "Enter the equipment category." — = same
61. [ ] approve — `:38` — "Choose an approximate number of cases, or Unknown." — = same
62. [ ] approve — `:39` — "Describe your current workflow challenge." — = same
63. [ ] approve — `:40` — "Keep this answer shorter." — proposed: "Shorten this answer." (instruction form like the others)
64. [ ] approve — `:41` — "Confirm that we may contact you about this request." — = same
65. [ ] approve — `:42` (honeypot) — "Leave this field empty." — = same
66. [ ] approve — `:166` — "This request was simulated in the UI mockup. It was not sent or stored, and no one will contact you." — = same
67. [ ] approve — `:166` button — "Edit request" — = same
68. [ ] approve — `:305` — "The consent wording and retention period are pending legal review. See Privacy." — = same (consent wording itself is BPD-1, not proposable here)
69. [ ] approve — `:325` — "This form is not connected to the API in the UI mockup. Submissions are simulated and not sent." — = same
70. [ ] approve — `dto.ts:1017` — "Equipment-finance lender" — = same
71. [ ] approve — `dto.ts:1018` — "Equipment dealer" — = same
72. [ ] approve — `dto.ts:1019` — "Equipment owner or manufacturer" — = same
73. [ ] approve — `dto.ts:1020` — "Inspector or appraiser" — = same
74. [ ] approve — `dto.ts:1021` — "Other" — = same
75. [ ] approve — `dto.ts:1026` — "1–5" — = same
76. [ ] approve — `dto.ts:1027` — "6–20" — = same
77. [ ] approve — `dto.ts:1028` — "21–50" — = same
78. [ ] approve — `dto.ts:1029` — "More than 50" — = same

## 5. `/docs` (`components/marketing/docs.tsx`, `app/(marketing)/docs/page.tsx`, `packages/domain/src/capabilities.ts`)

Template strings fill counts, dates and hosts from `packages/domain/src/evidence.ts`; approval covers the wording, the numbers stay whatever EVIDENCE records.

79. [ ] approve — `docs/page.tsx:29–31` metadata — title "Collara — Docs"; description "Collara documentation: overview, workflow, roles and permissions, synthetic demo scenario, BitSafe governance, and where to find setup, API and test records. Local demo with synthetic data." — = same
80. [ ] approve — `docs.tsx:45` nav label — "BitSafe governance" (was approved "Planned BitSafe governance") — = same
81. [ ] approve — `docs.tsx:72` status chip — "Local demo" — = same
82. [ ] approve — `docs.tsx:78` status banner — "Synthetic data only. The LocalNet demo runs on one machine, against a Canton 3.5.19 sandbox with one participant. Only the web app is deployed, as a UI mockup on {host}; the API, ledger and database are not, and nothing is deployed to a Canton Network. Nothing here is production-ready." — = same
83. [ ] approve — `docs.tsx:165` card title — "Project status: local demo build" — = same
84. [ ] approve — `docs.tsx:167` card paragraph — "Everything uses synthetic data. The public site and the workspace are one web app, and the workspace has two modes. … Nothing on this page is a claim of production readiness or a security assurance." (full text at that line) — = same
85. [ ] approve — `docs.tsx:122` — "{n} Daml Script tests of the contract model: invariants, attack attempts and contract visibility" — = same
86. [ ] approve — `docs.tsx:123` — "LocalNet integration tests through the API on the sandbox with one participant: … before the contract change that closed the revocation race; after it, …" — = same
87. [ ] approve — `docs.tsx:124` — "A LocalNet browser walkthrough of CL-001 from a clean start: {n} tests" — = same
88. [ ] approve — `docs.tsx:125` — "Witness-level privacy on {n} participants: … All participants ran on one machine under one operator, so this does not show isolation between independent operators." — = same
89. [ ] approve — `docs.tsx:126` — "Tier A governance (Decentralization Manager governance contracts, {k} of {n} seats, no decentralized party) on the sandbox with one participant: {n} integration tests. The workspace uses it." — = same
90. [ ] approve — `docs.tsx:127` — "Tier B governance with {n} Decentralization Manager nodes and a decentralized governance party, run by scripts on a separate local topology under one operator: {n} checks. The workspace does not use it." — = same
91. [ ] approve — `docs.tsx:128` — "{n} unit tests (commit {sha})" — = same
92. [ ] approve — `docs.tsx:129` — "CI on GitHub Actions passed (run {id}, commit {sha}): typecheck, lint, unit tests and build; Playwright in UI mockup mode ({n} passed); the Daml build and tests" — = same
93. [ ] approve — `docs.tsx:145` — "Deployed: the web app in UI mockup mode, on {host} ({date}). It holds synthetic data in the browser only." — = same
94. [ ] approve — `docs.tsx:146` — "Not deployed: the API, the worker, PostgreSQL, document storage and the Canton ledger. Nothing is deployed to a Canton Network." — = same (must be edited if the Render deployment happens)
95. [ ] approve — `docs.tsx:147` — "Canton DevNet: {status}. Governance there would be Tier A only ({status}); Tier B on DevNet: {status}." — = same
96. [ ] approve — `docs.tsx:151–156` "Not verified" list — "Independent operators: the privacy and Tier B runs each had one operator for every node" / "Tier B governance in the workspace: the API and UI still use Tier A" / "Docker Compose and the container images" / "Keycloak sign-in through a browser, and Secure cookies over HTTPS" / "Ledger authentication with JWKS tokens for a real participant" / "Persistence across sandbox restarts: the sandbox keeps ledger state in memory" — = same
97. [ ] approve — `docs.tsx:174` headings — "What was run ({period})", "Deployment", "Not verified" — = same
98. [ ] approve — `docs.tsx:181` — "Details, including runs that could not complete, are in docs/verification.md, …" — = same
99. [ ] approve — `docs.tsx:209` overview lead (replaces approved "It is being designed as Daml workflows on Canton.") — "It is built as Daml workflows on Canton and runs today as a local demo with synthetic data." — = same
100. [ ] approve — `docs.tsx:445` Lender approver role body — "Records the collateral decision, issues or withdraws proposals, co-authorizes activation, and authorizes or rejects release. Holds the organization's governance seat." ("(planned)" removed) — = same
101. [ ] approve — `docs.tsx:513` chips — "LocalNet demo" / "LocalNet demo planned" — = same
102. [ ] approve — `docs.tsx:523` demo lead (replaces approved "Today the scenario runs as a local projection…") — "The scenario runs in two modes. In UI mockup mode it is a local projection inside the workspace. In LocalNet mode it is seeded as committed Daml contracts on a local Canton 3.5.19 sandbox with one participant, and checked by access-denial and authorization tests." — = same
103. [ ] approve — `docs.tsx:611` card title — "Known limits of UI mockup mode" (was "Known limits of the mockup") — = same
104. [ ] approve — `docs.tsx:622` card title — "Known limits of LocalNet mode" — = same
105. [ ] approve — `docs.tsx:626` — "One participant hosts every organization's party, so its operator sees every transaction. It is not a privacy boundary." — = same
106. [ ] approve — `docs.tsx:627` — "Ledger state is held in memory and is lost when the sandbox restarts." — = same
107. [ ] approve — `docs.tsx:628` — "Analyst and approver mandates are enforced by the API; the ledger sees only the organization's party." — = same
108. [ ] approve — `docs.tsx:629` — "Revocation of an attestation is checked by the API before pledge activation, not by the ledger at activation." — = same
109. [ ] approve — `docs.tsx:657` kicker and chips — "05 · BitSafe governance"; "Tier A implemented"; "Tier B integration planned" — = same
110. [ ] approve — `docs.tsx:673` governance lead from "Tier A is implemented: …" to "…the workspace simulates governance in the browser." — = same
111. [ ] approve — `docs.tsx:686` card title — "Design (Tier A)" — = same
112. [ ] approve — `docs.tsx:689` row "Rules contract" — "Decentralization Manager v1.12.0 GovernanceRules, on one local Canton participant" — = same
113. [ ] approve — `docs.tsx:692` row "Seat parties" — "One member party and ledger user per seat, never the organization's business party" — = same
114. [ ] approve — `docs.tsx:700` row "Expiry" — "{d} days after opening if not executed; each confirmation lapses after {t} on the local sandbox ({d} days in UI mockup mode)" — = same
115. [ ] approve — `docs.tsx:704` row "Suspension effect" — "The verifier can no longer accept assignments or issue attestations; … Active pledges are not affected." — = same
116. [ ] approve — `docs.tsx:708` row "Trust limit" — "One operator runs every seat. The governance party is an ordinary local party: whoever holds its credential could sign registry changes without the seat quorum." — = same
117. [ ] approve — `docs.tsx:716` card title — "In LocalNet mode (Tier A)" — = same
118. [ ] approve — `docs.tsx:720–724` items — "Proposals, confirmations and execution as committed contracts, each seat acting as its own party" / "Proposal deadline and confirmation expiry enforced on the ledger" / "Registry check when the owner requests verification (API) and when the verifier accepts or attests (ledger)" / "Re-adding a suspended verifier through an Add verifier proposal" / "Tested through the API and on the ledger: one confirmation cannot execute, a seat cannot count twice, a stale proposal fails, and users without a seat get 404" — = same
119. [ ] approve — `docs.tsx:729` card title — "Simulated in UI mockup mode" (was "Simulated in the workspace today") — = same
120. [ ] approve — `docs.tsx:746` — "Tier B in the workspace: Decentralization Manager nodes and a decentralized governance party (exercised by scripts on a local three-node topology only)" — = same
121. [ ] approve — `docs.tsx:747` — "Independent operators, one participant node per seat holder" — = same
122. [ ] approve — `docs.tsx:749` — "Governance procedures: who may hold a seat, rotation and disputes (not yet specified)" — = same
123. [ ] approve — `docs.tsx:794` heading — "In the source repository, written from local runs" — = same
124. [ ] approve — `docs.tsx:796` lead — "Setup instructions, the API reference and the test record are kept in the Collara source repository, not on this page. … None of them is a production deployment guide or a security assurance." — = same
125. [ ] approve — `docs.tsx:762–779` repo doc cards — Setup / API reference / Tests / Demo script bodies (four strings at those lines) — = same
126. [ ] approve — `docs.tsx:≈815` — "UI mockup mode needs only the web app. Its actions are recorded in the browser, and no ledger transaction is submitted. Also in the repository: …" — = same
127. [ ] approve — `capabilities.ts:22` legend — "Implemented" / "Built and tested locally, synthetic data" (replaces "None at this time") — = same
128. [ ] approve — `capabilities.ts:24` legend — "Not available" / "Not available in this build" — = same
129. [ ] approve — `capabilities.ts:57` "where" — "LocalNet mode runs locally only; UI mockup mode is deployed · " — = same
130. [ ] approve — `capabilities.ts:63` "where" — "{n} Daml Script tests · " — = same
131. [ ] approve — `capabilities.ts:72` "where" — "API tests on one participant; ledger privacy on {n} participants, one operator · " — = same
132. [ ] approve — `capabilities.ts:81` "where" — "Canton 3.5.19 sandbox, one participant, not Splice LocalNet; {n} integration tests · " — = same
133. [ ] approve — `capabilities.ts:93–94` "where" and link — "Tier A on one local participant; Tier B scripted on a local topology with one operator ({n} checks), not in the app; neither tier on DevNet · " + link "BitSafe governance" — = same
134. [ ] approve — `capabilities.ts:102` "where" — "DM governance contracts used in Tier A; DM nodes run only in the scripted Tier B check, not connected to the app" — = same
135. [ ] approve — `capabilities.ts:107–109` row — label "Canton DevNet (shared participant)"; "DevNet mode: {status}" — = same

## 6. Workspace (`apps/web/src/components/workspace`, `packages/domain/src`)

136. [ ] approve — `cases/create-case-schema.ts:10` — "Enter a case name." — = same
137. [ ] approve — `:11` — "Use at most 120 characters." — = same
138. [ ] approve — `:12` — "Select a registered asset." — = same
139. [ ] approve — `:13` — "Select a lender." — = same
140. [ ] approve — `:14` — "Use at most 500 characters." — = same
141. [ ] approve — `:15` — "Enter an amount such as 100000.00 (at most two decimals), or leave it empty." — = same
142. [ ] approve — `domain/workflow.ts:73–74` — "Register the asset before creating a case." / "This asset already has an active case workflow." — = same
143. [ ] approve — `domain/workflow.ts:352–354` — "This consent request has expired. Ask the owner for a new request." / "This consent request has already been answered." / "Only granted consent can be withdrawn." — = same
144. [ ] approve — `domain/states.ts:337–343` consent states — "Awaiting consent", "Consent granted", "Declined", "Consent withdrawn", "Revoked by the owner", "Expired", "Request withdrawn by the owner" — = same
145. [ ] approve — `access/consent-requests.tsx:69–76` approve dialog — button "Approve"; title "Approve consent · {id}"; description "Shares {docs} with {recipient} for {purpose} on {case}, with {permission} permission until {date}. …"; caveat "You can withdraw this consent later. Withdrawal limits future access only."; confirm "Approve and share" — = same
146. [ ] approve — `consent-requests.tsx:83–91` decline dialog — "Decline"; "Decline consent · {id}"; "{recipient} will not receive {docs} for {purpose} on {case}. {requester} sees that you declined and may send a new request."; caveat "Nothing is shared. No reason text is recorded on the ledger."; confirm "Decline request" — = same
147. [ ] approve — `consent-requests.tsx:98–106` withdraw dialog — "Withdraw consent"; "Withdraw consent · {id}"; "Ends {recipient}'s future access to {docs} ({purpose}, {case})." (caveat is approved ACCESS_REVOKED) — = same
148. [ ] approve — `consent-requests.tsx:125,149,151` — "Consent requests · {case}" / "Consent requests · all accessible cases"; "Loading consent requests…"; columns "Case, Your documents, Recipient, Purpose, Expiry, Status" — = same
149. [ ] approve — `consent-requests.tsx:177` — "No consent requests for your documents." — = same
150. [ ] approve — `consent-requests.tsx:221,223` — "Loading dealer consent…"; columns "Dealer document, Dealer, Recipient, Purpose, Status, Requested, Expiry" — = same
151. [ ] approve — `consent-requests.tsx:245` — "No dealer documents have been requested for sharing." — = same
152. [ ] approve — `case/pledge-tab.tsx:159` — "Pledge activation requires the lender approver mandate." — = same
153. [ ] approve — `case/pledge-tab.tsx:161` — "Activation becomes available after the collateral decision is recorded and the borrower accepts an issued proposal." (+ lender suffix " No lender action is available on this control right now.") — = same
154. [ ] approve — `governance/shared.tsx:16–17` — "Governance administers the verifier registry only; it cannot authorize collateral release." and prefix "UI simulation. No Decentralization Manager transaction is submitted." — = same
155. [ ] approve — `overview/recorded-figures.tsx:24` — "No active pledges in your organization's scope." — = same
156. [ ] approve — `overview/recorded-figures.tsx:25` — "{n} of {m} active pledge(s) with a recorded {noun}." — = same
157. [ ] approve — `domain/overview.ts:16` — "Accepted financing agreements behind active pledges" — = same
158. [ ] approve — `domain/overview.ts:17` — "Your organization's collateral assessments of assets under active pledges" — = same
159. [ ] approve — `domain/derive.ts:177–196` next-action labels not named in S §9 (check each against S §9; the INFERRED ones are among): "Add evidence", "Request verification", "Accept assignment", "Submit attestation", "Submit new evidence version", "Review sharing", "Review evidence", "Open collateral review", "Provide requested information", "Approve or reject collateral eligibility", "Issue proposal", "Review proposal", "Authorize pledge activation", "Activate pledge", "Decide release request", "Respond to information request", "Export case history" — = same

## 7. API refusals (shown in the UI; identical in the UI mockup client)

160. [ ] approve — `apps/api/src/routes/workflow/access.ts:55`, `workflow/audit/grants.ts:26` — "This grant is already revoked." — = same
161. [ ] approve — `routes/workflow/assets.ts:35` — "This equipment is already registered by your organization." — = same
162. [ ] approve — `routes/workflow/assets.ts:37` — "Saving a draft is not available in this environment. Register the asset to continue." — = same
163. [ ] approve — `routes/workflow/verification.ts:51` — "The validity period must end after the inspection and in the future." — = same
164. [ ] approve — `services/evidence.ts:47–54` upload errors — "Files are limited to 20 MB." / "The file is empty." / "The file content does not match its declared type." / "The file type does not match the upload request." / "Upload the file content before finalizing." / "The file content for this upload was already received." / "This upload request has expired. Start a new upload." / "Document storage is unavailable. No file was stored." — = same
165. [ ] approve — `workflow/audit/grants.ts:24` — "Only the record owner can grant: {scopes}." — = same
166. [ ] approve — `workflow/audit/grants.ts:25` — "Select an auditor organization." — = same
167. [ ] approve — `workflow/audit/grants.ts:26` — "The grant must expire in the future." — = same
168. [ ] approve — `workflow/financing/proposals.ts:36` — "This proposal has a newer version. Review it before accepting." — = same
169. [ ] approve — `proposals.ts:37` — "This proposal has a newer version. Review it before declining." — = same
170. [ ] approve — `proposals.ts:38` — "Authorization must reference the accepted proposal version." — = same
171. [ ] approve — `workflow/governance/rules.ts:13–18` — "This proposal cannot be confirmed by your seat in its current state." / "This verifier cannot be suspended in its current state." / "Only an open proposal can be withdrawn." / "Execution needs {n} live confirmations from distinct seats." / "This verifier cannot be added in its current state." / "No onboarded verifier organization has this name." — = same
172. [ ] approve — `workflow/verification/grants.ts:40` (and `api-client/src/mock/client.ts:362`) — "Document {doc} is not available on {asset}." — = same
173. [ ] approve — `grants.ts:41` — "Select at least one of your own documents. Dealer documents can be requested only for a request linked to the dealer's case." — = same
174. [ ] approve — `grants.ts:42` — "Select the documents to share with the verifier." — = same
175. [ ] approve — `grants.ts:43` — "No evidence has been shared with you for the current version of this request." — = same
176. [ ] approve — `workflow/verification/ledger.ts:10` (and `api-client/src/mock/client.ts:450`) — "The selected verifier is not active in the verifier registry." — = same
177. [ ] approve — `workflow/verification/resubmit.ts:22` — "Add a new document version before resubmitting the evidence." — = same

## 8. Submission documents (whole-document approval: every sentence outside backticks is INFERRED)

178. [ ] approve — `docs/submission/project-page.md` (whole page) and `docs/submission/pitch.md` (all slide text) — = same; re-check status facts against `packages/domain/src/evidence.ts` on the day of submission
179. [ ] approve — `docs/submission/demo-script.md` (narration; variant label "Canton DevNet (shared participant) · synthetic data", line 9), `docs/submission/bitsafe-contribution-pool.md` (all sentences outside backticks) and `docs/submission/ai-disclosure.md:9` ("Copy marked INFERRED was written with AI assistance and has not been approved." — update to say what was approved once this list is signed) — = same

## 9. Changed or added on 2026-10-09 (after the DevNet run; supersedes the text of items 95, 133, 135 and 179)

These strings were edited to match what was actually run (one recorded DevNet run, not connected to the public site). Facts come from `packages/domain/src/evidence.ts` and `docs/devnet-evidence.md`.

180. [ ] approve — `evidence.ts` `devnet.status` (rendered by `docs.tsx` and `capabilities.ts`, replaces the text of items 95 and 135) — "one full synthetic run on the shared participant (2026-10-05); the public site is not connected to it"
181. [ ] approve — `evidence.ts` `governance.tierA.devnet.status` — "ran once on DevNet (2026-10-05) as ordinary parties of one tenant user; not decentralized"
182. [ ] approve — `docs.tsx` (deployment list, replaces the "Not deployed" line) — "Not hosted: the API, the worker, PostgreSQL and document storage. The Daml packages were uploaded to the shared DevNet participant for the recorded run; no Collara service is hosted on any network."
183. [ ] approve — `docs.tsx` (governance paragraph, replaces the sentence "Neither tier has run on Canton DevNet…") — "Tier A ran once on Canton DevNet, as ordinary parties of one tenant ledger user, so it is not decentralized there either; Tier B was not attempted because the shared DevNet participant cannot host decentralized parties."
184. [ ] approve — `capabilities.ts` governance row "where" (replaces item 133) — "Tier A on one local participant; Tier B scripted on a local topology with one operator (10/10 checks), not in the app; Tier A ran once on DevNet, Tier B did not · BitSafe governance"; the DevNet row status changes from PLANNED to IMPLEMENTED
185. [ ] approve — `docs/submission/demo-script.md` (rewritten: variant D "UI-mockup tour + recorded DevNet run" with labels "UI mockup: simulated in the browser, no ledger" and "Canton DevNet · recorded run of 5 Oct 2026 · results, not new transactions"; replaces item 179's DevNet variant label)
186. [ ] approve — `docs/submission/pitch.md` and `docs/submission/project-page.md` DevNet rows (a recorded run; re-verified on Canton 3.6.1; workflow not re-run there; one tenant credential; public site not connected)

## After approval

Remove the INFERRED tag (comment) next to each approved string, apply the proposed edits for items 30 and 63 if approved, and tick "Copy marked INFERRED approved" in `infra/deploy/README.md` §5. Anything not approved stays tagged and must not appear on a public deployment.
