#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/codazoda/peen/main"

if [ -w /usr/local/share ] && [ -w /usr/local/bin ]; then
  INSTALL_DIR="/usr/local/share/peen"
  BIN_DIR="/usr/local/bin"
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  INSTALL_DIR="/usr/local/share/peen"
  BIN_DIR="/usr/local/bin"
  SUDO="sudo"
else
  INSTALL_DIR="${HOME}/.local/share/peen"
  BIN_DIR="${HOME}/.local/bin"
  SUDO=""
fi

$SUDO mkdir -p "${INSTALL_DIR}/prompt" "${BIN_DIR}"

$SUDO curl -fsSL "${REPO_RAW}/peen.js" -o "${INSTALL_DIR}/peen.js"
$SUDO curl -fsSL "${REPO_RAW}/ollama.js" -o "${INSTALL_DIR}/ollama.js"
$SUDO curl -fsSL "${REPO_RAW}/tools.js" -o "${INSTALL_DIR}/tools.js"
$SUDO curl -fsSL "${REPO_RAW}/prompt/system.txt" -o "${INSTALL_DIR}/prompt/system.txt"

$SUDO chmod +x "${INSTALL_DIR}/peen.js"

$SUDO tee "${BIN_DIR}/peen" >/dev/null << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec node "/usr/local/share/peen/peen.js" "$@"
EOF

if [ "${INSTALL_DIR}" != "/usr/local/share/peen" ]; then
  $SUDO sed -i.bak "s|/usr/local/share/peen|${INSTALL_DIR}|g" "${BIN_DIR}/peen"
  $SUDO rm -f "${BIN_DIR}/peen.bak"
fi

echo "peen installed to ${INSTALL_DIR}"
if ! command -v peen >/dev/null 2>&1; then
  echo "Add ${BIN_DIR} to your PATH to use 'peen'."
fi
