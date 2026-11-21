#!/bin/bash
set -euo pipefail

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
POSTGRES_DB="${POSTGRES_DB:-izandesk}"
POSTGRES_USER="${POSTGRES_USER:-izandesk_user}"
# The API security bootstrap validates DB_PASSWORD; keep one source of truth.
export DB_PASSWORD="$POSTGRES_PASSWORD"

if [[ ! "$POSTGRES_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "[postgres] unsupported POSTGRES_USER value" >&2
  exit 1
fi
if [[ ! "$POSTGRES_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "[postgres] unsupported POSTGRES_DB value" >&2
  exit 1
fi
if [[ "$POSTGRES_PASSWORD" =~ [^A-Za-z0-9_@.+-] ]]; then
  echo "[postgres] unsupported characters in POSTGRES_PASSWORD" >&2
  exit 1
fi

mkdir -p /data/postgres /data/redis /data/uploads /var/run/postgresql
chmod 700 /data/postgres
chown -R postgres:postgres /data/postgres /var/run/postgresql
chown -R redis:redis /data/redis

if [ ! -s /data/postgres/PG_VERSION ]; then
  echo "[initdb] creating PostgreSQL data directory"
  su-exec postgres initdb -D /data/postgres \
    --auth-local=trust --auth-host=scram-sha-256 \
    --encoding=UTF8 --locale=C
fi

echo "[postgres] starting"
su-exec postgres pg_ctl -D /data/postgres -w -o \
  "-c listen_addresses=127.0.0.1 \
   -c unix_socket_directories=/var/run/postgresql \
   -c shared_buffers=16MB \
   -c max_connections=30 \
   -c work_mem=1MB \
   -c maintenance_work_mem=32MB \
   -c logging_collector=off" start

echo "[postgres] ensuring role and database"
if ! su-exec postgres psql -X -v ON_ERROR_STOP=1 -d postgres \
  -c "CREATE ROLE \"$POSTGRES_USER\" SUPERUSER LOGIN PASSWORD '$POSTGRES_PASSWORD'" 2>/dev/null; then
  su-exec postgres psql -X -v ON_ERROR_STOP=1 -d postgres \
    -c "ALTER ROLE \"$POSTGRES_USER\" WITH SUPERUSER LOGIN PASSWORD '$POSTGRES_PASSWORD'"
fi
if ! su-exec postgres psql -X -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$POSTGRES_DB'" | grep -q 1; then
  su-exec postgres psql -X -v ON_ERROR_STOP=1 -d postgres \
    -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""
fi

until su-exec postgres pg_isready -h 127.0.0.1 -p 5432 -q; do sleep 0.5; done

echo "[redis] starting"
su-exec redis redis-server \
  --bind 127.0.0.1 --port 6379 \
  --dir /data/redis --appendonly yes \
  --save 900 1 --maxmemory 64mb --maxmemory-policy allkeys-lru \
  --daemonize yes
until redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; do sleep 0.5; done

echo "[izandesk] starting API and web"
cd /app/api
node dist/main.js &
API_PID=$!
cd /app/web
node apps/web/server.js &
WEB_PID=$!

SHUTTING_DOWN=0
cleanup() {
  if [ "$SHUTTING_DOWN" -eq 1 ]; then return; fi
  SHUTTING_DOWN=1
  trap - TERM INT
  kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  wait "$WEB_PID" 2>/dev/null || true
  redis-cli -h 127.0.0.1 -p 6379 shutdown nosave 2>/dev/null || true
  su-exec postgres pg_ctl -D /data/postgres -m fast -w stop 2>/dev/null || true
}
trap cleanup TERM INT

set +e
wait -n "$API_PID" "$WEB_PID"
STATUS=$?
set -e
cleanup
exit "$STATUS"
