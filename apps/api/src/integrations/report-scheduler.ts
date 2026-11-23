import { pool } from '../db';
import { dispatchMessage } from './messaging';
import { emitNocAlert } from './noc-alerts';

async function generateReport(key: string) {
  switch (String(key)) {
    case 'collections': {
      const r = await pool.query(`SELECT to_char(created_at::date,'YYYY-MM-DD') as period, COALESCE(gateway,'unknown') as gateway, COALESCE(SUM(amount),0)::numeric(14,2) as total, COUNT(*)::int as count FROM payments WHERE status='COMPLETED' AND created_at >= now() - interval '30 days' GROUP BY 1,2 ORDER BY 1 DESC`);
      return { key, rows: r.rows };
    }
    case 'dues-aging': {
      const r = await pool.query(`SELECT COUNT(*) FILTER (WHERE due_date >= CURRENT_DATE AND status IN ('UNPAID','PARTIAL'))::int as current_bucket, COALESCE(SUM(due_amount) FILTER (WHERE due_date >= CURRENT_DATE AND status IN ('UNPAID','PARTIAL')),0)::numeric(14,2) as current_amount, COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date BETWEEN 1 AND 30 AND status IN ('UNPAID','PARTIAL','OVERDUE'))::int as d1_30, COALESCE(SUM(due_amount) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date BETWEEN 1 AND 30 AND status IN ('UNPAID','PARTIAL','OVERDUE')),0)::numeric(14,2) as d1_30_amount, COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date BETWEEN 31 AND 60 AND status IN ('UNPAID','PARTIAL','OVERDUE'))::int as d31_60, COALESCE(SUM(due_amount) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date BETWEEN 31 AND 60 AND status IN ('UNPAID','PARTIAL','OVERDUE')),0)::numeric(14,2) as d31_60_amount, COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date > 60 AND status IN ('UNPAID','PARTIAL','OVERDUE'))::int as d60_plus, COALESCE(SUM(due_amount) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date > 60 AND status IN ('UNPAID','PARTIAL','OVERDUE')),0)::numeric(14,2) as d60_plus_amount FROM invoices`);
      return { key, rows: r.rows };
    }
    case 'profit-loss': {
      const r = await pool.query(`SELECT txn_type, COALESCE(method,'UNKNOWN') as method, COALESCE(SUM(amount),0)::numeric(14,2) as total, COUNT(*)::int as count FROM finance_transactions GROUP BY 1,2 ORDER BY 1,3 DESC`);
      const income = r.rows.filter((x:any)=>['INCOME','COLLECTION'].includes(x.txn_type)).reduce((s:number,x:any)=>s+Number(x.total||0),0);
      const expense = r.rows.filter((x:any)=>['EXPENSE','PAYMENT'].includes(x.txn_type)).reduce((s:number,x:any)=>s+Number(x.total||0),0);
      return { key, income, expense, net: income-expense, rows: r.rows };
    }
    case 'expenses': {
      const r = await pool.query(`SELECT COALESCE(reference_type,'MANUAL') as category, COALESCE(SUM(amount),0)::numeric(14,2) as total, COUNT(*)::int as count FROM finance_transactions WHERE txn_type IN ('EXPENSE','PAYMENT') GROUP BY 1 ORDER BY 2 DESC`);
      return { key, rows: r.rows };
    }
    case 'resellers': {
      const r = await pool.query(`SELECT r.id,r.name,r.code,r.status,r.wallet_balance, COUNT(s.id)::int as subscribers, COALESCE(SUM(p.amount) FILTER (WHERE p.status='COMPLETED'),0)::numeric(14,2) as collections FROM resellers r LEFT JOIN subscribers s ON s.reseller_id=r.id LEFT JOIN payments p ON p.subscriber_id=s.id GROUP BY r.id ORDER BY collections DESC NULLS LAST`);
      return { key, rows: r.rows };
    }
    case 'payroll': {
      const r = await pool.query('SELECT period_month,status,total_amount FROM hr_payroll_runs ORDER BY period_month DESC LIMIT 12');
      return { key, rows: r.rows };
    }
    case 'kyc-compliance': {
      const r = await pool.query(`SELECT d.status, COUNT(*)::int AS documents,
        COUNT(*) FILTER (WHERE d.expires_at IS NOT NULL AND d.expires_at <= CURRENT_DATE + 30)::int AS expiring_soon
        FROM kyc_documents d GROUP BY d.status ORDER BY d.status`);
      const profiles = await pool.query(`SELECT overall_status, COUNT(*)::int AS subscribers FROM subscriber_kyc_profiles GROUP BY overall_status`);
      return { key, rows: r.rows, profiles: profiles.rows };
    }
    default: return { key, rows: [], note: 'Unknown report key' };
  }
}

