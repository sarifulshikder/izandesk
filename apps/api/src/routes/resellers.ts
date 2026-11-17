import { Router } from 'express';
import XLSX = require('xlsx');
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { recalcSubscriberDue, reactivateSubscriber, getInvoiceWithItems } from '../integrations/billing';
import { syncSubscriberToRadiusDb } from '../integrations/radius';
import { renderSimpleInvoicePdf } from '../integrations/pdf';
import { nextTicketNo } from '../utils/ticket-no';

const router: Router = Router();

function getUser(req: any) { return req.user || {}; }
function isAdminLike(role: string) { return ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER'].includes(role); }
function moneyLike(v: any) { return `৳${Number(v || 0).toFixed(2)}`; }

async function resolveResellerIdForUser(req: any) {
  const user = getUser(req);
  if (user.resellerId) {
    const r = await pool.query('SELECT id FROM resellers WHERE id::text=$1 OR lower(code)=lower($1) OR lower(subdomain)=lower($1) LIMIT 1', [String(user.resellerId)]);
    if (r.rows[0]) return r.rows[0].id as string;
  }
  if (user.email) {
    const r = await pool.query('SELECT id FROM resellers WHERE lower(email)=lower($1) LIMIT 1', [String(user.email)]);
    if (r.rows[0]) return r.rows[0].id as string;
  }
  return null;
}

async function getResellerById(id: string) {
  const r = await pool.query('SELECT * FROM resellers WHERE id=$1', [id]);
  return r.rows[0] || null;
}

function generateResellerCode(name: string) {
  const base = String(name || 'RES').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12) || 'RES';
  return `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
}

router.get('/', asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (user.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (!rid) return res.json({ data: [] });
    const r = await pool.query('SELECT r.*, (SELECT COUNT(*)::int FROM subscribers s WHERE s.reseller_id=r.id) as subscriber_count FROM resellers r WHERE r.id=$1', [rid]);
    return res.json({ data: r.rows });
  }
  if (!isAdminLike(user.role) && user.role !== 'TECHNICIAN') return res.status(403).json({ message: 'Insufficient permissions' });
  const q = String(req.query.q || '').trim().toLowerCase();
  const params: any[] = [];
  let where = '';
  if (q) { params.push(`%${q}%`); where = `WHERE lower(r.name) LIKE $1 OR lower(COALESCE(r.company_name,'')) LIKE $1 OR lower(COALESCE(r.code,'')) LIKE $1 OR lower(COALESCE(r.subdomain,'')) LIKE $1`; }
  const r = await pool.query(`SELECT r.*, p.name as parent_name, (SELECT COUNT(*)::int FROM subscribers s WHERE s.reseller_id=r.id) as subscriber_count
    FROM resellers r LEFT JOIN resellers p ON p.id=r.parent_reseller_id ${where} ORDER BY r.created_at DESC`, params);
  res.json({ data: r.rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (!['SUPER_ADMIN','BILLING_OPERATOR'].includes(user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ message: 'name is required' });
  const code = b.code || generateResellerCode(b.name);
  // Prevent duplicate codes/subdomains — white-label routing resolves resellers by these values.
  const dup = await pool.query('SELECT id FROM resellers WHERE lower(code)=lower($1) OR ($2::text IS NOT NULL AND lower(subdomain)=lower($2)) LIMIT 1', [String(code), b.subdomain ? String(b.subdomain).toLowerCase().trim() : null]);
  if (dup.rows[0]) return res.status(409).json({ message: 'A reseller with this code or subdomain already exists' });
  const r = await pool.query(`INSERT INTO resellers(code,name,company_name,tier,parent_reseller_id,email,phone,subdomain,custom_domain,brand_name,logo_url,primary_color,secondary_color,portal_title,status,wallet_balance,credit_limit,commission_percent,buying_margin_percent,address,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [code,b.name,b.company_name||null,b.tier||'STANDARD',b.parent_reseller_id||null,b.email||null,b.phone||null,b.subdomain?String(b.subdomain).toLowerCase().trim():null,b.custom_domain||null,b.brand_name||b.company_name||b.name,b.logo_url||null,b.primary_color||null,b.secondary_color||null,b.portal_title||`${b.name} Portal`,b.status||'ACTIVE',Number(b.wallet_balance||0),Number(b.credit_limit||0),Number(b.commission_percent||0),Number(b.buying_margin_percent||0),b.address||null,b.notes||null]);
  res.status(201).json({ data: r.rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (!['SUPER_ADMIN','BILLING_OPERATOR'].includes(user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
  const b = req.body || {};
  const r = await pool.query(`UPDATE resellers SET name=COALESCE($1,name), company_name=$2, tier=COALESCE($3,tier), parent_reseller_id=$4, email=$5, phone=$6, subdomain=$7, custom_domain=$8, brand_name=COALESCE($9,brand_name), logo_url=COALESCE($10,logo_url), primary_color=COALESCE($11,primary_color), secondary_color=COALESCE($12,secondary_color), portal_title=COALESCE($13,portal_title), status=COALESCE($14,status), credit_limit=COALESCE($15,credit_limit), commission_percent=COALESCE($16,commission_percent), buying_margin_percent=COALESCE($17,buying_margin_percent), address=$18, notes=$19, updated_at=now() WHERE id=$20 RETURNING *`,
    [b.name,b.company_name||null,b.tier,b.parent_reseller_id||null,b.email||null,b.phone||null,b.subdomain?String(b.subdomain).toLowerCase().trim():null,b.custom_domain||null,b.brand_name||null,b.logo_url||null,b.primary_color||null,b.secondary_color||null,b.portal_title||null,b.status,b.credit_limit,b.commission_percent,b.buying_margin_percent,b.address||null,b.notes||null,req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Reseller not found' });
  res.json({ data: r.rows[0] });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (user.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (rid !== req.params.id) return res.status(403).json({ message: 'Forbidden' });
  }
  const r = await pool.query(`SELECT r.*, p.name as parent_name,
      (SELECT COUNT(*)::int FROM subscribers s WHERE s.reseller_id=r.id) as subscriber_count,
      (SELECT COALESCE(SUM(amount),0)::numeric(12,2) FROM reseller_wallet_transactions t WHERE t.reseller_id=r.id AND t.direction='CREDIT') as total_credits,
      (SELECT COALESCE(SUM(amount),0)::numeric(12,2) FROM reseller_wallet_transactions t WHERE t.reseller_id=r.id AND t.direction='DEBIT') as total_debits
    FROM resellers r LEFT JOIN resellers p ON p.id=r.parent_reseller_id WHERE r.id=$1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Reseller not found' });
  const id = req.params.id;
  const statsRes = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE upper(status)='ACTIVE')::int AS active,
      COUNT(*) FILTER (WHERE upper(status)='SUSPENDED')::int AS suspended,
      COUNT(*) FILTER (WHERE upper(status)='EXPIRED')::int AS expired,
      COUNT(*) FILTER (WHERE upper(status)='PENDING')::int AS pending,
      COUNT(*) FILTER (WHERE upper(status)='TERMINATED')::int AS terminated
    FROM subscribers WHERE reseller_id=$1`, [id]);
  const sessionRes = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE upper(ss.status)='ONLINE')::int AS online,
      COUNT(*) FILTER (WHERE upper(ss.status)='OFFLINE')::int AS offline
    FROM subscriber_sessions ss
    JOIN subscribers s ON s.id = ss.subscriber_id
    WHERE s.reseller_id=$1`, [id]).catch(()=>({ rows: [{ online: 0, offline: 0 }] } as any));
  const stats = { ...(statsRes.rows[0] || {}), ...(sessionRes.rows[0] || { online: 0, offline: 0 }) };
  res.json({ data: { ...r.rows[0], stats } });
}));

router.get('/:id/wallet', asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (user.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (rid !== req.params.id) return res.status(403).json({ message: 'Forbidden' });
  }
  const reseller = await getResellerById(req.params.id);
  if (!reseller) return res.status(404).json({ message: 'Reseller not found' });
  const tx = await pool.query(`SELECT t.*, s.full_name as subscriber_name, s.client_code FROM reseller_wallet_transactions t LEFT JOIN subscribers s ON s.id=t.subscriber_id WHERE t.reseller_id=$1 ORDER BY t.created_at DESC LIMIT 200`, [req.params.id]);
  res.json({ data: { reseller, balance: Number(reseller.wallet_balance || 0), transactions: tx.rows } });
}));

router.post('/:id/wallet/recharge', asyncHandler(async (req, res) => {
  const user = getUser(req);
  // Recharging a prepaid wallet grants real money — only admin roles may do it.
  // Reseller self-recharge must go through a payment gateway flow, not a direct credit.
  if (!['SUPER_ADMIN','BILLING_OPERATOR'].includes(user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
  const amount = Number(req.body?.amount || 0);
  if (!(amount > 0)) return res.status(400).json({ message: 'amount must be > 0' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rr = await client.query('SELECT * FROM resellers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const reseller = rr.rows[0];
    if (!reseller) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Reseller not found' }); }
    const newBal = Number(reseller.wallet_balance || 0) + amount;
    const limit = Number(reseller.credit_limit || 0);
    if (limit > 0 && newBal > limit) { await client.query('ROLLBACK'); return res.status(400).json({ message: `Recharge would exceed credit limit (${limit})` }); }
    await client.query('UPDATE resellers SET wallet_balance=$2, updated_at=now() WHERE id=$1', [reseller.id, newBal]);
    const tx = await client.query(`INSERT INTO reseller_wallet_transactions(reseller_id,type,direction,amount,balance_after,reference_type,reference_id,description,metadata,created_by)
      VALUES($1,'RECHARGE','CREDIT',$2,$3,'MANUAL',$4,$5,$6::jsonb,$7) RETURNING *`,
      [reseller.id, amount, newBal, req.body?.reference_id || null, req.body?.description || 'Wallet recharge', JSON.stringify(req.body?.metadata || {}), user.email || user.id || 'system']);
    await client.query('COMMIT');
    res.json({ ok: true, balance: newBal, transaction: tx.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}));

router.post('/:id/renew-subscriber', asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (!['SUPER_ADMIN','BILLING_OPERATOR','RESELLER'].includes(user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
  if (user.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (rid !== req.params.id) return res.status(403).json({ message: 'Forbidden' });
  }
  const { subscriber_id } = req.body || {};
  if (!subscriber_id) return res.status(400).json({ message: 'subscriber_id is required' });

  const client = await pool.connect();
  let charge = 0, retail = 0, marginPct = 0, wholesale = 0, newBal = 0, newSubDue = 0;
  let expiryDate: string | null = null, pref = '';
  let payment: any = null, walletTx: any = null, resellerId = '', packageName: string | null = null;
  try {
    await client.query('BEGIN');
    const rr = await client.query('SELECT * FROM resellers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const reseller = rr.rows[0];
    if (!reseller) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Reseller not found' }); }
    if (String(reseller.status).toUpperCase() !== 'ACTIVE') { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Reseller is not active' }); }

    const sr = await client.query('SELECT * FROM subscribers WHERE id=$1 FOR UPDATE', [subscriber_id]);
    const sub = sr.rows[0];
    if (!sub) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Subscriber not found' }); }
    // A subscriber owned by another reseller can never be paid for from this wallet.
    if (sub.reseller_id && String(sub.reseller_id) !== String(reseller.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Subscriber belongs to a different reseller' });
    }
    // Resellers cannot claim unassigned subscribers by renewing them; admins may attach.
    if (user.role === 'RESELLER' && !sub.reseller_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Subscriber does not belong to this reseller' });
    }
    if (!sub.reseller_id) {
      await client.query('UPDATE subscribers SET reseller_id=$2, updated_at=now() WHERE id=$1', [sub.id, reseller.id]);
    }
    resellerId = String(reseller.id);
    packageName = sub.package_name || null;

    retail = Number(sub.monthly_bill || 0);
    marginPct = Number(reseller.buying_margin_percent || 0);
    wholesale = +(retail * (1 - marginPct / 100)).toFixed(2);
    charge = wholesale > 0 ? wholesale : retail;
    if (!(charge > 0)) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Subscriber has no billable package' }); }
    if (Number(reseller.wallet_balance || 0) < charge) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Insufficient wallet balance. Required ${charge}, available ${Number(reseller.wallet_balance||0)}` });
    }

    // Apply the payment to the oldest open invoices so due recalculation stays consistent.
    // The old code only decremented subscribers.current_due, which was then overwritten by
    // recalcSubscriberDue() — the wallet was debited but the subscriber's due came back.
    const open = await client.query(`SELECT * FROM invoices WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE') AND GREATEST(due_amount,0) > 0 ORDER BY COALESCE(due_date, issue_date, created_at) ASC, created_at ASC`, [sub.id]);
    let remaining = charge;
    for (const inv of open.rows) {
      if (remaining <= 0) break;
      const total = Number(inv.total_amount || inv.amount || 0);
      const paidBefore = Number(inv.paid_amount || 0);
      const take = +Math.min(remaining, Math.max(0, total - paidBefore)).toFixed(2);
      if (!(take > 0)) continue;
      const paid = +(paidBefore + take).toFixed(2);
      const dueAfter = +Math.max(0, total - paid).toFixed(2);
      await client.query(`UPDATE invoices SET paid_amount=$2, due_amount=$3, status=$4, paid_at=CASE WHEN $4='PAID' THEN COALESCE(paid_at, now()) ELSE paid_at END, updated_at=now() WHERE id=$1`,
        [inv.id, paid, dueAfter, dueAfter <= 0 ? 'PAID' : 'PARTIAL']);
      remaining = +(remaining - take).toFixed(2);
    }
    const dueRes = await client.query(`SELECT COALESCE(SUM(GREATEST(due_amount,0)),0)::numeric(12,2) AS due FROM invoices WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE')`, [sub.id]);
    newSubDue = Number(dueRes.rows[0]?.due || 0);

    // A renewal must extend the service period (at least 30 days from today).
    const base = sub.expiry_date ? new Date(sub.expiry_date) : new Date();
    const start = !isNaN(base.getTime()) && base.getTime() > Date.now() ? base : new Date();
    start.setDate(start.getDate() + 30);
    expiryDate = start.toISOString().slice(0, 10);
    await client.query(`UPDATE subscribers SET current_due=$2::numeric, expiry_date=$3, status=CASE WHEN $2::numeric <= 0 THEN 'ACTIVE' ELSE status END, suspension_stage=CASE WHEN $2::numeric <= 0 THEN 'NONE' ELSE suspension_stage END, walled_garden=CASE WHEN $2::numeric <= 0 THEN false ELSE walled_garden END, updated_at=now() WHERE id=$1`,
      [sub.id, newSubDue, expiryDate]);

    pref = `RWAL-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    payment = (await client.query(`INSERT INTO payments(payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, trx_id, payer_info, gateway_response, verified_at)
      VALUES($1,NULL,$2::uuid,'RESELLER_WALLET','WALLET_DEDUCTION',$3::numeric,'BDT','COMPLETED',$4,$5::jsonb,$6::jsonb,now()) RETURNING *`,
      [pref, sub.id, charge, pref, JSON.stringify({ reseller_id: reseller.id, reseller_name: reseller.name }), JSON.stringify({ type: 'RESELLER_RENEWAL', retail, marginPct, wholesale: charge })])).rows[0];

    newBal = +(Number(reseller.wallet_balance || 0) - charge).toFixed(2);
    await client.query('UPDATE resellers SET wallet_balance=$2::numeric, updated_at=now() WHERE id=$1', [reseller.id, newBal]);
    walletTx = (await client.query(`INSERT INTO reseller_wallet_transactions(reseller_id,type,direction,amount,balance_after,reference_type,reference_id,subscriber_id,description,metadata,created_by)
      VALUES($1::uuid,'SUBSCRIBER_RENEWAL','DEBIT',$2::numeric,$3::numeric,'PAYMENT',$4,$5::uuid,$6,$7::jsonb,$8) RETURNING *`,
      [reseller.id, charge, newBal, payment.id, sub.id, `Renewed ${sub.full_name || sub.client_code || sub.username} (retail ${retail}, margin ${marginPct}%, charged ${charge})`, JSON.stringify({ retail, marginPct, wholesale: charge }), user.email || user.id || 'system'])).rows[0];

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }

  // Best-effort post-commit side effects. These must NOT run inside the wallet transaction:
  // a failing share-entry insert used to abort the transaction and turn a successful
  // renewal into a 500 (or, worse, roll back the debit and payment).
  try { await recalcSubscriberDue(subscriber_id); } catch {}
  if (newSubDue <= 0) { try { await reactivateSubscriber(subscriber_id, `Reseller wallet renewal ${pref}`); } catch {} }
  const ispShare = +(retail - charge).toFixed(2);
  try {
    await pool.query(`INSERT INTO reseller_share_entries(reseller_id, subscriber_id, payment_ref, wallet_transaction_id, retail_amount, partner_share, isp_share, margin_percent, package_name, period_month, metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,date_trunc('month', now())::date,$10::jsonb)`,
      [resellerId, subscriber_id, pref, walletTx?.id || null, retail, charge, ispShare >= 0 ? ispShare : 0, marginPct, packageName, JSON.stringify({ retail, marginPct, wholesale: charge })]);
  } catch {}
  res.json({ ok: true, charged: charge, retail, margin_percent: marginPct, wholesale, balance: newBal, payment, wallet_transaction: walletTx, subscriber: { id: subscriber_id, current_due: newSubDue, expiry_date: expiryDate } });
}));

async function ensureResellerAccess(req: any, res: any, resellerId: string) {
  const user = getUser(req);
  if (user.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (rid !== resellerId) { res.status(403).json({ message: 'Forbidden' }); return false; }
  } else if (!isAdminLike(user.role) && user.role !== 'TECHNICIAN') {
    res.status(403).json({ message: 'Insufficient permissions' }); return false;
  }
  return true;
}

router.get('/:id/subscribers', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const r = await pool.query(`SELECT s.id,s.client_code,s.full_name,s.username,s.phone,s.status,s.package_name,s.monthly_bill,s.current_due,s.expiry_date,s.provisioning_mode
    FROM subscribers s WHERE s.reseller_id=$1 ORDER BY s.created_at DESC`, [req.params.id]);
  res.json({ data: r.rows });
}));

// Reseller portal: dashboard summary (SRZone-like cards + quick aggregates)
router.get('/:id/dashboard', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const reseller = await getResellerById(id);
  if (!reseller) return res.status(404).json({ message: 'Reseller not found' });
  const [statsRes, walletRes, monthRes] = await Promise.all([
    pool.query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE upper(status)='ACTIVE')::int AS active,
      COUNT(*) FILTER (WHERE upper(status)='SUSPENDED')::int AS suspended,
      COUNT(*) FILTER (WHERE upper(status)='EXPIRED')::int AS expired,
      COUNT(*) FILTER (WHERE upper(status)='PENDING')::int AS pending,
      COUNT(*) FILTER (WHERE upper(status)='TERMINATED')::int AS terminated,
      COUNT(*) FILTER (WHERE upper(status)='DISABLED')::int AS disabled,
      COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '3 day')::date)::int AS expiring_3d,
      COUNT(*) FILTER (WHERE COALESCE(price_override,0) > 0)::int AS custom_price_users,
      COUNT(*) FILTER (WHERE bandwidth_mbps IS NOT NULL)::int AS custom_bandwidth_users,
      COUNT(*) FILTER (WHERE extended_expiry = true)::int AS extended_users,
      COUNT(*) FILTER (WHERE parental_control_enabled = true)::int AS parental_control_users,
      (SELECT COUNT(*)::int FROM tickets WHERE reseller_id=$1 AND upper(status) NOT IN ('RESOLVED','CLOSED')) AS complaints
    FROM subscribers WHERE reseller_id=$1`, [id]).catch(()=>({ rows: [{}] } as any)),
    pool.query(`SELECT
      COALESCE(SUM(amount) FILTER (WHERE direction='CREDIT'),0)::numeric(12,2) AS total_credited,
      COALESCE(SUM(amount) FILTER (WHERE direction='DEBIT'),0)::numeric(12,2) AS total_debited
    FROM reseller_wallet_transactions WHERE reseller_id=$1`, [id]).catch(()=>({ rows: [{ total_credited: 0, total_debited: 0 }] } as any)),
    pool.query(`SELECT
      COALESCE(SUM(p.amount) FILTER (WHERE upper(p.status) IN ('COMPLETED','SUCCESS','PAID')),0)::numeric(12,2) AS month_collected,
      COUNT(*) FILTER (WHERE upper(p.status) IN ('COMPLETED','SUCCESS','PAID'))::int AS month_payments
    FROM payments p JOIN subscribers s ON s.id=p.subscriber_id
    WHERE s.reseller_id=$1 AND date_trunc('month', COALESCE(p.verified_at,p.created_at)) = date_trunc('month', now())`, [id]).catch(()=>({ rows: [{ month_collected: 0, month_payments: 0 }] } as any)),
  ]);
  let online = 0;
  try {
    const sess = await pool.query(`
      SELECT COUNT(DISTINCT s.id)::int AS online
      FROM subscribers s
      LEFT JOIN subscriber_sessions ss ON ss.subscriber_id=s.id
      WHERE s.reseller_id=$1 AND (upper(ss.status)='ONLINE' OR EXISTS (
        SELECT 1 FROM radacct ra WHERE ra.username = s.username AND ra.acctstoptime IS NULL
      ))`, [id]);
    online = Number(sess.rows[0]?.online || 0);
  } catch {}
  const stats = { ...(statsRes.rows[0] || {}), online };
  // expiring in 3d fallback (expiry_date text/date tolerant)
  try {
    const exp3 = await pool.query(`SELECT COUNT(*)::int AS c FROM subscribers WHERE reseller_id=$1 AND expiry_date IS NOT NULL AND (expiry_date::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '3 day')::date)`, [id]);
    stats.expiring_3d = Number(exp3.rows[0]?.c || 0);
  } catch { stats.expiring_3d = stats.expiring_3d || 0; }
  res.json({ data: { reseller, stats, wallet: { balance: Number(reseller.wallet_balance||0), ...(walletRes.rows[0]||{}) }, month: monthRes.rows[0] || {} } });
}));

