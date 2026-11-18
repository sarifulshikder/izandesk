import { Router } from 'express';
import express = require('express');
import crypto = require('crypto');
import jwt = require('jsonwebtoken');
import multer = require('multer');
import path = require('path');
import fs = require('fs');
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { getInvoiceWithItems } from '../integrations/billing';
import { getKernel } from '../kernel/kernel-instance';
import { renderSimpleInvoicePdf } from '../integrations/pdf';
import { nextTicketNo } from '../utils/ticket-no';
import { hashPassword, verifyPassword, isHashed } from '../utils/password';
import { validatePasswordPolicy } from '../integrations/settings';

const router: Router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'izandesk-dev-secret-change-me';
const uploadDir = path.resolve(__dirname, '../../../uploads/kyc');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const MAX_KYC_BYTES = 5 * 1024 * 1024;
const KYC_MIME_RE = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/i;
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    // Unguessable, extension-bounded name — no original filename is persisted.
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf'].includes(ext) ? ext : '';
    cb(null, crypto.randomUUID() + safeExt);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_KYC_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!KYC_MIME_RE.test(file.mimetype)) {
      const err: any = new Error('Only PNG, JPEG, WebP, GIF or PDF files are allowed');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

// Tokens are bound to the subscriber's current password hash, so changing the
// password invalidates every portal session issued before the change.
function tokenVersion(password: any) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex').slice(0, 16);
}
function issuePortalToken(sub: any) {
  return jwt.sign({ type: 'PORTAL_SUBSCRIBER', sub: sub.id, client_code: sub.client_code, ver: tokenVersion(sub.password) }, JWT_SECRET, { expiresIn: '7d' });
}
async function portalAuth(req: any, res: any, next: any) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing portal token' });
  try {
    const p: any = jwt.verify(h.slice(7), JWT_SECRET);
    if (p?.type !== 'PORTAL_SUBSCRIBER' || !p?.sub || !p?.ver) throw new Error('bad');
    const row = (await pool.query('SELECT password FROM subscribers WHERE id=$1', [p.sub])).rows[0];
    if (!row || tokenVersion(row.password) !== p.ver) throw new Error('stale');
    req.portal = p; next();
  } catch { return res.status(401).json({ message: 'Invalid or expired portal session' }); }
}

// Portal login attempts are rate-limited per identifier + IP so a subscriber
// account cannot be brute-forced with guessed client codes/passwords.
interface PortalAttempt { fails: number; lockedUntil: number }
const portalLoginAttempts = new Map<string, PortalAttempt>();
const PORTAL_MAX_ATTEMPTS = 5;
const PORTAL_LOCK_MINUTES = 15;

async function getSubscriber(id: string) {
  const r = await pool.query(`SELECT id, client_code, full_name, username, phone, email, status, package_name, bandwidth_mbps, monthly_bill, current_due, expiry_date, due_date, address, connection_type, provisioning_mode, suspension_stage, walled_garden, created_at, nid_number, auto_pay_enabled, preferred_gateway, fup_exceeded, fup_applied_at, fup_exempt
    FROM subscribers WHERE id=$1`, [id]);
  return r.rows[0] || null;
}

