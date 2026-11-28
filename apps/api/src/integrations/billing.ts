import crypto = require('crypto');
import { pool } from '../db';
import { withSchedulerRun } from './scheduler-observability';
import { emitNocAlert } from './noc-alerts';
import { mikrotikSyncPppSecret, mikrotikRemovePppSecret, mikrotikPurgePppUser, mikrotikEnsureWalledGarden, mikrotikEnsureFupProfile, mikrotikEnsureParentalProfile, mikrotikDisconnectPppUser, mikrotikProvisionWalledGardenRedirect, mikrotikAddressListAdd, mikrotikAddressListRemove, mikrotikActiveAddressForUser, PARENTAL_CONTROL_PROFILE } from './mikrotik';
import { syncSubscriberToRadiusDb, sendCoaPacket } from './radius';
import { runMessagingSchedulerSweep, trySendTemplateToSubscriber } from './messaging';
import { auditLog } from './audit';
import { getCached, getBusinessTimezone, getBusinessDateYmd, ymdInTimezone } from './settings';
import { isQueuesActive, registerQueueHandler, scheduleRecurringJob } from '../infra/queues';

type AnyObj = Record<string, any>;

/** Parental profile for a ROUTER-mode subscriber, or null when not applicable.
 *  Billing restrictions always win; an active FUP profile gets a combined name
 *  so filtering is not lost when a subscriber is speed-limited. */
export function parentalProfileFor(sub: any, fupMbps?: number | null): string | null {
  if (!sub?.parental_control_enabled) return null;
  if (['SUSPENDED', 'TERMINATED', 'EXPIRED'].includes(String(sub.status || '').toUpperCase())) return null;
  if (sub.walled_garden) return null;
  if (['WALLED_GARDEN', 'ISOLATED', 'SUSPENDED'].includes(String(sub.suspension_stage || '').toUpperCase())) return null;
  return fupMbps ? `${PARENTAL_CONTROL_PROFILE}-fup-${Math.max(1, Math.round(Number(fupMbps) || 1))}m` : PARENTAL_CONTROL_PROFILE;
}

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
  // prefix + base sequence come from Settings & Security (general.*)
  const prefix = String(await getCached('general.invoice_prefix', 'INV')).replace(/[^A-Za-z0-9-]/g, '') || 'INV';
  const base = Math.max(1, Number(await getCached('general.invoice_next_number', 1)) || 1);
  const r = await pool.query(`SELECT COUNT(*)::int as c FROM invoices WHERE invoice_number LIKE $1`, [`${prefix}-${ym}-%`]);
  const n = Math.max(base, (r.rows[0]?.c || 0) + 1);
  return `${prefix}-${ym}-${String(n).padStart(5, '0')}`;
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
  const total = +amount.toFixed(2);
  // Apply any advance credit (overpayments from previous payments) to this
  // invoice so the balance is not stranded on the subscriber record.
  const creditRow = await pool.query('SELECT COALESCE(excess_amount,0)::numeric AS excess FROM subscribers WHERE id=$1', [sub.id]).catch(() => ({ rows: [] as any[] }));
  const credit = +Math.min(total, Math.max(0, Number(creditRow.rows[0]?.excess || 0))).toFixed(2);
  const dueAmount = +Math.max(0, total - credit).toFixed(2);
  if (credit > 0) {
    await pool.query('UPDATE subscribers SET excess_amount=COALESCE(excess_amount,0)-$2, updated_at=now() WHERE id=$1', [sub.id, credit]).catch(()=>{});
  }
  let ins: any = null;
  // nextInvoiceNumber() derives its sequence from a COUNT, so two concurrent
  // batches can compute the same number. invoice_number is UNIQUE — retry with
  // a fresh sequence instead of surfacing a 500 (and losing one invoice).
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoice_number = await nextInvoiceNumber();
    try {
      ins = await pool.query(`INSERT INTO invoices (
          invoice_number, subscriber_id, client_code, subscriber_name, username, billing_cycle, bill_month,
          period_start, period_end, issue_date, due_date, amount, discount, tax, total_amount, paid_amount, due_amount,
          status, notes, prorated, prorate_ratio, metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_DATE,$10,$11,$12,0,$13,0,$14,$15,$16,$17,$18,$19::jsonb) RETURNING *`,
        [invoice_number, sub.id, sub.client_code, sub.full_name, sub.username || null, billMonth, billMonth,
         ymd(pStart), ymd(periodEnd), ymd(due), amount, credit, total, dueAmount,
         dueAmount <= 0 ? 'PAID' : 'UNPAID', note, prorated, prorate_ratio,
         JSON.stringify({ package_name: sub.package_name, monthly_bill: monthly, policy: policy.name, advance_credit_applied: credit })]
      );
      break;
    } catch (e: any) {
      if (e?.code !== '23505' || attempt === 4) throw e;
    }
  }
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
  let q = `SELECT s.* FROM subscribers s WHERE COALESCE(s.monthly_bill,0) > 0 AND s.status <> 'TERMINATED' AND NOT (s.status='EXPIRED' AND COALESCE(s.suspension_source,'')='CREATION')`;
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

