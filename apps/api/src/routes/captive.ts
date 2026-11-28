import { Router } from 'express';
import { asyncHandler } from './helpers';
import { createRateLimiter } from '../security/rate-limit';
import {
  callerIp, findSubscriberByIp, findSubscriberByIdentifier, buildCaptiveView,
  getPublicBrand, getGateways, issueCaptiveToken, verifyCaptiveToken,
  createCaptiveTicket, captiveCheckout, captivePackageCheckout, captivePaymentStatus, listPackages,
} from '../integrations/captive';

/**
 * Public captive-portal API used by the expiry notice page (/expired) that the
 * ISP router redirects expired subscribers to. No staff or portal-password
 * auth — every route is rate-limited per caller IP and only exposes the
 * subscriber's own public account view plus pay/support/ticket actions.
 */
const router: Router = Router();

const sessionLimiter = createRateLimiter('captive-session', 60, 60_000);
const resolveLimiter = createRateLimiter('captive-resolve', 10, 15 * 60_000);
const ticketLimiter = createRateLimiter('captive-ticket', 5, 15 * 60_000);
const checkoutLimiter = createRateLimiter('captive-checkout', 10, 60_000);

async function throttle(req: any, res: any, limiter: ReturnType<typeof createRateLimiter>, max?: number) {
  const r = await limiter.checkDistributed(callerIp(req) || 'unknown', max);
  if (!r.allowed) {
    res.setHeader('Retry-After', String(r.retryAfterSec));
    res.status(429).json({ message: `Too many requests. Try again in ${r.retryAfterSec}s.` });
    return false;
  }
  return true;
}

/** Branding + support contacts + currency for the notice page. */
router.get('/brand', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, sessionLimiter))) return;
  const brand = await getPublicBrand();
  const base = String(process.env.CAPTIVE_PORTAL_BASE_URL || process.env.WALLED_GARDEN_PORTAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  res.json({ ok: true, brand, portal_base_url: base, portal_url: `${base}/portal`, expired_url: `${base}/expired` });
}));

/** Enabled online-payment gateways (no secrets). */
router.get('/gateways', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, sessionLimiter))) return;
  res.json({ ok: true, data: await getGateways() });
}));

/** Active packages a captive visitor can buy (public, no account required). */
router.get('/packages', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, sessionLimiter))) return;
  res.json({ ok: true, data: await listPackages() });
}));

/** Auto-identify the subscriber from the caller IP (router NAT keeps the
 *  subscriber's framed IP as the source after masquerade). */
router.get('/session', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, sessionLimiter))) return;
  const ip = callerIp(req);
  const sub = await findSubscriberByIp(ip);
  if (!sub) return res.json({ ok: true, found: false, ip, brand: await getPublicBrand(), gateways: await getGateways() });
  const view = await buildCaptiveView(sub);
  // Auto-identified by session IP: hand out a short-lived captive token so the
  // notice page can offer one-tap online recharge without a portal password.
  res.json({ ok: true, found: true, ip, ...view, token: issueCaptiveToken(sub.id), token_expires_in: 900, brand: await getPublicBrand(), gateways: await getGateways() });
}));

/** Resolve by client code / username / phone. Issues a short-lived captive
 *  token (pay + ticket only) so the notice page can offer one-tap recharge
 *  without the portal password. */
router.post('/resolve', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, resolveLimiter))) return;
  const b = req.body || {};
  const identifier = String(b.identifier || b.client_code || b.username || b.phone || '').trim();
  if (!identifier) return res.status(400).json({ message: 'identifier (client code / username / phone) is required' });
  const sub = await findSubscriberByIdentifier(identifier);
  if (!sub) return res.status(404).json({ message: 'No account found for that client code / username / phone' });
  const view = await buildCaptiveView(sub);
  res.json({ ok: true, ...view, token: issueCaptiveToken(sub.id), token_expires_in: 900, brand: await getPublicBrand(), gateways: await getGateways() });
}));

