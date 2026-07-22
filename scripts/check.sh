#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
cd "$PROJECT_DIR"

node --check src/background.js
node --check src/popup.js
node --check src/print.js
node --check src/docx.js
node --check src/content.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"

"$SCRIPT_DIR/package-chrome.sh" >/dev/null
"$SCRIPT_DIR/package-safari.sh" >/dev/null
unzip -t dist/chat-archive-chrome.zip >/dev/null
unzip -t dist/chat-archive-safari.zip >/dev/null

echo "Syntax, manifests, and Chrome/Safari packages passed."
echo "Open tests/docx-harness.html, tests/content-harness.html, and tests/print-harness.html in a browser for DOM-level checks."
