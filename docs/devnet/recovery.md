# DevNet recovery

What to do when the shared DevNet participant was reset or pruned, the refresh token was revoked, the credential key or the DEVNET database was lost, or a package must be uploaded again. **Status, 2026-10-05: code and unit tests only; not exercised on DevNet** (nothing has run there yet). Synthetic data only. Background: [`../devnet.md`](../devnet.md); first-time setup: [`owner-checklist.md`](owner-checklist.md).

Every command runs from the repository root and reads `.env.devnet`. Each works the same in **PowerShell** and **Git Bash** unless noted.

## 1. Detect

Three places report the same recovery cases (`DEVNET_RECOVERY_CASES`, `packages/canton/src/devnet-recovery.ts`):

| Where | What you see |
|---|---|
| `node scripts/devnet/recover.mjs` | read-only diagnosis: one line per check, the case, and the exact next commands. Exit 0 = nothing to recover, 2 = a case applies (2 is also returned when `.env.devnet` is missing), 1 = error. `--json` for machine output. |
| worker `GET /healthz` (port 4100) | `recovery.case`, `recovery.findings[].next`, per source `status` (`ACTIVE`, `RESET_DETECTED`, `PRUNED`), `recoveryCase` of the last error, `historyFloor`. Re-checked every `DEVNET_RECOVERY_CHECK_INTERVAL_MS` (default 300 000 ms). The case is logged when it changes. |
| API `GET /api/system/health` | `ledger` detail starts with `CREDENTIAL_MISSING`, `CREDENTIAL_REVOKED` or `CREDENTIAL_KEY`; `worker` detail starts with `PRUNED` or `LEDGER_RESET`. No token, key, key id, user id or URL. |

| Case | Signal |
|---|---|
| `DATABASE_MISSING` | DEVNET database unreachable, or not migrated to `0005` (lost or new database) |
| `CREDENTIAL_MISSING` | no row in `ledger_credentials` |
| `CREDENTIAL_REVOKED` | the identity provider answered `invalid_grant` (revoked, expired, reused, session ended), or migration 0005 erased a plaintext token: row `REAUTH_REQUIRED` |
| `CREDENTIAL_KEY` | the stored ciphertext does not open with `DEVNET_CREDENTIAL_KEY` / `_PREVIOUS` (unknown key id, wrong key bytes, or the row was copied or altered) |
| `LEDGER_UNREACHABLE` | network error, timeout, 5xx, identity provider down |
| `LEDGER_RESET` | participant id differs from `.local/devnet/state.json` or from the projection, ledger end behind the projection checkpoint, or the worker set `RESET_DETECTED`; also `OFFSET_AFTER_LEDGER_END` / `OFFSET_OUT_OF_RANGE` |
| `STATE_MISSING` | no (or no DevNet) `.local/devnet/state.json` |
| `PARTIES_MISSING` | a bound Collara party is not in the tenant user's `CanActAs` rights; a redacted 403 on a read as the bound parties |
| `PACKAGES_MISSING` | a manifest package is not present or not vetted; `PACKAGE_NAMES_NOT_FOUND`, `TEMPLATES_OR_INTERFACES_NOT_FOUND` |
| `PRUNED` | `GET /v2/state/latest-pruned-offsets` → `participantPrunedUpToInclusive` is above the projection checkpoint, or `/v2/updates` failed with `PARTICIPANT_PRUNED_DATA_ACCESSED` |

Error ids: `PARTICIPANT_PRUNED_DATA_ACCESSED` is the id named in the committed Canton 3.5.19 OpenAPI (`packages/canton/openapi/canton-3.5.19.yaml`). `OFFSET_AFTER_LEDGER_END` and `OFFSET_OUT_OF_RANGE` come from the Canton error-code reference, not from the committed spec. None of them has been observed on DevNet; the test bodies for them are **synthetic** (`packages/canton/src/__fixtures__/errors-synthetic/`), not recorded.

The worker never mixes histories and never re-projects from a pruned offset: a source in `RESET_DETECTED` or `PRUNED` stops applying updates until an operator acts.

## 2. Decide

Run the diagnosis and follow the first `FAIL`:

```
node scripts/devnet/recover.mjs
```

