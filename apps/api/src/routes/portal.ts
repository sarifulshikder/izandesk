import { Router } from 'express';
import express = require('express');
import jwt = require('jsonwebtoken');
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { getInvoiceWithItems } from '../integrations/billing';
import { getKernel } from '../kernel/kernel-instance';
import { renderSimpleInvoicePdf } from '../integrations/pdf';

const router: Router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'izandesk-dev-secret-change-me';

function issuePortalToken(sub: any) {
  return jwt.sign({ type: 'PORTAL_SUBSCRIBER', sub: sub.id, client_code: sub.client_code }, JWT_SECRET, { expiresIn: '7d' });
}
function portalAuth(req: any, res: any, next: any) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ message: 'Missing portal token' });
  try {
    const p: any = jwt.verify(h.slice(7), JWT_SECRET);
    if (p?.type !== 'PORTAL_SUBSCRIBER' || !p?.sub) throw new Error('bad');
    req.portal = p; next();
  } catch { return res.status(401).json({ message: 'Invalid or expired portal session' }); }
}

router.post('/login', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const id = String(b.client_code || b.username || b.phone || '').trim();
  const pass = String(b.password || '').trim();
  if (!id || !pass) return res.status(400).json({ message: 'client_code/username/phone and password are required' });
  const r = await pool.query(`SELECT s.id, s.client_code, s.full_name, s.username, s.phone, s.email, s.status, s.package_name, s.bandwidth_mbps, s.monthly_bill, s.current_due, s.expiry_date, s.address, s.connection_type, s.password
    FROM subscribers s WHERE (lower(s.client_code)=lower($1) OR lower(s.username)=lower($1) OR s.phone=$1) LIMIT 1`, [id]);
  const s = r.rows[0];
  if (!s) return res.status(401).json({ message: 'Invalid credentials' });
  const stored = s.password ? String(s.password) : '';
  // if password is set, require it; if not set, allow login with matching identifier as pass (basic self-care) or exact pass empty-string not allowed
  const ok = stored ? (stored === pass) : (pass === String(s.client_code || '') || pass === String(s.username || '') || pass === String(s.phone || ''));
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
  const token = issuePortalToken(s);
  const { password, ...safe } = s;
  res.json({ ok: true, token, subscriber: safe });
}));

router.get('/me', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const r = await pool.query(`SELECT id, client_code, full_name, username, phone, email, status, package_name, bandwidth_mbps, monthly_bill, current_due, expiry_date, due_date, address, connection_type, provisioning_mode, suspension_stage, walled_garden, created_at
    FROM subscribers WHERE id=$1`, [id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Subscriber not found' });
  const session = (await pool.query(`SELECT status, rx_bps, tx_bps, uptime_sec as uptime_seconds, ip_address, updated_at FROM subscriber_sessions WHERE subscriber_id=$1 ORDER BY updated_at DESC LIMIT 1`, [id])).rows[0] || null;
  res.json({ ok: true, subscriber: r.rows[0], session });
}));

router.get('/invoices', portalAuth, asyncHandler(async (req, res) => {
  const id = (req as any).portal.sub;
  const r = await pool.query(`SELECT id, invoice_number, bill_month, period_start, period_end, issue_date, due_date, total_amount, paid_amount, due_amount, status, currency FROM invoices WHERE subscriber_id=$1 ORDER BY issue_date DESC, created_at DESC LIMIT 100`, [id]);
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

router.post('/payments/checkout', portalAuth, asyncHandler(async (req, res) => {
  const subId = (req as any).portal.sub;
  const b = req.body || {};
  const gateway = String(b.gateway || '').toLowerCase();
  if (!gateway) return res.status(400).json({ message: 'gateway is required' });
  const invoice = b.invoice_id ? (await pool.query('SELECT * FROM invoices WHERE id=$1 AND subscriber_id=$2', [b.invoice_id, subId])).rows[0] : null;
  if (b.invoice_id && !invoice) return res.status(404).json({ message: 'Invoice not found' });
  const subscriber = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subId])).rows[0];
  const amount = Number(b.amount || invoice?.due_amount || invoice?.total_amount || 0);
  if (!(amount > 0)) return res.status(400).json({ message: 'amount must be > 0' });
  const cfg = (await pool.query('SELECT * FROM payment_gateway_configs WHERE gateway=$1', [gateway])).rows[0] || null;
  const kernel = getKernel();
  const pluginMeta = kernel?.listPlugins().find((p:any) => p.type === 'PAYMENT_GATEWAY' && (p.id === gateway || p.id === `payment-${gateway}` || String(p.name||'').toLowerCase().includes(gateway)));
  const plugin = pluginMeta ? kernel?.getPlugin(pluginMeta.id)?.instance : null;
  const payment_ref = `PORTAL-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
  let checkout: any = { ok: false };
  if (plugin && typeof plugin.createCheckoutSession === 'function') {
    try { checkout = await plugin.createCheckoutSession({ invoiceId: invoice?.id, paymentRef: payment_ref, amount, currency: b.currency || invoice?.currency || 'BDT', subscriber, invoice, returnUrl: b.return_url, cancelUrl: b.cancel_url, webhookUrl: b.webhook_url, metadata: b.metadata || {}, mode: (cfg?.mode || 'SANDBOX') }); } catch(e:any){ checkout = { ok:false, message:e.message }; }
  } else {
    checkout = { ok: true, gateway, paymentUrl: `https://sandbox-payments.izandesk.local/${gateway}/checkout?payment_ref=${encodeURIComponent(payment_ref)}&amount=${amount}`, simulated: true };
  }
  const p = await pool.query(`INSERT INTO payments(payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, checkout_url, client_secret, gateway_response)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10::jsonb) RETURNING *`,
    [payment_ref, invoice?.id || null, subId, gateway, b.method || 'portal', amount, b.currency || 'BDT', checkout.paymentUrl || checkout.approvalUrl || null, checkout.clientSecret || null, JSON.stringify(checkout)]);
  res.json({ ok: true, payment: p.rows[0], checkout });
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
