# LocalNet scripts

Plain Node 24 scripts (no dependencies) that run the local Canton ledger for Collara's `LOCALNET` mode: a Canton 3.5.19 `dpm sandbox` with HMAC JWT auth (see [`infra/canton/README.md`](../../infra/canton/README.md) for configs and ports). They work the same from PowerShell 5.1, cmd and Git Bash.

Prerequisites: Daml SDK 3.5.12 installed with dpm 1.0.22 (`%APPDATA%\dpm`, or set `DPM_HOME`), Java 21 on `PATH`, about 1.1 GB of free RAM per sandbox.

| Script | What it does |
|---|---|
| `up.mjs [--participants=1\|3] [--timeout=240] [--bootstrap]` | Starts `dpm sandbox` detached with `JDK_JAVA_OPTIONS=-Xmx1g`, `-c infra/canton/sandbox-auth.conf` (plus `extra-participants.conf` for 3), `--json-api-port 7575`, `--canton-port-file`. Writes the pid, waits for the ports file and `/readyz` = 200 on every participant. Stops the sandbox again if it is not ready in time. Refuses to start if a port is already taken. `--bootstrap` runs `bootstrap.mjs` afterwards. |
| `down.mjs` | Kills the process tree (`taskkill /PID <pid> /T /F` on Windows) and removes the pid and ports files. Leaves `state.json` (see below). |
| `status.mjs [--json]` | Process, readiness, Canton version, participant id and ledger end per participant, and whether `state.json` matches the running ledger. Exit code 0 when every participant is ready. |
| `bootstrap.mjs [--dar <file>]... [--config <file>] [--json-api-url <url>]` | Uploads DARs (`vetAllPackages=true`), allocates parties, creates least-privilege ledger users and writes `.local/localnet/state.json`. Idempotent. |

## Verified commands

PowerShell 5.1 (from the repo root):

```powershell
node scripts/localnet/up.mjs --bootstrap
node scripts/localnet/status.mjs
node scripts/localnet/down.mjs
```

Git Bash (from the repo root):

```bash
node scripts/localnet/up.mjs --bootstrap
node scripts/localnet/status.mjs
node scripts/localnet/down.mjs
```

3-participant mode (JSON APIs on 7575, 7576 and 7577):

```bash
node scripts/localnet/up.mjs --participants=3 --bootstrap
```

Build the Collara DARs first so `bootstrap.mjs` finds them: `dpm build --all` in `daml/collara` (see the root `CLAUDE.md` for the dpm PATH setup in each shell).

## Files (`.local/localnet/`, git-ignored)

| File | Content |
|---|---|
| `sandbox.pid.json` | pid of the detached `dpm` process, participant count, start time, command line |
| `ports.json` | Canton's port file: `{ "sandbox": { "ledgerApi": 6865, "adminApi": 6866, "jsonApi": 7575 }, ... }` |
| `sandbox.out.log`, `canton.log` | sandbox stdout/stderr and the Canton log |
| `state.json` | bootstrap result, read by the API and worker through `loadLocalnetState()` in `@collara/canton` |

## Bootstrap

Configuration: [`localnet.config.json`](localnet.config.json).

- **DARs.** By default every `*.dar` under `daml/collara/**/.daml/dist/`, except the packages in `dars.excludePackages` (`collara-tests`, `collara-scripts`): they depend on `daml-script`, and the tests package holds a test-only attacker template. Pass `--dar <file>` (repeatable) to upload exactly those files instead. A DAR whose main package is already registered is skipped. The main package id is read from the DAR manifest.
- **Parties** (by hint): `CollaraRegistrar`, `CollaraGovernance`, `DemoManufacturer`, `DemoCNCDealer`, `DemoVerifier`, `DemoLenderA`, `DemoLenderB`, `DemoAuditor`, `GovSeat1`, `GovSeat2`, `GovSeat3`. Existing local parties with the same hint are reused.
- **Users**, one per party, with `CanActAs` + `CanReadAs` for that party only. The governance seat users also get `CanReadAs CollaraGovernance`. Missing rights are granted and extra rights are revoked on every run.

  | Party hint | User |
  |---|---|
  | CollaraRegistrar | `registrar-svc` |
  | CollaraGovernance | `governance-svc` |
  | DemoManufacturer | `borrower-svc` |
  | DemoCNCDealer | `dealer-svc` |
  | DemoVerifier | `verifier-svc` |
  | DemoLenderA | `lender-a-svc` |
  | DemoLenderB | `lender-b-svc` |
  | DemoAuditor | `auditor-svc` |
  | GovSeat1 / GovSeat2 / GovSeat3 | `gov-seat-1-svc` / `gov-seat-2-svc` / `gov-seat-3-svc` |