router.post('/login', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const id = String(b.client_code || b.username || b.phone || '').trim();
  const pass = String(b.password || '');
  if (!id || !pass) return res.status(400).json({ message: 'client_code/username/phone and password are required' });
  const key = `${id.toLowerCase()}|${req.ip}`;
  const now = Date.now();
  const att = portalLoginAttempts.get(key);
  if (att && att.lockedUntil > now) {
    return res.status(429).json({ message: `Too many failed attempts. Try again in ${Math.ceil((att.lockedUntil - now) / 60000)} min.` });
  }
  const r = await pool.query(`SELECT s.id, s.client_code, s.full_name, s.username, s.phone, s.email, s.status, s.package_name, s.bandwidth_mbps, s.monthly_bill, s.current_due, s.expiry_date, s.address, s.connection_type, s.password
    FROM subscribers s WHERE (lower(s.client_code)=lower($1) OR lower(s.username)=lower($1) OR s.phone=$1) LIMIT 1`, [id]);
  const s = r.rows[0];
  const stored = s?.password ? String(s.password) : '';
  let ok = false;
  if (s) {
    if (stored && isHashed(stored)) ok = await verifyPassword(pass, stored);
    else if (stored) ok = stored === pass;
    else ok = (pass === String(s.client_code || '') || pass === String(s.username || '') || pass === String(s.phone || ''));
  }
  if (!ok) {
    const a = portalLoginAttempts.get(key) || { fails: 0, lockedUntil: 0 };
    a.fails += 1;
    if (a.fails >= PORTAL_MAX_ATTEMPTS) {
      a.lockedUntil = now + PORTAL_LOCK_MINUTES * 60000; a.fails = 0;
      portalLoginAttempts.set(key, a);
      return res.status(429).json({ message: `Too many failed attempts. Locked for ${PORTAL_LOCK_MINUTES} min.` });
    }
    portalLoginAttempts.set(key, a);
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  portalLoginAttempts.delete(key);
  const token = issuePortalToken(s);
  const { password, ...safe } = s;
  res.json({ ok: true, token, subscriber: safe });
}));

router.get('/me', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const sub = await getSubscriber(id);
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });
  // prefer subscriber_sessions, but also derive live state from radacct open sessions (acctstoptime IS NULL and recent)
  let session = (await pool.query(`SELECT status, rx_bps, tx_bps, uptime_sec as uptime_seconds, ip_address, updated_at, username FROM subscriber_sessions WHERE subscriber_id=$1 ORDER BY updated_at DESC LIMIT 1`, [id])).rows[0] || null;
  try {
    const rad = (await pool.query(`
      SELECT username, framedipaddress::text as ip_address, acctstarttime, COALESCE(acctupdatetime, acctstarttime) as last_seen,
             COALESCE(acctsessiontime,0) as uptime_seconds, COALESCE(acctinputoctets,0) as rx_bytes, COALESCE(acctoutputoctets,0) as tx_bytes
      FROM radacct
      WHERE (username=$1 OR username IN (SELECT username FROM subscribers WHERE id=$2 AND username IS NOT NULL))
        AND acctstoptime IS NULL
      ORDER BY COALESCE(acctupdatetime, acctstarttime) DESC NULLS LAST, acctstarttime DESC NULLS LAST
      LIMIT 1
    `, [sub.username || '', id])).rows[0] || null;
    if (rad) {
      const lastSeen = rad.last_seen ? new Date(rad.last_seen).getTime() : 0;
      const fresh = lastSeen && (Date.now() - lastSeen) < 30 * 60 * 1000; // 30 min freshness window
      if (fresh || !session || String(session.status).toUpperCase() !== 'ONLINE') {
        session = {
          status: fresh ? 'ONLINE' : (session?.status || 'ONLINE'),
          ip_address: rad.ip_address || session?.ip_address || null,
          rx_bps: session?.rx_bps || 0,
          tx_bps: session?.tx_bps || 0,
          uptime_seconds: Number(rad.uptime_seconds || 0),
          updated_at: rad.last_seen || session?.updated_at || null,
          username: rad.username || session?.username || sub.username,
          rx_bytes: Number(rad.rx_bytes || 0),
          tx_bytes: Number(rad.tx_bytes || 0),
          source: 'radacct',
        };
      }
    }
  } catch {}
  let pkg: any = null;
  let quota: any = null;
  try {
    if (sub.package_name) {
      pkg = (await pool.query('SELECT id,name,download_mbps,upload_mbps,price,data_cap_gb,fup_speed_mbps,description FROM bandwidth_packages WHERE name=$1 LIMIT 1', [sub.package_name])).rows[0] || null;
    }
    if (pkg?.data_cap_gb != null) {
      const u = (await pool.query(`SELECT COALESCE(SUM(COALESCE(acctinputoctets,0)+COALESCE(acctoutputoctets,0)),0)::bigint AS used_bytes
        FROM radacct WHERE (username=$1 OR username IN (SELECT username FROM subscribers WHERE id=$2 AND username IS NOT NULL)) AND acctstarttime >= date_trunc('month', now())`, [sub.username || '', id])).rows[0];
      const used = Number(u?.used_bytes || 0);
      const capBytes = Number(pkg.data_cap_gb) * 1024 * 1024 * 1024;
      quota = { period: 'current_month', cap_gb: Number(pkg.data_cap_gb), fup_speed_mbps: pkg.fup_speed_mbps, used_bytes: used, remaining_bytes: Math.max(0, capBytes - used), over_cap: used > capBytes, percent: capBytes > 0 ? Math.min(999, (used / capBytes) * 100) : 0 };
    }
  } catch {}
  res.json({ ok: true, subscriber: sub, session, package: pkg, quota });
}));

