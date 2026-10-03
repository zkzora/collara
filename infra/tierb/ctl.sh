#!/usr/bin/env bash
# Tier B process control inside WSL (driven by scripts/tierb/*.mjs).
#
#   ctl.sh up             start Canton (fresh, in-memory) and three dec-party-manager nodes
#   ctl.sh down           stop everything (SIGKILL fallback: dec-party-manager ignores SIGTERM)
#   ctl.sh status         print process and port status
#   ctl.sh dm-stop  <p>   stop one DM node (p1|p2|p3)
#   ctl.sh dm-start <p>   (re)start one DM node with its existing data dir
#   ctl.sh dm-restart <p> stop + start (DM loads peer keys only at startup)
#   ctl.sh console <script.canton> [KEY=VALUE...]   run a Canton console script against the nodes' Admin APIs
#
# Everything runs as root under $TIERB_RUNTIME (default /opt/collara-tierb) and binds 127.0.0.1 only.
set -euo pipefail

RUNTIME="${TIERB_RUNTIME:-/opt/collara-tierb}"
REPO_WSL="${REPO_WSL:?REPO_WSL must be set}"
CANTON_VERSION="${CANTON_VERSION:-3.5.19}"
CANTON_JAR="$RUNTIME/canton-open-source-$CANTON_VERSION/lib/canton-open-source-$CANTON_VERSION.jar"
DM_BIN="$RUNTIME/bin/dec-party-manager"
RUN="$RUNTIME/run"
LOGS="$RUNTIME/logs"
CANTON_HEAP="${TIERB_CANTON_HEAP:-2g}"
HMAC_SECRET="${TIERB_HMAC_SECRET:-collara-tierb-dev-secret}"
HMAC_AUDIENCE="${TIERB_HMAC_AUDIENCE:-https://collara.local/tierb-ledger-api}"

declare -A LEDGER=([p1]=5001 [p2]=5011 [p3]=5021)
declare -A ADMIN=([p1]=5002 [p2]=5012 [p3]=5022)
declare -A DM_HTTP=([p1]=8081 [p2]=8082 [p3]=8083)
declare -A DM_NOISE=([p1]=9001 [p2]=9002 [p3]=9003)
declare -A DM_METRICS=([p1]=9464 [p2]=9465 [p3]=9466)

