import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { runBatchInvoicing, generateInvoiceForSubscriber, listInvoices, getInvoiceWithItems, evaluateDuePolicies, getBillingMetrics, recordPaymentAndReactivate, applyProvisioningState, recalcSubscriberDue, reactivateSubscriber, ensureOverdueInvoiceStatuses, ingestMfsSmsEvent, runFupEnforcementSweep, evaluateFupForSubscriber } from '../integrations/billing';
import { getKernel } from '../kernel/kernel-instance';
import { mikrotikProvisionWalledGardenRedirect } from '../integrations/mikrotik';
import crypto from 'crypto';
import { dispatchMessage, trySendTemplateToSubscriber } from '../integrations/messaging';
import { renderInvoiceHtml, renderSimpleInvoicePdf } from '../integrations/pdf';

const router: Router = Router();

function requireBillingRole(req: any, res: any) {
  const role = req.user?.role;
  if (!role) { res.status(401).json({ message: 'Unauthorized' }); return false; }
  if (!['SUPER_ADMIN','BILLING_OPERATOR','RESELLER'].includes(role)) { res.status(403).json({ message: 'Insufficient permissions for billing operations' }); return false; }
  return true;
}

router.get('/metrics', asyncHandler(async (_req, res) => {
  const metrics = await getBillingMetrics();
  res.json({ ok: true, metrics });
}));

router.get('/invoices', asyncHandler(async (req, res) => {
  const data = await listInvoices(req.query || {});
  res.json({ ok: true, data });
}));

router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const inv = await getInvoiceWithItems(req.params.id);
  if (!inv) return res.status(404).json({ message: 'Invoice not found' });
  res.json({ ok: true, invoice: inv });
}));

router.post('/invoices/generate', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const b = req.body || {};
  const base = `${req.protocol}://${req.get('host')}`;
  if (b.subscriber_id) {
    const s = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [b.subscriber_id])).rows[0];
    if (!s) return res.status(404).json({ message: 'Subscriber not found' });
    const result = await generateInvoiceForSubscriber(s, { cycleDate: b.cycle_date ? new Date(b.cycle_date) : new Date(), force: !!b.force });
    if (result?.ok && result.invoice?.id) {
      const pdfUrl = `${base}/api/billing/invoices/${result.invoice.id}/pdf?token=${result.invoice.id}`;
      try { await trySendTemplateToSubscriber(s.id, 'invoice_delivery_whatsapp', { invoice_number: result.invoice.invoice_number, amount: result.invoice.total_amount, due: result.invoice.due_amount, pdf_url: pdfUrl }, { channel_type: 'WHATSAPP' }); } catch {}
      try { await trySendTemplateToSubscriber(s.id, 'invoice_due_reminder_sms', { invoice_number: result.invoice.invoice_number, amount: result.invoice.total_amount, due: result.invoice.due_amount, due_date: result.invoice.due_date }, { channel_type: 'SMS' }); } catch {}
      (result as any).pdf_url = pdfUrl;
    }
    return res.json({ ok: true, ...result });
  }
  const result = await runBatchInvoicing({ subscriber_ids: b.subscriber_ids, cycleDate: b.cycle_date });
  res.json(result);
}));

router.post('/invoices/:id/cancel', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const inv = (await pool.query("UPDATE invoices SET status='CANCELLED', updated_at=now() WHERE id=$1 RETURNING *", [req.params.id])).rows[0];
  if (!inv) return res.status(404).json({ message: 'Invoice not found' });
  if (inv.subscriber_id) await recalcSubscriberDue(inv.subscriber_id);
  res.json({ ok: true, invoice: inv });
}));

router.get('/policies', asyncHandler(async (_req, res) => {
  const r = await pool.query('SELECT * FROM billing_policies ORDER BY is_default DESC, created_at ASC');
  res.json({ ok: true, data: r.rows });
}));

router.post('/policies', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ message: 'name is required' });
  if (b.is_default) await pool.query('UPDATE billing_policies SET is_default=false');
  const r = await pool.query(`INSERT INTO billing_policies(name, grace_days, warning_days, auto_suspend, isolate_on_suspend, enable_walled_garden, walled_garden_profile, late_fee_enabled, late_fee_amount, late_fee_percent, currency, is_default, config)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING *`,
    [b.name, Number(b.grace_days ?? 7), Number(b.warning_days ?? 3), b.auto_suspend !== false, b.isolate_on_suspend !== false, b.enable_walled_garden !== false, b.walled_garden_profile || null, !!b.late_fee_enabled, Number(b.late_fee_amount||0), Number(b.late_fee_percent||0), b.currency || 'BDT', !!b.is_default, JSON.stringify(b.config||{})]);
  res.status(201).json({ ok: true, policy: r.rows[0] });
}));

