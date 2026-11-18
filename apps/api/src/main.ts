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
import { LoginRequest, LoginResponse, UserRole, UserSession } from '@izandesk/shared-types';
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
import auditRouter from './routes/audit';
import leadsRouter from './routes/leads';
import installationOrdersRouter from './routes/installation-orders';
import subscriberEquipmentRouter from './routes/subscriber-equipment';
import subscriberCommunicationsRouter from './routes/subscriber-communications';
import settingsRouter from './routes/settings';
import aiRouter from './routes/ai';
import { startBillingScheduler } from './integrations/billing';
import { startBackupScheduler } from './routes/system';
import { startReportScheduler } from './integrations/report-scheduler';

const PORT = Number(process.env.API_PORT || 4000);
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'izandesk-dev-secret-change-me';
const WEB_ORIGIN = process.env.WEB_ORIGIN || '';
const ALLOW_LAN_ORIGINS = (process.env.ALLOW_LAN_ORIGINS || 'true').toLowerCase() !== 'false';

interface AuthUser extends UserSession { password: string; password_hash?: string; }

// Demo accounts have well-known passwords. Disable them explicitly in any
// non-demo deployment; they are only kept for the public demo environment.
const DEMO_ACCOUNTS_DISABLED = String(process.env.DISABLE_DEMO_ACCOUNTS || '').toLowerCase() === 'true';

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

function toSession(u: AuthUser): UserSession { const { password, password_hash, ...rest } = u as any; return rest; }
function issueToken(user: UserSession, minutes = 720) { return jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: `${Math.max(5, minutes)}m` }); }

async function checkPassword(user: AuthUser, pw: string): Promise<boolean> {
  if (user.password_hash) { try { return await bcrypt.compare(pw, user.password_hash); } catch { return false; } }
  return pw === user.password;
}

// in-memory login lockout (per email), limits come from settings
interface LoginAttempt { fails: number; lockedUntil: number }
const loginAttempts = new Map<string, LoginAttempt>();

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  (async () => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) { res.status(401).json({ message: 'Missing bearer token' }); return; }
    let payload: { sub: string; role: UserRole };
    try {
      payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string; role: UserRole };
    } catch {
      res.status(401).json({ message: 'Invalid or expired token' }); return;
    }
    const user = users.find((u) => u.id === payload.sub);
    if (!user) { res.status(401).json({ message: 'Invalid session' }); return; }
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
  const app = express();
  const allowedOrigins = WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
      if (ALLOW_LAN_ORIGINS && /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(origin)) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));

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

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'izandesk-api', phase: 7, dbReady, kernelReady: kernel.isReady(), pluginCount: kernel.listPlugins().length });
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
      const now = Date.now();
      const maxAttempts = Number(await getCached('security.login_max_attempts', 5)) || 5;
      const lockMinutes = Number(await getCached('security.login_lockout_minutes', 15)) || 15;
      const att = loginAttempts.get(identifier);
      if (att && att.lockedUntil > now) {
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
        const a = loginAttempts.get(identifier) || { fails: 0, lockedUntil: 0 };
        a.fails += 1;
        if (a.fails >= maxAttempts) {
          a.lockedUntil = now + lockMinutes * 60000; a.fails = 0;
          loginAttempts.set(identifier, a);
          await auditLog({ action: 'auth.lockout', entity_type: 'auth', entity_id: identifier, details: { lockout_minutes: lockMinutes, max_attempts: maxAttempts }, ip_address: req.ip });
          return res.status(429).json({ message: `Too many failed attempts. Account locked for ${lockMinutes} min.` });
        }
        loginAttempts.set(identifier, a);
        return res.status(401).json({ message: 'Invalid email/username or password' });
      }
      loginAttempts.delete(identifier);
      const session = toSession(user);
      const sessionMinutes = Number(await getCached('security.session_timeout_minutes', 720)) || 720;
      await auditLog({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'auth.login', entity_type: 'auth', ip_address: req.ip });
      res.json({ token: issueToken(session, sessionMinutes), user: session } as LoginResponse);
    } catch (e: any) {
      res.status(500).json({ message: e.message || 'Login failed' });
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
      await auditLog({ actor_id: user.id, actor_name: user.name, actor_role: user.role, action: 'auth.change_password', entity_type: 'auth', entity_id: user.id, details: { via: 'settings-security' }, ip_address: req.ip });
      res.json({ ok: true, message: 'Password updated and stored hashed (survives restarts).' });
    } catch (e: any) {
      res.status(500).json({ message: e.message || 'Failed to change password' });
    }
  });

  app.get('/api/auth/me', authMiddleware, (req, res) => res.json({ user: (req as any).user as UserSession }));
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
  app.use('/api/topology', authMiddleware, topologyRouter);
  app.use('/api/inventory', authMiddleware, inventoryRouter);
  app.use('/api/gis', authMiddleware, gisRouter);

  // AI Copilot: role-scoped, bilingual assistant (free local engine by default)
  app.use('/api/ai', authMiddleware, aiRouter);

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
    res.status(status).json({ message: err?.message || 'Internal server error' });
  });

  const server = http.createServer(app);

  // WebSocket live sessions stream (spec parity with SSE)
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (reqUrl.pathname !== '/api/network/sessions/ws' && reqUrl.pathname !== '/ws/sessions') {
        socket.destroy(); return;
      }
      const token = reqUrl.searchParams.get('token') || (String(request.headers.authorization || '').startsWith('Bearer ') ? String(request.headers.authorization).slice(7) : '');
      if (!token) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      try { jwt.verify(token, JWT_SECRET); } catch { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch {
      socket.destroy();
    }
  });

  async function wsSessionPayload() {
    const rows = (await pool.query(`SELECT ss.username, ss.rx_bps, ss.tx_bps, ss.status, ss.ip_address, r.name as router_name, r.integration_mode, s.full_name, s.provisioning_mode
      FROM subscriber_sessions ss LEFT JOIN network_routers r ON r.id=ss.router_id LEFT JOIN subscribers s ON s.id=ss.subscriber_id
      ORDER BY ss.updated_at DESC LIMIT 50`)).rows;
    return { t: Date.now(), sessions: rows, summary: { online: rows.filter((r:any)=>r.status==='ONLINE').length, aggRxBps: rows.reduce((a:number,r:any)=>a+Number(r.rx_bps||0),0), aggTxBps: rows.reduce((a:number,r:any)=>a+Number(r.tx_bps||0),0) } };
  }

  wss.on('connection', async (ws) => {
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

  if (dbReady) {
    startBillingScheduler();
    startBackupScheduler();
    startReportScheduler();
  }
}

bootstrap().catch((err) => { console.error('Failed to bootstrap API', err); process.exit(1); });