router.put('/profile', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const b = req.body || {};
  const r = await pool.query(`UPDATE subscribers SET phone=COALESCE($1,phone), email=COALESCE($2,email), address=COALESCE($3,address), nid_number=COALESCE($4,nid_number), updated_at=now() WHERE id=$5 RETURNING id, client_code, full_name, username, phone, email, status, package_name, address, nid_number`,
    [b.phone ?? null, b.email ?? null, b.address ?? null, b.nid_number ?? null, id]);
  res.json({ ok: true, subscriber: r.rows[0] || await getSubscriber(id) });
}));

router.post('/change-password', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const b = req.body || {};
  const newPass = String(b.new_password || b.password || '');
  const cur = String(b.current_password || '');
  const pwErr = await validatePasswordPolicy(newPass);
  if (pwErr) return res.status(400).json({ message: pwErr });
  const row = (await pool.query('SELECT password, client_code, username, phone FROM subscribers WHERE id=$1', [id])).rows[0];
  if (!row) return res.status(404).json({ message: 'Subscriber not found' });
  const stored = row.password ? String(row.password) : '';
  let okCurrent = false;
  if (stored && isHashed(stored)) okCurrent = await verifyPassword(cur, stored);
  else if (stored) okCurrent = stored === cur;
  else okCurrent = (cur === String(row.client_code||'') || cur === String(row.username||'') || cur === String(row.phone||''));
  if (!okCurrent) return res.status(401).json({ message: 'Current password is incorrect' });
  await pool.query('UPDATE subscribers SET password=$1, updated_at=now() WHERE id=$2', [await hashPassword(newPass), id]);
  res.json({ ok: true, message: 'Password updated' });
}));

router.get('/invoices', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const r = await pool.query(`SELECT id, invoice_number, bill_month, period_start, period_end, issue_date, due_date, total_amount, paid_amount, due_amount, status, 'BDT' as currency FROM invoices WHERE subscriber_id=$1 ORDER BY issue_date DESC, created_at DESC LIMIT 100`, [id]);
  res.json({ ok: true, data: r.rows });
}));

router.get('/invoices/:id', portalAuth, asyncHandler(async (req, res) => {
  const inv = await getInvoiceWithItems(req.params.id);
  if (!inv || String(inv.subscriber_id) !== String((req as any).portal.sub)) return res.status(404).json({ message: 'Invoice not found' });
  res.json({ ok: true, invoice: inv });
}));

router.get('/invoices/:id/pdf', portalAuth, asyncHandler(async (req, res) => {
  const inv = await getInvoiceWithItems(req.params.id);
  if (!inv || String(inv.subscriber_id) !== String((req as any).portal.sub)) return res.status(404).json({ message: 'Invoice not found' });
  const pdf = renderSimpleInvoicePdf(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${inv.invoice_number || inv.id}.pdf"`);
  res.send(pdf);
}));

router.get('/payments', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const r = await pool.query(`SELECT id, payment_ref, invoice_id, gateway, method, amount, currency, status, trx_id, created_at, verified_at FROM payments WHERE subscriber_id=$1 ORDER BY created_at DESC LIMIT 100`, [id]);
  res.json({ ok: true, data: r.rows });
}));

