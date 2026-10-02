# Deployment (proposal, untested)

**Status, 2026-10-02: nothing here has been built, deployed or run.** The authoring machine has no Docker, so the Dockerfiles and Compose profiles were written but never built. Collara is an MVP with synthetic data; this is not a production-ready system and there is no security assurance. **Publishing anything to a reachable URL requires the project owner's explicit authorization**, and the open items in §5 block any public deployment.

What exists to start from:

| Artifact | Purpose | State |
|---|---|---|
| [`apps/web/Dockerfile`](../../apps/web/Dockerfile) | Next.js standalone server (`NEXT_OUTPUT=standalone` build flag in `apps/web/next.config.ts`; the default build is unchanged) | Never built |
| [`apps/api/Dockerfile`](../../apps/api/Dockerfile) | API on Node 24 + tsx, non-root, healthcheck | Never built |
| [`apps/worker/Dockerfile`](../../apps/worker/Dockerfile) | Worker on Node 24 + tsx, non-root, healthcheck | Never built |
| [`infra/compose/compose.yaml`](../compose/compose.yaml) | Local stack: PostgreSQL, SeaweedFS, Keycloak; profile `app` (web, api, worker, migration job); profile `canton` (dpm sandbox + bootstrap) | Never run; YAML parsed and references checked |
| [`infra/compose/canton/Dockerfile`](../compose/canton/Dockerfile) | Canton 3.5.19 `dpm sandbox` (SDK 3.5.12) in a JDK 21 container, for local use only | Never built |

All images are built from the repository root, for example `docker build -f apps/api/Dockerfile .`.

## 1. Runtime shape

```text
                 HTTPS (TLS at the edge)
Browser ───────────────────────────────▶ web (Next.js, stateless, 1..n)
   │                                        │  /api/* proxied over a private network
   │ presigned GET (60 s)                   ▼
   │                                      api (Fastify, persistent service, 1..n)
   ▼                                        │        │          │
private S3-compatible bucket ◀──────────────┘        │          │ JSON Ledger API v2 (JWT)
   ▲                                                 ▼          ▼
   └───────────── worker (exactly 1, persistent) ─▶ PostgreSQL 16   Canton participant
                                                  (managed)        (validator / node operator)
```

- **web**: any container host. Stateless. Reads `COLLARA_MODE`, `API_INTERNAL_ORIGIN` and `PUBLIC_DEMO_STATUS` per request, so one image serves every environment. Its `/api` proxy waits up to 60 s for the API.
- **api**: a persistent Node service, not a serverless function: ledger submit-and-wait can take up to `CANTON_SUBMIT_TIMEOUT_MS` (60 s default), uploads stream up to 20 MB, and it holds connection pools. Several replicas should be possible (sessions and command records are in PostgreSQL), but only one instance has ever been run.
- **worker**: one always-on process (no scale-to-zero, no request-driven CPU). Run **exactly one**: export jobs use leases, but concurrent projection loops for the same source have not been tested.
- **Migrations** are a release job (`node --import tsx scripts/db.ts migrate` in the API image), never on boot.

## 2. Requirements

| Need | Requirement | Current code |
|---|---|---|
| PostgreSQL | Managed PostgreSQL 16, TLS, a dedicated role; point-in-time recovery | `DATABASE_URL`; Drizzle migrations in `packages/db/migrations` |
| Object storage | Private S3-compatible bucket: no public policy, no anonymous access, versioning, server-side encryption; a least-privilege key for the API and the worker; a public endpoint host for presigned URLs (`COLLARA_S3_PUBLIC_ENDPOINT`) | Path-style S3 client; only tested against SeaweedFS 4.48 with its admin key pair |
| Canton | A participant node (or a validator from a node operator) exposing the **JSON Ledger API v2**, with persistent storage, the Collara DARs and DM `governance-core-v1` uploaded and vetted, parties and least-privilege users allocated, and **JWT auth against a JWKS** (`jwt-jwks`) | **Gap:** the API and worker only mint HS256 tokens for the sandbox's `unsafe-jwt-hmac-256` (`packages/canton/src/auth.ts`). A JWKS / OAuth client-credentials token provider must be built first. `scripts/localnet/bootstrap.mjs` also assumes the sandbox admin token. |
| Ledger topology | Decide which organizations' parties live on which participant, who operates each node, and how governance seats map to operators | Only a single-operator local sandbox exists ([`docs/governance.md`](../../docs/governance.md)) |
| Identity | An OIDC provider over HTTPS (Authorization Code + PKCE), a confidential client with the redirect URI `https://<web host>/api/auth/callback`, `COLLARA_OIDC_*` set | Tested only against a local Keycloak; the code exchange through the API against Keycloak was not exercised (`docs/PROGRESS.md`) |
| Secrets | `SESSION_SECRET` (32+ random characters), `COLLARA_OIDC_CLIENT_SECRET`, S3 keys, database password, ledger client credentials, from a secret manager; never in images, repositories or logs | Read from the environment; logs redact secrets and financing-term fields |
| TLS and cookies | HTTPS at the edge; `PUBLIC_ORIGIN=https://…`; `COOKIE_SECURE=true` (cookie `__Host-collara_sid`, HSTS on); `TRUST_PROXY` set to the edge proxy addresses so the API sees `https` | Secure-cookie mode behind HTTPS was not exercised |
| Demo switches | `DEMO_SESSIONS_ENABLED=false` (the API does not refuse it in production mode); `PUBLIC_DEMO_STATUS` per approved copy | |
| Backups | PostgreSQL PITR (application records, sessions, command records, mandates and bindings exist only there; projections can be rebuilt from the ledger); bucket versioning; participant database backups per the node operator's procedure; a tested restore | None designed or tested |
| Observability | Collect JSON logs from stdout; alert on the **body** of `GET /api/system/health` (`degraded` / `unavailable`) and of the worker's `GET /healthz` (checkpoint lag, `RESET_DETECTED`), since both always answer 200 | Endpoints exist; no alerting |
| Network | Only the web host (and the storage endpoint used for presigned downloads) reachable from the internet; API, worker, database and participant on a private network | |

