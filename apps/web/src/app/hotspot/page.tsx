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
      <div className="page-header items-start">
        <div><span className="page-eyebrow">Network · Hotspot</span><h1 className="page-title"><Wifi className="w-6 h-6 text-primary"/>Hotspot Vouchers</h1><p className="page-subtitle">Prepaid voucher generation, sales, activation/expiry and reconciliation (Phase 7). Live NAS/hotspot enforcement requires controller/RADIUS integration.</p></div>
        <div className="page-actions"><button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button></div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="stat-grid-7">
        <K label="Total" value={summary?.total||0} tone="primary" /><K label="Available" value={summary?.available||0} tone="success" /><K label="Sold" value={summary?.sold||0} tone="warning" /><K label="Active" value={summary?.active||0} tone="info" /><K label="Used" value={summary?.used||0} tone="teal" /><K label="Expired" value={summary?.expired||0} tone="danger" /><K label="Revenue" value={money(summary?.revenue||0)} tone="purple" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <div className="card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><Ticket className="w-4 h-4 text-primary"/>Vouchers</h2>
            <div className="table-wrap overflow-auto max-h-[460px]">
              <table className="table table-hover text-[11px]"><thead className="sticky top-0 z-10"><tr><th className="px-3 py-2.5">Code</th><th className="px-3 py-2.5">Plan</th><th className="px-3 py-2.5">Price</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Batch</th><th className="px-3 py-2.5">Actions</th></tr></thead>
                <tbody>{vouchers.map(v=>(<tr key={v.id} className="border-b border-border/50"><td className="px-3 py-2.5 font-mono font-semibold">{v.code}</td><td className="px-3 py-2.5">{v.plan_name||'-'}<div className="text-muted-foreground">{v.duration_hours?`${v.duration_hours}h`:''}{v.data_limit_mb?` • ${v.data_limit_mb}MB`:''}</div></td><td className="px-3 py-2.5 tabular-nums">{money(v.price)}</td><td className="px-3 py-2.5"><span className={`badge ${v.status==='AVAILABLE'?'badge-success':v.status==='SOLD'?'badge-warning':v.status==='ACTIVE'?'badge-info':'badge-secondary'}`}>{v.status}</span></td><td className="px-3 py-2.5 text-muted-foreground">{v.batch_no||'-'}</td><td className="px-3 py-2.5 space-x-1">{canManage && v.status==='AVAILABLE' && <button onClick={()=>sell(v.id)} className="btn btn-outline btn-sm">Sell</button>}{canManage && ['AVAILABLE','SOLD'].includes(v.status) && <button onClick={()=>activate(v.id)} className="btn btn-primary btn-sm">Activate</button>}{canManage && v.status==='ACTIVE' && <button onClick={()=>expire(v.id)} className="btn btn-outline btn-sm">Expire</button>}</td></tr>))}{!vouchers.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No vouchers yet.</td></tr>}</tbody>
              </table>
            </div>
          </div>
          <div className="card p-4">
            <h2 className="font-bold mb-2">Reconciliation</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><div className="dash-stat compact dash-stat-success"><span className="dash-stat-body"><span className="dash-stat-label">Sold value (vouchers)</span><span className="dash-stat-value text-sm tabular-nums">{money(recon?.summary?.sold_value||0)}</span></span></div><div className="dash-stat compact dash-stat-info"><span className="dash-stat-body"><span className="dash-stat-label">Voucher income (finance)</span><span className="dash-stat-value text-sm tabular-nums">{money(recon?.finance_voucher_income||0)}</span></span></div><div className="dash-stat compact dash-stat-purple"><span className="dash-stat-body"><span className="dash-stat-label">Batches</span><span className="dash-stat-value">{(recon?.batches||[]).length}</span></span></div></div>
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

function K({label,value,tone='primary'}:any){ return <div className={`dash-stat compact dash-stat-${tone}`}><span className="dash-stat-body"><span className="dash-stat-label">{label}</span><span className="dash-stat-value">{value}</span></span></div>; }