// Rich scoped users list with filters (SRZone-like)
router.get('/:id/users', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toUpperCase();
  const online = String(req.query.online || '').trim().toUpperCase();
  const profile = String(req.query.profile || '').trim();
  const area = String(req.query.area || '').trim();
  const zone = String(req.query.zone || '').trim();
  const from = String(req.query.from || ''); const to = String(req.query.to || '');
  const expiryFrom = String(req.query.expiry_from || ''); const expiryTo = String(req.query.expiry_to || '');
  const params: any[] = [id];
  let where = 'WHERE s.reseller_id=$1';
  if (status) { params.push(status); where += ` AND upper(s.status)=$${params.length}`; }
  if (online === 'ONLINE' || online === 'OFFLINE') { params.push(online); where += ` AND COALESCE((SELECT upper(ss.status) FROM subscriber_sessions ss WHERE ss.subscriber_id=s.id ORDER BY ss.updated_at DESC LIMIT 1),'OFFLINE')=$${params.length}`; }
  if (profile) { params.push(profile); where += ` AND s.package_name=$${params.length}`; }
  if (zone) { params.push(zone); where += ` AND z.name=$${params.length}`; }
  if (area) { params.push(area); where += ` AND a.name=$${params.length}`; }
  if (from) { params.push(from); where += ` AND s.created_at::date >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` AND s.created_at::date <= $${params.length}::date`; }
  if (expiryFrom) { params.push(expiryFrom); where += ` AND s.expiry_date::date >= $${params.length}::date`; }
  if (expiryTo) { params.push(expiryTo); where += ` AND s.expiry_date::date <= $${params.length}::date`; }
  if (String(req.query.custom_price || '') === '1') where += ' AND COALESCE(s.price_override,0) > 0';
  if (String(req.query.custom_bandwidth || '') === '1') where += ' AND s.bandwidth_mbps IS NOT NULL';
  if (String(req.query.extended || '') === '1') where += ' AND s.extended_expiry = true';
  if (String(req.query.static_ip || '') === '1') where += " AND COALESCE(s.ip_address,'') <> ''";
  if (String(req.query.has_onu || '') === '1') where += ' AND EXISTS (SELECT 1 FROM onus o WHERE o.subscriber_id=s.id)';
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (lower(COALESCE(s.full_name,'')) LIKE $${params.length} OR lower(COALESCE(s.username,'')) LIKE $${params.length} OR lower(COALESCE(s.client_code,'')) LIKE $${params.length} OR lower(COALESCE(s.phone,'')) LIKE $${params.length} OR lower(COALESCE(s.email,'')) LIKE $${params.length} OR lower(COALESCE(s.address,'')) LIKE $${params.length} OR lower(COALESCE(s.ip_address,'')) LIKE $${params.length} OR lower(COALESCE(s.mac_address,'')) LIKE $${params.length} OR lower(COALESCE(s.nid_number,'')) LIKE $${params.length} OR lower(COALESCE(s.notes,'')) LIKE $${params.length})`;
  }
  const limit = Math.min(10000, Math.max(20, Number(req.query.limit || 500) || 500));
  // zone/area are FK IDs on subscribers — resolve their names via joins (s.zone/s.area do not exist).
  const r = await pool.query(`SELECT s.*, z.name AS zone, a.name AS area,
      (SELECT upper(ss.status) FROM subscriber_sessions ss WHERE ss.subscriber_id=s.id ORDER BY ss.updated_at DESC LIMIT 1) AS online_status
    FROM subscribers s LEFT JOIN zones z ON z.id=s.zone_id LEFT JOIN areas a ON a.id=s.area_id
    ${where} ORDER BY s.created_at DESC LIMIT $${params.length + 1}`, [...params, limit]);
  res.json({ data: r.rows, total: r.rowCount });
}));

