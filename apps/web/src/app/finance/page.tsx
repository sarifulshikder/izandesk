'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, downloadAuthenticatedFile } from '@/lib/api';
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
  const exportCsv = async (path:string, name:string) => {
    try { await downloadAuthenticatedFile(path, name, token); }
    catch (e:any) { setErr(e.message); }
  };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div><span className="page-eyebrow">Finance operations · Ledger &amp; controls</span><h1 className="page-title"><Landmark className="w-6 h-6 text-primary"/>Finance &amp; Accounts</h1><p className="page-subtitle">Income/expense, vouchers, journals/ledger, reconciliation and exports (Phase 7).</p></div>
        <div className="page-actions">
          <button onClick={()=>exportCsv('/api/finance/transactions/export.csv','finance-transactions.csv')} className="btn btn-outline"><Download className="w-4 h-4"/>Txns CSV</button>
          <button onClick={()=>exportCsv('/api/finance/ledger/export.csv','finance-ledger.csv')} className="btn btn-outline"><Download className="w-4 h-4"/>Ledger CSV</button>
          <button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
        </div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="stat-grid">
        <Card label="Income" value={money(summary?.totals?.income)} tone="success" icon={ArrowUpCircle} />
        <Card label="Expense" value={money(summary?.totals?.expense)} tone="danger" icon={ArrowDownCircle} />
        <Card label="Net" value={money(summary?.totals?.net)} tone="primary" icon={Wallet} />
        <Card label="Outstanding Dues" value={money(summary?.dues?.outstanding)} sub={`${summary?.dues?.due_invoices||0} due invoices`} tone="warning" icon={Landmark} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <Panel title="Transactions">
            <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Account</th><th className="px-3 py-2.5">Method</th><th className="px-3 py-2.5">Amount</th><th className="px-3 py-2.5">Description</th></tr></thead>
              <tbody>{txns.map(t=>(<tr key={t.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px] whitespace-nowrap">{String(t.txn_date).slice(0,10)}</td><td className="px-3 py-2.5 text-[11px]"><span className={`badge ${['INCOME','COLLECTION'].includes(t.txn_type)?'badge-success':'badge-danger'}`}>{t.txn_type}</span></td><td className="px-3 py-2.5 text-[11px]">{t.account_name||'-'}</td><td className="px-3 py-2.5 text-[11px]">{t.method||'-'}</td><td className="px-3 py-2.5 text-[11px] font-semibold tabular-nums">{money(t.amount)}</td><td className="px-3 py-2.5 text-[11px] text-muted-foreground truncate max-w-[260px]" title={t.description||''}>{t.description||t.reference_id||'-'}</td></tr>))}{!txns.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No transactions yet.</td></tr>}</tbody>
            </table>
          </Panel>
          <Panel title="Journal Entries (Double-entry-lite)">
            <div className="space-y-3">{journals.slice(0,30).map((j:any)=>(<div key={j.id} className="card card-body-sm"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><div><b>{j.entry_no}</b> • {String(j.entry_date).slice(0,10)} • {j.source_type||'MANUAL'} {j.source_id||''}</div><div className="text-muted-foreground">{j.description||''}</div></div><table className="table table-hover mt-2"><tbody>{(j.lines||[]).map((l:any,i:number)=>(<tr key={i} className="border-t border-border/40"><td className="px-3 py-2 text-[11px]">{l.account_code} {l.account_name||''}</td><td className="px-3 py-2 text-[11px] text-right tabular-nums">{Number(l.debit)>0?money(l.debit):''}</td><td className="px-3 py-2 text-[11px] text-right tabular-nums">{Number(l.credit)>0?money(l.credit):''}</td></tr>))}</tbody></table></div>))}{!journals.length && <div className="py-6 text-center text-muted-foreground text-sm">No journal entries yet (post vouchers or transactions with debit/credit accounts).</div>}</div>
          </Panel>
          <Panel title="Vouchers">
            <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">No</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Amount</th><th className="px-3 py-2.5">Narration</th></tr></thead>
              <tbody>{vouchers.map(v=>(<tr key={v.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px] font-mono">{v.voucher_no}</td><td className="px-3 py-2.5 text-[11px]">{v.voucher_type}</td><td className="px-3 py-2.5 text-[11px]">{String(v.date).slice(0,10)}</td><td className="px-3 py-2.5 text-[11px] font-semibold tabular-nums">{money(v.amount)}</td><td className="px-3 py-2.5 text-[11px] text-muted-foreground">{v.narration||'-'}</td></tr>))}{!vouchers.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No vouchers.</td></tr>}</tbody>
            </table>
          </Panel>
        </div>

        <div className="space-y-5">
          <div className="card p-4 space-y-3">
            <h2 className="card-title">Reconciliation</h2>
            <div className="text-sm space-y-1"><div className="flex justify-between"><span className="text-muted-foreground">Completed payments</span><span className="font-semibold">{money(recon?.completed_payments?.completed)} ({recon?.completed_payments?.count||0})</span></div><div className="flex justify-between"><span className="text-muted-foreground">Finance collections</span><span className="font-semibold">{money(recon?.finance_collections?.collected)} ({recon?.finance_collections?.count||0})</span></div><div className="flex justify-between"><span className="text-muted-foreground">Unmatched completed</span><span className={`font-semibold ${(recon?.unmatched_completed_payments?.length||0)>0?'text-warning tabular-nums':''}`}>{recon?.unmatched_completed_payments?.length||0}</span></div></div>
            {!!(recon?.unmatched_completed_payments?.length) && <div className="text-xs text-muted-foreground max-h-28 overflow-auto">Unmatched refs: {(recon.unmatched_completed_payments||[]).slice(0,10).map((p:any)=>p.payment_ref).join(', ')}</div>}
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="card-title flex items-center gap-2"><Plus className="w-4 h-4 text-primary"/>Record Transaction</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <input type="date" className="form-control" value={txnForm.txn_date} onChange={e=>setTxnForm({...txnForm,txn_date:e.target.value})} />
              <select className="form-select" value={txnForm.txn_type} onChange={e=>setTxnForm({...txnForm,txn_type:e.target.value})}>{['INCOME','EXPENSE','COLLECTION','PAYMENT','TRANSFER','ADJUSTMENT'].map(x=><option key={x} value={x}>{x}</option>)}</select>
              <select className="form-select" value={txnForm.account_id} onChange={e=>setTxnForm({...txnForm,account_id:e.target.value})}><option value="">Debit/Account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code?`${a.code} - `:''}{a.name}</option>)}</select>
              <select className="form-select" value={txnForm.counter_account_id} onChange={e=>setTxnForm({...txnForm,counter_account_id:e.target.value})}><option value="">Credit/Counter</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code?`${a.code} - `:''}{a.name}</option>)}</select>
              <select className="form-select" value={txnForm.method} onChange={e=>setTxnForm({...txnForm,method:e.target.value})}>{['CASH','BANK','BKASH','NAGAD','ROCKET','CARD','OTHER'].map(x=><option key={x} value={x}>{x}</option>)}</select>
              <input type="number" placeholder="Amount" className="form-control" value={txnForm.amount} onChange={e=>setTxnForm({...txnForm,amount:e.target.value})} />
              <input placeholder="Description" className="form-control col-span-2" value={txnForm.description} onChange={e=>setTxnForm({...txnForm,description:e.target.value})} />
            </div>
            <button onClick={addTxn} disabled={!canManage || !txnForm.amount} className="btn btn-primary w-full">Save Transaction</button>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="card-title">Post Voucher</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <select className="form-select" value={voucherForm.voucher_type} onChange={e=>setVoucherForm({...voucherForm,voucher_type:e.target.value})}>{['RECEIPT','PAYMENT','JOURNAL'].map(x=><option key={x} value={x}>{x}</option>)}</select>
              <input type="date" className="form-control" value={voucherForm.date} onChange={e=>setVoucherForm({...voucherForm,date:e.target.value})} />
              <select className="form-select" value={voucherForm.method} onChange={e=>setVoucherForm({...voucherForm,method:e.target.value})}>{['CASH','BANK','BKASH','NAGAD','ROCKET','OTHER'].map(x=><option key={x} value={x}>{x}</option>)}</select>
              <input type="number" placeholder="Amount" className="form-control" value={voucherForm.amount} onChange={e=>setVoucherForm({...voucherForm,amount:e.target.value})} />
              <input placeholder="Narration" className="form-control col-span-2" value={voucherForm.narration} onChange={e=>setVoucherForm({...voucherForm,narration:e.target.value})} />
            </div>
            <button onClick={addVoucher} disabled={!canManage || !voucherForm.amount} className="btn btn-outline w-full">Post Voucher</button>
          </div>

          <div className="card p-4">
            <h2 className="card-title mb-2">Accounts & Balances</h2>
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

function Panel({title,children}:any){ return <div className="card p-4"><h2 className="card-title mb-3">{title}</h2><div className="table-wrap overflow-auto max-h-[360px]">{children}</div></div>; }
function Card({ label, value, sub, tone = 'primary', icon: Icon }: any) { return (<div className={`dash-stat dash-stat-${tone}`}><span className="dash-stat-icon"><Icon /></span><span className="dash-stat-body"><span className="dash-stat-label">{label}</span><span className="dash-stat-value">{value}</span>{sub && <span className="dash-stat-hint">{sub}</span>}</span></div>); }