router.post('/suspension/evaluate', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  await ensureOverdueInvoiceStatuses();
  const result = await evaluateDuePolicies();
  res.json(result);
}));

router.post('/fup/evaluate', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const result = await runFupEnforcementSweep();
  res.json(result);
}));



router.post('/fup/subscribers/:id/evaluate', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const result = await evaluateFupForSubscriber(req.params.id);
  res.json(result);
}));

router.post('/fup/subscribers/:id/clear', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const result = await evaluateFupForSubscriber(req.params.id, { forceAction: 'CLEAR' });
  res.json(result);
}));

router.post('/fup/subscribers/:id/apply', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const result = await evaluateFupForSubscriber(req.params.id, { forceAction: 'APPLY' });
  res.json(result);
}));

router.get('/fup/logs', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const subId = req.query.subscriber_id ? String(req.query.subscriber_id) : null;
  const params: any[] = [];
  let where = '';
  if (subId) { params.push(subId); where = 'WHERE l.subscriber_id=$1'; }
  const r = await pool.query(`SELECT l.*, s.client_code, s.full_name, s.username, s.package_name
    FROM fup_enforcement_logs l LEFT JOIN subscribers s ON s.id=l.subscriber_id
    ${where} ORDER BY l.created_at DESC LIMIT 200`, params);
  res.json({ ok: true, data: r.rows });
}));

