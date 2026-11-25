/**
 * Authentication for the IzanDesk MCP endpoint.
 *
 * Two credential styles, both mapped onto the existing user/RBAC model:
 *  1. `Authorization: Bearer <jwt>` — the same token the web app uses.
 *  2. `Authorization: Basic <base64(izmc_key:secret)>` — a dedicated, revocable
 *     MCP API key stored in Settings → MCP. Keys carry a role, an optional
 *     read-only flag and an optional tool allowlist. No new permission system.
 *
 * Keys are stored as SHA-256 hashes; the raw secret is shown only once at
 * creation time. Verification uses timingSafeEqual.
 */
import crypto = require('crypto');
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { getCached } from './settings';
import { auditLog } from './audit';
import { ipAllowed } from '../security/guards';
import { verifyStaffToken } from '../security/staff-tokens';

export type McpKeyRecord = {
  name?: string;
  role?: string;
  user_id?: string;
  secret_hash?: string;
  read_only?: boolean;
  allowed_tools?: string[] | null;
  created_at?: string;
  last_used_at?: string;
  revoked?: boolean;
};

export type McpAuthInfo = {
  source: 'jwt' | 'api_key';
  keyId?: string;
  keyName?: string;
  readOnly?: boolean;
  allowedTools?: string[] | null;
};

export type McpAuthOptions = {
  jwtSecret: string;
  /** Resolve a session-like user by id. */
  findUser: (id: string) => any | Promise<any | undefined>;
  /** Fallback user for keys that omit user_id (role-derived). */
  findUserByRole: (role: string) => any | Promise<any | undefined>;
  /** Called after a JWT has been verified; reuses the app's auth middleware. */
  jwtMiddleware: (req: Request, res: Response, next: NextFunction) => void;
};

export function hashMcpSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

function toActor(user: any) {
  return {
    id: String(user.id),
    name: String(user.name || user.email || user.id),
    email: user.email || '',
    role: String(user.role || ''),
    resellerId: user.resellerId || null,
  };
}

export function createMcpAuth(opts: McpAuthOptions) {
  return function mcpAuth(req: Request, res: Response, next: NextFunction) {
    const header = String(req.headers.authorization || '');

    if (header.startsWith('Bearer ') && !header.slice(7).startsWith('izmc_')) {
      try {
        verifyStaffToken(header.slice(7), opts.jwtSecret);
      } catch {
        return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid or expired token' } });
      }
      return opts.jwtMiddleware(req, res, next);
    }

    let keyId = '';
    let secret = '';
    if (header.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        if (idx < 1) throw new Error('bad basic auth');
        keyId = decoded.slice(0, idx);
        secret = decoded.slice(idx + 1);
      } catch {
        return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Malformed MCP credentials' } });
      }
    } else if (header.startsWith('Bearer ') && header.slice(7).startsWith('izmc_')) {
      // Convenience form for clients that only support Bearer: izmc_<key>.<secret>
      const raw = header.slice(7);
      const idx = raw.indexOf('.');
      if (idx < 1) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Malformed MCP key' } });
      keyId = raw.slice(0, idx);
      secret = raw.slice(idx + 1);
    } else {
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'MCP authentication required. Use a JWT or an API key.' } });
    }

    void (async () => {
      const keys = ((await getCached('mcp.api_keys', {})) || {}) as Record<string, McpKeyRecord>;
      const record = keys[keyId];
      if (!record || record.revoked) throw new Error('Unknown or revoked MCP key');
      if (!record.secret_hash || !safeEqual(record.secret_hash, hashMcpSecret(secret))) throw new Error('Invalid MCP key secret');

      const user = (record.user_id && await opts.findUser(record.user_id)) || await opts.findUserByRole(String(record.role || 'SUPER_ADMIN'));
      if (!user) throw new Error('MCP key is bound to an unknown user');
      const adminAllowlist = await getCached('security.admin_ip_allowlist', []);
      if (user.role === 'SUPER_ADMIN' && !ipAllowed(req.ip || String(req.headers['x-forwarded-for'] || ''), adminAllowlist)) {
        throw new Error('Admin access from this IP is not allowed');
      }
      if (await getCached('security.maintenance_mode', false) && user.role !== 'SUPER_ADMIN') {
        throw new Error('IzanDesk is under maintenance');
      }

      (req as any).user = toActor(user);
      (req as any).mcpAuth = {
        source: 'api_key',
        keyId,
        keyName: record.name || keyId,
        readOnly: !!record.read_only,
        allowedTools: Array.isArray(record.allowed_tools) ? record.allowed_tools : null,
      } as McpAuthInfo;

      keys[keyId] = { ...record, last_used_at: new Date().toISOString() };
      // Last-used is best-effort only; never block a valid request over a cache write.
      await pool.query(
        `INSERT INTO settings(key, category, value, updated_by) VALUES('mcp.api_keys','mcp',$1::jsonb,$2)
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [JSON.stringify(keys), user.name || user.id],
      ).catch(() => {});
      await auditLog({
        actor_id: user.id, actor_name: user.name, actor_role: user.role,
        action: 'MCP_KEY_USED', entity_type: 'mcp', entity_id: keyId,
        details: { name: record.name || null, read_only: !!record.read_only },
        ip_address: req.ip || null,
      });
      return next();
    })().catch(() => {
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid MCP credentials' } });
    });
  };
}
