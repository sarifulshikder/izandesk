import { pool } from '../db';
import { getKernel } from '../kernel/kernel-instance';
import { ValidationError } from '../routes/helpers';
import { isValidityExpired } from './billing';

/** Public list of enabled payment gateways (no secrets/credentials). */
export async function listEnabledGateways() {
  const r = await pool.query(`SELECT gateway, enabled, mode, config FROM payment_gateway_configs WHERE enabled=true ORDER BY gateway`).catch(() => ({ rows: [] as any[] }));
  const list = (r.rows || []).map((g: any) => ({ gateway: g.gateway, mode: g.mode, label: g.config?.label || String(g.gateway).toUpperCase() }));
  if (list.length) return list;
  // Only advertise simulated gateways where simulation is explicitly allowed:
  // development by default, production only with the documented SANDBOX flag.
  // Production with no configured gateway gets an empty list and checkout fails closed.
  return sandboxCheckoutAllowed({ mode: 'SANDBOX' })
    ? [{ gateway: 'bkash', mode: 'SANDBOX' }, { gateway: 'nagad', mode: 'SANDBOX' }, { gateway: 'stripe', mode: 'SANDBOX' }]
    : [];
}

/** Customer-facing plans. Validity fields are included so the self-care and
 *  captive pages can show what a purchase actually buys before checkout. */
export async function listActivePackages() {
  const r = await pool.query(`SELECT id, name, download_mbps, upload_mbps, price, description, is_active, data_cap_gb, fup_speed_mbps, validity_value, validity_unit
    FROM bandwidth_packages WHERE is_active=true ORDER BY download_mbps ASC NULLS LAST, price ASC, name ASC`).catch(() => ({ rows: [] as any[] }));
  return r.rows || [];
}

export type PortalState = 'ACTIVE' | 'WARNING' | 'GRACE' | 'EXPIRED' | 'SUSPENDED' | 'PENDING';

/** One state vocabulary for the portal, captive page and payment-status polls.
 *  Derived from stored status/expiry/grace/current_due — never from a PPP
 *  credential or a gateway callback query string. */
