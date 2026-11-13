import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';

const router: Router = Router();
function guard(req:any,res:any){ if(!['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER','RESELLER'].includes(String((req as any).user?.role||''))){ res.status(403).json({message:'Forbidden'}); return false;} return true; }
function toCsv(rows:any[], cols?:string[]){
  const keys = cols || Object.keys(rows[0]||{});
  const esc=(v:any)=>{ const s=v==null?'':(typeof v==='object'?JSON.stringify(v):String(v)); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  return [keys.join(','), ...rows.map(r=>keys.map(c=>esc(r[c])).join(','))].join('\n');
}

router.get('/overview', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const [subs, inv, pay, tickets, resellers] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='ACTIVE')::int active, COUNT(*) FILTER (WHERE status='SUSPENDED')::int suspended, COUNT(*) FILTER (WHERE status='PENDING')::int pending, COALESCE(SUM(balance),0)::numeric(14,2) as total_due FROM subscribers`),
    pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status IN ('UNPAID','PARTIAL','OVERDUE'))::int due_count, COALESCE(SUM(due_amount) FILTER (WHERE status IN ('UNPAID','PARTIAL','OVERDUE')),0)::numeric(14,2) outstanding, COALESCE(SUM(total_amount),0)::numeric(14,2) billed FROM invoices`).catch(()=>({rows:[{}]})),
    pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE status='COMPLETED' AND created_at::date=CURRENT_DATE),0)::numeric(14,2) today, COALESCE(SUM(amount) FILTER (WHERE status='COMPLETED' AND date_trunc('month',created_at)=date_trunc('month',now())),0)::numeric(14,2) month FROM payments`).catch(()=>({rows:[{}]})),
    pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED'))::int open, COUNT(*) FILTER (WHERE sla_breached=true)::int breached FROM tickets`).catch(()=>({rows:[{}]})),
    pool.query(`SELECT COUNT(*)::int total, COALESCE(SUM(wallet_balance),0)::numeric(14,2) wallet_total FROM resellers`).catch(()=>({rows:[{}]})),
  ]);
  res.json({ ok:true, data:{ subscribers:subs.rows[0], invoices:inv.rows[0], collections:pay.rows[0], tickets:tickets.rows[0], resellers:resellers.rows[0] } });
}));

router.get('/collections', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const { from,to,group='day' } = req.query as any;
  const where:string[]=["status='COMPLETED'"]; const params:any[]=[];
  if(from){ params.push(from); where.push(`created_at::date >= $${params.length}::date`); }
  if(to){ params.push(to); where.push(`created_at::date <= $${params.length}::date`); }
  const fmt = group==='month' ? "to_char(date_trunc('month',created_at),'YYYY-MM')" : "to_char(created_at::date,'YYYY-MM-DD')";
  const r=await pool.query(`SELECT ${fmt} as period, COALESCE(SUM(amount),0)::numeric(14,2) as total, COUNT(*)::int as count, COALESCE(gateway,'unknown') as gateway FROM payments WHERE ${where.join(' AND ')} GROUP BY period,gateway ORDER BY period DESC, gateway`, params);
  if (String(req.query.format||'').toLowerCase()==='csv') { res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="collections.csv"'); return res.send(toCsv(r.rows)); }
  res.json({ok:true,data:r.rows});
}));

router.get('/dues-aging', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const r=await pool.query(`
    SELECT COUNT(*) FILTER (WHERE due_date >= CURRENT_DATE AND status IN ('UNPAID','PARTIAL'))::int as current_bucket,
      COALESCE(SUM(due_amount) FILTER (WHERE due_date >= CURRENT_DATE AND status IN ('UNPAID','PARTIAL')),0)::numeric(14,2) as current_amount,
      COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date BETWEEN 1 AND 30 AND status IN ('UNPAID','PARTIAL','OVERDUE'))::int as d1_30,
      COALESCE(SUM(due_amount) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date BETWEEN 1 AND 30 AND status IN ('UNPAID','PARTIAL','OVERDUE')),0)::numeric(14,2) as d1_30_amount,
      COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date BETWEEN 31 AND 60 AND status IN ('UNPAID','PARTIAL','OVERDUE'))::int as d31_60,
      COALESCE(SUM(due_amount) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date BETWEEN 31 AND 60 AND status IN ('UNPAID','PARTIAL','OVERDUE')),0)::numeric(14,2) as d31_60_amount,
      COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date > 60 AND status IN ('UNPAID','PARTIAL','OVERDUE'))::int as d60_plus,
      COALESCE(SUM(due_amount) FILTER (WHERE due_date < CURRENT_DATE AND CURRENT_DATE - due_date > 60 AND status IN ('UNPAID','PARTIAL','OVERDUE')),0)::numeric(14,2) as d60_plus_amount
    FROM invoices`);
  if (String(req.query.format||'').toLowerCase()==='csv') { res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="dues-aging.csv"'); return res.send(toCsv(r.rows)); }
  res.json({ok:true,data:r.rows[0]});
}));

