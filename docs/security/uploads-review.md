# Review of `Collara Website/uploads/` before publishing (2026-10-05)

All six files below entered Git in the baseline commit `c82228f` ("Baseline: preserve original Collara HTML prototype") and are therefore in the history of `main` and `origin/main` (and `4eca223` on the local-only branch `backup/before-strip-trailer`). Deleting them in a new commit does **not** remove them from history.

| File | What it is | Publish? |
|---|---|---|
| `assets/collara-mark.png` | Collara logo mark, generated with ChatGPT (C2PA metadata says `gpt-image`), byte-identical to the upload below. Used by the web app (`apps/web/public/brand/`). | **Yes** — it is the product's own mark. Note: AI-generated images have limited copyright protection and no trademark clearance (owner decision, not a blocker). |
| `uploads/ChatGPT Image Oct 1, 2026, 12_36_04 AM.png` | The original ChatGPT download of the same logo (same SHA-256). | **Yes**, but redundant (duplicate of the mark). Removing it is optional. |
| `uploads/pasted-1790817851444-0.png` | Screenshot of an earlier Collara landing hero. | **Yes** — Collara's own UI. |
| `uploads/pasted-1790817989563-0.png` | Screenshot of an earlier Collara dashboard sidebar. | **Yes** — Collara's own UI. |
| `uploads/pasted-1790844517825-0.png` | Screenshot of one Collara case-table row (CL-004, synthetic). | **Yes** — Collara's own UI. |
| `uploads/web-capture-2026-09-30T17-30-17.json` (2.6 MB) | DOM/CSS capture of **third-party websites**: 25 elements of linear.app's homepage and 69 elements of demo.mercury.com, including ~2.4 MB of their page HTML/SVG. | **No** — third-party content. The hackathon rules say projects must not infringe third-party IP; republishing another company's page markup is the risk. |

Related: `docs/_research/uploads.md` describes the capture (palette values, element counts). Describing a design reference is fine; it contains no copied page markup.

## Options for the third-party capture

1. **Remove it from the current tree only** (one commit, no force-push). The file stays retrievable from history (`c82228f`) once the repository is public. Lowest effort, does not remove the risk.
2. **Remove it from history** (recommended before going public). Rewrites every commit hash from the baseline on and needs a force-push of `main` (only with the owner's explicit approval; CI and Vercel redeploy afterwards; any clone must re-clone):

   ```bash
   # from a clean working tree; backup first
   git branch backup/before-uploads-rewrite main
   FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --index-filter \
     'git rm --cached --ignore-unmatch "Collara Website/uploads/web-capture-2026-09-30T17-30-17.json"' -- main
   git push --force-with-lease origin main
   git branch -D backup/before-strip-trailer   # also holds the file
   ```

   Then re-run the secret audit (`docs/security/secret-audit-2026-10-04.md`) and confirm `git log --all -- "Collara Website/uploads/web-capture-2026-09-30T17-30-17.json"` is empty.

Nothing has been removed or rewritten yet; the repository stays private until the owner decides.
