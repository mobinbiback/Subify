#!/usr/bin/env bash
# Builds the Chrome Web Store package from the repo root: subify-chrome-<version>.zip
# Excluded on purpose: assets/ (README demo GIF, 17 MB, not used by the extension), tests/, .git/,
# markdown docs, the Firefox build (firefox/) and release scripts.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
OUT="${1:-dist}"
mkdir -p "$OUT"
DEST="$OUT/subify-chrome-$VERSION.zip"
rm -f "$DEST"
zip -r -X -q "$DEST" . \
  -x ".git/*" ".github/*" "assets/*" "tests/*" "test/*" "firefox/*" "scripts/*" \
  -x "node_modules/*" "dist/*" "*.md" "*.zip" "*.log" "*.map" ".*" "*/.*" "LICENSE*"
# The manifest must sit at the archive root and the package must be intact.
unzip -Z1 "$DEST" | grep -x "manifest.json" > /dev/null
unzip -tq "$DEST"
echo "built $DEST ($(du -h "$DEST" | cut -f1))"
