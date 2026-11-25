/**
 * Shared Redis client, cache, distributed counters and Pub/Sub helpers.
 *
 * Lazy-initialized during API bootstrap (`initRedis`) so unit tests and
 * `IZAN_LITE=true` deployments never hang or fail when Redis is disabled.
 */
import { createClient } from 'redis';
import { LITE_MODE } from '../config/runtime';
import { logger } from './logger';

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let subClient: RedisClient | null = null;
let ready = false;
let initAttempted = false;
let warnedUnavailable = false;
const listeners = new Map<string, Set<(msg: string) => void>>();

export function getRedisConfig() {
  const url = String(process.env.REDIS_URL || '').trim();
  const host = String(process.env.REDIS_HOST || '127.0.0.1').trim();
  const port = Number(process.env.REDIS_PORT || 6379) || 6379;
  const password = process.env.REDIS_PASSWORD || undefined;
  const db = Number(process.env.REDIS_DB || 0) || 0;
  return { url, host, port, password, db };
}

export function isRedisEnabled(): boolean {
  if (LITE_MODE) return false;
  if (String(process.env.REDIS_DISABLED || '').toLowerCase() === 'true') return false;
  return true;
}

export function isRedisReady(): boolean {
  return !!(ready && client?.isOpen);
}

function makeClient(): RedisClient {
  const cfg = getRedisConfig();
  if (cfg.url) {
    return createClient({
      url: cfg.url,
      socket: {
        connectTimeout: 2500,
        reconnectStrategy: (retries) => Math.min(retries * 500, 15_000),
      },
    });
  }
  return createClient({
    socket: {
      host: cfg.host,
      port: cfg.port,
      connectTimeout: 2500,
      reconnectStrategy: (retries) => Math.min(retries * 500, 15_000),
    },
    ...(cfg.password ? { password: cfg.password } : {}),
    ...(cfg.db ? { database: cfg.db } : {}),
  });
}

export async function initRedis(): Promise<boolean> {
  if (!isRedisEnabled()) {
    logger.info('[Redis] disabled (LITE_MODE or REDIS_DISABLED)');
    return false;
  }
  if (isRedisReady()) return true;
  if (initAttempted && client) return isRedisReady();
  initAttempted = true;

  try {
    client = makeClient();
    client.on('ready', () => {
      ready = true;
      warnedUnavailable = false;
    });
    client.on('end', () => {
      ready = false;
    });
    client.on('error', (err) => {
      ready = false;
      if (!warnedUnavailable) {
        warnedUnavailable = true;
        logger.warn({ err: err?.message || String(err) }, '[Redis] connection error (falling back to in-memory/DB)');
      }
    });

    await Promise.race([
      client.connect(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Redis connect timeout')), 3000)),
    ]);
    await client.ping();
    ready = true;
    logger.info({ host: getRedisConfig().host, port: getRedisConfig().port }, '[Redis] connected and ready');
    return true;
  } catch (e: any) {
    ready = false;
    logger.warn({ err: e?.message || String(e) }, '[Redis] unavailable at boot; using local fallback');
    return false;
  }
}

async function ensureSubscriber(): Promise<RedisClient | null> {
  if (!isRedisEnabled() || !client) return null;
  if (subClient?.isOpen) return subClient;
  try {
    subClient = client.duplicate();
    subClient.on('error', (err) => {
      logger.debug({ err: err?.message || String(err) }, '[Redis] subscriber error');
    });
    await subClient.connect();
    return subClient;
  } catch {
    subClient = null;
    return null;
  }
}

export async function redisGetJson<T = any>(key: string): Promise<T | null> {
  if (!isRedisReady() || !client) return null;
  try {
    const raw = await client.get(key);
    if (raw == null) return null;
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

export async function redisSetJson(key: string, value: any, ttlSec?: number): Promise<boolean> {
  if (!isRedisReady() || !client) return false;
  try {
    const body = JSON.stringify(value);
    if (ttlSec && ttlSec > 0) await client.set(key, body, { EX: Math.max(1, Math.ceil(ttlSec)) });
    else await client.set(key, body);
    return true;
  } catch {
    return false;
  }
}

export async function redisDel(...keys: string[]): Promise<void> {
  const flat = keys.filter(Boolean);
  if (!flat.length || !isRedisReady() || !client) return;
  try {
    await client.del(flat);
  } catch { /* ignore */ }
}

export async function redisSetNxEx(key: string, value: string, ttlSec: number): Promise<boolean> {
  if (!isRedisReady() || !client) return false;
  try {
    const res = await client.set(key, value, { NX: true, EX: Math.max(1, Math.ceil(ttlSec)) });
    return res === 'OK';
  } catch {
    return false;
  }
}

/** Atomic fixed-window counter in Redis; returns null when Redis is unavailable. */
export async function redisIncrWindow(key: string, windowMs: number): Promise<{ count: number; ttlMs: number } | null> {
  if (!isRedisReady() || !client) return null;
  try {
    const count = Number(await client.incr(key));
    if (count === 1) await client.pExpire(key, Math.max(1000, windowMs));
    const ttlMs = Number(await client.pTTL(key));
    return { count, ttlMs: ttlMs > 0 ? ttlMs : windowMs };
  } catch {
    return null;
  }
}

export async function redisGetCounter(key: string): Promise<{ count: number; ttlMs: number } | null> {
  if (!isRedisReady() || !client) return null;
  try {
    const [val, ttl] = await Promise.all([client.get(key), client.pTTL(key)]);
    if (val == null) return null;
    const ttlMs = Number(ttl);
    return { count: Number(val) || 0, ttlMs: ttlMs > 0 ? ttlMs : 0 };
  } catch {
    return null;
  }
}

export async function redisPublish(channel: string, payload: any): Promise<boolean> {
  if (!isRedisReady() || !client) return false;
  try {
    const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await client.publish(channel, msg);
    return true;
  } catch {
    return false;
  }
}

export async function redisSubscribe(channel: string, handler: (msg: string) => void): Promise<() => void> {
  let set = listeners.get(channel);
  const isFirst = !set;
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(handler);

  if (isFirst) {
    const sub = await ensureSubscriber();
    if (sub) {
      await sub.subscribe(channel, (msg) => {
        for (const fn of listeners.get(channel) || []) {
          try { fn(msg); } catch { /* listener error isolated */ }
        }
      }).catch(() => {});
    }
  }

  return () => {
    listeners.get(channel)?.delete(handler);
  };
}

export async function closeRedis(): Promise<void> {
  ready = false;
  try { if (subClient?.isOpen) await subClient.quit(); } catch { /* ignore */ }
  try { if (client?.isOpen) await client.quit(); } catch { /* ignore */ }
  subClient = null;
  client = null;
}
