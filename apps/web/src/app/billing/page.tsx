'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, FileText, PlusCircle, Play, AlertTriangle, ShieldAlert, CheckCircle2, CreditCard, Wallet, Send, RotateCcw, Ban, Clock3 } from 'lucide-react';

type AnyObj = Record<string, any>;

function money(v: any, cur = '৳') {
  const n = Number(v || 0);
  return `${cur}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BillingPage() {
  const { token } = useAuth();
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Billing & Payments</h1>
          <p className="text-sm text-muted-foreground">Automated invoicing, due policies, suspension/walled-garden enforcement, and payment gateway collections with instant reactivation.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={evaluate} disabled={!!working} className="px-3 py-2 rounded-xl border border-amber-500/40 text-amber-300 text-sm font-semibold inline-flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>{working==='eval'?'Evaluating...':'Run Due Policy'}</button>
          <div className="flex items-center gap-2">
            <input type="date" className="px-3 py-2 rounded-xl border border-border bg-card text-sm" value={cycleDate} onChange={e=>setCycleDate(e.target.value)} />
            <button onClick={runBatch} disabled={!!working} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Play className="w-4 h-4"/>{working==='batch'?'Generating...':'Generate Batch Invoices'}</button>
          </div>
        </div>
      </div>
      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: 'This Month Billed', value: money(metrics?.monthlyBillGenerated), icon: FileText },
          { label: 'Today Collections', value: money(metrics?.todayCollections), icon: CreditCard },
          { label: 'Month Collections', value: money(metrics?.thisMonthCollections), icon: Wallet },
          { label: 'Outstanding Due', value: money(metrics?.totalDueOutstanding), icon: AlertTriangle },
          { label: 'Suspended/Isolated', value: String(metrics?.suspendedDue ?? 0), icon: ShieldAlert },
          { label: 'Expired', value: String(metrics?.expiredThisMonth ?? 0), icon: Clock3 },
        ].map((c:any) => (
          <div key={c.label} className="p-4 rounded-2xl bg-card border border-border/80">
            <div className="flex items-center justify-between text-xs uppercase font-bold text-muted-foreground tracking-wider"><span>{c.label}</span><c.icon className="w-4 h-4"/></div>
            <div className="mt-2 text-lg font-black">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-primary"/>Invoices (batch & prorated)</div>
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-3">Invoice</th><th className="text-left px-4 py-3">Subscriber</th><th className="text-left px-4 py-3">Period</th><th className="text-left px-4 py-3">Amounts</th><th className="text-left px-4 py-3">Status</th></tr></thead>
              <tbody>
                {invoices.map((inv:any) => (
                  <tr key={inv.id} className={`border-t border-border/70 ${payForm.invoice_id===inv.id?'bg-primary/5':''}`} onClick={()=>setPayForm(f=>({...f, invoice_id: inv.id, amount: String(inv.due_amount || inv.total_amount || '')}))}>
                    <td className="px-4 py-3"><div className="font-semibold">{inv.invoice_number}</div><div className="text-xs text-muted-foreground">{inv.bill_month || '-'} {inv.prorated ? <span className="text-cyan-400">• prorated</span> : null}</div></td>
                    <td className="px-4 py-3"><div className="font-medium">{inv.subscriber_name || '-'}</div><div className="text-xs text-muted-foreground font-mono">{inv.client_code || ''} {inv.username ? `• ${inv.username}`:''}</div></td>
                    <td className="px-4 py-3 text-xs"><div>{inv.period_start || '-'} → {inv.period_end || '-'}</div><div className="text-muted-foreground">Due {inv.due_date || '-'}</div></td>
                    <td className="px-4 py-3 text-xs"><div>Total {money(inv.total_amount||inv.amount)}</div><div className="text-muted-foreground">Paid {money(inv.paid_amount)} • Due {money(inv.due_amount)}</div></td>
                    <td className="px-4 py-3 text-xs"><span className={`px-2 py-0.5 rounded-full border ${inv.status==='PAID'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':inv.status==='OVERDUE'?'bg-red-500/10 text-red-400 border-red-500/20':inv.status==='PARTIAL'?'bg-amber-500/10 text-amber-400 border-amber-500/20':'bg-muted text-muted-foreground border-border'}`}>{inv.status}</span></td>
                  </tr>
                ))}
                {!invoices.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No invoices yet. Run "Generate Batch Invoices" (supports prorated mid-month for new subscribers).</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary"/>Sandbox Payment & Instant Reactivation</h2>
            <div className="space-y-3 text-sm">
              <label className="block"><div className="text-xs text-muted-foreground mb-1">Invoice</div>
                <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={payForm.invoice_id} onChange={e=>{ const id=e.target.value; const inv=invoices.find(x=>x.id===id); setPayForm({...payForm, invoice_id:id, amount:String(inv?.due_amount||inv?.total_amount||'')}); }}>
                  <option value="">Select invoice...</option>
                  {invoices.map((i:any)=>(<option key={i.id} value={i.id}>{i.invoice_number} — {i.subscriber_name || i.client_code} ({money(i.due_amount)} due)</option>))}
                </select>
              </label>
              <label className="block"><div className="text-xs text-muted-foreground mb-1">Gateway (hot-reloadable plugin)</div>
                <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={payForm.gateway} onChange={e=>setPayForm({...payForm, gateway:e.target.value})}>
                  {['bkash','nagad','rocket','stripe','paypal'].map(g => <option key={g} value={g}>{g.toUpperCase()}</option>)}
                </select>
              </label>
              <label className="block"><div className="text-xs text-muted-foreground mb-1">Amount</div>
                <input className="w-full p-2.5 rounded-xl border border-border bg-card" value={payForm.amount} onChange={e=>setPayForm({...payForm, amount:e.target.value})} placeholder={selectedInvoice ? String(selectedInvoice.due_amount) : '0.00'} />
              </label>
              <button onClick={createAndPay} disabled={!!working || !payForm.invoice_id} className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"><Send className="w-4 h-4"/>{working==='pay'?'Processing...':'Checkout & Confirm (Sandbox)'}</button>
              <p className="text-[11px] text-muted-foreground">Creates a checkout session via the selected gateway plugin and simulates successful payment confirmation/webhook to record payment and trigger instant auto-reactivation (&lt;2s target) with PPP/RADIUS/CoA enforcement.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-primary"/>Payment Gateways & Plugins</h2>
            <div className="space-y-2 text-xs">
              {gateways.map((g:any)=> (
                <div key={g.gateway} className="p-2.5 rounded-xl border border-border/70 flex items-center justify-between"><div><div className="font-semibold uppercase">{g.gateway}</div><div className="text-muted-foreground">{g.mode} • {g.enabled ? 'enabled' : 'configured'} • {g.has_credentials ? 'credentials set' : 'sandbox/no creds'}</div></div><CheckCircle2 className={`w-4 h-4 ${g.enabled || g.mode==='SANDBOX' ? 'text-emerald-400':'text-muted-foreground'}`}/></div>
              ))}
              <div className="pt-1 text-muted-foreground">Loaded payment plugins: {gatewayPlugins.length ? gatewayPlugins.map((p:any)=>p.id || p.name).join(', ') : 'bKash, Nagad, Rocket, Stripe, PayPal (on reload)'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400"/>Due / Suspension Control (warning → grace → isolation/walled garden)</div>
          <div className="overflow-auto max-h-[360px]">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-2">Subscriber</th><th className="text-left px-4 py-2">Due/Stage</th><th className="text-left px-4 py-2">Status</th><th className="text-right px-4 py-2">Actions</th></tr></thead>
              <tbody>
                {overdueCandidates.map((s:any)=> (
                  <tr key={s.id} className="border-t border-border/70">
                    <td className="px-4 py-2"><div className="font-semibold">{s.full_name}</div><div className="text-muted-foreground font-mono">{s.client_code || s.username}</div></td>
                    <td className="px-4 py-2"><div>{money(s.current_due || 0)}</div><div className="text-muted-foreground">{s.suspension_stage || 'NONE'} {s.walled_garden ? '• walled garden':''} {s.grace_until ? `• grace ${String(s.grace_until).slice(0,10)}`:''}</div></td>
                    <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-full border border-border">{s.status}</span></td>
                    <td className="px-4 py-2 text-right space-x-1">
                      <button onClick={()=>suspendSubscriber(s.id)} disabled={!!working} className="px-2 py-1 rounded-lg border border-red-500/30 text-red-300 inline-flex items-center gap-1"><Ban className="w-3 h-3"/>Suspend</button>
                      <button onClick={()=>reactivateSubscriber(s.id)} disabled={!!working} className="px-2 py-1 rounded-lg border border-emerald-500/30 text-emerald-300 inline-flex items-center gap-1"><RotateCcw className="w-3 h-3"/>Reactivate</button>
                    </td>
                  </tr>
                ))}
                {!overdueCandidates.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No due/suspended subscribers. Use "Run Due Policy" to evaluate warnings, grace, isolation and walled-garden states.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-primary"/>Recent Payments & Suspension Logs</div>
          <div className="grid grid-rows-2 h-[360px]">
            <div className="overflow-auto border-b border-border/70">
              <table className="w-full text-xs"><thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-2">Time</th><th className="text-left px-4 py-2">Ref/Invoice</th><th className="text-left px-4 py-2">Gateway</th><th className="text-left px-4 py-2">Amount</th><th className="text-left px-4 py-2">Status</th></tr></thead>
                <tbody>
                  {payments.slice(0,30).map((p:any)=>(<tr key={p.id} className="border-t border-border/70"><td className="px-4 py-2 text-muted-foreground">{p.created_at?new Date(p.created_at).toLocaleString():'-'}</td><td className="px-4 py-2"><div className="font-medium">{p.payment_ref}</div><div className="text-muted-foreground">{p.invoice_number || ''} {p.full_name?`• ${p.full_name}`:''}</div></td><td className="px-4 py-2 uppercase">{p.gateway}</td><td className="px-4 py-2">{money(p.amount, p.currency==='USD'?'$':'৳')}</td><td className="px-4 py-2"><span className={p.status==='COMPLETED'?'text-emerald-400':p.status==='FAILED'?'text-red-400':'text-amber-300'}>{p.status}</span></td></tr>))}
                  {!payments.length && <tr><td colSpan={5} className="px-4 py-4 text-center text-muted-foreground">No payments yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs"><thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-2">Time</th><th className="text-left px-4 py-2">Subscriber</th><th className="text-left px-4 py-2">Action/Stage</th><th className="text-left px-4 py-2">Reason</th></tr></thead>
                <tbody>
                  {logs.slice(0,30).map((l:any)=>(<tr key={l.id} className="border-t border-border/70"><td className="px-4 py-2 text-muted-foreground">{l.created_at?new Date(l.created_at).toLocaleString():'-'}</td><td className="px-4 py-2"><div className="font-medium">{l.full_name || l.username || l.subscriber_id || '-'}</div><div className="text-muted-foreground">{l.client_code || ''}</div></td><td className="px-4 py-2">{l.action} {l.stage?`• ${l.stage}`:''}</td><td className="px-4 py-2 text-muted-foreground">{l.reason || ''}</td></tr>))}
                  {!logs.length && <tr><td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">No suspension/reactivation logs yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <div className="font-semibold text-foreground mb-1">Phase 4 capabilities covered</div>
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