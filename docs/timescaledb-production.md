# TimescaleDB in production

IzanDesk stores router, subscriber-session, and ONU optical samples in three
append-only tables:

| Table | Sample source | Retention setting |
| --- | --- | --- |
| `router_telemetry_history` | network collector / router polls | `network.telemetry_retention_days` (default 30) |
| `subscriber_session_history` | PPPoE/RADIUS session snapshots | same |
| `onu_optical_history` | OLT/ONU optical polls | same |

The tables work on plain PostgreSQL, but on TimescaleDB they become
hypertables automatically. This document covers the production setup, the
upgrade path for an existing database, and the operational checks.

## How the application enables hypertables

`apps/api/migrations/002_telemetry_history.sql` creates the tables and then runs:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('router_telemetry_history', 'recorded_at', if_not_exists => TRUE, migrate_data => TRUE);
    PERFORM create_hypertable('subscriber_session_history', 'recorded_at', if_not_exists => TRUE, migrate_data => TRUE);
    PERFORM create_hypertable('onu_optical_history', 'recorded_at', if_not_exists => TRUE, migrate_data => TRUE);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
```

Consequences:

- If the extension is installed **before** migration `002` runs, all three
  tables are converted to hypertables.
- If the extension is missing, the tables stay ordinary PostgreSQL tables and
  the migration succeeds. Nothing breaks.
- The migration is recorded in `schema_migrations`, so installing TimescaleDB
  later does **not** re-run it. Use the manual upgrade SQL below.
- `EXCEPTION WHEN OTHERS THEN NULL` makes the migration tolerant of older
  TimescaleDB versions or restricted managed-service roles. Check the result
  explicitly after deploying (see [Verification](#verification)).

## Option A: TimescaleDB HA image (recommended)

The `timescale/timescaledb-ha` image includes PostgreSQL, TimescaleDB, and
PostGIS in one container. Replace the `postgres` service in
`docker/docker-compose.yml`:

```yaml
services:
  postgres:
    image: timescale/timescaledb-ha:pg16
    container_name: izandesk-postgres
    restart: always
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-izandesk}
      POSTGRES_USER: ${POSTGRES_USER:-izandesk_user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-izandesk_secret_password}
    command:
      - postgres
      - -c
      - shared_preload_libraries=timescaledb
      - -c
      - timescaledb.telemetry_level=off
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      # The HA image keeps PGDATA under /home/postgres/pgdata/data.
      - pgdata:/home/postgres/pgdata/data
      - ../backups:/backups
