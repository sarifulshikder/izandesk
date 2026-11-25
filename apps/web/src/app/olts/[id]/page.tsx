'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { ArrowLeft, RefreshCw, Play, Search, Radio, Wifi, CheckCircle2, X, Server, Activity, Signal, Network, Gauge, AlertTriangle, Layers } from 'lucide-react';
import { TelemetryChart } from '@/components/charts/telemetry-chart';

function opticalTone(status: string) {
  if (status === 'CRITICAL') return 'badge badge-danger';
  if (status === 'WARNING') return 'badge badge-warning';
  if (status === 'NORMAL') return 'badge badge-success';
  return 'badge badge-secondary';
}

function Stat({ label, value, sub, tone='primary' }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className={`dash-stat dash-stat-${tone}`}>
      <span className="dash-stat-body">
        <span className="dash-stat-label">{label}</span>
        <span className="dash-stat-value text-base">{value}</span>
        {sub ? <span className="dash-stat-hint">{sub}</span> : null}
      </span>
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
  const [histOnu, setHistOnu] = useState<any>(null);
  const [histRows, setHistRows] = useState<any[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const openOnuHistory = async (onu: any) => {
    if (!token) return;
    setHistOnu(onu);
    setHistRows([]);
    setHistLoading(true);
    try {
      const r = await apiFetch<{ data: any[] }>(`/api/olt/onus/${onu.id}/history?hours=168`, {}, token);
      setHistRows(r.data || []);
    } catch {
      setHistRows([]);
    } finally {
      setHistLoading(false);
    }
  };

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
  if (!olt) return <div className="p-6 space-y-3"><div className="text-danger">{error || 'OLT not found'}</div><Link href="/olts" className="text-primary underline">Back to OLTs</Link></div>;

  const s = olt.stats || {};

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div className="space-y-1">
          <Link href="/olts" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="w-3.5 h-3.5" />Back to OLTs</Link>
          <span className="page-eyebrow">Access Network · OLT Detail</span>
          <h1 className="page-title"><Server className="w-6 h-6 text-primary" />{olt.name} <span className="text-sm font-semibold text-muted-foreground">360° View</span></h1>
          <div className="page-subtitle flex flex-wrap gap-x-3 gap-y-1">
            <span>{olt.vendor} {olt.model || ''}</span>
            <span>• Host: <span className="font-mono text-foreground">{olt.host}</span></span>
            <span>• Site: {olt.site || '—'}</span>
            {olt.wg_peer_name && <span>• WG: <span className="text-info">{olt.wg_peer_name}{olt.wg_peer_tunnel_ip ? ` (${olt.wg_peer_tunnel_ip})` : ''}</span></span>}
          </div>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button onClick={testOlt} className="btn btn-outline"><Play className="w-4 h-4" />Test</button>
          <button onClick={discover} className="btn btn-outline"><Search className="w-4 h-4" />Discover</button>
          <button onClick={refreshTelemetry} className="btn btn-outline"><Radio className="w-4 h-4" />Telemetry</button>
          <button onClick={autoLink} className="btn btn-outline"><Wifi className="w-4 h-4" />Auto-Link</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="OLT Status" value={<span className={`badge ${olt.status==='ONLINE'?'badge-success':olt.status==='OFFLINE'?'badge-danger':'badge-secondary'}`}>{olt.status}</span>} sub={olt.last_seen_at ? new Date(olt.last_seen_at).toLocaleString() : 'Never seen'} tone={olt.status==='ONLINE'?'success':olt.status==='OFFLINE'?'danger':'secondary'} />
        <Stat label="Total ONUs" value={s.total_onus ?? onus.length} sub={`${derived.ponCount} PON port(s)`} tone="info" />
        <Stat label="Online / Offline" value={<><span className="text-success">{s.online_onus ?? derived.online}</span><span className="text-muted-foreground text-base"> / </span><span className="text-danger">{s.offline_onus ?? derived.offline}</span></>} tone="success" />
        <Stat label="Authorized" value={s.authorized_onus ?? 0} sub={`${s.discovered_onus ?? derived.discoveredCount} discovered`} tone="purple" />
        <Stat label="Linked to Subs" value={<span className="text-success">{s.linked_onus ?? derived.linked}</span>} sub={`${derived.unlinked} unlinked`} tone="teal" />
        <Stat label="Optical Critical" value={<span className="text-danger">{derived.critical}</span>} sub={`${derived.warning} warning`} tone="danger" />
        <Stat label="Optical Healthy" value={<span className="text-success">{derived.normal}</span>} sub={`${derived.unknownOpt} unknown`} tone="success" />
        <Stat label="Avg Rx Power" value={s.avg_rx_power_dbm != null ? `${Number(s.avg_rx_power_dbm).toFixed(2)} dBm` : '—'} sub="Across ONUs" tone="warning" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-1 space-y-4">
          <div className="card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Activity className="w-4 h-4 text-primary" />Identity &amp; Access</h2>
            <KV k="OLT ID" v={olt.id} mono />
            <KV k="Vendor / Model" v={`${olt.vendor || '-'} ${olt.model || ''}`} />
            <KV k="Host / IP" v={olt.host} mono />
            <KV k="SSH Port" v={olt.ssh_port ?? 23} />
            <KV k="SNMP Port" v={olt.snmp_port ?? 161} />
            <KV k="Username" v={olt.username || '-'} />
            <KV k="SNMP Community" v={olt.snmp_community || '-'} />
            <KV k="Enabled" v={olt.is_enabled ? 'Yes' : 'No'} />
          </div>

          <div className="card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Network className="w-4 h-4 text-primary" />Connectivity &amp; Location</h2>
            <KV k="Site" v={olt.site || '-'} />
            <KV k="WG Peer" v={olt.wg_peer_name || 'None'} />
            <KV k="WG Tunnel IP" v={olt.wg_peer_tunnel_ip || '-'} mono />
            <KV k="WG Site" v={olt.wg_peer_site || '-'} />
            <KV k="Status" v={<span className={`badge ${olt.status==='ONLINE'?'badge-success':olt.status==='OFFLINE'?'badge-danger':'badge-secondary'}`}>{olt.status}</span>} />
            <KV k="Last Seen" v={olt.last_seen_at ? new Date(olt.last_seen_at).toLocaleString() : '-'} />
            <KV k="Created" v={olt.created_at ? new Date(olt.created_at).toLocaleString() : '-'} />
            <KV k="Updated" v={olt.updated_at ? new Date(olt.updated_at).toLocaleString() : '-'} />
          </div>

          <div className="card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Gauge className="w-4 h-4 text-primary" />Health &amp; Optical Summary</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="dash-stat compact dash-stat-success"><span className="dash-stat-body"><span className="dash-stat-label">Normal</span><span className="dash-stat-value tabular-nums">{derived.normal}</span></span></div>
              <div className="dash-stat compact dash-stat-warning"><span className="dash-stat-body"><span className="dash-stat-label">Warning</span><span className="dash-stat-value tabular-nums">{derived.warning}</span></span></div>
              <div className="dash-stat compact dash-stat-danger"><span className="dash-stat-body"><span className="dash-stat-label">Critical</span><span className="dash-stat-value tabular-nums">{derived.critical}</span></span></div>
              <div className="dash-stat compact dash-stat-secondary"><span className="dash-stat-body"><span className="dash-stat-label">Unknown</span><span className="dash-stat-value tabular-nums">{derived.unknownOpt}</span></span></div>
            </div>
            <div className="alert alert-warning mt-3 text-xs flex items-start gap-2"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warning" />Thresholds: NORMAL ≥ -27 dBm, WARNING &lt; -27 dBm, CRITICAL ≤ -30 or ≥ -8 dBm.</div>
          </div>

          <div className="card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Layers className="w-4 h-4 text-primary" />PON Port Breakdown</h2>
            <div className="space-y-2 max-h-[260px] overflow-auto">
              {derived.ponRows.map(p => (
                <div key={p.pon} className="p-2.5 rounded-xl border border-border/70 bg-muted/20">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold text-sm">{p.pon}</span><span className="text-xs text-muted-foreground tabular-nums">{p.total} ONU(s)</span></div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="badge badge-success">On {p.online}</span>
                    <span className="badge badge-danger">Off {p.offline}</span>
                    {p.discovered > 0 && <span className="badge badge-warning">Disc {p.discovered}</span>}
                    {p.critical > 0 && <span className="badge badge-danger">Crit {p.critical}</span>}
                    {p.warning > 0 && <span className="badge badge-warning">Warn {p.warning}</span>}
                  </div>
                </div>
              ))}
              {!derived.ponRows.length && <div className="empty-panel"><span className="empty-panel-icon"><Layers className="w-5 h-5"/></span><div><div className="text-sm font-semibold">No PON/ONU data yet</div><p className="text-[11px] text-muted-foreground mt-1">Run discovery to populate PON ports.</p></div></div>}
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-4">
          {discovered.length > 0 && (
            <div className="alert alert-warning">
              <h2 className="font-bold flex items-center gap-2 mb-3"><Signal className="w-4 h-4 text-warning" />Discovered / Pending Authorization ({discovered.length})</h2>
              <div className="space-y-2 max-h-[240px] overflow-auto">
                {discovered.map(o => (
                  <div key={o.id} className="card p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-sm">
                      <div className="font-semibold font-mono">{o.serial_number || 'N/A'} <span className="text-muted-foreground font-sans font-normal">• PON {o.pon_port}{o.onu_id ? ` • ONU ${o.onu_id}` : ''}</span></div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>Rx <b className="text-foreground tabular-nums">{o.rx_power_dbm ?? '-'} dBm</b></span>
                        <span>Tx <b className="text-foreground tabular-nums">{o.tx_power_dbm ?? '-'} dBm</b></span>
                        <span>Dist <b className="text-foreground tabular-nums">{o.distance_m != null ? `${o.distance_m} m` : '-'}</b></span>
                        <span>Temp <b className="text-foreground tabular-nums">{o.temperature_c != null ? `${Number(o.temperature_c).toFixed(1)} °C` : '-'}</b></span>
                        <span className={opticalTone(o.optical_status)}>{o.optical_status}</span>
                      </div>
                    </div>
                    <button onClick={() => { setAuthModal(o); setAuthSub(''); }} className="btn btn-primary"><CheckCircle2 className="w-4 h-4" />Authorize</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="font-semibold">All ONUs &amp; Telemetry ({activeOnus.length}{q ? ` / ${onus.filter(o=>o.status!=='DISCOVERED').length}` : ''})</div>
                <div className="text-[11px] text-muted-foreground">Rx/Tx, distance, DDM (temp/voltage/bias), status, subscriber link</div>
              </div>
              <div className="input-icon w-full sm:w-80"><Search className="w-4 h-4"/><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search serial, name, PON, subscriber, MAC, status..." className="form-control" /></div>
            </div>
            <div className="table-wrap overflow-auto max-h-[620px]">
              <table className="table table-hover text-[11px]">
                <thead className="sticky top-0 z-10"><tr>
                  <th className="px-3 py-2.5">ONU / Port</th>
                  <th className="px-3 py-2.5">Subscriber</th>
                  <th className="px-3 py-2.5">Rx / Tx</th>
                  <th className="px-3 py-2.5">Distance</th>
                  <th className="px-3 py-2.5">Temp / Volt / Bias</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr></thead>
                <tbody>
                  {activeOnus.map(o => (
                    <tr key={o.id} className="border-t border-border/70">
                      <td className="px-3 py-2.5"><div className="font-semibold">{o.name || o.serial_number}</div><div className="text-muted-foreground font-mono">{o.serial_number} • PON {o.pon_port}{o.onu_id ? ` • ONU ${o.onu_id}` : ''}{o.mac_address ? ` • ${o.mac_address}` : ''}</div></td>
                      <td className="px-3 py-2.5">{o.subscriber_name ? <><div>{o.subscriber_name}</div><div className="text-muted-foreground">{o.subscriber_code || ''}</div></> : <span className="text-muted-foreground">Unlinked</span>}</td>
                      <td className="px-3 py-2.5 tabular-nums"><span className={`${opticalTone(o.optical_status)} mr-1`}>Rx {o.rx_power_dbm ?? '-'}</span><span className="text-muted-foreground">Tx {o.tx_power_dbm ?? '-'}</span></td>
                      <td className="px-3 py-2.5 tabular-nums">{o.distance_m != null ? `${o.distance_m} m` : <span className="text-muted-foreground">-</span>}</td>
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                        <div>{o.temperature_c != null ? `${Number(o.temperature_c).toFixed(1)} °C` : '-'}{o.voltage_v != null ? ` • ${Number(o.voltage_v).toFixed(2)} V` : ''}</div>
                        <div>Bias: {o.tx_bias_ma != null ? `${Number(o.tx_bias_ma).toFixed(1)} mA` : '-'}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`badge ${o.status==='AUTHORIZED'?'badge-success':o.status==='OFFLINE'?'badge-danger':o.status==='ONLINE'?'badge-success':'badge-secondary'}`}>{o.status}</span>
                        <div className={`text-[10px] mt-1 ${opticalTone(o.optical_status)}`}>{o.optical_status}</div>
                        {o.last_seen_at && <div className="text-[10px] text-muted-foreground mt-0.5">{new Date(o.last_seen_at).toLocaleString()}</div>}
                        <button type="button" onClick={() => void openOnuHistory(o)} className="text-[10px] text-primary hover:underline mt-1 inline-flex items-center gap-1"><Activity className="w-3 h-3" />Trend</button>
                      </td>
                    </tr>
                  ))}
                  {!activeOnus.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No ONUs{q ? ' matching search' : ''}.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {authModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto"><div className="w-full max-w-lg card my-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border"><h2 className="font-bold">Authorize ONU</h2><button onClick={() => setAuthModal(null)} className="btn btn-ghost btn-icon"><X className="w-4 h-4" /></button></div>
          <div className="p-5 space-y-3 text-sm">
            <div className="p-3 rounded-xl bg-muted/40 border border-border"><div className="font-mono font-semibold">{authModal.serial_number}</div><div className="text-xs text-muted-foreground">{olt.name} • PON {authModal.pon_port}</div></div>
            <label className="block"><div className="form-label">Link Subscriber (optional)</div>
              <select className="form-select" value={authSub} onChange={e => setAuthSub(e.target.value)}>
                <option value="">No subscriber link</option>
                {subscribers.map((s: any) => (<option key={s.id} value={s.id}>{s.client_code || ''} — {s.full_name} ({s.username || 'no username'})</option>))}
              </select>
            </label>
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={() => setAuthModal(null)} className="btn btn-outline">Cancel</button><button onClick={authorize} className="btn btn-primary"><CheckCircle2 className="w-4 h-4" />Authorize</button></div>
        </div></div>
      )}

      {histOnu && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-auto">
          <div className="w-full max-w-2xl card my-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="font-bold">ONU Optical Trend (7d)</h2>
                <div className="text-xs text-muted-foreground font-mono">{histOnu.name || histOnu.serial_number} • PON {histOnu.pon_port}</div>
              </div>
              <button onClick={() => setHistOnu(null)} className="btn btn-ghost btn-icon"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {histLoading ? (
                <div className="text-xs text-muted-foreground py-6 text-center">Loading optical history...</div>
              ) : (
                <>
                  <TelemetryChart
                    title="Optical Power (dBm)"
                    subtitle="Last 7 days"
                    labels={histRows.map((p: any) => new Date(p.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }))}
                    series={[
                      { label: 'Rx Power', color: '#14b8a6', values: histRows.map((p: any) => p.rx_power_dbm != null ? Number(p.rx_power_dbm) : null) },
                      { label: 'Tx Power', color: '#6366f1', values: histRows.map((p: any) => p.tx_power_dbm != null ? Number(p.tx_power_dbm) : null) },
                    ]}
                    unit=" dBm"
                  />
                  <TelemetryChart
                    title="ONU Temperature (°C)"
                    labels={histRows.map((p: any) => new Date(p.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }))}
                    series={[
                      { label: 'Temp', color: '#f59e0b', values: histRows.map((p: any) => p.temperature_c != null ? Number(p.temperature_c) : null) },
                    ]}
                    unit=" °C"
                    height={140}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
