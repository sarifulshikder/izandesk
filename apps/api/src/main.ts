import 'dotenv/config';
import express = require('express');
import cors = require('cors');
import jwt = require('jsonwebtoken');
import bcrypt = require('bcrypt');
import http = require('http');
import crypto = require('crypto');
import { WebSocketServer } from 'ws';
import { PluginKernel } from './kernel/plugin-manager';
import { setKernel } from './kernel/kernel-instance';
import { initDb, pool } from './db';
import { getCached, getSetting, validatePasswordPolicy, invalidateCache } from './integrations/settings';
import { auditLog } from './integrations/audit';
import { LoginRequest, LoginResponse, UserSession } from '@izandesk/shared-types';
import subscribersRouter from './routes/subscribers';
import topologyRouter from './routes/topology';
import inventoryRouter from './routes/inventory';
import gisRouter from './routes/gis';
import networkRouter from './routes/network';
import oltRouter from './routes/olt';
import radiusRouter from './routes/radius';
import wireguardRouter from './routes/wireguard';
import billingRouter from './routes/billing';
import resellersRouter from './routes/resellers';
import ticketsRouter from './routes/tickets';
import messagingRouter from './routes/messaging';
import brandingRouter from './routes/branding';
import portalRouter from './routes/portal';
import systemRouter from './routes/system';
import acsRouter from './routes/acs';
import financeRouter from './routes/finance';
import hrRouter from './routes/hr';
import procurementRouter from './routes/procurement';
import hotspotRouter from './routes/hotspot';
import reportsRouter from './routes/reports';
import auditRouter, { runAuditRetention } from './routes/audit';
import kycRouter from './routes/kyc';
import complianceRouter from './routes/compliance';
import { runKycMaintenance } from './integrations/kyc';
import leadsRouter from './routes/leads';
import installationOrdersRouter from './routes/installation-orders';
import subscriberEquipmentRouter from './routes/subscriber-equipment';
import subscriberCommunicationsRouter from './routes/subscriber-communications';
import settingsRouter from './routes/settings';
import aiRouter from './routes/ai';
import { createMcpRouter } from './routes/mcp';
import { createMcpAuth } from './integrations/mcp-auth';
import { assertProductionSecurity, enabled as envFlag, ipAllowed } from './security/guards';
import { mfaEnabled, mfaRequiredFor } from './security/mfa';
import { createRateLimiter } from './security/rate-limit';
import { createSession, newSessionId, revokeAllSessions, sessionActive, touchSession } from './security/sessions';
import { verifyPurposeToken, verifyStaffToken } from './security/staff-tokens';
import { hasNetworkRead } from './routes/helpers';
import { createAuthSecurityRouter } from './routes/auth-security';
import { startBillingScheduler } from './integrations/billing';
import { startBackupScheduler } from './routes/system';
import { startReportScheduler } from './integrations/report-scheduler';
import { startNetworkCollector } from './integrations/network-collector';
import { writeHubConfigFile } from './integrations/wireguard';
import { LITE_MODE, WG_CONFIG_DIR } from './config/runtime';
import { probeWithDeadline } from './health';

/**
 * Readiness probe that returns its client to the pool. On timeout the client is
 * destroyed instead of left checked out, so repeated failed probes cannot
 * starve the pool.
 */
async function probeDbReady(): Promise<boolean> {
  let client: any = null;
  try {
    client = await pool.connect();
    const ok = await probeWithDeadline(async () => { await client.query('SELECT 1'); return true; }, 2000);
    if (!ok) {
      const stale = client; client = null;
      try { stale.release(new Error('readiness probe timed out')); } catch { /* already released */ }
    }
    return ok;
  } catch {
    return false;
  } finally {
    if (client) {
      const held = client; client = null;
      try { held.release(); } catch { /* already released */ }
    }
  }
}

/**
 * The WireGuard hub file is generated state: the DB is authoritative. A wiped
 * config dir, a restored backup or a disposable stack pointing at the shared
 * path must not leave live peers out of wg0.conf after an API restart.
 */
async function reconcileWireGuardHub() {
  try {
    const hub = (await pool.query('SELECT * FROM wg_hub_config WHERE id=1')).rows[0];
    if (!hub) return;
    const peers = (await pool.query('SELECT * FROM wg_peers')).rows;
    if (!peers.length) {
      console.warn('[WireGuard] hub config reconciliation skipped: no peers in DB');
      return;
    }
    const file = await writeHubConfigFile(WG_CONFIG_DIR, hub, peers);
    console.log(`[WireGuard] hub config reconciled from DB: ${peers.length} peer(s) -> ${file}`);
  } catch (e: any) {
    console.warn('[WireGuard] hub config reconciliation skipped:', e?.message || e);
  }
}

