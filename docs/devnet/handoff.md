# DevNet handoff — resume here (2026-10-05)

Snapshot: `main` @ `abab884` (pushed). All code for the DevNet path is in and CI is green. Nothing has committed/run on DevNet yet.

## Where we stopped: login token rejected by the participant

`node scripts/devnet/login.mjs` with the hackathon account **got a token from Keycloak** (the password was accepted — no OIDC error), then called `GET /v2/authenticated-user` on the NODERS participant, which returned:

```
the participant did not accept the token: authenticatedUser: NA: A security-sensitive error has been received
```

This is a **redacted permission error from the participant**, not a login failure. The token is valid; the participant does not yet authorise the ledger user behind it.

**Most likely cause: Wallet onboarding was not completed, so the ledger user / primary party has not been provisioned on the shared participant.** The NODERS guide says to sign into the Wallet first; token acceptance follows onboarding.

### Fix, then resume

1. **Complete Wallet onboarding** at <https://wallet.validator.hackcanton-01.devnet.naas.noders.services> with `zkzora01@gmail.com`. Finish any onboarding prompt until the Wallet shows a **primary party** id (`<prefix>-…::1220…`). Note the prefix.
   Also confirm the account is provisioned in the HackCanton Season 3 tenant: the Wallet should show the party and a Canton Coin balance. If the Wallet itself is empty or refuses, the account is not provisioned on the HackCanton node — that is for the NODERS organisers.
2. Run `node scripts/devnet/login.mjs` again. Success prints `DEVNET_LEDGER_USER_ID=…`; put that into `.env.devnet`.
   If the participant still rejects the token, the error now prints the token's `sub`, `aud` and `scope` (non-secret). If `sub` differs from the ledger user id in the Wallet, the login account is not the onboarded one. Send those three lines.
3. If it still fails after onboarding, run `node scripts/devnet/preflight.mjs` (its output is non-secret) and send it over, and raise it in the NODERS BitSafe/participant channel (draft: `docs/devnet/noders-rights-request.md`).

## What is already done (no action needed)

- `.env.devnet` created locally (git-ignored) with the generated `DEVNET_CREDENTIAL_KEY` and all public DevNet settings. **This file is local-only and not in Git.** In a fresh/cloud checkout, recreate it: `cp infra/env/devnet.env.example .env.devnet`, then `node scripts/devnet/gen-key.mjs` and paste both key lines in. (No data depends on the current key yet — the refresh token was never stored.)
- Local `collara_devnet` database created, migrations 0000–0005 applied, synthetic identities seeded. (DEVNET uses a **local DB + the NODERS remote ledger**; Supabase is only needed later for the public demo.)

## Remaining, owner-only (browser / own terminal)

In order. Everything after is scripted and can be run by the assistant once the outputs come back.

1. **NODERS onboarding** (your account):
   - Wallet onboarding (step above).
   - Console <https://console.participant.hackcanton-01.devnet.naas.noders.services> → create **11 parties**, exact names: `CollaraRegistrar`, `CollaraGovernance`, `GovSeat1`, `GovSeat2`, `GovSeat3`, `DemoManufacturer`, `DemoCNCDealer`, `DemoVerifier`, `DemoLenderA`, `DemoLenderB`, `DemoAuditor`. Check the party quota (need 11 free).
   - Console → Collections → Upload DAR, in order: `.local/devnet/dars/01-governance-core-v1-0.1.0.dar`, then `02-collara-contracts-0.2.0.dar` (see `docs/devnet/upload-manifest.md`).
   - `node scripts/devnet/login.mjs` (password in your terminal only).
2. **Send back** the non-secret outputs: `preflight.mjs`, whether the Console granted your user CanActAs on the new parties by itself, and any Console error text.

## Then the assistant runs (local DB + NODERS ledger)

`preflight` → `import-bindings` → `bootstrap` (clean-start, then `--profile main`) → `verify-first-tx` → the full role walkthrough (register → consent → verification → lender review → activation → release → audit export) with transaction evidence into `docs/devnet-evidence.md`, and the privacy checks. Only after the UI walkthrough passes with no mock fallback does the public site switch off UI-mockup.

## Public hosting (later, decoupled from the above)

- **Free:** Supabase (Postgres + Storage via S3) + Vercel embedded API — `docs/devnet/deploy-free.md`. The Supabase `sb_secret_`/`sb_publishable_` API keys are **not** what the app uses; it needs the **Postgres connection string** (Connect → Session/Transaction pooler, includes the DB password) and **S3 keys** (Storage → S3 Connection). Rotate the `sb_secret_` key that was shared in chat.
- **Simplest paid (~$21/mo):** Render + Cloudflare R2 — `render.yaml`, `docs/devnet/deploy-render.md`.
- Known decision: the DEVNET guard requires a DB name containing `devnet`; Supabase gives `postgres`. Resolve before using Supabase (do not weaken the guard silently).

## Security reminders

- Change the hackathon account password (it was pasted in chat).
- Rotate the Supabase `sb_secret_` key (pasted in chat).
- Secret audit of the full history: clean (`docs/security/secret-audit-2026-10-04.md`). Before making the repo public, decide on the third-party capture in `Collara Website/uploads/web-capture-*.json` (`docs/security/uploads-review.md`).
