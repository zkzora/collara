# syntax=docker/dockerfile:1
# Collara API: Fastify 5 on Node 24, TypeScript run by tsx (ADR-0001 §2.1; no compiled build yet).
#
# UNTESTED. Written on a machine without Docker: this image has never been built or run. Treat it as a
# starting point, not a verified artifact, and not as a production-ready image.
#
# Build from the repository root (the context must contain the pnpm workspace):
#   docker build -f apps/api/Dockerfile -t collara-api:local .
# The Dockerfile-specific ignore file apps/api/Dockerfile.dockerignore (BuildKit) keeps the context small.
#
# Configuration is environment only (apps/api/README.md, .env.example); no .env file is copied in.
# Migrations never run on boot: run `node --import tsx scripts/db.ts migrate` in this image as a one-off job.

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim

# Same pnpm as packageManager in package.json.
ARG PNPM_VERSION=11.28.2
RUN npm install --global "pnpm@${PNPM_VERSION}" && npm cache clean --force

WORKDIR /repo

# Manifests first so the dependency layer is cached until package.json or the lockfile changes. Every
# workspace manifest is copied because --frozen-lockfile validates the whole lockfile.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/canton/package.json packages/canton/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json

# Production dependencies of the API and its workspace packages (tsx is a runtime dependency).
# No BuildKit cache mount: Render requires its own cache-id prefix, so the store is a temp dir removed in-layer.
RUN pnpm install --frozen-lockfile --prod --filter "@collara/api..." --store-dir /tmp/pnpm-store \
    && rm -rf /tmp/pnpm-store

# Internal packages export TypeScript source; tsx compiles it at start-up.
COPY packages/domain packages/domain
COPY packages/db packages/db
COPY packages/canton packages/canton
COPY apps/api apps/api

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000

WORKDIR /repo/apps/api
USER node
EXPOSE 4000

# Liveness only: /api/system/health always answers 200 and reports dependency status in the body.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/system/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# One Node process (tsx as a loader) so SIGTERM reaches the API's graceful shutdown directly.
CMD ["node", "--import", "tsx", "src/main.ts"]