log() { printf '[tierb] %s\n' "$*"; }
die() { printf '[tierb] ERROR: %s\n' "$*" >&2; exit 1; }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
port_open() { (echo >"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

stop_pidfile() { # $1 pidfile, $2 name
  local f="$1"
  if alive "$f"; then
    local pid; pid=$(cat "$f")
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$pid" 2>/dev/null || true
    log "stopped $2 (pid $pid)"
  fi
  rm -f "$f"
}

canton_up() {
  [ -f "$CANTON_JAR" ] || die "Canton jar missing; run scripts/tierb/install.mjs first"
  alive "$RUN/canton.pid" && die "Canton already running (pid $(cat "$RUN/canton.pid")); run down first"
  for p in 5001 5002 5011 5012 5021 5022 5031 5032 5042 7585 7586 7587; do
    port_open "$p" && die "port $p is already in use"
  done
  mkdir -p "$RUN" "$LOGS"
  rm -f "$LOGS/canton.log" "$LOGS/canton.out" "$RUN/canton-ports.json"
  log "starting Canton $CANTON_VERSION (heap $CANTON_HEAP)"
  (
    cd "$RUNTIME"
    TIERB_HMAC_SECRET="$HMAC_SECRET" TIERB_HMAC_AUDIENCE="$HMAC_AUDIENCE" TIERB_PORTS_FILE="$RUN/canton-ports.json" \
      setsid nohup java "-Xmx$CANTON_HEAP" -XX:+UseG1GC -Dfile.encoding=UTF-8 -Djava.net.preferIPv4Stack=true -jar "$CANTON_JAR" daemon \
        -c "$REPO_WSL/infra/tierb/canton/tierb.conf" \
        --bootstrap "$REPO_WSL/infra/tierb/canton/bootstrap.canton" \
        --log-file-name "$LOGS/canton.log" --log-level-canton=INFO \
        > "$LOGS/canton.out" 2>&1 < /dev/null &
    echo $! > "$RUN/canton.pid"
  )
  local waited=0
  until grep -q 'TIERB_READY' "$LOGS/canton.out" 2>/dev/null; do
    alive "$RUN/canton.pid" || { tail -40 "$LOGS/canton.out" >&2; die "Canton exited during bootstrap"; }
    [ "$waited" -ge 300 ] && { tail -40 "$LOGS/canton.out" >&2; die "Canton not ready after 300 s"; }
    sleep 2; waited=$((waited + 2))
  done
  log "Canton ready after ~${waited}s"
  grep 'TIERB_' "$LOGS/canton.out"
}

dm_start() { # $1 = p1|p2|p3
  local p="$1" dir="$RUNTIME/dm/$1"
  alive "$RUN/dm-$p.pid" && { log "DM $p already running"; return 0; }
  mkdir -p "$dir" "$LOGS"
  (
    cd "$dir"
    RUST_LOG="${RUST_LOG:-dec_party_manager=info,tokio_noise=error,hyper_noise=error}" \
    DECPM_HOST=127.0.0.1 \
    DECPM_PORT="${DM_HTTP[$p]}" \
    DECPM_LISTEN_ADDRESS=127.0.0.1 \
    DECPM_NOISE_PORT="${DM_NOISE[$p]}" \
    DECPM_PUBLIC_ADDRESS=127.0.0.1 \
    DECPM_METRICS_PORT="${DM_METRICS[$p]}" \
    DECPM_CANTON_ADMIN_HOST=127.0.0.1 \
    DECPM_CANTON_ADMIN_PORT="${ADMIN[$p]}" \
    DECPM_CANTON_LEDGER_HOST=127.0.0.1 \
    DECPM_CANTON_LEDGER_PORT="${LEDGER[$p]}" \
    DECPM_CANTON_SYNCHRONIZER=global \
    DECPM_CANTON_NETWORK=devnet \
    DECPM_CANTON_HMAC_SECRET="$HMAC_SECRET" \
    DECPM_CANTON_HMAC_AUDIENCE="$HMAC_AUDIENCE" \
    DECPM_CANTON_HMAC_SUBJECT=ledger-api-user \
    DECPM_INSECURE=true \
    DECPM_LOG_FORMAT=text \
    DECPM_TOPOLOGY_PROPAGATION_DELAY_SECS=3 \
    DECPM_PEER_WAIT_POLL_DELAY_MS=500 \
    DECPM_REWARD_AUTOMATION_INTERVAL_SECS=3600 \
      setsid nohup "$DM_BIN" -d "$dir" serve >> "$LOGS/dm-$p.log" 2>&1 < /dev/null &
    echo $! > "$RUN/dm-$p.pid"
  )
  local waited=0
  until curl -fsS "http://127.0.0.1:${DM_HTTP[$p]}/keys/status" 2>/dev/null | grep -q '"public_key":"'; do
    alive "$RUN/dm-$p.pid" || { tail -30 "$LOGS/dm-$p.log" >&2; die "DM $p exited during startup"; }
    [ "$waited" -ge 90 ] && { tail -30 "$LOGS/dm-$p.log" >&2; die "DM $p not ready after 90 s"; }
    sleep 1; waited=$((waited + 1))
  done
  until port_open "${DM_NOISE[$p]}"; do sleep 1; done
  log "DM $p ready (http ${DM_HTTP[$p]}, noise ${DM_NOISE[$p]}, pid $(cat "$RUN/dm-$p.pid"))"
}

dm_stop() { stop_pidfile "$RUN/dm-$1.pid" "DM $1"; }

up() {
  canton_up
  # Canton is fresh (in-memory), so participant ids changed: discard DM state from any previous run.
  rm -rf "$RUNTIME/dm"
  for p in p1 p2 p3; do dm_start "$p"; done
}

down() {
  for p in p1 p2 p3; do dm_stop "$p"; done
  stop_pidfile "$RUN/canton.pid" "Canton"
  # Stragglers from a crashed run.
  pkill -9 -f "$RUNTIME/bin/dec-party-manager" 2>/dev/null || true
  pkill -9 -f "canton-open-source-$CANTON_VERSION.jar daemon" 2>/dev/null || true
}

status() {
  if alive "$RUN/canton.pid"; then
    local rss; rss=$(ps -o rss= -p "$(cat "$RUN/canton.pid")" | awk '{printf "%d MB", $1/1024}')
    echo "canton: running (pid $(cat "$RUN/canton.pid"), rss $rss)"
  else
    echo "canton: stopped"
  fi
  for p in p1 p2 p3; do
    local s="stopped"
    alive "$RUN/dm-$p.pid" && s="running (pid $(cat "$RUN/dm-$p.pid"))"
    local ports=""
    for port in "${LEDGER[$p]}" "${ADMIN[$p]}" "${DM_HTTP[$p]}" "${DM_NOISE[$p]}"; do
      if port_open "$port"; then ports="$ports $port:open"; else ports="$ports $port:closed"; fi
    done
    echo "dm-$p: $s;$ports"
  done
  free -m | awk 'NR==2 {print "wsl memory: used " $3 " MB, available " $7 " MB"}'
}

# Runs a Canton console script against the running nodes through their Admin APIs (a second, short-lived JVM).
# Extra KEY=VALUE arguments are exported to the script (read with sys.env).
console() {
  local script="$1"; shift
  [ -f "$CANTON_JAR" ] || die "Canton jar missing"
  alive "$RUN/canton.pid" || die "Canton is not running"
  for kv in "$@"; do export "${kv?}"; done
  java -Xmx768m -Djava.net.preferIPv4Stack=true -jar "$CANTON_JAR" run "$script" \
    -c "$REPO_WSL/infra/tierb/canton/remote.conf" --log-file-name "$LOGS/console.log" 2>&1
}

case "${1:-}" in
  console) shift; console "$@" ;;
  up) up ;;
  canton-up) canton_up ;;
  down) down ;;
  status) status ;;
  dm-start) dm_start "${2:?p1|p2|p3}" ;;
  dm-stop) dm_stop "${2:?p1|p2|p3}" ;;
  dm-restart) dm_stop "${2:?p1|p2|p3}"; dm_start "$2" ;;
  *) die "usage: ctl.sh up|down|status|canton-up|dm-start <p>|dm-stop <p>|dm-restart <p>" ;;
esac
