# DevNet owner checklist

One ordered list for the project owner. Every step that uses the team's hackathon login is yours: the lead and the builders never see the password or any token. Run the commands from the repository root (`C:\Collara`). Each command is given for **PowerShell** and **Git Bash**. Background: [`docs/devnet.md`](../devnet.md). Synthetic data only.

What you need: the team's hackathon login (username + password), this repository with `pnpm install` done, WSL PostgreSQL (`pnpm db:up`), Node 24.

Never paste the password, a token, the credential key or the contents of `.env.devnet` (other than the ledger user id) into chat, an issue, a commit or a command line.

Something broke later (DevNet reset or pruned, login rejected, key or database lost, a package missing)? Run `node scripts/devnet/recover.mjs` and follow [`recovery.md`](recovery.md).

---

## (a) Onboard in the Wallet and note the primary party

1. Open <https://wallet.validator.hackcanton-01.devnet.naas.noders.services> and sign in with the team's hackathon login.
2. Complete the onboarding if the Wallet asks for it.
3. Note the **primary party** id the Wallet shows (it looks like `<prefix>-<name>::1220…`). Write down the **prefix** before the first `-` (for example `c2ede6f6`): every party you create in step (b) gets it.

## (b) Create the eleven Collara parties in the Console

1. Open <https://console.participant.hackcanton-01.devnet.naas.noders.services> and sign in with the same login.
2. Check the party **quota** first: Collara needs **11** parties plus your primary party (12 in total; the guide says about 20). If fewer than 11 are left, stop and report the number (step h).
3. Create each party with **exactly** this name (case-sensitive, no spaces). The Console adds your prefix; `import-bindings` matches `<prefix>-<Name>`.

   | # | Exact name | Collara role / function |
   |---|---|---|
   | 1 | `CollaraRegistrar` | Registry operator: issues asset control (asset registry, issuance tickets), publishes the config and the verifier status mirror |
   | 2 | `CollaraGovernance` | Governance party: signs GovernanceRules, the verifier registry and accreditations (Tier A) |
   | 3 | `GovSeat1` | Governance seat 1, held by Demo Lender A |
   | 4 | `GovSeat2` | Governance seat 2, held by Demo Lender B |
   | 5 | `GovSeat3` | Governance seat 3, held by Demo Auditor |
   | 6 | `DemoManufacturer` | Borrower and asset owner |
   | 7 | `DemoCNCDealer` | Dealer contributor |
   | 8 | `DemoVerifier` | Verifier (VER-001) |
   | 9 | `DemoLenderA` | Selected lender |
   | 10 | `DemoLenderB` | Unrelated lender |
   | 11 | `DemoAuditor` | Auditor |

4. If the Console shows the rights of your ledger user, check that it has **CanActAs** (and CanReadAs) on all eleven. If it does not and the Console offers no way to grant them, send the draft in [`noders-rights-request.md`](noders-rights-request.md) (fill in the prefix and party ids) and wait. Step (f) checks this anyway.

## (c) Upload the two DARs in order and check vetting

1. Check the files match the committed manifest:

   PowerShell and Git Bash:
   ```
   node scripts/devnet/build-dars.mjs --check
   ```
   Expected: `upload manifest matches the built DARs`. The files are in `.local\devnet\dars\`.
2. In the Console: **Collections → Upload DAR**, upload in this order ([`upload-manifest.md`](upload-manifest.md) has sizes and SHA-256):
   1. `.local\devnet\dars\01-governance-core-v1-0.1.0.dar` (main package `361d1f28…d488`)
   2. `.local\devnet\dars\02-collara-contracts-0.2.0.dar` (main package `1c0e5e62…503c`)
3. If the Console offers a vetting option, vet both. If an upload is rejected (for example because `splice-util` 0.1.4 already exists on the node with different content), copy the exact error text for step (h) and stop.
4. Step (f) lists each package as `present` and `vetted`.

## (d) Create the DEVNET database and run the migrations

1. Start PostgreSQL in WSL:

   PowerShell and Git Bash:
   ```
   pnpm db:up
   ```
2. Create the DEVNET env file (git-ignored) from the template:

   PowerShell:
   ```powershell
   Copy-Item infra\env\devnet.env.example .env.devnet
   ```
   Git Bash:
   ```bash
   cp infra/env/devnet.env.example .env.devnet
   ```
   It already points at `postgres://collara:collara_dev@127.0.0.1:5432/collara_devnet`. Leave `DEVNET_LEDGER_USER_ID=` empty for now. The database name must contain `devnet`; the LocalNet databases are refused.
