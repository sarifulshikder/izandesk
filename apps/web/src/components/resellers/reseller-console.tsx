'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Wallet, Users, ArrowUpRight, ArrowDownLeft, Building2, CreditCard, BadgePercent, Globe } from 'lucide-react';

type AnyObj = Record<string, any>;
const money = (v:any) => `৳${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export function ResellerConsole({ mode }: { mode: 'wallet' | 'renew' }) {
  const { token, user } = useAuth();
  const [resellers, setResellers] = useState<AnyObj[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<AnyObj|null>(null);
  const [wallet, setWallet] = useState<AnyObj|null>(null);
  const [subs, setSubs] = useState<AnyObj[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string|null>(null);
  const [err, setErr] = useState<string|null>(null);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [renewSubId, setRenewSubId] = useState('');
  const [renewMsg, setRenewMsg] = useState<string|null>(null);

  const isReseller = user?.role === 'RESELLER';

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const r = await apiFetch<any>('/api/resellers', {}, token);
      const list = r.data || [];
      setResellers(list);
      const id = selectedId || list[0]?.id || '';
      if (id) {
        setSelectedId(id);
        const [d, w, s] = await Promise.all([
          apiFetch<any>(`/api/resellers/${id}`, {}, token).catch(()=>({data:null})),
          apiFetch<any>(`/api/resellers/${id}/wallet`, {}, token).catch(()=>({data:null})),
          apiFetch<any>(`/api/resellers/${id}/subscribers`, {}, token).catch(()=>({data:[]})),
        ]);
        setDetail(d.data); setWallet(w.data); setSubs(s.data || []);
      } else { setDetail(null); setWallet(null); setSubs([]); }
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token, selectedId]);

  useEffect(()=>{ load(); }, [load]);

  const recharge = async () => {
    if (!token || !selectedId) return;
    const amount = Number(rechargeAmount);
    if (!(amount > 0)) { setErr('Enter a valid recharge amount'); return; }
    setErr(null); setMsg(null);
    try {
      const r = await apiFetch<any>(`/api/resellers/${selectedId}/wallet/recharge`, { method:'POST', body: JSON.stringify({ amount, description: 'Manual wallet recharge' }) }, token);
      setMsg(`Wallet recharged ${money(amount)}. New balance: ${money(r.balance)}`);
      setRechargeAmount('');
      await load();
    } catch(e:any){ setErr(e.message); }
  };

  const renew = async () => {
    if (!token || !selectedId || !renewSubId) return;
    setErr(null); setRenewMsg(null);
    try {
      const r = await apiFetch<any>(`/api/resellers/${selectedId}/renew-subscriber`, { method:'POST', body: JSON.stringify({ subscriber_id: renewSubId }) }, token);
      setRenewMsg(`Renewed subscriber using reseller credit. Charged ${money(r.charged)} (retail ${money(r.retail)}, margin ${r.margin_percent}%). Wallet balance: ${money(r.balance)}.`);
      setRenewSubId('');
      await load();
    } catch(e:any){ setErr(e.message); }
  };

  const selected = detail || resellers.find(r=>r.id===selectedId) || null;
  const title = mode === 'wallet' ? 'Wallet & Recharge' : 'Renew Subscriber';
  const subtitle = mode === 'wallet'
    ? 'Manage prepaid reseller wallet balance, recharge, and transaction ledger.'
    : 'Renew subscribers using reseller wallet credit with wholesale margin auto-deduction.';

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <button onClick={load} className="btn btn-outline inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}/>Refresh</button>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}
      {renewMsg && <div className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-sm">{renewMsg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="space-y-4">
          {!isReseller && <div className="card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-primary"/>Resellers</h2>
            <div className="space-y-2 max-h-[420px] overflow-auto">
              {resellers.map(r => (
                <button key={r.id} onClick={()=>setSelectedId(r.id)} className={`w-full text-left p-3 rounded-xl border ${selectedId===r.id?'border-primary bg-primary/10':'border-border bg-muted/20 hover:bg-muted/40'}`}>
                  <div className="flex items-center justify-between gap-2"><div className="font-semibold text-sm">{r.name}</div><span className="text-[10px] px-2 py-0.5 rounded-full border border-border">{r.tier}</span></div>
                  <div className="text-xs text-muted-foreground mt-1">{r.company_name || r.code} • {r.subdomain ? `${r.subdomain}.` : 'no subdomain'} • {r.subscriber_count || 0} subs</div>
                  <div className="text-xs mt-1 font-semibold text-emerald-400">Wallet: {money(r.wallet_balance)}</div>
                </button>
              ))}
              {!resellers.length && <div className="text-sm text-muted-foreground">No resellers found.</div>}
            </div>
          </div>}
        </div>

        <div className="xl:col-span-2 space-y-4">
          {selected ? <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="card p-4 border-success/30"><div className="text-xs text-emerald-300/80 flex items-center gap-1"><Wallet className="w-3.5 h-3.5"/>Wallet Balance</div><div className="text-xl font-black text-emerald-400 mt-1">{money(selected.wallet_balance ?? wallet?.balance)}</div></div>
              <div className="card p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3.5 h-3.5"/>Subscribers</div><div className="text-xl font-black mt-1">{selected.subscriber_count ?? subs.length}</div></div>
              <div className="card p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><BadgePercent className="w-3.5 h-3.5"/>Buying Margin</div><div className="text-xl font-black mt-1">{Number(selected.buying_margin_percent||0)}%</div></div>
              <div className="card p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="w-3.5 h-3.5"/>Portal</div><div className="text-sm font-bold mt-2 truncate">{selected.subdomain ? `${selected.subdomain}.` : (selected.custom_domain || 'Not configured')}</div></div>
            </div>

            {mode === 'wallet' && (
              <div className="grid grid-cols-1 gap-4">
                <div className="card p-4 space-y-3">
                  <h2 className="font-bold flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-emerald-400"/>Wallet Recharge</h2>
                  <p className="text-xs text-muted-foreground">Recharge prepaid reseller wallet balance (manual/admin or reseller self-recharge flow).</p>
                  <div className="flex gap-2">
                    <input className="form-control flex-1" type="number" placeholder="Amount (BDT)" value={rechargeAmount} onChange={e=>setRechargeAmount(e.target.value)} />
                    <button onClick={recharge} className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold">Recharge</button>
                  </div>
                </div>
                <div className="card p-4">
                  <h2 className="font-bold mb-3 flex items-center gap-2"><ArrowDownLeft className="w-4 h-4 text-primary"/>Wallet Transactions</h2>
                  <div className="overflow-auto max-h-[360px]">
                    <table className="table table-hover text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Time</th><th className="text-left py-2 px-2">Type</th><th className="text-left py-2 px-2">Amount</th><th className="text-left py-2 px-2">Balance</th></tr></thead>
                      <tbody>{(wallet?.transactions||[]).map((t:any)=>(
                        <tr key={t.id} className="border-b border-border/50"><td className="py-2 px-2 text-muted-foreground">{t.created_at ? new Date(t.created_at).toLocaleString() : '-'}</td><td className="py-2 px-2"><div className="font-medium">{t.type}</div><div className="text-muted-foreground truncate max-w-[260px]">{t.description}</div></td><td className={`py-2 px-2 font-semibold ${t.direction==='CREDIT'?'text-emerald-400':'text-red-400'}`}>{t.direction==='CREDIT'?'+':'-'}{money(t.amount)}</td><td className="py-2 px-2">{money(t.balance_after)}</td></tr>
                      ))}{!(wallet?.transactions||[]).length && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No wallet transactions yet.</td></tr>}</tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {mode === 'renew' && (
              <>
                <div className="card p-4 space-y-3">
                  <h2 className="font-bold flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary"/>Renew Subscriber (Auto-deduct Wallet)</h2>
                  <p className="text-xs text-muted-foreground">Renew a subscriber using reseller credit. Wholesale charge = retail monthly bill minus buying margin; deducted from wallet and recorded as payment/transaction.</p>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-end">
                    <label className="block lg:col-span-2">
                      <div className="text-xs text-muted-foreground mb-1">Subscriber</div>
                      <select className="form-control w-full" value={renewSubId} onChange={e=>setRenewSubId(e.target.value)}>
                        <option value="">Select subscriber...</option>
                        {subs.map(s => <option key={s.id} value={s.id}>{s.client_code || s.username} — {s.full_name} (Due {money(s.current_due)} • Bill {money(s.monthly_bill)})</option>)}
                      </select>
                    </label>
                    <button onClick={renew} disabled={!renewSubId} className="btn btn-primary w-full">Renew with Reseller Credit</button>
                  </div>
                  {renewSubId && (() => {
                    const s = subs.find(x=>x.id===renewSubId);
                    if (!s) return null;
                    const retail = Number(s.monthly_bill||0);
                    const margin = Number(selected.buying_margin_percent||0);
                    const wholesale = +(retail * (1 - margin/100)).toFixed(2);
                    return <div className="text-xs p-3 rounded-xl border border-border bg-muted/20">Estimated charge: <b>{money(wholesale || retail)}</b> (retail {money(retail)}, margin {margin}%). Wallet after: <b>{money(Number(selected.wallet_balance ?? wallet?.balance ?? 0) - (wholesale || retail))}</b></div>;
                  })()}
                </div>
                <div className="card p-4">
                  <h2 className="font-bold mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-primary"/>Reseller Subscribers</h2>
                  <div className="overflow-auto max-h-[360px]">
                    <table className="table table-hover text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Subscriber</th><th className="text-left py-2 px-2">Package</th><th className="text-left py-2 px-2">Due</th><th className="text-left py-2 px-2">Status</th></tr></thead>
                      <tbody>{subs.map(s=>(
                        <tr key={s.id} className="border-b border-border/50 cursor-pointer hover:bg-muted/30" onClick={()=> setRenewSubId(s.id)}><td className="py-2 px-2"><div className="font-medium">{s.full_name}</div><div className="text-muted-foreground font-mono">{s.client_code||s.username}</div></td><td className="py-2 px-2">{s.package_name||'-'}<div className="text-muted-foreground">{money(s.monthly_bill)}</div></td><td className="py-2 px-2 font-semibold text-amber-400">{money(s.current_due)}</td><td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full border border-border">{s.status}</span></td></tr>
                      ))}{!subs.length && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No subscribers assigned to this reseller yet.</td></tr>}</tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </> : <div className="card border-dashed p-10 text-center text-muted-foreground">Select a reseller to continue.</div>}
        </div>
      </div>
    </div>
  );
}