| Case | Keeps the run namespace? | Action |
|---|---|---|
| `CREDENTIAL_MISSING`, `CREDENTIAL_REVOKED` | yes | §4 |
| `CREDENTIAL_KEY` | yes | §5 |
| `LEDGER_UNREACHABLE` | yes | wait; `node scripts/devnet/preflight.mjs`; re-run the diagnosis |
| `PARTIES_MISSING` | yes, if the same parties get their rights back | §6 |
| `PACKAGES_MISSING` | yes | §7 |
| `PRUNED`, checkpoint within retention (shown as `WARN pruning`) | yes | nothing: the worker resumes from its checkpoint |
| `PRUNED`, past the checkpoint | **no: new run** | §3 |
| `LEDGER_RESET` | **no: new run** | §3 |
| `DATABASE_MISSING` (lost database) | **no: new run** | §8 |
| `STATE_MISSING` | new namespace | `node scripts/devnet/recover.mjs --new-run --yes` |

## 3. Reset or pruning: start a new run

Stop the worker and the API first. Then:

1. Reset only: in the Console check that the eleven Collara parties still exist and re-create the missing ones with the exact names (owner checklist step b); re-upload the two DARs if preflight shows them `NOT present` (step c).
2. `node scripts/devnet/recover.mjs` until the only `FAIL` left is `LEDGER_RESET` or `PRUNED`.
3. Start the new run:

   ```
   node scripts/devnet/recover.mjs --new-run --yes
   ```
   Optional `--run-ref <ref>` (1–31 lower-case letters, digits, `-`); default `r<yyyymmddhhmm>` (UTC). It:
   1. refuses while a credential, key, database, parties, packages or reachability problem is open;
   2. imports the bindings into a new run namespace `collara-devnet-<runRef>` (`.local/devnet/state.json` and the DEVNET database's bindings; never allocates parties, reads only the tenant user's own rights);
   3. resets **only** the `devnet` projection source in the DEVNET database (`resetProjectionSource`, the same code as `pnpm --filter @collara/worker projection:reset`): its projected contracts, events and updates are deleted, command records are kept. After a reset it restarts at offset 0. On a pruned participant it restarts at the pruning offset and records it as `history_floor_offset`: nothing at or before that offset is projected;
   4. runs the clean-start bootstrap (B1–B8) on the new namespace; committed steps replay.

   Each step is skipped when already done, so running the command again is safe (a completed run plans "bootstrap only", which replays).
4. Start the worker and the API (they load the new state), then `node scripts/devnet/verify-first-tx.mjs` and `node scripts/devnet/recover.mjs` (expect `case: OK`).

**Pruning without a reset.** Projections from before the pruning horizon cannot be rebuilt: the participant no longer serves those updates, and a read from offset 0 would silently start at the pruning offset. So:

- If the checkpoint is at or above the pruning offset, nothing is lost: keep the projection; the worker resumes from its checkpoint.
- If the participant pruned past the checkpoint, the source becomes `PRUNED` and the existing projection is **kept** (as history, read-only). Continuing needs a new run (step 3). A new run's projection starts at the pruning offset: contracts of earlier runs created before it are not in the new projection; the new run's own contracts all come after it.
- `projection:reset` from offset 0 on a pruned participant is refused by the worker on its next pass (`PRUNED` again), never silently applied.

Contracts of an abandoned run stay on DevNet as synthetic data; Collara cannot delete them and never calls reset, pruning or any other admin endpoint.

## 4. Lost or revoked credential

The owner, in their own terminal:

PowerShell:
```powershell
node scripts/devnet/login.mjs
```
Git Bash:
```bash
winpty node scripts/devnet/login.mjs
```
Then `node scripts/devnet/recover.mjs`. Nothing else changes: same namespace, same projection. Running processes pick up the new token at their next refresh.

## 5. Credential key: lost, wrong, rotated

The refresh token is stored AES-256-GCM encrypted (`packages/db/src/credential-cipher.ts`): fresh 96-bit nonce per write; key id, nonce, ciphertext and tag in `ledger_credentials`; additional authenticated data = credential id + ledger user id + key id, so a ciphertext copied to another row or relabelled fails. The key is in `.env.devnet` or the host's secret manager, never in the database, never in `NEXT_PUBLIC_*` (API, worker, scripts and `next build` refuse that), and is redacted from logs.

