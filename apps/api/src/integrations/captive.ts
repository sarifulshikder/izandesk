import jwt = require('jsonwebtoken');
import { pool } from '../db';
import { getSetting } from './settings';
import { nextTicketNo } from '../utils/ticket-no';
import { auditLog } from './audit';
import { createCheckoutForSubscriber, listEnabledGateways } from './portal-payments';
import { ValidationError } from '../routes/helpers';

/**
 * Captive expiry portal ("your subscription has expired — please recharge").
 *
 * When a subscriber's service period lapses, the ISP router NAT-redirects the
 * subscriber's HTTP traffic to this server. The notice page identifies the
 * subscriber automatically by their session IP (radacct / ppp active /
 * subscriber_sessions), or by letting them type their client code / username /
 * phone. From there they can pay online, contact support, or open a ticket —
 * no portal password required.
 *
 * These helpers are deliberately password-free but tightly scoped:
 *  - resolve-by-identifier issues a short-lived (15 min) CAPTIVE_SUBSCRIBER
 *    token that can ONLY create payments/tickets (never read invoices or
 *    change profile data);
 *  - every public route is rate-limited per caller IP.
 */

const JWT_SECRET = process.env.JWT_SECRET || 'izandesk-dev-secret-change-me';
export const CAPTIVE_TOKEN_TTL_SEC = 15 * 60;

/** MikroTik address-lists used by the captive redirect NAT rules. */
export const CAPTIVE_LIST_EXPIRED = 'izn-expired';
export const CAPTIVE_LIST_WALLED = 'izn-walled-garden';

export function issueCaptiveToken(subscriberId: string): string {
  return jwt.sign({ type: 'CAPTIVE_SUBSCRIBER', sub: subscriberId, scope: 'captive' }, JWT_SECRET, { expiresIn: CAPTIVE_TOKEN_TTL_SEC });
}

export function verifyCaptiveToken(token: string): { sub: string } | null {
  try {
    const p: any = jwt.verify(token, JWT_SECRET);
    if (p?.type !== 'CAPTIVE_SUBSCRIBER' || !p?.sub || p?.scope !== 'captive') return null;
    return { sub: String(p.sub) };
  } catch { return null; }
}

/** Best-effort caller IP. The router NAT-redirect keeps the subscriber's
 *  framed IP as the source (masquerade), so the socket address is usually the
 *  subscriber's own IP. X-Forwarded-For is only trusted when the direct peer
 *  is a local proxy (Caddy) — otherwise a direct caller could spoof it. */
export function callerIp(req: any): string {
  const socket = String(req?.ip || '').replace(/^::ffff:/, '');
  const fwd = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim().replace(/^::ffff:/, '');
  const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|localhost)/.test(ip);
  if (socket && isPrivate(socket) && fwd) return fwd;
  return socket || fwd;
}

const PUBLIC_SUB = `id, client_code, full_name, username, phone, package_name, bandwidth_mbps, monthly_bill, current_due, expiry_date, due_date, status, suspension_stage, walled_garden, address, provisioning_mode`;

/** Find the subscriber whose live session carries this IP (framed IP as seen
 *  by the router after masquerade, or the LAN/session IP we recorded). */
export async function findSubscriberByIp(ip: string) {
  if (!ip) return null;
  try {
    let r = await pool.query(
      `SELECT s.${PUBLIC_SUB.split(', ').join(', s.')} FROM subscribers s
       JOIN subscriber_sessions ss ON ss.subscriber_id = s.id
       WHERE ss.ip_address::text = $1 AND upper(ss.status) = 'ONLINE'
       ORDER BY ss.updated_at DESC LIMIT 1`, [ip]);
    if (r.rows[0]) return r.rows[0];
    r = await pool.query(
      `SELECT s.${PUBLIC_SUB.split(', ').join(', s.')} FROM subscribers s
       JOIN radacct ra ON ra.username = s.username
       WHERE ra.framedipaddress::text = $1 AND ra.acctstoptime IS NULL
       ORDER BY ra.acctstarttime DESC LIMIT 1`, [ip]);
    if (r.rows[0]) return r.rows[0];
    r = await pool.query(`SELECT ${PUBLIC_SUB} FROM subscribers s WHERE s.ip_address::text = $1 LIMIT 1`, [ip]);
    return r.rows[0] || null;
  } catch { return null; }
}

/** Find a subscriber by client code / username / phone (identifiers only —
 *  never a password). */
export async function findSubscriberByIdentifier(identifier: string) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  const r = await pool.query(
    `SELECT ${PUBLIC_SUB} FROM subscribers s
     WHERE lower(s.client_code) = lower($1) OR lower(s.username) = lower($1) OR s.phone = $1
     LIMIT 1`, [id]);
  return r.rows[0] || null;
}