export async function applyProvisioningState(subId: string, desired: { status?: string; stage?: string; walled_garden?: boolean; reason?: string; sendCoa?: boolean; coaAction?: 'DISCONNECT'|'COA'; coaRateLimit?: string; profileOverride?: string; addressList?: string; captive?: 'expired'|'walled' }) {
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
  // An explicit walled_garden flag is authoritative: within-grace validity
  // expiry keeps status ACTIVE while restricting the session (walled garden +
  // captive redirect), so the old `status !== 'ACTIVE'` guard must only apply
  // when the flag is derived from the subscriber's current state.
  const walled = desired.walled_garden !== undefined
    ? !!desired.walled_garden
    : (!!effective.walled_garden && desired.status !== 'ACTIVE');
  // Captive-portal address list: validity expiry redirects to the /expired
  // notice page, money-dues walled garden to /walled-garden.
  const captiveList = desired.addressList || (walled ? (desired.captive === 'expired' ? 'izn-expired' : 'izn-walled-garden') : undefined);
  const restrictedProfile = desired.profileOverride || (walled ? 'izn-walled-garden' : null);
  if (restrictedProfile) effective.profile_name = restrictedProfile;
  if (desired.status === 'SUSPENDED' || desired.stage === SUSPENSION_STAGES.ISOLATED || desired.stage === SUSPENSION_STAGES.SUSPENDED) {
    if (!walled) effective.status = 'SUSPENDED';
  }

  // ROUTER mode: RADIUS replies never reach the device, so apply parental
  // control by moving the PPPoE secret to a dedicated filtered profile.
  const hardSuspended = effective.status === 'SUSPENDED' || effective.status === 'EXPIRED' || effective.status === 'TERMINATED';
  const parentalProfile = !walled && !hardSuspended ? parentalProfileFor(effective) : null;
  if (parentalProfile && mode === 'ROUTER' && router && ['API', 'REST'].includes(String(router.integration_mode || '').toUpperCase())) {
    effective.profile_name = parentalProfile;
    await mikrotikEnsureParentalProfile(router, {}).catch(() => {});
  }

  // Direct router provisioning (PPPoE secrets/profiles)
  if (mode === 'ROUTER' && router && ['API','REST'].includes(String(router.integration_mode||'').toUpperCase())) {
    try {
      if (walled) {
        results.walled_garden_profile = await mikrotikEnsureWalledGarden(router, { profileName: restrictedProfile || 'izn-walled-garden', rateLimit: desired.coaRateLimit || '64k/64k' }).catch((e: any) => ({ ok: false, error: e.message }));
      }
      // Resolve the subscriber's current session IP so the captive address
      // lists (izn-expired / izn-walled-garden) can carry it for the NAT
      // redirect to the notice page.
      let sessionIp: string | null = null;
      try {
        const sess = (await pool.query(`SELECT ip_address FROM subscriber_sessions WHERE subscriber_id=$1 AND ip_address IS NOT NULL ORDER BY updated_at DESC LIMIT 1`, [subId])).rows[0];
        sessionIp = (sess?.ip_address as string) || (cur.ip_address as string) || null;
        if (!sessionIp && effective.username) {
          sessionIp = await mikrotikActiveAddressForUser(router, String(effective.username)).catch(() => null);
        }
      } catch {}
      // desired.status is authoritative: stage ISOLATED/SUSPENDED below can
      // rewrite effective.status to SUSPENDED, so check the requested status.
      const effStatus = String(desired.status || effective.status || '').toUpperCase();
      const hardExpired = ['EXPIRED', 'TERMINATED'].includes(effStatus) && !walled;
      if (hardExpired && effective.username) {
        // Expiry/termination event: remove the subscriber from the MikroTik
        // entirely — kill /ppp/active sessions and delete the /ppp/secret.
        // Reactivation re-creates the secret via mikrotikSyncPppSecret.
        results.router = await mikrotikPurgePppUser(router, String(effective.username));
        if (results.router?.ok) {
          await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'PPP_PURGED',$2,$3,$4::jsonb,$5)`,
            [subId, String(desired.stage || effective.suspension_stage || 'ISOLATED'), `PPP credentials removed from router ${router.name || router.host} (${desired.reason || 'expired'})`,
             JSON.stringify({ router: router.name || router.host, username: effective.username, active_removed: results.router.active_removed, secret: results.router.secret, mode: results.router.mode }), 'enforcement']).catch(() => {});
          await auditLog({ action: 'SUBSCRIBER_PPP_PURGED', entity_type: 'subscriber', entity_id: subId, details: { username: effective.username, router: router.name || router.host, active_removed: results.router.active_removed, secret: results.router.secret, reason: desired.reason || null } }).catch(() => {});
        }
        // No session survives a purge — drop any stale captive address-list entries.
        if (sessionIp) {
          for (const l of ['izn-expired', 'izn-walled-garden']) {
            await mikrotikAddressListRemove(router, { list: l, address: sessionIp }).catch(() => {});
          }
        }
      } else {
        // Keep secret sync and captive provisioning independent: a profile
        // mismatch on the router must not skip the captive redirect setup.
        try {
          results.router = await mikrotikSyncPppSecret(router, effective);
        } catch (e: any) { results.router = { ok: false, error: e.message }; }
        if (walled && captiveList) {
          // Captive notice: make sure the router has the NAT redirect rules for
          // the captive list (dstnat tcp/80 → portal notice page), and put the
          // subscriber's session IP into the list when known. Idempotent.
          const base = String(process.env.CAPTIVE_PORTAL_BASE_URL || String(process.env.WALLED_GARDEN_PORTAL_URL || 'https://izandesk.duckdns.org').replace(/\/[^/]*$/, '')).replace(/\/+$/, '');
          const page = desired.captive === 'expired' ? '/expired' : '/walled-garden';
          results.captive_redirect = await mikrotikProvisionWalledGardenRedirect(router, {
            addressList: captiveList,
            portalUrl: `${base}${page}`,
            tag: desired.captive === 'expired' ? 'IzanDesk-Expired' : 'IzanDesk-WalledGarden',
          }).catch((e: any) => ({ ok: false, error: e.message }));
          if (sessionIp) {
            results.captive = await mikrotikAddressListAdd(router, { list: captiveList, address: sessionIp, comment: `IzanDesk:${captiveList}:${cur.username || subId}` }).catch((e: any) => ({ ok: false, error: e.message }));
          }
        } else if (!walled && effStatus === 'ACTIVE' && sessionIp) {
          // Reactivated/renewed: remove captive entries so traffic flows normally.
          results.captive_cleared = [];
          for (const l of ['izn-expired', 'izn-walled-garden']) {
            const r = await mikrotikAddressListRemove(router, { list: l, address: sessionIp }).catch((e: any) => ({ ok: false, error: e.message }));
            (results.captive_cleared as any[]).push({ list: l, ...r });
          }
        }
      }
    } catch (e:any) { results.router = { ok:false, error: e.message }; }
  }

  // RADIUS AAA sync (radcheck/radreply/radusergroup) for RADIUS and hybrid consistency
  if (cur.username) {
    try {
      const syncRes = await syncSubscriberToRadiusDb(effective, { walledGarden: walled, restrictedRateLimit: desired.coaRateLimit || '64k/64k', addressList: captiveList || 'izn-walled-garden' });
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
        attrs['Mikrotik-Address-List'] = captiveList || 'izn-walled-garden';
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
  const tz = await getBusinessTimezone();
  const today = ymdInTimezone(now, tz);
  const warnBefore = Number(policy.warning_days ?? 3);
  const graceDays = Number(policy.grace_days ?? 7);
  const subs = (await pool.query(`SELECT s.*, (SELECT MIN(i.due_date)::date FROM invoices i WHERE i.subscriber_id=s.id AND i.status IN ('UNPAID','PARTIAL','OVERDUE')) as earliest_due
    FROM subscribers s WHERE s.auto_suspend_enabled=true AND s.status <> 'TERMINATED'`)).rows;
  const actions: any[] = [];
  for (const s of subs) {
    await recalcSubscriberDue(s.id);
    const ref = (await pool.query('SELECT id, username, status, suspension_stage, walled_garden, expiry_date, due_date, grace_until, suspension_reason, current_due FROM subscribers WHERE id=$1', [s.id])).rows[0] || s;
    const due = toDate(s.earliest_due || ref.due_date || ref.expiry_date || s.due_date || s.expiry_date);
    const currentDue = Number(ref.current_due ?? s.current_due ?? 0);
    const daysOverdue = due ? diffDays(new Date(today), due) : 0; // positive if past due
    // Simple validity model: restricted ON expiry day, not only after. validityExpired = daysOverdue >= 0.
    const validityExpired = daysOverdue >= 0;
    if (!due || (!(currentDue > 0) && !validityExpired)) {
      // no dues and validity not expired: if previously warned/grace/walled but not manually suspended, clear stage
      if (!validityExpired && ['WARNING','GRACE','WALLED_GARDEN'].includes(String(ref.suspension_stage || 'NONE')) && !['SUSPENDED', 'EXPIRED'].includes(String(ref.status || ''))) {
        await pool.query(`UPDATE subscribers SET suspension_stage='NONE', grace_until=NULL, walled_garden=false, suspension_reason=NULL, suspension_source='NONE', updated_at=now() WHERE id=$1`, [s.id]);
        actions.push({ subscriber_id: s.id, action: 'CLEARED', stage: 'NONE' });
      }
      continue;
    }
    const daysToDue = due ? diffDays(due, new Date(today)) : 0;
    let targetStage = String(ref.suspension_stage || s.suspension_stage || 'NONE');
    let targetStatus = String(ref.status || s.status || 'ACTIVE');
    let walled = !!(ref.walled_garden ?? s.walled_garden);
    let graceUntil: Date | null = toDate(ref.grace_until || s.grace_until);
    let reason: string | null = (ref.suspension_reason ?? s.suspension_reason) || null;

    if (daysToDue <= warnBefore && daysToDue >= 0) {
      if (!['GRACE','ISOLATED','SUSPENDED','WALLED_GARDEN'].includes(targetStage)) {
        targetStage = SUSPENSION_STAGES.WARNING;
        reason = `Invoice/validity due in ${daysToDue} day(s)`;
      }
    }
    if (daysOverdue >= 0) {
      // overdue/validity expired (ON expiry day too): grace -> walled garden/isolation -> expired
      if (!graceUntil) graceUntil = addDays(due as Date, graceDays);
      if (daysOverdue <= graceDays) {
        if (!['ISOLATED','SUSPENDED','WALLED_GARDEN'].includes(targetStage)) {
          targetStage = policy.enable_walled_garden ? SUSPENSION_STAGES.WALLED_GARDEN : SUSPENSION_STAGES.GRACE;
          walled = !!policy.enable_walled_garden;
          targetStatus = policy.enable_walled_garden ? 'EXPIRED' : targetStatus; // expired validity, but restricted walled-garden (not hard reject)
          reason = `${currentDue > 0 ? 'Overdue' : 'Validity expired'}: grace period until ${ymd(graceUntil)}${walled ? ' (walled garden)' : ''}`;
        }
      } else {
        // beyond grace
        if (policy.auto_suspend) {
          if (!(currentDue > 0) && !policy.enable_walled_garden) {
            // Pure validity expiry (no money due): hard-expire so the expiry
            // event purges the subscriber from the MikroTik /ppp/secret and
            // /ppp/active. Only when walled garden is disabled; otherwise
            // fall through to restricted walled-garden (not hard disconnect).
            targetStage = SUSPENSION_STAGES.ISOLATED;
            targetStatus = 'EXPIRED';
            walled = false;
            reason = 'Validity expired beyond grace: expired';
          } else if (policy.enable_walled_garden) {
            targetStage = SUSPENSION_STAGES.WALLED_GARDEN;
            targetStatus = 'EXPIRED'; // expired validity + restricted walled-garden; pay online restores ACTIVE
            walled = true;
            reason = `${currentDue > 0 ? 'Overdue' : 'Validity expired'} beyond grace: walled garden isolation active`;
          } else if (policy.isolate_on_suspend) {
            targetStage = SUSPENSION_STAGES.ISOLATED;
            targetStatus = 'EXPIRED';
            walled = false;
            reason = `${currentDue > 0 ? 'Overdue' : 'Validity expired'} beyond grace: isolated/expired`;
          } else {
            targetStage = SUSPENSION_STAGES.SUSPENDED;
            targetStatus = 'EXPIRED';
            walled = false;
            reason = `${currentDue > 0 ? 'Overdue' : 'Validity expired'} beyond grace: expired`;
          }
        }
      }
    }

    const stageChanged = targetStage !== String(ref.suspension_stage || 'NONE');
    const statusChanged = targetStatus !== String(ref.status || s.status);
    const walledChanged = walled !== !!(ref.walled_garden ?? s.walled_garden);
    const oldReason = ref.suspension_reason ?? s.suspension_reason ?? null;
    // `|| walled`: re-apply enforcement EVERY sweep for restricted subscribers,
    // not only on a state change — a reconnect/reboot/offline→online with a NEW IP
    // must re-add the current session IP to izn-* and re-apply the restricted profile
    // so IP-keyed firewall/captive entries can't lapse. (Closes new-IP loophole.)
    if (stageChanged || statusChanged || walledChanged || walled) {
      await pool.query(`UPDATE subscribers SET suspension_stage=$2, status=$3, walled_garden=$4, grace_until=$5, suspension_reason=$6, suspension_source=$7, updated_at=now() WHERE id=$1`,
        [s.id, targetStage, targetStatus, walled, graceUntil ? graceUntil.toISOString() : null, reason, targetStage === 'NONE' ? 'NONE' : 'POLICY']);
      await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
        [s.id, statusChanged ? 'STATUS_CHANGE' : 'STAGE_CHANGE', targetStage, reason, JSON.stringify({ daysOverdue, daysToDue, currentDue, due: due ? ymd(due) : null, walled, validityExpired }), 'policy_engine']);

      // apply network enforcement (including walled-garden restriction profile/address-list/CoA)
      {
        try {
          const profileOverride = walled ? (policy.walled_garden_profile || 'izn-walled-garden') : undefined;
          const coaAction: 'DISCONNECT'|'COA' = ((targetStatus === 'SUSPENDED' || targetStatus === 'EXPIRED') && !walled) ? 'DISCONNECT' : 'COA';
          // Validity-expired (no money due) subscribers land on the expiry
          // captive page (/expired, address-list izn-expired); money-overdue
          // subscribers stay on the walled-garden page.
          const captive: 'expired'|'walled'|undefined = walled ? (currentDue > 0 ? 'walled' : 'expired') : undefined;
          const applied = await applyProvisioningState(s.id, { status: targetStatus, stage: targetStage, walled_garden: walled, reason: reason || undefined, sendCoa: true, coaAction, profileOverride, coaRateLimit: walled ? '64k/64k' : undefined, addressList: walled ? (captive === 'expired' ? 'izn-expired' : 'izn-walled-garden') : undefined, captive });
          // applyProvisioningState returns ok:true even when an individual
          // router/RADIUS/CoA step failed. Do not silently record a successful
          // enforcement when the subscriber state was changed but the network
          // was not.
          const failed = Object.entries(applied?.results || {})
            .filter(([, v]: any) => v && v.ok === false && !v.skipped)
            .map(([k]) => k);
          if (failed.length) {
            await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'ENFORCEMENT_ERROR',$2,$3,$4::jsonb,'policy_engine')`,
              [s.id, targetStage, `Enforcement failed: ${failed.join(', ')}`, JSON.stringify({ failed, results: applied.results })]);
          }
        } catch (e:any) {
          await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'ENFORCEMENT_ERROR',$2,$3,$4::jsonb,'policy_engine')`, [s.id, targetStage, e.message, JSON.stringify({})]);
        }
      }

      // Pay reminder: notify once when a subscriber first enters walled garden (restricted; portal-only pay to restore).
      // Best-effort; goes to noc_alerts + configured Telegram channel; never fails the sweep. (`walledChanged && walled`.)
      if (walled && walledChanged && targetStage === SUSPENSION_STAGES.WALLED_GARDEN) {
        try {
          await emitNocAlert({
            severity: currentDue > 0 ? 'WARNING' : 'INFO',
            source: 'BILLING',
            title: `Pay reminder: ${s.username}`,
            message: `${s.full_name || s.username} (${s.username}) ${currentDue > 0 ? `has ৳${currentDue} due` : 'validity expired'}; restricted portal-only — pay online to restore.`,
            details: { subscriber_id: s.id, username: s.username, client_code: s.client_code, current_due: currentDue, expiry_date: ref.expiry_date || s.expiry_date || null, due_date: due ? ymd(due) : null, reason: reason || null, captive: currentDue > 0 ? 'walled' : 'expired' },
            dedupeMinutes: 60,
          });
        } catch { /* optional */ }
      }
      actions.push({ subscriber_id: s.id, username: s.username, targetStage, targetStatus, walled_garden: walled, daysOverdue, daysToDue, reason });
    } else if (reason !== oldReason && ['WARNING', 'GRACE', 'WALLED_GARDEN', 'ISOLATED', 'SUSPENDED'].includes(targetStage)) {
      await pool.query(`UPDATE subscribers SET suspension_reason=$2, suspension_source='POLICY', updated_at=now() WHERE id=$1`, [s.id, reason]);
    }
  }
  return { ok: true, evaluated: subs.length, actions, policy: { grace_days: graceDays, warning_days: warnBefore, auto_suspend: !!policy.auto_suspend, isolate_on_suspend: !!policy.isolate_on_suspend, enable_walled_garden: !!policy.enable_walled_garden } };
}

/** Credit a reseller wallet from a VERIFIED gateway payment (reseller self-service recharge).
 *  Binds to a PENDING payment created by POST /api/resellers/:id/wallet/recharge-gateway;
 *  idempotent; enforces credit_limit; never trusts caller-supplied amount. */
export async function creditResellerWalletFromGatewayPayment(opts: { paymentRef: string; trxId?: string | null; raw?: any }): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pr = (await client.query('SELECT * FROM payments WHERE payment_ref=$1 FOR UPDATE', [opts.paymentRef])).rows[0];
    if (!pr) { await client.query('ROLLBACK'); return { ok: false, reason: 'payment not found' }; }
    const meta = (pr.gateway_response || {}) as any;
    if (meta.purpose !== 'RESELLER_WALLET_RECHARGE') { await client.query('ROLLBACK'); return { ok: false, reason: 'not a reseller wallet payment' }; }
    // Idempotency must be keyed on the ledger, NOT the payment status: a provider
    // callback may already have marked the payment COMPLETED without crediting the
    // wallet (see recordPaymentAndReactivate delegation). If the wallet transaction
    // exists we are done; if it does not, we must still credit exactly once.
    const already = await client.query(`SELECT 1 FROM reseller_wallet_transactions
      WHERE type='RECHARGE' AND (reference_id::text=$1 OR metadata->>'payment_ref'=$2) LIMIT 1`,
      [String(pr.id), pr.payment_ref]).catch(() => ({ rows: [] as any[] }));
    if (already.rows[0]) { await client.query('ROLLBACK'); return { ok: true, duplicate: true }; }
    // FAILED/CANCELLED can never credit. COMPLETED is allowed through when the
    // ledger has no matching wallet transaction yet (the bug this repairs).
    if (['FAILED', 'CANCELLED', 'REFUNDED'].includes(String(pr.status || '').toUpperCase())) {
      await client.query('ROLLBACK'); return { ok: false, reason: `payment is ${pr.status}` };
    }
    const resellerId = meta.reseller_id;
    const rr = (await client.query('SELECT * FROM resellers WHERE id=$1 FOR UPDATE', [resellerId])).rows[0];
    if (!rr) { await client.query('ROLLBACK'); return { ok: false, reason: 'reseller not found' }; }
    const amount = Number(pr.amount || 0);
    if (!(amount > 0)) { await client.query('ROLLBACK'); return { ok: false, reason: 'invalid amount' }; }
    const newBal = +(Number(rr.wallet_balance || 0) + amount).toFixed(2);
    const limit = Number(rr.credit_limit || 0);
    if (limit > 0 && newBal > limit) { await client.query('ROLLBACK'); return { ok: false, reason: `credit limit exceeded (${limit})` }; }
    await client.query(`UPDATE payments SET status='COMPLETED', verified_at=now(), trx_id=COALESCE($2,trx_id), updated_at=now() WHERE id=$1`, [pr.id, opts.trxId || null]);
    await client.query(`UPDATE resellers SET wallet_balance=$2, updated_at=now() WHERE id=$1`, [rr.id, newBal]);
    await client.query(`INSERT INTO reseller_wallet_transactions(reseller_id,type,direction,amount,balance_after,reference_type,reference_id,description,metadata,created_by)
      VALUES($1,'RECHARGE','CREDIT',$2,$3,'PAYMENT',$4,$5,$6::jsonb,$7)`,
      [rr.id, amount, newBal, pr.id, 'Gateway wallet recharge', JSON.stringify({ payment_ref: pr.payment_ref, trx_id: opts.trxId || null }), 'gateway']);
    await client.query('COMMIT');
    return { ok: true, balance: newBal, amount };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}

export async function reactivateSubscriber(subscriberId: string, reason = 'Payment confirmed', opts: { force?: boolean; allowCreatedExpired?: boolean } = {}) {
  const start = Date.now();
  const current = (await pool.query('SELECT status, suspension_source, suspension_reason FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
  // Close the last created-EXPIRED bypass: only the strict admin recharge
  // (activateCreatedExpired) and the reseller wallet activation may activate these.
  // Customer payment webhooks / manual confirm / queued reactivations are refused;
  // the money is still recorded, but the subscriber stays EXPIRED until recharged.
  if (current && String(current.suspension_source || '').toUpperCase() === 'CREATION' && !opts.allowCreatedExpired) {
    return { ok: false, blocked: true, reason: 'created-EXPIRED subscribers can only be activated via admin recharge or reseller wallet activation' };
  }
  const manuallySuspended = current && (
    String(current.suspension_source || '').toUpperCase() === 'MANUAL' ||
    /^manual/i.test(String(current.suspension_reason || ''))
  );
  if (manuallySuspended && !opts.force) {
    return { ok: true, skipped: true, reason: 'Manual suspension is preserved; use the explicit reactivate action' };
  }
  // activate and clear suspension/walled garden
  await pool.query(`UPDATE subscribers SET status='ACTIVE', suspension_stage='NONE', walled_garden=false, grace_until=NULL, suspension_reason=NULL, suspension_source='NONE', updated_at=now() WHERE id=$1`, [subscriberId]);
  const applied = await applyProvisioningState(subscriberId, { status: 'ACTIVE', stage: SUSPENSION_STAGES.NONE, walled_garden: false, reason, sendCoa: true, coaAction: 'COA' });
  await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'REACTIVATED','NONE',$2,$3::jsonb,'payment')`, [subscriberId, reason, JSON.stringify({ duration_ms: Date.now()-start, target_ms: 2000 })]);
  return { ok: true, duration_ms: Date.now()-start, target_ms: 2000, applied };
}

