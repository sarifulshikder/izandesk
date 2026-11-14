'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Plus, Pencil, Trash2, Server, Wifi, Activity, Cpu, HardDrive, ArrowDown, ArrowUp, Play, X, ShieldCheck, Link2, Globe, Download, ExternalLink, Network } from 'lucide-react';

const modeBadge = (m: string) => m === 'RADIUS' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : m === 'REST' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20';

export default function RoutersPage() {
  const { token } = useAuth();
  const [routers, setRouters] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ online: 0, total: 0, aggRxBps: 0, aggTxBps: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  // MikroTik import
  const [importRouter, setImportRouter] = useState<any>(null);
  const [importType, setImportType] = useState<string>('ppp-secrets');
  const [importItems, setImportItems] = useState<any[]>([]);
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [r, s] = await Promise.all([
        apiFetch<{data:any[]}>('/api/network/routers', {}, token),
        apiFetch<{data:any[], summary:any}>('/api/network/sessions', {}, token),
      ]);
      setRouters(r.data || []); setSessions(s.data || []); setSummary(s.summary || {});
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const save = async () => {
    if (!token) return;
    try {
      const payload = { ...form };
      if (payload.integration_mode === 'RADIUS') { payload.api_port = null; payload.rest_port = null; }
      if (modal === 'new') await apiFetch('/api/network/routers', { method: 'POST', body: JSON.stringify(payload) }, token);
      else await apiFetch(`/api/network/routers/${modal.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
      setModal(null); await load();
    } catch (e: any) { setError(e.message); }
  };
  const del = async (id: string) => { if (!token || !confirm('Delete router?')) return; await apiFetch(`/api/network/routers/${id}`, { method: 'DELETE' }, token); load(); };
  const testConn = async (id: string) => { if (!token) return; try { const r = await apiFetch<any>(`/api/network/routers/${id}/test`, { method: 'POST' }, token); setError(null); alert(r.message); load(); } catch(e:any){ setError(e.message); } };
  const provisionWalledGarden = async (rtr: any) => {
    if (!token) return;
    try {
      const r = await apiFetch<any>('/api/billing/walled-garden/provision-router', { method: 'POST', body: JSON.stringify({ router_id: rtr.id }) }, token);
      alert(r.ok ? `Walled-garden redirect rules provisioned on ${rtr.name}. ${r.result?.steps?.redirect?.ok ? 'HTTP redirect ready.' : 'Check steps for details.'}` : (r.message || 'Provisioning completed with notes'));
    } catch(e:any){ setError(e.message || 'Failed to provision walled-garden rules'); }
  };

  const openImport = (rtr: any) => {
    setImportRouter(rtr);
    setImportType('ppp-secrets');
    setImportItems([]);
    setImportSelected({});
    setImportMsg(null);
    setError(null);
  };
  const fetchImportPreview = async () => {
    if (!token || !importRouter) return;
    setImportLoading(true); setImportMsg(null); setError(null);
    try {
      const r = await apiFetch<any>(`/api/network/routers/${importRouter.id}/mikrotik/import-preview?type=${encodeURIComponent(importType)}`, {}, token);
      const items = r.items || [];
      setImportItems(items);
      const sel: Record<string, boolean> = {};
      for (const it of items) { if (!it.exists) sel[it.name] = true; }
      setImportSelected(sel);
      setImportMsg(`Fetched ${items.length} item(s) from ${importRouter.name}. ${items.filter((x:any)=>x.exists).length} already exist in IzanDesk (unchecked by default).`);
    } catch (e: any) { setError(e.message); }
    finally { setImportLoading(false); }
  };
  const toggleImportItem = (name: string) => setImportSelected(s => ({ ...s, [name]: !s[name] }));
  const selectAllImport = (checked: boolean) => {
    const sel: Record<string, boolean> = {};
    for (const it of importItems) sel[it.name] = checked;
    setImportSelected(sel);
  };
  const runImport = async () => {
    if (!token || !importRouter) return;
    const selected = importItems.map(i => i.name).filter(n => importSelected[n]);
    if (!selected.length) { setError('Select at least one item to import'); return; }
    if (!confirm(`Import ${selected.length} selected item(s) as ${importType}?`)) return;
    setImporting(true); setError(null); setImportMsg(null);
    try {
      const r = await apiFetch<any>(`/api/network/routers/${importRouter.id}/mikrotik/import`, { method: 'POST', body: JSON.stringify({ type: importType, selected, options: { skip_existing: true } }) }, token);
      setImportMsg(`Import complete: ${r.imported || 0} imported, ${r.skipped || 0} skipped, ${r.failed || 0} failed.${r.note ? ' ' + r.note : ''}`);
      await fetchImportPreview();
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setImporting(false); }
  };

  const fmtBps = (bps: number) => bps > 1e9 ? `${(bps/1e9).toFixed(2)} Gbps` : bps > 1e6 ? `${(bps/1e6).toFixed(2)} Mbps` : `${(bps/1e3).toFixed(1)} Kbps`;
  const mode = String(form.integration_mode || 'API').toUpperCase();

  const stats = useMemo(() => ({
    online: routers.filter(r=>r.status==='ONLINE').length,
    total: routers.length,
    apiRest: routers.filter(r=>['API','REST'].includes(String(r.integration_mode||'').toUpperCase())).length,
    radius: routers.filter(r=>String(r.integration_mode||'').toUpperCase()==='RADIUS').length,
  }), [routers]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><Network className="w-6 h-6 text-primary" />Network & NAS Overview</h1>
          <p className="text-sm text-muted-foreground">Manage RouterOS (API/REST) and RADIUS NAS devices. Open each router for a 360° view, sessions, and actions.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />Refresh</button>
          <button onClick={()=>{setForm({name:'',host:'',integration_mode:'API',api_port:8728,rest_port:443,username:'admin',password:'',router_type:'MIKROTIK',ros_version:'v7',use_ssl:false,site:'',is_enabled:true,radius_secret:'',coa_port:3799,nas_identifier:''}); setModal('new');}} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Plus className="w-4 h-4"/>Add Router / NAS</button>
        </div>
      </div>
      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Stat label="Routers/NAS Online" value={`${stats.online}/${stats.total}`} icon={Server} accent="text-emerald-400" />
        <Stat label="API/REST" value={stats.apiRest} icon={Link2} accent="text-blue-400" />
        <Stat label="RADIUS NAS" value={stats.radius} icon={ShieldCheck} accent="text-violet-400" />
        <Stat label="Active Sessions" value={summary.online || 0} icon={Wifi} accent="text-cyan-400" />
        <Stat label="Aggregate RX" value={fmtBps(summary.aggRxBps||0)} icon={ArrowDown} accent="text-blue-400" />
        <Stat label="Aggregate TX" value={fmtBps(summary.aggTxBps||0)} icon={ArrowUp} accent="text-indigo-400" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Server className="w-4 h-4 text-primary"/>Routers & NAS <span className="text-xs font-normal text-muted-foreground">({routers.length})</span></h2>
          <div className="space-y-3 max-h-[760px] overflow-auto">
            {routers.map(r => {
              const m = String(r.integration_mode||'API').toUpperCase();
              return (
                <div key={r.id} className="p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/routers/${r.id}`} className="font-semibold hover:text-primary inline-flex items-center gap-1.5 group">
                          {r.name} <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
                        </Link>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${modeBadge(m)}`}>{m}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${r.status==='ONLINE'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':r.status==='OFFLINE'?'bg-red-500/10 text-red-400 border-red-500/20':'bg-muted text-muted-foreground border-border'}`}>{r.status}</span>
                        <span className="text-[10px] text-muted-foreground">{r.router_type} {r.ros_version}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        <span className="font-mono">{r.host}</span>
                        {m !== 'RADIUS' ? <>:{r.api_port}{r.rest_port ? ` • REST ${r.rest_port}` : ''}</> : <> • CoA {r.coa_port||3799}{r.nas_identifier ? ` • NAS ${r.nas_identifier}` : ''}</>}
                        {r.site ? ` • ${r.site}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                      <Link href={`/routers/${r.id}`} className="p-2 rounded-lg hover:bg-muted" title="Open 360° view"><ExternalLink className="w-4 h-4"/></Link>
                      <button onClick={()=>testConn(r.id)} className="p-2 rounded-lg hover:bg-muted" title="Test connection"><Play className="w-4 h-4"/></button>
                      {m !== 'RADIUS' && <button onClick={()=>openImport(r)} className="p-2 rounded-lg hover:bg-cyan-500/10 text-cyan-400" title="Import from MikroTik"><Download className="w-4 h-4"/></button>}
                      {m !== 'RADIUS' && <button onClick={()=>provisionWalledGarden(r)} className="p-2 rounded-lg hover:bg-amber-500/10 text-amber-400" title="Provision walled-garden"><Globe className="w-4 h-4"/></button>}
                      <button onClick={()=>{setForm({...r, integration_mode: m, radius_secret: r.radius_secret||'', coa_port: r.coa_port||3799, nas_identifier: r.nas_identifier||''}); setModal(r);}} className="p-2 rounded-lg hover:bg-muted" title="Edit"><Pencil className="w-4 h-4"/></button>
                      <button onClick={()=>del(r.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-red-400" title="Delete"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  </div>
                  {m !== 'RADIUS' ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
                      <Meter icon={Cpu} label="CPU" value={`${Number(r.cpu_load||0).toFixed(1)}%`} />
                      <Meter icon={HardDrive} label="Memory" value={`${Number(r.memory_used_mb||0).toFixed(0)}/${Number(r.memory_total_mb||0).toFixed(0)} MB`} />
                      <Meter icon={ArrowDown} label="RX" value={fmtBps(Number(r.rx_bps||0))} />
                      <Meter icon={ArrowUp} label="TX" value={fmtBps(Number(r.tx_bps||0))} />
                    </div>
                  ) : (
                    <div className="mt-3 text-xs p-2 rounded-lg bg-violet-500/5 border border-violet-500/20 text-violet-300 inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4"/>RADIUS NAS • AAA/CoA pool. Open 360° view for details.</div>
                  )}
                  <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-muted-foreground">
                    <span>Uptime: {formatUptime(Number(r.uptime_seconds||0))} • Last seen: {r.last_seen_at ? new Date(r.last_seen_at).toLocaleTimeString() : '-'}</span>
                    <Link href={`/routers/${r.id}`} className="text-primary hover:underline inline-flex items-center gap-1">Open 360° <ExternalLink className="w-3 h-3" /></Link>
                  </div>
                </div>
              );
            })}
            {!routers.length && <div className="text-sm text-muted-foreground py-8 text-center">No routers configured. Click “Add Router / NAS” to get started.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="font-bold flex items-center gap-2"><Activity className="w-4 h-4 text-primary"/>Live Sessions Snapshot</h2>
            <Link href="/subscribers/live" className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/50">Full View</Link>
          </div>
          <div className="text-xs text-muted-foreground mb-2">Recent sessions across routers/NAS (open a router for per-device view).</div>
          <div className="overflow-auto max-h-[760px]">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">User</th><th className="text-left py-2 px-2">Router/NAS</th><th className="text-left py-2 px-2">RX/TX</th><th className="text-left py-2 px-2">Status</th></tr></thead>
              <tbody>{sessions.slice(0,40).map((s:any,i:number)=>(
                <tr key={i} className="border-b border-border/50"><td className="py-2 px-2"><div className="font-medium">{s.full_name||s.username}</div><div className="text-muted-foreground font-mono">{s.username}</div></td><td className="py-2 px-2"><div className="flex items-center gap-1">{s.router_name||'-'} {s.integration_mode && <span className={`text-[9px] px-1.5 py-0.5 rounded border ${modeBadge(String(s.integration_mode))}`}>{s.integration_mode}</span>}</div></td><td className="py-2 px-2"><div className="text-cyan-400">↓ {fmtBps(Number(s.rx_bps||0))}</div><div className="text-indigo-400">↑ {fmtBps(Number(s.tx_bps||0))}</div></td><td className="py-2 px-2"><span className={`px-2 py-0.5 rounded-full border ${s.status==='ONLINE'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':'bg-muted text-muted-foreground border-border'}`}>{s.status}</span></td></tr>
              ))}{!sessions.length && <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No session data yet.</td></tr>}</tbody>
            </table>
          </div>
        </div>
      </div>

      {importRouter && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-4xl bg-card border border-border rounded-2xl shadow-2xl my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h2 className="font-bold">Import from MikroTik</h2>
              <div className="text-xs text-muted-foreground mt-0.5">{importRouter.name} ({importRouter.host}) — PPP/Hotspot users & profiles/packages</div>
            </div>
            <button onClick={()=>setImportRouter(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4"/></button>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <label className="block flex-1"><div className="text-xs font-semibold text-muted-foreground mb-1">Import Type</div>
                <select className="inp" value={importType} onChange={e=>{setImportType(e.target.value); setImportItems([]); setImportSelected({}); setImportMsg(null);}}>
                  <option value="ppp-secrets">PPPoE Users (PPP Secrets → Subscribers)</option>
                  <option value="ppp-profiles">PPPoE Packages (PPP Profiles → Bandwidth Packages)</option>
                  <option value="hotspot-users">Hotspot Users (→ Subscribers, HOTSPOT)</option>
                  <option value="hotspot-profiles">Hotspot Profiles (→ Bandwidth Packages)</option>
                </select>
              </label>
              <div className="flex gap-2">
                <button onClick={fetchImportPreview} disabled={importLoading} className="px-4 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${importLoading?'animate-spin':''}`}/>{importLoading?'Fetching...':'Fetch from Router'}</button>
                <button onClick={runImport} disabled={importing || !importItems.length} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Download className="w-4 h-4"/>{importing?'Importing...':'Import Selected'}</button>
              </div>
            </div>
            {importMsg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{importMsg}</div>}
            <div className="text-xs text-muted-foreground">Fetch items from the router, choose what to import, then import. Existing IzanDesk records are detected and unchecked by default.</div>

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border text-xs">
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={importItems.length>0 && importItems.every(i=>importSelected[i.name])} onChange={e=>selectAllImport(e.target.checked)} /> Select all</label>
                  <span className="text-muted-foreground">{Object.values(importSelected).filter(Boolean).length} selected / {importItems.length} fetched</span>
                </div>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-muted-foreground uppercase border-b border-border"><tr>
                    <th className="text-left py-2 px-3 w-10"></th>
                    <th className="text-left py-2 px-3">Name / Username</th>
                    <th className="text-left py-2 px-3">Profile / Service</th>
                    <th className="text-left py-2 px-3">Details</th>
                    <th className="text-left py-2 px-3">State</th>
                  </tr></thead>
                  <tbody>
                    {importItems.map((it:any)=> (
                      <tr key={it.name} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="py-2 px-3"><input type="checkbox" checked={!!importSelected[it.name]} onChange={()=>toggleImportItem(it.name)} /></td>
                        <td className="py-2 px-3"><div className="font-mono font-medium text-foreground">{it.name}</div>{it.comment ? <div className="text-muted-foreground truncate max-w-[220px]">{it.comment}</div> : null}</td>
                        <td className="py-2 px-3">{it.profile || '-'} {it.service ? <span className="text-muted-foreground">({it.service})</span> : null}{it.rate_limit ? <div className="text-cyan-400">{it.rate_limit}</div> : null}</td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {it.remote_address ? <div>remote: {it.remote_address}</div> : null}
                          {it.caller_id || it.mac_address ? <div>mac/caller: {it.caller_id || it.mac_address}</div> : null}
                          {it.address_pool ? <div>pool: {it.address_pool}</div> : null}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex flex-wrap gap-1">
                            {it.disabled ? <span className="px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">disabled</span> : <span className="px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">enabled</span>}
                            {it.exists ? <span className="px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-400 border-blue-500/20">exists</span> : <span className="px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">new</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!importItems.length && <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">{importLoading ? 'Fetching from MikroTik...' : 'No items loaded. Choose a type and click "Fetch from Router".'}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={()=>setImportRouter(null)} className="px-4 py-2 rounded-xl border border-border">Close</button></div>
        </div></div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">{modal==='new'?'Add Router / NAS':'Edit Router / NAS'}</h2><button onClick={()=>setModal(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4"/></button></div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <F label="Integration Method"><select className="inp" value={mode} onChange={e=>{const m=e.target.value; setForm({...form,integration_mode:m, api_port: m==='RADIUS'?null:(form.api_port||8728), rest_port: m==='REST'? (form.rest_port||443): (m==='API'? (form.rest_port??null): null)});}}>
              <option value="API">API (RouterOS API - direct per router)</option>
              <option value="REST">REST (RouterOS v7 REST - direct per router)</option>
              <option value="RADIUS">RADIUS (NAS for centralized AAA/CoA pool)</option>
            </select></F>
            <F label="Name"><input className="inp" value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></F>
            <F label={mode==='RADIUS' ? 'NAS IP / Host' : 'Host / IP'}><input className="inp" value={form.host||''} onChange={e=>setForm({...form,host:e.target.value})}/></F>
            <F label="Site"><input className="inp" value={form.site||''} onChange={e=>setForm({...form,site:e.target.value})}/></F>
            {mode !== 'RADIUS' && <>
              <F label="API Port"><input className="inp" type="number" value={form.api_port ?? (mode==='REST'?'':8728)} onChange={e=>setForm({...form,api_port:e.target.value===''?null:Number(e.target.value)})}/></F>
              <F label="REST Port"><input className="inp" type="number" value={form.rest_port ?? (mode==='REST'?443:'')} onChange={e=>setForm({...form,rest_port:e.target.value===''?null:Number(e.target.value)})}/></F>
              <F label="Username"><input className="inp" value={form.username||''} onChange={e=>setForm({...form,username:e.target.value})}/></F>
              <F label="Password"><input className="inp" type="password" value={form.password||''} onChange={e=>setForm({...form,password:e.target.value})}/></F>
              <F label="RouterOS Version"><select className="inp" value={form.ros_version||'v7'} onChange={e=>setForm({...form,ros_version:e.target.value})}><option value="v7">v7</option><option value="v6">v6</option></select></F>
              <F label="Use SSL"><select className="inp" value={form.use_ssl?'yes':'no'} onChange={e=>setForm({...form,use_ssl:e.target.value==='yes'})}><option value="no">No</option><option value="yes">Yes</option></select></F>
              <div className="md:col-span-2 text-xs text-muted-foreground p-3 rounded-xl bg-muted/30 border border-border flex items-start gap-2"><Link2 className="w-4 h-4 mt-0.5 text-primary"/>Direct provisioning for subscribers assigned to this router (API/REST).</div>
            </>}
            {mode === 'RADIUS' && <>
              <F label="RADIUS Shared Secret"><input className="inp" type="password" value={form.radius_secret||''} onChange={e=>setForm({...form,radius_secret:e.target.value})} placeholder="Per-NAS secret"/></F>
              <F label="CoA / PoD Port"><input className="inp" type="number" value={form.coa_port ?? 3799} onChange={e=>setForm({...form,coa_port:Number(e.target.value||3799)})}/></F>
              <F label="NAS Identifier"><input className="inp" value={form.nas_identifier||''} onChange={e=>setForm({...form,nas_identifier:e.target.value})} placeholder="e.g. nas-mirpur-01"/></F>
              <F label="Router Type"><input className="inp" value={form.router_type||'MIKROTIK'} onChange={e=>setForm({...form,router_type:e.target.value})}/></F>
              <div className="md:col-span-2 text-xs text-muted-foreground p-3 rounded-xl bg-violet-500/5 border border-violet-500/20 flex items-start gap-2"><ShieldCheck className="w-4 h-4 mt-0.5 text-violet-400"/>RADIUS NAS for centralized AAA/CoA pool. Sync NAS config and reload FreeRADIUS as needed.</div>
            </>}
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={()=>setModal(null)} className="px-4 py-2 rounded-xl border border-border">Cancel</button><button onClick={save} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold">Save</button></div>
        </div></div>
      )}
      <style jsx>{`.inp{width:100%;padding:.5rem .75rem;border-radius:.75rem;background:var(--card);color:var(--foreground);border:1px solid var(--border);font-size:.875rem}`}</style>
    </div>
  );
}

function Stat({label,value,icon:Icon,accent='text-foreground'}:any){ return <div className="p-4 rounded-2xl border border-border bg-card hover:border-primary/30 transition-colors"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{label}</span><Icon className={`w-4 h-4 ${accent}`}/></div><div className={`mt-2 text-xl font-black ${accent}`}>{value}</div></div>; }
function Meter({icon:Icon,label,value}:any){ return <div className="p-2 rounded-lg bg-card border border-border"><div className="flex items-center gap-1 text-muted-foreground"><Icon className="w-3.5 h-3.5"/>{label}</div><div className="font-semibold text-foreground mt-0.5">{value}</div></div>; }
function F({label,children}:any){ return <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>{children}</label>; }
function formatUptime(sec:number){ if(!sec) return '-'; const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600),m=Math.floor((sec%3600)/60); return `${d}d ${h}h ${m}m`; }
