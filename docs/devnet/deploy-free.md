# Deploying the DevNet demo for $0: Supabase Free + Vercel Hobby (runbook)

Status, 2026-10-05: **code written and unit-tested locally, never deployed.** No Supabase project or Vercel environment was created. Nothing ran against DevNet or Supabase. Synthetic data only. This is not a production deployment and comes with no security assurance. Any step that creates an account, publishes a URL or touches the DevNet ledger needs the project owner's go-ahead.

The Render path ([deploy-render.md](deploy-render.md), `render.yaml`) and LOCALNET are unchanged. This option is an alternative for when the budget is $0.

## What changes compared to Render

| | Render (≈ $21/month) | $0: Supabase Free + Vercel Hobby |
|---|---|---|
| API | Separate Fastify service. Next proxies `/api` to it (`API_INTERNAL_ORIGIN`) | The same Fastify app is **embedded** in the Next `/api/[...path]` Route Handler (`API_MODE=embedded`). It is built once per cold start and requests are dispatched in-process (`apps/api/src/embedded.ts`) |
| Worker | One persistent process that follows `/v2/updates` continuously | **No persistent worker.** `WORKER_MODE=on-request` runs a bounded pass before workspace reads and after mutations (`apps/worker/src/on-request.ts`). A daily Vercel cron adds a safety-net pass |
| PostgreSQL | Render PostgreSQL | Supabase Postgres through the **transaction pooler** (Supavisor, port 6543) |
| Evidence upload | Through the API (20 MB) | **Presigned PUT** straight to Supabase Storage (`STORAGE_UPLOAD_MODE=presigned`), because Vercel caps request bodies at 4.5 MB. Finalize still hashes and validates on the server |
| DevNet state | Secret File on disk | Env var `DEVNET_STATE_JSON` (Vercel has no persistent disk) |

### Consequences of having no persistent worker (read before choosing this option)

The review asked for a persistent worker. This option does **not** provide one:

- The ledger projection, command-state advancement (`COMMITTED → PROJECTED`), UNKNOWN_OUTCOME reconciliation and export jobs **advance only while someone uses the app**, plus once a day from the cron. After a quiet period the first page view catches up, within the time budget (`ON_REQUEST_SYNC_BUDGET_MS`, default 8 s). A long backlog can take several requests to clear. Health reports this with `partial` passes and the checkpoint age.
- **An export may finish on the next request**, not right away. The export pass runs after a mutation (`after()`), within the function's lifetime. If the budget runs out first, the job stays `QUEUED` until the next request picks it up.
- Health (`/api/system/health`) describes the worker check as `On-request sync (no persistent worker; …)` followed by the checkpoint age. A stale checkpoint means nobody has used the app recently. On this option that is expected and does not indicate a fault.
- Every workspace read waits for the sync unless a pass ran in the last `ON_REQUEST_SYNC_MIN_INTERVAL_MS` (default 3 s, checked against `ledger_sources.last_polled_at`, so the check works across instances). That adds latency, up to the budget.
- Single-flight: inside one instance, concurrent requests share the running pass. Across instances, `pg_try_advisory_xact_lock` is taken inside the projection's transaction. The lock is **transaction-scoped**, so it works through a transaction-mode pooler, where session-level locks do not. An instance that cannot get the lock skips its pass. The projection runs inside that transaction, so per-update transactions become savepoints, and work done before the budget ran out is committed. The transaction holds one pooled connection for up to the budget.
- Vercel Hobby crons run **at most once per day**, at a time within the scheduled hour that is not guaranteed (verified on vercel.com/docs/cron-jobs/usage-and-pricing, 2026-10-05). The cron does not replace a worker.

## Verified limits and open points

Checked 2026-10-05 on the providers' own pages, except where marked:

