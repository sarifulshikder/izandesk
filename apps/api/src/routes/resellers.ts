import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';
import { recalcSubscriberDue } from '../integrations/billing';

const router: Router = Router();

function getUser(req: any) { return req.user || {}; }
function isAdminLike(role: string) { return ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER'].includes(role); }

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
  // fallback to demo reseller
  const r = await pool.query("SELECT id FROM resellers WHERE code='RES-CYBERNET' LIMIT 1");
  return r.rows[0]?.id || null;
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
  const r = await pool.query(`INSERT INTO resellers(code,name,company_name,tier,parent_reseller_id,email,phone,subdomain,custom_domain,brand_name,logo_url,primary_color,secondary_color,portal_title,status,wallet_balance,credit_limit,commission_percent,buying_margin_percent,address,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [code,b.name,b.company_name||null,b.tier||'STANDARD',b.parent_reseller_id||null,b.email||null,b.phone||null,b.subdomain?String(b.subdomain).toLowerCase().trim():null,b.custom_domain||null,b.brand_name||b.company_name||b.name,b.logo_url||null,b.primary_color||null,b.secondary_color||null,b.portal_title||`${b.name} Portal`,b.status||'ACTIVE',Number(b.wallet_balance||0),Number(b.credit_limit||0),Number(b.commission_percent||0),Number(b.buying_margin_percent||0),b.address||null,b.notes||null]);
  res.status(201).json({ data: r.rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (!['SUPER_ADMIN','BILLING_OPERATOR'].includes(user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
  const b = req.body || {};
  const r = await pool.query(`UPDATE resellers SET name=COALESCE($1,name), company_name=$2, tier=COALESCE($3,tier), parent_reseller_id=$4, email=$5, phone=$6, subdomain=$7, custom_domain=$8, brand_name=$9, logo_url=$10, primary_color=$11, secondary_color=$12, portal_title=$13, status=COALESCE($14,status), credit_limit=COALESCE($15,credit_limit), commission_percent=COALESCE($16,commission_percent), buying_margin_percent=COALESCE($17,buying_margin_percent), address=$18, notes=$19, updated_at=now() WHERE id=$20 RETURNING *`,
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
  if (!['SUPER_ADMIN','BILLING_OPERATOR','RESELLER'].includes(user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
  if (user.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (rid !== req.params.id) return res.status(403).json({ message: 'Forbidden' });
  }
  const amount = Number(req.body?.amount || 0);
  if (!(amount > 0)) return res.status(400).json({ message: 'amount must be > 0' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rr = await client.query('SELECT * FROM resellers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const reseller = rr.rows[0];
    if (!reseller) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Reseller not found' }); }
    const newBal = Number(reseller.wallet_balance || 0) + amount;
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
  try {
    await client.query('BEGIN');
    const rr = await client.query('SELECT * FROM resellers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const reseller = rr.rows[0];
    if (!reseller) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Reseller not found' }); }
    if (String(reseller.status).toUpperCase() !== 'ACTIVE') { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Reseller is not active' }); }

    const sr = await client.query('SELECT * FROM subscribers WHERE id=$1 FOR UPDATE', [subscriber_id]);
    const sub = sr.rows[0];
    if (!sub) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Subscriber not found' }); }
    // attach subscriber to reseller if not set
    if (!sub.reseller_id) {
      await client.query('UPDATE subscribers SET reseller_id=$2, updated_at=now() WHERE id=$1', [sub.id, reseller.id]);
      sub.reseller_id = reseller.id;
    } else if (String(sub.reseller_id) !== String(reseller.id) && user.role === 'RESELLER') {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Subscriber does not belong to this reseller' });
    }

    const retail = Number(sub.monthly_bill || 0);
    const marginPct = Number(reseller.buying_margin_percent || 0);
    const wholesale = +(retail * (1 - marginPct / 100)).toFixed(2);
    const charge = wholesale > 0 ? wholesale : retail;
    if (Number(reseller.wallet_balance || 0) < charge) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Insufficient wallet balance. Required ${charge}, available ${Number(reseller.wallet_balance||0)}` });
    }

    // apply as subscriber credit/payment (auto-deduction from reseller wallet)
    const newSubDue = Math.max(0, Number(sub.current_due || 0) - Number(charge));
    await client.query("UPDATE subscribers SET current_due=$2::numeric, status=CASE WHEN $2::numeric <= 0 THEN 'ACTIVE' ELSE status END, updated_at=now() WHERE id=$1", [sub.id, newSubDue]);
    // create payment record tied to reseller wallet renewal
    const pref = `RWAL-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const pay = await client.query(`INSERT INTO payments(payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, trx_id, payer_info, gateway_response, verified_at)
      VALUES($1,NULL,$2::uuid,'RESELLER_WALLET','WALLET_DEDUCTION',$3::numeric,'BDT','COMPLETED',$4,$5::jsonb,$6::jsonb,now()) RETURNING *`,
      [pref, sub.id, Number(charge), pref, JSON.stringify({ reseller_id: reseller.id, reseller_name: reseller.name }), JSON.stringify({ type: 'RESELLER_RENEWAL', retail, marginPct, wholesale: charge })]);
    // wallet debit
    const newBal = +(Number(reseller.wallet_balance || 0) - Number(charge)).toFixed(2);
    await client.query('UPDATE resellers SET wallet_balance=$2::numeric, updated_at=now() WHERE id=$1', [reseller.id, newBal]);
    const wtx = await client.query(`INSERT INTO reseller_wallet_transactions(reseller_id,type,direction,amount,balance_after,reference_type,reference_id,subscriber_id,description,metadata,created_by)
      VALUES($1::uuid,'SUBSCRIBER_RENEWAL','DEBIT',$2::numeric,$3::numeric,'PAYMENT',$4::uuid,$5::uuid,$6,$7::jsonb,$8) RETURNING *`,
      [reseller.id, Number(charge), newBal, pay.rows[0].id, sub.id, `Renewed ${sub.full_name || sub.client_code || sub.username} (retail ${retail}, margin ${marginPct}%, charged ${charge})`, JSON.stringify({ retail, marginPct, wholesale: charge }), user.email || user.id || 'system']);

    await client.query('COMMIT');
    // trigger reactivation/billing recalculation outside tx
    try { await recalcSubscriberDue(sub.id); } catch {}
    res.json({ ok: true, charged: charge, retail, margin_percent: marginPct, wholesale, balance: newBal, payment: pay.rows[0], wallet_transaction: wtx.rows[0], subscriber: { id: sub.id, current_due: newSubDue } });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}));

router.get('/:id/subscribers', asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (user.role === 'RESELLER') {
    const rid = await resolveResellerIdForUser(req);
    if (rid !== req.params.id) return res.status(403).json({ message: 'Forbidden' });
  }
  const r = await pool.query(`SELECT s.id,s.client_code,s.full_name,s.username,s.phone,s.status,s.package_name,s.monthly_bill,s.current_due,s.expiry_date,s.provisioning_mode
    FROM subscribers s WHERE s.reseller_id=$1 ORDER BY s.created_at DESC`, [req.params.id]);
  res.json({ data: r.rows });
}));

export default router;
