#!/usr/bin/env bash
set -euo pipefail
cd /home/server/izandesk
pnpm --filter @izandesk/shared-types build
pnpm --filter api build
pnpm --filter web build
pkill -f "apps/api/dist/main.js" || true
pkill -f "next start -p 3000" || true
pkill -f "next dev -p 3000" || true
sleep 2
nohup pnpm --filter api start > /tmp/izandesk-api.log 2>&1 &
nohup pnpm --filter web start > /tmp/izandesk-web.log 2>&1 &
echo "started"