- Vercel Hobby: function `maxDuration` up to 300 s (the route sets 60 s); request body limit 4.5 MB; crons once per day with ±59 min precision (vercel.com/docs/cron-jobs/usage-and-pricing). The 300 s and 4.5 MB figures come from the brief's third-party summary and were not re-checked here.
- Supabase Free: 500 MB database, 1 GB storage, and **projects pause after 7 days without activity**. These come from a third-party summary and were not re-checked; verify on supabase.com/pricing. A paused project breaks the demo until the owner restores it in the dashboard.
- Supabase Storage S3: endpoint `https://<project_ref>.storage.supabase.co/storage/v1/s3`, region = the project's region, `forcePathStyle: true` (the app always uses path style). S3 access keys **bypass RLS and give full access to every bucket**, so they are server-side only. Presigned URLs need the S3 protocol enabled in Storage settings (supabase.com/docs/guides/storage/s3/authentication and …/s3/compatibility).
- **CORS: `PutBucketCors` is not supported by Supabase Storage** (compatibility page). The bucket CORS policy cannot be restricted to the Vercel domain. Supabase's own CORS behaviour on presigned S3 PUTs from a browser is **untested**. If the browser PUT is blocked, the dialog shows `Storage refused the upload. Try again.` / network error; fall back to `STORAGE_UPLOAD_MODE=proxied` (files ≤ 4.5 MB) and report it. What protects the upload is the presigned URL itself: it is issued only after the server-side permission check, is signed for one key under `quarantine/` with the exact content type, and expires after at most 10 minutes (capped by the intent's 15-minute expiry). Nothing is recorded until finalize validates the bytes.
- **Database name.** DEVNET refuses any database whose name lacks `devnet` (a guard in `@collara/canton`). Supabase's default database is `postgres`, so create `collara_devnet` (step 1.3). Whether Supavisor's transaction pooler routes to a non-default database was **not verified**. If it does not, stop and report; do not weaken the guard. A separate database also keeps the Collara tables out of Supabase's Data API (PostgREST serves the `postgres` database).

### Pooler compatibility (checked in code)

Transaction mode (PgBouncer/Supavisor, port 6543) supports no session state:

- No `LISTEN/NOTIFY` and no session-level advisory locks in the code. Case creation already uses `pg_advisory_xact_lock` (transaction-scoped, fine), and so does the on-request sync.
- `SELECT … FOR UPDATE [SKIP LOCKED]` only appears inside transactions or single statements, which is fine.
- No named prepared statements: Drizzle's node-postgres driver sends unnamed statements unless `.prepare(name)` is used, and no code does.
- No `SET`/`set_config` session settings.
- `@fastify/session` keeps sessions in PostgreSQL tables (`session-store.ts`), not in connection state.
- Pool size: `DATABASE_POOL_MAX` (embedded default 2). Migrations, `login.mjs` and the DevNet scripts run from your machine against the **session pooler or direct connection**, never the transaction pooler.

Connection strings (Supabase → Project Settings → Database → Connect):

- Runtime (Vercel): `postgres://postgres.<project_ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/collara_devnet?sslmode=require` (transaction pooler)
- Owner's machine: `postgres://postgres.<project_ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/collara_devnet?sslmode=require` (session pooler, IPv4). The direct host `db.<project_ref>.supabase.co:5432` is IPv6-only on Free, per Supabase's connect dialog (not re-checked).

## Ordered runbook

### 1. Supabase project and database

1. Create a Supabase project (Free). Use a region near Vercel's default `iad1` (US East). Store the database password in your password manager only.
2. Project Settings → Data API: if you will not use it, disable it. Collara never uses it.
3. SQL editor: `create database collara_devnet;` (synthetic demo only).
4. In your local, git-ignored `.env.devnet`: `DATABASE_URL=<session pooler URL for collara_devnet>`.
5. `node scripts/devnet/db-setup.mjs` applies the migrations and seeds the synthetic identities. Untested against Supabase: it checks for the database through the `postgres` maintenance database. If that is refused, report the error.

### 2. Storage bucket, S3 keys, CORS

