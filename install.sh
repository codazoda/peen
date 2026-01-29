#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/codazoda/peen/main"

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
INSTALL_DIR="${DATA_HOME}/peen"
BIN_DIR="${BIN_HOME}"

mkdir -p "${INSTALL_DIR}/prompt" "${BIN_DIR}"

curl -fsSL "${REPO_RAW}/peen.js" -o "${INSTALL_DIR}/peen.js"
curl -fsSL "${REPO_RAW}/ollama.js" -o "${INSTALL_DIR}/ollama.js"
curl -fsSL "${REPO_RAW}/tools.js" -o "${INSTALL_DIR}/tools.js"
curl -fsSL "${REPO_RAW}/prompt/system.txt" -o "${INSTALL_DIR}/prompt/system.txt"

chmod +x "${INSTALL_DIR}/peen.js"

cat > "${BIN_DIR}/peen" << EOF
#!/usr/bin/env bash
set -euo pipefail
exec node "${INSTALL_DIR}/peen.js" "\$@"
EOF

chmod +x "${BIN_DIR}/peen"

echo "peen installed to ${INSTALL_DIR}"
if ! command -v peen >/dev/null 2>&1; then
  echo "Add ${BIN_DIR} to your PATH to use 'peen'."
fi