// Online sessions for reseller subscribers
router.get('/:id/sessions', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  let rows: any[] = [];
  try {
    const r = await pool.query(`
      SELECT s.id as subscriber_id, s.client_code, s.full_name, s.username, s.package_name,
             ss.status, ss.ip_address, s.ipv6_address, s.ipv6_prefix, ss.mac_address, ss.rx_bps, ss.tx_bps, ss.uptime_sec, ss.updated_at, ss.router_id,
             ss.nas_port, nr.name AS device, nr.host AS nas_ip, nr.id AS nas_id
      FROM subscribers s
      JOIN subscriber_sessions ss ON ss.subscriber_id = s.id
      LEFT JOIN network_routers nr ON nr.id=ss.router_id
      WHERE s.reseller_id=$1
      ORDER BY (upper(ss.status)='ONLINE') DESC, ss.updated_at DESC NULLS LAST
      LIMIT 500`, [id]);
    rows = r.rows;
  } catch {
    try {
      const r = await pool.query(`
        SELECT s.id as subscriber_id, s.client_code, s.full_name, s.username, s.package_name,
               'ONLINE' as status, ra.framedipaddress as ip_address, s.ipv6_address, s.ipv6_prefix, ra.callingstationid as mac_address,
               0::bigint as rx_bps, 0::bigint as tx_bps,
               EXTRACT(EPOCH FROM (now()-ra.acctstarttime))::int as uptime_sec,
               COALESCE(ra.acctupdatetime, ra.acctstarttime) as updated_at,
               ra.nasipaddress as router_id
        FROM subscribers s
        JOIN radacct ra ON ra.username = s.username AND ra.acctstoptime IS NULL
        WHERE s.reseller_id=$1
        ORDER BY ra.acctstarttime DESC LIMIT 500`, [id]);
      rows = r.rows;
    } catch { rows = []; }
  }
  res.json({ data: rows, total: rows.length });
}));

