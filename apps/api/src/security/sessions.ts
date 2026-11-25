/**
 * Server-side staff sessions: JWTs carry a jti that can be revoked.
 * Backed by PostgreSQL `auth_sessions` with Redis hot-path caching and
 * debounced `last_seen_at` updates to avoid per-request DB write pressure.
 */
import crypto = require('crypto');
import { pool } from '../db';
import { isRedisReady, redisDel, redisGetJson, redisSetJson, redisSetNxEx } from '../infra/redis';

export type StaffSession = {
  id: string;
  user_id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
};

const SESS_KEY = (id: string) => `iz:auth:sess:${id}`;
const TOUCH_KEY = (id: string) => `iz:auth:touch:${id}`;
const localTouches = new Map<string, number>();

export function newSessionId(): string {
  return crypto.randomUUID();
}

export async function createSession(input: {
  id: string;
  userId: string;
  minutes: number;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  const mins = Math.max(5, input.minutes);
  await pool.query(
    `INSERT INTO auth_sessions(id, user_id, ip_address, user_agent, expires_at)
     VALUES($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)`,
    [input.id, input.userId, input.ip || null, input.userAgent || null, String(mins)],
  );
  await redisSetJson(SESS_KEY(input.id), { userId: input.userId, exp: Date.now() + mins * 60_000 }, mins * 60);
}

/** Fail closed: no database (and no active cache) means no verifiable server-side session. */
export async function sessionActive(id: string): Promise<boolean> {
  if (!id) return false;
  const cached = await redisGetJson<{ userId: string; exp: number }>(SESS_KEY(id));
  if (cached && Number(cached.exp || 0) > Date.now()) {
    return true;
  }
  try {
    const r = await pool.query(
      `SELECT user_id, EXTRACT(EPOCH FROM (expires_at - now()))::int AS ttl_sec
       FROM auth_sessions
       WHERE id=$1 AND revoked_at IS NULL AND expires_at > now()`,
      [id],
    );
    if (r.rowCount > 0) {
      const ttl = Math.max(5, Math.min(86_400, Number(r.rows[0]?.ttl_sec || 300)));
      await redisSetJson(SESS_KEY(id), { userId: r.rows[0].user_id, exp: Date.now() + ttl * 1000 }, ttl);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function touchSession(id: string): Promise<void> {
  if (!id) return;
  try {
    if (isRedisReady()) {
      const acquired = await redisSetNxEx(TOUCH_KEY(id), '1', 60);
      if (!acquired) return;
    } else {
      const now = Date.now();
      const prev = localTouches.get(id) || 0;
      if (now - prev < 60_000) return;
      if (localTouches.size > 5000) localTouches.clear();
      localTouches.set(id, now);
    }
    await pool.query('UPDATE auth_sessions SET last_seen_at=now() WHERE id=$1 AND revoked_at IS NULL', [id]);
  } catch { /* ignore */ }
}

export async function revokeSessions(ids: string[], userId?: string): Promise<number> {
  if (!ids.length) return 0;
  try {
    const r = await pool.query(
      `UPDATE auth_sessions SET revoked_at=now()
       WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL
       AND ($2::text IS NULL OR user_id=$2)
       RETURNING id`,
      [ids, userId || null],
    );
    await redisDel(...ids.map(SESS_KEY), ...ids.map(TOUCH_KEY));
    return r.rowCount || 0;
  } catch { return 0; }
}

export async function revokeAllSessions(userId: string, exceptId?: string): Promise<number> {
  try {
    const r = await pool.query(
      `UPDATE auth_sessions SET revoked_at=now()
       WHERE user_id=$1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)
       RETURNING id`,
      [userId, exceptId || null],
    );
    const revokedIds = (r.rows || []).map((row: any) => String(row.id)).filter(Boolean);
    if (revokedIds.length) {
      await redisDel(...revokedIds.map(SESS_KEY), ...revokedIds.map(TOUCH_KEY));
    }
    return r.rowCount || 0;
  } catch { return 0; }
}

export async function listSessions(userId: string, all = false): Promise<StaffSession[]> {
  try {
    const r = await pool.query(
      `SELECT id, user_id, user_agent, ip_address, created_at, last_seen_at, expires_at, revoked_at
       FROM auth_sessions
       WHERE ($2::boolean OR user_id=$1) AND expires_at > now()
       ORDER BY created_at DESC LIMIT 200`,
      [userId, all],
    );
    return r.rows;
  } catch { return []; }
}

export async function findSession(id: string): Promise<StaffSession | null> {
  try {
    const r = await pool.query(
      `SELECT id, user_id, user_agent, ip_address, created_at, last_seen_at, expires_at, revoked_at
       FROM auth_sessions WHERE id=$1`,
      [id],
    );
    return r.rows[0] || null;
  } catch { return null; }
}
