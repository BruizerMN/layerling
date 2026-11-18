#!/usr/bin/env bash
# NO sudo. Point the service at another built release and restart: rollback.sh <commit-dir-name>
set -euo pipefail
R="$HOME/bin/layerling-releases/${1:?usage: rollback.sh <release dir name>}"
test -f "$R/apps/web/server.js" || { echo "not a release: $R"; exit 1; }
ln -sfn "$R" "$HOME/bin/layerling-releases/current"
systemctl --user restart layerling.service
echo "now serving: $(cat "$R/RELEASE.txt")"