/** Full captive view for a holder of a captive token. */
router.get('/me', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, sessionLimiter))) return;
  const h = req.headers.authorization;
  const p = h?.startsWith('Bearer ') ? verifyCaptiveToken(h.slice(7)) : null;
  if (!p) return res.status(401).json({ message: 'Missing or expired captive session' });
  const { pool } = await import('../db');
  const sub = (await pool.query('SELECT id, client_code, full_name, username, phone, package_name, bandwidth_mbps, monthly_bill, current_due, expiry_date, due_date, grace_until, status, suspension_stage, walled_garden, address, provisioning_mode FROM subscribers WHERE id=$1', [p.sub])).rows[0];
  if (!sub) return res.status(404).json({ message: 'Subscriber not found' });
  const view = await buildCaptiveView(sub);
  res.json({ ok: true, ...view, brand: await getPublicBrand(), gateways: await getGateways() });
}));

/** Online payment from the notice page (captive token required). */
router.post('/checkout', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, checkoutLimiter))) return;
  const h = req.headers.authorization;
  const p = h?.startsWith('Bearer ') ? verifyCaptiveToken(h.slice(7)) : null;
  if (!p) return res.status(401).json({ message: 'Missing or expired captive session — resolve your account first' });
  const b = req.body || {};
  const result = await captiveCheckout(p.sub, { ...b, method: b.method || 'captive', return_url: b.return_url || String(process.env.CAPTIVE_PORTAL_BASE_URL || `${req.protocol}://${req.get('host')}`) + '/expired' });
  res.json(result);
}));

/** Package purchase from the notice page (captive token required). Amount and
 *  validity are resolved from the active package row by the shared checkout. */
router.post('/packages/:id/checkout', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, checkoutLimiter))) return;
  const h = req.headers.authorization;
  const p = h?.startsWith('Bearer ') ? verifyCaptiveToken(h.slice(7)) : null;
  if (!p) return res.status(401).json({ message: 'Missing or expired captive session — resolve your account first' });
  const b = req.body || {};
  const result = await captivePackageCheckout(p.sub, String(req.params.id || ''), {
    ...b,
    return_url: b.return_url || String(process.env.CAPTIVE_PORTAL_BASE_URL || `${req.protocol}://${req.get('host')}`) + '/expired',
  });
  res.json(result);
}));

/** Poll a payment made from the notice page. Never exposes another account. */
router.get('/payments/:ref', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, sessionLimiter))) return;
  const h = req.headers.authorization;
  const p = h?.startsWith('Bearer ') ? verifyCaptiveToken(h.slice(7)) : null;
  if (!p) return res.status(401).json({ message: 'Missing or expired captive session — resolve your account first' });
  const status = await captivePaymentStatus(p.sub, String(req.params.ref || ''));
  if (!status) return res.status(404).json({ message: 'Payment not found' });
  res.json(status);
}));

/** Create a support ticket from the notice page — with a captive token, or by
 *  identifier (client code / username / phone). */
router.post('/ticket', asyncHandler(async (req, res) => {
  if (!(await throttle(req, res, ticketLimiter))) return;
  const b = req.body || {};
  let subId: string | null = null;
  const h = req.headers.authorization;
  const p = h?.startsWith('Bearer ') ? verifyCaptiveToken(h.slice(7)) : null;
  if (p) subId = p.sub;
  else {
    const identifier = String(b.identifier || b.client_code || b.username || b.phone || '').trim();
    if (!identifier) return res.status(400).json({ message: 'identifier or captive token is required' });
    const sub = await findSubscriberByIdentifier(identifier);
    if (!sub) return res.status(404).json({ message: 'No account found for that client code / username / phone' });
    subId = sub.id;
  }
  const ticket = await createCaptiveTicket({ subscriberId: subId, subject: b.subject, description: b.description, priority: b.priority, category: b.category, phone: b.phone, ip: callerIp(req) });
  res.status(201).json({ ok: true, data: ticket });
}));

export default router;
