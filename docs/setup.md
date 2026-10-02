# Local setup (draft)

Status: draft, 2026-10-02. Every command in the main sections was run on the authoring machine. The
Docker section at the end was **not** run (that machine has no Docker). All data and accounts are
synthetic and for local development only.

Authoring machine: Windows 11, Node 24.16.0, Temurin Java 21.0.12.1, WSL2 Ubuntu 24.04 with
PostgreSQL 16.14, no Docker. Workspace install, checks and dev servers are in the root
[`README.md`](../README.md); the Canton ledger is in [`scripts/localnet/README.md`](../scripts/localnet/README.md).

## Prerequisites

| Need | For | Notes |
|---|---|---|
| Node.js 24 (`>=24.15.0 <25`) | every script | The scripts are plain `.mjs` with no dependencies of their own. |
| `pnpm install` done | the `check` commands and the database login check | They borrow `pg` (from `packages/db`) and `@aws-sdk/*` (from `apps/api`). |
| Internet access on first use | SeaweedFS and Keycloak downloads | Archives are checked against pinned SHA-256 values. |
| Java 21 (`JAVA_HOME` or `PATH`) | Keycloak | 17 and 25 are also supported by Keycloak 26.7. |
| WSL2 with an Ubuntu distro running PostgreSQL 16 on port 5432 | PostgreSQL on Windows | Distro name `Ubuntu` by default (`COLLARA_WSL_DISTRO` overrides). `sudo` is used as root inside WSL, so no password prompt. |
| Free RAM | | Keycloak about 0.5 GB, SeaweedFS about 0.1 GB, the WSL VM 0.5 to 1 GB. |

The same `node …` commands work in PowerShell 5.1 and Git Bash. Run them from the repo root. Every
command below was run from both shells, except `wsl-postgres.mjs status` and `stop` (Git Bash only)
and `seaweedfs.mjs install` (Git Bash only; `start` installs implicitly). From PowerShell, Keycloak and
SeaweedFS were started and checked with values from a fresh `.env` created by `init-env.mjs`.

## 1. Environment file

```sh
node scripts/dev/init-env.mjs
```

Creates `.env` from [`.env.example`](../.env.example) and fills the empty dev secrets
(`SESSION_SECRET`, `COLLARA_OIDC_CLIENT_SECRET`, `KC_BOOTSTRAP_ADMIN_PASSWORD`, `COLLARA_S3_SECRET_KEY`)
with random values. Re-running it never changes a value that is already set; it only fills empty or
missing secrets and prints their names. The infrastructure scripts, the API and the worker read `.env`;
variables set in the shell take precedence. For the web app, copy
[`infra/env/web.env.example`](../infra/env/web.env.example) to `apps/web/.env.local`.

Without `.env`, set the variables in the shell instead:

```powershell
# PowerShell
$env:COLLARA_S3_ACCESS_KEY = "collara-dev"
$env:COLLARA_S3_SECRET_KEY = "<random dev-only value>"
```

```bash
# Git Bash
export COLLARA_S3_ACCESS_KEY=collara-dev COLLARA_S3_SECRET_KEY='<random dev-only value>'
```

## 2. PostgreSQL 16 in WSL (Windows)

```sh
node scripts/dev/wsl-postgres.mjs up       # keepalive, role + databases, login check, prints DATABASE_URL
node scripts/dev/wsl-postgres.mjs status   # exit code 0 when 127.0.0.1:5432 accepts the dev login
node scripts/dev/wsl-postgres.mjs stop     # stops the keepalive only
```

`up` does the following:

1. It starts a hidden `wsl -d Ubuntu --exec sleep infinity` keepalive, because WSL stops idle distros. The pid is in `.local/wsl/keepalive.pid.json`.
2. It starts the cluster on port 5432 if it is down.
3. It creates the `collara` role (password `collara_dev`) and the `collara` and `collara_test` databases **only if they are missing**. It never drops, alters or touches anything else in the cluster.
4. It waits until `127.0.0.1:5432` is reachable from Windows through WSL localhost forwarding.
5. It logs in to both databases from Windows and prints:

```text
DATABASE_URL=postgres://collara:collara_dev@127.0.0.1:5432/collara
TEST_DATABASE_URL=postgres://collara:collara_dev@127.0.0.1:5432/collara_test
```

