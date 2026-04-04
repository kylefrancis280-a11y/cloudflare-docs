#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "Installing npm dependencies..."
npm install --ignore-scripts

echo "Applying patches..."
npx patch-package

echo "Session start hook complete."
