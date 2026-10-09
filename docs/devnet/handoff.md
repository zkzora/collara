# DevNet handoff (2026-10-09)

Where DevNet stands, what is verified, and what is left. Non-secret; secrets live only in `.env.devnet` and the owner's terminal.

## State

- **Recorded run (2026-10-05, Canton 3.5.19)**: full synthetic workflow committed on the shared NODERS participant. Evidence: [`docs/devnet-evidence.md`](../devnet-evidence.md); receipts: [`evidence/receipts-r202610050410.json`](evidence/receipts-r202610050410.json) (43 command records, 39 ledger updates).
- **Re-verified 2026-10-09** against the node, which now reports **Canton 3.6.1**: 43/43 receipts found at the recorded offsets; final state as recorded; Demo Lender B holds 0 of 13 case templates. Command: `node scripts/devnet/verify-evidence.mjs`.
- **3.6.1 compatibility**: API differences for the endpoints Collara uses are added fields only; bootstrap and asset registration (M1–M4) committed on 3.6.1; the rest of the workflow was **not re-run** on 3.6.1. The preflight still pins 3.5.19 and reports a mismatch (left on purpose).
- **Public site**: UI mockup on Vercel, not connected to DevNet. The Vercel project `collara-devnet` exists but nothing is deployed to it.
- **Demo personas are off in DevNet** (`33761de`). A local-only opt-in for screen recordings exists: `node scripts/devnet/record.mjs` (below).

## Where the data is

| What | Where |
|---|---|
| The 5 October run (commands, projection, case CL-001) | Local PostgreSQL `collara_devnet` (WSL; start with `pnpm db:up`). State file `.local/devnet/state.oct5.json`, env profile `.local/devnet/env.localdb` (git-ignored; same keys as `.env.devnet`, `DATABASE_URL` pointing at the local database) |
| Scratch runs on 3.6.1 (namespaces `r202610091015` … `r202610091215`) | Supabase project `collara` (`collara_devnet`), connection strings in `.env.devnet`. Half-seeded; not a clean demo database |
| Credentials | Rotating OIDC refresh token, AES-256-GCM encrypted in `ledger_credentials`, key `DEVNET_CREDENTIAL_KEY` in `.env.devnet`. The local and the Supabase database hold **separate logins**; never copy one database's credential row into another (token rotation would invalidate one of them) |
| S3 | Supabase private bucket `collara-devnet-evidence` (endpoint and keys in `.env.devnet`); put, get and delete verified, anonymous access refused. The 5 October run had no documents (`--skip-documents`) |

## Recording the recorded run locally

```
pnpm db:up
node scripts/devnet/record.mjs --env-file .local/devnet/env.localdb --state .local/devnet/state.oct5.json
# open http://localhost:3000/login, pick a persona; Ctrl+C to stop
```

The opt-in is refused on any host other than 127.0.0.1, behind a proxy, on Vercel, in production and with the embedded API; the API answers 404 to any request that is not loopback end to end. Footage from this setup shows recorded results (5 October), not new transactions, and must say so.

## Known blockers and decisions

1. **A second full run on the same parties** stops at seed step M5: its precondition looks up an `EvidenceManifest` for `ASSET-DEMO-001`/`PKG-001` without a namespace filter. Fix by namespacing the fixture identifiers, or use new parties (Console only).
2. **DevNet web sign-in** does not work: the OIDC client at NODERS is public and the API's web flow needs a client secret; reviewers have no NODERS accounts anyway.
3. **Supabase database name**: the DEVNET guard requires a name containing `devnet`; the scratch database is `collara_devnet`, created with a dedicated `collara_app` role.
4. **Hosting** is undecided and not needed for the submission (the public site stays a UI mockup). Options: [`hosting.md`](hosting.md), [`deploy-free.md`](deploy-free.md), [`deploy-render.md`](deploy-render.md); none has been deployed.

## Security reminders

- The hackathon account password, a Supabase secret key and an S3 key were pasted in chat: change the password, rotate the Supabase keys, and replace the S3 key after submission.
- Secret audit of the full Git history: [`docs/security/secret-audit-2026-10-04.md`](../security/secret-audit-2026-10-04.md). Before the repository is made public, see [`docs/publication.md`](../publication.md) (third-party capture in `Collara Website/uploads/`).