const PORT = Number(process.env.API_PORT || 4000);
// Fail loudly before any route is mounted when the deployment is insecure.
// The public demo can opt into the known-credentials profile explicitly.
assertProductionSecurity();
const JWT_SECRET = process.env.JWT_SECRET || 'izandesk-dev-secret-change-me';
const WEB_ORIGIN = process.env.WEB_ORIGIN || '';
const ALLOW_LAN_ORIGINS = (process.env.ALLOW_LAN_ORIGINS || 'true').toLowerCase() !== 'false';

interface AuthUser extends UserSession { password: string; password_hash?: string; }

// Demo accounts have well-known passwords. Disable them explicitly in any
// non-demo deployment; they are only kept for the public demo environment.
const DEMO_ACCOUNTS_DISABLED = envFlag(process.env.DISABLE_DEMO_ACCOUNTS);

const users: AuthUser[] = DEMO_ACCOUNTS_DISABLED ? [] : [
  { id: 'usr-admin-01', name: 'Izan Rahman (CEO)', email: 'admin@izandesk.com', password: 'admin123', role: 'SUPER_ADMIN', tenantId: 'tnt-primary-01', permissions: ['ALL'], avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80' },
  { id: 'usr-noc-02', name: 'Tariqul Islam (NOC Lead)', email: 'noc@izandesk.com', password: 'noc123', role: 'NOC_ENGINEER', tenantId: 'tnt-primary-01', permissions: ['ROUTERS_READ','ROUTERS_WRITE','OLT_READ','SUBSCRIBERS_KICK'], avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80' },
  { id: 'usr-bill-03', name: 'Sadia Akhter (Accounts)', email: 'billing@izandesk.com', password: 'billing123', role: 'BILLING_OPERATOR', tenantId: 'tnt-primary-01', permissions: ['INVOICES_READ','PAYMENTS_CREATE','BILLS_ADJUST'], avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80' },
  { id: 'usr-tech-04', name: 'Kamrul Hasan (Field Lead)', email: 'tech@izandesk.com', password: 'tech123', role: 'TECHNICIAN', tenantId: 'tnt-primary-01', permissions: ['TICKETS_ASSIGNED','OPTICAL_READ','CLIENTS_READ'], avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80' },
  { id: 'usr-reseller-05', name: 'Shahriar Kabir (CyberNet Reseller)', email: 'reseller@cybernet.bd', password: 'reseller123', role: 'RESELLER', tenantId: 'tnt-primary-01', resellerId: 'RES-CYBERNET', permissions: ['RESELLER_CLIENTS_ALL','WALLET_RECHARGE'], avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&auto=format&fit=crop&q=80' },
];
if (!DEMO_ACCOUNTS_DISABLED && process.env.NODE_ENV === 'production') {
  console.warn('[Auth] WARNING: demo accounts with well-known passwords are ENABLED in production. Set DISABLE_DEMO_ACCOUNTS=true for real deployments.');
}

/**
 * With demo accounts disabled there are no built-in users, so an operator must
 * supply one bootstrap SUPER_ADMIN. Prefer BOOTSTRAP_ADMIN_PASSWORD_HASH (a
 * bcrypt hash) so no plaintext password sits in the container env / router
 * config. BOOTSTRAP_ADMIN_PASSWORD is accepted for convenience and is hashed
 * in memory at boot. A password changed later via Settings → Security is
 * persisted in `security.password_overrides` and takes precedence on restart.
 */
async function addBootstrapAdmin(): Promise<void> {
  if (!DEMO_ACCOUNTS_DISABLED) return;
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const hash = String(process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH || '').trim();
  const plaintext = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  if (!hash && !plaintext) {
    console.warn('[Auth] demo accounts disabled and no BOOTSTRAP_ADMIN_* account configured: no user can sign in.');
    return;
  }
  if (!email) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL is required when a bootstrap admin password/hash is provided');
  }
  if (users.some((u) => u.email.toLowerCase() === email)) return;
  let passwordHash = hash;
  if (!passwordHash) passwordHash = await bcrypt.hash(plaintext, 12);
  if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD_HASH must be a bcrypt hash ($2a$/$2b$/$2y$)');
  }
  users.push({
    id: 'usr-bootstrap-admin',
    name: String(process.env.BOOTSTRAP_ADMIN_NAME || 'Administrator').trim() || 'Administrator',
    email,
    password: '',
    password_hash: passwordHash,
    role: 'SUPER_ADMIN',
    tenantId: 'tnt-primary-01',
    permissions: ['ALL'],
  });
  console.log(`[Auth] bootstrap SUPER_ADMIN configured: ${email}`);
}

function toSession(u: AuthUser): UserSession { const { password, password_hash, ...rest } = u as any; return rest; }
function issueToken(user: UserSession, minutes = 720, jti?: string) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email, ...(jti ? { jti } : {}) }, JWT_SECRET, { expiresIn: `${Math.max(5, minutes)}m` });
}

