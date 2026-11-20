'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, FileText, PlusCircle, Play, AlertTriangle, ShieldAlert, CheckCircle2, CreditCard, Wallet, Send, RotateCcw, Ban, Clock3 } from 'lucide-react';

type AnyObj = Record<string, any>;

function money(v: any, cur = '৳') {
  const n = Number(v || 0);
  return `${cur}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(v: any) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function BillingPage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [metrics, setMetrics] = useState<AnyObj | null>(null);
  const [invoices, setInvoices] = useState<AnyObj[]>([]);
  const [payments, setPayments] = useState<AnyObj[]>([]);
  const [subscribers, setSubscribers] = useState<AnyObj[]>([]);
  const [gateways, setGateways] = useState<AnyObj[]>([]);
  const [gatewayPlugins, setGatewayPlugins] = useState<AnyObj[]>([]);
  const [policies, setPolicies] = useState<AnyObj[]>([]);
  const [logs, setLogs] = useState<AnyObj[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [cycleDate, setCycleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payForm, setPayForm] = useState({ invoice_id: '', gateway: 'bkash', amount: '' });
  const [invoiceFilter, setInvoiceFilter] = useState<string>('ALL');
  const [paymentsTodayOnly, setPaymentsTodayOnly] = useState(false);

  useEffect(() => {
    const s = String(searchParams?.get('status') || '').toUpperCase();
    if (!s) return;
    if (s === 'UNPAID' || s === 'DUE') setInvoiceFilter('UNPAID');
    else if (['PAID','OVERDUE','PARTIAL','PENDING','ALL'].includes(s)) setInvoiceFilter(s);
  }, [searchParams]);

  useEffect(() => {
    const view = String(searchParams?.get('view') || '').toLowerCase();
    if (view === 'payments' || view === 'collections') {
      setPaymentsTodayOnly(view === 'collections');
      setTimeout(() => document.getElementById('billing-payments')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } else if (view === 'invoices') {
      setTimeout(() => document.getElementById('billing-invoices')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } else if (view === 'due' || view === 'suspension') {
      setTimeout(() => document.getElementById('billing-due')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [m, inv, pays, subs, gws, pol, lg] = await Promise.all([
        apiFetch<any>('/api/billing/metrics', {}, token),
        apiFetch<any>('/api/billing/invoices', {}, token),
        apiFetch<any>('/api/billing/payments', {}, token),
        apiFetch<any>('/api/subscribers?limit=200', {}, token),
        apiFetch<any>('/api/billing/gateways', {}, token),
        apiFetch<any>('/api/billing/policies', {}, token),
        apiFetch<any>('/api/billing/suspension/logs', {}, token),
      ]);
      setMetrics(m.metrics || null);
      setInvoices(inv.data || []);
      setPayments(pays.data || []);
      setSubscribers(subs.data || []);
      setGateways(gws.data || []);
      setGatewayPlugins(gws.plugins || []);
      setPolicies(pol.data || []);
      setLogs(lg.data || []);
      if (!payForm.invoice_id && (inv.data || []).length) {
        const first = (inv.data || []).find((i:any)=>Number(i.due_amount||0)>0) || inv.data[0];
        if (first) setPayForm(f => ({ ...f, invoice_id: first.id, amount: String(first.due_amount || first.total_amount || '') }));
      }
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const runBatch = async () => {
    if (!token) return; setWorking('batch'); setError(null); setMsg(null);
    try {
      const r = await apiFetch<any>('/api/billing/invoices/generate', { method: 'POST', body: JSON.stringify({ cycle_date: cycleDate }) }, token);
      setMsg(`Batch billing complete: generated ${r.generated || 0}, skipped ${r.skipped || 0}, failed ${r.failed || 0} (cycle ${r.cycle || cycleDate.slice(0,7)}).`);
      await load();
    } catch (e:any) { setError(e.message); } finally { setWorking(null); }
  };

  const evaluate = async () => {
    if (!token) return; setWorking('eval'); setError(null); setMsg(null);
    try {
      const r = await apiFetch<any>('/api/billing/suspension/evaluate', { method: 'POST', body: JSON.stringify({}) }, token);
      setMsg(`Due policy evaluated: ${r.evaluated || 0} subscribers checked, ${ (r.actions||[]).length } state/action updates applied.`);
      await load();
    } catch (e:any) { setError(e.message); } finally { setWorking(null); }
  };

  const suspendSubscriber = async (id: string) => {
    if (!token) return; setWorking('suspend-'+id); setError(null); setMsg(null);
    try {
      await apiFetch<any>(`/api/billing/subscribers/${id}/suspend`, { method: 'POST', body: JSON.stringify({ walled_garden: true, reason: 'Manual suspension (billing)' }) }, token);
      setMsg('Subscriber suspended/isolated and enforcement applied (PPP/RADIUS/CoA where available).');
      await load();
    } catch (e:any) { setError(e.message); } finally { setWorking(null); }
  };

  const reactivateSubscriber = async (id: string) => {
    if (!token) return; setWorking('reactivate-'+id); setError(null); setMsg(null);
    try {
      const r = await apiFetch<any>(`/api/billing/subscribers/${id}/reactivate`, { method: 'POST', body: JSON.stringify({ reason: 'Manual reactivation' }) }, token);
      setMsg(`Subscriber reactivated. Provisioning restore completed in ${r.duration_ms ?? '?'} ms (target < 2000 ms).`);
      await load();
    } catch (e:any) { setError(e.message); } finally { setWorking(null); }
  };

  const createAndPay = async () => {
    if (!token) return; setWorking('pay'); setError(null); setMsg(null);
    try {
      const inv = invoices.find(i => i.id === payForm.invoice_id);
      const amount = Number(payForm.amount || inv?.due_amount || inv?.total_amount || 0);
      if (!payForm.invoice_id || !(amount > 0)) throw new Error('Select an invoice and valid amount');
      // 1) create checkout session (sandbox/plugin)
      const checkout = await apiFetch<any>('/api/billing/payments/checkout', { method: 'POST', body: JSON.stringify({ invoice_id: payForm.invoice_id, gateway: payForm.gateway, amount }) }, token);
      // 2) simulate successful gateway confirmation (sandbox) -> triggers instant auto-reactivation flow
      const confirmed = await apiFetch<any>(`/api/billing/payments/${encodeURIComponent(checkout.payment.payment_ref)}/confirm`, { method: 'POST', body: JSON.stringify({ amount, trx_id: `SIM-${payForm.gateway.toUpperCase()}-${Date.now()}`, method: 'sandbox_checkout' }) }, token);
      const dur = confirmed?.reactivation?.duration_ms;
      setMsg(`Payment completed via ${payForm.gateway} (sandbox). Invoice/payment recorded${dur != null ? `; auto-reactivation applied in ${dur} ms` : ''}.`);
      await load();
    } catch (e:any) { setError(e.message); } finally { setWorking(null); }
  };

  const selectedInvoice = useMemo(() => invoices.find(i => i.id === payForm.invoice_id), [invoices, payForm.invoice_id]);
  const overdueCandidates = useMemo(() => subscribers.filter(s => Number(s.current_due || 0) > 0 || s.status === 'SUSPENDED' || ['WARNING','GRACE','ISOLATED','WALLED_GARDEN'].includes(String(s.suspension_stage||''))).slice(0, 12), [subscribers]);
  const filteredInvoices = useMemo(() => {
    if (invoiceFilter === 'ALL') return invoices;
    if (invoiceFilter === 'UNPAID') return invoices.filter((i: any) => ['PENDING', 'PARTIAL', 'OVERDUE', 'UNPAID'].includes(String(i.status || '').toUpperCase()) || Number(i.due_amount || 0) > 0);
    return invoices.filter((i: any) => String(i.status || '').toUpperCase() === invoiceFilter);
  }, [invoices, invoiceFilter]);
  const filteredPayments = useMemo(() => {
    if (!paymentsTodayOnly) return payments;
    const today = new Date().toISOString().slice(0, 10);
    return payments.filter((p: any) => String(p.created_at || '').slice(0, 10) === today);
  }, [payments, paymentsTodayOnly]);

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Revenue operations · Billing core</span>
          <h1 className="page-title">Billing &amp; Payments</h1>
          <p className="page-subtitle">Invoicing, collections, due enforcement and gateway settlement in one workspace.</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={evaluate} disabled={!!working} className="btn btn-warning"><AlertTriangle className="w-4 h-4"/>{working==='eval'?'Evaluating…':'Run Due Policy'}</button>
          <input type="date" className="form-control !w-[142px]" value={cycleDate} onChange={e=>setCycleDate(e.target.value)} title="Billing cycle date" />
          <button onClick={runBatch} disabled={!!working} className="btn btn-primary"><Play className="w-4 h-4"/>{working==='batch'?'Generating…':'Generate Batch'}</button>
        </div>
      </div>

      <div className="page-tabbar">
        <Link href="/billing" className="page-tab active">Overview</Link>
        <Link href="/billing/all" className="page-tab">All Bills</Link>
        <Link href="/billing/unpaid" className="page-tab">Unpaid</Link>
        <Link href="/billing/paid" className="page-tab">Paid</Link>
        <Link href="/billing/invoices" className="page-tab">Invoices</Link>
        <Link href="/billing/monthly-generate" className="page-tab">Monthly Generate</Link>
        <Link href="/billing/collections" className="page-tab">Collections</Link>
        <Link href="/billing/payments" className="page-tab">Payments</Link>
        <Link href="/billing/due-analytics" className="page-tab">Due Analytics</Link>
        <Link href="/billing/adjust-bill" className="page-tab">Adjust Bill</Link>
        <Link href="/billing/auto-suspend" className="page-tab">Auto Suspend</Link>
        <Link href="/billing/waivers" className="page-tab">Waivers</Link>
        <Link href="/subscribers" className="page-tab">Clients</Link>
        <Link href="/plugins" className="page-tab">Gateways</Link>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: 'This Month Billed', value: money(metrics?.monthlyBillGenerated), hint: 'net amount invoiced', icon: FileText, tone: 'primary' },
          { label: 'Today Collections', value: money(metrics?.todayCollections), hint: 'payments posted today', icon: CreditCard, tone: 'success' },
          { label: 'Month Collections', value: money(metrics?.thisMonthCollections), hint: 'collected month to date', icon: Wallet, tone: 'teal' },
          { label: 'Outstanding Due', value: money(metrics?.totalDueOutstanding), hint: `${metrics?.overdueInvoices ?? 0} overdue invoices`, icon: AlertTriangle, tone: 'warning' },
          { label: 'Suspended / Isolated', value: String(metrics?.suspendedDue ?? 0), hint: 'accounts restricted', icon: ShieldAlert, tone: 'danger' },
          { label: 'Expired', value: String(metrics?.expiredThisMonth ?? 0), hint: 'this month', icon: Clock3, tone: 'orange' },
        ].map((c:any) => (
          <div key={c.label} className={`dash-stat dash-stat-${c.tone}`}>
            <span className="dash-stat-icon"><c.icon /></span>
            <span className="dash-stat-body"><span className="dash-stat-label">{c.label}</span><span className="dash-stat-value">{c.value}</span><span className="dash-stat-hint">{c.hint}</span></span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div id="billing-invoices" className="card xl:col-span-2 overflow-hidden scroll-mt-24">
          <div className="card-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="card-title flex items-center gap-2"><FileText className="w-4 h-4 text-primary"/>Invoices (batch & prorated)</div>
            <div className="filter-bar flex flex-wrap gap-1.5">
              {[
                ['ALL', 'All'],
                ['UNPAID', 'Unpaid/Due'],
                ['PENDING', 'Pending'],
                ['PARTIAL', 'Partial'],
                ['OVERDUE', 'Overdue'],
                ['PAID', 'Paid'],
              ].map(([k, label]) => (
                <button key={k} onClick={() => setInvoiceFilter(k)} className={`filter-chip ${invoiceFilter === k ? 'active' : ''}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="table-wrap overflow-auto max-h-[420px]">
            <table className="table table-hover w-full text-sm min-w-[720px]">
              <thead className="sticky top-0 z-10"><tr><th className="text-left px-3 py-2.5">Invoice</th><th className="text-left px-3 py-2.5">Subscriber</th><th className="text-left px-3 py-2.5">Period</th><th className="text-left px-3 py-2.5">Amounts</th><th className="text-left px-3 py-2.5">Status</th></tr></thead>
              <tbody>
                {filteredInvoices.map((inv:any) => (
                  <tr key={inv.id} className={`border-t border-border/70 cursor-pointer hover:bg-muted/30 transition-colors ${payForm.invoice_id===inv.id?'bg-primary/5':''}`} onClick={()=>setPayForm(f=>({...f, invoice_id: inv.id, amount: String(inv.due_amount || inv.total_amount || '')}))}>
                    <td className="px-3 py-2.5"><div className="font-semibold font-mono text-[11px] whitespace-nowrap">{inv.invoice_number}</div><div className="text-[10px] text-muted-foreground">{inv.bill_month || '-'} {inv.prorated ? <span className="text-teal font-medium">• prorated</span> : null}</div></td>
                    <td className="px-3 py-2.5"><div className="font-medium text-[12px] truncate max-w-[150px]">{inv.subscriber_name || '-'}</div><div className="text-[10px] text-muted-foreground font-mono truncate max-w-[150px]">{inv.client_code || ''} {inv.username ? `• ${inv.username}`:''}</div></td>
                    <td className="px-3 py-2.5 text-[11px] whitespace-nowrap"><div>{fmtDate(inv.period_start)} → {fmtDate(inv.period_end)}</div><div className="text-[10px] text-muted-foreground">Due {fmtDate(inv.due_date)}</div></td>
                    <td className="px-3 py-2.5 text-[11px] tabular-nums whitespace-nowrap"><div>Total <span className="font-semibold">{money(inv.total_amount||inv.amount)}</span></div><div className="text-[10px] text-muted-foreground">Paid <span className="text-success">{money(inv.paid_amount)}</span> · Due <span className={Number(inv.due_amount||0)>0?'text-warning font-semibold':''}>{money(inv.due_amount)}</span></div></td>
                    <td className="px-3 py-2.5 text-[11px]">
                      <div className="flex flex-col items-start gap-1">
                        <span className={`badge ${inv.status==='PAID'?'badge-success':inv.status==='OVERDUE'?'badge-danger':inv.status==='PARTIAL'?'badge-warning':inv.status==='PENDING'?'badge-primary':'badge-secondary'}`}>{inv.status}</span>
                        {Number(inv.due_amount || 0) > 0 && String(inv.status).toUpperCase() !== 'PAID' && (
                          <div className="flex flex-wrap gap-1.5" onClick={e=>e.stopPropagation()}>
                            <Link href={`/billing/adjust-bill?invoice_id=${encodeURIComponent(inv.id)}`} className="text-[10px] text-primary font-semibold hover:underline underline-offset-2">Adjust</Link>
                            <Link href={`/billing/waivers?invoice_id=${encodeURIComponent(inv.id)}`} className="text-[10px] text-primary font-semibold hover:underline underline-offset-2">Waive</Link>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!filteredInvoices.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{invoices.length ? 'No invoices match the selected filter.' : 'No invoices yet. Run "Generate Batch Invoices" (supports prorated mid-month for new subscribers).'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-4">
            <h2 className="card-title mb-3 flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary"/>Sandbox Payment & Instant Reactivation</h2>
            <div className="space-y-3 text-sm">
              <label className="form-label"><div className="text-xs text-muted-foreground mb-1">Invoice</div>
                <select className="form-select w-full" value={payForm.invoice_id} onChange={e=>{ const id=e.target.value; const inv=invoices.find(x=>x.id===id); setPayForm({...payForm, invoice_id:id, amount:String(inv?.due_amount||inv?.total_amount||'')}); }}>
                  <option value="">Select invoice...</option>
                  {invoices.map((i:any)=>(<option key={i.id} value={i.id}>{i.invoice_number} — {i.subscriber_name || i.client_code} ({money(i.due_amount)} due)</option>))}
                </select>
              </label>
              <label className="form-label"><div className="text-xs text-muted-foreground mb-1">Gateway (hot-reloadable plugin)</div>
                <select className="form-select w-full" value={payForm.gateway} onChange={e=>setPayForm({...payForm, gateway:e.target.value})}>
                  {['bkash','nagad','rocket','stripe','paypal'].map(g => <option key={g} value={g}>{g.toUpperCase()}</option>)}
                </select>
              </label>
              <label className="form-label"><div className="text-xs text-muted-foreground mb-1">Amount</div>
                <input className="form-control w-full" value={payForm.amount} onChange={e=>setPayForm({...payForm, amount:e.target.value})} placeholder={selectedInvoice ? String(selectedInvoice.due_amount) : '0.00'} />
              </label>
              <button onClick={createAndPay} disabled={!!working || !payForm.invoice_id} className="btn btn-primary w-full"><Send className="w-4 h-4"/>{working==='pay'?'Processing...':'Checkout & Confirm (Sandbox)'}</button>
              <p className="text-[11px] text-muted-foreground">Creates a checkout session via the selected gateway plugin and simulates successful payment confirmation/webhook to record payment and trigger instant auto-reactivation (&lt;2s target) with PPP/RADIUS/CoA enforcement.</p>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="card-title mb-3 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-primary"/>Payment Gateways & Plugins</h2>
            <div className="space-y-2 text-xs">
              {gateways.map((g:any)=> (
                <div key={g.gateway} className="p-2.5 rounded-xl border border-border/70 flex items-center justify-between"><div><div className="font-semibold uppercase">{g.gateway}</div><div className="text-muted-foreground">{g.mode} • {g.enabled ? 'enabled' : 'configured'} • {g.has_credentials ? 'credentials set' : 'sandbox/no creds'}</div></div><CheckCircle2 className={`w-4 h-4 ${g.enabled || g.mode==='SANDBOX' ? 'text-success':'text-muted-foreground'}`}/></div>
              ))}
              <div className="pt-1 text-muted-foreground">Loaded payment plugins: {gatewayPlugins.length ? gatewayPlugins.map((p:any)=>p.id || p.name).join(', ') : 'bKash, Nagad, Rocket, Stripe, PayPal (on reload)'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div id="billing-due" className="card overflow-hidden scroll-mt-24">
          <div className="card-header font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-warning"/>Due / Suspension Control (warning → grace → isolation/walled garden)</div>
          <div className="table-wrap overflow-auto max-h-[360px]">
            <table className="table table-hover w-full text-xs">
              <thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-2">Subscriber</th><th className="text-left px-4 py-2">Due/Stage</th><th className="text-left px-4 py-2">Status</th><th className="text-right px-4 py-2">Actions</th></tr></thead>
              <tbody>
                {overdueCandidates.map((s:any)=> (
                  <tr key={s.id} className="border-t border-border/70">
                    <td className="px-4 py-2"><div className="font-semibold">{s.full_name}</div><div className="text-muted-foreground font-mono">{s.client_code || s.username}</div></td>
                    <td className="px-4 py-2"><div>{money(s.current_due || 0)}</div><div className="text-muted-foreground">{s.suspension_stage || 'NONE'} {s.walled_garden ? '• walled garden':''} {s.grace_until ? `• grace ${String(s.grace_until).slice(0,10)}`:''}</div></td>
                    <td className="px-4 py-2"><span className="badge badge-secondary">{s.status}</span></td>
                    <td className="px-4 py-2 text-right space-x-1">
                      <button onClick={()=>suspendSubscriber(s.id)} disabled={!!working} className="btn btn-danger btn-sm"><Ban className="w-3 h-3"/>Suspend</button>
                      <button onClick={()=>reactivateSubscriber(s.id)} disabled={!!working} className="btn btn-success btn-sm"><RotateCcw className="w-3 h-3"/>Reactivate</button>
                    </td>
                  </tr>
                ))}
                {!overdueCandidates.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No due/suspended subscribers. Use "Run Due Policy" to evaluate warnings, grace, isolation and walled-garden states.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div id="billing-payments" className="card overflow-hidden scroll-mt-24">
          <div className="card-header font-semibold flex items-center justify-between gap-2">
            <div className="card-title flex items-center gap-2"><Wallet className="w-4 h-4 text-primary"/>Recent Payments & Suspension Logs</div>
            <button onClick={() => setPaymentsTodayOnly(v => !v)} className={`filter-chip ${paymentsTodayOnly ? 'active' : ''}`}>{paymentsTodayOnly ? "Showing: Today" : "Filter: Today"}</button>
          </div>
          <div className="grid grid-rows-2 h-[360px]">
            <div className="table-wrap overflow-auto border-b border-border/70">
              <table className="table table-hover w-full text-xs"><thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-2">Time</th><th className="text-left px-4 py-2">Ref/Invoice</th><th className="text-left px-4 py-2">Gateway</th><th className="text-left px-4 py-2">Amount</th><th className="text-left px-4 py-2">Status</th></tr></thead>
                <tbody>
                  {filteredPayments.slice(0,30).map((p:any)=>(<tr key={p.id} className="border-t border-border/70"><td className="px-4 py-2 text-muted-foreground">{p.created_at?new Date(p.created_at).toLocaleString():'-'}</td><td className="px-4 py-2"><div className="font-medium">{p.payment_ref}</div><div className="text-muted-foreground">{p.invoice_number || ''} {p.full_name?`• ${p.full_name}`:''}</div></td><td className="px-4 py-2 uppercase">{p.gateway}</td><td className="px-4 py-2">{money(p.amount, p.currency==='USD'?'$':'৳')}</td><td className="px-4 py-2"><span className={p.status==='COMPLETED'?'text-success':p.status==='FAILED'?'text-danger':'text-warning'}>{p.status}</span></td></tr>))}
                  {!filteredPayments.length && <tr><td colSpan={5} className="px-4 py-4 text-center text-muted-foreground">{payments.length ? 'No payments match the current filter.' : 'No payments yet.'}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-wrap overflow-auto">
              <table className="table table-hover w-full text-xs"><thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-2">Time</th><th className="text-left px-4 py-2">Subscriber</th><th className="text-left px-4 py-2">Action/Stage</th><th className="text-left px-4 py-2">Reason</th></tr></thead>
                <tbody>
                  {logs.slice(0,30).map((l:any)=>(<tr key={l.id} className="border-t border-border/70"><td className="px-4 py-2 text-muted-foreground">{l.created_at?new Date(l.created_at).toLocaleString():'-'}</td><td className="px-4 py-2"><div className="font-medium">{l.full_name || l.username || l.subscriber_id || '-'}</div><div className="text-muted-foreground">{l.client_code || ''}</div></td><td className="px-4 py-2">{l.action} {l.stage?`• ${l.stage}`:''}</td><td className="px-4 py-2 text-muted-foreground">{l.reason || ''}</td></tr>))}
                  {!logs.length && <tr><td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">No suspension/reactivation logs yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-4 text-sm text-muted-foreground">
        <div className="card-title mb-1">Phase 4 capabilities covered</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Automated batch monthly invoicing with mid-month proration and invoice records/items.</li>
          <li>Multi-stage due policy: pre-expiry warning, grace countdown, auto-suspension/router isolation and optional walled-garden flag/profile handling.</li>
          <li>Hot-reloadable payment gateway plugins: bKash (tokenized checkout + personal MFS SMS listener hook), Nagad merchant PGW, Rocket, Stripe (Elements/cards/Apple Pay), PayPal Smart Buttons.</li>
          <li>Sandbox checkout + payment confirmation/webhook flow records payments, updates dues, and triggers instant auto-reactivation (PPP/RADIUS sync + CoA/PoD where configured, target &lt;2s).</li>
        </ul>
      </div>
    </div>
  );
}