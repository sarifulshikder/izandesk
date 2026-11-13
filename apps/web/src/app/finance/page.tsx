'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { RefreshCw, Plus, Landmark, ArrowDownCircle, ArrowUpCircle, Wallet, Download } from 'lucide-react';

function money(v: any) { const n = Number(v || 0); return `৳${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default function FinancePage() {
  const { token, user } = useAuth();
  const [summary, setSummary] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [txns, setTxns] = useState<any[]>([]);
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [recon, setRecon] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canManage = ['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(user?.role));

  const [txnForm, setTxnForm] = useState<any>({ txn_date: new Date().toISOString().slice(0,10), txn_type: 'INCOME', account_id: '', counter_account_id:'', method: 'CASH', amount: '', description: '', reference_type: 'MANUAL', reference_id: '' });
  const [voucherForm, setVoucherForm] = useState<any>({ voucher_type: 'RECEIPT', date: new Date().toISOString().slice(0,10), amount: '', method: 'CASH', narration: '' });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const [s,a,t,v,j,r] = await Promise.all([
        apiFetch<any>('/api/finance/summary', {}, token),
        apiFetch<any>('/api/finance/accounts', {}, token),
        apiFetch<any>('/api/finance/transactions', {}, token),
        apiFetch<any>('/api/finance/vouchers', {}, token),
        apiFetch<any>('/api/finance/journals', {}, token).catch(()=>({data:[]})),
        apiFetch<any>('/api/finance/reconciliation', {}, token).catch(()=>({data:null})),
      ]);
      setSummary(s); setAccounts(a.data||[]); setTxns(t.data||[]); setVouchers(v.data||[]); setJournals(j.data||[]); setRecon(r.data||null);
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token]);
  useEffect(()=>{ load(); }, [load]);

  const addTxn = async () => { if (!token) return; setErr(null); setMsg(null); try { await apiFetch('/api/finance/transactions', { method:'POST', body: JSON.stringify({ ...txnForm, amount: Number(txnForm.amount), account_id: txnForm.account_id || null, counter_account_id: txnForm.counter_account_id || null }) }, token); setMsg('Transaction recorded (journal auto-posted when debit/credit accounts provided)'); setTxnForm((f:any)=>({ ...f, amount:'', description:'', reference_id:'' })); await load(); } catch(e:any){ setErr(e.message); } };
  const addVoucher = async () => { if (!token) return; setErr(null); setMsg(null); try { await apiFetch('/api/finance/vouchers', { method:'POST', body: JSON.stringify({ ...voucherForm, amount: Number(voucherForm.amount) }) }, token); setMsg('Voucher posted (transaction + journal created)'); setVoucherForm((f:any)=>({ ...f, amount:'', narration:'' })); await load(); } catch(e:any){ setErr(e.message); } };
  const exportCsv = (path:string, name:string) => { const base=getApiBaseUrl(); const url=`${base}${path}`; const a=document.createElement('a'); a.href=url; a.download=name; a.click(); };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><Landmark className="w-6 h-6 text-primary"/>Finance & Accounts</h1><p className="text-sm text-muted-foreground">Income/expense, vouchers, journals/ledger, reconciliation and exports (Phase 7).</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=>exportCsv('/api/finance/transactions/export.csv','finance-transactions.csv')} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Download className="w-4 h-4"/>Txns CSV</button>
          <button onClick={()=>exportCsv('/api/finance/ledger/export.csv','finance-ledger.csv')} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Download className="w-4 h-4"/>Ledger CSV</button>
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
        </div>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card label="Income" value={money(summary?.totals?.income)} icon={<ArrowUpCircle className="w-4 h-4 text-emerald-400"/>} />
        <Card label="Expense" value={money(summary?.totals?.expense)} icon={<ArrowDownCircle className="w-4 h-4 text-red-400"/>} />
        <Card label="Net" value={money(summary?.totals?.net)} icon={<Wallet className="w-4 h-4 text-primary"/>} />
        <Card label="Outstanding Dues" value={money(summary?.dues?.outstanding)} sub={`${summary?.dues?.due_invoices||0} due invoices`} icon={<Landmark className="w-4 h-4 text-amber-400"/>} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Panel title="Transactions">
            <table className="w-full text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">Type</th><th className="text-left py-2 px-2">Account</th><th className="text-left py-2 px-2">Method</th><th className="text-left py-2 px-2">Amount</th><th className="text-left py-2 px-2">Description</th></tr></thead>
              <tbody>{txns.map(t=>(<tr key={t.id} className="border-b border-border/50"><td className="py-2 px-2 whitespace-nowrap">{String(t.txn_date).slice(0,10)}</td><td className="py-2 px-2"><span className={`px-2 py-0.5 rounded-full border ${['INCOME','COLLECTION'].includes(t.txn_type)?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':'bg-red-500/10 text-red-400 border-red-500/20'}`}>{t.txn_type}</span></td><td className="py-2 px-2">{t.account_name||'-'}</td><td className="py-2 px-2">{t.method||'-'}</td><td className="py-2 px-2 font-semibold">{money(t.amount)}</td><td className="py-2 px-2 text-muted-foreground truncate max-w-[260px]" title={t.description||''}>{t.description||t.reference_id||'-'}</td></tr>))}{!txns.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No transactions yet.</td></tr>}</tbody>
            </table>
          </Panel>
          <Panel title="Journal Entries (Double-entry-lite)">
            <div className="space-y-3">{journals.slice(0,30).map((j:any)=>(<div key={j.id} className="p-3 rounded-xl border border-border bg-muted/20"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><div><b>{j.entry_no}</b> • {String(j.entry_date).slice(0,10)} • {j.source_type||'MANUAL'} {j.source_id||''}</div><div className="text-muted-foreground">{j.description||''}</div></div><table className="w-full text-xs mt-2"><tbody>{(j.lines||[]).map((l:any,i:number)=>(<tr key={i} className="border-t border-border/40"><td className="py-1">{l.account_code} {l.account_name||''}</td><td className="py-1 text-right">{Number(l.debit)>0?money(l.debit):''}</td><td className="py-1 text-right">{Number(l.credit)>0?money(l.credit):''}</td></tr>))}</tbody></table></div>))}{!journals.length && <div className="py-6 text-center text-muted-foreground text-sm">No journal entries yet (post vouchers or transactions with debit/credit accounts).</div>}</div>
          </Panel>
          <Panel title="Vouchers">
            <table className="w-full text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">No</th><th className="text-left py-2 px-2">Type</th><th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">Amount</th><th className="text-left py-2 px-2">Narration</th></tr></thead>
              <tbody>{vouchers.map(v=>(<tr key={v.id} className="border-b border-border/50"><td className="py-2 px-2 font-mono">{v.voucher_no}</td><td className="py-2 px-2">{v.voucher_type}</td><td className="py-2 px-2">{String(v.date).slice(0,10)}</td><td className="py-2 px-2 font-semibold">{money(v.amount)}</td><td className="py-2 px-2 text-muted-foreground">{v.narration||'-'}</td></tr>))}{!vouchers.length && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No vouchers.</td></tr>}</tbody>
            </table>
          </Panel>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h2 className="font-bold">Reconciliation</h2>
            <div className="text-sm space-y-1"><div className="flex justify-between"><span className="text-muted-foreground">Completed payments</span><span className="font-semibold">{money(recon?.completed_payments?.completed)} ({recon?.completed_payments?.count||0})</span></div><div className="flex justify-between"><span className="text-muted-foreground">Finance collections</span><span className="font-semibold">{money(recon?.finance_collections?.collected)} ({recon?.finance_collections?.count||0})</span></div><div className="flex justify-between"><span className="text-muted-foreground">Unmatched completed</span><span className={`font-semibold ${(recon?.unmatched_completed_payments?.length||0)>0?'text-amber-400':''}`}>{recon?.unmatched_completed_payments?.length||0}</span></div></div>
            {!!(recon?.unmatched_completed_payments?.length) && <div className="text-xs text-muted-foreground max-h-28 overflow-auto">Unmatched refs: {(recon.unmatched_completed_payments||[]).slice(0,10).map((p:any)=>p.payment_ref).join(', ')}</div>}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h2 className="font-bold flex items-center gap-2"><Plus className="w-4 h-4 text-primary"/>Record Transaction</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <input type="date" className="p-2.5 rounded-xl border border-border bg-card" value={txnForm.txn_date} onChange={e=>setTxnForm({...txnForm,txn_date:e.target.value})} />
              <select className="p-2.5 rounded-xl border border-border bg-card" value={txnForm.txn_type} onChange={e=>setTxnForm({...txnForm,txn_type:e.target.value})}>{['INCOME','EXPENSE','COLLECTION','PAYMENT','TRANSFER','ADJUSTMENT'].map(x=><option key={x} value={x}>{x}</option>)}</select>
              <select className="p-2.5 rounded-xl border border-border bg-card" value={txnForm.account_id} onChange={e=>setTxnForm({...txnForm,account_id:e.target.value})}><option value="">Debit/Account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code?`${a.code} - `:''}{a.name}</option>)}</select>
              <select className="p-2.5 rounded-xl border border-border bg-card" value={txnForm.counter_account_id} onChange={e=>setTxnForm({...txnForm,counter_account_id:e.target.value})}><option value="">Credit/Counter</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code?`${a.code} - `:''}{a.name}</option>)}</select>
              <select className="p-2.5 rounded-xl border border-border bg-card" value={txnForm.method} onChange={e=>setTxnForm({...txnForm,method:e.target.value})}>{['CASH','BANK','BKASH','NAGAD','ROCKET','CARD','OTHER'].map(x=><option key={x} value={x}>{x}</option>)}</select>
              <input type="number" placeholder="Amount" className="p-2.5 rounded-xl border border-border bg-card" value={txnForm.amount} onChange={e=>setTxnForm({...txnForm,amount:e.target.value})} />
              <input placeholder="Description" className="p-2.5 rounded-xl border border-border bg-card col-span-2" value={txnForm.description} onChange={e=>setTxnForm({...txnForm,description:e.target.value})} />
            </div>
            <button onClick={addTxn} disabled={!canManage || !txnForm.amount} className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50">Save Transaction</button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h2 className="font-bold">Post Voucher</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <select className="p-2.5 rounded-xl border border-border bg-card" value={voucherForm.voucher_type} onChange={e=>setVoucherForm({...voucherForm,voucher_type:e.target.value})}>{['RECEIPT','PAYMENT','JOURNAL'].map(x=><option key={x} value={x}>{x}</option>)}</select>
              <input type="date" className="p-2.5 rounded-xl border border-border bg-card" value={voucherForm.date} onChange={e=>setVoucherForm({...voucherForm,date:e.target.value})} />
              <select className="p-2.5 rounded-xl border border-border bg-card" value={voucherForm.method} onChange={e=>setVoucherForm({...voucherForm,method:e.target.value})}>{['CASH','BANK','BKASH','NAGAD','ROCKET','OTHER'].map(x=><option key={x} value={x}>{x}</option>)}</select>
              <input type="number" placeholder="Amount" className="p-2.5 rounded-xl border border-border bg-card" value={voucherForm.amount} onChange={e=>setVoucherForm({...voucherForm,amount:e.target.value})} />
              <input placeholder="Narration" className="p-2.5 rounded-xl border border-border bg-card col-span-2" value={voucherForm.narration} onChange={e=>setVoucherForm({...voucherForm,narration:e.target.value})} />
            </div>
            <button onClick={addVoucher} disabled={!canManage || !voucherForm.amount} className="w-full px-4 py-2.5 rounded-xl border border-border bg-card font-semibold disabled:opacity-50">Post Voucher</button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold mb-2">Accounts & Balances</h2>
            <div className="space-y-1 max-h-56 overflow-auto text-xs">
              {accounts.map(a=>(<div key={a.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 gap-2"><span className="truncate"><span className="text-muted-foreground">{a.code}</span> {a.name}</span><span className="text-muted-foreground whitespace-nowrap">{a.type} • {money(a.balance)}</span></div>))}
              {!accounts.length && <div className="text-muted-foreground">No accounts.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Panel({title,children}:any){ return <div className="rounded-2xl border border-border bg-card p-4"><h2 className="font-bold mb-3">{title}</h2><div className="overflow-auto max-h-[360px]">{children}</div></div>; }
function Card({ label, value, sub, icon }: any) { return (<div className="p-4 rounded-2xl border border-border bg-card"><div className="flex items-center justify-between text-xs text-muted-foreground mb-1"><span>{label}</span>{icon}</div><div className="text-xl font-black">{value}</div>{sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}</div>); }
