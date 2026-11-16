'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { ArrowLeft, RefreshCw, Play, Server, Activity, Wifi, ShieldCheck, Link2, Globe, Cpu, HardDrive, ArrowDown, ArrowUp, Network, Users, Signal } from 'lucide-react';

function modeBadge(m: string) {
  const v = String(m || '').toUpperCase();
  if (v === 'RADIUS') return 'bg-violet-500/10 text-violet-400 border-violet-500/20';
  if (v === 'REST') return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
  return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card p-4">
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

function fmtBps(bps: number) {
  const n = Number(bps || 0);
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n > 1e6) return `${(n / 1e6).toFixed(2)} Mbps`;
  return `${(n / 1e3).toFixed(1)} Kbps`;
}
function fmtUptime(sec: number) {
  const s = Number(sec || 0);
  if (!s) return '-';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export default function RouterDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const { token } = useAuth();
  const [router, setRouter] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        apiFetch<any>(`/api/network/routers/${id}`, {}, token),
        apiFetch<{ data: any[]; summary?: any }>('/api/network/sessions', {}, token).catch(() => ({ data: [], summary: null })),
      ]);
      setRouter(r);
      const all = s.data || [];
      setSessions(all.filter((x: any) => x.router_id === id || String(x.router_name || '') === String(r.name || '')));
      setSummary(s.summary || null);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load router');
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4500); return () => clearTimeout(t); } }, [msg]);

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

  const testConn = () => run('Test complete', () => apiFetch<any>(`/api/network/routers/${id}/test`, { method: 'POST' }, token!));
  const provisionWalledGarden = () => run('Walled-garden provisioned', async () => {
    const r = await apiFetch<any>('/api/billing/walled-garden/provision-router', { method: 'POST', body: JSON.stringify({ router_id: id }) }, token!);
    return { ...r, message: r.ok ? `Walled-garden redirect rules provisioned.` : (r.message || 'Provisioning completed with notes') };
  });
  const syncRadiusNas = () => run('RADIUS NAS sync complete', () => apiFetch<any>('/api/network/routers/sync-radius-nas', { method: 'POST' }, token!));

  const derived = useMemo(() => {
    const online = sessions.filter(s => s.status === 'ONLINE').length;
    const totalRx = sessions.reduce((a, s) => a + Number(s.rx_bps || 0), 0);
    const totalTx = sessions.reduce((a, s) => a + Number(s.tx_bps || 0), 0);
    return { online, offline: Math.max(0, sessions.length - online), totalRx, totalTx };
  }, [sessions]);

  if (loading && !router) return <div className="p-6 text-sm text-muted-foreground">Loading router...</div>;
  if (!router) return <div className="p-6 space-y-3"><div className="text-red-400">{error || 'Router not found'}</div><Link href="/routers" className="text-primary underline">Back to Routers</Link></div>;

  const mode = String(router.integration_mode || 'API').toUpperCase();
  const isDirect = mode === 'API' || mode === 'REST';
  const st = router.stats || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href="/routers" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="w-3.5 h-3.5" />Back to Routers</Link>
          <h1 className="page-title"><Server className="w-6 h-6 text-primary" />{router.name} <span className="text-sm font-semibold text-muted-foreground">360° View</span></h1>
          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 items-center">
            <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${modeBadge(mode)}`}>{mode}</span>
            <span>{router.router_type || 'Router'} {router.ros_version || ''}</span>
            <span>• Host: <span className="font-mono text-foreground">{router.host}</span></span>
            <span>• Site: {router.site || '—'}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn btn-outline inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button onClick={testConn} className="btn btn-outline inline-flex items-center gap-2"><Play className="w-4 h-4" />Test</button>
          {isDirect && <button onClick={provisionWalledGarden} className="btn btn-outline inline-flex items-center gap-2"><Globe className="w-4 h-4" />Provision Walled Garden</button>}
          {mode === 'RADIUS' && <button onClick={syncRadiusNas} className="btn btn-outline inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Sync RADIUS NAS</button>}
          <Link href="/routers" className="btn btn-outline inline-flex items-center gap-2"><Network className="w-4 h-4" />Overview & Import</Link>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label="Status" value={<span className={`text-sm px-2 py-0.5 rounded-full border ${router.status==='ONLINE'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':router.status==='OFFLINE'?'bg-red-500/10 text-red-400 border-red-500/20':'bg-muted text-muted-foreground border-border'}`}>{router.status || 'UNKNOWN'}</span>} sub={router.last_seen_at ? new Date(router.last_seen_at).toLocaleString() : 'Never seen'} />
        <Stat label="Uptime" value={fmtUptime(Number(router.uptime_seconds || 0))} sub={router.identity || '-'} />
        <Stat label="CPU" value={router.cpu_load != null ? `${Number(router.cpu_load).toFixed(1)}%` : (isDirect ? '—' : 'N/A')} sub={isDirect ? 'RouterOS telemetry' : 'RADIUS NAS'} />
        <Stat label="Memory" value={router.memory_total_mb ? `${Number(router.memory_used_mb||0).toFixed(0)}/${Number(router.memory_total_mb||0).toFixed(0)} MB` : (isDirect ? '—' : 'N/A')} />
        <Stat label="Aggregate RX" value={fmtBps(Number(router.rx_bps || derived.totalRx || 0))} sub="Current/derived" />
        <Stat label="Aggregate TX" value={fmtBps(Number(router.tx_bps || derived.totalTx || 0))} sub="Current/derived" />
        <Stat label="Sessions" value={st.online_sessions ?? derived.online} sub={`${st.total_sessions ?? sessions.length} total tracked`} />
        <Stat label="Assigned Subs" value={st.assigned_subscribers ?? 0} sub="Provisioned to router" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-1 space-y-4">
          <div className="card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Activity className="w-4 h-4 text-primary" />Identity & Integration</h2>
            <KV k="Router ID" v={router.id} mono />
            <KV k="Name" v={router.name} />
            <KV k="Integration" v={<span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${modeBadge(mode)}`}>{mode}</span>} />
            <KV k="Type / Version" v={`${router.router_type || '-'} ${router.ros_version || ''}`} />
            <KV k="Identity" v={router.identity || '-'} />
            <KV k="Board" v={router.board_name || '-'} />
            <KV k="Enabled" v={router.is_enabled ? 'Yes' : 'No'} />
          </div>

          <div className="card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Network className="w-4 h-4 text-primary" />Connectivity & Access</h2>
            <KV k="Host / IP" v={router.host} mono />
            {isDirect ? <>
              <KV k="API Port" v={router.api_port ?? '-'} />
              <KV k="REST Port" v={router.rest_port ?? '-'} />
              <KV k="Username" v={router.username || '-'} />
              <KV k="Use SSL" v={router.use_ssl ? 'Yes' : 'No'} />
            </> : <>
              <KV k="NAS Identifier" v={router.nas_identifier || '-'} />
              <KV k="CoA / PoD Port" v={router.coa_port ?? 3799} />
              <KV k="RADIUS Secret" v={router.radius_secret ? 'Configured' : 'Missing'} />
            </>}
            <KV k="Site" v={router.site || '-'} />
            <KV k="Last Seen" v={router.last_seen_at ? new Date(router.last_seen_at).toLocaleString() : '-'} />
            <KV k="Created" v={router.created_at ? new Date(router.created_at).toLocaleString() : '-'} />
            <KV k="Updated" v={router.updated_at ? new Date(router.updated_at).toLocaleString() : '-'} />
          </div>

          <div className="card p-4">
            <h2 className="font-bold flex items-center gap-2 mb-2"><Signal className="w-4 h-4 text-primary" />Capabilities & Notes</h2>
            <div className="text-sm space-y-2 text-muted-foreground">
              {isDirect ? (
                <>
                  <div className="flex items-start gap-2"><Link2 className="w-4 h-4 mt-0.5 text-primary" /><span>Direct RouterOS {mode} provisioning: PPP profiles/secrets, queues, telemetry, and active session polling (where supported).</span></div>
                  <div className="flex items-start gap-2"><Globe className="w-4 h-4 mt-0.5 text-primary" /><span>Walled-garden redirect rules can be provisioned to this router via API/REST.</span></div>
                  <div className="flex items-start gap-2"><Users className="w-4 h-4 mt-0.5 text-primary" /><span>Use “Overview & Import” for MikroTik PPP/Hotspot user & profile import.</span></div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2"><ShieldCheck className="w-4 h-4 mt-0.5 text-violet-400" /><span>RADIUS NAS: centralized AAA/CoA across RADIUS-enabled routers. Ensure FreeRADIUS NAS/client config is synced and reloaded if required.</span></div>
                  <div className="flex items-start gap-2"><Globe className="w-4 h-4 mt-0.5 text-violet-400" /><span>Captive/walled-garden firewall/NAT redirect rules must be configured on the NAS device (not pushed via RADIUS-only mode).</span></div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-3 flex items-center gap-2"><Cpu className="w-4 h-4 text-primary" /><div><div className="text-[11px] text-muted-foreground">CPU</div><div className="font-bold">{router.cpu_load != null ? `${Number(router.cpu_load).toFixed(1)}%` : '—'}</div></div></div>
            <div className="card p-3 flex items-center gap-2"><HardDrive className="w-4 h-4 text-primary" /><div><div className="text-[11px] text-muted-foreground">Memory</div><div className="font-bold text-sm">{router.memory_total_mb ? `${Number(router.memory_used_mb||0).toFixed(0)}/${Number(router.memory_total_mb||0).toFixed(0)} MB` : '—'}</div></div></div>
            <div className="card p-3 flex items-center gap-2"><ArrowDown className="w-4 h-4 text-cyan-400" /><div><div className="text-[11px] text-muted-foreground">RX (agg)</div><div className="font-bold text-sm">{fmtBps(Number(router.rx_bps || derived.totalRx || 0))}</div></div></div>
            <div className="card p-3 flex items-center gap-2"><ArrowUp className="w-4 h-4 text-indigo-400" /><div><div className="text-[11px] text-muted-foreground">TX (agg)</div><div className="font-bold text-sm">{fmtBps(Number(router.tx_bps || derived.totalTx || 0))}</div></div></div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold flex items-center gap-2"><Wifi className="w-4 h-4 text-primary" />Live Sessions on this Router ({sessions.length})</div>
                <div className="text-[11px] text-muted-foreground">{derived.online} online • RX {fmtBps(derived.totalRx)} • TX {fmtBps(derived.totalTx)}</div>
              </div>
              <Link href="/subscribers/live" className="btn btn-outline btn-sm">Global Live View</Link>
            </div>
            <div className="overflow-auto max-h-[560px]">
              <table className="table table-hover text-xs">
                <thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr>
                  <th className="text-left px-4 py-2">Subscriber</th>
                  <th className="text-left px-4 py-2">IP / MAC</th>
                  <th className="text-left px-4 py-2">Throughput</th>
                  <th className="text-left px-4 py-2">Mode</th>
                  <th className="text-left px-4 py-2">Status</th>
                </tr></thead>
                <tbody>
                  {sessions.map((s: any, i: number) => (
                    <tr key={s.id || `${s.username}-${i}`} className="border-t border-border/70">
                      <td className="px-4 py-2"><div className="font-medium">{s.full_name || s.username}</div><div className="text-muted-foreground font-mono">{s.username}</div><div className="text-[10px] text-muted-foreground">{s.client_code || ''}</div></td>
                      <td className="px-4 py-2"><div>{s.ip_address || '-'}</div><div className="text-muted-foreground font-mono">{s.mac_address || '-'}</div></td>
                      <td className="px-4 py-2"><div className="text-cyan-400">↓ {fmtBps(Number(s.rx_bps || 0))}</div><div className="text-indigo-400">↑ {fmtBps(Number(s.tx_bps || 0))}</div></td>
                      <td className="px-4 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded border border-border">{s.provisioning_mode || '-'}</span></td>
                      <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full border font-semibold ${s.status==='ONLINE'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':'bg-muted text-muted-foreground border-border'}`}>{s.status}</span></td>
                    </tr>
                  ))}
                  {!sessions.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No session data for this router yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
