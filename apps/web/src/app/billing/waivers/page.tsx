'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw } from 'lucide-react';

function money(v: any) { const n = Number(v || 0); return `৳${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

export default function WaiversPage() {
  const { token, user } = useAuth();
  const searchParams = useSearchParams();
  const canManage = ['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(user?.role));
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ invoice_id: '', amount: '', reason: 'Late fee waiver', notes: '' });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const inv = await apiFetch<any>('/api/billing/invoices', {}, token);
      const invs = (inv.data || []).filter((i: any) => ['PENDING','PARTIAL','OVERDUE','UNPAID'].includes(String(i.status || '').toUpperCase()) || Number(i.due_amount || 0) > 0);
      setInvoices(invs);
      const wanted = String(searchParams?.get('invoice_id') || '');
      const pick = (wanted && (invs.find((i:any)=>i.id===wanted) || (inv.data||[]).find((i:any)=>i.id===wanted))) || invs[0] || null;
      if (pick) setForm(f => ({ ...f, invoice_id: pick.id }));
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [token, searchParams]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => invoices.find(i => i.id === form.invoice_id), [invoices, form.invoice_id]);

  const submit = async () => {
    if (!token || !form.invoice_id || !Number(form.amount)) return;
    setErr(null); setMsg(null);
    try {
      const desc = `WAIVER: ${form.reason}${selected?.invoice_number ? ` • Invoice ${selected.invoice_number}` : ''}${selected?.subscriber_name ? ` • ${selected.subscriber_name}` : ''}${form.notes ? ` • ${form.notes}` : ''}`;
      await apiFetch('/api/finance/transactions', {
        method: 'POST',
        body: JSON.stringify({
          txn_date: new Date().toISOString().slice(0,10),
          txn_type: 'ADJUSTMENT',
          method: 'OTHER',
          amount: Number(form.amount),
          description: desc,
          reference_type: 'WAIVER',
          reference_id: form.invoice_id,
        }),
      }, token);
      setMsg('Waiver recorded as a finance adjustment transaction. Review balances/service eligibility in Billing and Finance as needed.');
      setForm(f => ({ ...f, amount: '', notes: '' }));
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="page-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Waivers</h1>
          <p className="page-subtitle">Record late-fee/due waivers or concessions as adjustment transactions linked to invoices.</p>
        </div>
        <div className="page-actions flex gap-2">
          <button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
          <Link href="/billing?status=unpaid" className="btn btn-outline">Unpaid Bills</Link>
        </div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-4 space-y-3">
          <h2 className="card-title">Record Waiver</h2>
          <div className="space-y-2 text-sm">
            <select className="form-select w-full" value={form.invoice_id} onChange={e=>setForm(f=>({...f, invoice_id:e.target.value}))}>
              <option value="">Select invoice (optional but recommended)</option>
              {invoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} • {i.subscriber_name || '-'} • Due {money(i.due_amount)} ({i.status})</option>)}
            </select>
            {selected && <div className="text-xs text-muted-foreground p-2 rounded-lg bg-muted/30 border border-border">Selected: <b className="text-foreground">{selected.invoice_number}</b> • {selected.subscriber_name || '-'} • Due {money(selected.due_amount)}</div>}
            <select className="form-select w-full" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}>
              {['Late fee waiver','Partial due waiver','Goodwill concession','Service outage compensation','Billing correction waiver','Other waiver'].map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <input type="number" className="form-control w-full" placeholder="Waiver amount" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} />
            <textarea className="form-control w-full min-h-[90px]" placeholder="Notes / approval reference (optional)" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} />
          </div>
          <button onClick={submit} disabled={!canManage || !Number(form.amount)} className="btn btn-primary w-full">Record Waiver</button>
          {!canManage && <div className="text-xs text-amber-400">You need billing/admin permissions to record waivers.</div>}
          <div className="text-xs text-muted-foreground">Recorded as a finance adjustment transaction (reference type WAIVER). A dedicated waiver approval workflow/ledger UI is not fully implemented; use narration/notes for approval traceability.</div>
        </div>

        <div className="card p-4">
          <h2 className="card-title mb-3">Eligible Invoices (Unpaid/Overdue)</h2>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {invoices.map(i => (
              <button key={i.id} onClick={()=>setForm(f=>({...f, invoice_id:i.id}))} className={`w-full text-left p-3 rounded-xl border transition-colors ${form.invoice_id===i.id?'border-primary bg-primary/5':'border-border hover:bg-muted/30'}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-sm">{i.invoice_number}</span><span className="badge badge-secondary">{i.status}</span></div>
                <div className="text-xs text-muted-foreground mt-1">{i.subscriber_name || '-'} {i.client_code ? `• ${i.client_code}` : ''}</div>
                <div className="text-xs mt-1">Due <span className="text-amber-400 font-semibold">{money(i.due_amount)}</span> / {money(i.total_amount)}</div>
              </button>
            ))}
            {!invoices.length && <div className="text-sm text-muted-foreground py-8 text-center">{loading ? 'Loading...' : 'No unpaid/due invoices found.'}</div>}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">For suspension/reactivation follow-up, use <Link href="/billing?view=due" className="text-primary underline">Due/Suspension Control</Link>.</div>
        </div>
      </div>
    </div>
  );
}
