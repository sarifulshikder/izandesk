/** Server-side staff sessions: JWTs carry a jti that can be revoked. */
import crypto = require('crypto');
import { pool } from '../db';

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
  await pool.query(
    `INSERT INTO auth_sessions(id, user_id, ip_address, user_agent, expires_at)
     VALUES($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)`,
    [input.id, input.userId, input.ip || null, input.userAgent || null, String(Math.max(5, input.minutes))],
  );
}

/** Fail closed: no database means no verifiable server-side session. */
export async function sessionActive(id: string): Promise<boolean> {
  if (!id) return false;
  try {
    const r = await pool.query(
      `SELECT 1 FROM auth_sessions
       WHERE id=$1 AND revoked_at IS NULL AND expires_at > now()`,
      [id],
    );
    return r.rowCount > 0;
  } catch { return false; }
}

export async function touchSession(id: string): Promise<void> {
  try {
    await pool.query('UPDATE auth_sessions SET last_seen_at=now() WHERE id=$1 AND revoked_at IS NULL', [id]);
  } catch {}
}

export async function revokeSessions(ids: string[], userId?: string): Promise<number> {
  if (!ids.length) return 0;
  try {
    const r = await pool.query(
      `UPDATE auth_sessions SET revoked_at=now()
       WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL
       AND ($2::text IS NULL OR user_id=$2)`,
      [ids, userId || null],
    );
    return r.rowCount || 0;
  } catch { return 0; }
}

export async function revokeAllSessions(userId: string, exceptId?: string): Promise<number> {
  try {
    const r = await pool.query(
      `UPDATE auth_sessions SET revoked_at=now()
       WHERE user_id=$1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
      [userId, exceptId || null],
    );
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