router.get('/gateways', asyncHandler(async (_req, res) => {
  // public list of enabled gateways for portal checkout (no secrets)
  const r = await pool.query(`SELECT gateway, enabled, mode, config FROM payment_gateway_configs WHERE enabled=true ORDER BY gateway`).catch(()=>({ rows: [] as any[] }));
  const list = (r.rows || []).map((g:any)=>({ gateway: g.gateway, mode: g.mode, label: g.config?.label || String(g.gateway).toUpperCase() }));
  res.json({ ok: true, data: list.length ? list : [{gateway:'bkash',mode:'SANDBOX'},{gateway:'nagad',mode:'SANDBOX'},{gateway:'stripe',mode:'SANDBOX'}] });
}));

router.post('/payments/checkout', portalAuth, asyncHandler(async (req, res) => {
  const subId = (req as any).portal.sub;
  const b = req.body || {};
  const gateway = String(b.gateway || '').toLowerCase();
  if (!gateway) return res.status(400).json({ message: 'gateway is required' });
  const invoice = b.invoice_id ? (await pool.query('SELECT * FROM invoices WHERE id=$1 AND subscriber_id=$2', [b.invoice_id, subId])).rows[0] : null;
  if (b.invoice_id && !invoice) return res.status(404).json({ message: 'Invoice not found' });
  const subscriber = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subId])).rows[0];
  // For invoice payments the amount is fixed by the invoice — never let the
  // caller pick a smaller amount and still have the invoice marked as paid.
  const amount = invoice ? Number(invoice.due_amount || invoice.total_amount || 0) : Number(b.amount || 0);
  if (!(amount > 0)) return res.status(400).json({ message: 'amount must be > 0' });
  const cfg = (await pool.query('SELECT * FROM payment_gateway_configs WHERE gateway=$1', [gateway])).rows[0] || null;
  const kernel = getKernel();
  const pluginMeta = kernel?.listPlugins().find((p:any) => p.type === 'PAYMENT_GATEWAY' && (p.id === gateway || p.id === `payment-${gateway}` || String(p.name||'').toLowerCase().includes(gateway)));
  const plugin = pluginMeta ? kernel?.getPlugin(pluginMeta.id)?.instance : null;
  const payment_ref = `PORTAL-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
  let checkout: any = { ok: false };
  if (plugin && typeof plugin.createCheckoutSession === 'function') {
    try { checkout = await plugin.createCheckoutSession({ invoiceId: invoice?.id, paymentRef: payment_ref, amount, currency: b.currency || 'BDT', subscriber, invoice, returnUrl: b.return_url, cancelUrl: b.cancel_url, webhookUrl: b.webhook_url, metadata: b.metadata || {}, mode: (cfg?.mode || 'SANDBOX'), config: cfg?.config || {}, credentials: cfg?.credentials || {}, webhookSecret: cfg?.webhook_secret || null }); } catch(e:any){ checkout = { ok:false, message:e.message }; }
  } else {
    checkout = { ok: true, gateway, paymentUrl: `https://sandbox-payments.izandesk.local/${gateway}/checkout?payment_ref=${encodeURIComponent(payment_ref)}&amount=${amount}`, simulated: true };
  }
  const p = await pool.query(`INSERT INTO payments(payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, checkout_url, client_secret, gateway_response)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10::jsonb) RETURNING *`,
    [payment_ref, invoice?.id || null, subId, gateway, b.method || 'portal', amount, b.currency || 'BDT', checkout.paymentUrl || checkout.approvalUrl || null, checkout.clientSecret || null, JSON.stringify(checkout)]);
  res.json({ ok: true, payment: p.rows[0], checkout });
}));

router.get('/tickets', portalAuth, asyncHandler(async (req, res) => {
  const sub = await getSubscriber((req as any).portal.sub);
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });
  const r = await pool.query(`SELECT t.*, (SELECT COUNT(*)::int FROM ticket_comments c WHERE c.ticket_id=t.id) as comment_count
    FROM tickets t WHERE t.subscriber_id=$1 ORDER BY t.created_at DESC LIMIT 100`, [sub.id]);
  res.json({ ok: true, data: r.rows });
}));