1. Storage → **New bucket** `collara-devnet-evidence`, **Private** (public off). Leave the file size limit at or above 20 MB.
2. Storage → Settings → **S3 connection**: enable it. Note the endpoint and the region. Create an **S3 access key** (Access Key ID + Secret Access Key, shown once). These keys bypass RLS: put them only in Vercel encrypted env vars (step 4), never in `NEXT_PUBLIC_*`, Git or a chat.
3. CORS: Supabase Storage does not support a bucket CORS policy (see above), so it cannot be limited to the Vercel domain. Test the browser upload in the preview (step 6) and record whether it worked.

### 3. Ledger credential, bindings and state (your machine)

Run these with the same `.env.devnet` (session pooler URL), as in deploy-render.md §4–5:

```
node scripts/devnet/login.mjs          # your own terminal; password never stored anywhere
node scripts/devnet/preflight.mjs
node scripts/devnet/import-bindings.mjs
node scripts/devnet/bootstrap.mjs
node scripts/devnet/verify-first-tx.mjs
```

Copy the ledger user id printed by `login.mjs`. Copy the **content** of `.local/devnet/state.json` (party ids, participant and package ids; no secrets) into the `DEVNET_STATE_JSON` value in step 4. Repeat that copy whenever `import-bindings` or `bootstrap` rewrites the file.

### 4. Vercel **Preview** environment variables

Vercel project → Settings → Environment Variables, scope **Preview** only. Mark every secret **Sensitive** (encrypted, not readable after saving). None may start with `NEXT_PUBLIC_`.

| Variable | Value |
|---|---|
| `COLLARA_MODE` | `DEVNET` |
| `API_MODE` | `embedded` |
| `WORKER_MODE` | `on-request` |
| `STORAGE_UPLOAD_MODE` | `presigned` |
| `NODE_ENV` | (Vercel sets `production`) |
| `DATABASE_URL` | **secret**: transaction-pooler URL for `collara_devnet` (port 6543, `sslmode=require`) |
| `DATABASE_POOL_MAX` | `2` |
| `SESSION_SECRET` | **secret**: 32+ random characters |
| `DEVNET_CREDENTIAL_KEY_ID`, `DEVNET_CREDENTIAL_KEY` | **secret**: the same key as your local `.env.devnet` (it decrypts the stored refresh token) |
| `DEVNET_LEDGER_USER_ID` | from `login.mjs` |
| `CANTON_DEVNET_JSON_API_URL`, `DEVNET_OIDC_ISSUER`, `DEVNET_OIDC_CLIENT_ID`, `DEVNET_OIDC_SCOPE`, `DEVNET_LEDGER_AUDIENCE` | the public values from `infra/env/devnet.env.example` |
| `DEVNET_STATE_JSON` | content of `.local/devnet/state.json` (step 3) |
| `COLLARA_S3_ENDPOINT` | `https://<project_ref>.storage.supabase.co/storage/v1/s3` |
| `COLLARA_S3_REGION` | the project's region, e.g. `us-east-1` |
| `COLLARA_S3_BUCKET` | `collara-devnet-evidence` |
| `COLLARA_S3_ACCESS_KEY`, `COLLARA_S3_SECRET_KEY` | **secret**: from step 2.2 |
| `PUBLIC_ORIGIN` | the preview's exact `https://` origin (stable branch alias recommended) |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `loopback`. The adapter injects requests from 127.0.0.1 with `X-Forwarded-Proto/Host` set from the incoming request and Vercel's `X-Forwarded-For`. Trusting loopback makes `request.protocol` https, so `__Host-` Secure cookies are saved. Not verified on Vercel |
| `DEMO_SESSIONS_ENABLED`, `DEMO_SESSIONS_ALLOW_IN_PRODUCTION` | `true` / `true` for the synthetic walkthrough personas (or both `false`) |
| `PUBLIC_DEMO_STATUS` | `off` |
| `CRON_SECRET` | **secret**, 16+ characters (only if you add the cron) |
| `ON_REQUEST_SYNC_BUDGET_MS`, `ON_REQUEST_SYNC_MIN_INTERVAL_MS` | optional, defaults 8000 / 3000 |

