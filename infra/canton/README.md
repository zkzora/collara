# Canton configuration (local ledger)

Collara's local ledger is a **Canton 3.5.19 open-source `dpm sandbox`** (Daml SDK 3.5.12, dpm 1.0.22) with 1, 3 or 5 participant nodes on one synchronizer, in one JVM. It is not Splice LocalNet, which needs Docker. State is in memory: party ids, contract ids and offsets are new after every start.

Start and stop it with the scripts in [`scripts/localnet/`](../../scripts/localnet/README.md); they pass these files to `dpm sandbox -c`.

| File | Purpose |
|---|---|
| `sandbox-auth.conf` | JWT auth for the `sandbox` participant: `unsafe-jwt-hmac-256` with a fixed `target-audience`. |
| `extra-participants.conf` | 3-participant mode: adds `participant2` and `participant3`, each with the same auth. Load it after `sandbox-auth.conf`. |
| `extra-participants-5.conf` | 5-participant mode (privacy tests): adds `participant4` and `participant5` on top of `extra-participants.conf`. Load it after both. |

## Authentication (dev only)

`unsafe-jwt-hmac-256` accepts any HS256 token signed with a shared secret. **Use it only on a developer machine.** The committed secret `collara-local-dev-secret-change-me` is a public placeholder. Production uses `jwt-jwks` against the identity provider (Keycloak) and is not configured here.

- Tokens: `aud` = target audience (default `https://collara.local/ledger-api`), `sub` = ledger user id, lifetime of at most 300 s (Canton's default `max-token-lifetime`). Observed: a 300 s token is accepted and a 900 s token gets HTTP 401; `docs/_research/research-canton.md` §3 also saw 301 s rejected.
- Overrides (HOCON `${?VAR}`; the default applies when the variable is unset). Verified: with `CANTON_JWT_HMAC_SECRET` set, tokens signed with it get 200 and tokens signed with the placeholder get 401.
  - `CANTON_JWT_HMAC_SECRET`: shared secret. Set the same value for the scripts, the API and the worker.
  - `CANTON_JWT_AUDIENCE`: token audience.
- With auth enabled, `dpm sandbox --dar ...` makes the sandbox exit. DARs are uploaded afterwards through `POST /v2/dars` with an admin token (`scripts/localnet/bootstrap.mjs`).
- `GET /v2/version`, `/livez` and `/readyz` work without a token.

## Port map

All ports bind to `127.0.0.1`.

| Node | Ledger API (gRPC) | Admin API | JSON Ledger API |
|---|---|---|---|
| `sandbox` | 6865 | 6866 | **7575** |
| `participant2` (3-participant mode) | 6875 | 6876 | **7576** |
| `participant3` (3-participant mode) | 6885 | 6886 | **7577** |
| `participant4` (5-participant mode) | 6895 | 6896 | **7578** |
| `participant5` (5-participant mode) | 6905 | 6906 | **7579** |
| `sequencer1` | 6867 public, 6868 admin | | |
| `mediator1` | | 6869 admin | |

The synchronizer alias is `synchronizer-1` (protocol version 35). `up.mjs` writes the ports Canton actually bound to `.local/localnet/ports.json`.

## Resources (observed on the authoring machine)

- Ready in 31 to 77 s (`/readyz` returns 503 until the participant is connected).
- `JDK_JAVA_OPTIONS=-Xmx1g` (set by `up.mjs`) worked for both 1 and 3 participants.
- 5 participants: started with `LOCALNET_JDK_JAVA_OPTIONS=-Xmx1536m`; ready in 41 to 54 s; java.exe working set about 1.6 GB right after start (2026-10-03).
- The process tree is `dpm.exe` → `java.exe`. Stop it with `node scripts/localnet/down.mjs`, which runs `taskkill /PID <pid> /T /F`.