router.post('/tickets', portalAuth, asyncHandler(async (req, res) => {
  const sub = await getSubscriber((req as any).portal.sub);
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });
  const b = req.body || {};
  if (!b.subject) return res.status(400).json({ message: 'subject is required' });
  const priority = String(b.priority || 'MEDIUM').toUpperCase();
  const hours = priority === 'CRITICAL' ? 4 : priority === 'HIGH' ? 8 : priority === 'LOW' ? 48 : 24;
  const due = new Date(Date.now() + hours*3600*1000);
  const ticketNo = await nextTicketNo();
  const gps = (sub as any).latitude && (sub as any).longitude ? `https://www.google.com/maps/search/?api=1&query=${(sub as any).latitude},${(sub as any).longitude}` : (sub.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sub.address)}` : null);
  // try to include site coords if present
  const full = (await pool.query('SELECT latitude, longitude, address, reseller_id FROM subscribers WHERE id=$1', [sub.id])).rows[0] || {};
  const lat = full.latitude ?? null; const lng = full.longitude ?? null;
  const siteAddr = b.site_address || full.address || sub.address || null;
  const gpsUrl = (lat!=null && lng!=null) ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : (siteAddr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteAddr)}` : null);
  const r = await pool.query(`INSERT INTO tickets(ticket_no,subscriber_id,reseller_id,subject,description,category,priority,status,sla_policy,sla_due_at,dispatch_status,site_latitude,site_longitude,site_address,gps_nav_url,source,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,'UNASSIGNED',$10,$11,$12,$13,'PORTAL',$14) RETURNING *`,
    [ticketNo, sub.id, full.reseller_id || null, b.subject, b.description||null, b.category||'SUPPORT', priority, `${priority} SLA`, due, lat, lng, siteAddr, gpsUrl, sub.client_code || sub.username || sub.id]);
  res.status(201).json({ ok: true, data: r.rows[0] });
}));

router.get('/tickets/:id', portalAuth, asyncHandler(async (req, res) => {
  const subId = (req as any).portal.sub;
  const r = await pool.query(`SELECT * FROM tickets WHERE id=$1 AND subscriber_id=$2`, [req.params.id, subId]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Ticket not found' });
  const comments = await pool.query(`SELECT id, ticket_id, author_name, author_role, body, is_internal, created_at FROM ticket_comments WHERE ticket_id=$1 AND COALESCE(is_internal,false)=false ORDER BY created_at ASC`, [req.params.id]);
  res.json({ ok: true, data: { ...r.rows[0], comments: comments.rows } });
}));

router.post('/tickets/:id/comments', portalAuth, asyncHandler(async (req, res) => {
  const sub = await getSubscriber((req as any).portal.sub);
  const b = req.body || {};
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });
  if (!b.body) return res.status(400).json({ message: 'body is required' });
  const t = (await pool.query('SELECT id FROM tickets WHERE id=$1 AND subscriber_id=$2', [req.params.id, sub.id])).rows[0];
  if (!t) return res.status(404).json({ message: 'Ticket not found' });
  const r = await pool.query(`INSERT INTO ticket_comments(ticket_id,author_name,author_role,body,is_internal) VALUES($1,$2,'CUSTOMER',$3,false) RETURNING id, ticket_id, author_name, author_role, body, is_internal, created_at`,
    [req.params.id, sub.full_name || sub.client_code || 'Customer', b.body]);
  await pool.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [req.params.id]);
  res.status(201).json({ ok: true, data: r.rows[0] });
}));