router.post('/subscribers/:id/suspend', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const b = req.body || {};
  const walled = !!b.walled_garden;
  const stage = walled ? 'WALLED_GARDEN' : 'ISOLATED';
  const status = walled ? 'ACTIVE' : 'SUSPENDED';
  await pool.query(`UPDATE subscribers SET status=$2, suspension_stage=$3, walled_garden=$4, suspension_reason=$5, updated_at=now() WHERE id=$1`, [req.params.id, status, stage, walled, b.reason || 'Manual suspension']);
  const applied = await applyProvisioningState(req.params.id, { status, stage, walled_garden: walled, reason: b.reason || 'Manual suspension', sendCoa: true, coaAction: walled ? 'COA' : 'DISCONNECT', profileOverride: walled ? 'izn-walled-garden' : undefined, coaRateLimit: walled ? '64k/64k' : undefined, addressList: walled ? 'izn-walled-garden' : undefined });
  await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'MANUAL_SUSPEND',$2,$3,$4::jsonb,$5)`, [req.params.id, stage, b.reason || 'Manual suspension', JSON.stringify({ walled_garden: walled }), (req as any).user?.email || 'user']);
  res.json({ ok: true, applied });
}));

router.post('/payments/sms/ingest', asyncHandler(async (req, res) => {
  // allow either authenticated billing/admin user or shared SMS ingest token
  const auth = String(req.headers.authorization || '');
  const smsToken = String(req.headers['x-sms-token'] || req.query.token || req.body?.token || '');
  const expected = process.env.MFS_SMS_INGEST_TOKEN || process.env.SMS_INGEST_TOKEN || '';
  let authorized = !!(auth.startsWith('Bearer ') || (req as any).user);
  if (!authorized && expected && smsToken && smsToken === expected) authorized = true;
  if (!authorized && !expected) {
    // no token configured: only allow from trusted/authenticated context; reject anonymous to be safe
    return res.status(401).json({ ok: false, message: 'Unauthorized SMS ingest (configure MFS_SMS_INGEST_TOKEN or authenticate)' });
  }
  if (!authorized) return res.status(401).json({ ok: false, message: 'Invalid SMS ingest token' });

  const b = req.body || {};
  const gateway = String(b.gateway || 'bkash').toLowerCase();
  const payload = b.payload || b;
  // parse via plugin hook if available
  let parsed: any = { amount: b.amount, trxId: b.trx_id || b.trxId, payer_number: b.sender || b.payer_number || b.msisdn, text: b.message || b.text };
  try {
    const kernel = getKernel();
    const pluginMeta = kernel?.listPlugins().find(p => p.type === 'PAYMENT_GATEWAY' && (p.id === gateway || p.id === `payment-${gateway}` || p.name.toLowerCase().includes(gateway)));
    const plugin = pluginMeta ? kernel?.getPlugin(pluginMeta.id)?.instance : null;
    if (plugin && typeof plugin.onMfsSms === 'function') {
      const r = await plugin.onMfsSms({ ...payload, gateway, sender: b.sender, message: b.message || b.text });
      parsed = { ...parsed, ...r, amount: r?.amount ?? parsed.amount, trxId: r?.trxId ?? parsed.trxId, payer_number: r?.payer?.msisdn ?? parsed.payer_number, text: r?.text ?? parsed.text };
    }
  } catch {}
  const result = await ingestMfsSmsEvent({ gateway, sender: b.sender || parsed.payer_number, message: parsed.text || b.message || b.text, amount: parsed.amount != null ? Number(parsed.amount) : undefined, trx_id: parsed.trxId || b.trx_id, payer_number: parsed.payer_number || b.sender, payload: { raw: b, parsed } });
  res.json(result);
}));

router.get('/payments/sms', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const r = await pool.query('SELECT * FROM payment_sms_events ORDER BY created_at DESC LIMIT 200');
  res.json({ ok: true, data: r.rows });
}));

router.post('/subscribers/:id/reactivate', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const result = await reactivateSubscriber(req.params.id, req.body?.reason || 'Manual reactivation');
  res.json(result);
}));

router.get('/gateways', asyncHandler(async (_req, res) => {
  const cfg = (await pool.query('SELECT gateway, enabled, mode, config, updated_at, (credentials IS NOT NULL AND credentials <> \'{}\'::jsonb) as has_credentials FROM payment_gateway_configs ORDER BY gateway')).rows;
  const kernel = getKernel();
  const plugins = kernel ? kernel.listPlugins().filter(p => p.type === 'PAYMENT_GATEWAY') : [];
  res.json({ ok: true, data: cfg, plugins });
}));

router.post('/gateways/:gateway', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const b = req.body || {};
  const r = await pool.query(`INSERT INTO payment_gateway_configs(gateway, enabled, mode, config, credentials, webhook_secret, updated_at)
    VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,now())
    ON CONFLICT (gateway) DO UPDATE SET enabled=COALESCE($2,payment_gateway_configs.enabled), mode=COALESCE($3,payment_gateway_configs.mode), config=COALESCE($4::jsonb,payment_gateway_configs.config), credentials=COALESCE($5::jsonb,payment_gateway_configs.credentials), webhook_secret=COALESCE($6,payment_gateway_configs.webhook_secret), updated_at=now() RETURNING gateway,enabled,mode,config,updated_at`,
    [req.params.gateway, b.enabled, b.mode, b.config ? JSON.stringify(b.config) : null, b.credentials ? JSON.stringify(b.credentials) : null, b.webhook_secret || null]);
  res.json({ ok: true, gateway: r.rows[0] });
}));

async function getGatewayConfig(gateway: string) {
  const r = await pool.query('SELECT * FROM payment_gateway_configs WHERE gateway=$1', [gateway]);
  return r.rows[0] || null;
}

router.get('/payments', asyncHandler(async (req, res) => {
  const where: string[] = []; const params: any[] = [];
  if (req.query.subscriber_id) { params.push(req.query.subscriber_id); where.push(`p.subscriber_id=$${params.length}`); }
  if (req.query.status) { params.push(req.query.status); where.push(`p.status=$${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(`SELECT p.*, s.full_name, s.client_code, i.invoice_number FROM payments p LEFT JOIN subscribers s ON s.id=p.subscriber_id LEFT JOIN invoices i ON i.id=p.invoice_id ${w} ORDER BY p.created_at DESC LIMIT 200`, params);
  res.json({ ok: true, data: r.rows });
}));