/** Public-safe view of the account for the captive notice page. */
export async function buildCaptiveView(sub: any) {
  let pkg: any = null;
  if (sub.package_name) {
    pkg = (await pool.query('SELECT id, name, download_mbps, upload_mbps, price, validity_value, validity_unit, data_cap_gb FROM bandwidth_packages WHERE name=$1 LIMIT 1', [sub.package_name])).rows[0] || null;
  }
  const inv = (await pool.query(
    `SELECT id, invoice_number, total_amount, paid_amount, due_amount, status, due_date, issue_date FROM invoices
     WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE')
     ORDER BY due_date ASC NULLS LAST, issue_date ASC LIMIT 1`, [sub.id])).rows[0] || null;
  const expired = String(sub.status || '').toUpperCase() === 'EXPIRED'
    || (sub.expiry_date && new Date(sub.expiry_date).getTime() < Date.now());
  return {
    subscriber: { ...sub, password: undefined, portal_password: undefined },
    package: pkg,
    due_invoice: inv,
    expired: !!expired,
    restricted: expired || String(sub.suspension_stage || '') === 'WALLED_GARDEN' || Number(sub.current_due || 0) > 0,
  };
}

/** Public branding + support contacts shown on the captive page. */
export async function getPublicBrand() {
  const keys = ['general.company_name', 'general.company_address', 'general.company_phone', 'general.company_email', 'general.support_whatsapp', 'general.support_hours', 'branding.portal_title', 'branding.logo_url', 'branding.primary_color', 'branding.secondary_color', 'general.currency', 'general.currency_symbol'];
  const vals = await Promise.all(keys.map((k) => getSetting(k).catch(() => undefined)));
  const g = (i: number, fb: any) => (vals[i] ?? fb);
  return {
    company_name: g(0, 'IzanDesk ISP'),
    company_address: g(1, ''),
    company_phone: g(2, ''),
    company_email: g(3, ''),
    support_whatsapp: g(4, ''),
    support_hours: g(5, ''),
    portal_title: g(6, 'IzanDesk Self-Care'),
    logo_url: g(7, ''),
    primary_color: g(8, '#6366f1'),
    secondary_color: g(9, '#22d3ee'),
    currency: g(10, 'BDT'),
    currency_symbol: g(11, '৳'),
  };
}

export async function getGateways() {
  return listEnabledGateways();
}

/** Create a support ticket from the captive page (no portal login needed). */
export async function createCaptiveTicket(input: { subscriberId: string; subject: string; description?: string; priority?: string; category?: string; phone?: string; ip?: string }) {
  const sub = (await pool.query('SELECT id, client_code, full_name, username, phone, address, latitude, longitude, reseller_id FROM subscribers WHERE id=$1', [input.subscriberId])).rows[0];
  if (!sub) throw Object.assign(new Error('Subscriber not found'), { status: 404 });
  const subject = String(input.subject || '').trim();
  if (!subject) throw new ValidationError('subject is required');
  const priority = String(input.priority || 'HIGH').toUpperCase();
  if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(priority)) throw new ValidationError('invalid priority');
  const hours = priority === 'CRITICAL' ? 4 : priority === 'HIGH' ? 8 : priority === 'LOW' ? 48 : 24;
  const due = new Date(Date.now() + hours * 3600 * 1000);
  const ticketNo = await nextTicketNo();
  const lat = sub.latitude ?? null; const lng = sub.longitude ?? null;
  const siteAddr = sub.address || null;
  const gpsUrl = (lat != null && lng != null) ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : (siteAddr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteAddr)}` : null);
  const r = await pool.query(`INSERT INTO tickets(ticket_no,subscriber_id,reseller_id,subject,description,category,priority,status,sla_policy,sla_due_at,dispatch_status,site_latitude,site_longitude,site_address,gps_nav_url,source,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,'UNASSIGNED',$10,$11,$12,$13,'CAPTIVE_PORTAL',$14) RETURNING *`,
    [ticketNo, sub.id, sub.reseller_id || null, subject, input.description || `Captive portal request from ${input.phone || sub.phone || sub.client_code || sub.username || 'customer'} (IP ${input.ip || 'unknown'})`, input.category || 'BILLING', priority, `${priority} SLA`, due, lat, lng, siteAddr, gpsUrl, sub.client_code || sub.username || sub.id]);
  await auditLog({ actor_id: sub.id, actor_role: 'PORTAL_SUBSCRIBER', action: 'CAPTIVE_TICKET_CREATED', entity_type: 'ticket', entity_id: r.rows[0]?.id, details: { ticket_no: ticketNo, source: 'CAPTIVE_PORTAL' }, ip_address: input.ip || null }).catch(() => {});
  return r.rows[0];
}

/** Checkout from the captive page, authorized by a captive token. */
export async function captiveCheckout(subId: string, b: any) {
  return createCheckoutForSubscriber(subId, b);
}
