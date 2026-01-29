#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/codazoda/peen/main"

TMP_DIR="$(mktemp -d -t peen.XXXXXX)"
TMP="${TMP_DIR}/peen.js"
trap 'rm -rf "${TMP_DIR}"' EXIT

cat > "${TMP_DIR}/package.json" << 'EOF'
{"type":"module"}
EOF

curl -fsSL "${REPO_RAW}/peen.js" -o "${TMP}"
node "${TMP}" --install-only