- `projector-svc` (worker): `CanReadAs` every party hosted on the participant. This is a privileged, read-only operator credential.
- `collara-admin`: `ParticipantAdmin`. Bootstrap itself uses the built-in `participant_admin`.
- **3-participant placement** (the `participant` field; ignored with one participant): `participant2` hosts DemoManufacturer and DemoCNCDealer; `participant3` hosts DemoLenderA and GovSeat1; `sandbox` hosts the rest. This placement is a proposal for privacy tests, not a decision. Each participant gets the DARs, its own `projector-svc` and `collara-admin`, and bootstrap waits until every participant knows every party.
- **Reset detection.** The sandbox gets a new participant id on every start. When the participant id differs from the one in `state.json`, bootstrap logs `ledger reset detected` and rebuilds everything; otherwise it only verifies. Party ids in `state.json` are valid only while `participantId` matches.

`state.json` (abridged; no secrets):

```json
{
  "version": 1,
  "topology": "sandbox-1-participant",
  "cantonVersion": "3.5.19",
  "audience": "https://collara.local/ledger-api",
  "jsonApiUrl": "http://127.0.0.1:7575",
  "participantId": "sandbox::1220…",
  "participants": { "sandbox": { "jsonApiUrl": "http://127.0.0.1:7575", "participantId": "sandbox::1220…", "ledgerEndAtBootstrap": 43 } },
  "parties": { "DemoManufacturer": { "party": "DemoManufacturer::1220…", "participant": "sandbox", "user": "borrower-svc" } },
  "users": [{ "id": "borrower-svc", "participant": "sandbox", "role": "org", "party": "DemoManufacturer", "primaryParty": "DemoManufacturer::1220…", "actAs": ["…"], "readAs": ["…"] }],
  "packages": [{ "file": "daml/collara/contracts/.daml/dist/collara-contracts-0.1.0.dar", "name": "collara-contracts", "version": "0.1.0", "mainPackageId": "…", "sha256": "…" }]
}
```

## Environment variables

| Variable | Default | Used by |
|---|---|---|
| `DPM_HOME` | `%APPDATA%\dpm` | `up.mjs` (finds `bin\dpm.cmd`, then the `dpm.exe` it calls) |
| `LOCALNET_JDK_JAVA_OPTIONS` | `-Xmx1g` | `up.mjs` (passed to the JVM as `JDK_JAVA_OPTIONS`) |
| `LOCALNET_DIR` | `.local/localnet` | all scripts |
| `CANTON_JWT_HMAC_SECRET` | dev placeholder | sandbox config and all scripts (must match) |
| `CANTON_JWT_AUDIENCE` | `https://collara.local/ledger-api` | sandbox config and all scripts |
| `CANTON_JSON_API_URL` | from `ports.json`, else `http://127.0.0.1:7575` | `bootstrap.mjs` (single participant) |

## Troubleshooting

- **Port in use.** `up.mjs` refuses to start when 7575, 6865 or 6866 (and 7576/7577 and their gRPC ports in 3-participant mode) answer. Stop the other process, or run `down.mjs` if it was started by `up.mjs`.
- **The sandbox disappears.** It is an ordinary `java.exe`; anything that kills Java processes stops it. `status.mjs` then shows the pid as not running. Run `up.mjs` again and re-bootstrap.
- **Changed Daml, same package version.** After rebuilding a DAR with changed templates, restart the sandbox (or bump `version` in `daml.yaml`). A running participant should not be expected to accept a different package under the same name and version (Canton package-upgrade rules; not exercised here).
- **Java heap.** If the 3-participant sandbox runs out of memory, use `LOCALNET_JDK_JAVA_OPTIONS=-Xmx1536m` (the research spike used that; `-Xmx1g` worked here).
