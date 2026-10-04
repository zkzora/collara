#!/usr/bin/env bash
# Tier B process control with Docker Compose: the same interface as infra/tierb/ctl.sh, so scripts/tierb/*.mjs can
# drive it unchanged. ctl.sh hands over to this file when TIERB_BACKEND=compose.
#
# UNTESTED. Never run: the authoring machine has no Docker. The verified path is ctl.sh in WSL. See
# infra/tierb/compose.yaml and docs/submission/bitsafe-contribution-pool.md §6 for what remains unverified.
#
#   compose-ctl.sh fetch-canton     download Canton OSS 3.5.19, verify its sha256, extract to .local/tierb/canton
#   compose-ctl.sh up               fresh Canton (in-memory) + three fresh DM nodes
#   compose-ctl.sh down             stop and remove everything (DM volumes too)
#   compose-ctl.sh status           container and port status
#   compose-ctl.sh dm-stop|dm-start|dm-restart <p1|p2|p3>
#   compose-ctl.sh console <script.canton> [KEY=VALUE...]   Canton remote console inside the canton container
set -euo pipefail

REPO="${REPO_WSL:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export COLLARA_REPO="$REPO"
COMPOSE=(docker compose -f "$REPO/infra/tierb/compose.yaml")
CANTON_VERSION=3.5.19
CANTON_SHA256=d5798f9dd41e6b1226c8579b40df9694839df72884c69efb309b52ed2ba09494
CANTON_HOME="$REPO/.local/tierb/canton"
CANTON_JAR_IN_CONTAINER="/opt/canton/canton-open-source-$CANTON_VERSION/lib/canton-open-source-$CANTON_VERSION.jar"
RUN_DIR="$REPO/.local/tierb/compose-run"
declare -A DM_HTTP=([p1]=8081 [p2]=8082 [p3]=8083)
declare -A DM_NOISE=([p1]=9001 [p2]=9002 [p3]=9003)

log() { printf '[tierb-compose] %s\n' "$*"; }
die() { printf '[tierb-compose] ERROR: %s\n' "$*" >&2; exit 1; }
port_open() { (echo >"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

fetch_canton() {
  local jar="$CANTON_HOME/canton-open-source-$CANTON_VERSION/lib/canton-open-source-$CANTON_VERSION.jar"
  if [ -f "$jar" ]; then log "Canton $CANTON_VERSION already extracted"; return 0; fi
  mkdir -p "$CANTON_HOME"
  local tarball="$CANTON_HOME/canton-open-source-$CANTON_VERSION.tar.gz"
  log "downloading Canton $CANTON_VERSION (~285 MB)"
  curl -fsSL --show-error --retry 3 -o "$tarball.part" \
    "https://github.com/digital-asset/canton/releases/download/v$CANTON_VERSION/canton-open-source-$CANTON_VERSION.tar.gz"
  mv "$tarball.part" "$tarball"
  local actual; actual=$(sha256sum "$tarball" | cut -d' ' -f1)
  [ "$actual" = "$CANTON_SHA256" ] || die "Canton tarball sha256 mismatch: expected $CANTON_SHA256, got $actual"
  log "Canton tarball sha256 OK"
  tar -xzf "$tarball" -C "$CANTON_HOME"
  [ -d "$CANTON_HOME/canton-open-source-$CANTON_VERSION" ] || die "unexpected tarball layout under $CANTON_HOME"
  rm -f "$tarball"
  mkdir -p "$RUN_DIR"
  {
    echo "canton-tarball-sha256: $CANTON_SHA256"
    echo "canton: $CANTON_VERSION $jar sha256=$(sha256sum "$jar" | cut -d' ' -f1)"
    echo "dm-image: public.ecr.aws/dlc-link/decentralization-manager:v1.12.0@sha256:54ec6ce6783d7bc32f765f40e541b9584d32dd737a12434c8f426df381d7039d"
    echo "backend: docker compose (UNTESTED path)"
  } > "$RUN_DIR/install-manifest.txt"
}

wait_dm() { # $1 = p1|p2|p3
  local p="$1" waited=0
  until curl -fsS "http://127.0.0.1:${DM_HTTP[$p]}/keys/status" 2>/dev/null | grep -q '"public_key":"'; do
    [ "$waited" -ge 90 ] && { "${COMPOSE[@]}" logs --tail 30 "dm-$p" >&2; die "DM $p not ready after 90 s"; }
    sleep 1; waited=$((waited + 1))
  done
  until port_open "${DM_NOISE[$p]}"; do sleep 1; done
  log "DM $p ready (http ${DM_HTTP[$p]}, noise ${DM_NOISE[$p]})"
}

canton_up() {
  fetch_canton
  mkdir -p "$RUN_DIR"
  log "starting Canton $CANTON_VERSION"
  "${COMPOSE[@]}" up -d --wait canton
  grep 'TIERB_' "$RUN_DIR/canton.out" || true
}

up() {
  # Fresh Canton means fresh participant ids: discard DM state (volumes) from any previous run, as ctl.sh does.
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  canton_up
  for p in p1 p2 p3; do "${COMPOSE[@]}" up -d --no-deps "dm-$p"; wait_dm "$p"; done
}

down() { "${COMPOSE[@]}" down -v --remove-orphans; }

status() {
  "${COMPOSE[@]}" ps
  for p in p1 p2 p3; do
    local ports=""
    for port in "${DM_HTTP[$p]}" "${DM_NOISE[$p]}"; do
      if port_open "$port"; then ports="$ports $port:open"; else ports="$ports $port:closed"; fi
    done
    echo "dm-$p:$ports"
  done
}

console() {
  local script="$1"; shift
  local envs=()
  for kv in "$@"; do envs+=(-e "$kv"); done
  "${COMPOSE[@]}" exec -T "${envs[@]}" canton java -Xmx768m -Djava.net.preferIPv4Stack=true -jar "$CANTON_JAR_IN_CONTAINER" \
    run "$script" -c "$REPO/infra/tierb/canton/remote.conf" --log-file-name /work/console.log 2>&1
}

case "${1:-}" in
  fetch-canton) fetch_canton ;;
  up) up ;;
  canton-up) canton_up ;;
  down) down ;;
  status) status ;;
  console) shift; console "$@" ;;
  dm-start) "${COMPOSE[@]}" start "dm-${2:?p1|p2|p3}"; wait_dm "$2" ;;
  dm-stop) "${COMPOSE[@]}" stop "dm-${2:?p1|p2|p3}"; log "stopped DM $2" ;;
  dm-restart) "${COMPOSE[@]}" restart "dm-${2:?p1|p2|p3}"; wait_dm "$2" ;;
  manifest) cat "$RUN_DIR/install-manifest.txt" ;;
  *) die "usage: compose-ctl.sh fetch-canton|up|down|status|canton-up|console <script>|dm-start|dm-stop|dm-restart <p>|manifest" ;;
esac
