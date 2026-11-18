#!/usr/bin/env bash
# Publish an extra mDNS A record (NAME.local -> this host's primary IPv4) through the local avahi-daemon,
# and re-publish when the address changes. Runs as a user unit; needs avahi-utils (avahi-publish).
#   bash mdns-alias.sh hundchenweather.local
set -euo pipefail
name="${1:?usage: mdns-alias.sh NAME.local}"
current_ip() { ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="src") {print $(i+1); exit}}'; }
pub=""
cleanup() { [ -z "$pub" ] || kill "$pub" 2>/dev/null || true; }
trap cleanup EXIT TERM INT
ip=""
while :; do
  now="$(current_ip || true)"
  if [ -n "$now" ] && { [ "$now" != "$ip" ] || ! kill -0 "$pub" 2>/dev/null; }; then
    cleanup; ip="$now"
    avahi-publish -a -R "$name" "$ip" &
    pub=$!
    echo "mdns-alias: $name -> $ip"
  fi
  sleep 15
done
