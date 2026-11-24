'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Package, Plus, RefreshCw, Pencil, Trash2, Play, Search, Radio, X, Wifi, ExternalLink, Server, Activity, AlertTriangle } from 'lucide-react';



function Stat({ label, value, sub, tone = 'primary', icon: Icon = Radio }: { label: string; value: React.ReactNode; sub?: string; tone?: string; icon?: any }) {
  return (
    <div className={`dash-stat dash-stat-${tone}`}>
      <span className="dash-stat-icon"><Icon /></span>
      <span className="dash-stat-body">
        <span className="dash-stat-label">{label}</span>
        <span className="dash-stat-value">{value}</span>
        {sub ? <span className="dash-stat-hint">{sub}</span> : null}
      </span>
    </div>
  );
}

export default function OltsPage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [olts, setOlts] = useState<any[]>([]);
  const [onus, setOnus] = useState<any[]>([]);
  const [wgPeers, setWgPeers] = useState<any[]>([]);
  const [selectedOlt, setSelectedOlt] = useState<string>('');
  const [onuStatusFilter, setOnuStatusFilter] = useState<string>('');
  const [oltStatusFilter, setOltStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    const onuStatus = String(searchParams?.get('onu_status') || '').toUpperCase();
    const oltStatus = String(searchParams?.get('olt_status') || '').toUpperCase();
    if (onuStatus) setOnuStatusFilter(onuStatus);
    if (oltStatus) setOltStatusFilter(oltStatus);
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const onuUrl = selectedOlt ? `/api/olt/onus?olt_id=${encodeURIComponent(selectedOlt)}` : '/api/olt/onus';
      const [o, n, w] = await Promise.all([
        apiFetch<{data:any[]}>('/api/olt/olts', {}, token),
        apiFetch<{data:any[]}>(onuUrl, {}, token),
        apiFetch<any>('/api/wireguard/peers', {}, token).catch(()=>({data:[]})),
      ]);
      setOlts(o.data || []); setOnus(n.data || []); setWgPeers(w.data || []);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [token, selectedOlt]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); } }, [msg]);

  const saveOlt = async () => {
    if (!token) return; setError(null);
    try {
      if (modal === 'new') await apiFetch('/api/olt/olts', { method: 'POST', body: JSON.stringify(form) }, token);
      else await apiFetch(`/api/olt/olts/${modal.id}`, { method: 'PUT', body: JSON.stringify(form) }, token);
      setModal(null); await load();
    } catch (e: any) { setError(e.message); }
  };
  const delOlt = async (id: string) => { if (!token || !confirm('Delete OLT?')) return; await apiFetch(`/api/olt/olts/${id}`, { method: 'DELETE' }, token); load(); };
  const testOlt = async (id: string) => { if (!token) return; try { const r = await apiFetch<any>(`/api/olt/olts/${id}/test`, { method: 'POST' }, token); setMsg(r.message); load(); } catch(e:any){ setError(e.message);} };
  const discover = async (id: string) => { if (!token) return; try { const r = await apiFetch<any>(`/api/olt/olts/${id}/discover`, { method: 'POST' }, token); setMsg(`Discovered ${r.discovered} ONU(s).`); await load(); } catch(e:any){ setError(e.message);} };
  const refreshTelemetry = async () => { if (!token) return; try { const r = await apiFetch<any>('/api/olt/onus/refresh-telemetry', { method: 'POST', body: JSON.stringify({ olt_id: selectedOlt || undefined }) }, token); setMsg(`Refreshed optical telemetry for ${r.updated} ONU(s).`); setOnus(r.data || []); } catch(e:any){ setError(e.message);} };
  const autoLink = async () => { if (!token) return; try { const r = await apiFetch<any>('/api/olt/auto-link', { method: 'POST', body: JSON.stringify({ allowFdb: true, limit: 500 }) }, token); setMsg(`Auto-link checked ${r.checked || 0} subscriber(s), linked ${r.linked?.length || 0} ONU(s).`); await load(); } catch(e:any){ setError(e.message);} };

  const discovered = onus.filter(o => o.status === 'DISCOVERED');

  const stats = useMemo(() => {
    const onlineOlts = olts.filter(o => o.status === 'ONLINE').length;
    const critical = onus.filter(o => o.optical_status === 'CRITICAL').length;
    const warning = onus.filter(o => o.optical_status === 'WARNING').length;
    const linked = onus.filter(o => o.subscriber_id).length;
    return { olts: olts.length, onlineOlts, onus: onus.length, discovered: discovered.length, critical, warning, linked };
  }, [olts, onus, discovered.length]);

  const selected = selectedOlt ? olts.find(o => o.id === selectedOlt) : null;

  const filteredOlts = useMemo(() => {
    if (!oltStatusFilter) return olts;
    if (oltStatusFilter === 'OFFLINE') return olts.filter(o => String(o.status || '').toUpperCase() !== 'ONLINE');
    return olts.filter(o => String(o.status || '').toUpperCase() === oltStatusFilter);
  }, [olts, oltStatusFilter]);

  const filteredOnus = useMemo(() => {
    if (!onuStatusFilter) return [] as any[];
    return onus.filter(o => {
      const st = String(o.status || '').toUpperCase();
      const opt = String(o.optical_status || '').toUpperCase();
      if (onuStatusFilter === 'CRITICAL_LOS') return opt === 'CRITICAL' || st === 'LOS';
      if (onuStatusFilter === 'CRITICAL') return opt === 'CRITICAL';
      if (onuStatusFilter === 'LOS') return st === 'LOS';
      if (onuStatusFilter === 'WARNING') return opt === 'WARNING';
      return st === onuStatusFilter || opt === onuStatusFilter;
    });
  }, [onus, onuStatusFilter]);

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Optical operations · Access network</span>
          <h1 className="page-title"><Package className="w-6 h-6 text-primary" />FTTH &amp; OLTs Overview</h1>
          <p className="page-subtitle">Monitor OLTs and ONUs, discover and authorize devices, refresh optical telemetry.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn btn-outline inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />Refresh</button>
          <button onClick={refreshTelemetry} className="btn btn-outline inline-flex items-center gap-2"><Radio className="w-4 h-4" />Refresh Telemetry</button>
          <button onClick={autoLink} className="btn btn-outline inline-flex items-center gap-2"><Wifi className="w-4 h-4" />Auto-Link ONUs</button>
          <button onClick={()=>{setForm({name:'',vendor:'HUAWEI',model:'',host:'',ssh_port:23,snmp_port:161,username:'admin',password:'',snmp_community:'public',site:'',wg_peer_id:'',is_enabled:true}); setModal('new');}} className="btn btn-primary"><Plus className="w-4 h-4" />Add OLT</button>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="stat-grid-7">
        <Stat label="OLTs" value={stats.olts} sub={`${stats.onlineOlts} online`} tone="primary" icon={Server} />
        <Stat label="ONUs" value={stats.onus} sub={selected ? 'in selected OLT' : 'total loaded'} tone="teal" icon={Radio} />
        <Stat label="Discovered" value={stats.discovered} sub="pending authorize" tone="warning" icon={Search} />
        <Stat label="Linked" value={stats.linked} sub="to subscribers" tone="success" icon={Wifi} />
        <Stat label="Optical Warning" value={stats.warning} sub="signal degraded" tone="orange" icon={Activity} />
        <Stat label="Optical Critical" value={stats.critical} sub="immediate action" tone="danger" icon={AlertTriangle} />
        <Stat label="View" value={selected ? <span className="text-base">{selected.name}</span> : 'All OLTs'} sub={selected ? 'filtered' : 'no filter'} tone="purple" icon={Package} />
      </div>

      {(onuStatusFilter || oltStatusFilter) && (
        <div className="card p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <h2 className="font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-warning" />Attention Filter</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {onuStatusFilter === 'CRITICAL_LOS' ? `Showing ${filteredOnus.length} critical/LOS ONU(s).` : onuStatusFilter ? `Showing ${filteredOnus.length} ONU(s) matching ${onuStatusFilter}.` : ''}
                {oltStatusFilter ? ` Showing ${filteredOlts.length} OLT(s) matching ${oltStatusFilter}.` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              {onuStatusFilter && <button onClick={()=>setOnuStatusFilter('')} className="btn btn-outline btn-sm">Clear ONU filter</button>}
              {oltStatusFilter && <button onClick={()=>setOltStatusFilter('')} className="btn btn-outline btn-sm">Clear OLT filter</button>}
            </div>
          </div>
          {onuStatusFilter && (
            <div className="overflow-auto">
              <table className="table table-hover text-[11px] w-full">
                <thead><tr><th className="px-2 py-2 text-left">ONU / Serial</th><th className="px-2 py-2 text-left">OLT</th><th className="px-2 py-2 text-left">PON</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Optical</th><th className="px-2 py-2 text-left">RX (dBm)</th><th className="px-2 py-2 text-left">Subscriber</th><th className="px-2 py-2 text-right">Action</th></tr></thead>
                <tbody>
                  {filteredOnus.map((o:any) => {
                    const st = String(o.status || '').toUpperCase();
                    const opt = String(o.optical_status || '').toUpperCase();
                    return (
                      <tr key={o.id} className="border-t border-border/70">
                        <td className="px-2 py-2"><div className="font-semibold">{o.name || o.serial_number || '-'}</div><div className="text-muted-foreground font-mono">{o.serial_number || ''}</div></td>
                        <td className="px-2 py-2">{o.olt_name || '-'}</td>
                        <td className="px-2 py-2 font-mono">{o.pon_port || '-'}</td>
                        <td className="px-2 py-2"><span className={`badge ${st === 'LOS' || st === 'OFFLINE' ? 'badge-danger' : st === 'ONLINE' ? 'badge-success' : 'badge-secondary'}`}>{st || '-'}</span></td>
                        <td className="px-2 py-2"><span className={`badge ${opt === 'CRITICAL' ? 'badge-danger' : opt === 'WARNING' ? 'badge-warning' : opt === 'OK' ? 'badge-success' : 'badge-secondary'}`}>{opt || '-'}</span></td>
                        <td className="px-2 py-2 tabular-nums">{o.rx_power_dbm ?? '-'}</td>
                        <td className="px-2 py-2">{o.subscriber_name || o.subscriber_code || '-'}</td>
                        <td className="px-2 py-2 text-right">{o.olt_id ? <Link href={`/olts/${o.olt_id}`} className="btn btn-ghost btn-sm inline-flex items-center gap-1">Open OLT <ExternalLink className="w-3 h-3"/></Link> : '-'}</td>
                      </tr>
                    );
                  })}
                  {!filteredOnus.length && <tr><td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">No ONUs match this filter.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold flex items-center gap-2"><Server className="w-4 h-4 text-primary" />OLTs</h2>
            {selectedOlt && <button onClick={()=>setSelectedOlt('')} className="text-xs text-primary hover:underline">Clear filter</button>}
          </div>
          <div className="space-y-3 max-h-[700px] overflow-auto">
            {filteredOlts.map(o => {
              const count = onus.filter(n => n.olt_id === o.id || n.olt_name === o.name).length;
              const disc = onus.filter(n => (n.olt_id === o.id || n.olt_name === o.name) && n.status === 'DISCOVERED').length;
              return (
                <div key={o.id} className={`p-3 rounded-xl border transition-colors ${selectedOlt===o.id?'border-primary bg-primary/5':'border-border bg-muted/20 hover:bg-muted/30'}`} onClick={()=>setSelectedOlt(selectedOlt===o.id?'':o.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/olts/${o.id}`} className="font-semibold hover:text-primary inline-flex items-center gap-1.5 group" onClick={e=>e.stopPropagation()}>
                          {o.name} <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
                        </Link>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${o.status==='ONLINE'?'bg-success/10 text-success border-success/20':o.status==='OFFLINE'?'bg-danger/10 text-danger border-danger/20':'bg-muted text-muted-foreground border-border'}`}>{o.status}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{o.vendor} {o.model||''} • <span className="font-mono">{o.host}</span></div>
                      <div className="text-[11px] mt-1 text-muted-foreground">{o.site || 'No site'}{o.wg_peer_name ? <span className="text-teal"> • WG: {o.wg_peer_name}</span> : ''}</div>
                      <div className="text-[11px] mt-1 flex gap-2 flex-wrap"><span className="px-1.5 py-0.5 rounded bg-muted border border-border">{selectedOlt===o.id ? onus.length : (count || 0)} ONUs{selectedOlt!==o.id?' (loaded)': ''}</span>{disc>0 && <span className="px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20">{disc} discovered</span>}</div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0" onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>testOlt(o.id)} className="p-1.5 rounded-lg hover:bg-muted" title="Test"><Play className="w-4 h-4" /></button>
                      <button onClick={()=>{setForm({...o, wg_peer_id:o.wg_peer_id||''}); setModal(o);}} className="p-1.5 rounded-lg hover:bg-muted" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={()=>delOlt(o.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2" onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>discover(o.id)} className="flex-1 px-2 py-1.5 rounded-lg text-xs border border-border hover:bg-muted inline-flex items-center justify-center gap-1"><Search className="w-3.5 h-3.5" />Discover</button>
                    <Link href={`/olts/${o.id}`} className="px-2 py-1.5 rounded-lg text-xs border border-border hover:bg-muted inline-flex items-center justify-center gap-1"><ExternalLink className="w-3.5 h-3.5" />Open</Link>
                  </div>
                </div>
              );
            })}
            {!olts.length && <div className="text-sm text-muted-foreground py-8 text-center">No OLTs configured. Click “Add OLT” to get started.</div>}
          </div>
        </div>

        <div className="xl:col-span-2 space-y-5">
          {selected && (
            <div className="p-3 rounded-xl border border-primary/30 bg-primary/5 text-sm flex flex-wrap items-center justify-between gap-2">
              <div><span className="text-muted-foreground">Filtered to:</span> <b>{selected.name}</b> <span className="text-muted-foreground">({selected.host})</span></div>
              <Link href={`/olts/${selected.id}`} className="text-primary hover:underline inline-flex items-center gap-1">Open dedicated page <ExternalLink className="w-3.5 h-3.5" /></Link>
            </div>
          )}

          <div className="card p-4 text-sm text-muted-foreground flex items-start gap-3">
            <Activity className="w-4 h-4 mt-0.5 text-primary" />
            <div>
              <div className="font-medium text-foreground">OLT details & ONU management</div>
              <div className="mt-0.5">
                Open a specific OLT’s dedicated page to review <b className="text-foreground">{selected ? discovered.length : discovered.length}</b> discovered/pending ONU(s), authorize devices, and view full ONU telemetry (Rx/Tx, distance, temperature/voltage/bias, status).
              </div>
              {selectedOlt && <Link href={`/olts/${selectedOlt}`} className="inline-flex items-center gap-1 text-primary hover:underline mt-2">Open selected OLT page <ExternalLink className="w-3.5 h-3.5" /></Link>}
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-2xl card my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">{modal==='new'?'Add OLT':'Edit OLT'}</h2><button onClick={()=>setModal(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button></div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <F label="Name"><input className="form-control" value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})} /></F>
            <F label="Vendor"><select className="form-select" value={form.vendor||'HUAWEI'} onChange={e=>setForm({...form,vendor:e.target.value})}><option>HUAWEI</option><option>BDCOM</option><option>ZTE</option><option>VSOL</option><option>CDATA</option><option>OTHER</option></select></F>
            <F label="Model"><input className="form-control" value={form.model||''} onChange={e=>setForm({...form,model:e.target.value})} /></F>
            <F label="Host / IP"><input className="form-control" value={form.host||''} onChange={e=>setForm({...form,host:e.target.value})} /></F>
            <F label="SSH Port"><input className="form-control" type="number" value={form.ssh_port||23} onChange={e=>setForm({...form,ssh_port:Number(e.target.value)})} /></F>
            <F label="SNMP Port"><input className="form-control" type="number" value={form.snmp_port||161} onChange={e=>setForm({...form,snmp_port:Number(e.target.value)})} /></F>
            <F label="Username"><input className="form-control" value={form.username||''} onChange={e=>setForm({...form,username:e.target.value})} /></F>
            <F label="Password"><input className="form-control" type="password" value={form.password||''} onChange={e=>setForm({...form,password:e.target.value})} /></F>
            <F label="SNMP Community"><input className="form-control" value={form.snmp_community||''} onChange={e=>setForm({...form,snmp_community:e.target.value})} /></F>
            <F label="Site"><input className="form-control" value={form.site||''} onChange={e=>setForm({...form,site:e.target.value})} /></F>
            <F label="WireGuard peer (tunnel route)"><select className="form-select" value={form.wg_peer_id||''} onChange={e=>setForm({...form,wg_peer_id:e.target.value||''})}><option value="">None (direct/host-routed)</option>{wgPeers.map((p:any)=>(<option key={p.id} value={p.id}>{p.name} {p.site_name?`— ${p.site_name}`:''} ({p.tunnel_ip||'-'})</option>))}</select></F>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={()=>setModal(null)} className="px-4 py-2 rounded-xl border border-border">Cancel</button><button onClick={saveOlt} className="btn btn-primary">Save</button></div>
        </div></div>
      )}
    </div>
  );
}

function F({label,children}:any){ return <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>{children}</label>; }
