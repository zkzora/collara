#!/usr/bin/env bash
# Tier B installer. Runs inside WSL Ubuntu as root (driven by scripts/tierb/install.mjs).
#
#   1. headless JRE 21 (apt)
#   2. Canton open-source 3.5.19 release tarball from GitHub, SHA-256 verified, extracted to $TIERB_RUNTIME
#   3. dec-party-manager v1.12.0 from the public ECR image (no Docker): anonymous pull token, the image index,
#      the linux/amd64 manifest and the binary layer are each verified against their sha256 digest before use
#
# Downloads land in $TIERB_DOWNLOADS (C:\Collara\.local\tierb\downloads, gitignored). The extracted runtime lives
# on the WSL ext4 disk ($TIERB_RUNTIME, default /opt/collara-tierb) because a JVM reading a 300 MB jar through
# /mnt/c is slow. Re-running is idempotent.
set -euo pipefail

TIERB_RUNTIME="${TIERB_RUNTIME:-/opt/collara-tierb}"
TIERB_DOWNLOADS="${TIERB_DOWNLOADS:?TIERB_DOWNLOADS must be set}"
KEEP_DOWNLOADS="${KEEP_DOWNLOADS:-0}"

CANTON_VERSION="${CANTON_VERSION:-3.5.19}"
declare -A CANTON_SHA256=(
  # GitHub release asset digests (api.github.com/repos/digital-asset/canton/releases/tags/v<version>)
  ["3.5.19"]="d5798f9dd41e6b1226c8579b40df9694839df72884c69efb309b52ed2ba09494"
  ["3.5.8"]="${CANTON_358_SHA256:-}"
)

DM_REPO="dlc-link/decentralization-manager"
DM_TAG="v1.12.0"
DM_INDEX_DIGEST="sha256:54ec6ce6783d7bc32f765f40e541b9584d32dd737a12434c8f426df381d7039d"

log() { printf '[tierb-install] %s\n' "$*"; }
die() { printf '[tierb-install] ERROR: %s\n' "$*" >&2; exit 1; }
sha_of() { sha256sum "$1" | cut -d' ' -f1; }

mkdir -p "$TIERB_RUNTIME/bin" "$TIERB_DOWNLOADS"
MANIFEST="$TIERB_RUNTIME/install-manifest.txt"
: > "$MANIFEST.tmp"

# --- 1. Java -------------------------------------------------------------------------------------------------
if ! command -v java >/dev/null 2>&1; then
  log "installing openjdk-21-jre-headless (apt)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # apt can exit non-zero because of an unrelated half-configured package in the distro; Java is checked below.
  apt-get install -y -qq --no-install-recommends openjdk-21-jre-headless >/dev/null || \
    log "apt-get returned non-zero (often an unrelated broken package); checking for java anyway"
fi
command -v java >/dev/null 2>&1 || die "java is not available after apt-get install openjdk-21-jre-headless"
JAVA_VERSION=$(java -version 2>&1 | head -1)
log "java: $JAVA_VERSION"
echo "java: $JAVA_VERSION" >> "$MANIFEST.tmp"

# --- 2. Canton -----------------------------------------------------------------------------------------------
CANTON_DIR="$TIERB_RUNTIME/canton-open-source-$CANTON_VERSION"
CANTON_JAR="$CANTON_DIR/lib/canton-open-source-$CANTON_VERSION.jar"
if [ ! -f "$CANTON_JAR" ]; then
  expected="${CANTON_SHA256[$CANTON_VERSION]:-}"
  [ -n "$expected" ] || die "no pinned sha256 for Canton $CANTON_VERSION"
  tarball="$TIERB_DOWNLOADS/canton-open-source-$CANTON_VERSION.tar.gz"
  if [ ! -f "$tarball" ] || [ "$(sha_of "$tarball")" != "$expected" ]; then
    log "downloading Canton $CANTON_VERSION (~285 MB)"
    curl -fsSL --show-error --retry 3 -o "$tarball.part" \
      "https://github.com/digital-asset/canton/releases/download/v$CANTON_VERSION/canton-open-source-$CANTON_VERSION.tar.gz"
    mv "$tarball.part" "$tarball"
  fi
  actual=$(sha_of "$tarball")
  [ "$actual" = "$expected" ] || die "Canton tarball sha256 mismatch: expected $expected, got $actual"
  log "Canton tarball sha256 OK ($actual)"
  tmp="$TIERB_RUNTIME/.canton-extract"
  rm -rf "$tmp" && mkdir -p "$tmp"
  tar -xzf "$tarball" -C "$tmp"
  src=$(find "$tmp" -maxdepth 1 -mindepth 1 -type d | head -1)
  rm -rf "$CANTON_DIR"
  mv "$src" "$CANTON_DIR"
  rm -rf "$tmp"
  # Keep bin/, lib/ and the reference examples; drop the bundled demo payloads we never load.
  rm -rf "$CANTON_DIR/demo" "$CANTON_DIR/dars" 2>/dev/null || true
  if [ "$KEEP_DOWNLOADS" != "1" ]; then rm -f "$tarball"; log "removed tarball (KEEP_DOWNLOADS=1 keeps it)"; fi
  echo "canton-tarball-sha256: $expected" >> "$MANIFEST.tmp"
