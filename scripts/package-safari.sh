#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

"$SCRIPT_DIR/package-chrome.sh" >/dev/null
SAFARI_SOURCE="$PROJECT_DIR/dist/safari-extension"
mkdir -p "$SAFARI_SOURCE"
cp -R "$PROJECT_DIR/dist/chrome/." "$SAFARI_SOURCE/"

cd "$PROJECT_DIR/dist"
rm -f chat-archive-safari.zip
zip -qr chat-archive-safari.zip safari-extension
echo "Created $PROJECT_DIR/dist/chat-archive-safari.zip"

PACKAGER=""
if xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  PACKAGER="safari-web-extension-packager"
elif xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  PACKAGER="safari-web-extension-converter"
fi

if [ -n "$PACKAGER" ]; then
  xcrun "$PACKAGER" "$SAFARI_SOURCE" \
    --project-location "$PROJECT_DIR/dist/safari-xcode" \
    --app-name "ChatGPT to Word PDF" \
    --bundle-identifier "com.chatarchive.exporter" \
    --swift --macos-only --copy-resources --no-open --no-prompt --force
  echo "Created the Safari Xcode project in $PROJECT_DIR/dist/safari-xcode"
else
  echo "Xcode is not installed, so the Xcode wrapper was skipped."
  echo "The Safari extension folder and zip are ready for Safari's Add Temporary Extension command."
fi
