/** Small in-memory sliding-window limiter for sensitive endpoints. */
type Bucket = { count: number; resetAt: number };

export function createRateLimiter(name: string, defaultMax: number, windowMs = 60_000) {
  const buckets = new Map<string, Bucket>();
  return {
    check(key: string, max = defaultMax): { allowed: boolean; retryAfterSec: number; remaining: number } {
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
    },
    reset(key: string) { buckets.delete(`${name}:${key}`); },
  };
}
