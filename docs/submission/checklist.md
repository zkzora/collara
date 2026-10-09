# Submission checklist (HackCanton Season 3)

Status as of 2026-10-09 (deadline day). Deadline **2026-10-09 23:59 UTC**. The project is judged as it stands at the deadline, and there are no extensions. Rules were read on 2026-10-04 ([`docs/hackcanton-submission.md`](../hackcanton-submission.md)). Re-check the rules page before submitting.

Owner = the account owner (zkzora) unless the team assigns someone else. "Builder" = repository work.

## Mandatory

| # | Item | Status | Owner | Evidence / next step |
|---|---|---|---|---|
| 1 | **Public repository** with all project code and a README | **Not met**: `zkzora/collara` is private | Owner (decision) | Making it public is the owner's decision. **Do not publish `zkzora/collara` as it is**: its history contains a third-party capture ([`docs/security/uploads-review.md`](../security/uploads-review.md)). Clean options, tested and not executed, are in [`docs/publication.md`](../publication.md): a one-commit snapshot (`scripts/publish/clean-export.mjs`) or a filtered copy of the history (53 commits) in a **new** repository. No history rewrite or force-push has been done. Then check the README renders and its links resolve. |
| 2 | Everything for judging is **publicly accessible** (repo, demo, video, pitch, project page); a private or "request access" link counts as missing | Partly met: the Vercel UI mockup and `/docs` are public | Owner | Do step 9 (private-window check) after items 1, 4 and 5. |
| 3 | **Demo**: a working prototype, live demo or recorded video (≤ 5 min) | Prototype: public UI mockup on Vercel (not connected to any ledger); a recorded full run exists on the shared DevNet participant (2026-10-05, re-verified 2026-10-09 on Canton 3.6.1); LocalNet runs on the authoring machine only. Video: **not recorded** | Owner + builder | [demo-script.md](demo-script.md) **variant D** (UI-mockup tour, then the recorded DevNet run, each labeled; DevNet footage is recorded results, not new transactions). Setup: `node scripts/devnet/record.mjs` ([`docs/devnet/handoff.md`](../devnet/handoff.md)). |
| 4 | **Video** uploaded, publicly viewable, ≤ 5 min | **Not done** | Owner | Recording checklist in [demo-script.md](demo-script.md). |
| 5 | **Pitch materials**: problem, solution + how Canton is used, target users + GTM, key metrics / validation | **Outline only** ([pitch.md](pitch.md)). **Validation evidence does not exist yet** | Owner (content, validation), builder (slides) | Fill the gaps in pitch.md slides 2, 8 and 9 with real data, or state them as gaps. Export the deck to a public link or PDF. |
| 6 | **Track selection** | Not done | Owner | "Real-World Assets (RWA) & Business Workflows". |
| 7 | **1,000 Mana** burned toward the project (needs ≥ 10 days of daily platform activity) | **Unknown**: only the owner can see the platform account | Owner | Check the balance and activity days today; this cannot be caught up at the last minute. |
| 8 | **Completed project profile** and a **non-empty journal** on the platform | **Unknown** (platform account) | Owner | Profile text: [project-page.md](project-page.md). Journal: daily entries, which the rules also recommend. |
| 9 | **Check every link in a private browser window** (signed out) | Not done | Owner | Open each link from the platform page in a private window: repo, README, `/docs`, the demo, the video, and the pitch. Every one must open without signing in. |
| 10 | Meaningful use of the Canton ledger | Met on LocalNet (Canton 3.5.19 sandbox) and by one recorded full run on the shared DevNet participant (43 command records, 39 ledger updates; re-verified 43/43 on Canton 3.6.1; the workflow was **not** re-run on 3.6.1) | — | [`docs/verification.md`](../verification.md), [`docs/devnet-evidence.md`](../devnet-evidence.md), `packages/domain/src/evidence.ts`. |
| 11 | Work done in the delivery phase; any pre-existing code disclosed | Repo created 2026-10-01; the HTML prototype and specs are dated 2026-09-19 to 2026-10-01 | Owner | State this on the project page if the form asks. |
| 12 | **AI-assisted work disclosed** | Draft ready | Owner (edit) | [ai-disclosure.md](ai-disclosure.md). Paste it into the submission and keep the README link. |

## BitSafe challenge

Cancelled by the owner on 2026-10-09: no BitSafe entry is submitted. The governance code (Tier A in the app, Tier B scripts) stays in the repository as part of the product.

## Recommended

- **Rotate what was pasted in chat** after submitting: the hackathon account password, the Supabase secret key and the Supabase S3 key (none is in the repository).
- Keep the platform journal daily.
- Re-run `pnpm typecheck && pnpm lint && pnpm test` and check that CI is green on the commit you submit.
- Update the README status and `packages/domain/src/evidence.ts` after any new run, especially the first DevNet run.
- Approve or replace the INFERRED copy that appears publicly: project page, pitch, video narration, and the `/docs` status lines.
