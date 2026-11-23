import * as path from 'path';

/**
 * Runtime profile shared by the API services.
 *
 * IZAN_LITE=true keeps the full image/schema (so a database can be moved
 * between full and lite builds without migration) but turns off the services
 * that are expensive on small RouterOS boxes: Redis, plugin hot-reload,
 * scheduled backups and per-page router telemetry polling.
 */
export const LITE_MODE = String(process.env.IZAN_LITE || '').toLowerCase() === 'true';

const numEnv = (name: string, def: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

/** Reuse router telemetry for this long. Default: 30s normal, 45s lite. */
export const TELEMETRY_TTL_MS = LITE_MODE
  ? numEnv('ROUTER_TELEMETRY_TTL_MS', 45_000)
  : numEnv('ROUTER_TELEMETRY_TTL_MS', 30_000);

/** Background collector intervals (ms). Set 0 to disable a collector. */
export const SESSIONS_COLLECTOR_MS = LITE_MODE
  ? numEnv('SESSIONS_COLLECTOR_MS', 60_000)
  : numEnv('SESSIONS_COLLECTOR_MS', 30_000);
export const TELEMETRY_COLLECTOR_MS = LITE_MODE
  ? numEnv('TELEMETRY_COLLECTOR_MS', 60_000)
  : numEnv('TELEMETRY_COLLECTOR_MS', 60_000);

/**
 * Directory holding the WireGuard hub config. Disposable stacks must override
 * this with a stack-local path; the default is the shared compose config dir.
 */
export const WG_CONFIG_DIR = process.env.WG_CONFIG_DIR
  || path.resolve(__dirname, '../../../../docker/wg-hub/config');
