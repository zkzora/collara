# Submission checklist (HackCanton Season 3)

Status as of 2026-10-04. Deadline **2026-10-09 23:59 UTC**. The project is judged as it stands at the deadline, and there are no extensions. Rules were read on 2026-10-04 ([`docs/hackcanton-submission.md`](../hackcanton-submission.md)). Re-check the rules page before submitting.

Owner = the account owner (zkzora) unless the team assigns someone else. "Builder" = repository work.

## Mandatory

| # | Item | Status | Owner | Evidence / next step |
|---|---|---|---|---|
| 1 | **Public repository** with all project code and a README | **Not met**: `zkzora/collara` is private | Owner (decision) | Making it public is the owner's decision. Before you do, check that no secret is in the history (only dev-only and example secrets should be present). Then check the README renders and its links resolve. |
| 2 | Everything for judging is **publicly accessible** (repo, demo, video, pitch, project page); a private or "request access" link counts as missing | Partly met: the Vercel UI mockup and `/docs` are public | Owner | Do step 9 (private-window check) after items 1, 4 and 5. |
| 3 | **Demo**: a working prototype, live demo or recorded video (≤ 5 min) | Prototype: public UI mockup on Vercel; LocalNet runs on the authoring machine only. Video: **not recorded** | Owner + builder | [demo-script.md](demo-script.md). Use variant B (LocalNet) unless DevNet has been proven by then. |
| 4 | **Video** uploaded, publicly viewable, ≤ 5 min | **Not done** | Owner | Recording checklist in [demo-script.md](demo-script.md). |
| 5 | **Pitch materials**: problem, solution + how Canton is used, target users + GTM, key metrics / validation | **Outline only** ([pitch.md](pitch.md)). **Validation evidence does not exist yet** | Owner (content, validation), builder (slides) | Fill the gaps in pitch.md slides 2, 8 and 9 with real data, or state them as gaps. Export the deck to a public link or PDF. |
| 6 | **Track selection** | Not done | Owner | "Real-World Assets (RWA) & Business Workflows". |
| 7 | **1,000 Mana** burned toward the project (needs ≥ 10 days of daily platform activity) | **Unknown**: only the owner can see the platform account | Owner | Check the balance and activity days today; this cannot be caught up at the last minute. |
| 8 | **Completed project profile** and a **non-empty journal** on the platform | **Unknown** (platform account) | Owner | Profile text: [project-page.md](project-page.md). Journal: daily entries, which the rules also recommend. |
| 9 | **Check every link in a private browser window** (signed out) | Not done | Owner | Open each link from the platform page in a private window: repo, README, `/docs`, the demo, the video, the pitch, and the BitSafe entry doc. Every one must open without signing in. |
| 10 | Meaningful use of the Canton ledger | Met on LocalNet (Canton 3.5.19 sandbox); DevNet not yet run | — | [`docs/verification.md`](../verification.md), `packages/domain/src/evidence.ts`. |
| 11 | Work done in the delivery phase; any pre-existing code disclosed | Repo created 2026-10-01; the HTML prototype and specs are dated 2026-09-19 to 2026-10-01 | Owner | State this on the project page if the form asks. |
| 12 | **AI-assisted work disclosed** | Draft ready | Owner (edit) | [ai-disclosure.md](ai-disclosure.md). Paste it into the submission and keep the README link. |

## BitSafe challenge (a separate entry)

| # | Item | Status | Owner |
|---|---|---|---|
| B1 | Contribution Pool entry document | Draft: [bitsafe-contribution-pool.md](bitsafe-contribution-pool.md) | Builder |
| B2 | A judge can reproduce it locally | Tested only on Windows 11 + WSL Ubuntu 24.04. The Docker Compose path is **untested** | Owner + builder: test on a Linux machine with Docker if one is available |
| B3 | Re-run Tier B with `collara-contracts` 0.2.0 | Not done (the recorded run used 0.1.0) | Builder |
| B4 | Gold tier | Not pursued: it needs our own node (the shared DevNet participant cannot host Decentralized Parties), and the application deadline was 2026-10-04 | Owner decision |

## Recommended

- Keep the platform journal daily.
- Re-run `pnpm typecheck && pnpm lint && pnpm test` and check that CI is green on the commit you submit.
- Update the README status and `packages/domain/src/evidence.ts` after any new run, especially the first DevNet run.
- Approve or replace the INFERRED copy that appears publicly: project page, pitch, video narration, and the `/docs` status lines.