```

Notes:

- `shared_preload_libraries=timescaledb` must be set at server start. The HA
  image normally does this for you; the explicit `command` makes the
  requirement visible and survives image changes.
- `timescaledb.telemetry_level=off` disables Timescale's usage telemetry.
- Keep the existing `pgdata` volume name. A PostgreSQL 16 data directory is
  compatible; switching images does not require a dump/restore.
- If you already run PostgreSQL 15 or older, do not point the new image at the
  old data directory. Dump and restore into the PG16 container instead.

## Option B: keep the PostGIS image and install TimescaleDB

If your platform requires the existing `postgis/postgis:16-3.4` base image,
build a small derivative that installs the TimescaleDB package from the
Timescale apt repository:

```dockerfile
FROM postgis/postgis:16-3.4

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gnupg postgresql-common apt-transport-https lsb-release wget \
 && echo "deb https://packagecloud.io/timescale/timescaledb/debian/ $(lsb_release -c -s) main" \
      > /etc/apt/sources.list.d/timescaledb.list \
 && wget --quiet -O - https://packagecloud.io/timescale/timescaledb/gpgkey \
      | gpg --dearmor -o /etc/apt/trusted.gpg.d/timescaledb.gpg \
 && apt-get update \
 && apt-get install -y --no-install-recommends timescaledb-2-postgresql-16 \
 && rm -rf /var/lib/apt/lists/*

# Preload TimescaleDB. Appending to the sample config is enough because the
# official image copies it into PGDATA on first initialization.
RUN echo "shared_preload_libraries = 'timescaledb'" \
      >> /usr/share/postgresql/postgresql.conf.sample
```

Then build and use that image in `docker/docker-compose.yml`. For an existing
`PGDATA` volume, run `ALTER SYSTEM SET shared_preload_libraries = 'timescaledb';`
and restart PostgreSQL before creating the extension.

## Enable the extension

Run once per database, after PostgreSQL has restarted with the preload setting:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

Then either:

1. Start the API with `MIGRATE_ON_START=true` on a fresh database so migration
   `002` sees the extension, or
2. Convert existing tables manually (see below).

### Manual upgrade for an existing database

If `002_telemetry_history.sql` is already recorded as applied, convert the
tables yourself. `create_hypertable` takes an exclusive lock while it moves
existing rows, so run it during a maintenance window:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable('router_telemetry_history', 'recorded_at',
                         if_not_exists => TRUE, migrate_data => TRUE);
SELECT create_hypertable('subscriber_session_history', 'recorded_at',
                         if_not_exists => TRUE, migrate_data => TRUE);
SELECT create_hypertable('onu_optical_history', 'recorded_at',
                         if_not_exists => TRUE, migrate_data => TRUE);
```

If a table is very large, prefer `migrate_data => FALSE` and backfill into a
new hypertable instead of holding the lock for the whole conversion.

## Verification

Check the extension, the hypertables, and the chunk layout:

```sql
-- Extension installed and preloaded?
SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';
SHOW shared_preload_libraries;

-- Which tables are hypertables?
SELECT hypertable_schema, hypertable_name, num_dimensions
FROM timescaledb_information.hypertables
WHERE hypertable_name IN (
  'router_telemetry_history',
  'subscriber_session_history',
  'onu_optical_history'
);

-- Chunk sizes (helps tune chunk_time_interval)
SELECT hypertable_name, COUNT(*) AS chunks,
       pg_size_pretty(SUM(total_bytes)) AS total_size
FROM timescaledb_information.chunks
GROUP BY hypertable_name
ORDER BY hypertable_name;
```

A healthy deployment returns one row per table from the hypertables query.

The API also exposes the migration status to admins:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://your-host/api/system/migrations
```

## Retention and compression

IzanDesk already prunes telemetry in the daily maintenance sweep using
`network.telemetry_retention_days` (default 30). You can keep that application
job or move retention into TimescaleDB. A database policy is cheaper because it
drops whole chunks instead of deleting rows:

```sql
SELECT add_retention_policy('router_telemetry_history', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('subscriber_session_history', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('onu_optical_history', INTERVAL '180 days', if_not_exists => TRUE);
```

If you enable database policies, raise `network.telemetry_retention_days` (or
leave the application sweep enabled) so the two do not fight. Policies can be
inspected and removed with:

```sql
SELECT * FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention';
SELECT remove_retention_policy('router_telemetry_history', if_exists => TRUE);
```

Optional compression (TimescaleDB community feature; check your license):

```sql
ALTER TABLE router_telemetry_history SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'router_id',
  timescaledb.compress_orderby = 'recorded_at DESC'
);
SELECT add_compression_policy('router_telemetry_history', INTERVAL '7 days', if_not_exists => TRUE);
```

Repeat for the other two tables, using `onu_id` / `subscriber_id` as the
segment key. Compressed chunks are still queryable by the existing telemetry
endpoints; no application change is required.

## Backups and restores

- `pg_dump` works with TimescaleDB, but a logical dump of hypertables can be
  slow. Use `pg_dump -Fc` and test the restore on a staging database.
- For large deployments, prefer physical backups (`pg_basebackup` or your
  managed provider's snapshot) so chunks and policies are preserved.
- `pg_dump`/`pg_restore` do not recreate TimescaleDB background jobs. Re-run
  the `add_retention_policy` / `add_compression_policy` statements after a
  logical restore.
- The existing `POST /api/system/backups/run` endpoint uses `pg_dump`; it is
  suitable for small and medium installations. For multi-hundred-GB telemetry
  stores, schedule provider snapshots instead.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `extension "timescaledb" is not available` | Package missing or wrong PostgreSQL major version | Install the matching `timescaledb-2-postgresql-16` package. |
| `could not access file "timescaledb"` | Library present but not preloaded | `ALTER SYSTEM SET shared_preload_libraries = 'timescaledb';` then restart PostgreSQL. |
| Tables are still plain tables | Migration `002` ran before the extension was installed | Run the manual `create_hypertable` statements. |
| `table ... is already a hypertable` | Conversion ran twice | Use `if_not_exists => TRUE`; this is harmless. |
| `unique constraint must include all partitioning columns` | A unique index does not include `recorded_at` | Add `recorded_at` to the index, or drop the index if it is not needed. |
| Retention deletes rows slowly | Application sweep is deleting row by row | Add a Timescale retention policy and raise the application retention window. |
| `permission denied to create extension` | Managed service restricts extensions | Enable TimescaleDB from the provider console, or use a provider that supports it. |

## Managed PostgreSQL

Most managed services expose TimescaleDB as an optional extension. The flow is
the same: enable the extension in the provider console (or run
`CREATE EXTENSION timescaledb;` with a role that is allowed to), then run the
manual conversion SQL if migration `002` was already applied. Do not attempt to
set `shared_preload_libraries` yourself on a managed service; the provider does
it when the extension is enabled.