A cold start (WSL stopped) took 35 to 90 s; with WSL already running it took about 8 s. After `stop`, WSL
shut the distro down by itself about 35 s later. The script never runs `wsl --shutdown` or
`--terminate`, so other WSL sessions are left alone.

## 3. Evidence storage: SeaweedFS 4.48 (S3)

```sh
node scripts/infra/seaweedfs.mjs start    # downloads weed.exe on first use, then runs `weed mini`
node scripts/infra/seaweedfs.mjs check    # private-bucket and presigned-URL smoke test
node scripts/infra/seaweedfs.mjs status
node scripts/infra/seaweedfs.mjs stop
```

- `install` (also run implicitly by `start`) downloads `windows_amd64.zip` from the GitHub release. It checks the pinned SHA-256 and puts `weed.exe` in `.local/bin`.
- `start` refuses to run without `COLLARA_S3_ACCESS_KEY` and `COLLARA_S3_SECRET_KEY`, because SeaweedFS without keys serves every bucket anonymously.
  - It binds to `127.0.0.1` only. S3 is on **8333**; master 9333, volume 9340 and filer 8888 run internally.
  - The admin UI, WebDAV, Iceberg and Lance listeners are off. With the UI off, an admin process still listens on 127.0.0.1:23646.
  - It creates the bucket `COLLARA_S3_BUCKET` (default `collara-evidence`). Data is kept in `.local/seaweedfs/data` and the log in `.local/seaweedfs/weed.log`. Start-up took 1 to 2 s.
- The key pair is applied on every start: after changing the secret and restarting, the old secret was rejected.
- `check` uses the AWS SDK from `apps/api`. Verified result:

```text
ok    bucket collara-evidence exists
ok    authenticated PutObject
ok    anonymous GET object is denied  (HTTP 403)
ok    anonymous list bucket is denied  (HTTP 403)
ok    presigned GET (60 s)  (HTTP 200)
ok    presigned PUT (60 s)  (HTTP 200)
ok    presigned GET with a bad signature is denied  (HTTP 403)
ok    bucket has no public policy  (NoSuchBucketPolicy)
ok    cleanup
```

Client settings that worked: `forcePathStyle: true`, region `us-east-1`, endpoint `http://127.0.0.1:8333`,
`requestChecksumCalculation` and `responseChecksumValidation` set to `"WHEN_REQUIRED"`. Per-identity
least-privilege keys (`-s3.config`) were **not** tested; locally the API key pair is SeaweedFS's admin identity.

## 4. OIDC: Keycloak 26.7.5

```sh
node scripts/infra/keycloak.mjs start    # downloads the zip on first use, imports the realm, waits for discovery
node scripts/infra/keycloak.mjs check    # discovery, PKCE enforcement, a code-flow login for every demo user
node scripts/infra/keycloak.mjs status
node scripts/infra/keycloak.mjs stop
node scripts/infra/keycloak.mjs reset    # stop + delete the dev database so the next start re-imports the realm
```

- `start` needs `COLLARA_OIDC_CLIENT_SECRET` and `KC_BOOTSTRAP_ADMIN_PASSWORD` (`KC_BOOTSTRAP_ADMIN_USERNAME` defaults to `admin`). It does the following:
  1. Downloads `keycloak-26.7.5.zip` (SHA-256 pinned) into `.local/keycloak`.
  2. Copies [`infra/keycloak/collara-realm.json`](../infra/keycloak/collara-realm.json) into `data/import` with the client secret substituted.
  3. Runs `kc.bat start-dev --http-host=127.0.0.1 --http-port=18080 --http-management-port=19000 --health-enabled=true --import-realm` hidden in the background, with `JAVA_OPTS_KC_HEAP=-Xms64m -Xmx512m`.