// Wallet ledger with totals (balance report)
router.get('/:id/balance-report', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const reseller = await getResellerById(id);
  if (!reseller) return res.status(404).json({ message: 'Reseller not found' });
  const [tx, totals] = await Promise.all([
    pool.query(`SELECT t.*, s.full_name as subscriber_name, s.client_code, s.username as subscriber_username
      FROM reseller_wallet_transactions t LEFT JOIN subscribers s ON s.id=t.subscriber_id
      WHERE t.reseller_id=$1 ORDER BY t.created_at DESC LIMIT 500`, [id]),
    pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE direction='CREDIT'),0)::numeric(12,2) AS total_credited,
                       COALESCE(SUM(amount) FILTER (WHERE direction='DEBIT'),0)::numeric(12,2) AS total_debited
                FROM reseller_wallet_transactions WHERE reseller_id=$1`, [id]),
  ]);
  res.json({ data: { reseller, balance: Number(reseller.wallet_balance||0), totals: totals.rows[0] || { total_credited: 0, total_debited: 0 }, transactions: tx.rows } });
}));

// Sharing/revenue report derived from reseller wallet renewal debits
router.get('/:id/sharing-report', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const reseller = await getResellerById(id);
  const r = await pool.query(`
    SELECT t.id, t.created_at as date, t.amount as partner_charge, t.balance_after, t.description, t.created_by,
           t.metadata, s.full_name, s.username, s.client_code, s.phone, s.package_name, s.monthly_bill,
           p.payment_ref, p.amount as paid_amount, p.status as payment_status,
           i.invoice_number, i.total_amount AS invoice_total, i.discount AS invoice_discount, i.tax AS invoice_vat,
           i.amount AS invoice_plan_price, i.paid_at,
           rs.name AS partner_name, rs.code AS partner_code
    FROM reseller_wallet_transactions t
    LEFT JOIN resellers rs ON rs.id=t.reseller_id
    LEFT JOIN subscribers s ON s.id=t.subscriber_id
    LEFT JOIN payments p ON p.id::text = t.reference_id AND t.reference_type='PAYMENT'
    LEFT JOIN invoices i ON i.id=p.invoice_id
    WHERE t.reseller_id=$1 AND t.type='SUBSCRIBER_RENEWAL'
    ORDER BY t.created_at DESC LIMIT 500`, [id]);
  const rows = r.rows.map((row: any) => {
    const m = row.metadata || {};
    const retail = Number(m.retail ?? row.monthly_bill ?? 0);
    const marginPct = Number(m.marginPct ?? m.margin_percent ?? 0);
    const wholesale = Number(m.wholesale ?? row.partner_charge ?? 0);
    const ispShare = +(retail - wholesale).toFixed(2);
    return { ...row, retail, margin_percent: marginPct, partner_share: wholesale, isp_share: ispShare >= 0 ? ispShare : 0,
      partner_name: row.partner_name || reseller?.company_name || reseller?.name || '-',
      partner_amount: wholesale };
  });
  res.json({ data: rows, total: rows.length });
}));

// Invoice & online payments for reseller subscribers
router.get('/:id/payments', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const kind = String(req.query.kind || 'all').toLowerCase(); // all|online|invoice
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toUpperCase();
  const gateway = String(req.query.gateway || '').trim().toUpperCase();
  const method = String(req.query.method || '').trim().toUpperCase();
  const paymentType = String(req.query.payment_type || '').trim().toUpperCase();
  const approval = String(req.query.approval || '').trim().toUpperCase();
  const params: any[] = [id];
  let extra = '';
  if (kind === 'online') extra += " AND (p.gateway NOT IN ('RESELLER_WALLET','CASH','MANUAL') OR p.method ILIKE '%online%')";
  if (kind === 'invoice') extra += " AND p.invoice_id IS NOT NULL";
  if (status) { params.push(status); extra += ` AND upper(p.status)= $${params.length}`; }
  if (gateway) { params.push(`%${gateway}%`); extra += ` AND upper(COALESCE(p.gateway,'')) LIKE $${params.length}`; }
  if (method) { params.push(`%${method}%`); extra += ` AND upper(COALESCE(p.method,'')) LIKE $${params.length}`; }
  if (paymentType) { params.push(paymentType); extra += ` AND upper(COALESCE(p.payment_type,'')) = $${params.length}`; }
  if (approval) { params.push(approval); extra += ` AND upper(COALESCE(p.approval_status,'APPROVED')) = $${params.length}`; }
  if (q) { params.push(`%${q}%`); extra += ` AND (lower(COALESCE(s.full_name,'')) LIKE $${params.length} OR lower(COALESCE(s.client_code,'')) LIKE $${params.length} OR lower(COALESCE(s.username,'')) LIKE $${params.length} OR lower(COALESCE(i.invoice_number,'')) LIKE $${params.length} OR lower(COALESCE(p.gateway,'')) LIKE $${params.length} OR lower(COALESCE(p.method,'')) LIKE $${params.length} OR lower(COALESCE(p.trx_id,'')) LIKE $${params.length} OR lower(COALESCE(p.payment_ref,'')) LIKE $${params.length} OR lower(COALESCE(p.collector_name,'')) LIKE $${params.length} OR lower(COALESCE(p.payment_type,'')) LIKE $${params.length})`; }
  const r = await pool.query(`
    SELECT p.*, s.full_name, s.client_code, s.username, s.phone, i.invoice_number
    FROM payments p
    JOIN subscribers s ON s.id=p.subscriber_id
    LEFT JOIN invoices i ON i.id=p.invoice_id
    WHERE s.reseller_id=$1 ${extra}
    ORDER BY COALESCE(p.verified_at,p.created_at) DESC LIMIT 500`, params).catch(()=>({ rows: [] } as any));
  const summary = await pool.query(`
    SELECT COALESCE(SUM(p.amount) FILTER (WHERE upper(p.status) IN ('COMPLETED','SUCCESS','PAID')),0)::numeric(12,2) AS total_collected,
           COALESCE(SUM(p.amount) FILTER (WHERE upper(p.status) IN ('PENDING','INITIATED','VERIFYING')),0)::numeric(12,2) AS total_pending
    FROM payments p JOIN subscribers s ON s.id=p.subscriber_id WHERE s.reseller_id=$1`, [id]).catch(()=>({ rows: [{ total_collected: 0, total_pending: 0 }] } as any));
  res.json({ data: r.rows, summary: summary.rows[0] || {} });
}));

// ONU list scoped via subscriber linkage where available (+ optional unlinked for admin/billing)
router.get('/:id/onus', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const user = getUser(req);
  const includeUnlinked = String(req.query.unlinked || '') === '1' && isAdminLike(String(user.role || ''));
  const params: any[] = [id];
  let extra = '';
  const oltId = String(req.query.olt_id || '');
  const serial = String(req.query.serial || '').trim().toLowerCase();
  const mac = String(req.query.mac || '').trim().toLowerCase();
  const match = String(req.query.match || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toUpperCase();
  const port = String(req.query.port || '').trim();
  const rxMin = Number(req.query.rx_min || NaN); const rxMax = Number(req.query.rx_max || NaN);
  const distMin = Number(req.query.dist_min || NaN); const distMax = Number(req.query.dist_max || NaN);
  if (oltId) { params.push(oltId); extra += ` AND o.olt_id=$${params.length}`; }
  if (serial) { params.push(`%${serial}%`); extra += ` AND lower(COALESCE(o.serial_number,'')) LIKE $${params.length}`; }
  if (mac) { params.push(`%${mac}%`); extra += ` AND lower(COALESCE(o.mac_address,'')) LIKE $${params.length}`; }
  if (match) { params.push(`%${match}%`); extra += ` AND (lower(COALESCE(s.full_name,'')) LIKE $${params.length} OR lower(COALESCE(s.username,'')) LIKE $${params.length} OR lower(COALESCE(s.client_code,'')) LIKE $${params.length})`; }
  if (status) { params.push(status); extra += ` AND upper(o.status)=$${params.length}`; }
  if (port) { params.push(`%${port}%`); extra += ` AND lower(COALESCE(o.pon_port,'')) LIKE $${params.length}`; }
  if (!isNaN(rxMin)) { params.push(rxMin); extra += ` AND COALESCE(o.rx_power_dbm,0) >= $${params.length}`; }
  if (!isNaN(rxMax)) { params.push(rxMax); extra += ` AND COALESCE(o.rx_power_dbm,0) <= $${params.length}`; }
  if (!isNaN(distMin)) { params.push(distMin); extra += ` AND COALESCE(o.distance_m,0) >= $${params.length}`; }
  if (!isNaN(distMax)) { params.push(distMax); extra += ` AND COALESCE(o.distance_m,0) <= $${params.length}`; }
  try {
    const r = await pool.query(`
      SELECT o.*, ol.name AS olt_name, s.full_name as subscriber_name, s.client_code, s.username
      FROM onus o
      LEFT JOIN olts ol ON ol.id=o.olt_id
      JOIN subscribers s ON s.id = o.subscriber_id
      WHERE s.reseller_id=$1 ${extra}
      ORDER BY o.updated_at DESC NULLS LAST, o.id DESC LIMIT 500`, params);
    let unlinked: any[] = [];
    if (includeUnlinked) {
      try {
        const ur = await pool.query(`
          SELECT o.*, NULL::text as subscriber_name, NULL::text as client_code, NULL::text as username
          FROM onus o
          WHERE o.subscriber_id IS NULL
          ORDER BY o.updated_at DESC NULLS LAST, o.id DESC LIMIT 300`);
        unlinked = ur.rows.map((x: any) => ({ ...x, _unlinked: true }));
      } catch { unlinked = []; }
    }
    return res.json({ data: r.rows, unlinked, total: r.rowCount });
  } catch {
    return res.json({ data: [], unlinked: [], total: 0, note: 'ONU linkage unavailable' });
  }
}));

// Assign/link ONU to a reseller-owned subscriber (scoped)
router.post('/:id/onus/:onuId/assign', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const { subscriber_id, name } = req.body || {};
  if (!subscriber_id) return res.status(400).json({ message: 'subscriber_id is required' });
  const sub = (await pool.query('SELECT id, full_name, username, client_code FROM subscribers WHERE id=$1 AND reseller_id=$2', [subscriber_id, id])).rows[0];
  if (!sub) return res.status(404).json({ message: 'Subscriber not found in this reseller' });
  const onu = (await pool.query('SELECT * FROM onus WHERE id=$1', [req.params.onuId])).rows[0];
  if (!onu) return res.status(404).json({ message: 'ONU not found' });
  const user = getUser(req);
  // Resellers may only re-link ONUs already associated with their subscribers; admin/billing can assign unlinked/discovered ONUs.
  if (user.role === 'RESELLER' && !onu.subscriber_id) {
    return res.status(403).json({ message: 'Resellers can only re-link ONUs already associated with their subscribers' });
  }
  const label = name || onu.name || sub.full_name || sub.username || onu.serial_number;
  const r = await pool.query(
    `UPDATE onus SET status='AUTHORIZED', name=$1, subscriber_id=$2, authorized_at=COALESCE(authorized_at,now()), last_seen_at=now(), updated_at=now() WHERE id=$3 RETURNING *`,
    [label, sub.id, req.params.onuId]
  );
  const actor = (req as any).user || {};
  await pool.query(
    `INSERT INTO audit_logs(actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
     VALUES($1,$2,$3,'ONU_ASSIGNED','onu',$4,$5)`,
    [actor.id || null, actor.name || actor.email || null, actor.role || null, req.params.onuId, JSON.stringify({ reseller_id: id, subscriber_id: sub.id, subscriber: sub.full_name || sub.username })]
  ).catch(()=>{});
  res.json({ ok: true, data: { ...r.rows[0], subscriber_name: sub.full_name, client_code: sub.client_code, username: sub.username } });
}));

// Scoped logs (audit/activity for reseller and their subscribers/actions)
router.get('/:id/logs', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const q = String(req.query.q || '').trim().toLowerCase();
  const kind = String(req.query.kind || 'all').trim().toLowerCase(); // all|wallet|audit|auth
  const limit = Math.min(500, Math.max(20, Number(req.query.limit || 200) || 200));
  const like = `%${q}%`;
  const out: any = { audit: [], auth: [], wallet: [] };

  if (kind === 'all' || kind === 'audit') {
    try {
      const params: any[] = [id];
      let where = `WHERE ((entity_type='reseller' AND entity_id=$1::text) OR (details::text ILIKE '%' || $1::text || '%'))`;
      if (q) { params.push(like); where += ` AND (lower(COALESCE(action,'')) LIKE $${params.length} OR lower(COALESCE(actor_name,'')) LIKE $${params.length} OR lower(COALESCE(actor_role,'')) LIKE $${params.length} OR lower(COALESCE(entity_type,'')) LIKE $${params.length} OR lower(COALESCE(entity_id,'')) LIKE $${params.length} OR lower(COALESCE(details::text,'')) LIKE $${params.length})`; }
      const event = String(req.query.event || '').trim().toUpperCase();
      const manager = String(req.query.manager || '').trim().toLowerCase();
      const userFilter = String(req.query.user || '').trim().toLowerCase();
      const agent = String(req.query.agent || '').trim().toLowerCase();
      const ip = String(req.query.ip || '').trim().toLowerCase();
      const from = String(req.query.from || ''); const to = String(req.query.to || '');
      if (event) { params.push(`%${event}%`); where += ` AND upper(COALESCE(action,'')) LIKE $${params.length}`; }
      if (manager) { params.push(`%${manager}%`); where += ` AND lower(COALESCE(actor_name,'')) LIKE $${params.length}`; }
      if (userFilter) { params.push(`%${userFilter}%`); where += ` AND lower(COALESCE(details::text,'')) LIKE $${params.length}`; }
      if (agent || ip) { params.push(`%${agent || ip}%`); where += ` AND lower(COALESCE(details::text,'')) LIKE $${params.length}`; }
      if (from) { params.push(from); where += ` AND created_at::date >= $${params.length}::date`; }
      if (to) { params.push(to); where += ` AND created_at::date <= $${params.length}::date`; }
      params.push(limit);
      out.audit = (await pool.query(
        `SELECT id, created_at, actor_name, actor_role, action, entity_type, entity_id, details
         FROM audit_logs ${where}
         ORDER BY created_at DESC LIMIT $${params.length}`, params
      )).rows;
    } catch { out.audit = []; }
  }

  if (kind === 'all' || kind === 'auth') {
    try {
      const params: any[] = [id];
      let where = `WHERE (l.username IN (SELECT username FROM subscribers WHERE reseller_id=$1 AND username IS NOT NULL) OR l.subscriber_id IN (SELECT id FROM subscribers WHERE reseller_id=$1))`;
      if (q) { params.push(like); where += ` AND (lower(COALESCE(l.username,'')) LIKE $${params.length} OR lower(COALESCE(l.ip_address,'')) LIKE $${params.length} OR lower(COALESCE(l.mac_address,'')) LIKE $${params.length} OR lower(COALESCE(l.status,'')) LIKE $${params.length} OR lower(COALESCE(l.result,'')) LIKE $${params.length})`; }
      params.push(limit);
      out.auth = (await pool.query(
        `SELECT l.*
         FROM user_auth_logs l ${where}
         ORDER BY COALESCE(l.created_at, l.timestamp, now()) DESC LIMIT $${params.length}`, params
      )).rows;
    } catch {
      try {
        const params: any[] = [id];
        let where = `WHERE ra.username IN (SELECT username FROM subscribers WHERE reseller_id=$1 AND username IS NOT NULL)`;
        if (q) { params.push(like); where += ` AND (lower(COALESCE(ra.username,'')) LIKE $${params.length} OR lower(COALESCE(ra.framedipaddress,'')) LIKE $${params.length} OR lower(COALESCE(ra.callingstationid,'')) LIKE $${params.length} OR lower(COALESCE(ra.acctterminatecause,'')) LIKE $${params.length})`; }
        params.push(limit);
        out.auth = (await pool.query(
          `SELECT ra.radacctid as id, ra.username, ra.acctstarttime as created_at, ra.acctstoptime, ra.framedipaddress as ip_address, ra.callingstationid as mac_address, ra.acctterminatecause as status
           FROM radacct ra ${where}
           ORDER BY ra.acctstarttime DESC NULLS LAST LIMIT $${params.length}`, params
        )).rows;
      } catch { out.auth = []; }
    }
  }

  if (kind === 'all' || kind === 'wallet') {
    try {
      const params: any[] = [id];
      let where = `WHERE reseller_id=$1`;
      if (q) { params.push(like); where += ` AND (lower(COALESCE(type,'')) LIKE $${params.length} OR lower(COALESCE(direction,'')) LIKE $${params.length} OR lower(COALESCE(reference_type,'')) LIKE $${params.length} OR lower(COALESCE(reference_id,'')) LIKE $${params.length} OR lower(COALESCE(description,'')) LIKE $${params.length} OR lower(COALESCE(created_by,'')) LIKE $${params.length})`; }
      params.push(limit);
      out.wallet = (await pool.query(
        `SELECT id, created_at, type, direction, amount, balance_after, reference_type, reference_id, description, created_by
         FROM reseller_wallet_transactions ${where}
         ORDER BY created_at DESC LIMIT $${params.length}`, params
      )).rows;
    } catch { out.wallet = []; }
  }

  res.json({ data: out });
}));

// Disconnect a reseller-owned subscriber session (scoped CoA/PoD)
router.post('/:id/disconnect', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const { username, subscriber_id } = req.body || {};
  if (!username && !subscriber_id) return res.status(400).json({ message: 'username or subscriber_id required' });
  const sub = (await pool.query(
    `SELECT id, username, router_id, provisioning_mode FROM subscribers WHERE reseller_id=$1 AND (id::text=$2 OR lower(username)=lower($3)) LIMIT 1`,
    [id, String(subscriber_id || ''), String(username || '')]
  )).rows[0];
  if (!sub) return res.status(404).json({ message: 'Subscriber not found in this reseller' });
  const uname = sub.username || username;
  if (!uname) return res.status(400).json({ message: 'Subscriber has no username' });
  // enqueue/execute via coa_requests + best-effort packet using existing integration
  let status = 'FAILED', response_message = 'No target NAS found', coa: any = null, routerId = sub.router_id || null, rt: any = null;
  if (routerId) rt = (await pool.query('SELECT name,host,integration_mode,radius_secret,coa_port,nas_identifier FROM network_routers WHERE id=$1', [routerId])).rows[0];
  if (!rt) rt = (await pool.query("SELECT id,name,host,radius_secret,coa_port FROM network_routers WHERE integration_mode='RADIUS' AND is_enabled=true ORDER BY created_at LIMIT 1")).rows[0];
  if (rt) routerId = rt.id;
  if (rt && rt.host && rt.radius_secret) {
    try {
      const { sendCoaPacket } = await import('../integrations/radius');
      coa = await sendCoaPacket({ host: rt.host, port: Number(rt.coa_port || 3799), secret: String(rt.radius_secret), username: uname, action: 'DISCONNECT', attributes: {} });
      if (coa.ok) { status = 'EXECUTED'; response_message = `PoD Disconnect sent and acknowledged via ${rt.name || rt.host}`; }
      else { status = 'FAILED'; response_message = `CoA/PoD no ACK: ${coa.error || coa.code}`; }
    } catch (e: any) { status = 'FAILED'; response_message = `Disconnect failed: ${e.message}`; }
  } else {
    response_message = 'No RADIUS NAS (host+secret+CoA port) available for disconnect';
  }
  const reqRow = (await pool.query(`INSERT INTO coa_requests(subscriber_id,username,router_id,action,attributes,status,response_message,executed_at)
    VALUES($1,$2,$3,'DISCONNECT','{}'::jsonb,$4,$5,now()) RETURNING *`, [sub.id, uname, routerId, status, response_message])).rows[0];
  if (status === 'EXECUTED') await pool.query("UPDATE subscriber_sessions SET status='OFFLINE', rx_bps=0, tx_bps=0, updated_at=now() WHERE username=$1", [uname]).catch(()=>{});
  res.json({ ok: status === 'EXECUTED', request: reqRow, message: response_message, coa });
}));

// Update payment finance fields (collector/type/approval) for reseller-owned payment
router.patch('/:id/payments/:paymentId', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const role = String((req as any).user?.role || '');
  if (!['SUPER_ADMIN','BILLING_OPERATOR'].includes(role)) return res.status(403).json({ message: 'Insufficient permissions' });
  const id = req.params.id;
  const paymentId = req.params.paymentId;
  const own = await pool.query(`SELECT p.id FROM payments p JOIN subscribers s ON s.id=p.subscriber_id WHERE p.id=$1 AND s.reseller_id=$2`, [paymentId, id]);
  if (!own.rows[0]) return res.status(404).json({ message: 'Payment not found for this reseller' });
  const b = req.body || {};
  const fields: string[] = []; const vals: any[] = [];
  const set = (col: string, val: any) => { vals.push(val); fields.push(`${col}=$${vals.length}`); };
  if (b.payment_type !== undefined) set('payment_type', b.payment_type ? String(b.payment_type) : null);
  if (b.collector_name !== undefined) set('collector_name', b.collector_name ? String(b.collector_name) : null);
  if (b.approval_status !== undefined) set('approval_status', b.approval_status ? String(b.approval_status).toUpperCase() : 'APPROVED');
  if (b.approval_note !== undefined) set('approval_note', b.approval_note ? String(b.approval_note) : null);
  if (b.received_at !== undefined) set('received_at', b.received_at || null);
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  vals.push(paymentId);
  const r = await pool.query(`UPDATE payments SET ${fields.join(', ')}, updated_at=now() WHERE id=$${vals.length} RETURNING *`, vals);
  res.json({ ok: true, data: r.rows[0] });
}));

// Best-effort ping for a reseller-owned subscriber IP (live reachability)
router.post('/:id/ping', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const { subscriber_id, ip_address } = req.body || {};
  let ip = String(ip_address || '').trim();
  if (subscriber_id) {
    const s = (await pool.query('SELECT ip_address FROM subscribers WHERE id=$1 AND reseller_id=$2', [subscriber_id, req.params.id])).rows[0];
    if (!s) return res.status(404).json({ message: 'Subscriber not found in this reseller' });
    if (s.ip_address) ip = String(s.ip_address);
  }
  if (!ip || !/^[0-9a-fA-F.:]+$/.test(ip)) return res.status(400).json({ message: 'Valid IP address not found' });
  const { spawn } = await import('child_process');
  const result: any = await new Promise((resolve) => {
    const args = process.platform === 'win32' ? ['-n', '2', '-w', '1200', ip] : ['-c', '2', '-W', '2', ip];
    const child = spawn('ping', args);
    let out = '', err = '';
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({ ok: false, output: (out+err).slice(-2000), timed_out: true }); }, 5000);
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => { clearTimeout(t); resolve({ ok: code === 0, code, output: (out+err).slice(-4000) }); });
    child.on('error', e => { clearTimeout(t); resolve({ ok: false, error: e.message, output: (out+err).slice(-2000) }); });
  });
  const m = String(result.output || '').match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  res.json({ ok: !!result.ok, ip, avg_ms: m ? Number(m[2]) : null, min_ms: m ? Number(m[1]) : null, max_ms: m ? Number(m[3]) : null, output: String(result.output || '').split('\n').slice(0, 12).join('\n') });
}));

// Dashboard notifications/alerts (derived)
router.get('/:id/notifications', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const alerts: any[] = [];
  const safe = async (fn: any) => { try { return await fn(); } catch { return []; } };
  const expiring = await safe(async () => (await pool.query(`SELECT id, full_name, username, client_code, expiry_date FROM subscribers WHERE reseller_id=$1 AND expiry_date IS NOT NULL AND expiry_date::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + interval '3 days')::date ORDER BY expiry_date ASC LIMIT 20`, [id])).rows);
  expiring.forEach((s:any)=> alerts.push({ type:'EXPIRING', severity:'warning', title:`Expiring soon: ${s.full_name||s.username}`, message:`${s.client_code||s.username} expires ${String(s.expiry_date).slice(0,10)}`, subscriber_id:s.id }));
  const expired = await safe(async () => (await pool.query(`SELECT id, full_name, username, client_code FROM subscribers WHERE reseller_id=$1 AND upper(status)='EXPIRED' ORDER BY updated_at DESC NULLS LAST LIMIT 15`, [id])).rows);
  expired.forEach((s:any)=> alerts.push({ type:'EXPIRED', severity:'warning', title:`Expired: ${s.full_name||s.username}`, message:`${s.client_code||s.username} is expired`, subscriber_id:s.id }));
  const suspended = await safe(async () => (await pool.query(`SELECT id, full_name, username, client_code FROM subscribers WHERE reseller_id=$1 AND upper(status)='SUSPENDED' ORDER BY updated_at DESC NULLS LAST LIMIT 10`, [id])).rows);
  suspended.forEach((s:any)=> alerts.push({ type:'SUSPENDED', severity:'error', title:`Suspended: ${s.full_name||s.username}`, message:`${s.client_code||s.username} is suspended`, subscriber_id:s.id }));
  const reseller = await getResellerById(id);
  if (reseller && Number(reseller.wallet_balance||0) < 500) alerts.push({ type:'LOW_BALANCE', severity:'warning', title:'Low wallet balance', message:`Balance ${moneyLike(reseller.wallet_balance)} is low` });
  const pending = await safe(async () => (await pool.query(`SELECT p.id, p.amount, p.status, s.full_name, s.username FROM payments p JOIN subscribers s ON s.id=p.subscriber_id WHERE s.reseller_id=$1 AND upper(p.status) IN ('PENDING','VERIFYING','INITIATED') ORDER BY p.created_at DESC LIMIT 10`, [id])).rows);
  pending.forEach((p:any)=> alerts.push({ type:'PENDING_PAYMENT', severity:'info', title:`Pending payment: ${p.full_name||p.username}`, message:`${p.status} ৳${Number(p.amount||0)}`, payment_id:p.id }));
  const resellerRow = await getResellerById(id);
  const prefs = {
    expiry: resellerRow?.notify_expiry !== false,
    payment: resellerRow?.notify_payment !== false,
    system: resellerRow?.notify_system !== false,
  };
  const visible = alerts.filter(a => {
    if (['EXPIRING','EXPIRED','SUSPENDED'].includes(a.type)) return prefs.expiry;
    if (a.type === 'PENDING_PAYMENT' || a.type === 'LOW_BALANCE') return prefs.payment;
    return prefs.system;
  });
  // Keep a lightweight persisted notification log (one record per title per day).
  for (const a of visible.slice(0, 50)) {
    try {
      await pool.query(`INSERT INTO reseller_notifications(reseller_id,kind,title,message,severity,metadata)
        SELECT $1,$2,$3,$4,$5,$6::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM reseller_notifications WHERE reseller_id=$1 AND title=$3 AND created_at::date=CURRENT_DATE)`,
        [id, a.type, a.title, a.message || null, a.severity || 'info', JSON.stringify(a)]);
    } catch {}
  }
  res.json({ data: visible.slice(0, 50), total: visible.length });
}));

// Global cross-entity search (users, payments, sessions, onus)
router.get('/:id/search', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ data: { users: [], payments: [], sessions: [], onus: [] } });
  const like = `%${q}%`;
  const out: any = { users: [], payments: [], sessions: [], onus: [] };
  try {
    out.users = (await pool.query(
      `SELECT id, client_code, full_name, username, phone, email, status, package_name, ip_address, mac_address
       FROM subscribers
       WHERE reseller_id=$1 AND (
         lower(COALESCE(full_name,'')) LIKE $2 OR lower(COALESCE(username,'')) LIKE $2 OR lower(COALESCE(client_code,'')) LIKE $2 OR
         lower(COALESCE(phone,'')) LIKE $2 OR lower(COALESCE(email,'')) LIKE $2 OR lower(COALESCE(address,'')) LIKE $2 OR
         lower(COALESCE(ip_address,'')) LIKE $2 OR lower(COALESCE(mac_address,'')) LIKE $2 OR lower(COALESCE(nid_number,'')) LIKE $2
       ) ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 20`, [id, like]
    )).rows;
  } catch {}
  try {
    out.payments = (await pool.query(
      `SELECT p.id, p.amount, p.status, p.gateway, p.method, p.trx_id, p.payment_ref, p.created_at, p.verified_at,
              s.full_name, s.client_code, s.username, i.invoice_number
       FROM payments p
       JOIN subscribers s ON s.id=p.subscriber_id
       LEFT JOIN invoices i ON i.id=p.invoice_id
       WHERE s.reseller_id=$1 AND (
         lower(COALESCE(p.trx_id,'')) LIKE $2 OR lower(COALESCE(p.payment_ref,'')) LIKE $2 OR lower(COALESCE(p.gateway,'')) LIKE $2 OR lower(COALESCE(p.method,'')) LIKE $2 OR
         lower(COALESCE(s.full_name,'')) LIKE $2 OR lower(COALESCE(s.username,'')) LIKE $2 OR lower(COALESCE(s.client_code,'')) LIKE $2 OR lower(COALESCE(i.invoice_number,'')) LIKE $2
       ) ORDER BY p.created_at DESC LIMIT 20`, [id, like]
    )).rows;
  } catch {}
  try {
    out.sessions = (await pool.query(
      `SELECT s.id as subscriber_id, s.full_name, s.client_code, s.username, ss.status, ss.ip_address, ss.mac_address, ss.updated_at
       FROM subscribers s JOIN subscriber_sessions ss ON ss.subscriber_id=s.id
       WHERE s.reseller_id=$1 AND (
         lower(COALESCE(s.full_name,'')) LIKE $2 OR lower(COALESCE(s.username,'')) LIKE $2 OR lower(COALESCE(s.client_code,'')) LIKE $2 OR
         lower(COALESCE(ss.ip_address,'')) LIKE $2 OR lower(COALESCE(ss.mac_address,'')) LIKE $2
       ) ORDER BY ss.updated_at DESC NULLS LAST LIMIT 20`, [id, like]
    )).rows;
  } catch {
    try {
      out.sessions = (await pool.query(
        `SELECT s.id as subscriber_id, s.full_name, s.client_code, s.username, 'ONLINE' as status, ra.framedipaddress as ip_address, ra.callingstationid as mac_address, ra.acctstarttime as updated_at
         FROM subscribers s JOIN radacct ra ON ra.username=s.username AND ra.acctstoptime IS NULL
         WHERE s.reseller_id=$1 AND (
           lower(COALESCE(s.full_name,'')) LIKE $2 OR lower(COALESCE(s.username,'')) LIKE $2 OR lower(COALESCE(s.client_code,'')) LIKE $2 OR
           lower(COALESCE(ra.framedipaddress,'')) LIKE $2 OR lower(COALESCE(ra.callingstationid,'')) LIKE $2
         ) ORDER BY ra.acctstarttime DESC LIMIT 20`, [id, like]
      )).rows;
    } catch {}
  }
  try {
    out.onus = (await pool.query(
      `SELECT o.id, o.serial_number, o.onu_serial, o.name, o.onu_name, o.status, o.onu_status, o.olt_id, o.mac_address,
              s.full_name as subscriber_name, s.client_code, s.username
       FROM onus o JOIN subscribers s ON s.id=o.subscriber_id
       WHERE s.reseller_id=$1 AND (
         lower(COALESCE(o.serial_number,'')) LIKE $2 OR lower(COALESCE(o.onu_serial,'')) LIKE $2 OR lower(COALESCE(o.name,'')) LIKE $2 OR
         lower(COALESCE(o.onu_name,'')) LIKE $2 OR lower(COALESCE(o.mac_address,'')) LIKE $2 OR
         lower(COALESCE(s.full_name,'')) LIKE $2 OR lower(COALESCE(s.username,'')) LIKE $2 OR lower(COALESCE(s.client_code,'')) LIKE $2
       ) ORDER BY o.updated_at DESC NULLS LAST LIMIT 20`, [id, like]
    )).rows;
  } catch {}
  res.json({ data: out });
}));

// Dashboard charts/series for reseller (last 6 months)
router.get('/:id/charts', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  const safe = async (q: string, params: any[] = []) => { try { return (await pool.query(q, params)).rows; } catch { return []; } };
  const regs = await safe(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS m, COUNT(*)::int AS c FROM subscribers WHERE reseller_id=$1 AND created_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1`, [id]);
  const exps = await safe(`SELECT to_char(date_trunc('month', expiry_date::date), 'YYYY-MM') AS m, COUNT(*)::int AS c FROM subscribers WHERE reseller_id=$1 AND expiry_date IS NOT NULL AND expiry_date::date >= (date_trunc('month', now()) - interval '5 months')::date GROUP BY 1`, [id]);
  const renews = await safe(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS m, COUNT(*)::int AS c FROM reseller_wallet_transactions WHERE reseller_id=$1 AND type='SUBSCRIBER_RENEWAL' AND created_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1`, [id]);
  const pays = await safe(`SELECT to_char(date_trunc('month', COALESCE(p.verified_at,p.created_at)), 'YYYY-MM') AS m, COALESCE(SUM(p.amount),0)::numeric(12,2) AS amount, COUNT(*)::int AS c FROM payments p JOIN subscribers s ON s.id=p.subscriber_id WHERE s.reseller_id=$1 AND upper(p.status) IN ('COMPLETED','SUCCESS','PAID') AND COALESCE(p.verified_at,p.created_at) >= date_trunc('month', now()) - interval '5 months' GROUP BY 1`, [id]);
  const byM = (rows:any[], key='c') => Object.fromEntries(rows.map(r=>[r.m, key==='amount'?Number(r.amount||0):Number(r.c||0)]));
  const R = byM(regs), E = byM(exps), N = byM(renews), P = byM(pays), PA = byM(pays,'amount');
  res.json({ data: { months, registrations: months.map(m=>R[m]||0), expirations: months.map(m=>E[m]||0), renewals: months.map(m=>N[m]||0), payments_count: months.map(m=>P[m]||0), payments_amount: months.map(m=>PA[m]||0) } });
}));

// Partner self-service profile (white-label/contact fields only; balance & tier stay admin-managed)
router.put('/:id/profile', asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (user.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (rid !== req.params.id) return res.status(403).json({ message: 'Forbidden' });
  } else if (!isAdminLike(String(user.role))) {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  const b = req.body || {};
  const fields: string[] = []; const vals: any[] = [];
  const allowed = ['company_name', 'email', 'phone', 'address', 'brand_name', 'logo_url', 'primary_color', 'secondary_color', 'portal_title', 'notes',
    'avatar_url', 'notify_expiry', 'notify_payment', 'notify_system'];
  for (const key of allowed) {
    if (b[key] !== undefined) { vals.push(b[key] === '' ? null : b[key]); fields.push(`${key}=$${vals.length}`); }
  }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  vals.push(req.params.id);
  const r = await pool.query(`UPDATE resellers SET ${fields.join(', ')}, updated_at=now() WHERE id=$${vals.length} RETURNING *`, vals);
  if (!r.rows[0]) return res.status(404).json({ message: 'Reseller not found' });
  res.json({ ok: true, data: r.rows[0] });
}));

/* ========================================================================== */
/* SRZone parity endpoints for partner/reseller portal                        */
/* ========================================================================== */

// Invoice-level billing overview with financial KPIs (partner-scoped)
router.get('/:id/billing-overview', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const params: any[] = [req.params.id];
  let extra = '';
  const status = String(req.query.status || '').toUpperCase();
  const q = String(req.query.q || '').trim().toLowerCase();
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const type = String(req.query.payment_type || '').trim().toUpperCase();
  if (status) { params.push(status); extra += ` AND upper(i.status)=$${params.length}`; }
  if (q) { params.push(`%${q}%`); extra += ` AND (lower(i.invoice_number) LIKE $${params.length} OR lower(COALESCE(i.username,'')) LIKE $${params.length} OR lower(COALESCE(i.subscriber_name,'')) LIKE $${params.length})`; }
  if (from) { params.push(from); extra += ` AND i.created_at::date >= $${params.length}::date`; }
  if (to) { params.push(to); extra += ` AND i.created_at::date <= $${params.length}::date`; }
  if (type) { params.push(`%${type}%`); extra += ` AND upper(COALESCE(pay.payment_type,'')) LIKE $${params.length}`; }
  const rows = (await pool.query(`
    SELECT i.*, s.client_code, s.full_name AS sub_full_name, s.phone AS sub_phone, s.reseller_id,
           pay.method, pay.gateway, pay.payment_type, pay.trx_id, pay.collector_name, pay.approval_status,
           pay.verified_at AS paid_at_actual
    FROM invoices i
    JOIN subscribers s ON s.id=i.subscriber_id
    LEFT JOIN LATERAL (
      SELECT * FROM payments p WHERE p.invoice_id=i.id AND upper(p.status) IN ('COMPLETED','SUCCESS','PAID')
      ORDER BY COALESCE(p.verified_at,p.created_at) DESC LIMIT 1
    ) pay ON true
    WHERE s.reseller_id=$1 ${extra}
    ORDER BY COALESCE(i.paid_at, i.created_at) DESC LIMIT 500`, params)).rows;
  const sum = (await pool.query(`
    SELECT COALESCE(SUM(i.amount),0)::numeric(12,2) AS package_amount,
           COALESCE(SUM(i.discount),0)::numeric(12,2) AS discount,
           COALESCE(SUM(i.tax),0)::numeric(12,2) AS tax,
           COALESCE(SUM(i.total_amount),0)::numeric(12,2) AS final_amount,
           COALESCE(SUM(i.paid_amount),0)::numeric(12,2) AS paid_amount,
           COALESCE(SUM(i.due_amount),0)::numeric(12,2) AS due_amount
    FROM invoices i JOIN subscribers s ON s.id=i.subscriber_id
    WHERE s.reseller_id=$1 ${extra}`, params).catch(()=>({ rows: [{}] } as any))).rows[0] || {};
  res.json({ data: rows, summary: sum, total: rows.length });
}));

// Offline/invoice payments (cash, MFS send-money, referral, wallet deduction)
router.get('/:id/invoice-payments', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const params: any[] = [req.params.id];
  let extra = '';
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').toUpperCase();
  const approval = String(req.query.approval || '').toUpperCase();
  const type = String(req.query.payment_type || '').trim().toUpperCase();
  const collector = String(req.query.collector || '').trim().toUpperCase();
  const from = String(req.query.from || ''); const to = String(req.query.to || '');
  if (q) { params.push(`%${q}%`); extra += ` AND (lower(COALESCE(p.payment_ref,'')) LIKE $${params.length} OR lower(COALESCE(p.trx_id,'')) LIKE $${params.length} OR lower(COALESCE(i.invoice_number,'')) LIKE $${params.length} OR lower(COALESCE(s.username,'')) LIKE $${params.length})`; }
  if (status) { params.push(status); extra += ` AND upper(p.status)=$${params.length}`; }
  if (approval) { params.push(approval); extra += ` AND upper(COALESCE(p.approval_status,'APPROVED'))=$${params.length}`; }
  if (type) { params.push(`%${type}%`); extra += ` AND upper(COALESCE(p.payment_type,'')) LIKE $${params.length}`; }
  if (collector) { params.push(`%${collector}%`); extra += ` AND upper(COALESCE(p.collector_name,'')) LIKE $${params.length}`; }
  if (from) { params.push(from); extra += ` AND COALESCE(p.verified_at,p.created_at)::date >= $${params.length}::date`; }
  if (to) { params.push(to); extra += ` AND COALESCE(p.verified_at,p.created_at)::date <= $${params.length}::date`; }
  extra += " AND (p.invoice_id IS NOT NULL OR upper(p.gateway) IN ('RESELLER_WALLET','CASH','MANUAL'))";
  const rows = (await pool.query(`SELECT p.*, s.full_name, s.client_code, s.username, s.phone, i.invoice_number, i.total_amount AS invoice_amount
    FROM payments p JOIN subscribers s ON s.id=p.subscriber_id
    LEFT JOIN invoices i ON i.id=p.invoice_id
    WHERE s.reseller_id=$1 ${extra} ORDER BY COALESCE(p.verified_at,p.created_at) DESC LIMIT 500`, params)).rows;
  const sum = (await pool.query(`SELECT
      COALESCE(SUM(s.monthly_bill),0)::numeric(12,2) AS monthly_bill,
      COALESCE(SUM(p.amount) FILTER (WHERE upper(COALESCE(p.approval_status,'APPROVED'))='APPROVED'),0)::numeric(12,2) AS approval_collected,
      COALESCE(SUM(p.amount) FILTER (WHERE upper(COALESCE(p.approval_status,'APPROVED'))<>'APPROVED'),0)::numeric(12,2) AS due_bill,
      COALESCE(SUM(p.amount) FILTER (WHERE upper(p.gateway) NOT IN ('RESELLER_WALLET','CASH','MANUAL')),0)::numeric(12,2) AS online_collected,
      COALESCE(SUM(p.amount) FILTER (WHERE upper(p.status) IN ('COMPLETED','SUCCESS','PAID')),0)::numeric(12,2) AS total_collected
    FROM payments p JOIN subscribers s ON s.id=p.subscriber_id
    WHERE s.reseller_id=$1 ${extra}`, params).catch(()=>({ rows: [{}] } as any))).rows[0] || {};
  res.json({ data: rows, summary: sum, total: rows.length });
}));

// Gateway/online payments (bKash, Nagad, Rocket, cards, SSLCOMMERZ...)
router.get('/:id/online-payments', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const params: any[] = [req.params.id];
  let extra = " AND (upper(p.gateway) NOT IN ('RESELLER_WALLET','CASH','MANUAL') OR lower(COALESCE(p.method,'')) LIKE '%online%')";
  const q = String(req.query.q || '').trim().toLowerCase();
  const gateway = String(req.query.gateway || '').trim().toUpperCase();
  const from = String(req.query.from || ''); const to = String(req.query.to || '');
  if (q) { params.push(`%${q}%`); extra += ` AND (lower(COALESCE(p.trx_id,'')) LIKE $${params.length} OR lower(COALESCE(p.payer_number,'')) LIKE $${params.length} OR lower(COALESCE(i.invoice_number,'')) LIKE $${params.length} OR lower(COALESCE(s.username,'')) LIKE $${params.length})`; }
  if (gateway) { params.push(`%${gateway}%`); extra += ` AND upper(COALESCE(p.gateway,'')) LIKE $${params.length}`; }
  if (from) { params.push(from); extra += ` AND COALESCE(p.verified_at,p.created_at)::date >= $${params.length}::date`; }
  if (to) { params.push(to); extra += ` AND COALESCE(p.verified_at,p.created_at)::date <= $${params.length}::date`; }
  const rows = (await pool.query(`SELECT p.*, s.full_name, s.client_code, s.username, s.phone, s.package_name, i.invoice_number,
      COALESCE(p.payer_info->>'bank_txn_id', p.gateway_response->>'bank_txn_id') AS bank_txn_id,
      COALESCE(p.payer_info->>'bank_name', p.gateway_response->>'bank_name') AS bank_name,
      COALESCE(p.payer_info->>'payment_mode', p.gateway_response->>'payment_mode') AS payment_mode
    FROM payments p JOIN subscribers s ON s.id=p.subscriber_id
    LEFT JOIN invoices i ON i.id=p.invoice_id
    WHERE s.reseller_id=$1 ${extra} ORDER BY COALESCE(p.verified_at,p.created_at) DESC LIMIT 500`, params)).rows;
  const sum = (await pool.query(`SELECT COALESCE(SUM(p.amount),0)::numeric(12,2) AS total_collected, COUNT(*)::int AS txn_count
    FROM payments p JOIN subscribers s ON s.id=p.subscriber_id
    WHERE s.reseller_id=$1 ${extra}`, params).catch(()=>({ rows: [{}] } as any))).rows[0] || {};
  res.json({ data: rows, summary: sum, total: rows.length });
}));

// RADIUS auth/accounting log (radacct is the source of truth for AAA events)
router.get('/:id/radius-log', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const params: any[] = [req.params.id];
  let extra = '';
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').toUpperCase();
  const from = String(req.query.from || ''); const to = String(req.query.to || '');
  if (q) { params.push(`%${q}%`); extra += ` AND (lower(COALESCE(ra.username,'')) LIKE $${params.length} OR lower(COALESCE(ra.framedipaddress::text,'')) LIKE $${params.length} OR lower(COALESCE(ra.callingstationid,'')) LIKE $${params.length} OR lower(COALESCE(ra.nasipaddress::text,'')) LIKE $${params.length})`; }
  if (status === 'ONLINE') extra += ' AND ra.acctstoptime IS NULL';
  if (status === 'OFFLINE') extra += ' AND ra.acctstoptime IS NOT NULL';
  if (from) { params.push(from); extra += ` AND ra.acctstarttime::date >= $${params.length}::date`; }
  if (to) { params.push(to); extra += ` AND ra.acctstarttime::date <= $${params.length}::date`; }
  const rows = (await pool.query(`SELECT ra.radacctid AS id, ra.username, s.full_name, s.client_code,
      ra.acctstarttime AS created_at, ra.acctstarttime, ra.acctstoptime, ra.acctupdatetime,
      ra.framedipaddress AS ip_address, ra.callingstationid AS mac_address,
      ra.nasipaddress AS nas, ra.nasportid AS nas_port,
      CASE WHEN ra.acctstoptime IS NULL THEN 'ONLINE' ELSE 'OFFLINE' END AS status,
      COALESCE(ra.acctterminatecause,'') AS reply_message, ra.acctsessiontime AS session_sec
    FROM radacct ra JOIN subscribers s ON s.username=ra.username
    WHERE s.reseller_id=$1 ${extra} ORDER BY ra.acctstarttime DESC NULLS LAST LIMIT 500`, params).catch(()=>({ rows: [] } as any))).rows;
  res.json({ data: rows, total: rows.length });
}));

// Login log (authentication attempts / sessions for partner users)
router.get('/:id/login-log', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const params: any[] = [req.params.id];
  const rows = (await pool.query(`SELECT a.id, a.created_at, a.action, a.actor_name, a.actor_role, a.entity_type, a.entity_id, a.details
    FROM audit_logs a WHERE (a.entity_type='reseller' AND a.entity_id=$1::text)
      OR (a.details::text ILIKE '%' || $1::text || '%')
    ORDER BY a.created_at DESC LIMIT 500`, params).catch(()=>({ rows: [] } as any))).rows;
  res.json({ data: rows, total: rows.length });
}));

// Top bandwidth consumers this month
router.get('/:id/top-bandwidth', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const rows = (await pool.query(`
    SELECT s.id, s.full_name, s.username, s.client_code, s.package_name,
           COALESCE(SUM(COALESCE(ss.rx_bytes,0)+COALESCE(ss.tx_bytes,0)),0)::bigint AS total_bytes,
           COALESCE(MAX(ss.rx_bps),0)::bigint AS peak_rx_bps,
           COALESCE(MAX(ss.tx_bps),0)::bigint AS peak_tx_bps
    FROM subscribers s LEFT JOIN subscriber_sessions ss ON ss.subscriber_id=s.id
    WHERE s.reseller_id=$1
    GROUP BY s.id ORDER BY total_bytes DESC LIMIT 10`, [req.params.id]).catch(()=>({ rows: [] } as any))).rows;
  res.json({ data: rows });
}));

// Date-range history counts for dashboard history panels
router.get('/:id/history', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const id = req.params.id;
  const ranges: Record<string, string> = {
    today: 'CURRENT_DATE', yesterday: 'CURRENT_DATE - 1',
    month: 'date_trunc(\'month\', CURRENT_DATE)', last_month: 'date_trunc(\'month\', CURRENT_DATE) - interval \'1 month\'',
    next_7: '(CURRENT_DATE + interval \'7 day\')::date',
  };
  const out: any = {};
  for (const [key, expr] of Object.entries(ranges)) {
    const r = await pool.query(`SELECT
        (SELECT COUNT(*)::int FROM subscribers WHERE reseller_id=$1 AND created_at::date = (${expr})::date) AS registered,
        (SELECT COUNT(*)::int FROM subscribers WHERE reseller_id=$1 AND expiry_date::date = (${expr})::date) AS expired,
        (SELECT COUNT(*)::int FROM reseller_wallet_transactions WHERE reseller_id=$1 AND type='SUBSCRIBER_RENEWAL' AND created_at::date = (${expr})::date) AS renewed,
        (SELECT COUNT(*)::int FROM payments p JOIN subscribers s ON s.id=p.subscriber_id WHERE s.reseller_id=$1 AND upper(p.status) IN ('COMPLETED','SUCCESS','PAID') AND COALESCE(p.verified_at,p.created_at)::date = (${expr})::date) AS paid`, [id]).catch(()=>({ rows: [{}] } as any));
    out[key] = r.rows[0] || {};
  }
  res.json({ data: out });
}));

/* ========================================================================== */
/* Full SRZone parity: branches, persisted notifications, customer 360°,       */
/* gateway top-ups, XLSX export, reconnect and saved layouts                  */
/* ========================================================================== */

async function assertOwnPartner(req: any, res: any, id: string): Promise<boolean> {
  const user = getUser(req);
  if (isAdminLike(user.role)) return true;
  if (user.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (rid === id) return true;
    res.status(403).json({ message: 'Forbidden' });
    return false;
  }
  res.status(403).json({ message: 'Insufficient permissions' });
  return false;
}

async function assertOwnSubscriber(req: any, res: any, resellerId: string, subscriberId: string): Promise<any | null> {
  const s = (await pool.query('SELECT * FROM subscribers WHERE id=$1 AND reseller_id=$2', [subscriberId, resellerId])).rows[0];
  if (!s) { res.status(404).json({ message: 'Subscriber not found in this reseller' }); return null; }
  return s;
}

// ---- Branches -------------------------------------------------------------
router.get('/:id/branches', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const rows = (await pool.query('SELECT * FROM branches WHERE reseller_id=$1 ORDER BY name ASC', [req.params.id])).rows;
  res.json({ data: rows });
}));

router.post('/:id/branches', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'name is required' });
  const r = (await pool.query(`INSERT INTO branches(reseller_id,name,code,address,status)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id, name, req.body?.code || null, req.body?.address || null, req.body?.status || 'ACTIVE'])).rows[0];
  res.status(201).json({ ok: true, data: r });
}));

