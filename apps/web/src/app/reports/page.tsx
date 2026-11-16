'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { RefreshCw, BarChart3, Download } from 'lucide-react';

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
  const [sched, setSched] = useState<any>({ name:'Daily Collections', report_key:'collections', format:'CSV', schedule_cron:'0 23 * * *' });
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
  const dlCsv = (path:string, name:string) => { const base=getApiBaseUrl(); const a=document.createElement('a'); a.href=`${base}${path}?format=csv`; a.download=name; a.click(); };
  const createSchedule = async () => { if(!token) return; try { await apiFetch('/api/reports/schedules', { method:'POST', body: JSON.stringify(sched) }, token); await load(); } catch(e:any){ setErr(e.message);} };

  const ov = overview || {};
  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><BarChart3 className="w-6 h-6 text-primary"/>Reports & Analytics</h1><p className="text-sm text-muted-foreground">Operational/financial reports, exports, and report schedules (Phase 7).</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=>dlCsv('/api/reports/collections','collections.csv')} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Download className="w-4 h-4"/>Collections CSV</button>
          <button onClick={()=>dlCsv('/api/reports/dues-aging','dues-aging.csv')} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Download className="w-4 h-4"/>Aging CSV</button>
          <button onClick={()=>dlCsv('/api/reports/profit-loss','profit-loss.csv')} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Download className="w-4 h-4"/>P&L CSV</button>
          <button onClick={()=>exportJson('reports-overview', overview)} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Download className="w-4 h-4"/>JSON</button>
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
        </div>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <Kpi label="Subscribers" value={ov.subscribers?.total||0} sub={`${ov.subscribers?.active||0} active`} />
        <Kpi label="Outstanding" value={money(ov.invoices?.outstanding||0)} sub={`${ov.invoices?.due_count||0} due invoices`} />
        <Kpi label="Today's Collection" value={money(ov.collections?.today||0)} sub={`Month ${money(ov.collections?.month||0)}`} />
        <Kpi label="Open Tickets" value={ov.tickets?.open||0} sub={`${ov.tickets?.breached||0} SLA breached`} />
        <Kpi label="Resellers" value={ov.resellers?.total||0} sub={`Wallet ${money(ov.resellers?.wallet_total||0)}`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Panel title={`Profit & Loss (Net ${money(pnl?.net||0)})`}>
          <div className="grid grid-cols-3 gap-3 mb-3 text-sm"><div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20"><div className="text-xs text-muted-foreground">Income</div><div className="font-bold">{money(pnl?.income||0)}</div></div><div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20"><div className="text-xs text-muted-foreground">Expense</div><div className="font-bold">{money(pnl?.expense||0)}</div></div><div className="p-3 rounded-xl bg-primary/10 border border-primary/20"><div className="text-xs text-muted-foreground">Net</div><div className="font-bold">{money(pnl?.net||0)}</div></div></div>
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

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-bold mb-3">Report Schedules (delivery hook)</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 overflow-auto max-h-[220px]"><Table cols={['Name','Report','Format','Cron','Enabled']} rows={schedules.map((s:any)=>[s.name,s.report_key,s.format,s.schedule_cron||'-',s.enabled?'Yes':'No'])} empty="No schedules configured." /></div>
          <div className="space-y-2 text-sm"><input className="w-full p-2.5 rounded-xl border border-border bg-card" placeholder="Schedule name" value={sched.name} onChange={e=>setSched({...sched,name:e.target.value})} /><select className="w-full p-2.5 rounded-xl border border-border bg-card" value={sched.report_key} onChange={e=>setSched({...sched,report_key:e.target.value})}>{['collections','dues-aging','profit-loss','expenses','resellers','payroll'].map(x=><option key={x} value={x}>{x}</option>)}</select><input className="w-full p-2.5 rounded-xl border border-border bg-card" placeholder="Cron (e.g. 0 23 * * *)" value={sched.schedule_cron} onChange={e=>setSched({...sched,schedule_cron:e.target.value})} /><button onClick={createSchedule} className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold">Save Schedule</button><div className="text-xs text-muted-foreground">Schedules are stored for report generation/delivery; connect a cron/worker and email/messaging channel to auto-deliver outputs.</div></div>
        </div>
      </div>
    </div>
  );
}

function Kpi({label,value,sub}:any){ return <div className="p-4 rounded-2xl border border-border bg-card"><div className="text-xs text-muted-foreground mb-1">{label}</div><div className="text-xl font-black">{value}</div>{sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}</div>; }
function Bucket({label,count,amount}:any){ return <div className="p-3 rounded-xl border border-border bg-muted/20"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-bold">{count}</div><div className="text-xs text-muted-foreground">{money(amount)}</div></div>; }
function Panel({title,children,id}:any){ return <div id={id} className="rounded-2xl border border-border bg-card p-4 scroll-mt-24"><h2 className="font-bold mb-3">{title}</h2><div className="overflow-auto max-h-[300px]">{children}</div></div>; }
function Table({cols,rows,empty}:any){ return <table className="w-full text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border">{cols.map((c:string)=><th key={c} className="text-left py-2 px-2">{c}</th>)}</tr></thead><tbody>{(rows||[]).map((r:any,i:number)=>(<tr key={i} className="border-b border-border/50">{r.map((c:any,j:number)=><td key={j} className="py-2 px-2">{c}</td>)}</tr>))}{!(rows||[]).length && <tr><td colSpan={cols.length} className="py-6 text-center text-muted-foreground">{empty||'No data.'}</td></tr>}</tbody></table>; }
