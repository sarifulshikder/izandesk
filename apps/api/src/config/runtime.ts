/**
 * Runtime profile shared by the API services.
 *
 * IZAN_LITE=true keeps the full image/schema (so a database can be moved
 * between full and lite builds without migration) but turns off the services
 * that are expensive on small RouterOS boxes: Redis, plugin hot-reload,
 * scheduled backups and per-page router telemetry polling.
 */
export const LITE_MODE = String(process.env.IZAN_LITE || '').toLowerCase() === 'true';

/** Reuse router telemetry for this long in lite mode (0 = always live). */
export const TELEMETRY_TTL_MS = LITE_MODE ? 45_000 : 0;
