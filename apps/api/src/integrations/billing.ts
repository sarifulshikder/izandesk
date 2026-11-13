import { pool } from '../db';
import { mikrotikSyncPppSecret, mikrotikRemovePppSecret } from './mikrotik';
import { syncSubscriberToRadiusDb, sendCoaPacket } from './radius';

type AnyObj = Record<string, any>;

export const SUSPENSION_STAGES = {
  NONE: 'NONE',
  WARNING: 'WARNING',
  GRACE: 'GRACE',
  WALLED_GARDEN: 'WALLED_GARDEN',
  ISOLATED: 'ISOLATED',
  SUSPENDED: 'SUSPENDED',
} as const;

function toDate(d: any): Date | null {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}
function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function startOfMonth(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function endOfMonth(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function daysInMonth(d: Date) { return endOfMonth(d).getUTCDate(); }
function diffDays(a: Date, b: Date) { return Math.floor((a.getTime() - b.getTime()) / 86400000); }

async function getDefaultPolicy() {
  const r = await pool.query(`SELECT * FROM billing_policies ORDER BY is_default DESC, created_at ASC LIMIT 1`);
  return r.rows[0] || { grace_days: 7, warning_days: 3, auto_suspend: true, isolate_on_suspend: true, enable_walled_garden: true, currency: 'BDT' };
}

export async function recalcSubscriberDue(subscriberId: string) {
  const inv = await pool.query(`SELECT COALESCE(SUM(GREATEST(due_amount,0)),0)::numeric(12,2) as due FROM invoices WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE')`, [subscriberId]);
  const due = Number(inv.rows[0]?.due || 0);
  await pool.query(`UPDATE subscribers SET current_due=$2, updated_at=now() WHERE id=$1`, [subscriberId, due]);
  return due;
}

function computeProratedAmount(monthly: number, from: Date, to: Date) {
  const dim = daysInMonth(from);
  const dayStart = from.getUTCDate();
  const dayEnd = to.getUTCDate();
  const totalDays = Math.max(1, dayEnd - dayStart + 1);
  const ratio = totalDays / dim;
  const amount = +(monthly * ratio).toFixed(2);
  return { amount, ratio: +ratio.toFixed(6), totalDays, dim };
}

async function nextInvoiceNumber() {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const r = await pool.query(`SELECT COUNT(*)::int as c FROM invoices WHERE invoice_number LIKE $1`, [`INV-${ym}-%`]);
  const n = (r.rows[0]?.c || 0) + 1;
  return `INV-${ym}-${String(n).padStart(5, '0')}`;
}

export async function generateInvoiceForSubscriber(sub: AnyObj, opts: { cycleDate?: Date; force?: boolean } = {}) {
  const monthly = Number(sub.monthly_bill || 0);
  if (!(monthly > 0)) return { skipped: true, reason: 'no monthly bill', subscriber_id: sub.id };
  const cycleDate = opts.cycleDate || new Date();
  const periodStart = startOfMonth(cycleDate);
  const periodEnd = endOfMonth(cycleDate);
  const billMonth = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}`;
  const existing = await pool.query(`SELECT id, invoice_number FROM invoices WHERE subscriber_id=$1 AND bill_month=$2 AND status <> 'CANCELLED' LIMIT 1`, [sub.id, billMonth]);
  if (existing.rows[0] && !opts.force) return { skipped: true, reason: 'already invoiced', subscriber_id: sub.id, invoice: existing.rows[0] };

  let amount = monthly;
  let prorated = false;
  let prorate_ratio: number | null = null;
  let pStart = periodStart;
  let note = `Monthly subscription (${billMonth})`;
  const install = toDate(sub.installation_date);
  if (install && install > periodStart && install <= periodEnd) {
    const pr = computeProratedAmount(monthly, install, periodEnd);
    amount = pr.amount; prorated = true; prorate_ratio = pr.ratio; pStart = install;
    note = `Prorated subscription ${ymd(install)}-${ymd(periodEnd)} (${pr.totalDays}/${pr.dim} days)`;
  }
  const policy = await getDefaultPolicy();
  const due = addDays(new Date(), 7);
  const invoice_number = await nextInvoiceNumber();
  const total = +amount.toFixed(2);
  const ins = await pool.query(`INSERT INTO invoices (
      invoice_number, subscriber_id, client_code, subscriber_name, username, billing_cycle, bill_month,
      period_start, period_end, issue_date, due_date, amount, discount, tax, total_amount, paid_amount, due_amount,
      status, notes, prorated, prorate_ratio, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_DATE,$10,$11,0,0,$12,0,$12,'UNPAID',$13,$14,$15,$16::jsonb) RETURNING *`,
    [invoice_number, sub.id, sub.client_code, sub.full_name, sub.username || null, billMonth, billMonth,
     ymd(pStart), ymd(periodEnd), ymd(due), amount, total, note, prorated, prorate_ratio,
     JSON.stringify({ package_name: sub.package_name, monthly_bill: monthly, policy: policy.name })]
  );
  const inv = ins.rows[0];
  await pool.query(`INSERT INTO invoice_items (invoice_id, description, item_type, quantity, unit_price, amount, metadata)
    VALUES ($1,$2,'SUBSCRIPTION',1,$3,$3,$4::jsonb)`,
    [inv.id, note, amount, JSON.stringify({ package_name: sub.package_name, prorated, prorate_ratio })]);
  await pool.query(`UPDATE subscribers SET last_billed_at=now(), next_bill_date=$2, expiry_date=$3, due_date=$4, updated_at=now() WHERE id=$1`,
    [sub.id, ymd(addDays(endOfMonth(cycleDate), 1)), ymd(due), ymd(due)]);
  await recalcSubscriberDue(sub.id);
  return { ok: true, invoice: inv, prorated, amount };
}

export async function runBatchInvoicing(opts: { subscriber_ids?: string[]; cycleDate?: string } = {}) {
  const cycleDate = opts.cycleDate ? new Date(opts.cycleDate) : new Date();
  let q = `SELECT s.* FROM subscribers s WHERE COALESCE(s.monthly_bill,0) > 0 AND s.status <> 'TERMINATED'`;
  const params: any[] = [];
  if (opts.subscriber_ids && opts.subscriber_ids.length) { params.push(opts.subscriber_ids); q += ` AND s.id = ANY($1::uuid[])`; }
  q += ` ORDER BY s.created_at ASC`;
  const subs = (await pool.query(q, params)).rows;
  const results: any[] = [];
  for (const s of subs) {
    try { results.push(await generateInvoiceForSubscriber(s, { cycleDate })); } catch (e: any) { results.push({ ok: false, subscriber_id: s.id, error: e.message }); }
  }
  const generated = results.filter(r => r.ok);
  const metrics = await getBillingMetrics();
  return { ok: true, cycle: cycleDate.toISOString().slice(0,7), total: subs.length, generated: generated.length, skipped: results.filter(r=>r.skipped).length, failed: results.filter(r=>r.ok===false).length, results, metrics };
}

async function resolveNasForSubscriber(sub: AnyObj) {
  if (sub.router_id) {
    const r = await pool.query('SELECT * FROM network_routers WHERE id=$1', [sub.router_id]);
    return r.rows[0] || null;
  }
  if (String(sub.provisioning_mode || '').toUpperCase() === 'RADIUS') {
    const r = await pool.query("SELECT * FROM network_routers WHERE integration_mode='RADIUS' AND is_enabled=true ORDER BY created_at LIMIT 1");
    return r.rows[0] || null;
  }
  return null;
}

export async function applyProvisioningState(subId: string, desired: { status?: string; stage?: string; walled_garden?: boolean; reason?: string; sendCoa?: boolean; coaAction?: 'DISCONNECT'|'COA'; coaRateLimit?: string; profileOverride?: string }) {
  const sres = await pool.query(`SELECT s.*, bp.profile_name, nr.* FROM (SELECT s.*, nr2.integration_mode as router_integration_mode, nr2.name as router_name2 FROM subscribers s LEFT JOIN network_routers nr2 ON nr2.id=s.router_id) s
    LEFT JOIN bandwidth_packages bp ON bp.name=s.package_name
    LEFT JOIN network_routers nr ON nr.id=s.router_id
    WHERE s.id=$1`, [subId]);
  const sub = sres.rows[0];
  if (!sub) throw new Error('Subscriber not found');
  const updates: any = {};
  if (desired.status) updates.status = desired.status;
  if (desired.stage !== undefined) updates.suspension_stage = desired.stage;
  if (desired.walled_garden !== undefined) updates.walled_garden = desired.walled_garden;
  if (desired.reason !== undefined) updates.suspension_reason = desired.reason;
  const setParts: string[] = []; const params: any[] = [subId];
  for (const [k,v] of Object.entries(updates)) { params.push(v); setParts.push(`${k}=$${params.length}`); }
  if (setParts.length) await pool.query(`UPDATE subscribers SET ${setParts.join(',')}, updated_at=now() WHERE id=$1`, params);
  const cur = (await pool.query('SELECT s.*, bp.profile_name FROM subscribers s LEFT JOIN bandwidth_packages bp ON bp.name=s.package_name WHERE s.id=$1', [subId])).rows[0];

  const router = cur.router_id ? (await pool.query('SELECT * FROM network_routers WHERE id=$1', [cur.router_id])).rows[0] : null;
  const mode = String(cur.provisioning_mode || 'RADIUS').toUpperCase();
  const results: AnyObj = { subscriber_id: subId, mode };

  // effective status/profile for isolation/walled garden
  const effective = { ...cur };
  if (desired.profileOverride) effective.profile_name = desired.profileOverride;

  if (mode === 'ROUTER' && router && (String(router.integration_mode||'').toUpperCase()==='API' || String(router.integration_mode||'').toUpperCase()==='REST')) {
    // ensure secret reflects status/profile; if isolated/walled garden we still keep secret but can disable or set restricted profile
    if (desired.stage === SUSPENSION_STAGES.ISOLATED || desired.stage === SUSPENSION_STAGES.SUSPENDED) {
      effective.status = 'SUSPENDED';
    }
    try { results.router = await mikrotikSyncPppSecret(router, effective); } catch (e:any) { results.router = { ok:false, error: e.message }; }
  }

  // RADIUS sync (covers RADIUS pool subscribers and also useful for AAA consistency)
  if (cur.username) {
    try { await syncSubscriberToRadiusDb(effective); await pool.query(`INSERT INTO radius_users(subscriber_id,username,password,profile,framed_ip_address,status,last_synced_at,last_error)
      VALUES($1,$2,$3,$4,$5,$6,now(),NULL)
      ON CONFLICT (username) DO UPDATE SET subscriber_id=$1,password=COALESCE($3,radius_users.password),profile=$4,framed_ip_address=$5,status=$6,last_synced_at=now(),last_error=NULL,updated_at=now()`,
      [cur.id, cur.username, cur.password || null, effective.profile_name || effective.package_name || 'default', cur.ip_address || null, (effective.status==='SUSPENDED'||effective.status==='EXPIRED'||effective.status==='TERMINATED') ? 'DISABLED' : 'SYNCED']); results.radius_sync = { ok:true }; } catch (e:any) { results.radius_sync = { ok:false, error: e.message }; }
  }

  // CoA/PoD for immediate effect
  const nas = await resolveNasForSubscriber(cur);
  if (desired.sendCoa !== false && cur.username && nas && nas.radius_secret && nas.host) {
    try {
      const action = desired.coaAction || (desired.status === 'SUSPENDED' || desired.stage === SUSPENSION_STAGES.ISOLATED ? 'DISCONNECT' : 'COA');
      const attrs: AnyObj = {};
      if (desired.coaRateLimit) attrs['Mikrotik-Rate-Limit'] = desired.coaRateLimit;
      const coa = await sendCoaPacket({ host: nas.host, port: Number(nas.coa_port || 3799), secret: String(nas.radius_secret), username: cur.username, action: action as any, attributes: attrs });
      if (coa.ok && action === 'DISCONNECT') await pool.query("UPDATE subscriber_sessions SET status='OFFLINE', rx_bps=0, tx_bps=0, updated_at=now() WHERE username=$1", [cur.username]);
      results.coa = { ok: coa.ok, action, code: coa.code, error: coa.error, nas: { host: nas.host, port: Number(nas.coa_port || 3799) } };
    } catch (e:any) { results.coa = { ok:false, error: e.message }; }
  } else {
    results.coa = { ok:false, skipped:true, reason: 'no NAS/secret/username or sendCoa disabled' };
  }

  return { ok: true, results, subscriber: (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subId])).rows[0] };
}

export async function evaluateDuePolicies() {
  const policy = await getDefaultPolicy();
  const now = new Date();
  const today = ymd(now);
  const warnBefore = Number(policy.warning_days || 3);
  const graceDays = Number(policy.grace_days || 7);
  const subs = (await pool.query(`SELECT s.*, (SELECT MIN(i.due_date)::date FROM invoices i WHERE i.subscriber_id=s.id AND i.status IN ('UNPAID','PARTIAL','OVERDUE')) as earliest_due
    FROM subscribers s WHERE s.auto_suspend_enabled=true AND s.status <> 'TERMINATED'`)).rows;
  const actions: any[] = [];
  for (const s of subs) {
    await recalcSubscriberDue(s.id);
    const due = toDate(s.earliest_due || s.due_date || s.expiry_date);
    const currentDue = Number(s.current_due || 0);
    if (!due || !(currentDue > 0)) {
      // no dues: if previously warned/grace/walled but not manually suspended, clear stage
      if (['WARNING','GRACE','WALLED_GARDEN'].includes(String(s.suspension_stage)) && s.status !== 'SUSPENDED') {
        await pool.query(`UPDATE subscribers SET suspension_stage='NONE', grace_until=NULL, walled_garden=false, suspension_reason=NULL, updated_at=now() WHERE id=$1`, [s.id]);
        actions.push({ subscriber_id: s.id, action: 'CLEARED', stage: 'NONE' });
      }
      continue;
    }
    const daysOverdue = diffDays(new Date(today), due); // positive if past due
    const daysToDue = diffDays(due, new Date(today));
    let targetStage = String(s.suspension_stage || 'NONE');
    let targetStatus = s.status;
    let walled = !!s.walled_garden;
    let graceUntil: Date | null = toDate(s.grace_until);
    let reason: string | null = s.suspension_reason || null;

    if (daysToDue <= warnBefore && daysToDue >= 0) {
      if (!['GRACE','ISOLATED','SUSPENDED'].includes(targetStage)) { targetStage = SUSPENSION_STAGES.WARNING; reason = `Invoice due in ${daysToDue} day(s)`; }
    }
    if (daysOverdue > 0) {
      // overdue: grace -> walled garden/isolation -> suspended
      if (!graceUntil) graceUntil = addDays(due, graceDays);
      if (daysOverdue <= graceDays) {
        if (!['ISOLATED','SUSPENDED'].includes(targetStage)) { targetStage = SUSPENSION_STAGES.GRACE; walled = !!policy.enable_walled_garden; reason = `Overdue: grace period until ${ymd(graceUntil)}`; }
      } else {
        // beyond grace
        if (policy.auto_suspend) {
          if (policy.isolate_on_suspend) { targetStage = SUSPENSION_STAGES.ISOLATED; targetStatus = 'SUSPENDED'; walled = !!policy.enable_walled_garden; reason = 'Overdue beyond grace: router isolated/suspended'; }
          else { targetStage = SUSPENSION_STAGES.SUSPENDED; targetStatus = 'SUSPENDED'; reason = 'Overdue beyond grace: suspended'; }
        }
      }
    }

    const stageChanged = targetStage !== String(s.suspension_stage || 'NONE');
    const statusChanged = targetStatus !== s.status;
    const walledChanged = walled !== !!s.walled_garden;
    if (stageChanged || statusChanged || walledChanged) {
      await pool.query(`UPDATE subscribers SET suspension_stage=$2, status=$3, walled_garden=$4, grace_until=$5, suspension_reason=$6, updated_at=now() WHERE id=$1`,
        [s.id, targetStage, targetStatus, walled, graceUntil ? graceUntil.toISOString() : null, reason]);
      await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
        [s.id, statusChanged ? 'STATUS_CHANGE' : 'STAGE_CHANGE', targetStage, reason, JSON.stringify({ daysOverdue, daysToDue, currentDue, due: ymd(due), walled }), 'policy_engine']);

      // apply network enforcement only when isolating/suspending or reactivating/clearing to restricted states as needed
      if (targetStage === SUSPENSION_STAGES.ISOLATED || targetStage === SUSPENSION_STAGES.SUSPENDED || (walled && stageChanged)) {
        try {
          const profileOverride = walled ? (policy.walled_garden_profile || undefined) : undefined;
          await applyProvisioningState(s.id, { status: targetStatus, stage: targetStage, walled_garden: walled, reason: reason || undefined, sendCoa: true, coaAction: 'DISCONNECT', profileOverride });
        } catch (e:any) {
          await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'ENFORCEMENT_ERROR',$2,$3,$4::jsonb,'policy_engine')`, [s.id, targetStage, e.message, JSON.stringify({})]);
        }
      }
      actions.push({ subscriber_id: s.id, username: s.username, targetStage, targetStatus, walled_garden: walled, daysOverdue, daysToDue, reason });
    }
  }
  return { ok: true, evaluated: subs.length, actions, policy: { grace_days: graceDays, warning_days: warnBefore, auto_suspend: !!policy.auto_suspend, isolate_on_suspend: !!policy.isolate_on_suspend, enable_walled_garden: !!policy.enable_walled_garden } };
}

