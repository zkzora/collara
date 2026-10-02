# @collara/api

Fastify 5 API behind the web app's same-origin `/api` proxy. Synthetic demo data only; nothing here is a
production security assurance.

## Run

```sh
node scripts/dev/wsl-postgres.mjs up                 # Windows: PostgreSQL 16 in WSL on 127.0.0.1:5432
pnpm --filter @collara/api db:migrate                # committed SQL from packages/db/migrations
pnpm --filter @collara/api db:seed                   # demo orgs, users, memberships, mandates
pnpm --filter @collara/api db:bind-localnet          # party bindings from .local/localnet/state.json (after each bootstrap)
pnpm --filter @collara/api dev                       # http://127.0.0.1:4000, docs at /api/docs
pnpm --filter @collara/api openapi:export            # writes apps/api/openapi.json
```

The `db:*` scripts take `--database-url postgres://…` to target another database (e.g. `collara_test`).
Without `DATABASE_URL` the API serves only health and docs (UI_MOCK); `COLLARA_MODE=LOCALNET` refuses to
start without it. Migrations never run on boot.

## Environment (in addition to the foundation's NODE_ENV, COLLARA_MODE, HOST, PORT, LOG_LEVEL, TRUST_PROXY)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Required in LOCALNET. |
| `SESSION_SECRET` | ephemeral in dev/test | ≥ 32 chars; required in production. |
| `SESSION_TTL_SECONDS` | 28800 | Absolute session lifetime. |
| `COOKIE_SECURE` | false | true → cookie `__Host-collara_sid` (needs HTTPS and `TRUST_PROXY` so the protocol is seen as https); false → `collara_sid`. |
| `PUBLIC_ORIGIN` | http://localhost:3000 | Browser origin (Next). CSRF origin check, OIDC redirect base, post-logout target. |
| `CSRF_TRUSTED_ORIGINS` | — | Extra comma-separated origins allowed to send mutations. |
| `DEMO_SESSIONS_ENABLED` | false | Enables `/api/demo/*` (404 otherwise). |
| `COLLARA_OIDC_ISSUER`, `COLLARA_OIDC_CLIENT_SECRET` | — | Both needed for OIDC login. |
| `COLLARA_OIDC_CLIENT_ID` | collara-web | Matches `infra/keycloak/collara-realm.json`. |
| `COLLARA_OIDC_REDIRECT_URI` | `PUBLIC_ORIGIN/api/auth/callback` | |
| `COLLARA_OIDC_SCOPES` | openid email profile | |
| `COLLARA_OIDC_ALLOW_INSECURE_HTTP` | false | http issuer; honoured only with `NODE_ENV=development`. |
| `COLLARA_S3_ENDPOINT`, `COLLARA_S3_ACCESS_KEY`, `COLLARA_S3_SECRET_KEY` | — | Same names as `scripts/infra/seaweedfs.mjs`. Without them evidence routes answer 503. |
| `COLLARA_S3_BUCKET` / `COLLARA_S3_REGION` | collara-evidence / us-east-1 | |
| `COLLARA_S3_PUBLIC_ENDPOINT` | — | Host used in presigned URLs if browsers reach storage elsewhere. |
| `COLLARA_LOCALNET_STATE` | `<repo>/.local/localnet/state.json` | Topology and participants for health. |
| `WORKER_STALE_AFTER_SECONDS` | 120 | Health: older checkpoint → degraded. |
| `PILOT_RATE_LIMIT_MAX` / `PILOT_RATE_LIMIT_WINDOW_MS` | 5 / 600000 | Per client IP. |

## Security behaviour

- **Sessions**: server-side in `sessions` (row key = SHA-256 of the session id), HttpOnly, SameSite=Lax,
  rotated on every login and persona switch, deleted on logout. Tokens never reach the browser.
- **CSRF**: unsafe methods need `Sec-Fetch-Site: same-origin|none`; without Fetch Metadata an `Origin`
  header must be `PUBLIC_ORIGIN`, a trusted origin or the request host; requests with neither header are
  not from a browser page. Combined with SameSite=Lax. See `src/plugins/security.ts`.
- **Authority**: session → user → active membership/org → roles + mandates → party bindings
  (`src/plugins/actor.ts`). Browser-supplied org, party or role values are never read.
- **Errors**: `application/problem+json` from `@collara/domain` `problemFor`; unrelated resources are
  404 `This record is unavailable to your account.`; no stack traces; `instance` carries the request id
  (also in the `x-request-id` header).
- **Logs**: authorization, cookies, set-cookie, tokens, OIDC codes/state in URLs and financing-term
  fields are redacted.
- **Evidence**: PDF/JPEG/PNG by magic bytes, 20 MB cap while streaming, quarantine → server SHA-256 →
  evidence, `scanStatus` always `NOT_SCANNED` (no virus scanning in this synthetic-only MVP), 60 s
  presigned downloads after an access check (owner or contributing organization for now).