export async function recordPaymentAndReactivate(input: { gateway: string; amount: number; invoice_id?: string; subscriber_id?: string; trx_id?: string; method?: string; payer_number?: string; raw?: any; payment_ref?: string; currency?: string; status?: string; dedupe_key?: string }) {
  const amount = Number(input.amount || 0);
  if (!(amount > 0)) throw new Error('Invalid payment amount');
  const status = String(input.status || 'COMPLETED').toUpperCase();
  const trx = input.trx_id ? String(input.trx_id).trim() : null;

  // Reseller wallet recharges must credit the reseller wallet, never subscriber billing.
  // Provider callbacks (bKash execute, manual confirm) reach this function with the
  // payment_ref of a RESELLER_WALLET_RECHARGE payment; delegating here keeps a single
  // ledger path and prevents "payment COMPLETED but wallet never credited".
  if (input.payment_ref) {
    const purpose = (await pool.query(`SELECT gateway_response->>'purpose' AS purpose FROM payments WHERE payment_ref=$1`, [input.payment_ref]).catch(() => ({ rows: [] as any[] }))).rows[0]?.purpose;
    if (String(purpose || '').toUpperCase() === 'RESELLER_WALLET_RECHARGE') {
      const credited = await creditResellerWalletFromGatewayPayment({ paymentRef: input.payment_ref, trxId: trx, raw: input.raw });
      return { ok: !!credited.ok, duplicate: !!credited.duplicate, reseller_wallet: credited, payment_ref: input.payment_ref, subscriber_id: null, reactivation: null };
    }
  }

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
  if (input.dedupe_key) {
    const existingByKey = await pool.query(`SELECT * FROM payments WHERE idempotency_key=$1 ORDER BY created_at DESC LIMIT 1`, [input.dedupe_key]);
    if (existingByKey.rows[0] && String(existingByKey.rows[0].status).toUpperCase() === 'COMPLETED') {
      const p = existingByKey.rows[0];
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
  let payRes: any;
  try {
    payRes = await pool.query(`INSERT INTO payments (payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, trx_id, payer_number, gateway_response, verified_at, idempotency_key)
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
  } catch (e: any) {
    // Two concurrent deliveries can pass the read checks above. The database
    // uniqueness constraint is the real boundary: treat a conflict as a
    // duplicate and never apply money/state side effects twice.
    if (e?.code === '23505') {
      const existing = trx
        ? await pool.query(`SELECT * FROM payments WHERE gateway=$1 AND trx_id=$2 ORDER BY created_at DESC LIMIT 1`, [input.gateway, trx])
        : input.dedupe_key
          ? await pool.query(`SELECT * FROM payments WHERE idempotency_key=$1 ORDER BY created_at DESC LIMIT 1`, [input.dedupe_key])
          : { rows: [] as any[] };
      if (existing.rows[0]) {
        const p = existing.rows[0];
        const inv = p.invoice_id ? (await pool.query('SELECT * FROM invoices WHERE id=$1', [p.invoice_id])).rows[0] : null;
        return { ok: true, duplicate: true, payment: p, invoice: inv, subscriber_id: p.subscriber_id, reactivation: null };
      }
    }
    throw e;
  }
  const payment = payRes.rows[0];

  let updatedInvoice = invoice;
  const applyToInvoice = async (inv: any, applyAmount: number) => {
    const total = Number(inv.total_amount || inv.amount || 0);
    const paidBefore = Number(inv.paid_amount || 0);
    // due_amount is authoritative: waivers/credits may make it differ from
    // total_amount - paid_amount. Never recreate a waived due balance.
    const dueBefore = Number.isFinite(Number(inv.due_amount))
      ? Math.max(0, Number(inv.due_amount))
      : Math.max(0, total - paidBefore);
    const take = Math.min(Math.max(0, applyAmount), dueBefore);
    const paid = +Math.min(total, paidBefore + take).toFixed(2);
    const dueAmt = +Math.max(0, dueBefore - take).toFixed(2);
    const invStatus = dueAmt <= 0 ? 'PAID' : (paid > 0 ? 'PARTIAL' : inv.status);
    return (await pool.query(`UPDATE invoices SET paid_amount=$2, due_amount=$3, status=$4, paid_at=CASE WHEN $4='PAID' THEN COALESCE(paid_at, now()) ELSE paid_at END, updated_at=now() WHERE id=$1 RETURNING *`,
      [inv.id, paid, dueAmt, invStatus])).rows[0];
  };

  let overpayment = 0;
  if (invoice && status === 'COMPLETED') {
    overpayment = +Math.max(0, amount - Math.max(0, Number(invoice.due_amount || 0))).toFixed(2);
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
    overpayment = +Math.max(0, remaining).toFixed(2);
  }
  // Money received beyond what was invoiced is retained as an advance credit
  // instead of silently disappearing. It is deducted from the next invoice.
  if (overpayment > 0 && subscriberId) {
    await pool.query(`UPDATE subscribers SET excess_amount=COALESCE(excess_amount,0)+$2, updated_at=now() WHERE id=$1`, [subscriberId, overpayment]).catch(()=>{});
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
    const sub = (await pool.query('SELECT status, suspension_stage, walled_garden, suspension_source, package_name FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
    // Payment-gate for created-EXPIRED: reactivation requires a recorded payment >= package price.
    // (Anything less is still recorded as money received, but cannot flip created-EXPIRED -> ACTIVE;
    //  the strict single-transaction path is activateCreatedExpired / POST /api/subscribers/:id/renew.)
    let reactivateBlocked = false;
    if (sub && String(sub.suspension_source || '').toUpperCase() === 'CREATION' && String(sub.status || '').toUpperCase() === 'EXPIRED') {
      const pkgPriceRow = sub.package_name ? (await pool.query('SELECT price FROM bandwidth_packages WHERE name=$1 LIMIT 1', [sub.package_name]).catch(() => ({ rows: [] as any[] }))).rows[0] : null;
      const pkgPrice = Number(pkgPriceRow?.price || 0);
      const required = pkgPrice > 0 ? pkgPrice : 0;
      reactivateBlocked = required > 0 && amount + 0.001 < required;
    }
    if (!reactivateBlocked && status === 'COMPLETED' && due <= 0 && sub && (sub.status === 'SUSPENDED' || sub.status === 'EXPIRED' || String(sub.suspension_stage || 'NONE') !== 'NONE' || sub.walled_garden)) {
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

/** Unified validity rule (shared by admin recharge + reseller wallet renewal):
 *  new expiry = max(current expiry, today) + package validity_value/unit
 *  (or +extendDays; package CALENDAR_MONTH default; business timezone). */
export async function computeNewExpiry(sub: any, pkg: any, extendDaysIn?: number): Promise<{ newExpiry: string; oldExpiry: string | null; extendLabel: string }> {
  const unit = String(pkg?.validity_unit || 'CALENDAR_MONTH').toUpperCase();
  const val = Math.max(1, Number(pkg?.validity_value || 1));
  const tz = await getBusinessTimezone();
  const todayYmd = ymdInTimezone(new Date(), tz);
  const cur = toDate(sub?.expiry_date);
  const curYmd = cur ? ymdInTimezone(cur, tz) : null;
  const base = curYmd && curYmd > todayYmd ? new Date(`${curYmd}T00:00:00`) : new Date(`${todayYmd}T00:00:00`);
  const exp = new Date(base);
  let extendLabel: string;
  const extendDays = Math.floor(Number(extendDaysIn || 0));
  if (extendDays > 0) { exp.setDate(exp.getDate() + extendDays); extendLabel = `+${extendDays} day(s)`; }
  else if (unit === 'DAYS') { exp.setDate(exp.getDate() + val); extendLabel = `+${val} day(s)`; }
  else if (unit === 'MONTHS') { exp.setMonth(exp.getMonth() + val); extendLabel = `+${val} month(s)`; }
  else { exp.setMonth(exp.getMonth() + 1); extendLabel = '+1 calendar month'; }
  return { newExpiry: ymdInTimezone(exp, tz), oldExpiry: curYmd, extendLabel };
}

/**
 * One-click admin renewal ("recharge"): extend the subscriber's validity by the
 * package validity (or an explicit day count) and, when an amount is charged,
 * record a completed payment that clears dues and triggers instant reactivation
 * (PPP secret / RADIUS / CoA) through recordPaymentAndReactivate().
 *
 * The new expiry is based on max(current expiry, today) so an already-expired
 * subscriber renews from today, not from the lapsed date.
 */
/** Strict single-transaction activation for created-EXPIRED (suspension_source='CREATION') subscribers.
 *  Recorded payment == package price (fallback subscriber monthly_bill) + activation commit together;
 *  no invoice at activation; no advance credit; nothing applied on any failure. Provisioning after commit is best-effort. */
export async function activateCreatedExpired(subscriberId: string, opts: { method?: string; note?: string } = {}) {
  const pre = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
  if (!pre) throw new Error('Subscriber not found');
  if (String(pre.status).toUpperCase() !== 'EXPIRED' || String(pre.suspension_source || '').toUpperCase() !== 'CREATION') {
    throw new Error('activateCreatedExpired applies only to created-EXPIRED (suspension_source=CREATION) subscribers');
  }
  let pkg: any = null;
  if (pre.package_name) pkg = (await pool.query('SELECT price, validity_value, validity_unit FROM bandwidth_packages WHERE name=$1 LIMIT 1', [pre.package_name])).rows[0] || null;
  const pkgPrice = Number(pkg?.price || 0);
  const amount = pkgPrice > 0 ? pkgPrice : Number(pre.monthly_bill || 0);
  if (!(amount > 0)) throw new Error('A recorded payment >= package price is required to reactivate a created-EXPIRED subscriber');
  const { newExpiry, oldExpiry, extendLabel } = await computeNewExpiry(pre, pkg);
  const payment_ref = `ADM-RECHARGE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const method = String(opts.method || 'CASH').slice(0, 40);

  const client = await pool.connect();
  let payment: any = null;
  try {
    await client.query('BEGIN');
    const locked = (await client.query('SELECT * FROM subscribers WHERE id=$1 FOR UPDATE', [subscriberId])).rows[0];
    if (!locked) throw new Error('Subscriber not found');
    if (String(locked.status).toUpperCase() !== 'EXPIRED' || String(locked.suspension_source || '').toUpperCase() !== 'CREATION') {
      throw new Error('Subscriber is no longer created-EXPIRED');
    }
    payment = (await client.query(`INSERT INTO payments(payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, verified_at, gateway_response)
      VALUES($1,NULL,$2::uuid,$3,$3,$4::numeric,'BDT','COMPLETED',now(),$5::jsonb) RETURNING *`,
      [payment_ref, subscriberId, method, amount, JSON.stringify({ type: 'ADMIN_CREATED_EXPIRED_RECHARGE', note: opts.note || null, extend: extendLabel, old_expiry_date: oldExpiry, new_expiry_date: newExpiry, package_price: pkgPrice })])).rows[0];
    await client.query(`UPDATE subscribers SET status='ACTIVE', suspension_stage='NONE', walled_garden=false, suspension_source='NONE', suspension_reason=NULL, grace_until=NULL,
       expiry_date=$2, old_expiry_date=$3, due_date=$2, next_bill_date=$2, excess_amount=GREATEST(0, COALESCE(excess_amount,0)-$4), updated_at=now() WHERE id=$1`,
      [subscriberId, newExpiry, oldExpiry, amount]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }

  // post-commit best-effort (mirrors recordPaymentAndReactivate extras; NOT inside the money transaction)
  try { await recalcSubscriberDue(subscriberId); } catch {}
  let reactivation: any = null;
  try { reactivation = await applyProvisioningState(subscriberId, { status: 'ACTIVE', stage: SUSPENSION_STAGES.NONE, walled_garden: false, reason: `Admin recharge ${payment_ref}`, sendCoa: true, coaAction: 'COA' }); } catch (e: any) { reactivation = { ok: false, error: e.message }; }
  try { await pool.query(`INSERT INTO wallet_transactions(subscriber_id, type, amount, reference_id, reference_type, description, metadata) VALUES($1,'CREDIT',$2,$3,'PAYMENT',$4,$5::jsonb)`,
    [subscriberId, amount, payment_ref, 'PAYMENT', `Admin recharge via ${method}`, JSON.stringify({ payment_ref })]); } catch {}
  try { await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'REACTIVATED','NONE',$2,$3::jsonb,'admin')`,
    [subscriberId, `Admin recharge ${payment_ref}`, JSON.stringify({ amount, payment_ref, expiry: newExpiry })]); } catch {}
  try {
    const cashAccR = await pool.query("SELECT id FROM finance_accounts WHERE code='1000' LIMIT 1").catch(() => ({ rows: [] as any[] }));
    const revAccR = await pool.query("SELECT id FROM finance_accounts WHERE code='4000' LIMIT 1").catch(() => ({ rows: [] as any[] }));
    const cashAcc = (cashAccR as any).rows[0]?.id, revAcc = (revAccR as any).rows[0]?.id;
    if (cashAcc && revAcc) {
      const je = await pool.query(`INSERT INTO finance_journal_entries(entry_no,entry_date,description,source_type,source_id,posted,created_by) VALUES($1,CURRENT_DATE,$2,'PAYMENT',$3,true,'system') RETURNING id`,
        [`JE-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`, `Payment ${payment_ref}`, payment_ref]).catch(() => ({ rows: [] as any[] }));
      const jid = (je as any).rows[0]?.id;
      if (jid) await pool.query(`INSERT INTO finance_journal_lines(entry_id,account_id,debit,credit,memo) VALUES($1,$2,$3,0,'cash/mfs'),($1,$4,0,$3,'revenue')`, [jid, cashAcc, amount, revAcc]).catch(() => {});
      await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,method,amount,currency,reference_type,reference_id,subscriber_id,description,created_by) VALUES(CURRENT_DATE,'COLLECTION',$1,$2,'BDT','PAYMENT',$3,$4::uuid,$5,'system')`,
        [method, amount, payment_ref, subscriberId, `Payment ${payment_ref}`]).catch(() => {});
    }
  } catch {}
  try { await auditLog({ action: 'PAYMENT_COMPLETED', entity_type: 'payment', entity_id: payment?.id || payment_ref, details: { gateway: method, amount, subscriber_id: subscriberId, admin_recharge: true, created_expired_activation: true } }); } catch {}

  const fresh = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
  return { ok: true, payment, reactivation, due: 0, extend: extendLabel, old_expiry_date: oldExpiry, expiry_date: newExpiry, amount, method, subscriber: fresh };
}

/** Allocate a payment to open invoices inside an existing transaction (oldest first).
 *  Returns the remaining unallocated amount and the resulting subscriber due. */
async function allocatePaymentToOpenInvoicesTx(client: any, subscriberId: string, amount: number) {
  const open = await client.query(`SELECT * FROM invoices WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE') AND GREATEST(due_amount,0) > 0 ORDER BY COALESCE(due_date, issue_date, created_at) ASC, created_at ASC`, [subscriberId]);
  let remaining = amount;
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
  const dueRes = await client.query(`SELECT COALESCE(SUM(GREATEST(due_amount,0)),0)::numeric(12,2) AS due FROM invoices WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE')`, [subscriberId]);
  return { due: Number(dueRes.rows[0]?.due || 0), remaining: +Math.max(0, remaining).toFixed(2) };
}

export async function renewSubscriber(subscriberId: string, opts: { amount?: number; method?: string; extendDays?: number; note?: string } = {}) {
  const sub = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
  if (!sub) throw new Error('Subscriber not found');
  if (String(sub.status).toUpperCase() === 'TERMINATED') throw new Error('Cannot renew a terminated subscriber');
  // Expiry is exactly what a renewal fixes: even a manual expiry must restore
  // access (and re-create the purged PPP secret) once renewed.
  const wasExpired = String(sub.status).toUpperCase() === 'EXPIRED';

  let pkg: any = null;
  if (sub.package_name) {
    pkg = (await pool.query('SELECT price, validity_value, validity_unit FROM bandwidth_packages WHERE name=$1 LIMIT 1', [sub.package_name])).rows[0] || null;
  }
  const { newExpiry, oldExpiry, extendLabel } = await computeNewExpiry(sub, pkg, opts.extendDays);

  // Payment-gated activation for created-EXPIRED subscribers: recorded payment == package price
  // (fallback: subscriber monthly_bill when no package row exists). No amount=0 free activation.
  if (String(sub.suspension_source || '').toUpperCase() === 'CREATION') {
    return await activateCreatedExpired(subscriberId, { method: opts.method, note: opts.note });
  }
  let amount: number;
  if (opts.amount == null) {
    amount = Number(sub.price_override ?? sub.monthly_bill ?? pkg?.price ?? 0);
  } else {
    amount = Number(opts.amount);
  }
  if (!Number.isFinite(amount) || amount < 0) throw new Error('amount must be a non-negative number');
  if (!(amount > 0) && wasExpired) throw new Error('A recorded payment >= package price is required to reactivate an EXPIRED subscriber');
  const charged = amount > 0;
  const method = String(opts.method || 'CASH').slice(0, 40);
  const payment_ref = `RENEW-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  // Single transaction: payment record + invoice allocation/due/excess + subscriber
  // state (expiry/status) commit together. Provisioning, wallet ledger, finance and
  // notifications are post-commit best-effort (they must not roll money back).
  const client = await pool.connect();
  let payment: any = null;
  let due = 0;
  let activated = false;
  let raceCreatedExpired = false;
  try {
    await client.query('BEGIN');
    const locked = (await client.query('SELECT * FROM subscribers WHERE id=$1 FOR UPDATE', [subscriberId])).rows[0];
    if (!locked) throw new Error('Subscriber not found');
    if (String(locked.status).toUpperCase() === 'TERMINATED') throw new Error('Cannot renew a terminated subscriber');
    if (String(locked.suspension_source || '').toUpperCase() === 'CREATION') {
      // Raced into created-EXPIRED after the pre-read: fall through to the strict path.
      await client.query('ROLLBACK');
      raceCreatedExpired = true;
    } else {
      if (charged) {
        payment = (await client.query(`INSERT INTO payments(payment_ref, invoice_id, subscriber_id, gateway, method, amount, currency, status, verified_at, gateway_response)
          VALUES($1,NULL,$2::uuid,$3,$4,$5::numeric,'BDT','COMPLETED',now(),$6::jsonb) RETURNING *`,
          [payment_ref, subscriberId, method, method, amount, JSON.stringify({ type: 'MANUAL_RENEW', note: opts.note || null, extend: extendLabel, old_expiry_date: oldExpiry, new_expiry_date: newExpiry })]))
          .rows[0];
        const alloc = await allocatePaymentToOpenInvoicesTx(client, subscriberId, amount);
        due = alloc.due;
        // Money beyond invoiced dues is retained as advance credit.
        if (alloc.remaining > 0) {
          await client.query(`UPDATE subscribers SET excess_amount=COALESCE(excess_amount,0)+$2, updated_at=now() WHERE id=$1`, [subscriberId, alloc.remaining]);
        }
      } else {
        const dueRes = await client.query(`SELECT COALESCE(SUM(GREATEST(due_amount,0)),0)::numeric(12,2) AS due FROM invoices WHERE subscriber_id=$1 AND status IN ('UNPAID','PARTIAL','OVERDUE')`, [subscriberId]);
        due = Number(dueRes.rows[0]?.due || 0);
      }
      // A charge that clears the due (or a validity renewal of an EXPIRED subscriber)
      // restores ACTIVE; a manual suspension on a due-free subscriber is preserved.
      activated = due <= 0 && (charged || String(locked.status).toUpperCase() === 'EXPIRED');
      await client.query(
        `UPDATE subscribers SET expiry_date=$2, old_expiry_date=$3, current_due=$4::numeric,
           due_date=CASE WHEN $5::boolean THEN $2::date ELSE due_date END,
           status=CASE WHEN $5::boolean THEN 'ACTIVE' ELSE status END,
           suspension_stage=CASE WHEN $5::boolean THEN 'NONE' ELSE suspension_stage END,
           walled_garden=CASE WHEN $5::boolean THEN false ELSE walled_garden END,
           suspension_source=CASE WHEN $5::boolean THEN 'NONE' ELSE suspension_source END,
           suspension_reason=CASE WHEN $5::boolean THEN NULL ELSE suspension_reason END,
           grace_until=CASE WHEN $5::boolean THEN NULL ELSE grace_until END,
           updated_at=now() WHERE id=$1`,
        [subscriberId, newExpiry, oldExpiry, due, activated],
      );
      await client.query('COMMIT');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  if (raceCreatedExpired) return await activateCreatedExpired(subscriberId, { method: opts.method, note: opts.note });

  // Post-commit provisioning (external calls; never inside the money transaction).
  let reactivation: any = null;
  if (activated) {
    try { reactivation = await applyProvisioningState(subscriberId, { status: 'ACTIVE', stage: SUSPENSION_STAGES.NONE, walled_garden: false, reason: `Admin renewal ${payment_ref}`, sendCoa: true, coaAction: 'COA' }); }
    catch (e: any) { reactivation = { ok: false, error: e.message }; }
    try { await pool.query(`INSERT INTO billing_suspension_logs(subscriber_id, action, stage, reason, details, triggered_by) VALUES($1,'REACTIVATED','NONE',$2,$3::jsonb,'admin')`,
      [subscriberId, `Admin renewal ${payment_ref}`, JSON.stringify({ expire: extendLabel, old_expiry_date: oldExpiry, new_expiry_date: newExpiry, amount })]); } catch {}
  }

  if (charged && payment) {
    try { await pool.query(`INSERT INTO wallet_transactions(subscriber_id, type, amount, reference_id, reference_type, description, metadata) VALUES($1,'CREDIT',$2,$3,'PAYMENT',$4,$5::jsonb)`,
      [subscriberId, amount, payment_ref, `Renewal via ${method}`, JSON.stringify({ payment_ref, extend: extendLabel })]); } catch {}
    try {
      const exists = await pool.query(`SELECT 1 FROM finance_transactions WHERE reference_id=$1 LIMIT 1`, [payment_ref]).catch(() => ({ rows: [] as any[] }));
      if (!exists.rows?.length) {
        const methodUp = method.toUpperCase();
        const accCode = methodUp.includes('BANK') ? '1010' : (methodUp.match(/BKASH|NAGAD|ROCKET|MFS/) ? '1020' : '1000');
        const cashAccR = await pool.query('SELECT id FROM finance_accounts WHERE code=$1 LIMIT 1', [accCode]).catch(() => ({ rows: [] as any[] }));
        const revAccR = await pool.query("SELECT id FROM finance_accounts WHERE code='4000' LIMIT 1").catch(() => ({ rows: [] as any[] }));
        await pool.query(`INSERT INTO finance_transactions(txn_date,txn_type,method,amount,currency,reference_type,reference_id,subscriber_id,description,created_by)
          VALUES(CURRENT_DATE,'COLLECTION',$1,$2,'BDT','PAYMENT',$3,$4::uuid,$5,'system')`,
          [method, amount, payment_ref, subscriberId, `Payment ${payment_ref}`]).catch(() => {});
        const cashAcc = (cashAccR as any).rows[0]?.id, revAcc = (revAccR as any).rows[0]?.id;
        if (cashAcc && revAcc) {
          const je = await pool.query(`INSERT INTO finance_journal_entries(entry_no,entry_date,description,source_type,source_id,posted,created_by) VALUES($1,CURRENT_DATE,$2,'PAYMENT',$3,true,'system') RETURNING id`,
            [`JE-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`, `Payment ${payment_ref}`, payment_ref]).catch(() => ({ rows: [] as any[] }));
          const jid = (je as any).rows[0]?.id;
          if (jid) await pool.query(`INSERT INTO finance_journal_lines(entry_id,account_id,debit,credit,memo) VALUES($1,$2,$3,0,'cash/mfs'),($1,$4,0,$3,'revenue')`, [jid, cashAcc, amount, revAcc]).catch(() => {});
        }
      }
    } catch {}
    try { await auditLog({ action: 'PAYMENT_COMPLETED', entity_type: 'payment', entity_id: payment.id || payment_ref, details: { gateway: method, amount, subscriber_id: subscriberId, admin_renewal: true } }); } catch {}
    try {
      const s = (await pool.query('SELECT full_name, phone FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
      if (s?.phone) await trySendTemplateToSubscriber(subscriberId, 'payment_received_sms', { name: s.full_name, amount, invoice_number: null, paid: amount, due }, { channel_type: 'SMS' }).catch(() => {});
    } catch {}
  }

  const fresh = (await pool.query('SELECT * FROM subscribers WHERE id=$1', [subscriberId])).rows[0];
  return { ok: true, payment, reactivation, due, extend: extendLabel, old_expiry_date: oldExpiry, expiry_date: newExpiry, amount, method, subscriber: fresh };
}

export async function getBillingMetrics() {
  const tz = await getBusinessTimezone();
  const today = ymdInTimezone(new Date(), tz);
  const [counts, invAgg, payAgg, invCounts, captive] = await Promise.all([
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE status='ACTIVE')::int as active,
      COUNT(*) FILTER (WHERE status='SUSPENDED' OR suspension_stage IN ('ISOLATED','SUSPENDED'))::int as suspended,
      COUNT(*) FILTER (WHERE status='EXPIRED')::int as expired
      FROM subscribers`),
    pool.query(`SELECT COALESCE(SUM(total_amount),0)::numeric(12,2) as monthly_generated, COALESCE(SUM(due_amount),0)::numeric(12,2) as total_due FROM invoices WHERE to_char(COALESCE(issue_date, ($1::timestamptz AT TIME ZONE $2)::date),'YYYY-MM') = to_char($1::timestamptz AT TIME ZONE $2,'YYYY-MM')`, [new Date().toISOString(), tz]),
    pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE (COALESCE(verified_at, created_at) AT TIME ZONE $2)::date = $1::date),0)::numeric(12,2) as today, COALESCE(SUM(amount) FILTER (WHERE to_char(COALESCE(verified_at, created_at) AT TIME ZONE $2,'YYYY-MM') = to_char($1::timestamptz AT TIME ZONE $2,'YYYY-MM')),0)::numeric(12,2) as month FROM payments WHERE status='COMPLETED'`, [today, tz]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE status='OVERDUE')::int as overdue, COUNT(*) FILTER (WHERE status IN ('UNPAID','PARTIAL','OVERDUE'))::int as unpaid FROM invoices`),
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE suspension_stage='WALLED_GARDEN' AND walled_garden=true)::int as walled_garden,
      COUNT(*) FILTER (WHERE suspension_stage='WALLED_GARDEN' AND walled_garden=true AND current_due > 0)::int as walled_due,
      COUNT(*) FILTER (WHERE suspension_stage='WALLED_GARDEN' AND walled_garden=true AND current_due <= 0)::int as walled_validity
      FROM subscribers`),
  ]);
  return {
    activeSubscribers: Number(counts.rows[0]?.active || 0),
    suspendedDue: Number(counts.rows[0]?.suspended || 0),
    expiredThisMonth: Number(counts.rows[0]?.expired || 0),
    monthlyBillGenerated: Number(invAgg.rows[0]?.monthly_generated || 0),
    totalDueOutstanding: Number((await pool.query("SELECT COALESCE(SUM(due_amount),0)::numeric(12,2) as d FROM invoices WHERE status IN ('UNPAID','PARTIAL','OVERDUE')")).rows[0]?.d || 0),
    todayCollections: Number(payAgg.rows[0]?.today || 0),
    thisMonthCollections: Number(payAgg.rows[0]?.month || 0),
    overdueInvoices: Number(invCounts.rows[0]?.overdue || 0),
    unpaidInvoices: Number(invCounts.rows[0]?.unpaid || 0),
    captiveWalledGarden: Number(captive.rows[0]?.walled_garden || 0),
    captiveWalledDue: Number(captive.rows[0]?.walled_due || 0),
    captiveWalledValidity: Number(captive.rows[0]?.walled_validity || 0),
  };
}

/** Signed, expiring share token for public invoice PDF/HTML links. */
function shareSecret() {
  return process.env.INVOICE_SHARE_SECRET || process.env.JWT_SECRET || 'izandesk-dev-secret-change-me';
}
export function signInvoiceToken(invoiceId: string, ttlSeconds = 7 * 24 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${invoiceId}.${exp}`;
  const sig = crypto.createHmac('sha256', shareSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function verifyInvoiceToken(invoiceId: string, token?: string | null): boolean {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [id, exp, sig] = parts;
  if (id !== invoiceId || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', shareSecret()).update(`${id}.${exp}`).digest('base64url');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
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
  const today = await getBusinessDateYmd();
  await pool.query(`UPDATE invoices SET status='OVERDUE', updated_at=now() WHERE status IN ('UNPAID','PARTIAL') AND due_date < $1::date AND due_amount > 0`, [today]);
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
            const parentalProf = parentalProfileFor(sub, shouldFup ? fupMbps : null);
            if (parentalProf) {
              const speed = Math.max(1, Math.round(Number(fupMbps)||1));
              const rate = shouldFup && fupMbps ? `${speed}M/${speed}M` : undefined;
              await mikrotikEnsureParentalProfile(rr, { profileName: parentalProf, rateLimit: rate }).catch(()=>{});
              routerOk = await mikrotikSyncPppSecret(rr, { ...effective, profile_name: parentalProf, profile: parentalProf }).catch((e:any)=>({ ok:false, error: e.message }));
            } else if (shouldFup && fupMbps) {
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
    await withSchedulerRun('fup-enforcement-sweep', async () => {
      const locked = await tryAcquireSchedulerLock('fup-enforcement-sweep', 25 * 60 * 1000).catch(()=>false);
      if (!locked) return { skipped: 'lock' };
      const res = await runFupEnforcementSweep();
      if (res.applied || res.cleared) console.log(`[FUP] evaluated=${res.evaluated} applied=${res.applied} cleared=${res.cleared} skipped=${res.skipped}`);
      return res;
    });
  } catch (e:any) { console.error('[FUP] sweep failed', e.message); }
}

export function startBillingScheduler() {
  // BullMQ-backed recurring jobs when Redis is available, with DB-locked setInterval fallback.
  const run = async () => {
    try {
      await withSchedulerRun('billing-due-policy-sweep', async () => {
        const got = await tryAcquireSchedulerLock('billing-due-policy-sweep', 55_000).catch(()=>false);
        if (!got) return { skipped: 'lock' };
        await ensureOverdueInvoiceStatuses();
        await evaluateDuePolicies();
        return { ok: true };
      });
    } catch (e:any) { console.error('[BillingScheduler] error', e.message); }
  };
  const runMsg = async () => {
    try {
      await withSchedulerRun('messaging-sweep', async () => {
        const got = await tryAcquireSchedulerLock('messaging-sweep', 9 * 60 * 1000).catch(()=>false);
        if (!got) return { skipped: 'lock' };
        await runMessagingSchedulerSweep();
        return { ok: true };
      });
    } catch (e:any) { console.error('[MessagingScheduler] error', e.message); }
  };

  registerQueueHandler('billing', 'due-policy-sweep', run);
  registerQueueHandler('billing', 'fup-enforcement-sweep', runFup);
  registerQueueHandler('billing', 'reactivate-subscriber', async (job) => {
    const subId = String(job.data?.subscriberId || '');
    if (subId) return await reactivateSubscriber(subId, job.data?.reason || 'queued reactivation');
    return { skipped: true };
  });
  registerQueueHandler('billing', 'expire-subscriber', async (job) => {
    const subId = String(job.data?.subscriberId || '');
    if (!subId) return { skipped: true };
    // Expiry event: mark EXPIRED and enforce — for ROUTER-mode subscribers this
    // purges /ppp/active + /ppp/secret on the assigned MikroTik, for RADIUS mode
    // it disables the radcheck entry and sends a PoD (DISCONNECT) to the NAS.
    await pool.query(`UPDATE subscribers SET status='EXPIRED', suspension_stage=$2, walled_garden=false, suspension_reason=$3, suspension_source='POLICY', updated_at=now() WHERE id=$1`,
      [subId, SUSPENSION_STAGES.ISOLATED, String(job.data?.reason || 'Validity expired')]);
    return await applyProvisioningState(subId, { status: 'EXPIRED', stage: SUSPENSION_STAGES.ISOLATED, walled_garden: false, reason: String(job.data?.reason || 'Validity expired'), sendCoa: true, coaAction: 'DISCONNECT' });
  });
  registerQueueHandler('messaging', 'messaging-sweep', runMsg);

  if (isQueuesActive()) {
    void scheduleRecurringJob('billing', 'sched:due-policy-sweep', 'due-policy-sweep', 60 * 1000);
    void scheduleRecurringJob('billing', 'sched:fup-sweep', 'fup-enforcement-sweep', 30 * 60 * 1000);
    void scheduleRecurringJob('messaging', 'sched:messaging-sweep', 'messaging-sweep', 10 * 60 * 1000);
    return;
  }

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
  const payer = input.payer_number || input.sender || null;

  // Reuse the row for a retried transaction ID. The unique index below makes
  // this safe even when two forwarders deliver the same SMS concurrently.
  let ev: any = null;
  if (trxId) {
    const prior = await pool.query(`SELECT * FROM payment_sms_events WHERE gateway=$1 AND trx_id=$2 ORDER BY created_at DESC LIMIT 1`, [gateway, trxId]);
    const old = prior.rows[0];
    if (old && ['MATCHED', 'MATCH_FOUND'].includes(String(old.status))) {
      return { ok: true, duplicate: true, event: old, match: null, recorded: null };
    }
    if (old) {
      ev = (await pool.query(`UPDATE payment_sms_events SET sender=$2, message=$3, amount=$4, payer_number=$5, payload=$6::jsonb, status='RECEIVED', processed_at=NULL WHERE id=$1 RETURNING *`,
        [old.id, input.sender || payer, message || null, Number.isFinite(amount as any) ? amount : null, payer, JSON.stringify(input.payload || {})])).rows[0];
    }
  }
  if (!ev) {
    ev = (await pool.query(`INSERT INTO payment_sms_events(gateway,sender,message,trx_id,amount,payer_number,status,payload)
      VALUES($1,$2,$3,$4,$5,$6,'RECEIVED',$7::jsonb) RETURNING *`,
      [gateway, input.sender || payer, message || null, trxId, Number.isFinite(amount as any) ? amount : null, payer, JSON.stringify(input.payload || {})])).rows[0];
  }

  let match: any = null;
  let recorded: any = null;
  let reason: string | undefined;

  // Amount-only matching can pay any open invoice with the same amount, so it
  // is no longer used. An SMS must carry a transaction ID that binds it to a
  // checkout/payment already created by this system.
  if (!trxId) {
    reason = 'SMS event has no transaction id; it was stored for manual reconciliation only';
  } else {
    const byTrx = await pool.query(`SELECT * FROM payments WHERE gateway=$1 AND trx_id=$2 ORDER BY created_at DESC LIMIT 1`, [gateway, trxId]);
    const pending = byTrx.rows[0];
    if (pending && !['COMPLETED', 'CANCELLED', 'FAILED', 'REJECTED'].includes(String(pending.status).toUpperCase())) {
      match = { type: 'payment', payment: pending };
      const pendingAmount = Number(pending.amount || 0);
      const smsAmount = Number(ev.amount || pendingAmount);
      if (!(smsAmount > 0) || smsAmount > pendingAmount + 0.01) {
        match = null;
        reason = 'SMS amount does not match the pending payment';
      } else {
        recorded = await recordPaymentAndReactivate({
          gateway,
          amount: +Math.min(smsAmount, pendingAmount).toFixed(2),
          payment_ref: pending.payment_ref,
          invoice_id: pending.invoice_id,
          subscriber_id: pending.subscriber_id,
          trx_id: trxId,
          method: 'mfs_sms',
          payer_number: ev.payer_number || undefined,
          raw: { sms_event_id: ev.id, message },
          status: 'COMPLETED',
        });
      }
    } else {
      reason = pending ? 'The transaction has already been settled' : 'No pending payment matched this transaction id';
    }
  }

  const status = recorded?.ok ? 'MATCHED' : (match ? 'MATCH_FOUND' : 'UNMATCHED');
  const upd = await pool.query(`UPDATE payment_sms_events SET status=$2, matched_payment_ref=$3, matched_invoice_id=$4, processed_at=CASE WHEN $3 IS NOT NULL THEN now() ELSE processed_at END WHERE id=$1 RETURNING *`,
    [ev.id, status, recorded?.payment?.payment_ref || null, recorded?.invoice?.id || null]);
  return { ok: true, event: upd.rows[0], match, recorded, ...(reason ? { reason } : {}) };
}