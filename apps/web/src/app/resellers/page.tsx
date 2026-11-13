'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Wallet, Users, ArrowUpRight, ArrowDownLeft, Plus, Building2, CreditCard, BadgePercent, Globe } from 'lucide-react';

type AnyObj = Record<string, any>;
const money = (v:any) => `৳${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export default function ResellersPage() {
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
  const [newReseller, setNewReseller] = useState<any>({ name:'', company_name:'', tier:'STANDARD', email:'', phone:'', subdomain:'', brand_name:'', portal_title:'', commission_percent:10, buying_margin_percent:15, wallet_balance:0 });

  const isReseller = user?.role === 'RESELLER';
  const canManage = ['SUPER_ADMIN','BILLING_OPERATOR'].includes(String(user?.role));

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

  const createReseller = async () => {
    if (!token) return;
    try {
      await apiFetch('/api/resellers', { method:'POST', body: JSON.stringify(newReseller) }, token);
      setMsg('Reseller created');
      setNewReseller({ name:'', company_name:'', tier:'STANDARD', email:'', phone:'', subdomain:'', brand_name:'', portal_title:'', commission_percent:10, buying_margin_percent:15, wallet_balance:0 });
      await load();
    } catch(e:any){ setErr(e.message); }
  };

  const selected = detail || resellers.find(r=>r.id===selectedId) || null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Resellers & Wallet</h1>
          <p className="text-sm text-muted-foreground">Multi-tier reseller management, white-label portal settings, prepaid wallet, margins and subscriber renewals via reseller credit.</p>
        </div>
        <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}
      {renewMsg && <div className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-sm">{renewMsg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="space-y-4">
          {!isReseller && <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-primary"/>Resellers</h2>
            <div className="space-y-2 max-h-[420px] overflow-auto">
              {resellers.map(r => (
                <button key={r.id} onClick={()=>setSelectedId(r.id)} className={`w-full text-left p-3 rounded-xl border ${selectedId===r.id?'border-primary bg-primary/10':'border-border bg-muted/20 hover:bg-muted/40'}`}>
                  <div className="flex items-center justify-between gap-2"><div className="font-semibold text-sm">{r.name}</div><span className="text-[10px] px-2 py-0.5 rounded-full border border-border">{r.tier}</span></div>
                  <div className="text-xs text-muted-foreground mt-1">{r.company_name || r.code} • {r.subdomain ? `${r.subdomain}.(subdomain)` : 'no subdomain'} • {r.subscriber_count || 0} subs</div>
                  <div className="text-xs mt-1 font-semibold text-emerald-400">Wallet: {money(r.wallet_balance)}</div>
                </button>
              ))}
              {!resellers.length && <div className="text-sm text-muted-foreground">No resellers found.</div>}
            </div>
          </div>}

          {canManage && <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h2 className="font-bold flex items-center gap-2"><Plus className="w-4 h-4 text-primary"/>Create Reseller</h2>
            {[
              ['Name','name'],['Company','company_name'],['Email','email'],['Phone','phone'],['Subdomain','subdomain'],['Brand Name','brand_name'],['Portal Title','portal_title']
            ].map(([label,key]:any)=>(
              <input key={key} className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" placeholder={label} value={newReseller[key]||''} onChange={e=>setNewReseller((v:any)=>({...v,[key]:e.target.value}))} />
            ))}
            <div className="grid grid-cols-2 gap-2">
              <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" placeholder="Tier (STANDARD/GOLD)" value={newReseller.tier} onChange={e=>setNewReseller((v:any)=>({...v,tier:e.target.value}))} />
              <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" type="number" placeholder="Buying margin %" value={newReseller.buying_margin_percent} onChange={e=>setNewReseller((v:any)=>({...v,buying_margin_percent:e.target.value}))} />
            </div>
            <button onClick={createReseller} className="w-full px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">Create Reseller</button>
          </div>}
        </div>

        <div className="xl:col-span-2 space-y-4">
          {selected ? <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5"><div className="text-xs text-emerald-300/80 flex items-center gap-1"><Wallet className="w-3.5 h-3.5"/>Wallet Balance</div><div className="text-xl font-black text-emerald-400 mt-1">{money(selected.wallet_balance ?? wallet?.balance)}</div></div>
              <div className="p-4 rounded-2xl border border-border bg-card"><div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3.5 h-3.5"/>Subscribers</div><div className="text-xl font-black mt-1">{selected.subscriber_count ?? subs.length}</div></div>
              <div className="p-4 rounded-2xl border border-border bg-card"><div className="text-xs text-muted-foreground flex items-center gap-1"><BadgePercent className="w-3.5 h-3.5"/>Buying Margin</div><div className="text-xl font-black mt-1">{Number(selected.buying_margin_percent||0)}%</div></div>
              <div className="p-4 rounded-2xl border border-border bg-card"><div className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="w-3.5 h-3.5"/>Portal</div><div className="text-sm font-bold mt-2 truncate">{selected.subdomain ? `${selected.subdomain}.` : (selected.custom_domain || 'Not configured')}</div></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <h2 className="font-bold flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-emerald-400"/>Wallet Recharge</h2>
                <p className="text-xs text-muted-foreground">Recharge prepaid reseller wallet balance (manual/admin or reseller self-recharge flow).</p>
                <div className="flex gap-2">
                  <input className="flex-1 p-2.5 rounded-xl border border-border bg-card text-sm" type="number" placeholder="Amount (BDT)" value={rechargeAmount} onChange={e=>setRechargeAmount(e.target.value)} />
                  <button onClick={recharge} className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold">Recharge</button>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <h2 className="font-bold flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary"/>Renew Subscriber (Auto-deduct Wallet)</h2>
                <p className="text-xs text-muted-foreground">Renew a subscriber using reseller credit. Wholesale charge = retail monthly bill minus buying margin; deducted from wallet and recorded as payment/transaction.</p>
                <select className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" value={renewSubId} onChange={e=>setRenewSubId(e.target.value)}>
                  <option value="">Select subscriber...</option>
                  {subs.map(s => <option key={s.id} value={s.id}>{s.client_code || s.username} — {s.full_name} (Due {money(s.current_due)} • Bill {money(s.monthly_bill)})</option>)}
                </select>
                <button onClick={renew} disabled={!renewSubId} className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">Renew with Reseller Credit</button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-border bg-card p-4">
                <h2 className="font-bold mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-primary"/>Reseller Subscribers</h2>
                <div className="overflow-auto max-h-[320px]">
                  <table className="w-full text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Subscriber</th><th className="text-left py-2 px-2">Package</th><th className="text-left py-2 px-2">Due</th><th className="text-left py-2 px-2">Status</th></tr></thead>
                    <tbody>{subs.map(s=>(
                      <tr key={s.id} className="border-b border-border/50"><td className="py-2 px-2"><div className="font-medium">{s.full_name}</div><div className="text-muted-foreground font-mono">{s.client_code||s.username}</div></td><td className="py-2 px-2">{s.package_name||'-'}<div className="text-muted-foreground">{money(s.monthly_bill)}</div></td><td className="py-2 px-2 font-semibold text-amber-400">{money(s.current_due)}</td><td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full border border-border">{s.status}</span></td></tr>
                    ))}{!subs.length && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No subscribers assigned to this reseller yet.</td></tr>}</tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-4">
                <h2 className="font-bold mb-3 flex items-center gap-2"><ArrowDownLeft className="w-4 h-4 text-primary"/>Wallet Transactions</h2>
                <div className="overflow-auto max-h-[320px]">
                  <table className="w-full text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Time</th><th className="text-left py-2 px-2">Type</th><th className="text-left py-2 px-2">Amount</th><th className="text-left py-2 px-2">Balance</th></tr></thead>
                    <tbody>{(wallet?.transactions||[]).map((t:any)=>(
                      <tr key={t.id} className="border-b border-border/50"><td className="py-2 px-2 text-muted-foreground">{t.created_at ? new Date(t.created_at).toLocaleString() : '-'}</td><td className="py-2 px-2"><div className="font-medium">{t.type}</div><div className="text-muted-foreground truncate max-w-[180px]">{t.description}</div></td><td className={`py-2 px-2 font-semibold ${t.direction==='CREDIT'?'text-emerald-400':'text-red-400'}`}>{t.direction==='CREDIT'?'+':'-'}{money(t.amount)}</td><td className="py-2 px-2">{money(t.balance_after)}</td></tr>
                    ))}{!(wallet?.transactions||[]).length && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No wallet transactions yet.</td></tr>}</tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="font-bold mb-2">White-label / Portal Branding</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                <Info label="Reseller" value={selected.name} />
                <Info label="Company" value={selected.company_name || '-'} />
                <Info label="Tier" value={selected.tier} />
                <Info label="Status" value={selected.status} />
                <Info label="Subdomain" value={selected.subdomain ? `${selected.subdomain}.<your-domain>` : '-'} />
                <Info label="Custom Domain" value={selected.custom_domain || '-'} />
                <Info label="Brand Name" value={selected.brand_name || '-'} />
                <Info label="Portal Title" value={selected.portal_title || '-'} />
              </div>
              <p className="text-xs text-muted-foreground mt-3">White-label branding data (subdomain/custom domain, brand, colors/logo/title) is stored per reseller. Subdomain/custom-domain routing requires DNS and reverse-proxy (Caddy) host mapping in deployment.</p>
            </div>
          </> : <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Select a reseller to view wallet, subscribers, and portal settings.</div>}
        </div>
      </div>
    </div>
  );
}

function Info({label,value}:{label:string;value:any}) {
  return <div className="p-2.5 rounded-xl bg-muted/30 border border-border/60"><div className="text-[11px] text-muted-foreground">{label}</div><div className="font-medium break-words">{String(value ?? '-')}</div></div>;
}