export async function describePortalState(sub: any) {
  const status = sub?.status ? String(sub.status).toUpperCase() : null;
  const stage = sub?.suspension_stage ? String(sub.suspension_stage).toUpperCase() : null;
  const expiryDate = sub?.expiry_date || null;
  const expiryMs = expiryDate ? new Date(expiryDate).getTime() : NaN;
  const now = Date.now();
  const daysRemaining = Number.isFinite(expiryMs)
    ? (expiryMs <= now ? 0 : Math.ceil((expiryMs - now) / 86400000))
    : null;
  const graceMs = sub?.grace_until ? new Date(sub.grace_until).getTime() : NaN;
  const inGrace = Number.isFinite(graceMs) && graceMs >= now;
  // Use the same inclusive business-day rule as the due-policy engine. A
  // calendar expiry date is not a UTC midnight instant; treating it as one
  // left the portal showing ACTIVE for most of the final day while RADIUS was
  // already restricted.
  const validityExpired = await isValidityExpired(expiryDate);
  const due = Number(sub?.current_due || 0);

  let normalizedState: PortalState;
  if (status === 'PENDING') normalizedState = 'PENDING';
  else if (status === 'SUSPENDED' || status === 'TERMINATED') normalizedState = 'SUSPENDED';
  else if (stage === 'GRACE' || inGrace) normalizedState = 'GRACE';
  else if (status === 'EXPIRED' || validityExpired) normalizedState = 'EXPIRED';
  else if (stage === 'WARNING' || stage === 'WALLED_GARDEN' || stage === 'ISOLATED'
    || (daysRemaining !== null && daysRemaining <= 3) || due > 0) normalizedState = 'WARNING';
  else normalizedState = 'ACTIVE';

  return {
    status,
    normalized_state: normalizedState,
    expiry_date: expiryDate,
    days_remaining: daysRemaining,
    grace_until: sub?.grace_until || null,
  };
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

/** A simulated checkout is only a verification convenience, never a payment.
 *  Production must have a real, enabled, configured gateway. The explicit
 *  PORTAL_SANDBOX_CHECKOUT=1 escape hatch is for staging and requires the
 *  gateway config to say mode=SANDBOX; otherwise checkout fails closed. */
function sandboxCheckoutAllowed(cfg: any) {
  const mode = String(cfg?.mode || 'SANDBOX').toUpperCase();
  if (mode !== 'SANDBOX') return false;
  if (process.env.NODE_ENV !== 'production') return true;
  const flag = String(process.env.PORTAL_SANDBOX_CHECKOUT || process.env.ALLOW_SANDBOX_CHECKOUT || '');
  return /^(1|true|yes)$/i.test(flag);
}

/**
 * Create a gateway checkout session + PENDING payment row for a subscriber.
 * Shared by the authenticated customer portal and the public captive
 * (expiry notice) page — both ultimately collect money for the ISP.
 *
 * For invoice payments the amount is fixed by the invoice — never let the
 * caller pick a smaller amount and still have the invoice marked as paid.
 * For PACKAGE_PURCHASE the amount is fixed by the active package row — never
 * trust a caller-supplied amount, package name or package price.
 */
export async function createCheckoutForSubscriber(subId: string, b: any) {
  const gateway = String(b.gateway || '').toLowerCase().trim();
  if (!gateway) throw new ValidationError('gateway is required');

  const purposeRaw = String(b.purpose || (b.invoice_id ? 'INVOICE_PAYMENT' : 'ADVANCE_PAYMENT')).toUpperCase();
  if (!['INVOICE_PAYMENT', 'ADVANCE_PAYMENT', 'PACKAGE_PURCHASE'].includes(purposeRaw)) {
    throw new ValidationError('Invalid payment purpose');
  }
  const isPackagePurchase = purposeRaw === 'PACKAGE_PURCHASE';

  // Public checkout fails closed: a disabled channel must never mint a
  // "successful" simulated checkout, and production has no silent fallback.
  const cfg = (await pool.query('SELECT * FROM payment_gateway_configs WHERE gateway=$1', [gateway])).rows[0] || null;
  if (cfg && cfg.enabled === false) {
    throw httpError(403, `Payment gateway '${gateway}' is disabled. Enable it in Settings > Payment Gateways.`);
  }
  const simulateAllowed = sandboxCheckoutAllowed(cfg);
  if (process.env.NODE_ENV === 'production' && !cfg && !simulateAllowed) {
    throw httpError(503, `Payment gateway '${gateway}' is not configured for online checkout.`);
  }

  const invoice = !isPackagePurchase && b.invoice_id
    ? (await pool.query('SELECT * FROM invoices WHERE id=$1 AND subscriber_id=$2', [b.invoice_id, subId])).rows[0]
    : null;
  if (!isPackagePurchase && b.invoice_id && !invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });
  const subscriber = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subId])).rows[0];
  if (!subscriber) throw Object.assign(new Error('Subscriber not found'), { status: 404 });

  let pkg: any = null;
  let amount: number;
  if (isPackagePurchase) {
    const packageId = String(b.package_id || '').trim();
    if (!packageId) throw new ValidationError('package_id is required for package purchase');
    pkg = (await pool.query('SELECT * FROM bandwidth_packages WHERE id=$1', [packageId])).rows[0] || null;
    if (!pkg) throw Object.assign(new Error('Package not found'), { status: 404 });
    if (pkg.is_active !== true && String(pkg.is_active).toUpperCase() !== 'TRUE') {
      throw new ValidationError('This package is not available for purchase');
    }
    amount = Number(pkg.price || 0);
    if (!(amount > 0)) throw new ValidationError('This package has no valid price for online purchase');
  } else {
    amount = invoice ? Number(invoice.due_amount || invoice.total_amount || 0) : Number(b.amount || 0);
    if (!(amount > 0)) throw new ValidationError('amount must be > 0');
  }

  const kernel = getKernel();
  const pluginMeta = kernel?.listPlugins().find((p: any) => p.type === 'PAYMENT_GATEWAY' && (p.id === gateway || p.id === `payment-${gateway}` || String(p.name || '').toLowerCase().includes(gateway)));
  const plugin = pluginMeta ? kernel?.getPlugin(pluginMeta.id)?.instance : null;
  const payment_ref = `PORTAL-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  // With no loaded plugin, a sandbox-allowed checkout is a synthetic URL, not
  // a failure. Keep the placeholder ok until a real plugin explicitly fails.
  let checkout: any = { ok: true, simulated: true };
  if (plugin && typeof plugin.createCheckoutSession === 'function') {
    try {
      checkout = await plugin.createCheckoutSession({
        invoiceId: invoice?.id, paymentRef: payment_ref, amount, currency: b.currency || 'BDT', subscriber, invoice,
        returnUrl: b.return_url, cancelUrl: b.cancel_url, webhookUrl: b.webhook_url,
        metadata: { ...(b.metadata || {}), purpose: purposeRaw, package_id: pkg?.id || null, package_name: pkg?.name || null },
        mode: (cfg?.mode || 'SANDBOX'), config: cfg?.config || {}, credentials: cfg?.credentials || {},
        webhookSecret: cfg?.webhook_secret || null,
      });
    } catch (e: any) { checkout = { ok: false, gateway, message: e.message }; }
  }

  const simulated = !!(checkout?.simulated) || !(checkout?.paymentUrl || checkout?.approvalUrl);
  if (checkout?.ok === false || (!plugin && !simulateAllowed) || (simulated && !simulateAllowed)) {
    throw httpError(503, checkout?.message || `Payment gateway '${gateway}' is not configured for online checkout.`);
  }
  if (simulated) {
    // SANDBOX-only: a visibly simulated checkout URL keeps dev/E2E flows
    // testable. It never marks money as received — only a webhook/callback
    // handled by billing does that.
    checkout = {
      ...checkout, ok: true, gateway, simulated: true,
      paymentUrl: checkout.paymentUrl || `https://sandbox-payments.izandesk.local/${gateway}/checkout?payment_ref=${encodeURIComponent(payment_ref)}&amount=${amount}`,
      message: checkout.message || 'Sandbox checkout — payment is not confirmed until the gateway reports it.',
    };
  }

  const checkout_url = checkout.paymentUrl || checkout.approvalUrl || null;
  const gatewayResponse = {
    ...checkout,
    purpose: purposeRaw,
    package_id: pkg?.id || null,
    package: pkg ? { id: pkg.id, name: pkg.name, price: Number(pkg.price || 0), validity_value: pkg.validity_value, validity_unit: pkg.validity_unit } : null,
  };
  const p = await pool.query(`INSERT INTO payments(payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, checkout_url, client_secret, gateway_response, purpose, package_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10::jsonb,$11,$12::uuid) RETURNING *`,
    [payment_ref, invoice?.id || null, subId, gateway, b.method || 'portal', amount, b.currency || 'BDT', checkout_url, checkout.clientSecret || null, JSON.stringify(gatewayResponse), purposeRaw, pkg?.id || null]);
  return {
    ok: true,
    payment: p.rows[0],
    payment_ref,
    checkout,
    checkout_url,
    simulated: !!checkout.simulated,
    purpose: purposeRaw,
    package_id: pkg?.id || null,
  };
}

