import { pool } from '../db';
import { getKernel } from '../kernel/kernel-instance';
import { ValidationError } from '../routes/helpers';

/** Public list of enabled payment gateways (no secrets/credentials). */
export async function listEnabledGateways() {
  const r = await pool.query(`SELECT gateway, enabled, mode, config FROM payment_gateway_configs WHERE enabled=true ORDER BY gateway`).catch(() => ({ rows: [] as any[] }));
  const list = (r.rows || []).map((g: any) => ({ gateway: g.gateway, mode: g.mode, label: g.config?.label || String(g.gateway).toUpperCase() }));
  return list.length ? list : [{ gateway: 'bkash', mode: 'SANDBOX' }, { gateway: 'nagad', mode: 'SANDBOX' }, { gateway: 'stripe', mode: 'SANDBOX' }];
}

/**
 * Create a gateway checkout session + PENDING payment row for a subscriber.
 * Shared by the authenticated customer portal and the public captive
 * (expiry notice) page — both ultimately collect money for the ISP.
 *
 * For invoice payments the amount is fixed by the invoice — never let the
 * caller pick a smaller amount and still have the invoice marked as paid.
 */
export async function createCheckoutForSubscriber(subId: string, b: any) {
  const gateway = String(b.gateway || '').toLowerCase();
  if (!gateway) throw new ValidationError('gateway is required');
  const invoice = b.invoice_id ? (await pool.query('SELECT * FROM invoices WHERE id=$1 AND subscriber_id=$2', [b.invoice_id, subId])).rows[0] : null;
  if (b.invoice_id && !invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  const subscriber = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subId])).rows[0];
  if (!subscriber) throw Object.assign(new Error('Subscriber not found'), { status: 404 });
  const amount = invoice ? Number(invoice.due_amount || invoice.total_amount || 0) : Number(b.amount || 0);
  if (!(amount > 0)) throw new ValidationError('amount must be > 0');
  const cfg = (await pool.query('SELECT * FROM payment_gateway_configs WHERE gateway=$1', [gateway])).rows[0] || null;
  const kernel = getKernel();
  const pluginMeta = kernel?.listPlugins().find((p: any) => p.type === 'PAYMENT_GATEWAY' && (p.id === gateway || p.id === `payment-${gateway}` || String(p.name || '').toLowerCase().includes(gateway)));
  const plugin = pluginMeta ? kernel?.getPlugin(pluginMeta.id)?.instance : null;
  const payment_ref = `PORTAL-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  let checkout: any = { ok: false };
  if (plugin && typeof plugin.createCheckoutSession === 'function') {
    try {
      checkout = await plugin.createCheckoutSession({ invoiceId: invoice?.id, paymentRef: payment_ref, amount, currency: b.currency || 'BDT', subscriber, invoice, returnUrl: b.return_url, cancelUrl: b.cancel_url, webhookUrl: b.webhook_url, metadata: b.metadata || {}, mode: (cfg?.mode || 'SANDBOX'), config: cfg?.config || {}, credentials: cfg?.credentials || {}, webhookSecret: cfg?.webhook_secret || null });
    } catch (e: any) { checkout = { ok: false, message: e.message }; }
  } else {
    checkout = { ok: true, gateway, paymentUrl: `https://sandbox-payments.izandesk.local/${gateway}/checkout?payment_ref=${encodeURIComponent(payment_ref)}&amount=${amount}`, simulated: true };
  }
  const p = await pool.query(`INSERT INTO payments(payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, checkout_url, client_secret, gateway_response)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10::jsonb) RETURNING *`,
    [payment_ref, invoice?.id || null, subId, gateway, b.method || 'portal', amount, b.currency || 'BDT', checkout.paymentUrl || checkout.approvalUrl || null, checkout.clientSecret || null, JSON.stringify(checkout)]);
  return { ok: true, payment: p.rows[0], checkout };
}