async function checkPassword(user: AuthUser, pw: string): Promise<boolean> {
  if (user.password_hash) { try { return await bcrypt.compare(pw, user.password_hash); } catch { return false; } }
  return pw === user.password;
}

// in-memory login lockout (per identifier + source IP), limits come from settings
interface LoginAttempt { fails: number; lockedUntil: number }
const loginAttempts = new Map<string, LoginAttempt>();
// The E2E suite reuses one source IP for many UI logins. The insecure demo
// profile already opts into known credentials, so give its limiter headroom;
// real deployments keep the strict 30/minute default.
const loginRateLimit = envFlag(process.env.SECURITY_ALLOW_INSECURE_DEMO) ? 300 : 30;
const loginLimiter = createRateLimiter('login', loginRateLimit, 60_000);

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  (async () => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) { res.status(401).json({ message: 'Missing bearer token' }); return; }
    let payload: { sub: string; role: string; jti?: string };
    try {
      payload = verifyStaffToken(header.slice(7), JWT_SECRET);
    } catch {
      res.status(401).json({ message: 'Invalid or expired token' }); return;
    }
    const user = users.find((u) => u.id === payload.sub);
    if (!user || user.role !== payload.role) { res.status(401).json({ message: 'Invalid session' }); return; }
    // Revocable sessions: a jti is present on interactive logins. Tokens without
    // one (service/MCP executor tokens) keep the legacy JWT-only behaviour.
    if (payload.jti && !await sessionActive(payload.jti)) {
      res.status(401).json({ message: 'Session has been revoked. Please sign in again.' }); return;
    }
    // Admin IP allowlist (configured in Settings → Security).
    const adminAllowlist = await getCached('security.admin_ip_allowlist', []);
    if (user.role === 'SUPER_ADMIN' && !ipAllowed(req.ip || String(req.headers['x-forwarded-for'] || ''), adminAllowlist)) {
      res.status(403).json({ message: 'Admin access from this IP is not allowed' }); return;
    }
    if (payload.jti) void touchSession(payload.jti);
    // maintenance mode: only SUPER_ADMIN passes while enabled
    try {
      if (await getCached('security.maintenance_mode', false)) {
        if (user.role !== 'SUPER_ADMIN') {
          const msg = String(await getCached('security.maintenance_message', 'IzanDesk is under maintenance. Please try again later.') || 'Under maintenance');
          res.status(503).json({ message: msg, maintenance: true });
          return;
        }
      }
    } catch {}
    (req as any).user = toSession(user);
    next();
  })().catch(() => { try { res.status(500).json({ message: 'Auth error' }); } catch {} });
}

