import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { runBatchInvoicing, generateInvoiceForSubscriber, listInvoices, getInvoiceWithItems, evaluateDuePolicies, getBillingMetrics, recordPaymentAndReactivate, applyProvisioningState, recalcSubscriberDue, reactivateSubscriber, ensureOverdueInvoiceStatuses } from '../integrations/billing';
import { getKernel } from '../kernel/kernel-instance';
import crypto from 'crypto';

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
  if (b.subscriber_id) {
    const s = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [b.subscriber_id])).rows[0];
    if (!s) return res.status(404).json({ message: 'Subscriber not found' });
    const result = await generateInvoiceForSubscriber(s, { cycleDate: b.cycle_date ? new Date(b.cycle_date) : new Date(), force: !!b.force });
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

router.post('/subscribers/:id/suspend', asyncHandler(async (req, res) => {
  if (!requireBillingRole(req, res)) return;
  const b = req.body || {};
  await pool.query("UPDATE subscribers SET status='SUSPENDED', suspension_stage='ISOLATED', walled_garden=$2, suspension_reason=$3, updated_at=now() WHERE id=$1", [req.params.id, !!b.walled_garden, b.reason || 'Manual suspension']);
  const applied = await applyProvisioningState(req.params.id, { status: 'SUSPENDED', stage: 'ISOLATED', walled_garden: !!b.walled_garden, reason: b.reason || 'Manual suspension', sendCoa: true, coaAction: 'DISCONNECT' });
  await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'MANUAL_SUSPEND','ISOLATED',$2,$3::jsonb,$4)`, [req.params.id, b.reason || 'Manual suspension', JSON.stringify({ walled_garden: !!b.walled_garden }), (req as any).user?.email || 'user']);
  res.json({ ok: true, applied });
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

router.post('/webhooks/:gateway', asyncHandler(async (req, res) => {
  const gateway = String(req.params.gateway || '').toLowerCase();
  const cfg = await getGatewayConfig(gateway);
  const kernel = getKernel();
  const pluginMeta = kernel?.listPlugins().find(p => p.type === 'PAYMENT_GATEWAY' && (p.id === gateway || p.id === `payment-${gateway}` || p.name.toLowerCase().includes(gateway)));
  const plugin = pluginMeta ? kernel?.getPlugin(pluginMeta.id)?.instance : null;
  const payload = req.body || {};
  let verification: any = { ok: true, verified: true, status: 'COMPLETED', amount: payload.amount, trxId: payload.trxId || payload.trx_id, paymentRef: payload.paymentRef || payload.payment_ref, invoiceId: payload.invoiceId || payload.invoice_id, raw: payload };
  if (plugin && typeof plugin.verifyWebhook === 'function') {
    try { verification = await plugin.verifyWebhook(payload, req.headers as any, cfg); } catch (e:any) { verification = { ok: false, verified: false, status: 'FAILED', message: e.message, raw: payload }; }
  }
  await pool.query(`INSERT INTO payment_webhook_events(gateway,event_id,payload,processed,processed_at,result) VALUES($1,$2,$3::jsonb,$4,now(),$5::jsonb)`,
    [gateway, verification.eventId || payload.event_id || payload.id || null, JSON.stringify(payload), verification.verified === true, JSON.stringify(verification)]);

  if (verification.verified && (String(verification.status).toUpperCase() === 'COMPLETED' || String(verification.status).toUpperCase() === 'PAID')) {
    const amount = Number(verification.amount || payload.amount || 0);
    const paymentRef = verification.paymentRef || payload.paymentRef || payload.payment_ref;
    const invoiceId = verification.invoiceId || payload.invoiceId || payload.invoice_id;
    const result = amount > 0 ? await recordPaymentAndReactivate({ gateway, amount, invoice_id: invoiceId, subscriber_id: payload.subscriber_id, trx_id: verification.trxId || payload.trxId || payload.trx_id, method: payload.method || 'webhook', payer_number: payload.payer || payload.msisdn, raw: payload, payment_ref: paymentRef, currency: verification.currency || payload.currency || 'BDT', status: 'COMPLETED' }) : { ok:false, message:'No amount in webhook' };
    return res.json({ ok: true, verified: true, processed: true, result });
  }
  res.json({ ok: true, verified: !!verification.verified, processed: false, verification });
}));

router.get('/suspension/logs', asyncHandler(async (_req, res) => {
  const r = await pool.query(`SELECT l.*, s.full_name, s.client_code, s.username FROM billing_suspension_logs l LEFT JOIN subscribers s ON s.id=l.subscriber_id ORDER BY l.created_at DESC LIMIT 200`);
  res.json({ ok: true, data: r.rows });
}));

export default router;