## 3. Hosting options (for the owner to choose)

None of these has been tried. The decision belongs to the project owner.

1. **Single VM with Docker Compose** (closest to what exists). One Linux VM (the local sandbox alone used about 1.1 GB of RAM; plan for at least 8 GB in total) running the Compose `app` and `canton` profiles behind a TLS reverse proxy. Simple and cheap, suited to a private, time-boxed demo. Not highly available; the sandbox ledger is in memory and resets on restart; one operator holds everything.
2. **Managed containers + managed data services.** web, api and worker as container services on a platform that supports always-on processes; managed PostgreSQL 16; managed S3-compatible storage; a Canton participant run on a separate VM or provided by a node operator. Needs the JWKS ledger auth work first and a real participant with persistent storage.
3. **A Canton Network environment (DevNet, then TestNet/MainNet) through a validator.** Needs a validator (own or a node operator's), onboarding by that network, and the auth and topology work above. Requirements and costs must be confirmed with the network and validator operator; they were not researched for this document.

## 4. Local container stack (untested)

The Compose header in [`infra/compose/compose.yaml`](../compose/compose.yaml) has the commands. In short: `node scripts/dev/init-env.mjs`, add `CANTON_JWT_HMAC_SECRET` to `.env` for LOCALNET, then start the profiles. Canton options for container hosts:

- **(a) `dpm sandbox` in a JDK 21 container** (profile `canton`): the same Canton 3.5.19 sandbox and HMAC auth as the Windows scripts. It needs `http-ledger-api.address = "0.0.0.0"` (`infra/compose/canton/container.conf`) because the sandbox binds `127.0.0.1` by default; `bootstrap.mjs --json-api-url http://canton:7575` records the in-network URL in the shared `state.json`. Untested.
- **(b) Splice LocalNet through `digital-asset/cn-quickstart`**: the Docker-based Canton Network quickstart (validators, super-validator, wallet apps; Splice 0.8.4 bundles Canton 3.5.19). Closer to a real network, but heavy (synthesis §4.3 estimates about 12 GB of container memory limits), and Collara's bootstrap, auth and binding scripts would need adapting to its users and JWKS-based auth. Not attempted.

## 5. Before anything is published

- [ ] Owner's explicit authorization to publish, and a chosen hosting target (§3).
- [ ] **BPD-1** resolved: privacy notice, terms, pilot consent text, retention period, notification inbox. Until then `/privacy` and `/terms` cannot be published and the pilot form must not collect real personal data.
- [ ] Copy marked INFERRED approved (`packages/domain/src/copy.ts` and web screens).
- [ ] JWKS / client-credentials ledger auth implemented and tested; no HMAC secret outside a laptop.
- [ ] `DEMO_SESSIONS_ENABLED=false`; demo Keycloak realm (shared password `collara-demo-only`) never imported into a reachable identity provider.
- [ ] HTTPS, Secure cookies and `TRUST_PROXY` verified end to end.
- [ ] Images built and scanned, CI green on GitHub (`.github/workflows/ci.yml` has not run yet).
- [ ] Backups and a restore drill.
- [ ] Synthetic data only: no virus scanning exists, so real documents must not be accepted.
- [ ] Read [`docs/limitations.md`](../../docs/limitations.md) and make sure every public statement matches it.
