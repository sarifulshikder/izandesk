'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Plus, Pencil, Trash2, RefreshCw, Zap, Router, X, Download } from 'lucide-react';

export default function BandwidthPage() {
  const { token } = useAuth();
  const [packages, setPackages] = useState<any[]>([]);
  const [routers, setRouters] = useState<any[]>([]);
  const [syncStatus, setSyncStatus] = useState<any[]>([]);
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // MikroTik profile/package import
  const [showImport, setShowImport] = useState(false);
  const [importRouterId, setImportRouterId] = useState('');
  const [importType, setImportType] = useState<'ppp-profiles' | 'hotspot-profiles'>('ppp-profiles');
  const [importItems, setImportItems] = useState<any[]>([]);
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

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

  const fetchImportPreview = async () => {
    if (!token || !importRouterId) { setError('Select a router first'); return; }
    setImportLoading(true); setError(null); setImportMsg(null);
    try {
      const r = await apiFetch<any>(`/api/network/routers/${importRouterId}/mikrotik/import-preview?type=${encodeURIComponent(importType)}`, {}, token);
      const items = r.items || [];
      setImportItems(items);
      const sel: Record<string, boolean> = {};
      for (const it of items) { if (!it.exists) sel[it.name] = true; }
      setImportSelected(sel);
      setImportMsg(`Fetched ${items.length} profile(s). ${items.filter((x:any)=>x.exists).length} already exist (unchecked by default).`);
    } catch (e: any) { setError(e.message); }
    finally { setImportLoading(false); }
  };
  const runImport = async () => {
    if (!token || !importRouterId) return;
    const selected = importItems.map(i => i.name).filter(n => importSelected[n]);
    if (!selected.length) { setError('Select at least one profile to import'); return; }
    if (!confirm(`Import ${selected.length} selected profile(s) as bandwidth packages?`)) return;
    setImporting(true); setError(null); setImportMsg(null);
    try {
      const r = await apiFetch<any>(`/api/network/routers/${importRouterId}/mikrotik/import`, { method: 'POST', body: JSON.stringify({ type: importType, selected, options: { skip_existing: true } }) }, token);
      setImportMsg(`Import complete: ${r.imported || 0} imported, ${r.skipped || 0} skipped, ${r.failed || 0} failed.`);
      await fetchImportPreview();
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setImporting(false); }
  };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Network · QoS</span>
          <h1 className="page-title">Bandwidth &amp; QoS Packages</h1>
          <p className="page-subtitle">Manage speed packages, burst limits, queue types and sync to MikroTik routers (Simple Queues / Queue Trees).</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={()=>{ setShowImport(true); setImportItems([]); setImportSelected({}); setImportMsg(null); setError(null); }} className="btn btn-outline"><Download className="w-4 h-4"/>Import from Router</button>
          <button onClick={sync} disabled={syncing} className="btn btn-outline"><Router className="w-4 h-4"/>{syncing?'Syncing...':'Sync to Routers'}</button>
          <button onClick={()=>{setForm({name:'',profile_name:'',download_mbps:20,upload_mbps:20,burst_download_mbps:'',burst_upload_mbps:'',burst_threshold_download_mbps:'',burst_threshold_upload_mbps:'',burst_time_sec:'',priority:8,queue_type:'',price:0,description:'',is_active:true,data_cap_gb:'',fup_speed_mbps:'',validity_value:1,validity_unit:'CALENDAR_MONTH'}); setModal('new');}} className="btn btn-primary"><Plus className="w-4 h-4"/>Add Package</button>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 card overflow-hidden">
          <div className="table-wrap overflow-auto">
            <table className="table table-hover text-[11px]">
              <thead className="sticky top-0 z-10"><tr><th className="px-3 py-2.5">Package</th><th className="px-3 py-2.5">Speed</th><th className="px-3 py-2.5">Burst / Queue</th><th className="px-3 py-2.5">Validity</th><th className="px-3 py-2.5">Cap / FUP</th><th className="px-3 py-2.5">Price</th><th className="px-3 py-2.5">Actions</th></tr></thead>
              <tbody>
                {packages.map(p => {
                  const vu = String(p.validity_unit || 'CALENDAR_MONTH').toUpperCase();
                  const vv = Number(p.validity_value || 1);
                  const validityLabel = vu === 'CALENDAR_MONTH' ? '1 Calendar Month' : vu === 'MONTHS' ? `${vv} Month${vv===1?'':'s'}` : vu === 'DAYS' ? `${vv} Day${vv===1?'':'s'}` : (p.validity_unit ? `${vv} ${p.validity_unit}` : '-');
                  return (
                  <tr key={p.id} className="border-t border-border/70">
                    <td className="px-3 py-2.5"><div className="font-semibold">{p.name}</div><div className="text-xs text-muted-foreground font-mono">{p.profile_name || '-'}</div><div className="text-xs text-muted-foreground">{p.description || ''}</div></td>
                    <td className="px-3 py-2.5"><div className="font-medium text-info tabular-nums">{p.download_mbps} / {p.upload_mbps} Mbps</div><div className="text-xs text-muted-foreground">Down / Up</div></td>
                    <td className="px-3 py-2.5 text-xs"><div>{p.queue_type || 'Auto'} • Priority {p.priority}</div><div className="text-muted-foreground tabular-nums">{p.burst_download_mbps ? `Burst ${p.burst_download_mbps}/${p.burst_upload_mbps}M, Thr ${p.burst_threshold_download_mbps||'-'}/${p.burst_threshold_upload_mbps||'-'}M, ${p.burst_time_sec||'-'}s` : 'No burst'}</div></td>
                    <td className="px-3 py-2.5 text-xs"><div>{validityLabel}</div><div className="text-muted-foreground">{vu === 'CALENDAR_MONTH' ? 'From activation' : ''}</div></td>
                    <td className="px-3 py-2.5 text-xs"><div>{p.data_cap_gb ? `${Number(p.data_cap_gb)} GB/mo` : 'Unlimited'}</div><div className="text-muted-foreground">{p.fup_speed_mbps ? `FUP ${p.fup_speed_mbps} Mbps` : (p.data_cap_gb ? 'No FUP speed set' : '')}</div></td>
                    <td className="px-3 py-2.5 text-xs tabular-nums">{p.price ? `৳${p.price}` : '-'} {p.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-secondary">Inactive</span>}</td>
                    <td className="px-3 py-2.5 text-right"><button onClick={()=>{setForm({...p, validity_unit: p.validity_unit || 'CALENDAR_MONTH', validity_value: p.validity_value ?? 1}); setModal(p);}} className="btn btn-ghost btn-icon btn-sm"><Pencil className="w-4 h-4"/></button><button onClick={()=>del(p.id)} className="btn btn-ghost btn-icon btn-sm text-danger"><Trash2 className="w-4 h-4"/></button></td>
                  </tr>
                );})}
                {!packages.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No bandwidth packages.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-primary"/>Router Sync Status</h2>
          <div className="text-xs text-muted-foreground mb-2 tabular-nums">{routers.length} routers • {packages.length} packages</div>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {syncStatus.map((s:any)=>(
              <div key={s.id} className="p-3 rounded-xl border border-border bg-muted/20 text-xs">
                <div className="font-semibold">{s.package_name} → {s.router_name}</div>
                <div className="text-muted-foreground tabular-nums">{s.queue_type} • {s.download_mbps}/{s.upload_mbps} Mbps • <span className="badge badge-success">{s.sync_status}</span></div>
                <div className="text-muted-foreground">{s.remote_ref || ''} {s.last_synced_at ? `• ${new Date(s.last_synced_at).toLocaleString()}` : ''}</div>
              </div>
            ))}
            {!syncStatus.length && <div className="empty-panel"><span className="empty-panel-icon"><Router className="w-5 h-5"/></span><div><div className="text-sm font-semibold">Not synced yet</div><p className="text-[11px] text-muted-foreground mt-1">Click "Sync to Routers" to push packages as Simple Queues/Queue Trees.</p></div></div>}
          </div>
        </div>
      </div>

      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-4xl card my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h2 className="font-bold">Import Packages/Profiles from Router</h2>
              <div className="text-xs text-muted-foreground mt-0.5">Fetch PPP/Hotspot profiles from a MikroTik router and import as bandwidth packages</div>
            </div>
            <button onClick={()=>setShowImport(false)} className="btn btn-ghost btn-icon"><X className="w-4 h-4"/></button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block"><div className="form-label">Router (API/REST)</div>
                <select className="form-select" value={importRouterId} onChange={e=>{ setImportRouterId(e.target.value); setImportItems([]); setImportSelected({}); setImportMsg(null); }}>
                  <option value="">Select router</option>
                  {routers.filter((r:any)=>['API','REST'].includes(String(r.integration_mode||'').toUpperCase())).map((r:any)=> <option key={r.id} value={r.id}>{r.name} ({r.host})</option>)}
                </select>
              </label>
              <label className="block"><div className="form-label">Profile Type</div>
                <select className="form-select" value={importType} onChange={e=>{ setImportType(e.target.value as any); setImportItems([]); setImportSelected({}); setImportMsg(null); }}>
                  <option value="ppp-profiles">PPPoE Profiles (PPP)</option>
                  <option value="hotspot-profiles">Hotspot User Profiles</option>
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button onClick={fetchImportPreview} disabled={importLoading || !importRouterId} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${importLoading?'animate-spin':''}`}/>{importLoading?'Fetching...':'Fetch Profiles'}</button>
                <button onClick={runImport} disabled={importing || !importItems.length} className="btn btn-primary"><Download className="w-4 h-4"/>{importing?'Importing...':'Import Selected'}</button>
              </div>
            </div>
            {importMsg && <div className="alert alert-success">{importMsg}</div>}
            <div className="text-xs text-muted-foreground">Fetched profiles can be imported as bandwidth packages (name/profile_name taken from MikroTik profile, speed parsed from rate-limit). Existing packages are detected and unchecked by default.</div>
            <div className="table-shell">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border text-xs">
                <label className="form-check"><input type="checkbox" checked={importItems.length>0 && importItems.every(i=>importSelected[i.name])} onChange={e=>{ const checked=e.target.checked; const sel:Record<string,boolean>={}; for(const it of importItems) sel[it.name]=checked; setImportSelected(sel); }} /> Select all</label>
                <span className="text-muted-foreground tabular-nums">{Object.values(importSelected).filter(Boolean).length} selected / {importItems.length} fetched</span>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="table table-hover text-[11px]">
                  <thead className="sticky top-0 z-10"><tr>
                    <th className="px-3 py-2.5 w-10"></th>
                    <th className="px-3 py-2.5">Profile Name</th>
                    <th className="px-3 py-2.5">Rate Limit</th>
                    <th className="px-3 py-2.5">Details</th>
                    <th className="px-3 py-2.5">State</th>
                  </tr></thead>
                  <tbody>
                    {importItems.map((it:any)=> (
                      <tr key={it.name} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2.5"><input type="checkbox" checked={!!importSelected[it.name]} onChange={()=>setImportSelected(s=>({...s,[it.name]:!s[it.name]}))} /></td>
                        <td className="px-3 py-2.5"><div className="font-mono font-medium text-foreground">{it.name}</div>{it.comment ? <div className="text-muted-foreground truncate max-w-[260px]">{it.comment}</div> : null}</td>
                        <td className="px-3 py-2.5"><div className="text-info tabular-nums">{it.rate_limit || '-'}</div><div className="text-muted-foreground">{(it.download_mbps||it.upload_mbps) ? `~${Math.max(it.download_mbps||0,it.upload_mbps||0)} Mbps` : ''}</div></td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {it.local_address ? <div>local: {it.local_address}</div> : null}
                          {it.remote_address ? <div>remote: {it.remote_address}</div> : null}
                          {it.address_pool ? <div>pool: {it.address_pool}</div> : null}
                          {it.session_timeout || it.idle_timeout ? <div>timeouts: {it.session_timeout||'-'} / {it.idle_timeout||'-'}</div> : null}
                        </td>
                        <td className="px-3 py-2.5">{it.exists ? <span className="badge badge-info">exists</span> : <span className="badge badge-success">new</span>}</td>
                      </tr>
                    ))}
                    {!importItems.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">{importLoading ? 'Fetching from MikroTik...' : 'Select a router and click "Fetch Profiles".'}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={()=>setShowImport(false)} className="btn btn-outline">Close</button></div>
        </div></div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-3xl card my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">{modal==='new'?'Add Package':'Edit Package'}</h2><button onClick={()=>setModal(null)} className="btn btn-ghost btn-icon"><X className="w-4 h-4"/></button></div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            <F label="Name"><input className="form-control" value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></F>
            <F label="Profile Name"><input className="form-control" value={form.profile_name||''} onChange={e=>setForm({...form,profile_name:e.target.value})}/></F>
            <F label="Download (Mbps)"><input className="form-control" type="number" value={form.download_mbps||0} onChange={e=>setForm({...form,download_mbps:Number(e.target.value)})}/></F>
            <F label="Upload (Mbps)"><input className="form-control" type="number" value={form.upload_mbps||0} onChange={e=>setForm({...form,upload_mbps:Number(e.target.value)})}/></F>
            <F label="Price (৳)"><input className="form-control" type="number" value={form.price||0} onChange={e=>setForm({...form,price:Number(e.target.value)})}/></F>
            <F label="Validity">
              <select className="form-select" value={form.validity_unit||'CALENDAR_MONTH'} onChange={e=>{ const u=e.target.value; setForm({...form, validity_unit:u, validity_value: u==='CALENDAR_MONTH' ? 1 : (form.validity_value||1)}); }}>
                <option value="CALENDAR_MONTH">1 Calendar Month (from activation)</option>
                <option value="DAYS">Custom Days</option>
                <option value="MONTHS">Months</option>
              </select>
            </F>
            {form.validity_unit !== 'CALENDAR_MONTH' && <F label={form.validity_unit==='MONTHS' ? 'Number of Months' : 'Number of Days'}><input className="form-control" type="number" min={1} value={form.validity_value ?? 1} onChange={e=>setForm({...form,validity_value:e.target.value===''?'':Number(e.target.value)})}/></F>}
            <F label="Queue Type (Optional)"><select className="form-select" value={form.queue_type||''} onChange={e=>setForm({...form,queue_type:e.target.value})}><option value="">None / Auto</option><option value="SIMPLE">SIMPLE</option><option value="QUEUE_TREE">QUEUE_TREE</option><option value="PCQ">PCQ</option></select></F>
            <F label="Priority"><input className="form-control" type="number" value={form.priority||8} onChange={e=>setForm({...form,priority:Number(e.target.value)})}/></F>
            <F label="Burst Download (Mbps)"><input className="form-control" type="number" value={form.burst_download_mbps??''} onChange={e=>setForm({...form,burst_download_mbps:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Burst Upload (Mbps)"><input className="form-control" type="number" value={form.burst_upload_mbps??''} onChange={e=>setForm({...form,burst_upload_mbps:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Burst Time (sec)"><input className="form-control" type="number" value={form.burst_time_sec??''} onChange={e=>setForm({...form,burst_time_sec:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Burst Threshold Down"><input className="form-control" type="number" value={form.burst_threshold_download_mbps??''} onChange={e=>setForm({...form,burst_threshold_download_mbps:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Burst Threshold Up"><input className="form-control" type="number" value={form.burst_threshold_upload_mbps??''} onChange={e=>setForm({...form,burst_threshold_upload_mbps:e.target.value===''?null:Number(e.target.value)})}/></F>
            <F label="Data Cap (GB/mo)"><input className="form-control" type="number" placeholder="Unlimited" value={form.data_cap_gb ?? ''} onChange={e=>setForm({...form,data_cap_gb:e.target.value===''?'':Number(e.target.value)})}/></F>
            <F label="FUP Speed (Mbps)"><input className="form-control" type="number" placeholder="None" value={form.fup_speed_mbps ?? ''} onChange={e=>setForm({...form,fup_speed_mbps:e.target.value===''?'':Number(e.target.value)})}/></F>
            <div className="md:col-span-3"><F label="Description"><input className="form-control" value={form.description||''} onChange={e=>setForm({...form,description:e.target.value})}/></F></div>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={()=>setModal(null)} className="btn btn-outline">Cancel</button><button onClick={save} className="btn btn-primary">Save</button></div>
        </div></div>
      )}
    </div>
  );
}
function F({label,children}:any){ return <label className="block"><div className="form-label">{label}</div>{children}</label>; }
