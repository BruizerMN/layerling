#!/usr/bin/env bash
# NO sudo. Creates the TLS cert (VM-local mkcert CA), installs + starts the two user units.
# Run only after the release symlink exists: ~/bin/layerling-releases/current -> <commit>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CERTS="$HOME/.local/share/layerling/certs"
mkdir -p "$CERTS" "$HOME/.config/systemd/user"
if [ ! -f "$CERTS/layerling.local.pem" ]; then
  (cd "$CERTS" && mkcert -cert-file layerling.local.pem -key-file layerling.local-key.pem layerling.local)
  chmod 600 "$CERTS/layerling.local-key.pem"
fi
test -L "$HOME/bin/layerling-releases/current" || { echo "no current release symlink"; exit 1; }
cp "$HERE/layerling.service" "$HERE/layerling-mdns.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now layerling-mdns.service layerling.service
