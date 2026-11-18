#!/usr/bin/env bash
# NO sudo. Build the current commit of ~/bin/layerling into an immutable release folder.
# Does NOT switch the live service; afterwards run:  ops/hundchen/rollback.sh <printed release name>
# (rollback.sh is also the "go live" command.) Run typecheck/tests/perf first (see DEPLOY.md).
set -euo pipefail
export PATH="$HOME/bin/layerling-node/current/bin:$PATH" NEXT_TELEMETRY_DISABLED=1
cd "$HOME/bin/layerling"
[ -z "$(git status --porcelain)" ] || { echo "Working tree not clean - commit first."; exit 1; }
C="$(git rev-parse --short=9 HEAD)"; R="$HOME/bin/layerling-releases/$C"
[ ! -e "$R" ] || { echo "Release $C already exists."; exit 1; }
NODE_ENV=production LAYERLING_STANDALONE=true npm run build
mkdir -p "$R" "$HOME/layerling-data/codex/project-thumbnails"
cp -a apps/web/.next/standalone/. "$R/"
cp -a apps/web/.next/static "$R/apps/web/.next/static"
cp -a apps/web/public "$R/apps/web/public"
rm -rf "$R/node_modules/sharp" "$R/node_modules/@img" "$R/node_modules/typescript" "$R/apps/web/src" \
       "$R"/apps/web/.next/static/media/occt-wasm.*.wasm "$R/.codex" "$R/apps/web/.codex"
ln -s "$HOME/layerling-data/codex" "$R/apps/web/.codex"
echo "$C $(git rev-parse HEAD) $(grep -m1 "\"version\"" package.json | tr -d " \",")+HundchenLayerling" > "$R/RELEASE.txt"
echo "Built release: $C   (not live yet)  ->  ops/hundchen/rollback.sh $C"