export async function reactivateSubscriber(subscriberId: string, reason = 'Payment confirmed') {
  const start = Date.now();
  // activate and clear suspension/walled garden
  await pool.query(`UPDATE subscribers SET status='ACTIVE', suspension_stage='NONE', walled_garden=false, grace_until=NULL, suspension_reason=NULL, updated_at=now() WHERE id=$1`, [subscriberId]);
  const applied = await applyProvisioningState(subscriberId, { status: 'ACTIVE', stage: SUSPENSION_STAGES.NONE, walled_garden: false, reason, sendCoa: true, coaAction: 'COA' });
  await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'REACTIVATED','NONE',$2,$3::jsonb,'payment')`, [subscriberId, reason, JSON.stringify({ duration_ms: Date.now()-start, target_ms: 2000 })]);
  return { ok: true, duration_ms: Date.now()-start, target_ms: 2000, applied };
}

export async function recordPaymentAndReactivate(input: { gateway: string; amount: number; invoice_id?: string; subscriber_id?: string; trx_id?: string; method?: string; payer_number?: string; raw?: any; payment_ref?: string; currency?: string; status?: string }) {
  const amount = Number(input.amount || 0);
  if (!(amount > 0)) throw new Error('Invalid payment amount');
  let invoice = null as any;
  if (input.invoice_id) {
    const ir = await pool.query('SELECT * FROM invoices WHERE id=$1', [input.invoice_id]);
    invoice = ir.rows[0] || null;
  }
  let subscriberId = input.subscriber_id || invoice?.subscriber_id || null;
  if (!subscriberId && input.payment_ref) {
    const pr = await pool.query('SELECT * FROM payments WHERE payment_ref=$1', [input.payment_ref]);
    if (pr.rows[0]?.subscriber_id) subscriberId = pr.rows[0].subscriber_id;
    if (!invoice && pr.rows[0]?.invoice_id) {
      const ir = await pool.query('SELECT * FROM invoices WHERE id=$1', [pr.rows[0].invoice_id]);
      invoice = ir.rows[0] || null; subscriberId = subscriberId || invoice?.subscriber_id;
    }
  }
  const payment_ref = input.payment_ref || `PAY-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
  const status = input.status || 'COMPLETED';
  const payRes = await pool.query(`INSERT INTO payments (payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, trx_id, payer_number, gateway_response, verified_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, CASE WHEN $8='COMPLETED' THEN now() ELSE NULL END)
    ON CONFLICT (payment_ref) DO UPDATE SET status=EXCLUDED.status, trx_id=COALESCE(EXCLUDED.trx_id,payments.trx_id), gateway_response=COALESCE(EXCLUDED.gateway_response,payments.gateway_response), verified_at=COALESCE(EXCLUDED.verified_at,payments.verified_at), updated_at=now()
    RETURNING *`,
    [payment_ref, invoice?.id || input.invoice_id || null, subscriberId, input.gateway, input.method || null, amount, input.currency || 'BDT', status, input.trx_id || null, input.payer_number || null, JSON.stringify(input.raw || {})]
  );
  const payment = payRes.rows[0];

  let updatedInvoice = invoice;
  if (invoice && status === 'COMPLETED') {
    const paid = +(Number(invoice.paid_amount || 0) + amount).toFixed(2);
    const total = Number(invoice.total_amount || invoice.amount || 0);
    const dueAmt = +Math.max(0, total - paid).toFixed(2);
    const invStatus = dueAmt <= 0 ? 'PAID' : (paid > 0 ? 'PARTIAL' : invoice.status);
    updatedInvoice = (await pool.query(`UPDATE invoices SET paid_amount=$2, due_amount=$3, status=$4, paid_at=CASE WHEN $4='PAID' THEN now() ELSE paid_at END, updated_at=now() WHERE id=$1 RETURNING *`,
      [invoice.id, paid, dueAmt, invStatus])).rows[0];
  }

  let reactivation: any = null;
  if (subscriberId) {
    if (invoice) await recalcSubscriberDue(subscriberId);
    else await pool.query(`UPDATE subscribers SET balance = GREATEST(COALESCE(balance,0)-$2,0), updated_at=now() WHERE id=$1`, [subscriberId, amount]).catch(()=>{});
    await pool.query(`INSERT INTO wallet_transactions(subscriber_id, type, amount, reference_id, reference_type, description, metadata)
      VALUES($1,'CREDIT',$2,$3,$4,$5,$6::jsonb)`,
      [subscriberId, amount, payment.payment_ref, 'PAYMENT', `Payment via ${input.gateway}`, JSON.stringify({ invoice_id: invoice?.id || null, trx_id: input.trx_id || null })]).catch(()=>{});
    // auto-reactivate if no outstanding dues
    const due = await recalcSubscriberDue(subscriberId);
    const sub = (await pool.query('SELECT status, suspension_stage, walled_garden FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
    if (due <= 0 && sub && (sub.status === 'SUSPENDED' || sub.status === 'EXPIRED' || sub.suspension_stage !== 'NONE' || sub.walled_garden)) {
      reactivation = await reactivateSubscriber(subscriberId, `Payment confirmed (${input.gateway}${input.trx_id ? ' '+input.trx_id : ''})`);
    }
  }

  return { ok: true, payment, invoice: updatedInvoice, subscriber_id: subscriberId, reactivation };
}

export async function getBillingMetrics() {
  const [counts, invAgg, payAgg] = await Promise.all([
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE status='ACTIVE')::int as active,
      COUNT(*) FILTER (WHERE status='SUSPENDED' OR suspension_stage IN ('ISOLATED','SUSPENDED'))::int as suspended,
      COUNT(*) FILTER (WHERE status='EXPIRED')::int as expired
      FROM subscribers`),
    pool.query(`SELECT COALESCE(SUM(total_amount),0)::numeric(12,2) as monthly_generated, COALESCE(SUM(due_amount),0)::numeric(12,2) as total_due FROM invoices WHERE to_char(COALESCE(issue_date, CURRENT_DATE),'YYYY-MM') = to_char(CURRENT_DATE,'YYYY-MM')`),
    pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE created_at::date = CURRENT_DATE),0)::numeric(12,2) as today, COALESCE(SUM(amount) FILTER (WHERE to_char(created_at,'YYYY-MM') = to_char(CURRENT_DATE,'YYYY-MM')),0)::numeric(12,2) as month FROM payments WHERE status='COMPLETED'`)
  ]);
  return {
    suspendedDue: Number(counts.rows[0]?.suspended || 0),
    expiredThisMonth: Number(counts.rows[0]?.expired || 0),
    monthlyBillGenerated: Number(invAgg.rows[0]?.monthly_generated || 0),
    totalDueOutstanding: Number((await pool.query("SELECT COALESCE(SUM(due_amount),0)::numeric(12,2) as d FROM invoices WHERE status IN ('UNPAID','PARTIAL','OVERDUE')")).rows[0]?.d || 0),
    todayCollections: Number(payAgg.rows[0]?.today || 0),
    thisMonthCollections: Number(payAgg.rows[0]?.month || 0),
  };
}

