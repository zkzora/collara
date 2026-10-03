#!/usr/bin/env bash
# Prints the Tier B install manifest (versions and verified digests) written by install.sh.
set -euo pipefail
cat "${TIERB_RUNTIME:-/opt/collara-tierb}/install-manifest.txt"
