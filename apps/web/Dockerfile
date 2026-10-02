# syntax=docker/dockerfile:1
# Collara web: Next.js 16 standalone server (public site + workspace + same-origin /api proxy).
#
# UNTESTED. Written on a machine without Docker: this image has never been built or run. Treat it as a
# starting point, not a verified artifact, and not as a production-ready image.
#
# Build from the repository root (the context must contain the pnpm workspace):
#   docker build -f apps/web/Dockerfile -t collara-web:local .
# The Dockerfile-specific ignore file apps/web/Dockerfile.dockerignore (BuildKit) keeps the context small.
#
# NEXT_OUTPUT=standalone switches next.config.ts to `output: "standalone"` for this build only; without it
# the config is the regular `next build` / `next start` setup. `next build` downloads Google fonts, so the
# build needs network access.
#
# Runtime configuration, read per request on the server (one image for every environment):
#   COLLARA_MODE          UI_MOCK (default) or LOCALNET
#   API_INTERNAL_ORIGIN   where /api/* is proxied (default http://127.0.0.1:4000)
#   PUBLIC_DEMO_STATUS    off (default) or localnet

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS build

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

# Build needs the web app's dev dependencies (Tailwind, PostCSS, TypeScript).
RUN --mount=type=cache,id=collara-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter "@collara/web..." --store-dir /pnpm-store

COPY packages/domain packages/domain
COPY packages/api-client packages/api-client
COPY apps/web apps/web

ENV NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @collara/web run build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# outputFileTracingRoot is the repo root, so the standalone tree mirrors the workspace layout.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "apps/web/server.js"]
