#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
OUTPUT_DIR="$PROJECT_DIR/dist/chrome"

mkdir -p "$OUTPUT_DIR/src" "$OUTPUT_DIR/icons"
cp "$PROJECT_DIR/manifest.json" "$OUTPUT_DIR/manifest.json"
cp "$PROJECT_DIR/src/background.js" "$PROJECT_DIR/src/content.js" "$PROJECT_DIR/src/content.css" "$PROJECT_DIR/src/docx.js" "$PROJECT_DIR/src/popup.html" "$PROJECT_DIR/src/popup.js" "$PROJECT_DIR/src/popup.css" "$PROJECT_DIR/src/print.html" "$PROJECT_DIR/src/print.js" "$PROJECT_DIR/src/print.css" "$OUTPUT_DIR/src/"
cp "$PROJECT_DIR/icons/icon-16.png" "$PROJECT_DIR/icons/icon-32.png" "$PROJECT_DIR/icons/icon-48.png" "$PROJECT_DIR/icons/icon-128.png" "$OUTPUT_DIR/icons/"

cd "$PROJECT_DIR/dist"
rm -f chat-archive-chrome.zip
zip -qr chat-archive-chrome.zip chrome
echo "Created $PROJECT_DIR/dist/chat-archive-chrome.zip"