else
  log "Canton $CANTON_VERSION already installed at $CANTON_DIR"
  grep '^canton-tarball-sha256' "$MANIFEST" >> "$MANIFEST.tmp" 2>/dev/null || true
fi
echo "canton: $CANTON_VERSION $CANTON_JAR sha256=$(sha_of "$CANTON_JAR")" >> "$MANIFEST.tmp"

# --- 3. dec-party-manager from public ECR --------------------------------------------------------------------
DM_BIN="$TIERB_RUNTIME/bin/dec-party-manager"
if [ ! -x "$DM_BIN" ]; then
  log "pulling $DM_REPO:$DM_TAG@$DM_INDEX_DIGEST from public.ecr.aws (anonymous)"
  token=$(curl -fsS "https://public.ecr.aws/token/?scope=repository:$DM_REPO:pull" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
  reg="https://public.ecr.aws/v2/$DM_REPO"
  accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'
  work="$TIERB_DOWNLOADS/dm-$DM_TAG"
  mkdir -p "$work"
  fetch_verified() { # $1 = path suffix (manifests/<d> or blobs/<d>), $2 = digest, $3 = out
    curl -fsSL -H "Authorization: Bearer $token" -H "Accept: $accept" -o "$3" "$reg/$1"
    local got="sha256:$(sha_of "$3")"
    [ "$got" = "$2" ] || die "digest mismatch for $1: expected $2, got $got"
  }
  fetch_verified "manifests/$DM_INDEX_DIGEST" "$DM_INDEX_DIGEST" "$work/index.json"
  log "image index digest OK"
  amd64=$(python3 - "$work/index.json" <<'PY'
import json, sys
idx = json.load(open(sys.argv[1]))
for m in idx.get("manifests", []):
    p = m.get("platform", {})
    if p.get("os") == "linux" and p.get("architecture") == "amd64":
        print(m["digest"]); break
PY
)
  [ -n "$amd64" ] || die "no linux/amd64 manifest in the image index"
  fetch_verified "manifests/$amd64" "$amd64" "$work/manifest-amd64.json"
  log "linux/amd64 manifest $amd64 OK"
  found=""
  for layer in $(python3 -c 'import json,sys; [print(l["digest"]) for l in reversed(json.load(open(sys.argv[1]))["layers"])]' "$work/manifest-amd64.json"); do
    out="$work/${layer#sha256:}.tar.gz"
    fetch_verified "blobs/$layer" "$layer" "$out"
    if tar -tzf "$out" 2>/dev/null | grep -qx 'usr/local/bin/dec-party-manager'; then
      tar -xzf "$out" -C "$work" usr/local/bin/dec-party-manager
      install -m 0755 "$work/usr/local/bin/dec-party-manager" "$DM_BIN"
      found="$layer"
      break
    fi
    rm -f "$out"
  done
  [ -n "$found" ] || die "dec-party-manager not found in any layer"
  log "binary layer $found OK"
  if [ "$KEEP_DOWNLOADS" != "1" ]; then rm -rf "$work/usr" "$work"/*.tar.gz; fi
  {
    echo "dm-image: public.ecr.aws/$DM_REPO:$DM_TAG@$DM_INDEX_DIGEST"
    echo "dm-amd64-manifest: $amd64"
    echo "dm-binary-layer: $found"
  } >> "$MANIFEST.tmp"
else
  log "dec-party-manager already installed at $DM_BIN"
  grep '^dm-' "$MANIFEST" >> "$MANIFEST.tmp" 2>/dev/null || true
fi
echo "dm-binary: $DM_BIN sha256=$(sha_of "$DM_BIN")" >> "$MANIFEST.tmp"
mv "$MANIFEST.tmp" "$MANIFEST"

log "ldd check:"
ldd "$DM_BIN" | grep -i 'not found' && die "dec-party-manager has missing shared libraries" || true
"$DM_BIN" --help 2>&1 | head -3 || true
log "install manifest:"
cat "$MANIFEST"
