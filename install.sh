#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/codazoda/peen/main"

TMP_BASE="$(mktemp -t peen.XXXXXX)"
TMP="${TMP_BASE}.js"
trap 'rm -f "${TMP}" "${TMP_BASE}"' EXIT

curl -fsSL "${REPO_RAW}/peen.js" -o "${TMP}"
node "${TMP}" --install-only
