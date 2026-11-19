#!/usr/bin/env bash
# NO sudo. Builds the STATIC export of the current commit of ~/bin/layerling into its own folder
# (never touches the deployed ~/bin/layerling-releases/* or the running layerling service) and packages it as a
# reproducible artifact identified by source commit + SHA-256.
#
# Same steps as upstream scripts/build-static-export.mjs, except the build id is derived from the commit instead of
# Date.now(), so the same commit gives the same bytes. Output (default ~/bin/layerling-static/<commit9>/):
#   site/                                   the static site (what the macOS app will serve)
#   layerling-static-<ver>-<commit9>.tar.gz deterministic archive of site/
#   *.tar.gz.sha256, SHA256SUMS-files.txt   archive checksum and per-file checksums
#   MANIFEST.json                           commit, versions, commands, sizes (not inside the archive)
#   build.log
# Usage: build-static.sh [output-dir]      (refuses to overwrite an existing output dir)
set -euo pipefail
export PATH="$HOME/bin/layerling-node/current/bin:$PATH" NEXT_TELEMETRY_DISABLED=1 LC_ALL=C TZ=UTC
cd "$HOME/bin/layerling"
[ -z "$(git status --porcelain)" ] || { echo "Working tree not clean - commit first."; exit 1; }
COMMIT="$(git rev-parse HEAD)"; C9="${COMMIT:0:9}"
VER="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json | head -1)"
OUT="${1:-$HOME/bin/layerling-static/$C9}"
[ ! -e "$OUT" ] || { echo "$OUT already exists."; exit 1; }
mkdir -p "$OUT"; exec > >(tee "$OUT/build.log") 2>&1
echo "source commit: $COMMIT  (v$VER)   node $(node -v)  npm $(npm -v)  next $(node -p 'require("next/package.json").version')"
START=$(date +%s)

export STATIC_EXPORT=true LAYERLING_BUILD_ID="$C9"
node scripts/copy-occt-wasm.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/build-japanese-typeface.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/build-guide.mjs
rm -rf apps/web/.next-export
node node_modules/next/dist/bin/next build apps/web
node scripts/verify-static-worker-assets.mjs
node scripts/generate-service-worker.mjs
[ -f apps/web/.next-export/index.html ] || { echo "no index.html in apps/web/.next-export"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "build changed tracked/untracked files:"; git status --porcelain; exit 1; }

cp -a apps/web/.next-export "$OUT/site"
find "$OUT/site" -type d -exec chmod 755 {} +; find "$OUT/site" -type f -exec chmod 644 {} +
( cd "$OUT/site" && find . -type f | sort | xargs sha256sum ) > "$OUT/SHA256SUMS-files.txt"
ARCHIVE="layerling-static-$VER-$C9.tar.gz"
( cd "$OUT" && tar --sort=name --mtime="@$(git -C "$HOME/bin/layerling" show -s --format=%ct HEAD)" --owner=0 --group=0 --numeric-owner -cf - site | gzip -n -9 > "$ARCHIVE" )
( cd "$OUT" && sha256sum "$ARCHIVE" > "$ARCHIVE.sha256" )
SHA="$(cut -d' ' -f1 "$OUT/$ARCHIVE.sha256")"
# Host protocol range this editor speaks (single source: the constants in hostProtocol.ts).
HP_MIN="$(grep -oP "^export const HOST_PROTOCOL_MIN = \K[0-9]+" apps/web/src/lib/host/hostProtocol.ts)"
HP_MAX="$(grep -oP "^export const HOST_PROTOCOL_MAX = \K[0-9]+" apps/web/src/lib/host/hostProtocol.ts)"
[ -n "$HP_MIN" ] && [ -n "$HP_MAX" ] || { echo "cannot read host protocol range" >&2; exit 1; }
cat > "$OUT/MANIFEST.json" <<EOF
{
  "artifact": "$ARCHIVE",
  "sha256": "$SHA",
  "source_repo": "https://github.com/BruizerMN/layerling",
  "source_branch": "$(git branch --show-current)",
  "source_commit": "$COMMIT",
  "layerling_version": "$VER",
  "build_id": "$C9",
  "host_protocol": { "min": $HP_MIN, "max": $HP_MAX },
  "node": "$(node -v)", "npm": "$(npm -v)", "next": "$(node -p 'require("next/package.json").version')",
  "files": $(wc -l < "$OUT/SHA256SUMS-files.txt"),
  "site_bytes": $(du -sb "$OUT/site" | cut -f1),
  "archive_bytes": $(stat -c %s "$OUT/$ARCHIVE"),
  "build_seconds": $(( $(date +%s) - START )),
  "commands": "STATIC_EXPORT=true LAYERLING_BUILD_ID=<commit9> ops/hundchen/build-static.sh (copy-occt-wasm, build-japanese-typeface, build-guide, next build apps/web, verify-static-worker-assets, generate-service-worker)"
}
EOF
echo "DONE  $ARCHIVE  sha256=$SHA  ($(( $(date +%s) - START )) s)"
