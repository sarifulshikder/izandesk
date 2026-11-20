#!/usr/bin/env bash
set -e

echo "Starting IzanDesk ERP Development Environment..."
cd "$(dirname "$0")/.."

# When the API runs on the host (not in the dev compose container), add routes for the
# WireGuard overlay via the wg-hub container — the compose dev override does this inside
# the api container, but host-run dev needs it on the host or WG-dialed routers/OLTs time out.
if command -v docker >/dev/null 2>&1 && docker inspect izandesk-wg-hub >/dev/null 2>&1; then
  GW=$(docker inspect izandesk-wg-hub --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || true)
  if [ -n "$GW" ]; then
    docker run --rm --network host --cap-add NET_ADMIN alpine:3 sh -c \
      "apk add --no-cache iproute2 >/dev/null 2>&1; ip route replace 10.77.0.0/16 via $GW 2>/dev/null; ip route replace 10.5.0.0/24 via $GW 2>/dev/null" >/dev/null 2>&1 || true
    echo "WG overlay routes via $GW added (10.77.0.0/16, 10.5.0.0/24)"
  fi
fi

pnpm --filter web dev
