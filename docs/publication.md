# Publishing the repository

Status 2026-10-09: **`zkzora/collara` is private and nothing here has been done to it.** The HackCanton rules require a public repository with all project code and a README ([`hackcanton-submission.md`](hackcanton-submission.md)). The visibility change, the creation of a new repository and any push are the owner's decision; nothing in this repository does them.

## What must not go public

`Collara Website/uploads/web-capture-2026-09-30T17-30-17.json` (2.6 MB): a DOM/CSS capture of **linear.app** and **demo.mercury.com**, i.e. third-party content. It is in the history (one commit, the baseline `c82228f`). The other files in that folder are Collara's own (logo and UI screenshots). Details: [`security/uploads-review.md`](security/uploads-review.md).

Deleting the file in a new commit is not enough: it stays retrievable from history once the repository is public.

## Options (tested on 2026-10-09 against `main` @ `33761de`)

| | Option | What the public repo has | Existing private repo | Tested |
|---|---|---|---|---|
| **A** | **Clean snapshot** into a new repository | The current tree without the capture, **one commit, no history** | Untouched | `scripts/publish/clean-export.mjs`: 741 files, 10.5 MB, capture absent, secret scan clean (10 reviewed false positives, 0 unreviewed), the snapshot repository's `.git` holds no capture object |
| **B** | **Filtered history** copied into a new repository | All 53 commits **without the capture** (new hashes), same authors, no co-author trailers | Untouched | `git filter-branch` in a detached clone, 36 s: 53 commits, 0 capture objects, same 741-file tree as A |
| C | Rewrite `main` in place and force-push to `zkzora/collara`, then make it public | Same as B | **Rewritten** (hashes change, CI and the Vercel link rebuild, clones must be re-cloned) | Not run; needs the owner's explicit approval |
| D | Make `zkzora/collara` public as it is | Everything, including the third-party capture | Visibility changed | Not recommended |

Recommendation: **B** if the commit timeline matters to the submission (it shows the work was done in the delivery phase), **A** if a single clean commit is acceptable. Both leave the private repository as the working copy.

### Option A: clean snapshot

```bash
node scripts/publish/clean-export.mjs --init          # writes .local/publish/collara-public (one commit)
# review the output, then (owner):
gh repo create <owner>/<public-name> --public --source .local/publish/collara-public --push
```

The script only reads this repository. It lists what it excluded, checks that the excluded file is absent, warns about files over 5 MB, runs `gitleaks dir` when it is installed (set `GITLEAKS_BIN` otherwise) and fails on any finding that is not in its reviewed list. Add more exclusions with `--exclude <path or prefix or glob>`.

### Option B: filtered history in a new repository

```bash
git clone --no-local --single-branch -b main . .local/publish/filtered
cd .local/publish/filtered
git remote remove origin                      # so nothing can be pushed to the private repository
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --prune-empty \
  --index-filter 'git rm --cached --ignore-unmatch -q -- "Collara Website/uploads/web-capture-2026-09-30T17-30-17.json"' -- main
rm -rf .git/refs/original && git reflog expire --expire=now --all && git gc -q --prune=now --aggressive
# checks (all must print 0):
git log --all --oneline -- 'Collara Website/uploads/web-capture-2026-09-30T17-30-17.json' | wc -l
git rev-list --objects --all | grep -c web-capture
git log --format=%B | grep -ci 'co-authored-by'
# then (owner):
gh repo create <owner>/<public-name> --public --source . --push
```

`git filter-repo` is not installed here; `filter-branch` is deprecated but did the job. To also replace the author e-mail (every commit carries `abeeyuuu1@gmail.com`), add an `--env-filter` before the push; that is optional and the owner's call.

## Before anything becomes public (owner checklist)

- **Secrets**: the history was scanned with gitleaks 8.30.1 ([`security/secret-audit-2026-10-04.md`](security/secret-audit-2026-10-04.md)); only reviewed false positives remain. The committed dev placeholders are listed there. `.env*` and `.local/` are git-ignored and are never part of A or B. **Credentials pasted in chat are not in the repository** but must still be rotated: the hackathon account password, the Supabase secret key and the S3 key.
- **Author e-mail** in every commit and `C:\Users\Pongo` paths in seven `docs/_research` files: decide whether to keep them. `docs/_research/inputs/` holds text from the owner's documents: decide whether to publish it.
- **License**: the repository has no `LICENSE`, which means all rights reserved. Choose one if judges or reviewers should be allowed to run and reuse the code.
- **Local-only branch** `backup/before-strip-trailer` exists on this machine; it is never part of A or B (they take `main` only).
- **Names and links**: README, `docs/hackcanton-submission.md`, `docs/submission/checklist.md` and `docs/submission/project-page.md` say `zkzora/collara` is private; update them and the links to the final repository name. The public UI mockup is deployed from `zkzora/collara` by Vercel: it keeps working while the private repository exists; a new repository needs the Vercel project re-pointed if the demo should follow it.
- **CI**: `.github/workflows/ci.yml` needs no secrets; it will run on the new repository's first push. The LocalNet workflow is manual.
- **Private-window check**: after publishing, open the repository, the README, `/docs`, the demo, the video and the pitch signed out ([`submission/checklist.md`](submission/checklist.md) item 9).
