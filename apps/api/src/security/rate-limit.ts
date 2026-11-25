/**
 * Sliding/fixed-window rate limiter with Redis backing and automatic
 * in-memory fallback when Redis is unavailable or disabled (LITE_MODE / tests).
 */
import { redisDel, redisIncrWindow } from '../infra/redis';

type Bucket = { count: number; resetAt: number };

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
};

export function createRateLimiter(name: string, defaultMax: number, windowMs = 60_000) {
  const buckets = new Map<string, Bucket>();

  function checkLocal(key: string, max = defaultMax): RateLimitResult {
    const now = Date.now();
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    const bucketKey = `${name}:${key}`;
    const current = buckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      buckets.set(bucketKey, fresh);
      return { allowed: true, retryAfterSec: 0, remaining: Math.max(0, max - 1) };
    }
    current.count += 1;
    const allowed = current.count <= max;
    return {
      allowed,
      retryAfterSec: allowed ? 0 : Math.ceil((current.resetAt - now) / 1000),
      remaining: Math.max(0, max - current.count),
    };
  }

  return {
    check: checkLocal,
    async checkDistributed(key: string, max = defaultMax): Promise<RateLimitResult> {
      const redisRes = await redisIncrWindow(`iz:rl:${name}:${key}`, windowMs);
      if (!redisRes) return checkLocal(key, max);
      const allowed = redisRes.count <= max;
      return {
        allowed,
        retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil(redisRes.ttlMs / 1000)),
        remaining: Math.max(0, max - redisRes.count),
      };
    },
    reset(key: string) {
      buckets.delete(`${name}:${key}`);
      void redisDel(`iz:rl:${name}:${key}`);
    },
  };
}