export async function listInvoices(query: any) {
  const where: string[] = []; const params: any[] = [];
  if (query.subscriber_id) { params.push(query.subscriber_id); where.push(`i.subscriber_id=$${params.length}`); }
  if (query.status) { params.push(query.status); where.push(`i.status=$${params.length}`); }
  if (query.bill_month) { params.push(query.bill_month); where.push(`i.bill_month=$${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(`SELECT i.*, s.status as subscriber_status FROM invoices i LEFT JOIN subscribers s ON s.id=i.subscriber_id ${whereSql} ORDER BY i.created_at DESC LIMIT 200`, params);
  return r.rows;
}

export async function getInvoiceWithItems(id: string) {
  const ir = await pool.query('SELECT * FROM invoices WHERE id=$1', [id]);
  if (!ir.rows[0]) return null;
  const items = (await pool.query('SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id', [id])).rows;
  return { ...ir.rows[0], items };
}

export async function ensureOverdueInvoiceStatuses() {
  await pool.query(`UPDATE invoices SET status='OVERDUE', updated_at=now() WHERE status IN ('UNPAID','PARTIAL') AND due_date < CURRENT_DATE AND due_amount > 0`);
}

export async function startBillingScheduler() {
  // in-process scheduler (idempotent-ish operations). Runs on boot and periodically.
  const run = async () => {
    try { await ensureOverdueInvoiceStatuses(); await evaluateDuePolicies(); } catch (e:any) { console.error('[BillingScheduler] error', e.message); }
  };
  setTimeout(run, 5000);
  setInterval(run, 60 * 1000); // every minute for timely grace/suspension evaluation
}