# Secret and publication audit — 2026-10-04

Scope: the whole Git history of `C:\Collara` (all refs: `main`, `origin/main` and the local-only branch `backup/before-strip-trailer`; 56 commits) and the working tree, before the repository is made public. This audit does not change repository visibility.

## How

- **gitleaks 8.30.1** (Windows x64 release; SHA-256 of the zip `d29144de…afc4e` matched the published checksums file): `gitleaks git . --log-opts="--all" --redact` and `gitleaks dir . --redact`.
- Manual sweep of every commit (`git grep` over `git rev-list --all`) for GitHub/AWS/OpenAI/Slack token formats, PEM private keys and JWTs.
- Review of committed credentials-like values and of personal data.

## Result: no real secret in the Git history

gitleaks reported 11 history findings (7 distinct lines); all are false positives:

| Location | What it is |
|---|---|
| `apps/api/test/localnet/cases.it.test.ts`, `dealer-consent.it.test.ts` (5 lines) | Literal `idempotencyKey` labels in tests (e.g. `ep1-verification-0001`) |
| `apps/worker/src/jobs/handlers/export.ts` | `secretAccessKey: s3.COLLARA_S3_SECRET_KEY` — a reference to an environment variable, no value |
| `docs/_research/research-canton.md` | A `contractKeyHash` observed on a throwaway local sandbox (public hash, not a credential) |
| `apps/api/src/commands.test.ts` (manual sweep) | A fake JWT (`{"sub":"x"}`, signature `sig`) used to test that errors are redacted |

The working-tree findings (245) are all in **git-ignored** paths that are never pushed: `.env` (local dev secrets), `.local/` (Tier B receipts and state, run scripts), `.spike/`, `.vendor/` (third-party DM repository with its own test fixtures) and `apps/web/.next/` (build output). `.env.devnet` is git-ignored too.

## Intentionally public development values (committed, dev-only)

| Value | Where | Why it is acceptable |
|---|---|---|
| `collara-local-dev-secret-change-me` | `infra/canton/sandbox-auth.conf`, `extra-participants*.conf`, research notes | HS256 secret for the **local** `unsafe-jwt-hmac-256` sandbox; overridable by `CANTON_JWT_HMAC_SECRET`. DEVNET mode refuses HMAC. |
| `collara-tierb-dev-secret` | `infra/tierb/canton/tierb.conf` | Same, for the local Tier B topology in WSL; overridable by `TIERB_HMAC_SECRET`. |
| `collara-demo-only` | `infra/keycloak/collara-realm.json` | Passwords of the synthetic Keycloak demo users for a local Keycloak; documented as synthetic. |
| `web-app-ui-hackcanton-01-devnet` | `infra/env/devnet.env.example` | Public OIDC client id from the organisers' guide (a public client, no secret). |

Never reuse these values on any network deployment.

## Personal data and third-party content — owner decision before publishing

| Item | Where | Note |
|---|---|---|
| Commit author email `abeeyuuu1@gmail.com` | every commit's metadata | Becomes public with the repository. Rewriting it would change every commit hash. |
| Windows user path `C:\Users\Pongo\…` (paths to the owner's Documents/Downloads) | 7 files under `docs/_research/` | Reveals a local username and file names; harmless but personal. Can be replaced by neutral paths in a new commit (history keeps the old text). |
| Extracted text of the owner's own product documents (`.docx`) | `docs/_research/inputs/` | The owner's product material; publish only if intended. |
| **Reference capture of a third-party website and screenshots** | `Collara Website/uploads/` (`web-capture-*.json` 2.6 MB, PNGs) | Design references of other products. The hackathon rules forbid infringing third-party IP; consider removing them before publishing. Removing them from a new commit does not remove them from history — that needs a history rewrite (and a force-push), which only the owner can authorise. |
| Local branch `backup/before-strip-trailer` | local only, never pushed | Contains the pre-rewrite history. Not published by a visibility change; delete with `git branch -D backup/before-strip-trailer` if no longer needed. |

## Recommendations before switching to public

1. Decide on the third-party captures in `Collara Website/uploads/` (remove in a commit, or rewrite history to remove them entirely).
2. Optionally neutralise the `C:\Users\Pongo` paths in `docs/_research/`.
3. After publishing, enable GitHub secret scanning and push protection on the repository.
4. Re-run this audit right before the visibility change (`gitleaks git . --log-opts="--all" --redact`).
