import { pool } from '../db';
import { mikrotikSyncPppSecret, mikrotikRemovePppSecret, mikrotikEnsureWalledGarden, mikrotikEnsureFupProfile, mikrotikDisconnectPppUser } from './mikrotik';
import { syncSubscriberToRadiusDb, sendCoaPacket } from './radius';
import { runMessagingSchedulerSweep, trySendTemplateToSubscriber } from './messaging';
import { auditLog } from './audit';

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

export async function applyProvisioningState(subId: string, desired: { status?: string; stage?: string; walled_garden?: boolean; reason?: string; sendCoa?: boolean; coaAction?: 'DISCONNECT'|'COA'; coaRateLimit?: string; profileOverride?: string; addressList?: string }) {
  const sub0 = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subId])).rows[0];
  if (!sub0) throw new Error('Subscriber not found');
  const updates: any = {};
  if (desired.status) updates.status = desired.status;
  if (desired.stage !== undefined) updates.suspension_stage = desired.stage;
  if (desired.walled_garden !== undefined) updates.walled_garden = desired.walled_garden;
  if (desired.reason !== undefined) updates.suspension_reason = desired.reason;
  const setParts: string[] = []; const params: any[] = [subId];
  for (const [k,v] of Object.entries(updates)) { params.push(v); setParts.push(`${k}=$${params.length}`); }
  if (setParts.length) await pool.query(`UPDATE subscribers SET ${setParts.join(',')}, updated_at=now() WHERE id=$1`, params);

  const cur = (await pool.query(`SELECT s.*, bp.profile_name as package_profile_name, nr.id as router_row_id, nr.name as router_name, nr.host as router_host, nr.integration_mode as router_integration_mode,
      nr.api_port, nr.rest_port, nr.username as router_username, nr.password as router_password, nr.use_ssl, nr.radius_secret, nr.nas_identifier, nr.coa_port, nr.is_enabled as router_enabled
    FROM subscribers s
    LEFT JOIN bandwidth_packages bp ON bp.name=s.package_name
    LEFT JOIN network_routers nr ON nr.id=s.router_id
    WHERE s.id=$1`, [subId])).rows[0];

  const router = cur.router_row_id ? {
    id: cur.router_row_id, name: cur.router_name, host: cur.router_host, integration_mode: cur.router_integration_mode,
    api_port: cur.api_port, rest_port: cur.rest_port, username: cur.router_username, password: cur.router_password, use_ssl: cur.use_ssl,
    radius_secret: cur.radius_secret, nas_identifier: cur.nas_identifier, coa_port: cur.coa_port, is_enabled: cur.router_enabled
  } : null;
  const mode = String(cur.provisioning_mode || 'RADIUS').toUpperCase();
  const results: AnyObj = { subscriber_id: subId, mode };

  const effective = { ...cur, profile_name: cur.package_profile_name || cur.package_name || 'default' };
  const walled = !!(desired.walled_garden ?? effective.walled_garden) && desired.status !== 'ACTIVE';
  const restrictedProfile = desired.profileOverride || (walled ? 'izn-walled-garden' : null);
  if (restrictedProfile) effective.profile_name = restrictedProfile;
  if (desired.status === 'SUSPENDED' || desired.stage === SUSPENSION_STAGES.ISOLATED || desired.stage === SUSPENSION_STAGES.SUSPENDED) {
    if (!walled) effective.status = 'SUSPENDED';
  }

  // Direct router provisioning (PPPoE secrets/profiles)
  if (mode === 'ROUTER' && router && ['API','REST'].includes(String(router.integration_mode||'').toUpperCase())) {
    try {
      if (walled) {
        results.walled_garden_profile = await mikrotikEnsureWalledGarden(router, { profileName: restrictedProfile || 'izn-walled-garden', rateLimit: desired.coaRateLimit || '64k/64k' });
      }
      results.router = await mikrotikSyncPppSecret(router, effective);
    } catch (e:any) { results.router = { ok:false, error: e.message }; }
  }

  // RADIUS AAA sync (radcheck/radreply/radusergroup) for RADIUS and hybrid consistency
  if (cur.username) {
    try {
      const syncRes = await syncSubscriberToRadiusDb(effective, { walledGarden: walled, restrictedRateLimit: desired.coaRateLimit || '64k/64k', addressList: desired.addressList || 'izn-walled-garden' });
      const ruStatus = (effective.status==='SUSPENDED'||effective.status==='EXPIRED'||effective.status==='TERMINATED') && !walled ? 'DISABLED' : (walled ? 'WALLED_GARDEN' : 'SYNCED');
      await pool.query(`INSERT INTO radius_users(subscriber_id,username,password,profile,framed_ip_address,status,last_synced_at,last_error)
        VALUES($1,$2,$3,$4,$5,$6,now(),NULL)
        ON CONFLICT (username) DO UPDATE SET subscriber_id=$1,password=COALESCE($3,radius_users.password),profile=$4,framed_ip_address=$5,status=$6,last_synced_at=now(),last_error=NULL,updated_at=now()`,
        [cur.id, cur.username, cur.password || null, effective.profile_name || effective.package_name || 'default', cur.ip_address || null, ruStatus]);
      results.radius_sync = { ok:true, ...syncRes };
    } catch (e:any) { results.radius_sync = { ok:false, error: e.message }; }
  }

  // CoA/PoD for immediate enforcement/reactivation
  const nas = await resolveNasForSubscriber(cur);
  if (desired.sendCoa !== false && cur.username && nas && nas.radius_secret && nas.host) {
    try {
      const suspendedHard = (desired.status === 'SUSPENDED' || desired.stage === SUSPENSION_STAGES.ISOLATED || desired.stage === SUSPENSION_STAGES.SUSPENDED) && !walled;
      let action: 'DISCONNECT'|'COA' = desired.coaAction || (suspendedHard ? 'DISCONNECT' : 'COA');
      const attrs: AnyObj = {};
      if (walled) {
        attrs['Mikrotik-Address-List'] = desired.addressList || 'izn-walled-garden';
        attrs['Mikrotik-Rate-Limit'] = desired.coaRateLimit || '64k/64k';
        if (restrictedProfile) attrs['Mikrotik-Group'] = restrictedProfile;
        action = 'COA';
      } else if (desired.coaRateLimit) {
        attrs['Mikrotik-Rate-Limit'] = desired.coaRateLimit;
      }
      const coa = await sendCoaPacket({ host: nas.host, port: Number(nas.coa_port || 3799), secret: String(nas.radius_secret), username: cur.username, action, attributes: attrs });
      // if CoA update failed on NAS that doesn't support dynamic attr change well, fallback to disconnect so reconnect applies new RADIUS/profile state
      let finalCoa = coa;
      if (!coa.ok && action === 'COA') {
        const dc = await sendCoaPacket({ host: nas.host, port: Number(nas.coa_port || 3799), secret: String(nas.radius_secret), username: cur.username, action: 'DISCONNECT' });
        finalCoa = { ...dc, fallback: 'disconnect', original: coa } as any;
      }
      if (finalCoa.ok && (action === 'DISCONNECT' || finalCoa.fallback === 'disconnect')) {
        await pool.query("UPDATE subscriber_sessions SET status='OFFLINE', rx_bps=0, tx_bps=0, updated_at=now() WHERE username=$1", [cur.username]);
      }
      results.coa = { ok: finalCoa.ok, action, code: finalCoa.code, error: finalCoa.error, fallback: finalCoa.fallback, nas: { host: nas.host, port: Number(nas.coa_port || 3799) } };
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
        if (!['ISOLATED','SUSPENDED','WALLED_GARDEN'].includes(targetStage)) {
          targetStage = policy.enable_walled_garden ? SUSPENSION_STAGES.WALLED_GARDEN : SUSPENSION_STAGES.GRACE;
          walled = !!policy.enable_walled_garden;
          targetStatus = policy.enable_walled_garden ? 'ACTIVE' : s.status; // keep auth but restrict when walled garden
          reason = `Overdue: grace period until ${ymd(graceUntil)}${walled ? ' (walled garden)' : ''}`;
        }
      } else {
        // beyond grace
        if (policy.auto_suspend) {
          if (policy.enable_walled_garden) {
            targetStage = SUSPENSION_STAGES.WALLED_GARDEN;
            targetStatus = 'ACTIVE'; // restricted access (walled garden) rather than hard reject
            walled = true;
            reason = 'Overdue beyond grace: walled garden isolation active';
          } else if (policy.isolate_on_suspend) {
            targetStage = SUSPENSION_STAGES.ISOLATED;
            targetStatus = 'SUSPENDED';
            walled = false;
            reason = 'Overdue beyond grace: router isolated/suspended';
          } else {
            targetStage = SUSPENSION_STAGES.SUSPENDED;
            targetStatus = 'SUSPENDED';
            walled = false;
            reason = 'Overdue beyond grace: suspended';
          }
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

      // apply network enforcement (including walled-garden restriction profile/address-list/CoA)
      if (stageChanged || statusChanged || walledChanged) {
        try {
          const profileOverride = walled ? (policy.walled_garden_profile || 'izn-walled-garden') : undefined;
          const coaAction: 'DISCONNECT'|'COA' = (targetStatus === 'SUSPENDED' && !walled) ? 'DISCONNECT' : 'COA';
          await applyProvisioningState(s.id, { status: targetStatus, stage: targetStage, walled_garden: walled, reason: reason || undefined, sendCoa: true, coaAction, profileOverride, coaRateLimit: walled ? '64k/64k' : undefined, addressList: walled ? 'izn-walled-garden' : undefined });
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

export async function recordPaymentAndReactivate(input: { gateway: string; amount: number; invoice_id?: string; subscriber_id?: string; trx_id?: string; method?: string; payer_number?: string; raw?: any; payment_ref?: string; currency?: string; status?: string; dedupe_key?: string }) {
  const amount = Number(input.amount || 0);
  if (!(amount > 0)) throw new Error('Invalid payment amount');
  const status = String(input.status || 'COMPLETED').toUpperCase();
  const trx = input.trx_id ? String(input.trx_id).trim() : null;

  // idempotency: if this transaction/payment already completed, return existing result without double-applying
  if (trx) {
    const existingByTrx = await pool.query(`SELECT * FROM payments WHERE gateway=$1 AND trx_id=$2 AND status='COMPLETED' ORDER BY verified_at DESC NULLS LAST, created_at DESC LIMIT 1`, [input.gateway, trx]);
    if (existingByTrx.rows[0]) {
      const p = existingByTrx.rows[0];
      const inv = p.invoice_id ? (await pool.query('SELECT * FROM invoices WHERE id=$1', [p.invoice_id])).rows[0] : null;
      return { ok: true, duplicate: true, payment: p, invoice: inv, subscriber_id: p.subscriber_id, reactivation: null };
    }
  }
  if (input.payment_ref) {
    const existingByRef = await pool.query('SELECT * FROM payments WHERE payment_ref=$1', [input.payment_ref]);
    if (existingByRef.rows[0] && String(existingByRef.rows[0].status).toUpperCase() === 'COMPLETED' && status === 'COMPLETED') {
      const p = existingByRef.rows[0];
      const inv = p.invoice_id ? (await pool.query('SELECT * FROM invoices WHERE id=$1', [p.invoice_id])).rows[0] : null;
      return { ok: true, duplicate: true, payment: p, invoice: inv, subscriber_id: p.subscriber_id, reactivation: null };
    }
  }

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
  if (!subscriberId && trx) {
    // try to match by payer/trx hints later via SMS ingestion context; for now leave null
  }

  const payment_ref = input.payment_ref || `PAY-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
  const payRes = await pool.query(`INSERT INTO payments (payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, trx_id, payer_number, gateway_response, verified_at, idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, CASE WHEN $8='COMPLETED' THEN now() ELSE NULL END, $12)
    ON CONFLICT (payment_ref) DO UPDATE SET
      status=CASE WHEN payments.status='COMPLETED' THEN payments.status ELSE EXCLUDED.status END,
      trx_id=COALESCE(EXCLUDED.trx_id,payments.trx_id),
      payer_number=COALESCE(EXCLUDED.payer_number,payments.payer_number),
      gateway_response=COALESCE(EXCLUDED.gateway_response,payments.gateway_response),
      verified_at=COALESCE(payments.verified_at, EXCLUDED.verified_at),
      updated_at=now()
    RETURNING *`,
    [payment_ref, invoice?.id || input.invoice_id || null, subscriberId, input.gateway, input.method || null, amount, input.currency || 'BDT', status, trx, input.payer_number || null, JSON.stringify(input.raw || {}), input.dedupe_key || null]
  );
  const payment = payRes.rows[0];

  let updatedInvoice = invoice;
  const applyToInvoice = async (inv: any, applyAmount: number) => {
    const total = Number(inv.total_amount || inv.amount || 0);
    const paidBefore = Number(inv.paid_amount || 0);
    const paid = +Math.min(total, paidBefore + applyAmount).toFixed(2);
    const dueAmt = +Math.max(0, total - paid).toFixed(2);
    const invStatus = dueAmt <= 0 ? 'PAID' : (paid > 0 ? 'PARTIAL' : inv.status);
    return (await pool.query(`UPDATE invoices SET paid_amount=$2, due_amount=$3, status=$4, paid_at=CASE WHEN $4='PAID' THEN COALESCE(paid_at, now()) ELSE paid_at END, updated_at=now() WHERE id=$1 RETURNING *`,
      [inv.id, paid, dueAmt, invStatus])).rows[0];
  };

  if (invoice && status === 'COMPLETED') {
    updatedInvoice = await applyToInvoice(invoice, amount);
  } else if (!invoice && subscriberId && status === 'COMPLETED') {
    // Advance/unallocated payment: apply to open invoices (oldest first)
    let remaining = amount;
    const openInvs = (await pool.query(`SELECT * FROM invoices WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE') AND GREATEST(due_amount,0) > 0 ORDER BY COALESCE(due_date, issue_date, created_at) ASC, created_at ASC`, [subscriberId])).rows;
    for (const inv of openInvs) {
      if (remaining <= 0) break;
      const dueAmt = Number(inv.due_amount || 0);
      const take = Math.min(remaining, dueAmt);
      const upd = await applyToInvoice(inv, take);
      if (!updatedInvoice) updatedInvoice = upd;
      remaining = +(remaining - take).toFixed(2);
    }
    // Any remaining amount is kept as overpayment (recorded as payment; invoices fully settled). No negative-due/credit ledger yet.
  }

  let reactivation: any = null;
  if (subscriberId) {
    await recalcSubscriberDue(subscriberId).catch(()=>{});
    if (status === 'COMPLETED') {
      await pool.query(`INSERT INTO wallet_transactions(subscriber_id, type, amount, reference_id, reference_type, description, metadata)
        VALUES($1,'CREDIT',$2,$3,$4,$5,$6::jsonb)`,
        [subscriberId, amount, payment.payment_ref, 'PAYMENT', `${invoice ? 'Invoice payment' : 'Advance payment'} via ${input.gateway}`, JSON.stringify({ invoice_id: invoice?.id || updatedInvoice?.id || null, trx_id: trx, advance: !invoice })]).catch(()=>{});
    }
    const due = await recalcSubscriberDue(subscriberId);
    const sub = (await pool.query('SELECT status, suspension_stage, walled_garden FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
    if (status === 'COMPLETED' && due <= 0 && sub && (sub.status === 'SUSPENDED' || sub.status === 'EXPIRED' || String(sub.suspension_stage || 'NONE') !== 'NONE' || sub.walled_garden)) {
      reactivation = await reactivateSubscriber(subscriberId, `Payment confirmed (${input.gateway}${trx ? ' '+trx : ''})`);
    }
  }

  // Best-effort finance posting & audit for completed payments
  if (status === 'COMPLETED') {
    try {
      const ref = payment.payment_ref || payment_ref;
      const exists = await pool.query(`SELECT 1 FROM finance_transactions WHERE reference_id=$1 LIMIT 1`, [ref]).catch(()=>({rows:[]}));
      if (!exists.rows?.length) {
        const method = String(input.gateway||input.method||'CASH').toUpperCase();
        const accCode = method.includes('BANK')?'1010':(method.match(/BKASH|NAGAD|ROCKET|MFS/)?'1020':'1000');
        const cashAccR = await pool.query('SELECT id FROM finance_accounts WHERE code=$1 LIMIT 1',[accCode]).catch(()=>({rows:[]}));
        const revAccR = await pool.query("SELECT id FROM finance_accounts WHERE code='4000' LIMIT 1").catch(()=>({rows:[]}));
        await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,method,amount,currency,reference_type,reference_id,subscriber_id,description,created_by)
          VALUES(COALESCE($1::date,CURRENT_DATE),'COLLECTION',$2,$3,$4,'PAYMENT',$5,$6,$7,'system')`,
          [payment.verified_at||payment.created_at, input.gateway||input.method||'CASH', amount, input.currency||'BDT', ref, subscriberId, `Payment ${ref} (${input.gateway||''}${trx?` ${trx}`:''})`]).catch(()=>{});
        const cashAcc=cashAccR.rows[0]?.id, revAcc=revAccR.rows[0]?.id;
        if(cashAcc && revAcc){
          const je=await pool.query(`INSERT INTO finance_journal_entries(entry_no,entry_date,description,source_type,source_id,posted,created_by) VALUES($1,COALESCE($2::date,CURRENT_DATE),$3,'PAYMENT',$4,true,'system') RETURNING id`,
            [`JE-PAY-${Date.now()}-${Math.random().toString(36).slice(2,5).toUpperCase()}`, payment.verified_at||payment.created_at, `Payment ${ref}`, String(ref)]).catch(()=>({rows:[]}));
          const jid=je.rows[0]?.id;
          if(jid){ await pool.query(`INSERT INTO finance_journal_lines(entry_id,account_id,debit,credit,memo) VALUES($1,$2,$3,0,'cash/mfs'),($1,$4,0,$3,'revenue')`, [jid,cashAcc,amount,revAcc]).catch(()=>{}); }
        }
      }
      await auditLog({ action:'PAYMENT_COMPLETED', entity_type:'payment', entity_id: payment.id||ref, details:{ gateway: input.gateway, amount, trx_id: trx, subscriber_id: subscriberId, invoice_id: updatedInvoice?.id || invoice?.id || null, duplicate:false } }).catch(()=>{});
    } catch {}
  }

  // Best-effort receipt notification
  try {
    if (status === 'COMPLETED' && subscriberId) {
      const sub = (await pool.query('SELECT full_name, phone FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
      if (sub?.phone) {
        await trySendTemplateToSubscriber(subscriberId, 'payment_received_sms', { name: sub.full_name, amount, trx_id: trx, invoice_number: updatedInvoice?.invoice_number, paid: updatedInvoice?.paid_amount, due: updatedInvoice?.due_amount }, { channel_type: 'SMS' }).catch(()=>{});
      }
    }
  } catch {}
  return { ok: true, duplicate: false, payment, invoice: updatedInvoice, subscriber_id: subscriberId, reactivation };
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

export async function tryAcquireSchedulerLock(name: string, ttlMs = 55_000, holder = `pid:${process.pid}`) {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  const r = await pool.query(`
    INSERT INTO billing_scheduler_locks(name, locked_until, holder, updated_at)
    VALUES($1,$2,$3,now())
    ON CONFLICT (name) DO UPDATE
      SET locked_until=EXCLUDED.locked_until, holder=EXCLUDED.holder, updated_at=now()
      WHERE billing_scheduler_locks.locked_until <= now()
    RETURNING name
  `, [name, until.toISOString(), holder]).catch(()=>({ rows: [] as any[] }));
  return !!r.rows?.[0];
}

function fupRateString(mbps: number) {
  const m = Math.max(1, Math.round(Number(mbps) || 1));
  return `${m}M/${m}M`;
}



export async function evaluateFupForSubscriber(subscriberId: string, opts: { forceAction?: 'APPLY'|'CLEAR'; reason?: string | null } = {}) {
  const rows = (await pool.query(`
    SELECT s.id, s.username, s.password, s.status, s.suspension_stage, s.walled_garden, s.ip_address, s.package_name, s.router_id, s.provisioning_mode, s.fup_exceeded, s.fup_exempt,
           bp.profile_name, bp.data_cap_gb, bp.fup_speed_mbps,
           COALESCE((SELECT SUM(COALESCE(acctinputoctets,0)+COALESCE(acctoutputoctets,0))::bigint FROM radacct r
             WHERE (r.username=s.username OR r.username IN (SELECT username FROM subscribers ss WHERE ss.id=s.id AND ss.username IS NOT NULL))
               AND r.acctstarttime >= date_trunc('month', now())),0) as used_bytes
    FROM subscribers s
    LEFT JOIN bandwidth_packages bp ON bp.name=s.package_name
    WHERE s.id=$1
  `, [subscriberId])).rows;
  const sub = rows[0];
  if (!sub) throw new Error('Subscriber not found');
  const capGb = sub.data_cap_gb != null ? Number(sub.data_cap_gb) : null;
  const fupMbps = sub.fup_speed_mbps != null ? Number(sub.fup_speed_mbps) : null;
  const used = Number(sub.used_bytes || 0);
  const capBytes = capGb != null ? capGb * 1024 * 1024 * 1024 : null;
  const over = capBytes != null && capBytes > 0 && fupMbps != null && fupMbps > 0 && used > capBytes;
  const billingRestricted = String(sub.status).toUpperCase() !== 'ACTIVE' || ['WALLED_GARDEN','ISOLATED','SUSPENDED'].includes(String(sub.suspension_stage||'').toUpperCase()) || !!sub.walled_garden;
  const exempt = !!sub.fup_exempt;
  let shouldFup = over && !billingRestricted && !exempt;
  if (opts.forceAction === 'CLEAR') shouldFup = false;
  if (opts.forceAction === 'APPLY') shouldFup = !!(fupMbps && !billingRestricted);
  const was = !!sub.fup_exceeded;
  if (shouldFup === was && !opts.forceAction) return { ok: true, changed: false, fup_exceeded: was, over_cap: over };
  await pool.query('UPDATE subscribers SET fup_exceeded=$2, fup_applied_at=CASE WHEN $2 THEN now() ELSE NULL END, updated_at=now() WHERE id=$1', [sub.id, shouldFup]);
  const effective: any = { ...sub, profile_name: sub.profile_name || sub.package_name || 'default' };
  const rl = shouldFup ? fupRateString(fupMbps as number) : null;
  let radiusSyncOk = true, coaOk: any = null, routerOk: any = null;
  try { await syncSubscriberToRadiusDb(effective, { fupRateLimit: rl, fupExceeded: shouldFup }); } catch { radiusSyncOk = false; }
  try {
    const nas = await resolveNasForSubscriber(sub);
    if (nas?.radius_secret && nas?.host && sub.username) {
      const coa = await sendCoaPacket({ host: nas.host, port: Number(nas.coa_port || 3799), secret: String(nas.radius_secret), username: sub.username, action: 'COA', attributes: rl ? { 'Mikrotik-Rate-Limit': rl } : {} });
      coaOk = coa?.ok ?? null;
      if (!coa.ok) {
        const dc = await sendCoaPacket({ host: nas.host, port: Number(nas.coa_port || 3799), secret: String(nas.radius_secret), username: sub.username, action: 'DISCONNECT' }).catch(()=>null);
        coaOk = dc?.ok ?? coaOk;
      }
    }
  } catch {}
  try {
    if (String(sub.provisioning_mode||'').toUpperCase() === 'ROUTER' && sub.router_id && sub.username) {
      const rr = (await pool.query('SELECT * FROM network_routers WHERE id=$1', [sub.router_id])).rows[0];
      if (rr && ['API','REST'].includes(String(rr.integration_mode||'').toUpperCase()) && rr.is_enabled !== false) {
        if (shouldFup && fupMbps) {
          const prof = `izn-fup-${Math.max(1, Math.round(Number(fupMbps)||1))}m`;
          await mikrotikEnsureFupProfile(rr, { speedMbps: Number(fupMbps), profileName: prof }).catch(()=>{});
          routerOk = await mikrotikSyncPppSecret(rr, { ...effective, profile_name: prof, profile: prof }).catch((e:any)=>({ ok:false, error: e.message }));
        } else {
          routerOk = await mikrotikSyncPppSecret(rr, { ...effective, profile_name: sub.profile_name || sub.package_name || 'default' }).catch((e:any)=>({ ok:false, error: e.message }));
        }
        try { await mikrotikDisconnectPppUser(rr, sub.username); } catch {}
      }
    }
  } catch {}
  try {
    await pool.query(`INSERT INTO fup_enforcement_logs(subscriber_id, action, over_cap, used_bytes, cap_gb, fup_speed_mbps, details)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [sub.id, shouldFup ? 'APPLIED' : 'CLEARED', over, used, capGb, fupMbps, JSON.stringify({ previous: was, rate_limit: rl, billing_restricted: billingRestricted, exempt, radius_sync_ok: radiusSyncOk, coa_ok: coaOk, router_ok: routerOk?.ok ?? null, router_mode: String(sub.provisioning_mode||'').toUpperCase()==='ROUTER', period: 'current_month', forced: opts.forceAction || null, reason: opts.reason || null })]);
  } catch {}
  return { ok: true, changed: shouldFup !== was || !!opts.forceAction, fup_exceeded: shouldFup, over_cap: over, used_bytes: used, cap_gb: capGb, fup_speed_mbps: fupMbps, enforcement: { radius_sync_ok: radiusSyncOk, coa_ok: coaOk, router_ok: routerOk?.ok ?? null } };
}


export async function runFupEnforcementSweep() {
  // Best-effort: apply/remove RADIUS rate-limit for subscribers over monthly data cap (FUP).
  // Billing suspension/walled-garden states take precedence and are not overridden.
  const rows = (await pool.query(`
    SELECT s.id, s.username, s.password, s.status, s.suspension_stage, s.walled_garden, s.ip_address, s.package_name, s.router_id, s.provisioning_mode, s.fup_exceeded, s.fup_exempt,
           bp.profile_name, bp.data_cap_gb, bp.fup_speed_mbps,
           COALESCE((SELECT SUM(COALESCE(acctinputoctets,0)+COALESCE(acctoutputoctets,0))::bigint FROM radacct r
             WHERE (r.username=s.username OR r.username IN (SELECT username FROM subscribers ss WHERE ss.id=s.id AND ss.username IS NOT NULL))
               AND r.acctstarttime >= date_trunc('month', now())),0) as used_bytes
    FROM subscribers s
    LEFT JOIN bandwidth_packages bp ON bp.name=s.package_name
    WHERE s.username IS NOT NULL AND s.username <> '' AND s.status <> 'TERMINATED'
  `)).rows;
  let applied = 0, cleared = 0, skipped = 0, errors = 0;
  for (const sub of rows) {
    const capGb = sub.data_cap_gb != null ? Number(sub.data_cap_gb) : null;
    const fupMbps = sub.fup_speed_mbps != null ? Number(sub.fup_speed_mbps) : null;
    const used = Number(sub.used_bytes || 0);
    const capBytes = capGb != null ? capGb * 1024 * 1024 * 1024 : null;
    const over = capBytes != null && capBytes > 0 && fupMbps != null && fupMbps > 0 && used > capBytes;
    const billingRestricted = String(sub.status).toUpperCase() !== 'ACTIVE' || ['WALLED_GARDEN','ISOLATED','SUSPENDED'].includes(String(sub.suspension_stage||'').toUpperCase()) || !!sub.walled_garden;
    const exempt = !!sub.fup_exempt;
    const shouldFup = over && !billingRestricted && !exempt;
    const was = !!sub.fup_exceeded;
    if (shouldFup === was) { skipped++; continue; }
    try {
      await pool.query('UPDATE subscribers SET fup_exceeded=$2, fup_applied_at=CASE WHEN $2 THEN now() ELSE NULL END, updated_at=now() WHERE id=$1', [sub.id, shouldFup]);
      const effective: any = { ...sub, profile_name: sub.profile_name || sub.package_name || 'default' };
      const rl = shouldFup ? fupRateString(fupMbps as number) : null;
      let radiusSyncOk = true, coaOk: any = null;
      try { await syncSubscriberToRadiusDb(effective, { fupRateLimit: rl, fupExceeded: shouldFup }); } catch { radiusSyncOk = false; }
      let routerOk: any = null;
      try {
        const nas = await resolveNasForSubscriber(sub);
        if (nas?.radius_secret && nas?.host && sub.username) {
          const coa = await sendCoaPacket({ host: nas.host, port: Number(nas.coa_port || 3799), secret: String(nas.radius_secret), username: sub.username, action: 'COA', attributes: rl ? { 'Mikrotik-Rate-Limit': rl } : {} });
          coaOk = coa?.ok ?? null;
          if (!coa.ok) {
            const dc = await sendCoaPacket({ host: nas.host, port: Number(nas.coa_port || 3799), secret: String(nas.radius_secret), username: sub.username, action: 'DISCONNECT' }).catch(()=>null);
            coaOk = dc?.ok ?? coaOk;
          }
        }
      } catch {}
      // Direct router PPPoE (ROUTER mode): switch secret profile to FUP profile or restore package profile
      try {
        if (String(sub.provisioning_mode||'').toUpperCase() === 'ROUTER' && sub.router_id && sub.username) {
          const rr = (await pool.query('SELECT * FROM network_routers WHERE id=$1', [sub.router_id])).rows[0];
          if (rr && ['API','REST'].includes(String(rr.integration_mode||'').toUpperCase()) && rr.is_enabled !== false) {
            if (shouldFup && fupMbps) {
              const prof = `izn-fup-${Math.max(1, Math.round(Number(fupMbps)||1))}m`;
              await mikrotikEnsureFupProfile(rr, { speedMbps: Number(fupMbps), profileName: prof }).catch(()=>{});
              routerOk = await mikrotikSyncPppSecret(rr, { ...effective, profile_name: prof, profile: prof }).catch((e:any)=>({ ok:false, error: e.message }));
            } else {
              routerOk = await mikrotikSyncPppSecret(rr, { ...effective, profile_name: sub.profile_name || sub.package_name || 'default' }).catch((e:any)=>({ ok:false, error: e.message }));
            }
            try { await mikrotikDisconnectPppUser(rr, sub.username); } catch {}
          }
        }
      } catch {}
      try {
        await pool.query(`INSERT INTO fup_enforcement_logs(subscriber_id, action, over_cap, used_bytes, cap_gb, fup_speed_mbps, details)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [sub.id, shouldFup ? 'APPLIED' : 'CLEARED', over, used, capGb, fupMbps, JSON.stringify({ previous: was, rate_limit: rl, billing_restricted: billingRestricted, exempt, radius_sync_ok: radiusSyncOk, coa_ok: coaOk, router_ok: routerOk?.ok ?? null, router_mode: String(sub.provisioning_mode||'').toUpperCase()==='ROUTER', period: 'current_month' })]);
      } catch {}
      if (shouldFup) applied++; else cleared++;
    } catch { errors++; }
  }
  return { ok: true, evaluated: rows.length, applied, cleared, skipped, errors };
}

async function runFup() {
  try {
    const locked = await tryAcquireSchedulerLock('fup-enforcement-sweep', 25 * 60 * 1000).catch(()=>false);
    if (!locked) return;
    const res = await runFupEnforcementSweep();
    if (res.applied || res.cleared) console.log(`[FUP] evaluated=${res.evaluated} applied=${res.applied} cleared=${res.cleared} skipped=${res.skipped}`);
  } catch (e:any) { console.error('[FUP] sweep failed', e.message); }
}

export function startBillingScheduler() {
  // in-process scheduler with DB-backed lock to avoid overlapping runs across instances
  const run = async () => {
    const got = await tryAcquireSchedulerLock('billing-due-policy-sweep', 55_000).catch(()=>false);
    if (!got) return;
    try { await ensureOverdueInvoiceStatuses(); await evaluateDuePolicies(); } catch (e:any) { console.error('[BillingScheduler] error', e.message); }
  };
  const runMsg = async () => {
    try { await runMessagingSchedulerSweep(); } catch (e:any) { console.error('[MessagingScheduler] error', e.message); }
  };
  setTimeout(run, 5000);
  setInterval(run, 60 * 1000); // every minute for timely grace/suspension evaluation
  setTimeout(runMsg, 15000);
  setInterval(runMsg, 10 * 60 * 1000); // messaging summaries/reminders every 10 minutes
  setTimeout(runFup, 45000);
  setInterval(runFup, 30 * 60 * 1000); // FUP enforcement sweep
}

export async function ingestMfsSmsEvent(input: { gateway?: string; sender?: string; message?: string; amount?: number; trx_id?: string; payer_number?: string; payload?: any }) {
  const gateway = String(input.gateway || 'bkash').toLowerCase();
  const message = String(input.message || input.payload?.text || input.payload?.body || '').trim();
  const trxId = input.trx_id ? String(input.trx_id).trim() : null;
  const amount = input.amount != null ? Number(input.amount) : null;
  const ins = await pool.query(`INSERT INTO payment_sms_events(gateway,sender,message,trx_id,amount,payer_number,status,payload)
    VALUES($1,$2,$3,$4,$5,$6,'RECEIVED',$7::jsonb) RETURNING *`,
    [gateway, input.sender || input.payer_number || null, message || null, trxId, Number.isFinite(amount as any) ? amount : null, input.payer_number || input.sender || null, JSON.stringify(input.payload || {})]);

  const ev = ins.rows[0];
  let match: any = null;
  let recorded: any = null;

  // best-effort auto-match: prefer existing pending payment by trx/ref hints, else open invoice by amount+recent
  if (trxId) {
    const byTrx = await pool.query(`SELECT * FROM payments WHERE trx_id=$1 ORDER BY created_at DESC LIMIT 1`, [trxId]);
    if (byTrx.rows[0]) match = { type: 'payment', payment: byTrx.rows[0] };
  }
  if (!match && ev.amount && Number(ev.amount) > 0) {
    const inv = await pool.query(`SELECT i.* FROM invoices i
      WHERE i.status IN ('UNPAID','PARTIAL','OVERDUE') AND ABS(i.due_amount - $1::numeric) < 0.01
      ORDER BY i.due_date ASC NULLS LAST, i.created_at DESC LIMIT 1`, [ev.amount]);
    if (inv.rows[0]) match = { type: 'invoice', invoice: inv.rows[0] };
  }

  if (match?.payment && String(match.payment.status).toUpperCase() !== 'COMPLETED') {
    recorded = await recordPaymentAndReactivate({ gateway, amount: Number(ev.amount || match.payment.amount || 0), payment_ref: match.payment.payment_ref, invoice_id: match.payment.invoice_id, subscriber_id: match.payment.subscriber_id, trx_id: trxId || undefined, method: 'mfs_sms', payer_number: ev.payer_number || undefined, raw: { sms_event_id: ev.id, message }, status: 'COMPLETED' });
  } else if (match?.invoice) {
    recorded = await recordPaymentAndReactivate({ gateway, amount: Number(ev.amount || match.invoice.due_amount || 0), invoice_id: match.invoice.id, subscriber_id: match.invoice.subscriber_id, trx_id: trxId || undefined, method: 'mfs_sms', payer_number: ev.payer_number || undefined, raw: { sms_event_id: ev.id, message }, status: 'COMPLETED' });
  }

  const status = recorded?.ok ? 'MATCHED' : (match ? 'MATCH_FOUND' : 'UNMATCHED');
  const upd = await pool.query(`UPDATE payment_sms_events SET status=$2, matched_payment_ref=$3, matched_invoice_id=$4, processed_at=CASE WHEN $2 IN ('MATCHED','MATCH_FOUND') THEN now() ELSE processed_at END WHERE id=$1 RETURNING *`,
    [ev.id, status, recorded?.payment?.payment_ref || match?.payment?.payment_ref || null, recorded?.invoice?.id || match?.invoice?.id || null]);
  return { ok: true, event: upd.rows[0], match, recorded };
}