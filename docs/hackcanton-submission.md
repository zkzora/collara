# HackCanton Season 3 — submission rules and what they mean for Collara

Read on 2026-10-04 from https://hackathon.appsfactory.cc/season-3 (tabs Rules, Challenges, Materials), rendered in headless Chromium. The page can change: organisers may update rules during the season, so re-check before submitting.

## Mandatory (Rules → Submission Requirements, Public Materials, Deadlines)

| Rule | Status for Collara (2026-10-04) |
|---|---|
| Deadline **2026-10-09 23:59 UTC**; judged as it stood at the deadline; no extensions | Open |
| **Public repository** with all project code and a README | **Not met**: `zkzora/collara` is private. Changing visibility is the owner's decision. |
| Everything for judging **publicly accessible** (repo, demo, video, pitch, project page); private / "request access" links count as missing | Vercel demo is public (UI mockup). Repo is private. Video and pitch: not produced yet. |
| **Demo**: a working prototype, live demo or recorded video (max **5 minutes**) | Prototype exists (Vercel UI mockup; LOCALNET on the authoring machine). Video: not recorded. |
| **Pitch materials** covering problem, solution + how Canton is used, target users + GTM, key metrics / validation | Not produced in this repo (inputs exist in the research notes). |
| **Track selection** (one of five) | Owner decision; "Real-World Assets (RWA) & Business Workflows" fits Collara. |
| **1,000 Mana** burned toward the project (needs ≥ 10 days of daily platform activity) | Platform account — only the owner can check. |
| **Completed project profile** and a **non-empty journal** on the platform | Platform account — only the owner can check. |
| Meaningful use of the Canton ledger (Daml contracts, nodes or APIs) | Met on LocalNet (Canton 3.5.19 sandbox); DevNet in preparation. |
| Work done in the delivery phase (Sep 18 – Oct 9); pre-existing code must be disclosed | The repo was created on 2026-10-01; the HTML prototype and specs are dated 2026-09-19 … 2026-10-01 (inside the phase). |
| AI-assisted work allowed, used **transparently** | Should be stated in the README/submission. |

## Recommended (not eligibility rules)

- Keep a daily journal (visible to mentors and judges, part of evaluation).
- Check every link in a private browser window before submitting.
- Judging criteria: Value / problem, ICP / audience, Metrics / validation, GTM materials, MVP materials (working prototype, code quality, depth of Canton integration), Pitch materials. Finalists announced 2026-10-19; Grand Final 2026-10-21.

## BitSafe challenge (separate entries)

| | Contribution Pool (20,000 CC) | Gold (30,000 CC) |
|---|---|---|
| Required | A **reproducible LocalNet demo** of an application integration, custom module or open-source contribution; setup and run instructions good enough for judges to reproduce | A **live Decentralized Party on DevNet or MainNet, integrated into a working application**; apply for the deployment path **by 2026-10-04** (today) |
| Must show | Governed action fails below the confirmation threshold and succeeds once met (shared control) and/or behaviour when a hosting node goes offline (distributed hosting); name nodes, operators, thresholds; say which operators are independent | Same, on DevNet/MainNet |
| Node | None needed ("Local path: Docker and Docker Compose …") | Own suitable node; **"The shared Hackathon DevNet Sandbox isn't set up to host teams' Decentralized Parties"** |

What this means for Collara:
- **Gold is not reachable on the NODERS shared node.** It would need our own Canton node (validator) peered with BitSafe, and the application deadline is today. Owner decision.
- **Contribution Pool fits the existing Tier B work** (3 DM nodes, decentralized governance party, 2-of-3 confirmations, threshold failure/success, a node-offline test — `docs/governance-tier-b.md`). Risk: our LocalNet and Tier B runs use a Windows `dpm sandbox` and WSL scripts, while the challenge's local path assumes Docker Compose; the compose files in `infra/compose` are untested. Judges must be able to reproduce from the instructions.
- The NODERS DevNet work (`docs/devnet.md`) is for the core Collara workflow on DevNet, not for Tier B.
