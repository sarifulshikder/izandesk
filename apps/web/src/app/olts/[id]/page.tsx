'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { ArrowLeft, RefreshCw, Play, Search, Radio, Wifi, CheckCircle2, X, Server, Activity, Signal, Network, Gauge, AlertTriangle, Layers } from 'lucide-react';

function opticalTone(status: string) {
  if (status === 'CRITICAL') return 'text-red-400 bg-red-500/10 border-red-500/20';
  if (status === 'WARNING') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  if (status === 'NORMAL') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  return 'text-muted-foreground bg-muted border-border';
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="p-4 rounded-2xl border border-border bg-card/60">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-black">{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div> : null}
    </div>
  );
}

function KV({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-border/50 last:border-0 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-medium text-right break-all ${mono ? 'font-mono text-xs' : ''}`}>{v ?? '-'}</span>
    </div>
  );
}

export default function OltDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const { token } = useAuth();
  const [olt, setOlt] = useState<any>(null);
  const [onus, setOnus] = useState<any[]>([]);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authModal, setAuthModal] = useState<any>(null);
  const [authSub, setAuthSub] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const [o, on, subs] = await Promise.all([
        apiFetch<any>(`/api/olt/olts/${id}`, {}, token),
        apiFetch<{ data: any[] }>(`/api/olt/onus?olt_id=${id}`, {}, token),
        apiFetch<{ data: any[] }>('/api/subscribers?limit=1000', {}, token).catch(() => ({ data: [] })),
      ]);
      setOlt(o);
      setOnus(on.data || []);
      setSubscribers(subs.data || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load OLT');
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); } }, [msg]);

  const run = async (label: string, fn: () => Promise<any>) => {
    if (!token) return;
    setError(null);
    try {
      const r = await fn();
      setMsg(typeof r?.message === 'string' ? r.message : label);
      await load();
      return r;
    } catch (e: any) {
      setError(e.message || `${label} failed`);
    }
  };

  const testOlt = () => run('OLT test complete', () => apiFetch<any>(`/api/olt/olts/${id}/test`, { method: 'POST' }, token!));
  const discover = () => run('Discovery complete', async () => {
    const r = await apiFetch<any>(`/api/olt/olts/${id}/discover`, { method: 'POST' }, token!);
    return { ...r, message: `Discovered ${r.discovered} ONU(s).` };
  });
  const refreshTelemetry = () => run('Telemetry refreshed', async () => {
    const r = await apiFetch<any>('/api/olt/onus/refresh-telemetry', { method: 'POST', body: JSON.stringify({ olt_id: id }) }, token!);
    return { ...r, message: `Refreshed telemetry for ${r.updated} ONU(s).` };
  });
  const autoLink = () => run('Auto-link complete', async () => {
    const r = await apiFetch<any>('/api/olt/auto-link', { method: 'POST', body: JSON.stringify({ allowFdb: true, limit: 500 }) }, token!);
    return { ...r, message: `Auto-link checked ${r.checked || 0} subscriber(s), linked ${r.linked?.length || 0} ONU(s).` };
  });
  const authorize = async () => {
    if (!token || !authModal) return;
    try {
      const r = await apiFetch<any>(`/api/olt/onus/${authModal.id}/authorize`, { method: 'POST', body: JSON.stringify({ subscriber_id: authSub || null, name: authModal.name || authModal.serial_number }) }, token);
      setMsg(r.message); setAuthModal(null); setAuthSub(''); await load();
    } catch (e: any) { setError(e.message); }
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return onus;
    return onus.filter(o => [o.serial_number, o.name, o.pon_port, o.subscriber_name, o.subscriber_code, o.mac_address, o.status, o.optical_status].some(v => String(v || '').toLowerCase().includes(term)));
  }, [onus, q]);

  const discovered = filtered.filter(o => o.status === 'DISCOVERED');
  const activeOnus = filtered.filter(o => o.status !== 'DISCOVERED');

  const derived = useMemo(() => {
    const byPon: Record<string, { total: number; online: number; offline: number; discovered: number; critical: number; warning: number }> = {};
    let critical = 0, warning = 0, normal = 0, unknownOpt = 0, linked = 0, unlinked = 0, online = 0, offline = 0, discoveredCount = 0;
    for (const o of onus) {
      const pon = String(o.pon_port || 'Unknown');
      if (!byPon[pon]) byPon[pon] = { total: 0, online: 0, offline: 0, discovered: 0, critical: 0, warning: 0 };
      byPon[pon].total++;
      if (o.status === 'ONLINE') { online++; byPon[pon].online++; }
      if (o.status === 'OFFLINE') { offline++; byPon[pon].offline++; }
      if (o.status === 'DISCOVERED') { discoveredCount++; byPon[pon].discovered++; }
      const opt = String(o.optical_status || 'UNKNOWN');
      if (opt === 'CRITICAL') { critical++; byPon[pon].critical++; }
      else if (opt === 'WARNING') { warning++; byPon[pon].warning++; }
      else if (opt === 'NORMAL') normal++;
      else unknownOpt++;
      if (o.subscriber_id) linked++; else unlinked++;
    }
    const ponRows = Object.entries(byPon).map(([pon, v]) => ({ pon, ...v })).sort((a, b) => a.pon.localeCompare(b.pon, undefined, { numeric: true }));
    return { ponRows, ponCount: ponRows.length, critical, warning, normal, unknownOpt, linked, unlinked, online, offline, discoveredCount };
  }, [onus]);

  if (loading && !olt) return <div className="p-6 text-sm text-muted-foreground">Loading OLT...</div>;
  if (!olt) return <div className="p-6 space-y-3"><div className="text-red-400">{error || 'OLT not found'}</div><Link href="/olts" className="text-primary underline">Back to OLTs</Link></div>;

  const s = olt.stats || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href="/olts" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="w-3.5 h-3.5" />Back to OLTs</Link>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><Server className="w-6 h-6 text-primary" />{olt.name} <span className="text-sm font-semibold text-muted-foreground">360° View</span></h1>
          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            <span>{olt.vendor} {olt.model || ''}</span>
            <span>• Host: <span className="font-mono text-foreground">{olt.host}</span></span>
            <span>• Site: {olt.site || '—'}</span>
            {olt.wg_peer_name && <span>• WG: <span className="text-cyan-400">{olt.wg_peer_name}{olt.wg_peer_tunnel_ip ? ` (${olt.wg_peer_tunnel_ip})` : ''}</span></span>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button onClick={testOlt} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Play className="w-4 h-4" />Test</button>
          <button onClick={discover} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Search className="w-4 h-4" />Discover</button>
          <button onClick={refreshTelemetry} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Radio className="w-4 h-4" />Telemetry</button>
          <button onClick={autoLink} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Wifi className="w-4 h-4" />Auto-Link</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="OLT Status" value={<span className={`text-sm px-2 py-0.5 rounded-full border ${olt.status==='ONLINE'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':olt.status==='OFFLINE'?'bg-red-500/10 text-red-400 border-red-500/20':'bg-muted text-muted-foreground border-border'}`}>{olt.status}</span>} sub={olt.last_seen_at ? new Date(olt.last_seen_at).toLocaleString() : 'Never seen'} />
        <Stat label="Total ONUs" value={s.total_onus ?? onus.length} sub={`${derived.ponCount} PON port(s)`} />
        <Stat label="Online / Offline" value={<><span className="text-emerald-400">{s.online_onus ?? derived.online}</span><span className="text-muted-foreground text-base"> / </span><span className="text-red-400">{s.offline_onus ?? derived.offline}</span></>} />
        <Stat label="Authorized" value={s.authorized_onus ?? 0} sub={`${s.discovered_onus ?? derived.discoveredCount} discovered`} />
        <Stat label="Linked to Subs" value={<span className="text-emerald-400">{s.linked_onus ?? derived.linked}</span>} sub={`${derived.unlinked} unlinked`} />
        <Stat label="Optical Critical" value={<span className="text-red-400">{derived.critical}</span>} sub={`${derived.warning} warning`} />
        <Stat label="Optical Healthy" value={<span className="text-emerald-400">{derived.normal}</span>} sub={`${derived.unknownOpt} unknown`} />
        <Stat label="Avg Rx Power" value={s.avg_rx_power_dbm != null ? `${Number(s.avg_rx_power_dbm).toFixed(2)} dBm` : '—'} sub="Across ONUs" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-1 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Activity className="w-4 h-4 text-primary" />Identity & Access</h2>
            <KV k="OLT ID" v={olt.id} mono />
            <KV k="Vendor / Model" v={`${olt.vendor || '-'} ${olt.model || ''}`} />
            <KV k="Host / IP" v={olt.host} mono />
            <KV k="SSH Port" v={olt.ssh_port ?? 23} />
            <KV k="SNMP Port" v={olt.snmp_port ?? 161} />
            <KV k="Username" v={olt.username || '-'} />
            <KV k="SNMP Community" v={olt.snmp_community || '-'} />
            <KV k="Enabled" v={olt.is_enabled ? 'Yes' : 'No'} />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Network className="w-4 h-4 text-primary" />Connectivity & Location</h2>
            <KV k="Site" v={olt.site || '-'} />
            <KV k="WG Peer" v={olt.wg_peer_name || 'None'} />
            <KV k="WG Tunnel IP" v={olt.wg_peer_tunnel_ip || '-'} mono />
            <KV k="WG Site" v={olt.wg_peer_site || '-'} />
            <KV k="Status" v={<span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${olt.status==='ONLINE'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':olt.status==='OFFLINE'?'bg-red-500/10 text-red-400 border-red-500/20':'bg-muted text-muted-foreground border-border'}`}>{olt.status}</span>} />
            <KV k="Last Seen" v={olt.last_seen_at ? new Date(olt.last_seen_at).toLocaleString() : '-'} />
            <KV k="Created" v={olt.created_at ? new Date(olt.created_at).toLocaleString() : '-'} />
            <KV k="Updated" v={olt.updated_at ? new Date(olt.updated_at).toLocaleString() : '-'} />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Gauge className="w-4 h-4 text-primary" />Health & Optical Summary</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20"><div className="text-[11px] text-muted-foreground">Normal</div><div className="font-bold text-emerald-400">{derived.normal}</div></div>
              <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20"><div className="text-[11px] text-muted-foreground">Warning</div><div className="font-bold text-amber-400">{derived.warning}</div></div>
              <div className="p-2.5 rounded-xl bg-red-500/5 border border-red-500/20"><div className="text-[11px] text-muted-foreground">Critical</div><div className="font-bold text-red-400">{derived.critical}</div></div>
              <div className="p-2.5 rounded-xl bg-muted/30 border border-border"><div className="text-[11px] text-muted-foreground">Unknown</div><div className="font-bold">{derived.unknownOpt}</div></div>
            </div>
            <div className="mt-3 text-xs text-muted-foreground flex items-start gap-2"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-400" />Thresholds: NORMAL ≥ -27 dBm, WARNING &lt; -27 dBm, CRITICAL ≤ -30 or ≥ -8 dBm.</div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Layers className="w-4 h-4 text-primary" />PON Port Breakdown</h2>
            <div className="space-y-2 max-h-[260px] overflow-auto">
              {derived.ponRows.map(p => (
                <div key={p.pon} className="p-2.5 rounded-xl border border-border/70 bg-muted/20">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold text-sm">{p.pon}</span><span className="text-xs text-muted-foreground">{p.total} ONU(s)</span></div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">On {p.online}</span>
                    <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">Off {p.offline}</span>
                    {p.discovered > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">Disc {p.discovered}</span>}
                    {p.critical > 0 && <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">Crit {p.critical}</span>}
                    {p.warning > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">Warn {p.warning}</span>}
                  </div>
                </div>
              ))}
              {!derived.ponRows.length && <div className="text-sm text-muted-foreground py-4 text-center">No PON/ONU data yet. Run discovery.</div>}
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-4">
          {discovered.length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <h2 className="font-bold flex items-center gap-2 mb-3"><Signal className="w-4 h-4 text-amber-400" />Discovered / Pending Authorization ({discovered.length})</h2>
              <div className="space-y-2 max-h-[240px] overflow-auto">
                {discovered.map(o => (
                  <div key={o.id} className="p-3 rounded-xl border border-amber-500/20 bg-card/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-sm">
                      <div className="font-semibold font-mono">{o.serial_number || 'N/A'} <span className="text-muted-foreground font-sans font-normal">• PON {o.pon_port}{o.onu_id ? ` • ONU ${o.onu_id}` : ''}</span></div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>Rx <b className="text-foreground">{o.rx_power_dbm ?? '-'} dBm</b></span>
                        <span>Tx <b className="text-foreground">{o.tx_power_dbm ?? '-'} dBm</b></span>
                        <span>Dist <b className="text-foreground">{o.distance_m != null ? `${o.distance_m} m` : '-'}</b></span>
                        <span>Temp <b className="text-foreground">{o.temperature_c != null ? `${Number(o.temperature_c).toFixed(1)} °C` : '-'}</b></span>
                        <span className={`px-1.5 py-0.5 rounded-full border ${opticalTone(o.optical_status)}`}>{o.optical_status}</span>
                      </div>
                    </div>
                    <button onClick={() => { setAuthModal(o); setAuthSub(''); }} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Authorize</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="font-semibold">All ONUs & Telemetry ({activeOnus.length}{q ? ` / ${onus.filter(o=>o.status!=='DISCOVERED').length}` : ''})</div>
                <div className="text-[11px] text-muted-foreground">Rx/Tx, distance, DDM (temp/voltage/bias), status, subscriber link</div>
              </div>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search serial, name, PON, subscriber, MAC, status..." className="w-full sm:w-80 px-3 py-2 rounded-xl border border-border bg-background text-sm" />
            </div>
            <div className="overflow-auto max-h-[620px]">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr>
                  <th className="text-left px-4 py-2">ONU / Port</th>
                  <th className="text-left px-4 py-2">Subscriber</th>
                  <th className="text-left px-4 py-2">Rx / Tx</th>
                  <th className="text-left px-4 py-2">Distance</th>
                  <th className="text-left px-4 py-2">Temp / Volt / Bias</th>
                  <th className="text-left px-4 py-2">Status</th>
                </tr></thead>
                <tbody>
                  {activeOnus.map(o => (
                    <tr key={o.id} className="border-t border-border/70">
                      <td className="px-4 py-2"><div className="font-semibold">{o.name || o.serial_number}</div><div className="text-muted-foreground font-mono">{o.serial_number} • PON {o.pon_port}{o.onu_id ? ` • ONU ${o.onu_id}` : ''}{o.mac_address ? ` • ${o.mac_address}` : ''}</div></td>
                      <td className="px-4 py-2">{o.subscriber_name ? <><div>{o.subscriber_name}</div><div className="text-muted-foreground">{o.subscriber_code || ''}</div></> : <span className="text-muted-foreground">Unlinked</span>}</td>
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
                  {!activeOnus.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No ONUs{q ? ' matching search' : ''}.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {authModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">Authorize ONU</h2><button onClick={() => setAuthModal(null)} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button></div>
          <div className="p-5 space-y-3 text-sm">
            <div className="p-3 rounded-xl bg-muted/40 border border-border"><div className="font-mono font-semibold">{authModal.serial_number}</div><div className="text-xs text-muted-foreground">{olt.name} • PON {authModal.pon_port}</div></div>
            <label className="block"><div className="text-xs text-muted-foreground mb-1">Link Subscriber (optional)</div>
              <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={authSub} onChange={e => setAuthSub(e.target.value)}>
                <option value="">No subscriber link</option>
                {subscribers.map((s: any) => (<option key={s.id} value={s.id}>{s.client_code || ''} — {s.full_name} ({s.username || 'no username'})</option>))}
              </select>
            </label>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={() => setAuthModal(null)} className="px-4 py-2 rounded-xl border border-border">Cancel</button><button onClick={authorize} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Authorize</button></div>
        </div></div>
      )}
    </div>
  );
}