router.get('/usage', portalAuth, asyncHandler(async (req, res) => {
  const sub = await getSubscriber((req as any).portal.sub);
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });
  const sessions = await pool.query(`
    SELECT radacctid, username, acctstarttime, acctstoptime, acctsessiontime,
           COALESCE(acctinputoctets,0) as rx_bytes, COALESCE(acctoutputoctets,0) as tx_bytes,
           framedipaddress::text as ip_address, nasipaddress::text as nas_ip, acctterminatecause
    FROM radacct
    WHERE (username=$1 OR username IN (SELECT username FROM subscribers WHERE id=$2 AND username IS NOT NULL))
    ORDER BY acctstarttime DESC NULLS LAST
    LIMIT 100
  `, [sub.username || '', sub.id]).catch(()=>({ rows: [] as any[] }));
  const daily = await pool.query(`
    SELECT date_trunc('day', acctstarttime) as day,
           COUNT(*)::int as sessions,
           COALESCE(SUM(acctsessiontime),0)::bigint as session_seconds,
           COALESCE(SUM(acctinputoctets),0)::bigint as rx_bytes,
           COALESCE(SUM(acctoutputoctets),0)::bigint as tx_bytes
    FROM radacct
    WHERE (username=$1 OR username IN (SELECT username FROM subscribers WHERE id=$2 AND username IS NOT NULL))
      AND acctstarttime >= now() - interval '30 days'
    GROUP BY 1 ORDER BY 1 DESC
  `, [sub.username || '', sub.id]).catch(()=>({ rows: [] as any[] }));
  res.json({ ok: true, sessions: sessions.rows, daily: daily.rows });
}));

router.get('/announcements', asyncHandler(async (_req, res) => {
  // simple announcements; can be DB-backed later
  res.json({ ok: true, data: [
    { id: 'welcome', title: 'Welcome to IzanDesk Self-Care', body: 'Manage your subscription, invoices, payments, tickets, usage and Wi-Fi settings from this portal.', created_at: new Date().toISOString() }
  ]});
}));



router.get('/packages', portalAuth, asyncHandler(async (_req, res) => {
  const r = await pool.query(`SELECT id, name, download_mbps, upload_mbps, price, description, is_active, data_cap_gb, fup_speed_mbps FROM bandwidth_packages WHERE is_active=true ORDER BY download_mbps ASC`);
  res.json({ ok: true, data: r.rows });
}));

