import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { recalcSubscriberDue, reactivateSubscriber } from '../integrations/billing';

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
      COUNT(*) FILTER (WHERE COALESCE(price_override,0) > 0)::int AS custom_price_users
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
  const params: any[] = [id];
  let where = 'WHERE s.reseller_id=$1';
  if (status) { params.push(status); where += ` AND upper(s.status)=$${params.length}`; }
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (lower(COALESCE(s.full_name,'')) LIKE $${params.length} OR lower(COALESCE(s.username,'')) LIKE $${params.length} OR lower(COALESCE(s.client_code,'')) LIKE $${params.length} OR lower(COALESCE(s.phone,'')) LIKE $${params.length} OR lower(COALESCE(s.email,'')) LIKE $${params.length} OR lower(COALESCE(s.address,'')) LIKE $${params.length} OR lower(COALESCE(s.ip_address,'')) LIKE $${params.length} OR lower(COALESCE(s.mac_address,'')) LIKE $${params.length} OR lower(COALESCE(s.nid_number,'')) LIKE $${params.length})`;
  }
  const r = await pool.query(`SELECT s.id,s.client_code,s.full_name,s.username,s.phone,s.email,s.status,s.package_name,s.monthly_bill,s.current_due,s.expiry_date,s.created_at,s.provisioning_mode,s.ip_address,s.mac_address,s.address,s.zone,s.area,s.connection_type
    FROM subscribers s ${where} ORDER BY s.created_at DESC LIMIT 500`, params);
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
             ss.status, ss.ip_address, ss.mac_address, ss.rx_bps, ss.tx_bps, ss.uptime_sec, ss.updated_at, ss.router_id
      FROM subscribers s
      JOIN subscriber_sessions ss ON ss.subscriber_id = s.id
      WHERE s.reseller_id=$1
      ORDER BY (upper(ss.status)='ONLINE') DESC, ss.updated_at DESC NULLS LAST
      LIMIT 500`, [id]);
    rows = r.rows;
  } catch {
    try {
      const r = await pool.query(`
        SELECT s.id as subscriber_id, s.client_code, s.full_name, s.username, s.package_name,
               'ONLINE' as status, ra.framedipaddress as ip_address, ra.callingstationid as mac_address,
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
  const r = await pool.query(`
    SELECT t.id, t.created_at as date, t.amount as partner_charge, t.balance_after, t.description, t.created_by,
           t.metadata, s.full_name, s.username, s.client_code, s.phone, s.package_name, s.monthly_bill,
           p.payment_ref, p.amount as paid_amount, p.status as payment_status
    FROM reseller_wallet_transactions t
    LEFT JOIN subscribers s ON s.id=t.subscriber_id
    LEFT JOIN payments p ON p.id::text = t.reference_id AND t.reference_type='PAYMENT'
    WHERE t.reseller_id=$1 AND t.type='SUBSCRIBER_RENEWAL'
    ORDER BY t.created_at DESC LIMIT 500`, [id]);
  const rows = r.rows.map((row: any) => {
    const m = row.metadata || {};
    const retail = Number(m.retail ?? row.monthly_bill ?? 0);
    const marginPct = Number(m.marginPct ?? m.margin_percent ?? 0);
    const wholesale = Number(m.wholesale ?? row.partner_charge ?? 0);
    const ispShare = +(retail - wholesale).toFixed(2);
    return { ...row, retail, margin_percent: marginPct, partner_share: wholesale, isp_share: ispShare >= 0 ? ispShare : 0 };
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
  try {
    const r = await pool.query(`
      SELECT o.*, s.full_name as subscriber_name, s.client_code, s.username
      FROM onus o
      JOIN subscribers s ON s.id = o.subscriber_id
      WHERE s.reseller_id=$1
      ORDER BY o.updated_at DESC NULLS LAST, o.id DESC LIMIT 500`, [id]);
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
  res.json({ data: alerts.slice(0, 50), total: alerts.length });
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

export default router;