- Issuer: `http://localhost:18080/realms/collara`. Discovery: `http://localhost:18080/realms/collara/.well-known/openid-configuration` (HTTP 200). Health: `http://127.0.0.1:19000/health/ready`. Admin console: `http://localhost:18080/admin/`.
- Timing on the authoring machine (low free memory): the first start, including Keycloak's one-time build step, took 3 min 40 s. A restart took about 1 min. The Java process used about 0.5 GB.
- Keycloak only imports a realm that does not exist yet. After editing the realm file or changing `COLLARA_OIDC_CLIENT_SECRET`, run `reset` and then `start`; `start` warns when the imported realm is stale.
- Verified `check` result: discovery and issuer ok, S256 advertised, an authorization request without PKCE refused (`invalid_request`), a token exchange with the wrong PKCE verifier refused (HTTP 400 `invalid_grant`), and all 9 demo users logged in (HTTP 200, 300 s access tokens). With a wrong client secret, the token exchanges fail with HTTP 401 `unauthorized_client`.

The realm, client and demo users are described in [`infra/keycloak/README.md`](../infra/keycloak/README.md).
Every demo user's password is `collara-demo-only`. These are synthetic local accounts; never import this realm
into a shared or reachable Keycloak.

## 5. Run the LOCALNET demo

The full stack on one machine: WSL PostgreSQL, SeaweedFS, a Canton 3.5.19 `dpm sandbox` (one participant),
the worker, the API and `next start`. These are the commands used for the demo on the authoring machine
(2026-10-02), from the repo root. The worker, the API and the web server each stay in the foreground, so give
each its own terminal.

1. Infrastructure and ledger:

   ```sh
   pnpm db:up                       # WSL PostgreSQL with a keepalive
   pnpm infra:seaweed start         # evidence storage (S3 on 8333)
   pnpm localnet:up                 # Canton sandbox, JSON API on 7575
   pnpm localnet:bootstrap          # DARs, parties, ledger users → .local/localnet/state.json
   pnpm db:migrate
   pnpm localnet:seed --profile main   # CL-001 main fixture through the API's workflow runner (ledger + database)
   ```

2. In `.env`, set:

   ```
   COLLARA_MODE=LOCALNET
   DEMO_SESSIONS_ENABLED=true
   ```

3. Worker and API (each in its own terminal; both read `.env`):

   ```sh
   pnpm --filter @collara/worker start   # projection, reconciliation, export jobs; health on 4100
   pnpm --filter @collara/api start      # API on 4000
   ```

4. Web. `next start` reads `COLLARA_MODE` per request; set it for the build as well, as below:

   ```bash
   # Git Bash
   COLLARA_MODE=LOCALNET pnpm --filter @collara/web build
   COLLARA_MODE=LOCALNET pnpm --filter @collara/web start
   ```

   ```powershell
   # PowerShell
   $env:COLLARA_MODE = "LOCALNET"; pnpm --filter @collara/web build
   $env:COLLARA_MODE = "LOCALNET"; pnpm --filter @collara/web start
   ```

5. Open <http://localhost:3000/login> and choose a demo persona. The banner reads
   `Synthetic demo data — Canton LocalNet.`

Re-running `pnpm localnet:seed --profile main` replays the stored outcome of every step. It does not reset a
case that was walked forward. For a fresh CL-001, seed a new prefix (below) or restart the sandbox and
bootstrap again (party ids change on every sandbox start).

### A second, isolated stack next to the demo

Tests and rehearsals use their own namespace, database and ports. They never touch the demo's default
namespace, the `collara` database or `.local/localnet/state.json`. This is how the browser and adversarial
checks in [`verification.md`](verification.md) were run, next to a running demo (`<p>` is a prefix such as
`e2e`; the database is `collara_<p>`):

```bash
# Git Bash
node scripts/localnet/bootstrap.mjs --prefix <p>
pnpm localnet:seed --prefix <p> --profile main --database-url postgres://collara:collara_dev@127.0.0.1:5432/collara_<p>
# worker (port 4210), API (port 4200) and web (port 3100), each in its own terminal:
COLLARA_MODE=LOCALNET WORKER_PORT=4210 DATABASE_URL=postgres://collara:collara_dev@127.0.0.1:5432/collara_<p> \
  COLLARA_LOCALNET_STATE=C:/Collara/.local/localnet/state-<p>.json pnpm --filter @collara/worker start
COLLARA_MODE=LOCALNET PORT=4200 DATABASE_URL=postgres://collara:collara_dev@127.0.0.1:5432/collara_<p> \
  COLLARA_LOCALNET_STATE=C:/Collara/.local/localnet/state-<p>.json DEMO_SESSIONS_ENABLED=true \
  PUBLIC_ORIGIN=http://localhost:3100 pnpm --filter @collara/api start
COLLARA_MODE=LOCALNET NEXT_DIST_DIR=.next-e2e pnpm --filter @collara/web build
COLLARA_MODE=LOCALNET NEXT_DIST_DIR=.next-e2e API_INTERNAL_ORIGIN=http://127.0.0.1:4200 pnpm --filter @collara/web exec next start --port 3100
```

