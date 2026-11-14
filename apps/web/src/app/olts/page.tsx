'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Package, Plus, RefreshCw, Pencil, Trash2, Play, Search, Radio, CheckCircle2, X, Wifi, ExternalLink, Server, Signal, Activity } from 'lucide-react';

function opticalTone(status: string) {
  if (status === 'CRITICAL') return 'text-red-400 bg-red-500/10 border-red-500/20';
  if (status === 'WARNING') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  if (status === 'NORMAL') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  return 'text-muted-foreground bg-muted border-border';
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="p-3 rounded-xl border border-border bg-card/60">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div> : null}
    </div>
  );
}

export default function OltsPage() {
  const { token } = useAuth();
  const [olts, setOlts] = useState<any[]>([]);
  const [onus, setOnus] = useState<any[]>([]);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [wgPeers, setWgPeers] = useState<any[]>([]);
  const [selectedOlt, setSelectedOlt] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [authModal, setAuthModal] = useState<any>(null);
  const [authSub, setAuthSub] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const onuUrl = selectedOlt ? `/api/olt/onus?olt_id=${encodeURIComponent(selectedOlt)}` : '/api/olt/onus';
      const [o, n, s, w] = await Promise.all([
        apiFetch<{data:any[]}>('/api/olt/olts', {}, token),
        apiFetch<{data:any[]}>(onuUrl, {}, token),
        apiFetch<{data:any[]}>('/api/subscribers?limit=300', {}, token).catch(()=>({data:[]})),
        apiFetch<any>('/api/wireguard/peers', {}, token).catch(()=>({data:[]})),
      ]);
      setOlts(o.data || []); setOnus(n.data || []); setSubscribers(s.data || []); setWgPeers(w.data || []);
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
  const authorize = async () => { if (!token || !authModal) return; try { const r = await apiFetch<any>(`/api/olt/onus/${authModal.id}/authorize`, { method: 'POST', body: JSON.stringify({ subscriber_id: authSub || null, name: authModal.name || authModal.serial_number }) }, token); setMsg(r.message); setAuthModal(null); setAuthSub(''); await load(); } catch(e:any){ setError(e.message);} };

  const discovered = onus.filter(o => o.status === 'DISCOVERED');
  const filteredActive = useMemo(() => {
    const base = onus.filter(o => o.status !== 'DISCOVERED');
    const term = q.trim().toLowerCase();
    if (!term) return base;
    return base.filter(o => [o.serial_number,o.name,o.pon_port,o.olt_name,o.subscriber_name,o.subscriber_code,o.mac_address,o.status].some(v => String(v||'').toLowerCase().includes(term)));
  }, [onus, q]);

  const stats = useMemo(() => {
    const onlineOlts = olts.filter(o => o.status === 'ONLINE').length;
    const critical = onus.filter(o => o.optical_status === 'CRITICAL').length;
    const warning = onus.filter(o => o.optical_status === 'WARNING').length;
    const linked = onus.filter(o => o.subscriber_id).length;
    return { olts: olts.length, onlineOlts, onus: onus.length, discovered: discovered.length, critical, warning, linked };
  }, [olts, onus, discovered.length]);

  const selected = selectedOlt ? olts.find(o => o.id === selectedOlt) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><Package className="w-6 h-6 text-primary" />FTTH & OLTs Overview</h1>
          <p className="text-sm text-muted-foreground">Monitor OLTs and ONUs, discover/authorize devices, refresh optical telemetry, and jump into each OLT’s dedicated page.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />Refresh</button>
          <button onClick={refreshTelemetry} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Radio className="w-4 h-4" />Refresh Telemetry</button>
          <button onClick={autoLink} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Wifi className="w-4 h-4" />Auto-Link ONUs</button>
          <button onClick={()=>{setForm({name:'',vendor:'HUAWEI',model:'',host:'',ssh_port:23,snmp_port:161,username:'admin',password:'',snmp_community:'public',site:'',wg_peer_id:'',is_enabled:true}); setModal('new');}} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Plus className="w-4 h-4" />Add OLT</button>
        </div>
      </div>
      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat label="OLTs" value={stats.olts} sub={`${stats.onlineOlts} online`} />
        <Stat label="ONUs" value={stats.onus} sub={selected ? 'in selected OLT' : 'total loaded'} />
        <Stat label="Discovered" value={<span className="text-amber-400">{stats.discovered}</span>} sub="pending authorize" />
        <Stat label="Linked" value={<span className="text-emerald-400">{stats.linked}</span>} sub="to subscribers" />
        <Stat label="Optical Warning" value={<span className="text-amber-400">{stats.warning}</span>} />
        <Stat label="Optical Critical" value={<span className="text-red-400">{stats.critical}</span>} />
        <Stat label="View" value={selected ? <span className="text-sm font-bold truncate block">{selected.name}</span> : <span className="text-sm font-bold">All OLTs</span>} sub={selected ? 'filtered' : 'no filter'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold flex items-center gap-2"><Server className="w-4 h-4 text-primary" />OLTs</h2>
            {selectedOlt && <button onClick={()=>setSelectedOlt('')} className="text-xs text-primary hover:underline">Clear filter</button>}
          </div>
          <div className="space-y-3 max-h-[700px] overflow-auto">
            {olts.map(o => {
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
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${o.status==='ONLINE'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':o.status==='OFFLINE'?'bg-red-500/10 text-red-400 border-red-500/20':'bg-muted text-muted-foreground border-border'}`}>{o.status}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{o.vendor} {o.model||''} • <span className="font-mono">{o.host}</span></div>
                      <div className="text-[11px] mt-1 text-muted-foreground">{o.site || 'No site'}{o.wg_peer_name ? <span className="text-cyan-400"> • WG: {o.wg_peer_name}</span> : ''}</div>
                      <div className="text-[11px] mt-1 flex gap-2 flex-wrap"><span className="px-1.5 py-0.5 rounded bg-muted border border-border">{selectedOlt===o.id ? onus.length : (count || 0)} ONUs{selectedOlt!==o.id?' (loaded)': ''}</span>{disc>0 && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">{disc} discovered</span>}</div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0" onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>testOlt(o.id)} className="p-1.5 rounded-lg hover:bg-muted" title="Test"><Play className="w-4 h-4" /></button>
                      <button onClick={()=>{setForm({...o, wg_peer_id:o.wg_peer_id||''}); setModal(o);}} className="p-1.5 rounded-lg hover:bg-muted" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={()=>delOlt(o.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400" title="Delete"><Trash2 className="w-4 h-4" /></button>
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

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2"><Signal className="w-4 h-4 text-amber-400" />Discovered / Pending ONUs <span className="text-xs text-muted-foreground font-normal">({discovered.length})</span></div>
            <div className="p-4 space-y-3 max-h-[320px] overflow-auto">
              {discovered.map(o => (
                <div key={o.id} className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-semibold font-mono">{o.serial_number || 'N/A'} <span className="text-muted-foreground font-sans font-normal">• {o.olt_name} • PON {o.pon_port}</span></div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <span>Rx <b className="text-foreground">{o.rx_power_dbm ?? '-'} dBm</b></span>
                      <span>Tx <b className="text-foreground">{o.tx_power_dbm ?? '-'} dBm</b></span>
                      <span>Dist <b className="text-foreground">{o.distance_m != null ? `${o.distance_m} m` : '-'}</b></span>
                      <span>Temp <b className="text-foreground">{o.temperature_c != null ? `${Number(o.temperature_c).toFixed(1)} °C` : '-'}</b></span>
                      <span className={`px-2 py-0.5 rounded-full border ${opticalTone(o.optical_status)}`}>{o.optical_status}</span>
                    </div>
                  </div>
                  <button onClick={()=>{setAuthModal(o); setAuthSub('');}} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Authorize</button>
                </div>
              ))}
              {!discovered.length && <div className="text-sm text-muted-foreground py-4 text-center">{selected ? 'No discovered ONUs for this OLT.' : 'No discovered ONUs. Select an OLT and click “Discover ONUs”.'}</div>}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-primary" />ONUs & Optical Telemetry <span className="text-xs font-normal text-muted-foreground">({filteredActive.length}{q ? ` / ${onus.filter(o=>o.status!=='DISCOVERED').length}` : ''})</span></span>
              <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search ONU, serial, PON, subscriber, MAC..." className="w-full sm:w-72 px-3 py-2 rounded-xl border border-border bg-background text-sm" />
            </div>
            <div className="overflow-auto max-h-[520px]">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr>
                  <th className="text-left px-4 py-2">ONU / Port</th>
                  <th className="text-left px-4 py-2">OLT</th>
                  <th className="text-left px-4 py-2">Subscriber</th>
                  <th className="text-left px-4 py-2">Rx / Tx (dBm)</th>
                  <th className="text-left px-4 py-2">Distance</th>
                  <th className="text-left px-4 py-2">Temp / Volt / Bias</th>
                  <th className="text-left px-4 py-2">Status</th>
                </tr></thead>
                <tbody>
                  {filteredActive.map(o => (
                    <tr key={o.id} className="border-t border-border/70">
                      <td className="px-4 py-2"><div className="font-semibold">{o.name || o.serial_number}</div><div className="text-muted-foreground font-mono">{o.serial_number} • PON {o.pon_port}{o.mac_address ? ` • ${o.mac_address}`:''}</div></td>
                      <td className="px-4 py-2">{o.olt_name}<div className="text-muted-foreground">{o.olt_vendor}</div></td>
                      <td className="px-4 py-2">{o.subscriber_name ? <><div>{o.subscriber_name}</div><div className="text-muted-foreground">{o.subscriber_code||''}</div></> : <span className="text-muted-foreground">Unlinked</span>}</td>
                      <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full border mr-1 ${opticalTone(o.optical_status)}`}>Rx {o.rx_power_dbm ?? '-'}</span><span className="text-muted-foreground">Tx {o.tx_power_dbm ?? '-'}</span></td>
                      <td className="px-4 py-2">{o.distance_m != null ? `${o.distance_m} m` : <span className="text-muted-foreground">-</span>}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        <div>{o.temperature_c != null ? `${Number(o.temperature_c).toFixed(1)} °C` : '-'}{o.voltage_v != null ? ` • ${Number(o.voltage_v).toFixed(2)} V` : ''}</div>
                        <div>Bias: {o.tx_bias_ma != null ? `${Number(o.tx_bias_ma).toFixed(1)} mA` : '-'}</div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full border font-semibold ${o.status==='AUTHORIZED'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':o.status==='OFFLINE'?'bg-red-500/10 text-red-400 border-red-500/20':o.status==='ONLINE'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':'bg-muted text-muted-foreground border-border'}`}>{o.status}</span>
                        <div className={`text-[10px] mt-1 font-semibold ${o.optical_status==='CRITICAL'?'text-red-400':o.optical_status==='WARNING'?'text-amber-400':'text-emerald-400'}`}>{o.optical_status}</div>
                        {o.last_seen_at && <div className="text-[10px] text-muted-foreground mt-0.5">{new Date(o.last_seen_at).toLocaleString()}</div>}
                      </td>
                    </tr>
                  ))}
                  {!filteredActive.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{q ? 'No ONUs match your search.' : 'No ONUs yet. Discover and authorize ONUs to see telemetry.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">{modal==='new'?'Add OLT':'Edit OLT'}</h2><button onClick={()=>setModal(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button></div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <F label="Name"><input className="inp" value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})} /></F>
            <F label="Vendor"><select className="inp" value={form.vendor||'HUAWEI'} onChange={e=>setForm({...form,vendor:e.target.value})}><option>HUAWEI</option><option>BDCOM</option><option>ZTE</option><option>VSOL</option><option>CDATA</option><option>OTHER</option></select></F>
            <F label="Model"><input className="inp" value={form.model||''} onChange={e=>setForm({...form,model:e.target.value})} /></F>
            <F label="Host / IP"><input className="inp" value={form.host||''} onChange={e=>setForm({...form,host:e.target.value})} /></F>
            <F label="SSH Port"><input className="inp" type="number" value={form.ssh_port||23} onChange={e=>setForm({...form,ssh_port:Number(e.target.value)})} /></F>
            <F label="SNMP Port"><input className="inp" type="number" value={form.snmp_port||161} onChange={e=>setForm({...form,snmp_port:Number(e.target.value)})} /></F>
            <F label="Username"><input className="inp" value={form.username||''} onChange={e=>setForm({...form,username:e.target.value})} /></F>
            <F label="Password"><input className="inp" type="password" value={form.password||''} onChange={e=>setForm({...form,password:e.target.value})} /></F>
            <F label="SNMP Community"><input className="inp" value={form.snmp_community||''} onChange={e=>setForm({...form,snmp_community:e.target.value})} /></F>
            <F label="Site"><input className="inp" value={form.site||''} onChange={e=>setForm({...form,site:e.target.value})} /></F>
            <F label="WireGuard peer (tunnel route)"><select className="inp" value={form.wg_peer_id||''} onChange={e=>setForm({...form,wg_peer_id:e.target.value||''})}><option value="">None (direct/host-routed)</option>{wgPeers.map((p:any)=>(<option key={p.id} value={p.id}>{p.name} {p.site_name?`— ${p.site_name}`:''} ({p.tunnel_ip||'-'})</option>))}</select></F>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={()=>setModal(null)} className="px-4 py-2 rounded-xl border border-border">Cancel</button><button onClick={saveOlt} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold">Save</button></div>
        </div></div>
      )}

      {authModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">Authorize ONU</h2><button onClick={()=>setAuthModal(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button></div>
          <div className="p-5 space-y-3 text-sm">
            <div className="p-3 rounded-xl bg-muted/40 border border-border"><div className="font-mono font-semibold">{authModal.serial_number}</div><div className="text-xs text-muted-foreground">{authModal.olt_name} • PON {authModal.pon_port}</div></div>
            <label className="block"><div className="text-xs text-muted-foreground mb-1">Link Subscriber (optional)</div>
              <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={authSub} onChange={e=>setAuthSub(e.target.value)}>
                <option value="">No subscriber link</option>
                {subscribers.map((s:any)=>(<option key={s.id} value={s.id}>{s.client_code || ''} — {s.full_name} ({s.username||'no username'})</option>))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">Authorizes the ONU on the OLT and optionally binds it to a subscriber record.</p>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={()=>setAuthModal(null)} className="px-4 py-2 rounded-xl border border-border">Cancel</button><button onClick={authorize} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Authorize</button></div>
        </div></div>
      )}

      <style jsx>{`.inp{width:100%;padding:.5rem .75rem;border-radius:.75rem;background:var(--card);color:var(--foreground);border:1px solid var(--border);font-size:.875rem}`}</style>
    </div>
  );
}

function F({label,children}:any){ return <label className="block"><div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>{children}</label>; }