async function bootstrap() {
  await addBootstrapAdmin();
  const app = express();
  const allowedOrigins = WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  const lanOriginAllowed = (origin: string): boolean => {
    if (!ALLOW_LAN_ORIGINS) return false;
    try {
      const host = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
      const parts = host.split('.').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
      const [a, b] = parts;
      return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
    } catch {
      return false;
    }
  };
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
      if (lanOriginAllowed(origin)) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  }));
  // Keep the exact bytes for webhook HMAC verification. Re-serializing parsed
  // JSON changes whitespace/key order and rejects legitimate provider signatures.
  app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => { (req as any).rawBody = Buffer.from(buf); },
  }));

  let dbReady = false;
  try {
    await initDb();
    dbReady = true;
    console.log('[DB] PostgreSQL/PostGIS schema ready');
  } catch (e) {
    console.error('[DB] Initialization failed:', e);
  }

  // Apply persisted password overrides (from Settings & Security) onto the in-memory users
  try {
    const overrides = (await getSetting('security.password_overrides', {})) || {};
    for (const u of users) if (overrides[u.id]) u.password_hash = String(overrides[u.id]);
    console.log(`[Auth] users: ${users.length}, password overrides applied: ${Object.keys(overrides).length}`);
  } catch (e) {
    console.error('[Auth] failed to load password overrides:', e);
  }

  const kernel = new PluginKernel();
  await kernel.init();
  setKernel(kernel);

  app.get('/api/live', (_req, res) => {
    // Liveness: process can answer. Do not couple to DB so a DB outage causes
    // traffic removal, not a restart loop.
    res.status(200).json({ ok: true, service: 'izandesk-api', live: true });
  });

  app.get('/api/ready', async (_req, res) => {
    const liveDbReady = dbReady && await probeDbReady();
    const kernelReady = kernel.isReady();
    const ok = liveDbReady && kernelReady;
    res.status(ok ? 200 : 503).json({ ok, service: 'izandesk-api', ready: ok, dbReady: liveDbReady, kernelReady, pluginCount: kernel.listPlugins().length, lite: LITE_MODE });
  });

  app.get('/api/health', async (_req, res) => {
    // Backwards-compatible readiness probe. Prefer /api/ready for orchestrators;
    // keep /api/health for existing monitors and UI checks.
    const liveDbReady = dbReady && await probeDbReady();
    const kernelReady = kernel.isReady();
    const ok = liveDbReady && kernelReady;
    res.status(ok ? 200 : 503).json({ ok, service: 'izandesk-api', phase: 7, dbReady: liveDbReady, kernelReady, pluginCount: kernel.listPlugins().length, lite: LITE_MODE });
  });

  app.get('/api/metrics', async (_req, res) => {
    const liveDbReady = dbReady && await probeDbReady();
    const kernelReady = kernel.isReady();
    const mem = process.memoryUsage();
    const lines = [
      '# HELP izandesk_up Process liveness (1 = up).',
      '# TYPE izandesk_up gauge',
      'izandesk_up 1',
      '# HELP izandesk_ready Readiness status (1 = ready).',
      '# TYPE izandesk_ready gauge',
      `izandesk_ready ${liveDbReady && kernelReady ? 1 : 0}`,
      '# HELP izandesk_db_ready Database readiness (1 = ready).',
      '# TYPE izandesk_db_ready gauge',
      `izandesk_db_ready ${liveDbReady ? 1 : 0}`,
      '# HELP izandesk_kernel_ready Plugin kernel readiness (1 = ready).',
      '# TYPE izandesk_kernel_ready gauge',
      `izandesk_kernel_ready ${kernelReady ? 1 : 0}`,
      '# HELP izandesk_plugins_loaded Loaded plugin count.',
      '# TYPE izandesk_plugins_loaded gauge',
      `izandesk_plugins_loaded ${kernel.listPlugins().length}`,
      '# HELP process_uptime_seconds Process uptime in seconds.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${Math.floor(process.uptime())}`,
      '# HELP process_resident_memory_bytes Resident memory size in bytes.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${mem.rss}`,
      '# HELP nodejs_heap_used_bytes Node.js heap used bytes.',
      '# TYPE nodejs_heap_used_bytes gauge',
      `nodejs_heap_used_bytes ${mem.heapUsed}`,
    ];
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(lines.join('\n') + '\n');
  });
  app.use('/api/branding', brandingRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/system', (req, res, next) => { const h = req.headers.authorization; if (h?.startsWith('Bearer ')) return authMiddleware(req, res, next); return next(); }, systemRouter);
  app.use('/api/settings', authMiddleware, settingsRouter);
  app.use('/api/acs', authMiddleware, acsRouter);

  app.post('/api/auth/login', async (req, res) => {
    try {
      const body = req.body as LoginRequest & { username?: string; identifier?: string };
      const identifier = String(body.identifier || body.email || body.username || '').trim().toLowerCase();
      const pw = String(body.password || '');
      const sourceIp = String(req.ip || req.headers['x-forwarded-for'] || '');
      const throttle = loginLimiter.check(sourceIp || identifier || 'unknown', loginRateLimit);
      if (!throttle.allowed) {
        res.setHeader('Retry-After', String(throttle.retryAfterSec));
        return res.status(429).json({ message: 'Too many login attempts. Try again shortly.' });
      }
      const now = Date.now();
      const maxAttempts = Number(await getCached('security.login_max_attempts', 5)) || 5;
      const lockMinutes = Number(await getCached('security.login_lockout_minutes', 15)) || 15;
      const lockKey = `${identifier}|${sourceIp}`;
      const att = loginAttempts.get(lockKey);
      if (att && att.lockedUntil > now) {
        res.setHeader('Retry-After', String(Math.ceil((att.lockedUntil - now) / 1000)));
        return res.status(429).json({ message: `Too many failed attempts. Locked — try again in ${Math.ceil((att.lockedUntil - now) / 60000)} min.` });
      }
      // Support login by email or local-part username (e.g. "admin" for admin@izandesk.com)
      const user = users.find((u) => {
        const em = u.email.toLowerCase();
        const local = em.split('@')[0];
        return em === identifier || local === identifier;
      });
      const ok = user ? await checkPassword(user, pw) : false;
      if (!user || !ok) {
        const a = loginAttempts.get(lockKey) || { fails: 0, lockedUntil: 0 };
        a.fails += 1;
        if (a.fails >= maxAttempts) {
          a.lockedUntil = now + lockMinutes * 60000; a.fails = 0;
          loginAttempts.set(lockKey, a);
          await auditLog({ action: 'auth.lockout', entity_type: 'auth', entity_id: identifier, details: { lockout_minutes: lockMinutes, max_attempts: maxAttempts }, ip_address: req.ip });
          res.setHeader('Retry-After', String(lockMinutes * 60));
          return res.status(429).json({ message: `Too many failed attempts. Account locked for ${lockMinutes} min.` });
        }
        loginAttempts.set(lockKey, a);
        return res.status(401).json({ message: 'Invalid email/username or password' });
      }
      loginAttempts.delete(lockKey);
      const session = toSession(user);
      const enrolled = await mfaEnabled(user.id);
      const required = await mfaRequiredFor(user.role);
      if (enrolled) {
        const challenge = jwt.sign({ sub: user.id, purpose: 'mfa' }, JWT_SECRET, { expiresIn: '5m' });
        return res.json({ mfa_required: true, mfa_token: challenge, methods: ['totp', 'recovery_code'] });
      }
      // Policy requires TOTP but the account has not enrolled yet: issue only a
      // narrow enrollment challenge. No staff session is created until TOTP is
      // configured and verified, otherwise the policy is trivially bypassable.
      if (required) {
        await auditLog({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'auth.mfa_enrollment_required', entity_type: 'auth' });
        const enrollmentChallenge = jwt.sign({ sub: user.id, purpose: 'mfa_enrollment' }, JWT_SECRET, { expiresIn: '15m' });
        return res.json({
          mfa_required: true,
          mfa_enrollment_required: true,
          mfa_token: enrollmentChallenge,
          methods: ['totp'],
        });
      }
      const sessionMinutes = Number(await getCached('security.session_timeout_minutes', 720)) || 720;
      const jti = newSessionId();
      await createSession({ id: jti, userId: user.id, minutes: sessionMinutes, ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) });
      await auditLog({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'auth.login', entity_type: 'auth', ip_address: req.ip });
      res.json({ token: issueToken(session, sessionMinutes, jti), user: session } as LoginResponse);
    } catch (e: any) {
      console.error('[Auth] login failed:', e);
      res.status(500).json({ message: 'Login failed' });
    }
  });

  // Change own password — enforced against the Security password policy, persisted hashed
  app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
    try {
      const session = (req as any).user as UserSession;
      const user = users.find((u) => u.id === session?.id);
      if (!user) return res.status(401).json({ message: 'Invalid session' });
      const { old_password, new_password } = (req.body || {}) as any;
      if (!(await checkPassword(user, String(old_password || '')))) return res.status(400).json({ message: 'Current password is incorrect' });
      const pwErr = await validatePasswordPolicy(String(new_password || ''));
      if (pwErr) return res.status(400).json({ message: pwErr });
      const hash = await bcrypt.hash(String(new_password), 10);
      user.password_hash = hash;
      const overrides = (await getSetting('security.password_overrides', {})) || {};
      overrides[user.id] = hash;
      await pool.query(
        `INSERT INTO settings(key, category, value, updated_by) VALUES('security.password_overrides','security',$1::jsonb,$2)
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [JSON.stringify(overrides), user.name]
      );
      invalidateCache();
      const currentJti = (jwt.decode(String(req.headers.authorization || '').slice(7)) as any)?.jti;
      const revoked = await revokeAllSessions(user.id, currentJti);
      await auditLog({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'auth.change_password', entity_type: 'auth', entity_id: user.id, details: { via: 'settings-security', other_sessions_revoked: revoked }, ip_address: req.ip });
      res.json({ ok: true, message: revoked ? `Password updated. ${revoked} other session(s) were signed out.` : 'Password updated and stored hashed (survives restarts).' });
    } catch (e: any) {
      console.error('[Auth] change-password failed:', e);
      res.status(500).json({ message: 'Failed to change password' });
    }
  });

  app.get('/api/auth/me', authMiddleware, (req, res) => res.json({ user: (req as any).user as UserSession }));
  // Revocable sessions + TOTP enrollment (mounted after the legacy auth routes).
  app.use('/api/auth', (req, res, next) => {
    // MFA verification uses the short-lived challenge token, not a staff JWT.
    if (req.path === '/mfa/verify') return next();
    // Enrollment challenge tokens are accepted only for the three enrollment
    // endpoints. They cannot reach any other API surface.
    if (['/mfa/enroll', '/mfa/confirm', '/mfa/status'].includes(req.path)) {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        const sub = verifyPurposeToken(header.slice(7), JWT_SECRET, 'mfa_enrollment');
        const user = sub ? users.find((u) => u.id === sub) : undefined;
        if (user) {
          (req as any).user = toSession(user);
          (req as any).authPurpose = 'mfa_enrollment';
          return next();
        }
      }
    }
    return authMiddleware(req, res, next);
  }, createAuthSecurityRouter({
    findUser: (id) => users.find((u) => u.id === id),
    checkPassword,
    issueToken,
  }));

  app.get('/api/auth/roles', (_req, res) => res.json({ roles: [
    { role: 'SUPER_ADMIN', label: 'Super Admin', desc: 'Full ISP ownership & ledger' },
    { role: 'NOC_ENGINEER', label: 'NOC Engineer', desc: 'Routers, OLTs & AAA policies' },
    { role: 'BILLING_OPERATOR', label: 'Billing Operator', desc: 'Collections & invoices' },
    { role: 'TECHNICIAN', label: 'Field Technician', desc: 'Assigned tickets & optical' },
    { role: 'RESELLER', label: 'CyberNet Reseller', desc: 'Sub-ISP wholesale wallet' },
  ]}));

  // Phase 1: plugins (hot-reload kernel + categorized configuration)
  const pluginGatewayId = (p: any) => {
    const id = String(p?.id || '');
    const m = id.match(/^payment-(.+)$/i);
    if (m) return m[1].toLowerCase();
    if (String(p?.type) === 'PAYMENT_GATEWAY') return id.toLowerCase();
    return null;
  };

  app.get('/api/plugins', authMiddleware, async (_req, res) => {
    try {
      const plugins = kernel.listPlugins();
      let gatewayCfgs: any[] = [];
      try { gatewayCfgs = (await pool.query('SELECT gateway, enabled, mode, config, updated_at, (credentials IS NOT NULL AND credentials <> \'{}\'::jsonb) as has_credentials, (webhook_secret IS NOT NULL AND webhook_secret <> \'\') as has_webhook_secret FROM payment_gateway_configs ORDER BY gateway')).rows; } catch {}
      const cfgByGateway = new Map(gatewayCfgs.map((g:any)=>[String(g.gateway).toLowerCase(), g]));
      const enriched = plugins.map((p:any) => {
        const gw = pluginGatewayId(p);
        return gw ? { ...p, category: p.type, gateway: gw, gatewayConfig: cfgByGateway.get(gw) || null } : { ...p, category: p.type };
      });
      const categories = enriched.reduce((acc:any, p:any) => { const k = p.type || 'OTHER'; (acc[k] = acc[k] || []).push(p); return acc; }, {} as Record<string, any[]>);
      res.json({ plugins: enriched, categories, kernelReady: kernel.isReady(), paymentGateways: gatewayCfgs });
    } catch (e:any) {
      res.json({ plugins: kernel.listPlugins(), kernelReady: kernel.isReady() });
    }
  });

  app.post('/api/plugins/reload', authMiddleware, async (req, res) => {
    const user = (req as any).user as UserSession;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'NOC_ENGINEER') return res.status(403).json({ message: 'Insufficient permissions to reload plugins' });
    const { id } = (req.body || {}) as { id?: string };
    if (id) {
      const plugin = await kernel.reloadPlugin(id);
      if (!plugin) return res.status(404).json({ message: 'Plugin not found' });
      return res.json({ ok: true, plugins: kernel.listPlugins(), reloaded: plugin });
    }
    const plugins = await kernel.reloadAll();
    res.json({ ok: true, plugins, reloadedAll: true });
  });

  app.get('/api/plugins/payment-gateways', authMiddleware, async (_req, res) => {
    const plugins = kernel.listPlugins().filter((p:any)=>p.type==='PAYMENT_GATEWAY');
    let cfgs: any[] = [];
    try { cfgs = (await pool.query('SELECT gateway, enabled, mode, config, updated_at, (credentials IS NOT NULL AND credentials <> \'{}\'::jsonb) as has_credentials, (webhook_secret IS NOT NULL AND webhook_secret <> \'\') as has_webhook_secret FROM payment_gateway_configs ORDER BY gateway')).rows; } catch {}
    const cfgBy = new Map(cfgs.map((g:any)=>[String(g.gateway).toLowerCase(), g]));
    res.json({ ok: true, data: plugins.map((p:any)=>{ const gw = pluginGatewayId(p); return { ...p, gateway: gw, gatewayConfig: gw ? (cfgBy.get(gw) || null) : null }; }), configs: cfgs });
  });

  app.post('/api/plugins/payment-gateways/:gateway', authMiddleware, async (req, res) => {
    const user = (req as any).user as UserSession;
    if (!['SUPER_ADMIN','BILLING_OPERATOR'].includes(user.role)) return res.status(403).json({ message: 'Insufficient permissions to configure payment gateway plugins' });
    const b = req.body || {};
    const gateway = String(req.params.gateway || '').toLowerCase().replace(/^payment-/, '');
    if (!gateway) return res.status(400).json({ message: 'gateway is required' });
    const r = await pool.query(`INSERT INTO payment_gateway_configs(gateway, enabled, mode, config, credentials, webhook_secret, updated_at)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,now())
      ON CONFLICT (gateway) DO UPDATE SET enabled=COALESCE($2,payment_gateway_configs.enabled), mode=COALESCE($3,payment_gateway_configs.mode), config=COALESCE($4::jsonb,payment_gateway_configs.config), credentials=COALESCE($5::jsonb,payment_gateway_configs.credentials), webhook_secret=COALESCE($6,payment_gateway_configs.webhook_secret), updated_at=now()
      RETURNING gateway,enabled,mode,config,updated_at,(credentials IS NOT NULL AND credentials <> '{}'::jsonb) as has_credentials,(webhook_secret IS NOT NULL AND webhook_secret <> '') as has_webhook_secret`,
      [gateway, b.enabled, b.mode, b.config ? JSON.stringify(b.config) : null, b.credentials ? JSON.stringify(b.credentials) : null, b.webhook_secret || null]);
    await auditLog({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'PAYMENT_GATEWAY_CONFIG', entity_type: 'payment_gateway', entity_id: gateway, details: { enabled: r.rows[0]?.enabled, mode: r.rows[0]?.mode, credentials_changed: !!b.credentials, webhook_secret_changed: !!b.webhook_secret } });
    res.json({ ok: true, gateway: r.rows[0] });
  });

  // Phase 2: BSS core
  // KYC files are served through the ownership-checked route in subscribers.ts
  // (GET /api/subscribers/:id/kyc/:docId/file), never as public static files.
  app.use('/api/subscribers', authMiddleware, subscribersRouter);
  // KYC review queue, decisions, legal holds and BTRC/PDPA export pack.
  app.use('/api/kyc', authMiddleware, kycRouter);
  app.use('/api/compliance', authMiddleware, complianceRouter);
  app.use('/api/topology', authMiddleware, topologyRouter);
  app.use('/api/inventory', authMiddleware, inventoryRouter);
  app.use('/api/gis', authMiddleware, gisRouter);

  // AI Copilot: role-scoped, bilingual assistant (free local engine by default)
  app.use('/api/ai', authMiddleware, aiRouter);

  // MCP: same AI engine and RBAC, exposed to Claude/Cursor/ChatGPT over JSON-RPC.
  // Bearer keys are checked against the existing user table; dedicated izmc_ keys
  // are hash-verified and may be read-only or restricted to specific tools.
  const mcpAuth = createMcpAuth({
    jwtSecret: JWT_SECRET,
    findUser: (id) => users.find((u) => u.id === id),
    findUserByRole: (role) => users.find((u) => u.role === role),
    jwtMiddleware: authMiddleware,
  });
  app.use('/api/mcp', mcpAuth, createMcpRouter(pool));

  // Phase 3: Network OSS, OLT, AAA/RADIUS, WireGuard overlay
  app.use('/api/network', authMiddleware, networkRouter);
  app.use('/api/olt', authMiddleware, oltRouter);
  app.use('/api/radius', authMiddleware, radiusRouter);
  app.use('/api/wireguard', authMiddleware, wireguardRouter);

  // Phase 4: Billing, Invoicing, Payments, Suspension/Reactivation
  // Webhooks, MFS SMS ingest, and shareable invoice links are public (validated in-route/by token)
  app.use('/api/billing', (req, res, next) => {
    // Webhooks are verified in-route (HMAC + pending-payment binding), bKash's
    // redirect is verified by executing the payment with the gateway, and
    // invoice PDF/HTML links carry a signed expiring token.
    if (req.path.startsWith('/webhooks/') || req.path === '/payments/bkash/callback' || /^\/invoices\/[^/]+\/(pdf|html)$/.test(req.path)) return next();
    // SMS forwarding is public only with a configured shared token; otherwise
    // the JWT must be verified by the normal auth middleware (never trust a
    // raw `Bearer <anything>` header).
    if (req.path === '/payments/sms/ingest') {
      const expected = process.env.MFS_SMS_INGEST_TOKEN || process.env.SMS_INGEST_TOKEN || '';
      const token = String(req.headers['x-sms-token'] || req.query.token || '');
      if (expected && token) {
        const a = Buffer.from(token), b = Buffer.from(expected);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          (req as any).smsIngestAuthorized = true;
          return next();
        }
      }
    }
    return authMiddleware(req, res, next);
  }, billingRouter);

  // Phase 5: Resellers, CRM/Tickets, Messaging
  app.use('/api/resellers', authMiddleware, resellersRouter);
  app.use('/api/tickets', authMiddleware, ticketsRouter);
  app.use('/api/messaging', authMiddleware, messagingRouter);

  // Phase 8: Subscriber Enhancement - Leads, Installation, Equipment, Communications
  app.use('/api/leads', authMiddleware, leadsRouter);
  app.use('/api/installation-orders', authMiddleware, installationOrdersRouter);
  app.use('/api/subscriber-equipment', authMiddleware, subscriberEquipmentRouter);
  app.use('/api/subscriber-communications', authMiddleware, subscriberCommunicationsRouter);

  // Phase 7: Finance, HRM, Procurement/Assets, Hotspot, Reports, Audit & Field workflows
  app.use('/api/finance', authMiddleware, financeRouter);
  app.use('/api/hr', authMiddleware, hrRouter);
  app.use('/api/procurement', authMiddleware, procurementRouter);
  app.use('/api/hotspot', authMiddleware, hotspotRouter);
  app.use('/api/reports', authMiddleware, reportsRouter);
  app.use('/api/audit', authMiddleware, auditRouter);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err?.status || (err?.name === 'MulterError' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ message: status >= 500 ? 'Internal server error' : (err?.message || 'Request failed') });
  });

  const server = http.createServer(app);

  // WebSocket live sessions stream (spec parity with SSE). It exposes the same
  // subscriber/network data as /api/network/sessions, so it must enforce the
  // same staff-token, session, admin-IP, maintenance and RBAC checks.
  const wss = new WebSocketServer({ noServer: true });
  async function authorizeSessionsSocket(token: string, request: http.IncomingMessage): Promise<UserSession | null> {
    let payload: { sub: string; role: string; jti?: string };
    try {
      payload = verifyStaffToken(token, JWT_SECRET);
    } catch { return null; }
    const user = users.find((u) => u.id === payload.sub);
    if (!user || user.role !== payload.role) return null;
    if (payload.jti && !await sessionActive(payload.jti)) return null;
    const ip = request.socket.remoteAddress || String(request.headers['x-forwarded-for'] || '');
    const adminAllowlist = await getCached('security.admin_ip_allowlist', []);
    if (user.role === 'SUPER_ADMIN' && !ipAllowed(ip, adminAllowlist)) return null;
    if (await getCached('security.maintenance_mode', false) && user.role !== 'SUPER_ADMIN') return null;
    const session = toSession(user);
    if (!hasNetworkRead({ user: session })) return null;
    return session;
  }
  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      try {
        const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
        if (reqUrl.pathname !== '/api/network/sessions/ws' && reqUrl.pathname !== '/ws/sessions') {
          socket.destroy(); return;
        }
        const token = reqUrl.searchParams.get('token') || (String(request.headers.authorization || '').startsWith('Bearer ') ? String(request.headers.authorization).slice(7) : '');
        if (!token) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
        const user = await authorizeSessionsSocket(token, request);
        if (!user) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request, user);
        });
      } catch {
        socket.destroy();
      }
    })();
  });

  async function wsSessionPayload() {
    const rows = (await pool.query(`SELECT ss.username, ss.rx_bps, ss.tx_bps, ss.status, ss.ip_address, r.name as router_name, r.integration_mode, s.full_name, s.provisioning_mode
      FROM subscriber_sessions ss LEFT JOIN network_routers r ON r.id=ss.router_id LEFT JOIN subscribers s ON s.id=ss.subscriber_id
      ORDER BY ss.updated_at DESC LIMIT 50`)).rows;
    return { t: Date.now(), sessions: rows, summary: { online: rows.filter((r:any)=>r.status==='ONLINE').length, aggRxBps: rows.reduce((a:number,r:any)=>a+Number(r.rx_bps||0),0), aggTxBps: rows.reduce((a:number,r:any)=>a+Number(r.tx_bps||0),0) } };
  }

  wss.on('connection', async (ws: any, _request: any, _user: UserSession) => {
    try { ws.send(JSON.stringify(await wsSessionPayload())); } catch {}
    const iv = setInterval(async () => {
      if (ws.readyState !== 1) return;
      try { ws.send(JSON.stringify(await wsSessionPayload())); } catch {}
    }, 3000);
    ws.on('close', () => clearInterval(iv));
    ws.on('error', () => clearInterval(iv));
  });

  server.listen(PORT, () => {
    console.log('====================================================');
    console.log(`    IzanDesk ERP API — listening on :${PORT} (Phase 5)`);
    console.log('====================================================');
    console.log(`[Bootstrap] DB ready: ${dbReady}, Plugins loaded: ${kernel.listPlugins().length}`);
  });

  let schedulersStarted = false;
  const startSchedulers = () => {
    if (schedulersStarted || !dbReady) return;
    schedulersStarted = true;
    startBillingScheduler();
    startBackupScheduler();
    startReportScheduler();
    startNetworkCollector();
    // Compliance retention sweep once per day (settings: audit_retention_days,
    // kyc.expiry_warning_days, kyc.document_retention_days). Legal holds win.
    void runAuditRetention();
    void runKycMaintenance();
    setInterval(() => {
      void runAuditRetention();
      void runKycMaintenance();
    }, 24 * 60 * 60 * 1000).unref();
  };

  if (dbReady) {
    await reconcileWireGuardHub();
    startSchedulers();
  } else {
    // A DB outage at boot must not permanently strand readiness and disable
    // every scheduler. Retry schema initialization until the DB returns.
    const retry = setInterval(async () => {
      try {
        await initDb();
        dbReady = true;
        console.log('[DB] Schema ready after delayed recovery');
        await reconcileWireGuardHub();
        startSchedulers();
        clearInterval(retry);
      } catch { /* keep retrying until the database is reachable */ }
    }, 15000);
    retry.unref();
  }
}

bootstrap().catch((err) => { console.error('Failed to bootstrap API', err); process.exit(1); });
