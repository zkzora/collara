# Hosting for the DevNet demo — requirements and cost estimate

Status: proposal, nothing provisioned. The frontend stays on Vercel. The public site stays in UI mockup mode until the DevNet walkthrough passes end to end with no mock fallback.

## What has to run outside Vercel

| Component | Why it cannot run on Vercel | Size for the synthetic demo |
|---|---|---|
| **API** (Fastify, `apps/api`, runs on `tsx`) | Long-lived process holding DB pools, the ledger token provider and S3 clients; request bodies up to 20 MB; the Next `/api` proxy forwards to it (`API_INTERNAL_ORIGIN`) | 1 instance, 0.5 vCPU / 512 MB–1 GB, HTTPS |
| **Worker** (`apps/worker`) | Must run continuously: follows `/v2/updates` from a stored offset, advances command states, reconciles unknown outcomes, generates exports — never request-bound or on a laptop | Exactly **one** instance (multi-replica not tested), 0.5 vCPU / 512 MB, no public port (health only) |
| **PostgreSQL 16** | Sessions, application records, command/idempotency records, projections, note store, ledger credential store (rotated refresh token) | ~1 GB storage is plenty; daily backups; TLS |
| **Private S3-compatible storage** | Evidence documents and export files; presigned URLs issued only after a permission re-check | < 1 GB; private bucket; CORS not needed (uploads go through the API) |

Not hosted by us: the Canton participant (NODERS shared DevNet node, Canton 3.5.19) and the OIDC issuer (NODERS Keycloak).

Secrets (never in Git, never `NEXT_PUBLIC_*`): `DATABASE_URL`, `SESSION_SECRET`, `COLLARA_S3_*`, and the ledger refresh token (stored in the database by `scripts/devnet/login.mjs`, not in env). Vercel needs only `COLLARA_MODE`, `API_INTERNAL_ORIGIN` (the API's HTTPS URL) and `PUBLIC_DEMO_STATUS`.

Network notes: the API must be reachable from Vercel's servers (public HTTPS); session cookies are set by the API through the same-origin `/api` proxy, so `COOKIE_SECURE=true` and `TRUST_PROXY` must be set for the proxy hop.

## Cost estimate (USD per month, synthetic demo load)

Prices are from third-party pricing summaries checked in late September 2026, not from the providers' own price lists — verify on the provider's pricing page before ordering. Usage-based items assume an always-on API and worker with idle traffic.

| Option | API | Worker | PostgreSQL | Storage | Estimated total |
|---|---|---|---|---|---|
| **A. Render + Cloudflare R2** | Starter web service ≈ $7 | Starter background worker ≈ $7 | Basic-256MB ≈ $7 (Basic-1GB ≈ $20) | R2: 10 GB free tier, egress free ≈ $0 | **≈ $21–34** |
| **B. Fly.io + Neon + R2** | shared-cpu-1x 512 MB ≈ $3.3–3.7 | same ≈ $3.3–3.7 | Neon Launch, pay-as-you-go (≈ $15 for a small always-on app; Free plan possible for a demo with cold starts) | R2 ≈ $0 | **≈ $7–23** |
| **C. Railway** (all-in-one) | usage-based | usage-based | Railway Postgres, usage-based | Railway volume or R2 | **≈ $5–20** (Hobby $5 includes $5 usage) |
| **D. $0: Supabase Free + Vercel Hobby** | embedded in the Vercel `/api` function | **none** (on-request sync + daily cron) | Supabase Free (500 MB, pauses after 7 idle days) | Supabase Storage (1 GB, private bucket) | **$0** |

Our recommendation for the hackathon demo: **Option A** — fewest moving parts (managed API + worker + Postgres on one platform, R2 for private objects), predictable fixed price; or Option B if cost matters most. Either needs the owner's account and payment method — nothing will be ordered without that.

Sources: Render — https://frontdeskreview.com/software/managed-postgres/render/ , https://bex.co/blog/2026/09/04/render-price-changes-cost-sheet ; Cloudflare R2 — https://mecanik.dev/en/posts/cloudflare-r2-pricing-explained-real-costs-vs-s3-and-backblaze/ ; Neon — https://www.prisma.io/blog/prisma-postgres-vs-neon-pricing-2026 ; Fly.io — https://fly.io/docs/about/pricing/ ; Railway — https://www.budgetforge.dev/tools/railway-pricing-2026 .

## Rollout order (after the owner's go-ahead)

1. Provision Postgres + bucket; run migrations; store secrets in the platform's secret manager.
2. Deploy API and one worker with `COLLARA_MODE=DEVNET`; run `scripts/devnet/login.mjs` once against that database; `preflight`, `import-bindings`, `bootstrap`.
3. Point a **separate Vercel preview/environment** at the API (`API_INTERNAL_ORIGIN`, `COLLARA_MODE=DEVNET`) and run the full walkthrough there.
4. Only after it passes with no mock fallback: switch production (or the demo link) to that environment. Rollback = restore the UI mockup environment variables and redeploy.

Runbook for Option A (Render + R2): [deploy-render.md](deploy-render.md), with the Blueprint in [`render.yaml`](../../render.yaml).

## Option D ($0) vs Option A (Render, ≈ $21): trade-offs

Runbook: [deploy-free.md](deploy-free.md). Both options are wired in code; neither has been deployed.

| | A. Render + R2 | D. Supabase Free + Vercel Hobby |
|---|---|---|
| Worker | Persistent: the projection follows the ledger continuously, exports start within seconds | **Not persistent**: projection, reconciliation and exports advance only while someone uses the app (bounded pass before reads and after mutations) plus one cron run per day. Exports may finish on the next request. This does not meet the review's request for a persistent worker |
| Latency | One extra hop Vercel → Render | No hop, but workspace reads can wait up to the sync budget (default 8 s) after an idle period; function cold starts build the Fastify app |
| Uploads | Through the API, 20 MB | Presigned PUT straight to storage (Vercel body limit 4.5 MB). Supabase cannot restrict bucket CORS to the Vercel domain |
| Database | Render PostgreSQL, direct connections | Supabase through the transaction pooler (no session features; checked in code). The project pauses after 7 idle days |
| Ops | Two services + DB on one platform | One Vercel project + one Supabase project; migrations and DevNet scripts from the owner's machine |
| Cost | ≈ $21/month | $0 within Free/Hobby limits |

Recommendation unchanged for a judged demo where the projection must keep up unattended: **Option A**. Option D is for when the budget is $0, and the demo copy must not claim a continuously running worker.