`COLLARA_LOCALNET_STATE` must be a Windows path (`C:/…`): Git Bash does not rewrite variables. `PUBLIC_ORIGIN`
must be the second web server's origin, or the API's CSRF origin check refuses its mutations. Use one
`next build` at a time on a machine with little free memory. Afterwards, stop the three processes, drop
`collara_<p>` and delete `.local/localnet/state-<p>.json`. The prefix's parties stay on the sandbox, isolated.

## Ports

| Service | Ports (all bound to 127.0.0.1) |
|---|---|
| PostgreSQL (WSL) | 5432 |
| SeaweedFS | S3 8333; master 9333, volume 9340, filer 8888, gRPC 18333/18888/19333/19340, admin 23646 |
| Keycloak | HTTP 18080, management 19000 |

Ports for web, API, worker and Canton are in the root `CLAUDE.md`.

## Local state (`.local/`, git-ignored)

| Path | Content |
|---|---|
| `.local/bin/weed.exe`, `weed.version.json` | SeaweedFS binary and its recorded checksums |
| `.local/seaweedfs/` | `data/`, `weed.log`, `weed.pid.json` |
| `.local/keycloak/` | `keycloak-26.7.5/` (including the H2 dev database in `data/h2` and the rendered realm with the client secret in `data/import`), `keycloak.log`, `keycloak.pid.json` |
| `.local/wsl/` | `keepalive.pid.json`, `keepalive.log` |
| `.local/downloads/` | archives during installation (deleted afterwards) |

## Troubleshooting

- **Port already in use.** `start` refuses to start when its port is taken by another process. Check with `netstat -ano | findstr :8333` (or `:18080`, `:19000`).
- **Pid files.** `stop` and `status` only act on a recorded pid whose command line still matches the service, so a stale pid file never kills an unrelated process.
- **SeaweedFS start fails with `Access is denied` on `conf.tmp`.** This happened once right after a restart; it is a transient Windows file lock. `start` retries once automatically.
- **Interrupting `start` in Git Bash.** Interrupting `start` with Ctrl+C or a `timeout` wrapper in Git Bash can also stop the service it was starting. Run `stop` and `start` again.
- **Keycloak console window.** `kc.bat` hangs when it runs without a console. The script starts it through `scripts/infra/supervise.mjs`, a small Node process that gives it a hidden console. The recorded pid is that supervisor, and `stop` kills the whole tree.

## Other machines: Docker Compose (UNTESTED)

[`infra/compose/compose.yaml`](../infra/compose/compose.yaml) has not been run, because the authoring machine has no Docker. It defines:

- `postgres:16.15-alpine`, user `collara`, password `collara_dev`, databases `collara` and `collara_test`;
- `chrislusf/seaweedfs:4.48`, whose image default is `weed mini -dir=/data`, with the keys from `.env`;
- `quay.io/keycloak/keycloak:26.7.5` (`start-dev --import-realm`, realm mounted read-only).

It publishes the same ports on 127.0.0.1 and has healthchecks. What was checked without Docker: the file parses as YAML, the three image tags exist in their registries, and the SeaweedFS image's default command is `mini -dir=/data`.

```sh
node scripts/dev/init-env.mjs
docker compose --env-file .env -f infra/compose/compose.yaml up -d
```

## Not verified yet

- Docker Compose (see above). The native scripts on Linux/macOS: the SeaweedFS script is Windows-only, and the Keycloak script has an untested `kc.sh` branch.
- Least-privilege SeaweedFS identities, CORS for browser-side presigned uploads, and SeaweedFS behaviour across a Windows reboot.
- The API and worker against these services (the auth, storage and persistence code is being built separately).