- **Generate** (first time): `node scripts/devnet/gen-key.mjs`, paste both printed lines into `.env.devnet` (`DEVNET_CREDENTIAL_KEY_ID`, `DEVNET_CREDENTIAL_KEY`). Use the same values for the API and the worker.
- **Wrong key** (`CREDENTIAL_KEY`, "does not decrypt with key id …"): put back the key that wrote the row. Nothing was changed by the failed attempt.
- **Lost key**: the token cannot be recovered. Generate a new key, then log in again (§4). The old row is overwritten by the login.
- **Rotate**:
  1. In `.env.devnet`, keep the current pair as `DEVNET_CREDENTIAL_KEY_PREVIOUS=<current id>:<current key>`.
  2. `node scripts/devnet/gen-key.mjs` and put the new pair in `DEVNET_CREDENTIAL_KEY_ID` / `DEVNET_CREDENTIAL_KEY` (the id must differ, e.g. `--id k2`).
  3. Restart the API and the worker. The next refresh (within one access-token lifetime, or at once with `node scripts/devnet/preflight.mjs`) re-encrypts the row with the new key; preflight then shows `encrypted with key <new id>`.
  4. Remove `DEVNET_CREDENTIAL_KEY_PREVIOUS`.
- **Plaintext token from before migration 0005**: the migration erases it and marks the row `REAUTH_REQUIRED` (SQL cannot encrypt without the key, and no plaintext token should survive the migration): log in again (§4). If a plaintext token ever existed, also end the team's session in the Wallet/Keycloak, because database backups may still hold it.

## 6. Parties missing

`recover.mjs` lists each bound party the tenant user has no `CanActAs` on. In the Console, restore `CanActAs` + `CanReadAs` of the tenant user on them, or send [`noders-rights-request.md`](noders-rights-request.md); Collara never grants rights or allocates parties. If the parties are gone and you re-created them (new party ids), start a new run (§3).

## 7. Packages missing, or a re-upload with a bumped version

1. `node scripts/devnet/build-dars.mjs --check` (the files match the committed manifest).
2. Console → Collections → Upload DAR, in manifest order, and vet (owner checklist step c).
3. If the node refuses the upload because the same name and version already exists with different content, **bump the package version** (e.g. `collara-contracts` 0.2.0 → 0.3.0 in its `daml.yaml`), rebuild (`node scripts/devnet/build-dars.mjs`), commit the regenerated `docs/devnet/upload-manifest.*`, upload the new DAR, and start a new run (§3) so new contracts use it. Never re-upload different content under an existing version.
4. `node scripts/devnet/recover.mjs`.

## 8. Lost DEVNET database

1. `pnpm db:up` (if PostgreSQL was only stopped, this is all: re-run the diagnosis).
2. `node scripts/devnet/db-setup.mjs`
3. Log in again (§4): the refresh token was in the lost database.
4. `node scripts/devnet/recover.mjs --new-run --yes`. The old run's command records are gone; the bootstrap never reseeds a namespace another database seeded, it moves to a fresh one. On a pruned participant the projection starts at the pruning offset (§3).

## 9. Files

| Path | Purpose |
|---|---|
| `packages/canton/src/devnet-recovery.ts` | cases, `classifyRecoveryError`, `observeDevnetLedger`, `diagnoseDevnet`, `formatDiagnosis` |
| `packages/canton/src/credential-key.ts` | `DEVNET_CREDENTIAL_KEY*` parsing and guards |
| `packages/db/src/credential-cipher.ts`, `credentials.ts`, migration `0005_credential_encryption_recovery.sql` | envelope, encrypted store, legacy-row handling |
| `packages/db/src/projection/project.ts` | `PRUNED` detection, `resetProjectionSource({ startOffset })` |
| `apps/api/src/devnet/recovery.ts`, `cli.ts` (`recover`) | observation, `--new-run` plan and steps |
| `apps/worker/src/ledger.ts`, `runtime.ts` | periodic recovery check in `/healthz` |
| `scripts/devnet/recover.mjs`, `scripts/devnet/gen-key.mjs` | entry points |