/** Scoped payment-status read for the authenticated subscriber (or captive
 *  token holder). Returns only this subscriber's payment + account summary so
 *  the UI can poll after a gateway redirect without trusting query params. */
export async function getPaymentStatusForSubscriber(subId: string, ref: string) {
  const r = await pool.query(`SELECT id, payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, trx_id, purpose, package_id, checkout_url, created_at, verified_at, gateway_response
    FROM payments WHERE payment_ref=$1 AND subscriber_id=$2`, [ref, subId]);
  const p = r.rows[0];
  if (!p) return null;
  const s = (await pool.query(`SELECT id, status, suspension_stage, walled_garden, grace_until, expiry_date, current_due FROM subscribers WHERE id=$1`, [subId])).rows[0] || {};
  const state = await describePortalState(s);
  return {
    ok: true,
    payment: {
      id: p.id,
      payment_ref: p.payment_ref,
      status: p.status,
      amount: Number(p.amount || 0),
      currency: p.currency || 'BDT',
      purpose: p.purpose || p.gateway_response?.purpose || 'INVOICE_PAYMENT',
      package_id: p.package_id || p.gateway_response?.package_id || null,
      trx_id: p.trx_id || null,
      gateway: p.gateway,
      method: p.method || null,
      created_at: p.created_at,
      verified_at: p.verified_at || null,
    },
    subscriber: {
      id: subId,
      status: state.status,
      normalized_state: state.normalized_state,
      expiry_date: state.expiry_date,
      days_remaining: state.days_remaining,
      grace_until: state.grace_until,
    },
  };
}
