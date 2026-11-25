/**
 * Database-backed staff users & RBAC directory (`staff_users` table).
 *
 * Replaces the legacy hardcoded in-memory user list while preserving demo
 * accounts (when DISABLE_DEMO_ACCOUNTS != true), BOOTSTRAP_ADMIN_* seeding,
 * and legacy `security.password_overrides` migration.
 */
import bcrypt = require('bcrypt');
import crypto = require('crypto');
import type { UserRole, UserSession } from '@izandesk/shared-types';
import { pool } from '../db';
import { enabled as envFlag } from '../security/guards';
import { getSetting } from './settings';
import { redisDel, redisGetJson, redisSetJson } from '../infra/redis';
import { logger } from '../infra/logger';

export interface StaffUserRecord extends UserSession {
  password_hash: string;
  branchId?: string | null;
  is_active: boolean;
  must_change_password?: boolean;
  last_login_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

const DEMO_USERS: Array<{
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  tenantId: string;
  resellerId?: string;
  permissions: string[];
  avatarUrl?: string;
}> = [
  { id: 'usr-admin-01', name: 'Izan Rahman (CEO)', email: 'admin@izandesk.com', password: 'admin123', role: 'SUPER_ADMIN', tenantId: 'tnt-primary-01', permissions: ['ALL'], avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80' },
  { id: 'usr-noc-02', name: 'Tariqul Islam (NOC Lead)', email: 'noc@izandesk.com', password: 'noc123', role: 'NOC_ENGINEER', tenantId: 'tnt-primary-01', permissions: ['ROUTERS_READ', 'ROUTERS_WRITE', 'OLT_READ', 'SUBSCRIBERS_KICK'], avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80' },
  { id: 'usr-bill-03', name: 'Sadia Akhter (Accounts)', email: 'billing@izandesk.com', password: 'billing123', role: 'BILLING_OPERATOR', tenantId: 'tnt-primary-01', permissions: ['INVOICES_READ', 'PAYMENTS_CREATE', 'BILLS_ADJUST'], avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80' },
  { id: 'usr-tech-04', name: 'Kamrul Hasan (Field Lead)', email: 'tech@izandesk.com', password: 'tech123', role: 'TECHNICIAN', tenantId: 'tnt-primary-01', permissions: ['TICKETS_ASSIGNED', 'OPTICAL_READ', 'CLIENTS_READ'], avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80' },
  { id: 'usr-reseller-05', name: 'Shahriar Kabir (CyberNet Reseller)', email: 'reseller@cybernet.bd', password: 'reseller123', role: 'RESELLER', tenantId: 'tnt-primary-01', resellerId: 'RES-CYBERNET', permissions: ['RESELLER_CLIENTS_ALL', 'WALLET_RECHARGE'], avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&auto=format&fit=crop&q=80' },
];

const DEMO_IDS = new Set(DEMO_USERS.map((u) => u.id));
const CACHE_KEY = (id: string) => `iz:staff:id:${id}`;
const localUserCache = new Map<string, { at: number; user: StaffUserRecord }>();
const LOCAL_TTL_MS = 15_000;

export function isDemoAccountsDisabled(): boolean {
  return envFlag(process.env.DISABLE_DEMO_ACCOUNTS);
}

function mapRow(r: any): StaffUserRecord | null {
  if (!r) return null;
  return {
    id: String(r.id),
    name: String(r.name || ''),
    email: String(r.email || ''),
    role: String(r.role) as UserRole,
    tenantId: String(r.tenant_id || 'tnt-primary-01'),
    resellerId: r.reseller_id ? String(r.reseller_id) : undefined,
    branchId: r.branch_id ? String(r.branch_id) : null,
    permissions: Array.isArray(r.permissions) ? r.permissions : [],
    avatarUrl: r.avatar_url || undefined,
    password_hash: String(r.password_hash || ''),
    is_active: r.is_active !== false,
    must_change_password: !!r.must_change_password,
    last_login_at: r.last_login_at || null,
    created_at: r.created_at || null,
    updated_at: r.updated_at || null,
  };
}

export function toUserSession(u: StaffUserRecord): UserSession {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    tenantId: u.tenantId,
    ...(u.resellerId ? { resellerId: u.resellerId } : {}),
    permissions: u.permissions || [],
    ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
  };
}

export async function invalidateStaffCache(userId?: string) {
  if (userId) {
    localUserCache.delete(userId);
    await redisDel(CACHE_KEY(userId));
  } else {
    localUserCache.clear();
  }
}

export async function verifyStaffPassword(user: StaffUserRecord | null | undefined, password: string): Promise<boolean> {
  if (!user || !user.password_hash || !password) return false;
  try {
    return await bcrypt.compare(password, user.password_hash);
  } catch {
    return false;
  }
}

/** Seed demo/bootstrap staff users into PostgreSQL and migrate legacy password overrides. */
export async function syncBootstrapStaffUsers(): Promise<void> {
  const demoDisabled = isDemoAccountsDisabled();
  const overrides = ((await getSetting('security.password_overrides', {})) || {}) as Record<string, string>;

  if (!demoDisabled) {
    for (const d of DEMO_USERS) {
      const existing = await pool.query('SELECT id, password_hash FROM staff_users WHERE id=$1', [d.id]);
      const overrideHash = overrides[d.id] ? String(overrides[d.id]) : '';
      if (existing.rowCount === 0) {
        const hash = overrideHash || await bcrypt.hash(d.password, 10);
        await pool.query(
          `INSERT INTO staff_users(id, name, email, password_hash, role, tenant_id, reseller_id, permissions, avatar_url, is_active)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,true)
           ON CONFLICT (id) DO NOTHING`,
          [d.id, d.name, d.email, hash, d.role, d.tenantId, d.resellerId || null, JSON.stringify(d.permissions), d.avatarUrl || null],
        );
      } else if (overrideHash && existing.rows[0]?.password_hash !== overrideHash) {
        await pool.query('UPDATE staff_users SET password_hash=$2, updated_at=now() WHERE id=$1', [d.id, overrideHash]);
      }
    }
  } else {
    const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
    const hash = String(process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH || '').trim();
    const plaintext = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
    if (!hash && !plaintext) {
      const activeAdmins = await pool.query(
        `SELECT COUNT(*)::int AS c FROM staff_users WHERE role='SUPER_ADMIN' AND is_active=true AND id <> ALL($1::text[])`,
        [Array.from(DEMO_IDS)],
      ).catch(() => ({ rows: [{ c: 0 }] }));
      if (!activeAdmins.rows[0]?.c) {
        logger.warn('[Auth] demo accounts disabled and no BOOTSTRAP_ADMIN_* or DB SUPER_ADMIN configured');
      }
      return;
    }
    if (!email) {
      throw new Error('BOOTSTRAP_ADMIN_EMAIL is required when a bootstrap admin password/hash is provided');
    }
    let passwordHash = hash;
    if (!passwordHash) passwordHash = await bcrypt.hash(plaintext, 12);
    if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) {
      throw new Error('BOOTSTRAP_ADMIN_PASSWORD_HASH must be a bcrypt hash ($2a$/$2b$/$2y$)');
    }
    const overrideHash = overrides['usr-bootstrap-admin'] ? String(overrides['usr-bootstrap-admin']) : '';
    const name = String(process.env.BOOTSTRAP_ADMIN_NAME || 'Administrator').trim() || 'Administrator';
    const existing = await pool.query('SELECT id FROM staff_users WHERE id=$1 OR lower(email)=$2', ['usr-bootstrap-admin', email]);
    if (existing.rowCount === 0) {
      await pool.query(
        `INSERT INTO staff_users(id, name, email, password_hash, role, tenant_id, permissions, is_active)
         VALUES($1,$2,$3,$4,'SUPER_ADMIN','tnt-primary-01','["ALL"]'::jsonb,true)
         ON CONFLICT (id) DO NOTHING`,
        ['usr-bootstrap-admin', name, email, overrideHash || passwordHash],
      );
      logger.info({ email }, '[Auth] bootstrap SUPER_ADMIN provisioned in staff_users');
    }
  }
  await invalidateStaffCache();
}

function allowedInCurrentProfile(user: StaffUserRecord | null): user is StaffUserRecord {
  if (!user || !user.is_active) return false;
  if (isDemoAccountsDisabled() && DEMO_IDS.has(user.id)) return false;
  return true;
}

export async function findStaffById(id: string): Promise<StaffUserRecord | null> {
  if (!id) return null;
  if (isDemoAccountsDisabled() && DEMO_IDS.has(id)) return null;

  const local = localUserCache.get(id);
  if (local && Date.now() - local.at < LOCAL_TTL_MS) {
    return allowedInCurrentProfile(local.user) ? local.user : null;
  }

  const cached = await redisGetJson<StaffUserRecord>(CACHE_KEY(id));
  if (cached) {
    localUserCache.set(id, { at: Date.now(), user: cached });
    return allowedInCurrentProfile(cached) ? cached : null;
  }

  try {
    const r = await pool.query('SELECT * FROM staff_users WHERE id=$1 LIMIT 1', [id]);
    const mapped = mapRow(r.rows[0]);
    if (mapped) {
      localUserCache.set(id, { at: Date.now(), user: mapped });
      await redisSetJson(CACHE_KEY(id), mapped, 60);
    }
    return allowedInCurrentProfile(mapped) ? mapped : null;
  } catch {
    return null;
  }
}

export async function findStaffByIdentifier(identifier: string): Promise<StaffUserRecord | null> {
  const ident = String(identifier || '').trim().toLowerCase();
  if (!ident) return null;
  try {
    const r = await pool.query(
      `SELECT * FROM staff_users
       WHERE is_active = true
         AND (lower(email) = $1 OR split_part(lower(email), '@', 1) = $1)
       ORDER BY created_at ASC`,
      [ident],
    );
    for (const row of r.rows) {
      const mapped = mapRow(row);
      if (allowedInCurrentProfile(mapped)) return mapped;
    }
    return null;
  } catch {
    return null;
  }
}

export async function findStaffByRole(role: string): Promise<StaffUserRecord | null> {
  try {
    const r = await pool.query(
      `SELECT * FROM staff_users WHERE role=$1 AND is_active=true ORDER BY created_at ASC`,
      [String(role || '')],
    );
    for (const row of r.rows) {
      const mapped = mapRow(row);
      if (allowedInCurrentProfile(mapped)) return mapped;
    }
    return null;
  } catch {
    return null;
  }
}

export async function touchStaffLastLogin(id: string): Promise<void> {
  await pool.query('UPDATE staff_users SET last_login_at=now() WHERE id=$1', [id]).catch(() => {});
}

export async function updateStaffPasswordHash(id: string, passwordHash: string): Promise<void> {
  await pool.query(
    'UPDATE staff_users SET password_hash=$2, must_change_password=false, updated_at=now() WHERE id=$1',
    [id, passwordHash],
  );
  await invalidateStaffCache(id);
}

export async function listStaffUsers(): Promise<any[]> {
  const r = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.tenant_id, u.reseller_id, u.branch_id,
            u.permissions, u.avatar_url, u.is_active, u.must_change_password,
            u.last_login_at, u.created_at, u.updated_at,
            COALESCE(m.enabled, false) AS mfa_enabled,
            (SELECT COUNT(*)::int FROM auth_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions
     FROM staff_users u
     LEFT JOIN user_mfa m ON m.user_id=u.id
     ORDER BY u.created_at ASC`,
  );
  const demoDisabled = isDemoAccountsDisabled();
  return r.rows
    .filter((row: any) => !(demoDisabled && DEMO_IDS.has(String(row.id))))
    .map((row: any) => ({ ...row, is_demo: DEMO_IDS.has(String(row.id)) }));
}

export async function createStaffUser(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  reseller_id?: string | null;
  branch_id?: string | null;
  permissions?: string[];
  must_change_password?: boolean;
}) {
  const email = input.email.trim().toLowerCase();
  const id = `usr-${crypto.randomUUID()}`;
  const hash = await bcrypt.hash(input.password, 12);
  const defaultPerms = input.permissions?.length
    ? input.permissions
    : input.role === 'SUPER_ADMIN'
      ? ['ALL']
      : [];
  const r = await pool.query(
    `INSERT INTO staff_users(id, name, email, password_hash, role, tenant_id, reseller_id, branch_id, permissions, is_active, must_change_password)
     VALUES($1,$2,$3,$4,$5,'tnt-primary-01',$6,$7,$8::jsonb,true,$9)
     RETURNING id, name, email, role, tenant_id, reseller_id, branch_id, permissions, avatar_url, is_active, must_change_password, created_at, updated_at`,
    [
      id,
      input.name.trim(),
      email,
      hash,
      input.role,
      input.reseller_id || null,
      input.branch_id || null,
      JSON.stringify(defaultPerms),
      !!input.must_change_password,
    ],
  );
  await invalidateStaffCache(id);
  return r.rows[0];
}

export async function updateStaffUser(
  id: string,
  patch: {
    name?: string;
    email?: string;
    role?: UserRole;
    reseller_id?: string | null;
    branch_id?: string | null;
    permissions?: string[];
    is_active?: boolean;
  },
) {
  const cur = (await pool.query('SELECT * FROM staff_users WHERE id=$1', [id])).rows[0];
  if (!cur) return null;
  const email = patch.email !== undefined ? patch.email.trim().toLowerCase() : cur.email;
  const r = await pool.query(
    `UPDATE staff_users
     SET name=$2, email=$3, role=$4, reseller_id=$5, branch_id=$6, permissions=$7::jsonb, is_active=$8, updated_at=now()
     WHERE id=$1
     RETURNING id, name, email, role, tenant_id, reseller_id, branch_id, permissions, avatar_url, is_active, must_change_password, last_login_at, created_at, updated_at`,
    [
      id,
      patch.name !== undefined ? patch.name.trim() : cur.name,
      email,
      patch.role ?? cur.role,
      patch.reseller_id !== undefined ? (patch.reseller_id || null) : cur.reseller_id,
      patch.branch_id !== undefined ? (patch.branch_id || null) : cur.branch_id,
      JSON.stringify(patch.permissions !== undefined ? patch.permissions : (cur.permissions || [])),
      patch.is_active !== undefined ? !!patch.is_active : cur.is_active,
    ],
  );
  await invalidateStaffCache(id);
  return r.rows[0];
}
