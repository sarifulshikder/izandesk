'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Plus, Pencil, Trash2, RefreshCw, Zap, Router, X } from 'lucide-react';

export default function BandwidthPage() {
  const { token } = useAuth();
  const [packages, setPackages] = useState<any[]>([]);
  const [routers, setRouters] = useState<any[]>([]);
  const [syncStatus, setSyncStatus] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [p, r, s] = await Promise.all([
        apiFetch<{data:any[]}>('/api/network/packages', {}, token),
        apiFetch<{data:any[]}>('/api/network/routers', {}, token),
        apiFetch<{data:any[]}>('/api/network/packages/sync-status', {}, token),
      ]);
      setPackages(p.data||[]); setRouters(r.data||[]); setSyncStatus(s.data||[]);
    } catch(e:any){ setError(e.message); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!token) return;
    try {
      if (modal === 'new') await apiFetch('/api/network/packages', { method:'POST', body: JSON.stringify(form) }, token);
      else await apiFetch(`/api/network/packages/${modal.id}`, { method:'PUT', body: JSON.stringify(form) }, token);
      setModal(null); await load();
    } catch(e:any){ setError(e.message); }
  };
  const del = async (id:string) => { if(!token||!confirm('Delete package?')) return; await apiFetch(`/api/network/packages/${id}`,{method:'DELETE'},token); load(); };
  const sync = async () => {
    if(!token) return; setSyncing(true); setMsg(null);
    try { const r = await apiFetch<any>('/api/network/packages/sync', { method:'POST', body: JSON.stringify({}) }, token); setMsg(`Synced ${r.synced} package-router mappings (Simple Queue/Queue Tree/PPP profiles).`); await load(); }
    catch(e:any){ setError(e.message); } finally { setSyncing(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Bandwidth & QoS Packages</h1>
          <p className="text-sm text-muted-foreground">Manage speed packages, burst limits, queue types and sync to MikroTik routers (Simple Queues / Queue Trees).</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={sync} disabled={syncing} className="px-3 py-2 rounded-xl border border-primary/40 text-primary text-sm font-semibold inline-flex items-center gap-2"><Router className="w-4 h-4"/>{syncing?'Syncing...':'Sync to Routers'}</button>
          <button onClick={()=>{setForm({name:'',profile_name:'',download_mbps:20,upload_mbps:20,burst_download_mbps:'',burst_upload_mbps:'',burst_threshold_download_mbps:'',burst_threshold_upload_mbps:'',burst_time_sec:'',priority:8,queue_type:'SIMPLE',price:0,description:'',is_active:true,data_cap_gb:'',fup_speed_mbps:''}); setModal('new');}} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Plus className="w-4 h-4"/>Add Package</button>
        </div>
      </div>
      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="text-left px-4 py-3">Package</th><th className="text-left px-4 py-3">Speed</th><th className="text-left px-4 py-3">Burst / Queue</th><th className="text-left px-4 py-3">Cap / FUP</th><th className="text-left px-4 py-3">Price</th><th className="text-right px-4 py-3">Actions</th></tr></thead>
              <tbody>
                {packages.map(p => (
                  <tr key={p.id} className="border-t border-border/70">
                    <td className="px-4 py-3"><div className="font-semibold">{p.name}</div><div className="text-xs text-muted-foreground font-mono">{p.profile_name || '-'}</div><div className="text-xs text-muted-foreground">{p.description || ''}</div></td>
                    <td className="px-4 py-3"><div className="font-medium text-cyan-400">{p.download_mbps} / {p.upload_mbps} Mbps</div><div className="text-xs text-muted-foreground">Down / Up</div></td>
                    <td className="px-4 py-3 text-xs"><div>{p.queue_type} • Priority {p.priority}</div><div className="text-muted-foreground">{p.burst_download_mbps ? `Burst ${p.burst_download_mbps}/${p.burst_upload_mbps}M, Thr ${p.burst_threshold_download_mbps||'-'}/${p.burst_threshold_upload_mbps||'-'}M, ${p.burst_time_sec||'-'}s` : 'No burst'}</div></td>
                    <td className="px-4 py-3 text-xs"><div>{p.data_cap_gb ? `${Number(p.data_cap_gb)} GB/mo` : 'Unlimited'}</div><div className="text-muted-foreground">{p.fup_speed_mbps ? `FUP ${p.fup_speed_mbps} Mbps` : (p.data_cap_gb ? 'No FUP speed set' : '')}</div></td>
                    <td className="px-4 py-3 text-xs">{p.price ? `৳${p.price}` : '-'} {p.is_active ? <span className="ml-1 text-emerald-400">Active</span> : <span className="ml-1 text-muted-foreground">Inactive</span>}</td>
                    <td className="px-4 py-3 text-right"><button onClick={()=>{setForm({...p}); setModal(p);}} className="p-2 rounded-lg hover:bg-muted"><Pencil className="w-4 h-4"/></button><button onClick={()=>del(p.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-red-400"><Trash2 className="w-4 h-4"/></button></td>
                  </tr>
                ))}
                {!packages.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No bandwidth packages.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-primary"/>Router Sync Status</h2>
          <div className="text-xs text-muted-foreground mb-2">{routers.length} routers • {packages.length} packages</div>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {syncStatus.map((s:any)=>(
              <div key={s.id} className="p-3 rounded-xl border border-border bg-muted/20 text-xs">
                <div className="font-semibold">{s.package_name} → {s.router_name}</div>
                <div className="text-muted-foreground">{s.queue_type} • {s.download_mbps}/{s.upload_mbps} Mbps • <span className="text-emerald-400">{s.sync_status}</span></div>
                <div className="text-muted-foreground">{s.remote_ref || ''} {s.last_synced_at ? `• ${new Date(s.last_synced_at).toLocaleString()}` : ''}</div>
              </div>
            ))}
            {!syncStatus.length && <div className="text-sm text-muted-foreground py-6 text-center">Not synced yet. Click "Sync to Routers" to push packages as Simple Queues/Queue Trees.</div>}
          </div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">{modal==='new'?'Add Package':'Edit Package'}</h2><button onClick={()=>setModal(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4"/></button></div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            <F label="Name"><input className="inp" value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></F>
            <F label="Profile Name"><input className="inp" value={form.profile_name||''} onChange={e=>setForm({...form,profile_name:e.target.value})}/></F>
            <F label="Queue Type"><select className="inp" value={form.queue_type||'SIMPLE'} onChange={e=>setForm({...form,queue_type:e.target.value})}><option value="SIMPLE">SIMPLE</option><option value="QUEUE_TREE">QUEUE_TREE</option><option value="PCQ">PCQ</option></select></F>
            <F label="Download (Mbps)"><input className="inp" type="number" value={form.download_mbps||0} onChange={e=>setForm({...form,download_mbps:Number(e.target.value)})}/></F>
            <F label="Upload (Mbps)"><input className="inp" type="number" value={form.upload_mbps||0} onChange={e=>setForm({...form,upload_mbps:Number(e.target.value)})}/></F>
            <F label="Priority"><input className="inp" type="number" value={form.priority||8} onChange={e=>setForm({...form,priority:Number(e.target.value)})}/></F>
            <F label="Burst Download (Mbps)"><input className="inp" type="number" value={form.burst_download_mbps??''} onChange={e=>setForm({...form,burst_download_mbps:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Burst Upload (Mbps)"><input className="inp" type="number" value={form.burst_upload_mbps??''} onChange={e=>setForm({...form,burst_upload_mbps:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Burst Time (sec)"><input className="inp" type="number" value={form.burst_time_sec??''} onChange={e=>setForm({...form,burst_time_sec:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Burst Threshold Down"><input className="inp" type="number" value={form.burst_threshold_download_mbps??''} onChange={e=>setForm({...form,burst_threshold_download_mbps:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Burst Threshold Up"><input className="inp" type="number" value={form.burst_threshold_upload_mbps??''} onChange={e=>setForm({...form,burst_threshold_upload_mbps:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Price"><input className="inp" type="number" value={form.price||0} onChange={e=>setForm({...form,price:Number(e.target.value)})}/></F>
            <F label="Data Cap (GB/mo)"><input className="inp" type="number" placeholder="Unlimited" value={form.data_cap_gb ?? ''} onChange={e=>setForm({...form,data_cap_gb:e.target.value===''?'':Number(e.target.value)})}/></F>
            <F label="FUP Speed (Mbps)"><input className="inp" type="number" placeholder="None" value={form.fup_speed_mbps ?? ''} onChange={e=>setForm({...form,fup_speed_mbps:e.target.value===''?'':Number(e.target.value)})}/></F>
            <div className="md:col-span-3"><F label="Description"><input className="inp" value={form.description||''} onChange={e=>setForm({...form,description:e.target.value})}/></F></div>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={()=>setModal(null)} className="px-4 py-2 rounded-xl border border-border">Cancel</button><button onClick={save} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold">Save</button></div>
        </div></div>
      )}
      <style jsx>{`.inp{width:100%;padding:.5rem .75rem;border-radius:.75rem;background:var(--card);color:var(--foreground);border:1px solid var(--border);font-size:.875rem}`}</style>
    </div>
  );
}
function F({label,children}:any){ return <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>{children}</label>; }