router.delete('/:id/branches/:branchId', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  await pool.query('DELETE FROM branches WHERE id=$1 AND reseller_id=$2', [req.params.branchId, req.params.id]);
  res.json({ ok: true });
}));

// ---- Persisted notifications ----------------------------------------------
router.get('/me/notification-log', asyncHandler(async (req, res) => {
  const rid = await resolveResellerIdForUser(req);
  if (!rid) return res.status(403).json({ message: 'No reseller account linked' });
  req.params.id = rid;
  const limit = Math.min(50, Math.max(5, Number(req.query.limit || 10) || 10));
  const rows = (await pool.query('SELECT * FROM reseller_notifications WHERE reseller_id=$1 ORDER BY created_at DESC LIMIT $2', [rid, limit])).rows;
  const u = (await pool.query('SELECT COUNT(*)::int AS n FROM reseller_notifications WHERE reseller_id=$1 AND is_read=false', [rid])).rows[0]?.n || 0;
  res.json({ data: rows, unread: u });
}));

router.get('/:id/notification-log', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const limit = Math.min(500, Math.max(20, Number(req.query.limit || 200) || 200));
  const unreadOnly = String(req.query.unread || '') === '1';
  const rows = (await pool.query(`SELECT * FROM reseller_notifications WHERE reseller_id=$1 ${unreadOnly ? 'AND is_read=false' : ''} ORDER BY created_at DESC LIMIT $2`, [req.params.id, limit])).rows;
  const unread = (await pool.query('SELECT COUNT(*)::int AS n FROM reseller_notifications WHERE reseller_id=$1 AND is_read=false', [req.params.id])).rows[0]?.n || 0;
  res.json({ data: rows, unread });
}));

