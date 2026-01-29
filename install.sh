#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/codazoda/peen/main"

TMP="$(mktemp -t peen.XXXXXX.js)"
trap 'rm -f "${TMP}"' EXIT

curl -fsSL "${REPO_RAW}/peen.js" -o "${TMP}"
node "${TMP}" --install-only