router.post('/package-request', portalAuth, asyncHandler(async (req, res) => {
  const sub = await getSubscriber((req as any).portal.sub);
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });
  const b = req.body || {};
  const pkg = b.package_id ? (await pool.query('SELECT * FROM bandwidth_packages WHERE id=$1', [b.package_id])).rows[0] : (b.package_name ? (await pool.query('SELECT * FROM bandwidth_packages WHERE name=$1 LIMIT 1', [b.package_name])).rows[0] : null);
  const pkgName = pkg?.name || b.package_name || 'Requested package';
  const priority = 'MEDIUM';
  const hours = 24; const due = new Date(Date.now() + hours*3600*1000);
  const ticketNo = await nextTicketNo();
  const full = (await pool.query('SELECT latitude, longitude, address, reseller_id FROM subscribers WHERE id=$1', [sub.id])).rows[0] || {};
  const desc = `Package change/upgrade request from customer portal.\nCurrent: ${sub.package_name || '-'} (${sub.bandwidth_mbps || '-'} Mbps)\nRequested: ${pkgName}${pkg ? ` (${pkg.download_mbps}/${pkg.upload_mbps} Mbps, ${pkg.price})` : ''}\nNotes: ${b.notes || '-'}`;
  const gpsUrl = (full.latitude!=null && full.longitude!=null) ? `https://www.google.com/maps/search/?api=1&query=${full.latitude},${full.longitude}` : (full.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(full.address)}` : null);
  const r = await pool.query(`INSERT INTO tickets(ticket_no,subscriber_id,reseller_id,subject,description,category,priority,status,sla_policy,sla_due_at,dispatch_status,site_latitude,site_longitude,site_address,gps_nav_url,source,created_by)
    VALUES($1,$2,$3,$4,$5,'BILLING',$6,'OPEN',$7,$8,'UNASSIGNED',$9,$10,$11,$12,'PORTAL',$13) RETURNING *`,
    [ticketNo, sub.id, full.reseller_id || null, `Package change request: ${pkgName}`, desc, priority, `${priority} SLA`, due, full.latitude ?? null, full.longitude ?? null, full.address || null, gpsUrl, sub.client_code || sub.username || sub.id]);
  res.status(201).json({ ok: true, data: r.rows[0], requested_package: pkg || { name: pkgName } });
}));

router.get('/documents', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const r = await pool.query('SELECT id, doc_type, file_name, mime_type, uploaded_at FROM kyc_documents WHERE subscriber_id=$1 ORDER BY uploaded_at DESC', [id]);
  res.json({ ok: true, data: r.rows });
}));

router.get('/documents/:docId/download', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const r = await pool.query('SELECT * FROM kyc_documents WHERE id=$1 AND subscriber_id=$2', [req.params.docId, id]);
  const doc = r.rows[0];
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  const fp = path.resolve(uploadDir, String(doc.file_path || ''));
  if (!fp.startsWith(uploadDir + path.sep)) return res.status(400).json({ message: 'Invalid document path' });
  if (!fs.existsSync(fp)) return res.status(404).json({ message: 'File not found' });
  const mime = String(doc.mime_type || '');
  const safeName = String(doc.file_name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', KYC_MIME_RE.test(mime) ? mime : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  fs.createReadStream(fp).pipe(res);
}));

router.post('/documents', portalAuth, upload.single('file'), asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  if (!(req as any).file) return res.status(400).json({ message: 'file is required' });
  const f = (req as any).file;
  const docType = String(req.body.doc_type || 'OTHER');
  const r = await pool.query(
    'INSERT INTO kyc_documents(subscriber_id,doc_type,file_name,file_path,mime_type) VALUES($1,$2,$3,$4,$5) RETURNING id,doc_type,file_name,mime_type,uploaded_at',
    [id, docType, f.originalname, f.filename, f.mimetype]
  );
  res.status(201).json({ ok: true, data: r.rows[0] });
}));

router.get('/notifications', portalAuth, asyncHandler(async (req, res) => {
  const sub = await getSubscriber((req as any).portal.sub);
  if (!sub) return res.json({ ok: true, data: [] });
  const phone = sub.phone ? String(sub.phone) : null;
  let msgs: any[] = [];
  try {
    const r = await pool.query(`SELECT id, channel_type, provider, recipient, subject, body, status, related_type, created_at, sent_at
      FROM message_logs
      WHERE ($1::text IS NOT NULL AND recipient = $1)
         OR (related_type='SUBSCRIBER' AND related_id=$2)
      ORDER BY created_at DESC LIMIT 50`, [phone, String(sub.id)]);
    msgs = r.rows;
  } catch {}
  const ann = [{ id: 'welcome', type:'ANNOUNCEMENT', title: 'Welcome to IzanDesk Self-Care', body: 'Manage subscription, invoices, payments, usage, tickets, documents and Wi-Fi from your portal.', created_at: new Date().toISOString() }];
  res.json({ ok: true, announcements: ann, messages: msgs });
}));



router.get('/preferences', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const r = await pool.query('SELECT auto_pay_enabled, preferred_gateway FROM subscribers WHERE id=$1', [id]);
  res.json({ ok: true, preferences: r.rows[0] || { auto_pay_enabled: false, preferred_gateway: null } });
}));

router.put('/preferences', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const b = req.body || {};
  const auto = b.auto_pay_enabled === true || b.auto_pay_enabled === 'true';
  const gw = b.preferred_gateway ? String(b.preferred_gateway).toLowerCase() : null;
  const r = await pool.query('UPDATE subscribers SET auto_pay_enabled=$1, preferred_gateway=$2, updated_at=now() WHERE id=$3 RETURNING auto_pay_enabled, preferred_gateway', [auto, gw, id]);
  res.json({ ok: true, preferences: r.rows[0] });
}));

router.get('/live', portalAuth, asyncHandler(async (req, res) => {
  const sub = await getSubscriber((req as any).portal.sub);
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });
  const sess = (await pool.query(`SELECT status, rx_bps, tx_bps, uptime_sec as uptime_seconds, ip_address, updated_at, username FROM subscriber_sessions WHERE subscriber_id=$1 ORDER BY updated_at DESC LIMIT 1`, [sub.id])).rows[0] || null;
  let live = sess;
  try {
    const rad = (await pool.query(`
      SELECT username, framedipaddress::text as ip_address, COALESCE(acctsessiontime,0) as uptime_seconds,
             COALESCE(acctinputoctets,0) as rx_bytes, COALESCE(acctoutputoctets,0) as tx_bytes, COALESCE(acctupdatetime, acctstarttime) as last_seen
      FROM radacct WHERE (username=$1 OR username IN (SELECT username FROM subscribers WHERE id=$2 AND username IS NOT NULL)) AND acctstoptime IS NULL
      ORDER BY COALESCE(acctupdatetime, acctstarttime) DESC NULLS LAST LIMIT 1`, [sub.username || '', sub.id])).rows[0];
    if (rad) {
      const fresh = rad.last_seen && (Date.now() - new Date(rad.last_seen).getTime()) < 30*60*1000;
      live = { status: fresh ? 'ONLINE' : (sess?.status||'ONLINE'), ip_address: rad.ip_address || sess?.ip_address, rx_bps: sess?.rx_bps||0, tx_bps: sess?.tx_bps||0, uptime_seconds: Number(rad.uptime_seconds||0), rx_bytes: Number(rad.rx_bytes||0), tx_bytes: Number(rad.tx_bytes||0), updated_at: rad.last_seen || sess?.updated_at, source:'radacct' };
    }
  } catch {}
  res.json({ ok: true, session: live, t: Date.now() });
}));



router.get('/payment-methods', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const r = await pool.query(`SELECT id, gateway, label, masked_identifier, is_default, status, created_at, updated_at FROM saved_payment_methods WHERE subscriber_id=$1 ORDER BY is_default DESC, created_at DESC`, [id]);
  res.json({ ok: true, data: r.rows });
}));

router.post('/payment-methods', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const b = req.body || {};
  const gateway = String(b.gateway || '').toLowerCase().trim();
  if (!gateway) return res.status(400).json({ message: 'gateway is required' });
  // Scaffolding: stores a method reference/label. Real tokenization/mandates must be established via gateway-specific flows/callbacks.
  const label = b.label ? String(b.label).slice(0, 120) : null;
  const masked = b.masked_identifier ? String(b.masked_identifier).slice(0, 120) : null;
  const tokenRef = b.token_ref ? String(b.token_ref).slice(0, 255) : null;
  const isDefault = !!b.is_default;
  if (isDefault) await pool.query('UPDATE saved_payment_methods SET is_default=false WHERE subscriber_id=$1', [id]);
  const r = await pool.query(`INSERT INTO saved_payment_methods(subscriber_id,gateway,label,token_ref,masked_identifier,is_default,status,metadata)
    VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',$7::jsonb) RETURNING id,gateway,label,masked_identifier,is_default,status,created_at,updated_at`,
    [id, gateway, label, tokenRef, masked, isDefault, JSON.stringify({ source: 'portal_scaffold', note: 'Requires gateway tokenization/mandate flow for real auto-pay' })]);
  res.status(201).json({ ok: true, data: r.rows[0], note: 'Saved as a payment method reference. Automatic charging requires gateway tokenization/mandate integration.' });
}));

router.delete('/payment-methods/:id', portalAuth, asyncHandler(async (req, res) => {
  const subId = (req as any).portal.sub;
  await pool.query('DELETE FROM saved_payment_methods WHERE id=$1 AND subscriber_id=$2', [req.params.id, subId]);
  res.json({ ok: true });
}));


router.get('/speedtest/download', (_req, res) => {
  const size = 2 * 1024 * 1024;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(size));
  res.end(Buffer.alloc(size, 'a'));
});
router.post('/speedtest/upload', express.raw({ type: '*/*', limit: '10mb' }), (req: any, res) => {
  const bytes = req.body ? (Buffer.isBuffer(req.body) ? req.body.length : Buffer.byteLength(String(req.body))) : 0;
  res.json({ ok: true, received: bytes });
});

export default router;