export function scheduleIntervalMinutes(s: any): number {
  const explicit = Number(s?.interval_minutes);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(5, Math.round(explicit));
  const cron = String(s?.schedule_cron || '').trim().toLowerCase();
  if (!cron) return 24 * 60;
  if (cron.includes('@hour')) return 60;
  if (cron.includes('@week')) return 7 * 24 * 60;
  if (cron.includes('@day')) return 24 * 60;
  const m = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m) return Math.max(5, Number(m[1]));
  if (/^0\s+\*\s+\*\s+\*\s+\*$/.test(cron)) return 60;
  if (/^\d{1,2}\s+\d{1,2}\s+\*\s+\*\s+\*$/.test(cron)) return 24 * 60;
  return 24 * 60; // legacy fallback
}

function dueToRun(s: any, now = Date.now()) {
  if (s.enabled === false) return false;
  const last = s.last_run_at ? new Date(s.last_run_at).getTime() : 0;
  return !last || (now - last) >= scheduleIntervalMinutes(s) * 60 * 1000;
}

export async function runReportSchedulesOnce(){
  const rs = await pool.query('SELECT * FROM report_schedules WHERE enabled=true ORDER BY created_at ASC').catch(()=>({rows:[]}));
  let ran=0, delivered=0, failed=0;
  for(const s of rs.rows){
    if(!dueToRun(s)) continue;
    // Atomic claim: with more than one API process, only one may run a due
    // schedule. last_run_at is claimed before work so a crash cannot cause a
    // duplicate send on the next tick.
    const threshold = new Date(Date.now() - scheduleIntervalMinutes(s) * 60 * 1000).toISOString();
    const claim = await pool.query(
      `UPDATE report_schedules SET last_run_at=now(), last_status='RUNNING' WHERE id=$1 AND (last_run_at IS NULL OR last_run_at < $2::timestamptz) RETURNING id`,
      [s.id, threshold]
    ).catch(()=>({rowCount:0}));
    if(!claim.rowCount) continue;
    try {
      const data = await generateReport(s.report_key);
      const summary = JSON.stringify(data).slice(0, 3500);
      const recipients: any[] = Array.isArray(s.recipients) ? s.recipients : [];
      let sent=0, errors=0;
      for(const rcpt of recipients){
        try {
          const out = await dispatchMessage({ channel_type: rcpt.channel_type, provider: rcpt.provider, to: rcpt.to || rcpt.chat_id || rcpt, subject: `Scheduled report: ${s.name}`, body: `Report ${s.name} (${s.report_key})\n${summary}`, related_type:'REPORT_SCHEDULE', related_id: String(s.id), requireEnabled:false });
          if(out?.ok) sent++; else errors++;
        } catch { errors++; }
      }
      delivered += sent; failed += errors;
      // Reflect the real delivery outcome rather than marking OK before sending.
      const status = recipients.length === 0 ? 'NO_RECIPIENTS' : errors ? `PARTIAL:${errors}` : 'OK';
      await pool.query(`UPDATE report_schedules SET last_status=$2 WHERE id=$1`, [s.id, status]).catch(()=>{});
      ran++;
    } catch(e:any){
      await pool.query(`UPDATE report_schedules SET last_status=$2 WHERE id=$1`, [s.id, `ERROR:${String(e.message).slice(0,120)}`]).catch(()=>{});
      await emitNocAlert({ severity: 'WARNING', source: 'REPORT', title: `Report schedule failed: ${s.name || s.id}`, message: String(e.message || e).slice(0, 300), details: { schedule_id: s.id, report_key: s.report_key } }).catch(() => {});
    }
  }
  return { ran, delivered, failed };
}

export function startReportScheduler(){
  const tick = async ()=>{ try { const r=await runReportSchedulesOnce(); if(r.ran) console.log(`[ReportScheduler] ran ${r.ran} schedule(s)`); } catch(e:any){ console.error('[ReportScheduler] error', e.message); } };
  setTimeout(tick, 30*1000);
  setInterval(tick, 10*60*1000);
}
