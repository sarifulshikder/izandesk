'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Receipt } from 'lucide-react';

function money(v: any) { const n = Number(v || 0); return `৳${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

export default function AdjustBillPage() {
  const { token, user } = useAuth();
  const searchParams = useSearchParams();
  const canManage = ['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(user?.role));
  const [invoices, setInvoices] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ invoice_id: '', account_id: '', counter_account_id: '', amount: '', method: 'CASH', description: '' });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const [inv, acc] = await Promise.all([
        apiFetch<any>('/api/billing/invoices', {}, token),
        apiFetch<any>('/api/finance/accounts', {}, token).catch(() => ({ data: [] })),
      ]);
      const invs = (inv.data || []).filter((i: any) => ['PENDING','PARTIAL','OVERDUE','UNPAID'].includes(String(i.status || '').toUpperCase()) || Number(i.due_amount || 0) > 0);
      setInvoices(invs);
      setAccounts(acc.data || []);
      const wanted = String(searchParams?.get('invoice_id') || '');
      const pick = (wanted && (invs.find((i:any)=>i.id===wanted) || (inv.data||[]).find((i:any)=>i.id===wanted))) || invs[0] || null;
      if (pick) setForm(f => ({ ...f, invoice_id: pick.id, amount: String(pick.due_amount || pick.total_amount || f.amount || '') }));
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [token, searchParams]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => invoices.find(i => i.id === form.invoice_id), [invoices, form.invoice_id]);

  const submit = async () => {
    if (!token || !form.invoice_id || !Number(form.amount)) return;
    setErr(null); setMsg(null);
    try {
      const desc = form.description || `Bill adjustment for invoice ${selected?.invoice_number || form.invoice_id}${selected?.subscriber_name ? ` (${selected.subscriber_name})` : ''}`;
      await apiFetch('/api/finance/transactions', {
        method: 'POST',
        body: JSON.stringify({
          txn_date: new Date().toISOString().slice(0,10),
          txn_type: 'ADJUSTMENT',
          account_id: form.account_id || null,
          counter_account_id: form.counter_account_id || null,
          method: form.method,
          amount: Number(form.amount),
          description: desc,
          reference_type: 'INVOICE_ADJUSTMENT',
          reference_id: form.invoice_id,
        }),
      }, token);
      setMsg('Adjustment transaction recorded in Finance. Review the invoice/subscriber balance as needed in Billing/Finance.');
      setForm(f => ({ ...f, amount: '', description: '' }));
      await load();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Revenue operations · Bill adjustments</span>
          <h1 className="page-title">Adjust Bill</h1>
          <p className="page-subtitle">Record bill adjustments/corrections against invoices (posted as finance adjustment transactions).</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
          <Link href="/billing?view=invoices" className="btn btn-outline">Back to Billing</Link>
        </div>
      </div>

      <div className="page-tabbar">
        <Link href="/billing" className="page-tab">Overview</Link>
        <Link href="/billing/invoices" className="page-tab">Invoices</Link>
        <Link href="/billing/collections" className="page-tab">Collections</Link>
        <Link href="/billing/adjust-bill" className="page-tab active">Adjust Bill</Link>
        <Link href="/billing/waivers" className="page-tab">Waivers</Link>
        <Link href="/finance" className="page-tab">Finance</Link>
      </div>

      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-4 space-y-3">
          <h2 className="card-title">Create Adjustment</h2>
          <div className="space-y-2 text-sm">
            <select className="form-select w-full" value={form.invoice_id} onChange={e=>{ const id=e.target.value; const inv=invoices.find(i=>i.id===id); setForm(f=>({...f, invoice_id:id, amount: inv?String(inv.due_amount||inv.total_amount||''):f.amount})); }}>
              <option value="">Select unpaid/partially due invoice</option>
              {invoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} • {i.subscriber_name || '-'} • Due {money(i.due_amount)} ({i.status})</option>)}
            </select>
            {selected && <div className="text-xs text-muted-foreground p-2 rounded-lg bg-muted/30 border border-border">Subscriber: <b className="text-foreground">{selected.subscriber_name || '-'}</b> {selected.client_code ? `(${selected.client_code})` : ''} • Total {money(selected.total_amount)} • Paid {money(selected.paid_amount)} • Due {money(selected.due_amount)}</div>}
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="form-control" placeholder="Adjustment amount" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} />
              <select className="form-select" value={form.method} onChange={e=>setForm({...form,method:e.target.value})}>{['CASH','BANK','BKASH','NAGAD','ROCKET','OTHER'].map(x=><option key={x} value={x}>{x}</option>)}</select>
              <select className="form-select" value={form.account_id} onChange={e=>setForm({...form,account_id:e.target.value})}><option value="">Debit/Account (optional)</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code?`${a.code} - `:''}{a.name}</option>)}</select>
              <select className="form-select" value={form.counter_account_id} onChange={e=>setForm({...form,counter_account_id:e.target.value})}><option value="">Credit/Counter (optional)</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code?`${a.code} - `:''}{a.name}</option>)}</select>
            </div>
            <textarea className="form-control w-full min-h-[90px]" placeholder="Reason / narration (e.g. discount, correction, late-fee reversal)" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} />
          </div>
          <button onClick={submit} disabled={!canManage || !form.invoice_id || !Number(form.amount)} className="btn btn-primary w-full">Record Adjustment Transaction</button>
          {!canManage && <div className="alert alert-warning text-xs">You need billing/admin permissions to record adjustments.</div>}
          <div className="text-xs text-muted-foreground">This records a finance adjustment entry linked to the invoice reference for audit/accounting. Dedicated invoice line-item credit/debit-note recalculation UI may require additional backend workflow support.</div>
        </div>

        <div className="card p-4">
          <h2 className="card-title mb-3">Unpaid / Due Invoices</h2>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {invoices.map(i => (
              <button key={i.id} onClick={()=>setForm(f=>({...f, invoice_id:i.id, amount:String(i.due_amount||i.total_amount||'')}))} className={`w-full text-left p-3 rounded-xl border transition-colors ${form.invoice_id===i.id?'border-primary bg-primary/5':'border-border hover:bg-muted/30'}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-sm">{i.invoice_number}</span><span className="badge badge-secondary">{i.status}</span></div>
                <div className="text-xs text-muted-foreground mt-1">{i.subscriber_name || '-'} {i.client_code ? `• ${i.client_code}` : ''}</div>
                <div className="text-xs mt-1 tabular-nums">Due <span className="text-warning font-semibold">{money(i.due_amount)}</span> / {money(i.total_amount)}</div>
              </button>
            ))}
            {!invoices.length && <div className="p-4"><div className="empty-panel">
              <span className="empty-panel-icon"><Receipt className="w-5 h-5"/></span>
              <div>
                <div className="text-sm font-semibold">{loading ? 'Loading invoices…' : 'No due invoices'}</div>
                <p className="text-[11px] text-muted-foreground mt-1">There are no unpaid or partially paid invoices needing an adjustment right now.</p>
              </div>
            </div></div>}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">Need to manage invoice state? Use <Link href="/billing?status=unpaid" className="text-primary underline">Unpaid Bills</Link> or <Link href="/finance" className="text-primary underline">Finance & Accounts</Link>.</div>
        </div>
      </div>
    </div>
  );
}