router.post('/payments/checkout', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const b = req.body || {};
  const gateway = String(b.gateway || '').toLowerCase();
  if (!gateway) return res.status(400).json({ message: 'gateway is required' });
  const invoice = b.invoice_id ? (await pool.query('SELECT * FROM invoices WHERE id=$1', [b.invoice_id])).rows[0] : null;
  if (b.invoice_id && !invoice) return res.status(404).json({ message: 'Invoice not found' });
  const subscriber = invoice?.subscriber_id ? (await pool.query('SELECT * FROM subscribers WHERE id=$1', [invoice.subscriber_id])).rows[0] : (b.subscriber_id ? (await pool.query('SELECT * FROM subscribers WHERE id=$1', [b.subscriber_id])).rows[0] : null);
  const amount = Number(b.amount || invoice?.due_amount || invoice?.total_amount || 0);
  if (!(amount > 0)) return res.status(400).json({ message: 'amount must be > 0' });
  const cfg = await getGatewayConfig(gateway);
  const kernel = getKernel();
  const pluginMeta = kernel?.listPlugins().find(p => p.type === 'PAYMENT_GATEWAY' && (p.id === gateway || p.id === `payment-${gateway}` || p.name.toLowerCase().includes(gateway)));
  const plugin = pluginMeta ? kernel?.getPlugin(pluginMeta.id)?.instance : null;
  const payment_ref = b.payment_ref || `PAY-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;

  let checkout: any = { ok: false, gateway, message: 'Payment plugin not available' };
  if (plugin && typeof plugin.createCheckoutSession === 'function') {
    try {
      checkout = await plugin.createCheckoutSession({
        invoiceId: invoice?.id, paymentRef: payment_ref, amount, currency: b.currency || invoice?.currency || 'BDT',
        subscriber, invoice, returnUrl: b.return_url, cancelUrl: b.cancel_url, webhookUrl: b.webhook_url,
        metadata: b.metadata || {}, mode: (cfg?.mode || 'SANDBOX')
      });
    } catch (e:any) { checkout = { ok: false, gateway, message: e.message }; }
  } else {
    // fallback simulated checkout URL for sandbox verification flows
    checkout = { ok: true, gateway, paymentUrl: `https://sandbox-payments.izandesk.local/${gateway}/checkout?payment_ref=${encodeURIComponent(payment_ref)}&amount=${amount}`, simulated: true };
  }

  const p = await pool.query(`INSERT INTO payments(payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, checkout_url, client_secret, gateway_response)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10::jsonb) RETURNING *`,
    [payment_ref, invoice?.id || null, subscriber?.id || null, gateway, b.method || null, amount, b.currency || 'BDT', checkout.paymentUrl || checkout.approvalUrl || null, checkout.clientSecret || null, JSON.stringify(checkout)]);

  res.json({ ok: true, payment: p.rows[0], checkout });
}));

router.post('/payments/:paymentRef/confirm', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const b = req.body || {};
  const pr = (await pool.query('SELECT * FROM payments WHERE payment_ref=$1', [req.params.paymentRef])).rows[0];
  if (!pr) return res.status(404).json({ message: 'Payment not found' });
  const result = await recordPaymentAndReactivate({ gateway: pr.gateway, amount: Number(b.amount || pr.amount), invoice_id: pr.invoice_id, subscriber_id: pr.subscriber_id, trx_id: b.trx_id || `SIM-${Date.now()}`, method: b.method || pr.method || 'manual', payer_number: b.payer_number, raw: b, payment_ref: pr.payment_ref, currency: pr.currency, status: 'COMPLETED' });
  res.json(result);
}));