router.get('/profit-loss', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const { from,to } = req.query as any; const where:string[]=[]; const params:any[]=[];
  if(from){ params.push(from); where.push(`txn_date >= $${params.length}::date`); }
  if(to){ params.push(to); where.push(`txn_date <= $${params.length}::date`); }
  const sql=where.length?`WHERE ${where.join(' AND ')}`:'';
  const r=await pool.query(`SELECT txn_type, COALESCE(method,'UNKNOWN') as method, COALESCE(SUM(amount),0)::numeric(14,2) as total, COUNT(*)::int as count FROM finance_transactions ${sql} GROUP BY txn_type,method ORDER BY txn_type, total DESC`, params);
  const income = r.rows.filter((x:any)=>['INCOME','COLLECTION'].includes(x.txn_type)).reduce((s:number,x:any)=>s+Number(x.total||0),0);
  const expense = r.rows.filter((x:any)=>['EXPENSE','PAYMENT'].includes(x.txn_type)).reduce((s:number,x:any)=>s+Number(x.total||0),0);
  const data = { income, expense, net: income-expense, breakdown:r.rows };
  if (String(req.query.format||'').toLowerCase()==='csv') { res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="profit-loss.csv"'); return res.send(toCsv(r.rows)); }
  res.json({ok:true,data});
}));

router.get('/expenses', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const r=await pool.query(`SELECT COALESCE(reference_type,'MANUAL') as category, COALESCE(SUM(amount),0)::numeric(14,2) as total, COUNT(*)::int as count FROM finance_transactions WHERE txn_type IN ('EXPENSE','PAYMENT') GROUP BY 1 ORDER BY total DESC`);
  if (String(req.query.format||'').toLowerCase()==='csv') { res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="expenses.csv"'); return res.send(toCsv(r.rows)); }
  res.json({ok:true,data:r.rows});
}));

router.get('/resellers', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const r=await pool.query(`SELECT r.id,r.name,r.code,r.status,r.wallet_balance,r.commission_percent, COUNT(s.id)::int as subscribers,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status='COMPLETED'),0)::numeric(14,2) as collections
    FROM resellers r LEFT JOIN subscribers s ON s.reseller_id=r.id LEFT JOIN payments p ON p.subscriber_id=s.id
    GROUP BY r.id ORDER BY collections DESC NULLS LAST, r.name`).catch(()=>({rows:[]}));
  if (String(req.query.format||'').toLowerCase()==='csv') { res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="resellers.csv"'); return res.send(toCsv(r.rows)); }
  res.json({ok:true,data:r.rows});
}));

router.get('/tickets-sla', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const r=await pool.query(`SELECT priority, status, COUNT(*)::int as count, COUNT(*) FILTER (WHERE sla_breached=true)::int as breached FROM tickets GROUP BY priority,status ORDER BY priority,status`).catch(()=>({rows:[]}));
  res.json({ok:true,data:r.rows});
}));

router.get('/payroll', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const runs=await pool.query('SELECT * FROM hr_payroll_runs ORDER BY period_month DESC LIMIT 24');
  const totals=await pool.query(`SELECT COALESCE(SUM(total_amount),0)::numeric(14,2) as total_paid, COUNT(*)::int as runs FROM hr_payroll_runs WHERE status IN ('POSTED','PAID')`);
  res.json({ok:true,data:{ runs:runs.rows, totals: totals.rows[0] }});
}));

router.get('/inventory-assets', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const [inv, assets] = await Promise.all([
    pool.query(`SELECT category, COUNT(*)::int items, COALESCE(SUM(stock_qty),0)::numeric(14,2) qty FROM inventory_items GROUP BY category`).catch(()=>({rows:[]})),
    pool.query(`SELECT status, COUNT(*)::int count, COALESCE(SUM(cost),0)::numeric(14,2) cost, COALESCE(SUM(current_value),0)::numeric(14,2) value FROM assets GROUP BY status`).catch(()=>({rows:[]})),
  ]);
  res.json({ok:true,data:{ inventory:inv.rows, assets:assets.rows }});
}));

// Schedules (list/create) - execution hook; integrate with cron/worker for delivery
router.get('/schedules', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return;
  const r=await pool.query('SELECT * FROM report_schedules ORDER BY created_at DESC').catch(()=>({rows:[]}));
  res.json({ok:true,data:r.rows});
}));
router.post('/schedules', asyncHandler(async (req,res)=>{
  if(!guard(req,res)) return; const b=req.body||{}; if(!b.name||!b.report_key) return res.status(400).json({message:'name and report_key required'});
  const r=await pool.query(`INSERT INTO report_schedules(name,report_key,format,schedule_cron,recipients,enabled,config) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb) RETURNING *`,
    [b.name,b.report_key,b.format||'CSV',b.schedule_cron||null,JSON.stringify(b.recipients||[]),b.enabled!==false,JSON.stringify(b.config||{})]).catch((e:any)=>({rows:[],error:e}));
  if((r as any).error) return res.status(500).json({message:(r as any).error.message});
  res.status(201).json({ok:true,data:r.rows[0]});
}));

export default router;
