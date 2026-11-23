'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, downloadAuthenticatedFile } from '@/lib/api';
import { RefreshCw, BarChart3, Download, Users, Wallet, CreditCard, Ticket, Store } from 'lucide-react';

function money(v: any) { const n = Number(v || 0); return `৳${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

export default function ReportsPage() {
  const { token } = useAuth();
  const [overview, setOverview] = useState<any>(null);
  const [collections, setCollections] = useState<any[]>([]);
  const [aging, setAging] = useState<any>(null);
  const [resellers, setResellers] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [pnl, setPnl] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any>(null);
  const [invAssets, setInvAssets] = useState<any>(null);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [sched, setSched] = useState<any>({ name:'Daily Collections', report_key:'collections', format:'CSV', interval_minutes: 1440 });
  const searchParams = useSearchParams();

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#','') : '';
    const view = String(searchParams?.get('view') || hash || '').toLowerCase();
    if (!view) return;
    const id = view === 'dues' || view === 'due-analytics' ? 'dues-aging' : view === 'collections' ? 'collections-report' : view;
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }, [searchParams, loading]);

  const load = useCallback(async () => {
    if (!token) return; setLoading(true); setErr(null);
    try {
      const [o,c,a,r,t,p,e,pr,ia,sc] = await Promise.all([
        apiFetch<any>('/api/reports/overview', {}, token),
        apiFetch<any>('/api/reports/collections', {}, token),
        apiFetch<any>('/api/reports/dues-aging', {}, token),
        apiFetch<any>('/api/reports/resellers', {}, token),
        apiFetch<any>('/api/reports/tickets-sla', {}, token),
        apiFetch<any>('/api/reports/profit-loss', {}, token).catch(()=>({data:null})),
        apiFetch<any>('/api/reports/expenses', {}, token).catch(()=>({data:[]})),
        apiFetch<any>('/api/reports/payroll', {}, token).catch(()=>({data:null})),
        apiFetch<any>('/api/reports/inventory-assets', {}, token).catch(()=>({data:null})),
        apiFetch<any>('/api/reports/schedules', {}, token).catch(()=>({data:[]})),
      ]);
      setOverview(o.data||null); setCollections(c.data||[]); setAging(a.data||null); setResellers(r.data||[]); setTickets(t.data||[]);
      setPnl(p.data||null); setExpenses(e.data||[]); setPayroll(pr.data||null); setInvAssets(ia.data||null); setSchedules(sc.data||[]);
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token]);
  useEffect(()=>{ load(); }, [load]);

  const exportJson = (name:string, data:any) => { const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=`${name}.json`; a.click(); URL.revokeObjectURL(url); };
  const dlCsv = async (path:string, name:string) => {
    try { await downloadAuthenticatedFile(`${path}?format=csv`, name, token); }
    catch (e:any) { setErr(e.message); }
  };
  const createSchedule = async () => { if(!token) return; try { await apiFetch('/api/reports/schedules', { method:'POST', body: JSON.stringify(sched) }, token); await load(); } catch(e:any){ setErr(e.message);} };

  const ov = overview || {};
  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Business intelligence · Reporting</span>
          <h1 className="page-title"><BarChart3 className="w-6 h-6 text-primary"/>Reports &amp; Analytics</h1>
          <p className="page-subtitle">Operational and financial reports, exports and scheduled delivery.</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
          <button onClick={()=>dlCsv('/api/reports/collections','collections.csv')} className="btn btn-outline"><Download className="w-4 h-4"/>Collections</button>
          <button onClick={()=>dlCsv('/api/reports/dues-aging','dues-aging.csv')} className="btn btn-outline"><Download className="w-4 h-4"/>Aging</button>
          <button onClick={()=>dlCsv('/api/reports/profit-loss','profit-loss.csv')} className="btn btn-outline"><Download className="w-4 h-4"/>P&amp;L</button>
          <button onClick={()=>exportJson('reports-overview', overview)} className="btn btn-outline btn-icon" title="Export overview as JSON"><Download className="w-4 h-4"/></button>
        </div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}

      <div className="stat-grid-5">
        <Kpi label="Subscribers" value={ov.subscribers?.total||0} sub={`${ov.subscribers?.active||0} active`} tone="primary" icon={Users} />
        <Kpi label="Outstanding" value={money(ov.invoices?.outstanding||0)} sub={`${ov.invoices?.due_count||0} due invoices`} tone="warning" icon={Wallet} />
        <Kpi label="Today's Collection" value={money(ov.collections?.today||0)} sub={`Month ${money(ov.collections?.month||0)}`} tone="success" icon={CreditCard} />
        <Kpi label="Open Tickets" value={ov.tickets?.open||0} sub={`${ov.tickets?.breached||0} SLA breached`} tone="danger" icon={Ticket} />
        <Kpi label="Resellers" value={ov.resellers?.total||0} sub={`Wallet ${money(ov.resellers?.wallet_total||0)}`} tone="purple" icon={Store} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title={`Profit & Loss (Net ${money(pnl?.net||0)})`}>
          <div className="grid grid-cols-3 gap-2.5 mb-3">
            <div className="px-3 py-2.5 rounded-lg bg-success/10 border border-success/15"><div className="text-[9px] font-bold uppercase tracking-[0.1em] text-success">Income</div><div className="font-bold text-[13px] tabular-nums mt-1">{money(pnl?.income||0)}</div></div>
            <div className="px-3 py-2.5 rounded-lg bg-danger/10 border border-danger/15"><div className="text-[9px] font-bold uppercase tracking-[0.1em] text-danger">Expense</div><div className="font-bold text-[13px] tabular-nums mt-1">{money(pnl?.expense||0)}</div></div>
            <div className="px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/15"><div className="text-[9px] font-bold uppercase tracking-[0.1em] text-primary">Net</div><div className="font-bold text-[13px] tabular-nums mt-1">{money(pnl?.net||0)}</div></div>
          </div>
          <Table cols={['Type','Method','Count','Total']} rows={(pnl?.breakdown||[]).map((r:any)=>[r.txn_type,r.method,r.count,money(r.total)])} empty="No finance data." />
        </Panel>
        <Panel title="Dues Aging" id="dues-aging">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Bucket label="Current" count={aging?.current_bucket||0} amount={aging?.current_amount} />
            <Bucket label="1-30 days" count={aging?.d1_30||0} amount={aging?.d1_30_amount} />
            <Bucket label="31-60 days" count={aging?.d31_60||0} amount={aging?.d31_60_amount} />
            <Bucket label="> 60 days" count={aging?.d60_plus||0} amount={aging?.d60_plus_amount} />
          </div>
        </Panel>
        <Panel title="Collections (by period & gateway)" id="collections-report">
          <Table cols={['Period','Gateway','Count','Total']} rows={collections.map((r:any)=>[r.period,r.gateway,r.count,money(r.total)])} empty="No collection data." />
        </Panel>
        <Panel title="Expense Breakdown">
          <Table cols={['Category','Count','Total']} rows={expenses.map((r:any)=>[r.category,r.count,money(r.total)])} empty="No expenses recorded." />
        </Panel>
        <Panel title="Reseller Performance">
          <Table cols={['Reseller','Subscribers','Collections','Wallet']} rows={resellers.map((r:any)=>[`${r.name} (${r.code})`,r.subscribers,money(r.collections),money(r.wallet_balance)])} empty="No reseller data." />
        </Panel>
        <Panel title="Tickets & SLA / Payroll / Assets">
          <div className="space-y-3 text-sm">
            <div><div className="font-semibold mb-1">Tickets</div><Table cols={['Priority','Status','Count','Breached']} rows={tickets.map((r:any)=>[r.priority,r.status,r.count,r.breached])} empty="No ticket data." /></div>
            <div className="grid grid-cols-2 gap-3"><div className="p-3 rounded-xl border border-border"><div className="text-xs text-muted-foreground">Payroll (posted/paid)</div><div className="font-bold">{money(payroll?.totals?.total_paid||0)}</div><div className="text-xs text-muted-foreground">{payroll?.totals?.runs||0} runs</div></div><div className="p-3 rounded-xl border border-border"><div className="text-xs text-muted-foreground">Asset records</div><div className="font-bold">{(invAssets?.assets||[]).reduce((s:number,x:any)=>s+Number(x.count||0),0)}</div><div className="text-xs text-muted-foreground">Inv categories {(invAssets?.inventory||[]).length}</div></div></div>
          </div>
        </Panel>
      </div>

      <div className="card p-4">
        <h2 className="card-title mb-3">Report Schedules (delivery hook)</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 table-wrap overflow-auto max-h-[220px]"><Table cols={['Name','Report','Format','Interval','Enabled']} rows={schedules.map((s:any)=>[s.name,s.report_key,s.format,s.interval_minutes ? `${s.interval_minutes} min` : (s.schedule_cron || '-'),s.enabled?'Yes':'No'])} empty="No schedules configured." /></div>
          <div className="space-y-2 text-sm"><input className="form-control" placeholder="Schedule name" value={sched.name} onChange={e=>setSched({...sched,name:e.target.value})} /><select className="form-select" value={sched.report_key} onChange={e=>setSched({...sched,report_key:e.target.value})}>{['collections','dues-aging','profit-loss','expenses','resellers','payroll','kyc-compliance'].map(x=><option key={x} value={x}>{x}</option>)}</select><input className="form-control" type="number" min={5} step={5} placeholder="Interval (minutes)" value={sched.interval_minutes} onChange={e=>setSched({...sched,interval_minutes:Number(e.target.value||0)})} /><button onClick={createSchedule} className="btn btn-primary w-full">Save Schedule</button><div className="text-xs text-muted-foreground">Schedules run by interval (minutes). Existing legacy cron values are still read for compatibility.</div></div>
        </div>
      </div>
    </div>
  );
}

function Kpi({label,value,sub,tone='primary',icon:Icon}:any){ return <div className={`dash-stat dash-stat-${tone}`}><span className="dash-stat-icon"><Icon /></span><span className="dash-stat-body"><span className="dash-stat-label">{label}</span><span className="dash-stat-value">{value}</span>{sub && <span className="dash-stat-hint">{sub}</span>}</span></div>; }
function Bucket({label,count,amount}:any){ return <div className="card card-body-sm"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-bold">{count}</div><div className="text-xs text-muted-foreground">{money(amount)}</div></div>; }
function Panel({title,children,id}:any){ return <div id={id} className="card p-4 scroll-mt-24"><h2 className="card-title mb-3">{title}</h2><div className="table-wrap overflow-auto max-h-[300px]">{children}</div></div>; }
function Table({cols,rows,empty}:any){ return <table className="table table-hover"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border">{cols.map((c:string)=><th key={c} className="text-left py-2 px-2">{c}</th>)}</tr></thead><tbody>{(rows||[]).map((r:any,i:number)=>(<tr key={i} className="border-b border-border/50">{r.map((c:any,j:number)=><td key={j} className="py-2 px-2">{c}</td>)}</tr>))}{!(rows||[]).length && <tr><td colSpan={cols.length} className="py-6 text-center text-muted-foreground">{empty||'No data.'}</td></tr>}</tbody></table>; }