function timingSafeEq(a: string, b: string) {
  const ba = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyWebhookSignature(gateway: string, req: any, cfg: any) {
  const secret = cfg?.webhook_secret || cfg?.credentials?.webhook_secret || cfg?.config?.webhook_secret;
  if (!secret) return { ok: true, skipped: true, reason: 'no webhook secret configured' };
  const raw = JSON.stringify(req.body || {});
  const sigHeader = String(req.headers['x-signature'] || req.headers['x-webhook-signature'] || req.headers['stripe-signature'] || req.headers['x-hook-signature'] || '');
  if (!sigHeader) {
    // allow token-based verification via query/body for some providers/setups
    const token = String(req.query?.token || req.body?.token || req.body?.signature || '');
    if (token && timingSafeEq(token, String(secret))) return { ok: true, mode: 'token' };
    return { ok: false, error: 'missing webhook signature/token' };
  }
  const h = crypto.createHmac('sha256', String(secret)).update(raw).digest('hex');
  const candidate = sigHeader.replace(/^sha256=/i, '').trim();
  if (timingSafeEq(candidate, h)) return { ok: true, mode: 'hmac-sha256' };
  // Stripe-like t=,v1= support best-effort
  const m = sigHeader.match(/v1=([a-f0-9]+)/i);
  if (m) {
    const t = (sigHeader.match(/t=([0-9]+)/i) || [])[1] || '';
    const signed = `${t}.${raw}`;
    const h2 = crypto.createHmac('sha256', String(secret)).update(signed).digest('hex');
    if (timingSafeEq(m[1], h2)) return { ok: true, mode: 'stripe-v1' };
  }
  return { ok: false, error: 'invalid webhook signature' };
}

router.post('/webhooks/:gateway', asyncHandler(async (req, res) => {
  const gateway = String(req.params.gateway || '').toLowerCase();
  const cfg = await getGatewayConfig(gateway);
  const kernel = getKernel();
  const pluginMeta = kernel?.listPlugins().find(p => p.type === 'PAYMENT_GATEWAY' && (p.id === gateway || p.id === `payment-${gateway}` || p.name.toLowerCase().includes(gateway)));
  const plugin = pluginMeta ? kernel?.getPlugin(pluginMeta.id)?.instance : null;
  const payload = req.body || {};

  const sig = verifyWebhookSignature(gateway, req, cfg);
  if (!sig.ok) {
    await pool.query(`INSERT INTO payment_webhook_events(gateway,event_id,payload,processed,processed_at,result) VALUES($1,$2,$3::jsonb,false,now(),$4::jsonb)`,
      [gateway, payload.event_id || payload.id || null, JSON.stringify(payload), JSON.stringify({ ok: false, verified: false, reason: 'signature_verification_failed', sig })]);
    return res.status(401).json({ ok: false, verified: false, message: sig.error || 'Invalid webhook signature' });
  }

  let verification: any = { ok: true, verified: true, status: 'COMPLETED', amount: payload.amount, trxId: payload.trxId || payload.trx_id, paymentRef: payload.paymentRef || payload.payment_ref, invoiceId: payload.invoiceId || payload.invoice_id, raw: payload };
  if (plugin && typeof plugin.verifyWebhook === 'function') {
    try { verification = await plugin.verifyWebhook(payload, req.headers as any, cfg); } catch (e:any) { verification = { ok: false, verified: false, status: 'FAILED', message: e.message, raw: payload }; }
  }

  const eventId = verification.eventId || payload.event_id || payload.id || verification.trxId || payload.trxId || payload.trx_id || null;
  const paymentRef = verification.paymentRef || payload.paymentRef || payload.payment_ref || null;
  const trxId = verification.trxId || payload.trxId || payload.trx_id || null;
  const dedupeKey = [gateway, eventId || '', trxId || '', paymentRef || ''].join('|');
  if (dedupeKey.replace(/\|/g, '').length > gateway.length) {
    const dup = await pool.query('SELECT id, result, processed FROM payment_webhook_events WHERE dedupe_key=$1 LIMIT 1', [dedupeKey]);
    if (dup.rows[0]) {
      return res.json({ ok: true, verified: !!verification.verified, processed: !!dup.rows[0].processed, duplicate: true, event: dup.rows[0] });
    }
  }

  let eventRow: any = null;
  try {
    const ins = await pool.query(`INSERT INTO payment_webhook_events(gateway,event_id,dedupe_key,payload,processed,processed_at,result) VALUES($1,$2,$3,$4::jsonb,$5,now(),$6::jsonb) RETURNING *`,
      [gateway, eventId, (dedupeKey.replace(/\|/g,'').length > gateway.length ? dedupeKey : null), JSON.stringify(payload), verification.verified === true, JSON.stringify(verification)]);
    eventRow = ins.rows[0];
  } catch (e:any) {
    // unique constraint race -> treat as duplicate
    return res.json({ ok: true, verified: !!verification.verified, processed: false, duplicate: true });
  }

  if (verification.verified && (String(verification.status).toUpperCase() === 'COMPLETED' || String(verification.status).toUpperCase() === 'PAID' || String(verification.status).toUpperCase() === 'SUCCESS')) {
    const amount = Number(verification.amount || payload.amount || 0);
    const invoiceId = verification.invoiceId || payload.invoiceId || payload.invoice_id;
    const result = amount > 0 ? await recordPaymentAndReactivate({ gateway, amount, invoice_id: invoiceId, subscriber_id: payload.subscriber_id, trx_id: trxId || undefined, method: payload.method || 'webhook', payer_number: payload.payer || payload.msisdn || verification.payer?.msisdn, raw: payload, payment_ref: paymentRef || undefined, currency: verification.currency || payload.currency || 'BDT', status: 'COMPLETED', dedupe_key: dedupeKey }) : { ok:false, message:'No amount in webhook' };
    await pool.query('UPDATE payment_webhook_events SET processed=true, processed_at=now(), result=$2::jsonb WHERE id=$1', [eventRow?.id, JSON.stringify({ verification, result })]);
    return res.json({ ok: true, verified: true, processed: true, result });
  }
  res.json({ ok: true, verified: !!verification.verified, processed: false, verification });
}));

router.get('/suspension/logs', asyncHandler(async (_req, res) => {
  const r = await pool.query(`SELECT l.*, s.full_name, s.client_code, s.username FROM billing_suspension_logs l LEFT JOIN subscribers s ON s.id=l.subscriber_id ORDER BY l.created_at DESC LIMIT 200`);
  res.json({ ok: true, data: r.rows });
}));

router.post('/walled-garden/provision-router', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const b = req.body || {};
  const routerId = b.router_id || b.routerId;
  if (!routerId) return res.status(400).json({ message: 'router_id is required' });
  const r = await pool.query('SELECT * FROM network_routers WHERE id=$1', [routerId]);
  const router = r.rows[0];
  if (!router) return res.status(404).json({ message: 'Router not found' });
  if (!['API','REST'].includes(String(router.integration_mode || '').toUpperCase())) {
    return res.status(400).json({ ok: false, message: 'Selected router/NAS is not directly manageable via API/REST. Configure walled-garden address-list and redirect/firewall/NAT/DNS rules on the NAS for address-list "izn-walled-garden" to your portal URL.', router: { id: router.id, name: router.name, host: router.host, integration_mode: router.integration_mode } });
  }
  const policy = (await pool.query('SELECT * FROM billing_policies ORDER BY is_default DESC, created_at ASC LIMIT 1')).rows[0] || {};
  const portalUrl = b.portal_url || policy?.config?.portal_url || process.env.WALLED_GARDEN_PORTAL_URL || `${req.protocol}://${req.get('host')}/walled-garden`;
  const result = await mikrotikProvisionWalledGardenRedirect(router, {
    addressList: b.address_list || policy?.config?.walled_garden_address_list || 'izn-walled-garden',
    portalUrl,
    portalHost: b.portal_host,
    portalPort: b.portal_port ? Number(b.portal_port) : undefined,
  });
  await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES(NULL,'WALLED_GARDEN_ROUTER_PROVISION',NULL,$1,$2::jsonb,$3)`,
    ['Provisioned walled-garden redirect/profile rules on router', JSON.stringify({ router_id: router.id, router: router.name, result }), (req as any).user?.email || 'user']);
  res.json({ ok: true, router: { id: router.id, name: router.name, host: router.host, integration_mode: router.integration_mode }, portalUrl, result });
}));


router.get('/invoices/:id/html', asyncHandler(async (req, res) => {
  const inv = await getInvoiceWithItems(req.params.id);
  if (!inv) return res.status(404).send('Invoice not found');
  const base = `${req.protocol}://${req.get('host')}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderInvoiceHtml(inv, { baseUrl: base, paymentUrl: `${base}/billing?invoice=${encodeURIComponent(inv.id)}` }));
}));

router.get('/invoices/:id/pdf', asyncHandler(async (req, res) => {
  const inv = await getInvoiceWithItems(req.params.id);
  if (!inv) return res.status(404).json({ message: 'Invoice not found' });
  const pdf = renderSimpleInvoicePdf(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${inv.invoice_number || inv.id}.pdf"`);
  res.send(pdf);
}));

router.get('/invoices/:id/share', asyncHandler(async (req, res) => {
  const inv = await getInvoiceWithItems(req.params.id);
  if (!inv) return res.status(404).json({ message: 'Invoice not found' });
  const base = `${req.protocol}://${req.get('host')}`;
  const pdfUrl = `${base}/api/billing/invoices/${inv.id}/pdf?token=${inv.id}`;
  const htmlUrl = `${base}/api/billing/invoices/${inv.id}/html?token=${inv.id}`;
  const payUrl = `${base}/billing?invoice=${encodeURIComponent(inv.id)}`;
  res.json({ ok: true, invoice_id: inv.id, invoice_number: inv.invoice_number, pdf_url: pdfUrl, html_url: htmlUrl, payment_url: payUrl });
}));

export default router;