router.post('/:id/notifications/:notifId/read', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  await pool.query('UPDATE reseller_notifications SET is_read=true, read_at=now() WHERE id=$1 AND reseller_id=$2', [req.params.notifId, req.params.id]);
  res.json({ ok: true });
}));

router.post('/:id/notifications/read-all', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  await pool.query('UPDATE reseller_notifications SET is_read=true, read_at=now() WHERE reseller_id=$1 AND is_read=false', [req.params.id]);
  res.json({ ok: true });
}));

// ---- Saved dashboard/column layouts ---------------------------------------
router.put('/:id/layout', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  const b = req.body || {};
  const fields: string[] = []; const vals: any[] = [];
  if (b.dashboard_layout !== undefined) { vals.push(JSON.stringify(b.dashboard_layout)); fields.push(`dashboard_layout=$${vals.length}::jsonb`); }
  if (b.column_layout !== undefined) { vals.push(JSON.stringify(b.column_layout)); fields.push(`column_layout=$${vals.length}::jsonb`); }
  if (!fields.length) return res.status(400).json({ message: 'No layout provided' });
  vals.push(req.params.id);
  const r = (await pool.query(`UPDATE resellers SET ${fields.join(', ')}, updated_at=now() WHERE id=$${vals.length} RETURNING dashboard_layout, column_layout`, vals)).rows[0];
  res.json({ ok: true, data: r });
}));

