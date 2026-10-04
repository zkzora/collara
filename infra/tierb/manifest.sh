#!/usr/bin/env bash
# Prints the Tier B install manifest (versions and verified digests) written by install.sh.
set -euo pipefail
# UNTESTED Docker Compose backend (see ctl.sh): its manifest is written by compose-ctl.sh fetch-canton.
if [ "${TIERB_BACKEND:-}" = "compose" ]; then exec bash "$(dirname "${BASH_SOURCE[0]}")/compose-ctl.sh" manifest; fi
cat "${TIERB_RUNTIME:-/opt/collara-tierb}/install-manifest.txt"
