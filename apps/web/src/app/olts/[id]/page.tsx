'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { ArrowLeft, RefreshCw, Play, Search, Radio, Wifi, CheckCircle2, X, Server, Activity, Signal } from 'lucide-react';

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
    return onus.filter(o => [o.serial_number, o.name, o.pon_port, o.subscriber_name, o.subscriber_code, o.mac_address, o.status].some(v => String(v || '').toLowerCase().includes(term)));
  }, [onus, q]);
  const discovered = filtered.filter(o => o.status === 'DISCOVERED');
  const activeOnus = filtered.filter(o => o.status !== 'DISCOVERED');

  if (loading && !olt) return <div className="p-6 text-sm text-muted-foreground">Loading OLT...</div>;
  if (!olt) return <div className="p-6 space-y-3"><div className="text-red-400">{error || 'OLT not found'}</div><Link href="/olts" className="text-primary underline">Back to OLTs</Link></div>;

  const s = olt.stats || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href="/olts" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="w-3.5 h-3.5" />Back to OLTs</Link>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><Server className="w-6 h-6 text-primary" />{olt.name}</h1>
          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            <span>{olt.vendor} {olt.model || ''}</span>
            <span>• Host: <span className="font-mono text-foreground">{olt.host}</span></span>
            <span>• Site: {olt.site || '—'}</span>
            {olt.wg_peer_name && <span>• WG: <span className="text-cyan-400">{olt.wg_peer_name}{olt.wg_peer_tunnel_ip ? ` (${olt.wg_peer_tunnel_ip})` : ''}</span></span>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" />Refresh</button>
          <button onClick={testOlt} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Play className="w-4 h-4" />Test</button>
          <button onClick={discover} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Search className="w-4 h-4" />Discover ONUs</button>
          <button onClick={refreshTelemetry} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Radio className="w-4 h-4" />Refresh Telemetry</button>
          <button onClick={autoLink} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><Wifi className="w-4 h-4" />Auto-Link</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat label="Status" value={<span className={`text-base px-2 py-0.5 rounded-full border ${olt.status==='ONLINE'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':olt.status==='OFFLINE'?'bg-red-500/10 text-red-400 border-red-500/20':'bg-muted text-muted-foreground border-border'}`}>{olt.status}</span>} sub={olt.last_seen_at ? new Date(olt.last_seen_at).toLocaleString() : 'Never seen'} />
        <Stat label="Total ONUs" value={s.total_onus ?? 0} />
        <Stat label="Online" value={<span className="text-emerald-400">{s.online_onus ?? 0}</span>} />
        <Stat label="Offline" value={<span className="text-red-400">{s.offline_onus ?? 0}</span>} />
        <Stat label="Authorized" value={s.authorized_onus ?? 0} />
        <Stat label="Linked" value={s.linked_onus ?? 0} sub={`${s.discovered_onus ?? 0} discovered`} />
        <Stat label="Avg Rx" value={s.avg_rx_power_dbm != null ? `${Number(s.avg_rx_power_dbm).toFixed(2)} dBm` : '—'} sub="Across ONUs" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3 xl:col-span-1">
          <h2 className="font-bold flex items-center gap-2"><Activity className="w-4 h-4 text-primary" />OLT Details</h2>
          <div className="text-sm space-y-2">
            {[['Vendor / Model', `${olt.vendor || '-'} ${olt.model || ''}`], ['Host', olt.host], ['SSH / SNMP Port', `${olt.ssh_port || 23} / ${olt.snmp_port || 161}`], ['Username', olt.username || '-'], ['SNMP Community', olt.snmp_community || '-'], ['Site', olt.site || '-'], ['Enabled', olt.is_enabled ? 'Yes' : 'No'], ['WG Peer', olt.wg_peer_name ? `${olt.wg_peer_name}${olt.wg_peer_tunnel_ip ? ` (${olt.wg_peer_tunnel_ip})` : ''}` : 'None'], ['Updated', olt.updated_at ? new Date(olt.updated_at).toLocaleString() : '-']].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-3 py-1 border-b border-border/50 last:border-0">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-right break-all">{String(v ?? '-')}</span>
              </div>
            ))}
          </div>
          <div className="pt-1 text-xs text-muted-foreground">Optical thresholds: NORMAL ≥ -27 dBm, WARNING &lt; -27 dBm, CRITICAL ≤ -30 or ≥ -8 dBm.</div>
        </div>

        <div className="xl:col-span-2 space-y-4">
          {discovered.length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <h2 className="font-bold flex items-center gap-2 mb-3"><Signal className="w-4 h-4 text-amber-400" />Discovered / Pending ({discovered.length})</h2>
              <div className="space-y-2 max-h-[220px] overflow-auto">
                {discovered.map(o => (
                  <div key={o.id} className="p-3 rounded-xl border border-amber-500/20 bg-card/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-sm">
                      <div className="font-semibold font-mono">{o.serial_number || 'N/A'} <span className="text-muted-foreground font-sans font-normal">• PON {o.pon_port}</span></div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>Rx <b className="text-foreground">{o.rx_power_dbm ?? '-'} dBm</b></span>
                        <span>Tx <b className="text-foreground">{o.tx_power_dbm ?? '-'} dBm</b></span>
                        <span>Dist <b className="text-foreground">{o.distance_m != null ? `${o.distance_m} m` : '-'}</b></span>
                        <span>Temp <b className="text-foreground">{o.temperature_c != null ? `${Number(o.temperature_c).toFixed(1)} °C` : '-'}</b></span>
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
              <span className="font-semibold">ONUs ({activeOnus.length})</span>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search serial, name, PON, subscriber, MAC..." className="w-full sm:w-80 px-3 py-2 rounded-xl border border-border bg-background text-sm" />
            </div>
            <div className="overflow-auto max-h-[560px]">
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
                      <td className="px-4 py-2"><div className="font-semibold">{o.name || o.serial_number}</div><div className="text-muted-foreground font-mono">{o.serial_number} • PON {o.pon_port}{o.mac_address ? ` • ${o.mac_address}` : ''}</div></td>
                      <td className="px-4 py-2">{o.subscriber_name ? <><div>{o.subscriber_name}</div><div className="text-muted-foreground">{o.subscriber_code || o.username || ''}</div></> : <span className="text-muted-foreground">Unlinked</span>}</td>
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
