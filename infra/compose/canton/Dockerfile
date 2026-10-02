# syntax=docker/dockerfile:1
# Collara local ledger for Docker hosts: the same Canton 3.5.19 `dpm sandbox` (Daml SDK 3.5.12) that the
# Windows scripts run, inside a JDK 21 container, plus Node for scripts/localnet/bootstrap.mjs.
#
# UNTESTED. Written on a machine without Docker: this image has never been built or run. It is a local
# development ledger (in-memory, unsafe HMAC auth), never a production participant.
#
# Build from the repository root:
#   docker build -f infra/compose/canton/Dockerfile -t collara-canton-sandbox:local .
# Used by the compose profile `canton` (infra/compose/compose.yaml) for the services `canton` (the sandbox)
# and `canton-bootstrap` (one-shot: DAR upload, parties, ledger users, state.json in the shared volume).

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS node

FROM eclipse-temurin:21-jdk-noble

ARG DPM_SDK_VERSION=3.5.12

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Node 24 for the bootstrap script (plain .mjs, no dependencies).
COPY --from=node /usr/local/bin/node /usr/local/bin/node

RUN useradd --create-home --shell /bin/sh collara \
 && mkdir -p /state /opt/collara \
 && chown collara:collara /state /opt/collara
USER collara
ENV HOME=/home/collara \
    TERM=dumb

# Official dpm installer with an explicit SDK version (`install.sh VERSION`); installs into ~/.dpm.
RUN curl -sSLf https://get.digitalasset.com/install/install.sh | sh -s "${DPM_SDK_VERSION}"
ENV PATH=/home/collara/.dpm/bin:${PATH}

WORKDIR /opt/collara
COPY --chown=collara:collara daml daml
COPY --chown=collara:collara scripts/localnet scripts/localnet
COPY --chown=collara:collara infra/canton infra/canton
COPY --chown=collara:collara infra/compose/canton/container.conf infra/compose/canton/container.conf

# Verify the vendored DM DARs, then build the Collara DARs that bootstrap.mjs uploads.
RUN cd daml/collara/vendor-dars && sha256sum -c SHA256SUMS \
 && cd /opt/collara/daml/collara && JDK_JAVA_OPTIONS=-Xmx1g dpm build --all

# bootstrap.mjs writes state.json here (shared volume, read by the api and worker containers).
ENV LOCALNET_DIR=/state \
    JDK_JAVA_OPTIONS=-Xmx1g

EXPOSE 7575

HEALTHCHECK --interval=10s --timeout=5s --start-period=120s --retries=30 \
  CMD ["curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:7575/readyz"]

# CANTON_JWT_HMAC_SECRET / CANTON_JWT_AUDIENCE override the dev placeholders in sandbox-auth.conf.
CMD ["dpm", "sandbox", "-c", "infra/canton/sandbox-auth.conf", "-c", "infra/compose/canton/container.conf", "--json-api-port", "7575"]