3. Generate the key that encrypts the stored refresh token (printed once, written nowhere):

   PowerShell and Git Bash:
   ```
   node scripts/devnet/gen-key.mjs
   ```
   Paste the two printed lines (`DEVNET_CREDENTIAL_KEY_ID=…`, `DEVNET_CREDENTIAL_KEY=…`) into `.env.devnet` over the empty ones (or into the host's secret manager). Keep a copy somewhere safe outside the repository: without it the stored token cannot be read and you must log in again. Every DevNet step refuses to run without it. Never put it in a `NEXT_PUBLIC_*` variable or send it to anyone.
4. Create the database, apply the migrations (0000–0005, including `ledger_credentials` with the encrypted token columns) and seed the synthetic identities:

   PowerShell and Git Bash:
   ```
   node scripts/devnet/db-setup.mjs
   ```
   Expected: `database postgres://collara:***@127.0.0.1:5432/collara_devnet created; migrations applied (incl. 0005_credential_encryption_recovery)` (or `exists` on a re-run).

## (e) Log in once (stores only the refresh token)

Run it yourself, in your own terminal:

PowerShell (or Windows Terminal):
```powershell
node scripts/devnet/login.mjs
```
Git Bash (mintty has no TTY for Node; use winpty):
```bash
winpty node scripts/devnet/login.mjs
```

It asks for the username and the password (the password is not shown), runs one password grant, validates the token, checks that the participant accepts it, and stores **only the refresh token**, encrypted with your `DEVNET_CREDENTIAL_KEY`, in `collara_devnet`. It prints the ledger user id, the access-token expiry and the audience, never a secret. On the first run it ends with a line like:

```
DEVNET_LEDGER_USER_ID=<your ledger user id>
```

Put that line into `.env.devnet` (replace the empty one). Run `login.mjs` again whenever a later step says `Run node scripts/devnet/login.mjs again`.

If you logged in before migration 0005 existed, that plaintext token was erased by the migration: run `login.mjs` again, and also sign out of the team session in the Wallet once (database backups may still hold the old token).

## (f) Preflight → import bindings → bootstrap

1. **Preflight** (read-only):

   PowerShell and Git Bash:
   ```
   node scripts/devnet/preflight.mjs
   ```
   Success: every line `ok` (a `skip` only if you have not logged in), including `ledger user  authenticated as <your id>`, `Collara parties  all 11 Collara hints matched, each with CanActAs`, `connected synchronizers  <alias> <id>`, and `package collara-contracts 0.2.0 … present, vetted` (and the same for `collara-governance`, `governance-action-v1`, `governance-core-v1`, `splice-util`). It also prints the rights table of your user. Exit code 0.
2. **Import bindings** (writes `.local/devnet/state.json` and the DB bindings; allocates nothing):

   PowerShell and Git Bash:
   ```
   node scripts/devnet/import-bindings.mjs
   ```
   Success: `wrote …\.local\devnet\state.json`, the run namespace (`collara-devnet-r<yyyymmddhhmm>`), one line per party (hint, party id, role) and `11 party bindings, 1 ledger user`. If it refuses, it prints the exact list (`missing:`, `near miss`, `ambiguous:`, `read-only:`): fix the parties in the Console (or send the NODERS draft) and run it again.
3. **Bootstrap** (clean-start: asset registry, Tier A governance rules, governed verifier registry with VER-001, config, verifier status mirror; 8 steps):

   PowerShell and Git Bash:
   ```
   node scripts/devnet/bootstrap.mjs
   ```
   Success: lines `B1 … COMMITTED` to `B8 … COMMITTED` with offsets, then `bootstrapped clean-start on collara-devnet-… : 8 ledger steps (0 replayed)` and `first step B1: update <updateId> at offset <n>`. Running it again replays (`8 replayed`) and creates nothing. Optional, after clean-start: `node scripts/devnet/bootstrap.mjs --profile main --skip-documents` adds case CL-001's ledger steps M1–M18 (no document storage needed with `--skip-documents`).

## (g) Verify the first transaction

PowerShell and Git Bash:
```
node scripts/devnet/verify-first-tx.mjs
```
Success (exit code 0):
```
first committed command: seed.B1 (system:registrar), COMMITTED
  updateId <update id>
  offset   <offset>
ACS as <prefix>-CollaraRegistrar::1220… (namespace collara-devnet-…):
  AssetRegistry  <contract id>  created at offset <n>
  CollaraConfig  <contract id>  created at offset <n>
```
In the Console, open the transactions or contracts view of the `CollaraRegistrar` party and find the same update id and contract ids.

Optional, read-only: the DevNet integration test.

PowerShell:
```powershell
$env:DEVNET_IT = "1"; pnpm --filter @collara/api test:devnet; Remove-Item Env:DEVNET_IT
```
Git Bash:
```bash
DEVNET_IT=1 pnpm --filter @collara/api test:devnet
```

## (h) Send back to the lead (non-secret output only)

Send:

- the full output of `preflight.mjs` (after login),
- the output of `import-bindings.mjs` (party ids and the namespace are not secret),
- the summary lines of `bootstrap.mjs` and the output of `verify-first-tx.mjs`,
- the party quota you saw, and any Console error text (DAR upload, party creation, rights) word for word,
- whether the Console granted your user CanActAs/CanReadAs on the new parties by itself, or NODERS had to,
- the output of `node scripts/devnet/recover.mjs` (expected `case: OK`; it shows key ids, never keys).

Never send: the password, any token, `DEVNET_CREDENTIAL_KEY` or `DEVNET_CREDENTIAL_KEY_PREVIOUS`, the contents of `.env.devnet` other than `DEVNET_LEDGER_USER_ID`, a database dump, or a screenshot that shows a token or the key.

The lead records these results in [`docs/devnet-evidence.md`](../devnet-evidence.md).