// ---- Reconnect (CoA) -------------------------------------------------------
router.post('/:id/reconnect', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const { username, subscriber_id } = req.body || {};
  const sub = (await pool.query(`SELECT id, username, router_id FROM subscribers WHERE reseller_id=$1 AND (id::text=$2 OR lower(username)=lower($3)) LIMIT 1`,
    [req.params.id, String(subscriber_id || ''), String(username || '')])).rows[0];
  if (!sub) return res.status(404).json({ message: 'Subscriber not found in this reseller' });
  if (!sub.username) return res.status(400).json({ message: 'Subscriber has no username' });
  let rt = sub.router_id ? (await pool.query('SELECT name,host,radius_secret,coa_port FROM network_routers WHERE id=$1', [sub.router_id])).rows[0] : null;
  if (!rt) rt = (await pool.query("SELECT name,host,radius_secret,coa_port FROM network_routers WHERE integration_mode='RADIUS' AND is_enabled=true ORDER BY created_at LIMIT 1")).rows[0];
  if (!rt?.host || !rt?.radius_secret) return res.status(400).json({ message: 'No RADIUS NAS available for CoA' });
  let status = 'FAILED', message = '';
  try {
    const { sendCoaPacket } = await import('../integrations/radius');
    const coa = await sendCoaPacket({ host: rt.host, port: Number(rt.coa_port || 3799), secret: String(rt.radius_secret), username: sub.username, action: 'COA', attributes: { 'Reply-Message': 'Reconnect requested from partner portal' } });
    status = coa.ok ? 'EXECUTED' : 'FAILED';
    message = coa.ok ? `CoA reconnect sent via ${rt.name || rt.host}` : `CoA no ACK: ${coa.error || coa.code}`;
  } catch (e: any) { message = `Reconnect failed: ${e.message}`; }
  const request = (await pool.query(`INSERT INTO coa_requests(subscriber_id,username,router_id,action,attributes,status,response_message,executed_at)
    VALUES($1,$2,$3,'RECONNECT',$4::jsonb,$5,$6,now()) RETURNING *`,
    [sub.id, sub.username, sub.router_id || null, JSON.stringify({ source: 'reseller_portal' }), status, message])).rows[0];
  res.json({ ok: status === 'EXECUTED', request, message });
}));

// ---- Customer 360° detail --------------------------------------------------
router.get('/:id/customers/:sid/detail', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const sub = await assertOwnSubscriber(req, res, req.params.id, req.params.sid);
  if (!sub) return;
  const pid = req.params.sid;
  const q = (sql: string) => pool.query(sql, [pid]).catch(() => ({ rows: [] } as any));
  const [online, invoices, payments, sessions, documents, logs, onu] = await Promise.all([
    q(`SELECT * FROM subscriber_sessions WHERE subscriber_id=$1 ORDER BY updated_at DESC LIMIT 20`),
    q(`SELECT * FROM invoices WHERE subscriber_id=$1 ORDER BY created_at DESC LIMIT 50`),
    q(`SELECT * FROM payments WHERE subscriber_id=$1 ORDER BY created_at DESC LIMIT 50`),
    q(`SELECT radacctid AS id, username, acctstarttime, acctstoptime, framedipaddress AS ip, acctinputoctets, acctoutputoctets, acctsessiontime, acctterminatecause, nasipaddress AS nas
       FROM radacct WHERE username=(SELECT username FROM subscribers WHERE id=$1) ORDER BY acctstarttime DESC LIMIT 50`),
    q(`SELECT * FROM kyc_documents WHERE subscriber_id=$1 ORDER BY uploaded_at DESC`),
    q(`SELECT id, created_at, action, actor_name, actor_role, details FROM audit_logs WHERE entity_type='subscriber' AND entity_id=$1 ORDER BY created_at DESC LIMIT 50`),
    q(`SELECT o.*, ol.name AS olt_name FROM onus o LEFT JOIN olts ol ON ol.id=o.olt_id WHERE o.subscriber_id=$1 ORDER BY o.updated_at DESC`),
  ]);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
  const traffic = months.map(m => ({
    month: m,
    download_bytes: Number((sessions.rows as any[]).filter(r => String(r.acctstarttime || '').startsWith(m)).reduce((a, r) => a + Number(r.acctinputoctets || 0), 0)),
    upload_bytes: Number((sessions.rows as any[]).filter(r => String(r.acctstarttime || '').startsWith(m)).reduce((a, r) => a + Number(r.acctoutputoctets || 0), 0)),
  }));
  res.json({ data: {
    basic: sub, online: online.rows, onu: onu.rows, renewal: invoices.rows,
    traffic, sessions: sessions.rows,
    finance: { invoices: invoices.rows, payments: payments.rows,
      total_invoiced: (invoices.rows as any[]).reduce((a, r) => a + Number(r.total_amount || 0), 0),
      total_paid: (payments.rows as any[]).reduce((a, r) => a + Number(r.amount || 0), 0) },
    documents: documents.rows, logs: logs.rows,
  } });
}));

// Scoped invoice print (PDF) for the customer 360° view
router.get('/:id/customers/:sid/invoices/:iid/pdf', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const sub = await assertOwnSubscriber(req, res, req.params.id, req.params.sid);
  if (!sub) return;
  const inv = await getInvoiceWithItems(req.params.iid);
  if (!inv || String(inv.subscriber_id) !== String(sub.id)) return res.status(404).json({ message: 'Invoice not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${inv.invoice_number || inv.id}.pdf"`);
  res.send(renderSimpleInvoicePdf(inv));
}));

// ---- Pay Now / Add Money for an owned subscriber ---------------------------
router.post('/:id/customers/:sid/payment', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  const amount = Number(req.body?.amount || 0);
  if (!(amount > 0)) return res.status(400).json({ message: 'amount must be > 0' });
  const mode = String(req.body?.mode || 'PAY').toUpperCase();
  if (!['PAY', 'ADD'].includes(mode)) return res.status(400).json({ message: 'mode must be PAY or ADD' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rr = await client.query('SELECT * FROM resellers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const reseller = rr.rows[0];
    if (!reseller) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Reseller not found' }); }
    const sr = await client.query('SELECT * FROM subscribers WHERE id=$1 AND reseller_id=$2 FOR UPDATE', [req.params.sid, req.params.id]);
    const sub = sr.rows[0];
    if (!sub) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Subscriber not found' }); }
    if (Number(reseller.wallet_balance || 0) < amount) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Insufficient wallet balance' }); }

    let remaining = amount;
    if (mode === 'PAY') {
      const open = await client.query(`SELECT * FROM invoices WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE') AND GREATEST(due_amount,0)>0 ORDER BY COALESCE(due_date, created_at) ASC`, [sub.id]);
      for (const inv of open.rows) {
        if (remaining <= 0) break;
        const total = Number(inv.total_amount || inv.amount || 0);
        const take = +Math.min(remaining, Math.max(0, total - Number(inv.paid_amount || 0))).toFixed(2);
        if (!(take > 0)) continue;
        const paid = +(Number(inv.paid_amount || 0) + take).toFixed(2);
        const due = +Math.max(0, total - paid).toFixed(2);
        await client.query(`UPDATE invoices SET paid_amount=$2, due_amount=$3, status=$4, paid_at=CASE WHEN $4='PAID' THEN COALESCE(paid_at,now()) ELSE paid_at END, updated_at=now() WHERE id=$1`, [inv.id, paid, due, due <= 0 ? 'PAID' : 'PARTIAL']);
        remaining = +(remaining - take).toFixed(2);
      }
    }
    const dueRow = await client.query(`SELECT COALESCE(SUM(GREATEST(due_amount,0)),0)::numeric(12,2) AS due FROM invoices WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE')`, [sub.id]);
    const newDue = Number(dueRow.rows[0]?.due || 0);
    const newExcess = mode === 'ADD' ? +(Number(sub.excess_amount || 0) + amount).toFixed(2) : +(remaining > 0 ? Number(sub.excess_amount || 0) + remaining : Number(sub.excess_amount || 0)).toFixed(2);
    await client.query('UPDATE subscribers SET current_due=$2, excess_amount=$3, updated_at=now() WHERE id=$1', [sub.id, newDue, newExcess]);

    const pref = `RP-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const payment = (await client.query(`INSERT INTO payments(payment_ref,invoice_id,subscriber_id,gateway,method,amount,currency,status,trx_id,payer_info,gateway_response,verified_at)
      VALUES($1,NULL,$2,'RESELLER_WALLET',$3,$4,'BDT','COMPLETED',$5,$6::jsonb,$7::jsonb,now()) RETURNING *`,
      [pref, sub.id, String(req.body?.payment_type || 'CASH').toUpperCase(), amount, req.body?.trx_id || pref,
       JSON.stringify({ reseller_id: reseller.id, mode, notes: req.body?.notes || null }),
       JSON.stringify({ source: 'RESELLER_PORTAL_PAYMENT', amount, mode })])).rows[0];
    const newBal = +(Number(reseller.wallet_balance || 0) - amount).toFixed(2);
    await client.query('UPDATE resellers SET wallet_balance=$2, updated_at=now() WHERE id=$1', [reseller.id, newBal]);
    await client.query(`INSERT INTO reseller_wallet_transactions(reseller_id,type,direction,amount,balance_after,reference_type,reference_id,subscriber_id,description,metadata,created_by)
      VALUES($1,'SUBSCRIBER_PAYMENT','DEBIT',$2,$3,'PAYMENT',$4,$5,$6,$7::jsonb,$8)`,
      [reseller.id, amount, newBal, payment.id, sub.id, `${mode === 'ADD' ? 'Add money' : 'Pay now'} for ${sub.full_name || sub.username}`,
       JSON.stringify({ mode, payment_type: req.body?.payment_type, trx_id: req.body?.trx_id }), getUser(req).email || 'reseller']);
    await client.query('COMMIT');
    res.json({ ok: true, payment, balance: newBal, due: newDue, excess: newExcess });
  } catch (e: any) { await client.query('ROLLBACK').catch(()=>{}); throw e; }
  finally { client.release(); }
}));

// Admin queue for gateway wallet top-up requests
router.get('/topups/pending', asyncHandler(async (req, res) => {
  if (!isAdminLike(getUser(req).role)) return res.status(403).json({ message: 'Insufficient permissions' });
  const rows = (await pool.query(`SELECT t.*, r.name AS reseller_name, r.code AS reseller_code
    FROM wallet_topup_requests t JOIN resellers r ON r.id=t.reseller_id
    WHERE t.status='PENDING' ORDER BY t.created_at ASC LIMIT 200`)).rows;
  res.json({ data: rows });
}));

// ---- Self-service gateway wallet top-up ------------------------------------
router.post('/:id/wallet/topups', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  const amount = Number(req.body?.amount || 0);
  if (!(amount > 0)) return res.status(400).json({ message: 'amount must be > 0' });
  const gateway = String(req.body?.gateway || '').trim().toUpperCase();
  if (!gateway) return res.status(400).json({ message: 'gateway is required' });
  if (req.body?.terms_accepted !== true) return res.status(400).json({ message: 'You must accept the terms and conditions' });
  const r = (await pool.query(`INSERT INTO wallet_topup_requests(reseller_id,amount,gateway,method,trx_id,payer_number,notes,terms_accepted)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.id, amount, gateway, req.body?.method || null, req.body?.trx_id || null, req.body?.payer_number || null, req.body?.notes || null, true])).rows[0];
  res.status(201).json({ ok: true, data: r, message: 'Top-up request submitted for verification.' });
}));

