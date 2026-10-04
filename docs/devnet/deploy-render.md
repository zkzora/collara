# Deploying the DevNet demo backend on Render + Cloudflare R2 (runbook)

Status, 2026-10-05: **written, never run.** Nothing has been provisioned. The images were never built (no Docker on the authoring machine); `render.yaml` was parsed as YAML and its keys checked against Render's Blueprint spec page, but it was never applied. Synthetic data only. Not a production deployment and no security assurance. Every step that creates an account, spends money or publishes a URL needs the project owner's go-ahead.

## Recommendation and cost

**One recommendation:** Render (API web service + one background worker + Render PostgreSQL 16) in **Oregon**, with evidence and export files in a private **Cloudflare R2** bucket. The front end stays on Vercel.

**Estimated cost: Render Starter web service $7 + Starter background worker $7 + PostgreSQL Basic-256mb ≈ $7 + R2 ≈ $0 (10 GB free tier, free egress) ≈ $21/month.** These prices come from third-party summaries (see [hosting.md](hosting.md)), not from the providers. Verify on <https://render.com/pricing> and <https://developers.cloudflare.com/r2/pricing/> before ordering.

Why Oregon: Vercel functions run in `iad1` (US East) by default, so a US region keeps the Vercel → API hop short; Oregon is Render's default. The NODERS participant's location is not documented and did not drive the choice. If the team works from Asia, set all three `region` values in `render.yaml` to `singapore` together (the database must be in the services' region).

What `render.yaml` sets up: `collara-api` (Docker, `apps/api/Dockerfile`, health check `/api/system/health`, pre-deploy `node --import tsx scripts/db.ts migrate`), `collara-worker` (Docker, `apps/worker/Dockerfile`, exactly one instance), `collara-devnet-db` (PostgreSQL 16, database `collara_devnet` — DEVNET refuses any name without `devnet`). Auto-deploy is off. Secrets are `sync: false` (Render prompts for them; they are never in Git).

## Ordered runbook

### 1. Cloudflare R2: private bucket and scoped token

1. Cloudflare dashboard → R2 → **Create bucket** `collara-devnet-evidence`, location hint matching the Render region (e.g. Western North America). Leave **Public access disabled** (no r2.dev URL, no custom domain).
2. No CORS policy: uploads go through the API and downloads use short-lived presigned URLs, so the browser never calls R2 cross-origin with credentials. (If presigned downloads are blocked by a browser later, revisit; do not open the bucket.)
3. R2 → **Manage API tokens** → **Create API token**: permission **Object Read & Write**, **Apply to specific buckets only** → `collara-devnet-evidence`, no TTL beyond the demo period if you can set one. Copy the **Access Key ID**, **Secret Access Key** and the **S3 endpoint** `https://<account id>.r2.cloudflarestorage.com`. They are shown once.
4. The app already uses path-style addressing (`forcePathStyle: true` in `apps/api/src/services/storage.ts` and `apps/worker/src/jobs/handlers/export.ts`) and region `auto` (set in `render.yaml`), which R2 accepts.

### 2. Render Blueprint

1. Before applying, edit `render.yaml`: `ipAllowList` of the database → your public IP as `x.x.x.x/32` (an empty list blocks all external connections, which you need in step 4). Commit only if you are happy for that IP to be in Git; otherwise set it in the dashboard after creation.
2. Render dashboard → **New → Blueprint** → connect the GitHub repository → branch `main` → Render reads `render.yaml`.
3. Render asks for every `sync: false` value. Fill them in step 3 (you can do it in this same screen).

### 3. Secrets (Render dashboard, both services where listed)

| Variable | API | Worker | Value |
|---|---|---|---|
| `SESSION_SECRET` | ✓ | | 32+ random characters (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) |
| `DEVNET_CREDENTIAL_KEY_ID`, `DEVNET_CREDENTIAL_KEY` | ✓ | ✓ | the two lines from `node scripts/devnet/gen-key.mjs` — the **same** key as your local `.env.devnet` |
| `DEVNET_LEDGER_USER_ID` | ✓ | ✓ | printed by `login.mjs` (step 4); set after it |
| `PUBLIC_ORIGIN` | ✓ | | the Vercel **preview** URL, `https://…vercel.app` (step 6) |
| `COLLARA_S3_ENDPOINT` | ✓ | ✓ | `https://<account id>.r2.cloudflarestorage.com` |
| `COLLARA_S3_ACCESS_KEY`, `COLLARA_S3_SECRET_KEY` | ✓ | ✓ | from step 1.3 |

Fixed in `render.yaml` (change there, not in the dashboard): `COLLARA_MODE=DEVNET`, `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=loopback,uniquelocal` (Render's proxy reaches the container from a private address; not verified), the public `DEVNET_*` / `CANTON_DEVNET_JSON_API_URL` values from `infra/env/devnet.env.example`, `COLLARA_S3_BUCKET=collara-devnet-evidence`, `COLLARA_S3_REGION=auto`, `COLLARA_DEVNET_STATE=/etc/secrets/devnet-state.json`, and `DEMO_SESSIONS_ENABLED=true` + `DEMO_SESSIONS_ALLOW_IN_PRODUCTION=true` (synthetic personas for the walkthrough; set both to `false` if you decide against them).

The first deploy may come up `degraded` (no bindings, no stored token yet). That is expected until step 5.

### 4. Log in once against the hosted database (your machine only)

1. Render → `collara-devnet-db` → **Connect** → copy the **External Database URL**. In your local `.env.devnet`, set `DATABASE_URL=<that URL>?sslmode=require` (the database name is `collara_devnet`). Keep the local file git-ignored; do not paste the URL anywhere else.
2. `node scripts/devnet/db-setup.mjs` — the database already exists, so it should report `exists`, apply migrations (already applied by the pre-deploy step; idempotent) and seed the synthetic identities. Untested against Render: it connects to the `postgres` maintenance database to check existence; if Render refuses that, report the error — do not work around it by granting rights.
3. `node scripts/devnet/login.mjs` in **your own terminal** (`winpty node …` in Git Bash). It asks for the team's NODERS login on the terminal. **Never put the password in a file, an environment variable, a chat or a Render setting.** Only the encrypted refresh token is stored, in `ledger_credentials` of the hosted database, encrypted with `DEVNET_CREDENTIAL_KEY` (which is not in the database).
4. Copy the printed ledger user id into `DEVNET_LEDGER_USER_ID` in `.env.devnet` **and** in both Render services.

### 5. Preflight, bindings, bootstrap (your machine, same `.env.devnet`)

```
node scripts/devnet/preflight.mjs
node scripts/devnet/import-bindings.mjs
node scripts/devnet/bootstrap.mjs
node scripts/devnet/verify-first-tx.mjs
```

Expected output for each is in [owner-checklist.md](owner-checklist.md). Then upload the state file the services need: Render → `collara-api` → **Environment → Secret Files** → add `devnet-state.json` with the content of your local `.local/devnet/state.json`; do the same for `collara-worker`. It contains party ids and package ids, not credentials. Re-upload it whenever `import-bindings` or `bootstrap` rewrites it. Then **Manual Deploy → Restart** both services.

Check: `https://collara-api.onrender.com/api/system/health` body (the URL Render shows) reports the ledger and database as available, and the worker's logs show the projection following `/v2/updates`. The endpoints always answer 200 — read the body.

### 6. Vercel preview environment (not production)

In the Vercel project → Settings → Environment Variables, scope **Preview** only (or a dedicated branch):

- `COLLARA_MODE=DEVNET`
- `API_INTERNAL_ORIGIN=https://collara-api.onrender.com` (the Render URL)
- `PUBLIC_DEMO_STATUS=off` — the public demo gate has no DevNet value (`apps/web/src/components/marketing/public-demo.ts`), so `/demo` stays unlinked; the workspace is reached through `/login`.

Deploy a preview, then set `PUBLIC_ORIGIN` on `collara-api` to that preview's exact `https://` origin and restart the API (CSRF origin check). A stable preview alias (branch URL) avoids changing it on every push.

### 7. Walkthrough

Run the CL-001 walkthrough of [`docs/demo.md`](../demo.md) on the preview with the DevNet banner `Synthetic demo data — Canton DevNet.` showing. Pass criteria: every action ends in `Confirmed on the ledger.` with an update id, nothing falls back to simulated success, Demo Lender B sees the case as unavailable, the auditor export downloads from R2 through a presigned link, and the session cookie is `__Host-collara_sid` with `Secure`. Record the result in [`docs/devnet-evidence.md`](../devnet-evidence.md).

### 8. Only then: production

After the walkthrough passes with no mock fallback, and only with the owner's go-ahead (and the INFERRED copy approved, [`docs/copy-approval.md`](../copy-approval.md)): copy the Preview variables to Production in Vercel, set `PUBLIC_ORIGIN` on the API to the production origin, restart the API, redeploy Vercel production. Update the `/docs` deployment lines (`packages/domain/src/evidence.ts`) in the same change.

## Rollback

- **Front end (seconds):** in Vercel, restore Production's previous variables (`COLLARA_MODE=UI_MOCK`, `PUBLIC_DEMO_STATUS=ui_mock`, remove `API_INTERNAL_ORIGIN`) and redeploy, or promote the previous production deployment. The public site is then the UI mockup again; nothing depends on Render.
- **Backend code:** Render → service → **Events / Deploys** → roll back to the previous deploy. Migrations are forward-only; a rollback across a migration needs the database restore below.
- **Database:** Render PostgreSQL backups/point-in-time recovery depend on the plan — check what Basic-256mb includes before relying on it. The ledger is the source of truth for workflow state; projections can be rebuilt by the worker. Lost sessions, application records or the stored token mean `login.mjs` again ([recovery.md](recovery.md)).
- **Credential compromise:** rotate `DEVNET_CREDENTIAL_KEY` ([recovery.md](recovery.md) §5), revoke the R2 token in Cloudflare and create a new one, rotate `SESSION_SECRET` (signs everyone out).
- **Tear down:** suspend or delete the two services and the database in Render, delete the R2 bucket and token. Billing stops per Render's and Cloudflare's terms.

## What is untested

The Docker images (never built), `render.yaml` on Render (never applied; plan names `0.5c-512mb` / `0.1c-256mb` taken from the Blueprint spec page as the Starter / Basic-256mb equivalents), `preDeployCommand` in the image's working directory, Secret Files at `/etc/secrets/`, `TRUST_PROXY=loopback,uniquelocal` behind Render's proxy, Secure cookies through the Vercel `/api` proxy, `db-setup.mjs` and `login.mjs` against a TLS-only hosted database (`sslmode=require`; node-postgres certificate verification against Render's certificate), R2 with the AWS SDK (path style, region `auto`, presigned GET), and the whole DevNet path (nothing has run on DevNet yet).
