'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Wifi, Plus, Ticket } from 'lucide-react';

function money(v:any){ const n=Number(v||0); return `৳${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

export default function HotspotPage() {
  const { token, user } = useAuth();
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [recon, setRecon] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [msg, setMsg] = useState<string|null>(null);
  const canManage = ['SUPER_ADMIN','BILLING_OPERATOR'].includes(String(user?.role));
  const [gen, setGen] = useState<any>({ count:10, plan_name:'1 Day', price:30, duration_hours:24, data_limit_mb:'', prefix:'HS-' });

  const load = useCallback(async () => {
    if(!token) return; setLoading(true); setErr(null);
    try {
      const [v,s,r] = await Promise.all([
        apiFetch<any>('/api/hotspot/vouchers', {}, token),
        apiFetch<any>('/api/hotspot/summary', {}, token),
        apiFetch<any>('/api/hotspot/reconciliation', {}, token).catch(()=>({data:null})),
      ]);
      setVouchers(v.data||[]); setSummary(s.data||null); setRecon(r.data||null);
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token]);
  useEffect(()=>{ load(); }, [load]);

  const generate = async () => { if(!token) return; setErr(null); setMsg(null); try { const r=await apiFetch<any>('/api/hotspot/vouchers/generate',{method:'POST',body:JSON.stringify({ ...gen, count:Number(gen.count||1), price:Number(gen.price||0), duration_hours: gen.duration_hours?Number(gen.duration_hours):null, data_limit_mb: gen.data_limit_mb?Number(gen.data_limit_mb):null })},token); setMsg(`Generated ${r.count} vouchers (batch ${r.batch_no})`); await load(); } catch(e:any){ setErr(e.message);} };
  const sell = async (id:string) => { if(!token) return; try { await apiFetch(`/api/hotspot/vouchers/${id}/sell`,{method:'POST',body:JSON.stringify({})},token); setMsg('Voucher marked SOLD (income recorded)'); await load(); } catch(e:any){ setErr(e.message);} };
  const activate = async (id:string) => { if(!token) return; try { const r=await apiFetch<any>(`/api/hotspot/vouchers/${id}/activate`,{method:'POST',body:JSON.stringify({})},token); setMsg(r.sync?.note || 'Voucher activated'); await load(); } catch(e:any){ setErr(e.message);} };
  const expire = async (id:string) => { if(!token) return; try { await apiFetch(`/api/hotspot/vouchers/${id}/expire`,{method:'POST'},token); await load(); } catch(e:any){ setErr(e.message);} };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div><h1 className="page-title"><Wifi className="w-6 h-6 text-primary"/>Hotspot Vouchers</h1><p className="text-sm text-muted-foreground">Prepaid voucher generation, sales, activation/expiry and reconciliation (Phase 7). Live NAS/hotspot enforcement requires controller/RADIUS integration.</p></div>
        <button onClick={load} className="btn btn-outline inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        <K label="Total" value={summary?.total||0} /><K label="Available" value={summary?.available||0} /><K label="Sold" value={summary?.sold||0} /><K label="Active" value={summary?.active||0} /><K label="Used" value={summary?.used||0} /><K label="Expired" value={summary?.expired||0} /><K label="Revenue" value={money(summary?.revenue||0)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <div className="card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><Ticket className="w-4 h-4 text-primary"/>Vouchers</h2>
            <div className="overflow-auto max-h-[460px]">
              <table className="table table-hover text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Code</th><th className="text-left py-2 px-2">Plan</th><th className="text-left py-2 px-2">Price</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Batch</th><th className="text-left py-2 px-2">Actions</th></tr></thead>
                <tbody>{vouchers.map(v=>(<tr key={v.id} className="border-b border-border/50"><td className="py-2 px-2 font-mono font-semibold">{v.code}</td><td className="py-2 px-2">{v.plan_name||'-'}<div className="text-muted-foreground">{v.duration_hours?`${v.duration_hours}h`:''}{v.data_limit_mb?` • ${v.data_limit_mb}MB`:''}</div></td><td className="py-2 px-2">{money(v.price)}</td><td className="py-2 px-2"><span className={`badge ${v.status==='AVAILABLE'?'badge-success':v.status==='SOLD'?'badge-warning':v.status==='ACTIVE'?'badge-info':'badge-secondary'}`}>{v.status}</span></td><td className="py-2 px-2 text-muted-foreground">{v.batch_no||'-'}</td><td className="py-2 px-2 space-x-1">{canManage && v.status==='AVAILABLE' && <button onClick={()=>sell(v.id)} className="btn btn-outline btn-sm">Sell</button>}{canManage && ['AVAILABLE','SOLD'].includes(v.status) && <button onClick={()=>activate(v.id)} className="btn btn-primary btn-sm">Activate</button>}{canManage && v.status==='ACTIVE' && <button onClick={()=>expire(v.id)} className="btn btn-outline btn-sm">Expire</button>}</td></tr>))}{!vouchers.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No vouchers yet.</td></tr>}</tbody>
              </table>
            </div>
          </div>
          <div className="card p-4">
            <h2 className="font-bold mb-2">Reconciliation</h2>
            <div className="text-sm grid grid-cols-1 md:grid-cols-3 gap-3"><div className="p-3 rounded-xl border border-border"><div className="text-xs text-muted-foreground">Sold value (vouchers)</div><div className="font-bold">{money(recon?.summary?.sold_value||0)}</div></div><div className="p-3 rounded-xl border border-border"><div className="text-xs text-muted-foreground">Voucher income (finance)</div><div className="font-bold">{money(recon?.finance_voucher_income||0)}</div></div><div className="p-3 rounded-xl border border-border"><div className="text-xs text-muted-foreground">Batches</div><div className="font-bold">{(recon?.batches||[]).length}</div></div></div>
          </div>
        </div>
        <div className="card p-4 space-y-3">
          <h2 className="font-bold flex items-center gap-2"><Plus className="w-4 h-4 text-primary"/>Generate Vouchers</h2>
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2"><input type="number" placeholder="Count" className="form-control" value={gen.count} onChange={e=>setGen({...gen,count:e.target.value})} /><input placeholder="Prefix" className="form-control" value={gen.prefix} onChange={e=>setGen({...gen,prefix:e.target.value})} /></div>
            <input placeholder="Plan name" className="form-control w-full" value={gen.plan_name} onChange={e=>setGen({...gen,plan_name:e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input type="number" placeholder="Price (BDT)" className="form-control" value={gen.price} onChange={e=>setGen({...gen,price:e.target.value})} /><input type="number" placeholder="Duration (hours)" className="form-control" value={gen.duration_hours} onChange={e=>setGen({...gen,duration_hours:e.target.value})} /></div>
            <input type="number" placeholder="Data limit MB (optional)" className="form-control w-full" value={gen.data_limit_mb} onChange={e=>setGen({...gen,data_limit_mb:e.target.value})} />
          </div>
          <button onClick={generate} disabled={!canManage} className="btn btn-primary w-full">Generate Batch</button>
          <div className="text-xs text-muted-foreground">Selling records income in finance; activation sets expiry. For live hotspot access control, integrate voucher auth with your RADIUS/hotspot controller (sync hook returned on activate).</div>
        </div>
      </div>
    </div>
  );
}

function K({label,value}:any){ return <div className="card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-black">{value}</div></div>; }
