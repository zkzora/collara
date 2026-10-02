# syntax=docker/dockerfile:1
# Collara worker: projection of Canton ledger updates, command reconciliation and export jobs, on Node 24
# with TypeScript run by tsx (ADR-0001 §2.1, §2.7). A long-running process; never run it inside a request
# lifecycle or a serverless function.
#
# UNTESTED. Written on a machine without Docker: this image has never been built or run. Treat it as a
# starting point, not a verified artifact, and not as a production-ready image.
#
# Build from the repository root (the context must contain the pnpm workspace):
#   docker build -f apps/worker/Dockerfile -t collara-worker:local .
# The Dockerfile-specific ignore file apps/worker/Dockerfile.dockerignore (BuildKit) keeps the context small.
#
# Configuration is environment only (apps/worker/src/config.ts, .env.example). LOCALNET needs DATABASE_URL,
# the ledger bootstrap state (COLLARA_LOCALNET_STATE, mounted read-only), CANTON_JWT_HMAC_SECRET and, for
# exports, COLLARA_S3_*.

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim

ARG PNPM_VERSION=11.28.2
RUN npm install --global "pnpm@${PNPM_VERSION}" && npm cache clean --force

WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/canton/package.json packages/canton/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN --mount=type=cache,id=collara-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter "@collara/worker..." --store-dir /pnpm-store

COPY packages/domain packages/domain
COPY packages/db packages/db
COPY packages/canton packages/canton
COPY apps/worker apps/worker

# The health server must listen on all interfaces inside the container.
ENV NODE_ENV=production \
    WORKER_HEALTH_HOST=0.0.0.0 \
    WORKER_HEALTH_PORT=4100

WORKDIR /repo/apps/worker
USER node
EXPOSE 4100

# Liveness only: /healthz answers 200 and reports "ok" or "degraded" (with checkpoint and lag) in the body.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "--import", "tsx", "src/main.ts"]