Optional daily cron: copy `infra/deploy/vercel-free.json` to `apps/web/vercel.json` (assuming the Vercel project's root directory is `apps/web`). Vercel then calls `GET /api/cron/sync` once a day with `Authorization: Bearer $CRON_SECRET`. Note that `vercel.json` applies to **every** environment of the project. In the current UI-mockup production the route answers 404 (it needs `API_MODE=embedded`, `WORKER_MODE=on-request` and `CRON_SECRET`), so it is harmless there.

Migrations are never run by Vercel. They run from your machine (step 1.5) before a deploy that needs them.

### 5. Deploy the preview

Deploy a preview from the branch. Check `https://<preview>/api/system/health` and read the body (it answers 200 even when degraded):

- database `ok`
- storage `ok`
- ledger `ok` (DevNet topology)
- worker: `On-request sync (no persistent worker; …) Checkpoint age …`

The first workspace page view runs the first projection pass. With a long history it may take several requests.

### 6. Walkthrough on the preview

Run the CL-001 walkthrough of [`docs/demo.md`](../demo.md) as in deploy-render.md §7. The pass criteria are the same: `Confirmed on the ledger.` with an update id, no simulated fallback, Lender B sees the case as unavailable, the session cookie is `__Host-collara_sid` with `Secure`, and the auditor export downloads. An export that stays `QUEUED` should be READY after the next request; record how long it took. In addition, upload an evidence file **larger than 4.5 MB** (synthetic PDF) to prove the presigned path and the CORS behaviour. Record the results in [`docs/devnet-evidence.md`](../devnet-evidence.md).

### 7. Production last

Only after the walkthrough passes, and with the owner's go-ahead: copy the Preview variables to Production, set `PUBLIC_ORIGIN` to the production origin, then redeploy production. Update the `/docs` deployment lines (`packages/domain/src/evidence.ts`) in the same change.

## Rollback

- **Front end + API (seconds):** restore Production's previous variables (`COLLARA_MODE=UI_MOCK`, `PUBLIC_DEMO_STATUS=ui_mock`, remove `API_MODE`), or promote the previous production deployment. The site is the UI mockup again; nothing then reads Supabase.
- **Switch to Render later:** set `API_INTERNAL_ORIGIN` and remove `API_MODE`; the HTTP proxy path is unchanged.
- **Database:** Supabase Free has no point-in-time recovery (verify the backups included on supabase.com/pricing). The ledger is the source of truth for workflow state, and the projection can be reset and rebuilt (`docs/devnet/recovery.md`). If sessions or the stored token are lost, run `login.mjs` again.
- **Credential compromise:** rotate `DEVNET_CREDENTIAL_KEY` (recovery.md §5), revoke the Supabase S3 key and create a new one, rotate `SESSION_SECRET`, and reset the database password.
- **Paused project** (7 days idle): restore it in the Supabase dashboard; the on-request sync catches up on the next requests.

## What was tested, and what was not

Tested locally on 2026-10-05:

- Unit tests:
  - the embedded adapter (status, JSON body, Set-Cookie round trip, problem+json, bearer stripped, HEAD, CSRF still enforced, no Swagger UI)
  - the presigned intent and finalize (URL lifetime, replay, early finalize = 409, type mismatch rejected and object deleted, unrelated organisation gets 404 without a URL)
  - the on-request sync (projection to the ledger end, skip while fresh, in-process single-flight, lock held elsewhere = skip, `pg_try_advisory_xact_lock` on PGlite, time budget commits partial progress)
  - state from an env var
- A local `next build` with `COLLARA_MODE=DEVNET API_MODE=embedded` succeeded. A local `next start` of that build in LOCALNET-embedded mode against the dev PostgreSQL served a demo session (Set-Cookie) and `/api/me` 200. Other reads failed only because the local dev database was behind the current migrations. With no sandbox running, the sync pass failed gracefully and the request still completed.

Not tested: anything on Vercel or Supabase (Supavisor with a non-default database, `TRUST_PROXY=loopback` behind Vercel, Secure cookies, function cold-start time, `after()` on Vercel, the cron), Supabase Storage presigned PUT and its CORS, the 4.5 MB limit, and the whole DevNet path.