router.get('/:id/wallet/topups', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const rows = (await pool.query('SELECT * FROM wallet_topup_requests WHERE reseller_id=$1 ORDER BY created_at DESC LIMIT 200', [req.params.id])).rows;
  res.json({ data: rows });
}));

async function decideTopup(req: any, res: any, approve: boolean) {
  if (!isAdminLike(getUser(req).role)) return res.status(403).json({ message: 'Insufficient permissions' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query('SELECT * FROM wallet_topup_requests WHERE id=$1 FOR UPDATE', [req.params.tid])).rows[0];
    if (!t) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Top-up request not found' }); }
    if (String(t.status) !== 'PENDING') { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Request already processed' }); }
    if (approve) {
      const rr = await client.query('SELECT * FROM resellers WHERE id=$1 FOR UPDATE', [t.reseller_id]);
      const reseller = rr.rows[0];
      if (!reseller) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Reseller not found' }); }
      const newBal = +(Number(reseller.wallet_balance || 0) + Number(t.amount)).toFixed(2);
      const limit = Number(reseller.credit_limit || 0);
      if (limit > 0 && newBal > limit) { await client.query('ROLLBACK'); return res.status(400).json({ message: `Top-up would exceed credit limit (${limit})` }); }
      await client.query('UPDATE resellers SET wallet_balance=$2, updated_at=now() WHERE id=$1', [t.reseller_id, newBal]);
      await client.query(`INSERT INTO reseller_wallet_transactions(reseller_id,type,direction,amount,balance_after,reference_type,reference_id,description,metadata,created_by)
        VALUES($1,'WALLET_TOPUP','CREDIT',$2,$3,'TOPUP',$4,$5,$6::jsonb,$7)`,
        [t.reseller_id, t.amount, newBal, t.id, `Wallet top-up via ${t.gateway}`, JSON.stringify({ trx_id: t.trx_id, gateway: t.gateway }), getUser(req).email || 'admin']);
      await client.query(`UPDATE wallet_topup_requests SET status='APPROVED', verified_at=now(), verified_by=$2 WHERE id=$1`, [t.id, getUser(req).email || 'admin']);
      await client.query(`INSERT INTO reseller_notifications(reseller_id,kind,title,message,severity) VALUES($1,'PAYMENT','Wallet top-up approved',$2,'success')`,
        [t.reseller_id, `Your ${moneyLike(t.amount)} top-up via ${t.gateway} was credited.`]);
    } else {
      await client.query(`UPDATE wallet_topup_requests SET status='REJECTED', rejection_reason=$2, verified_at=now(), verified_by=$3 WHERE id=$1`,
        [t.id, req.body?.reason || 'Rejected by administrator', getUser(req).email || 'admin']);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e: any) { await client.query('ROLLBACK').catch(()=>{}); throw e; }
  finally { client.release(); }
}
router.post('/:id/wallet/topups/:tid/approve', asyncHandler(async (req, res) => { await decideTopup(req, res, true); }));
router.post('/:id/wallet/topups/:tid/reject', asyncHandler(async (req, res) => { await decideTopup(req, res, false); }));

// ---- Real XLSX export ------------------------------------------------------
router.get('/:id/export/xlsx', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const rows = (await pool.query(`SELECT s.client_code, s.full_name, s.username, s.status, s.phone, s.email, s.package_name,
      s.monthly_bill, s.current_due, s.expiry_date, s.ip_address, s.mac_address, s.address, s.ipv6_address, s.ipv6_prefix,
      z.name AS zone, a.name AS area, s.created_at
    FROM subscribers s LEFT JOIN zones z ON z.id=s.zone_id LEFT JOIN areas a ON a.id=s.area_id
    WHERE s.reseller_id=$1 ORDER BY s.created_at DESC LIMIT 1000`, [req.params.id])).rows;
  const headers = ['Customer ID','Full Name','Username','Status','Phone','Email','Package','Monthly Bill','Due','Expiry','IPv4','MAC','Address','IPv6','IPv6 Prefix','Zone','Area','Created'];
  const keys = ['client_code','full_name','username','status','phone','email','package_name','monthly_bill','current_due','expiry_date',
    'ip_address','mac_address','address','ipv6_address','ipv6_prefix','zone','area','created_at'];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map((r: any) => keys.map(k => r[k] ?? ''))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Subscribers');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="reseller-subscribers-${req.params.id}.xlsx"`);
  res.send(buf);
}));

/* ========================================================================== */
/* Complaints (reseller-scoped tickets) & Parental Control                    */
/* ========================================================================== */

router.get('/:id/complaints', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim();
  const params: any[] = [req.params.id];
  let where = `t.reseller_id=$1`;
  if (status) { params.push(status.toUpperCase()); where += ` AND upper(t.status)=$${params.length}`; }
  if (q) { params.push(`%${q}%`); where += ` AND (t.ticket_no ILIKE $${params.length} OR t.subject ILIKE $${params.length} OR t.description ILIKE $${params.length} OR s.full_name ILIKE $${params.length} OR s.client_code ILIKE $${params.length})`; }
  const rows = (await pool.query(`SELECT t.*, s.full_name AS subscriber_name, s.client_code, s.phone AS subscriber_phone
    FROM tickets t LEFT JOIN subscribers s ON s.id=t.subscriber_id
    WHERE ${where} ORDER BY t.created_at DESC LIMIT 300`, params)).rows;
  res.json({ data: rows });
}));

router.post('/:id/complaints', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  const subject = String(req.body?.subject || '').trim();
  if (!subject) return res.status(400).json({ message: 'subject is required' });
  const subscriberId = String(req.body?.subscriber_id || '') || null;
  let siteAddress = req.body?.site_address || null;
  let siteLat = req.body?.site_latitude != null ? Number(req.body.site_latitude) : null;
  let siteLng = req.body?.site_longitude != null ? Number(req.body.site_longitude) : null;
  if (subscriberId) {
    const sub = await assertOwnSubscriber(req, res, req.params.id, subscriberId);
    if (!sub) return; // foreign subscribers rejected with 404
    siteAddress = siteAddress || sub.address;
    if (siteLat == null) siteLat = sub.latitude;
    if (siteLng == null) siteLng = sub.longitude;
  }
  const priority = String(req.body?.priority || 'MEDIUM').toUpperCase();
  const hours = priority === 'CRITICAL' ? 4 : priority === 'HIGH' ? 8 : priority === 'LOW' ? 48 : 24;
  const slaDueAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const ticketNo = await nextTicketNo();
  const gps = (siteLat != null && siteLng != null)
    ? `https://www.google.com/maps/search/?api=1&query=${siteLat},${siteLng}`
    : (siteAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteAddress)}` : null);
  const r = (await pool.query(`INSERT INTO tickets
      (ticket_no,subscriber_id,reseller_id,subject,description,category,priority,status,sla_policy,sla_due_at,site_latitude,site_longitude,site_address,gps_nav_url,source,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,$10,$11,$12,$13,'RESELLER_PORTAL',$14) RETURNING *`,
    [ticketNo, subscriberId, req.params.id, subject, req.body?.description || null,
     req.body?.category || 'COMPLAINT', priority, `${priority} SLA`, slaDueAt,
     siteLat, siteLng, siteAddress, gps, getUser(req).email || 'reseller'])).rows[0];
  res.status(201).json({ ok: true, data: r });
}));

router.get('/:id/complaints/:tid', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const t = (await pool.query('SELECT * FROM tickets WHERE id=$1 AND reseller_id=$2', [req.params.tid, req.params.id])).rows[0];
  if (!t) return res.status(404).json({ message: 'Complaint not found' });
  const comments = (await pool.query('SELECT * FROM ticket_comments WHERE ticket_id=$1 ORDER BY created_at ASC', [req.params.tid])).rows;
  const sub = t.subscriber_id ? (await pool.query('SELECT full_name, client_code FROM subscribers WHERE id=$1', [t.subscriber_id])).rows[0] : null;
  res.json({ data: { ...t, comments, subscriber_name: sub?.full_name, client_code: sub?.client_code } });
}));

router.post('/:id/complaints/:tid/comments', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  const t = (await pool.query('SELECT id FROM tickets WHERE id=$1 AND reseller_id=$2', [req.params.tid, req.params.id])).rows[0];
  if (!t) return res.status(404).json({ message: 'Complaint not found' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ message: 'body is required' });
  const r = (await pool.query(`INSERT INTO ticket_comments(ticket_id,author_name,author_role,body,is_internal)
    VALUES($1,$2,'RESELLER',$3,false) RETURNING *`,
    [req.params.tid, getUser(req).name || getUser(req).email || 'Reseller', body])).rows[0];
  await pool.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [req.params.tid]);
  res.status(201).json({ ok: true, data: r });
}));

router.put('/:id/complaints/:tid', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  const t = (await pool.query('SELECT * FROM tickets WHERE id=$1 AND reseller_id=$2', [req.params.tid, req.params.id])).rows[0];
  if (!t) return res.status(404).json({ message: 'Complaint not found' });
  const status = String(req.body?.status || t.status).toUpperCase();
  const resolution = req.body?.resolution_notes ?? t.resolution_notes;
  const closedAt = ['RESOLVED', 'CLOSED'].includes(status) ? (t.closed_at || new Date().toISOString()) : null;
  const r = (await pool.query(`UPDATE tickets SET status=$2, resolution_notes=$3, closed_at=$4, updated_at=now()
    WHERE id=$1 AND reseller_id=$5 RETURNING *`,
    [req.params.tid, status, resolution, closedAt, req.params.id])).rows[0];
  res.json({ ok: true, data: r });
}));

router.get('/:id/parental-control', asyncHandler(async (req, res) => {
  if (!(await ensureResellerAccess(req, res, req.params.id))) return;
  const q = String(req.query.q || '').trim();
  const enabled = String(req.query.enabled || '');
  const params: any[] = [req.params.id];
  let where = `reseller_id=$1`;
  if (q) { params.push(`%${q}%`); where += ` AND (full_name ILIKE $${params.length} OR username ILIKE $${params.length} OR client_code ILIKE $${params.length} OR phone ILIKE $${params.length})`; }
  if (enabled === '1') where += ` AND parental_control_enabled=true`;
  if (enabled === '0') where += ` AND parental_control_enabled=false`;
  const rows = (await pool.query(`SELECT id, client_code, full_name, username, phone, status, package_name,
      parental_control_enabled FROM subscribers WHERE ${where} ORDER BY full_name ASC LIMIT 500`, params)).rows;
  const enabledCount = (await pool.query('SELECT COUNT(*)::int AS n FROM subscribers WHERE reseller_id=$1 AND parental_control_enabled=true', [req.params.id])).rows[0]?.n || 0;
  res.json({ data: rows, enabled_count: enabledCount });
}));

router.put('/:id/parental-control/:sid', asyncHandler(async (req, res) => {
  if (!(await assertOwnPartner(req, res, req.params.id))) return;
  const sub = await assertOwnSubscriber(req, res, req.params.id, req.params.sid);
  if (!sub) return;
  const enabled = !!req.body?.enabled;
  await pool.query('UPDATE subscribers SET parental_control_enabled=$2, updated_at=now() WHERE id=$1', [req.params.sid, enabled]);
  // Re-sync RADIUS so the change takes effect on the next authentication/CoA.
  let radius: any = null;
  try {
    const fresh = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [req.params.sid])).rows[0];
    radius = await syncSubscriberToRadiusDb(fresh);
  } catch (e: any) { radius = { ok: false, error: e.message }; }
  res.json({ ok: true, enabled, radius });
}));

export default router;
