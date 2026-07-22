#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")

BUILD_DIR="$PROJECT_DIR/.icon-build"
mkdir -p "$BUILD_DIR"
qlmanage -t -s 128 -o "$BUILD_DIR" "$PROJECT_DIR/icons/icon.svg" >/dev/null

for size in 16 32 48 128; do
  sips -s format png -z "$size" "$size" "$BUILD_DIR/icon.svg.png" --out "$PROJECT_DIR/icons/icon-$size.png" >/dev/null
done

echo "Generated Chrome and Safari icons."
