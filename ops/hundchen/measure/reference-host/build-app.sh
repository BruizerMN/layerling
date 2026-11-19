#!/bin/bash
# build-app.sh <artifact.tar.gz | extracted site dir> <out dir>  -> <out dir>/LayerlingHarness.app
# Throwaway measurement host (WKWebView around a static Layerling build). Not a product; needs Xcode's swiftc on macOS 14+.
set -euo pipefail
SRC="$1"; OUT="$2"; H="$(cd "$(dirname "$0")" && pwd)"
A="$OUT/LayerlingHarness.app"; rm -rf "$A"; mkdir -p "$A/Contents/MacOS" "$A/Contents/Resources" "$OUT/extract"
if [ -d "$SRC" ]; then SITE="$SRC"; else tar -xzf "$SRC" -C "$OUT/extract"; SITE="$OUT/extract/site"; fi
swiftc -O -swift-version 5 -o "$A/Contents/MacOS/LayerlingHarness" "$H/main.swift" -framework AppKit -framework WebKit
cp "$H/Info.plist" "$A/Contents/Info.plist"; cp -cR "$SITE" "$A/Contents/Resources/site"; codesign --force --sign - "$A"; echo "built $A (site from $SRC)"
