'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Activity, Wifi, ArrowDown, ArrowUp, Search, Router } from 'lucide-react';

type AnyObj = Record<string, any>;

function fmtBps(bps: number) {
  const n = Number(bps || 0);
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n > 1e6) return `${(n / 1e6).toFixed(2)} Mbps`;
  return `${(n / 1e3).toFixed(1)} Kbps`;
}
function fmtUptime(sec: any) {
  const s = Math.max(0, Number(sec || 0));
  if (!s) return '-';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function LiveSubscribersPage() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<AnyObj[]>([]);
  const [summary, setSummary] = useState<AnyObj>({ online: 0, total: 0, aggRxBps: 0, aggTxBps: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ONLINE');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<{ data: AnyObj[]; summary: AnyObj }>('/api/network/sessions', {}, token);
      setSessions(res.data || []);
      setSummary(res.summary || {});
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return sessions.filter((s) => {
      if (status && String(s.status || '').toUpperCase() !== status) return false;
      if (!qq) return true;
      return [s.username, s.full_name, s.client_code, s.router_name, s.ip_address, s.provisioning_mode].some(v => String(v || '').toLowerCase().includes(qq));
    });
  }, [sessions, q, status]);

  return (
    <div className="space-y-5">
      <div className="page-header flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Live Subscribers (Online Sessions)</h1>
          <p className="page-subtitle">Real-time PPPoE/RADIUS subscriber sessions, throughput, router/NAS binding and provisioning mode (auto-refreshing).</p>
        </div>
        <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 border-emerald-500/20 bg-emerald-500/5"><div className="flex items-center justify-between text-xs text-emerald-300/80"><span>Online Sessions</span><Wifi className="w-4 h-4"/></div><div className="mt-2 text-xl font-black text-emerald-400">{summary.online || 0}</div></div>
        <div className="card p-4"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>Total Tracked</span><Activity className="w-4 h-4"/></div><div className="mt-2 text-xl font-black">{summary.total || sessions.length || 0}</div></div>
        <div className="card p-4 border-cyan-500/20 bg-cyan-500/5"><div className="flex items-center justify-between text-xs text-cyan-300/80"><span>Aggregate RX</span><ArrowDown className="w-4 h-4"/></div><div className="mt-2 text-xl font-black text-cyan-400">{fmtBps(Number(summary.aggRxBps || 0))}</div></div>
        <div className="card p-4 border-indigo-500/20 bg-indigo-500/5"><div className="flex items-center justify-between text-xs text-indigo-300/80"><span>Aggregate TX</span><ArrowUp className="w-4 h-4"/></div><div className="mt-2 text-xl font-black text-indigo-400">{fmtBps(Number(summary.aggTxBps || 0))}</div></div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1 input-icon">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="form-control pl-9" placeholder="Search username, name, client code, router, IP..." value={q} onChange={e=>setQ(e.target.value)} />
        </div>
        <select className="form-select" value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ONLINE">ONLINE</option>
          <option value="OFFLINE">OFFLINE</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header text-xs text-muted-foreground">Live data source: <code className="font-mono">/api/network/sessions</code> (polling). SSE: <code className="font-mono">/api/network/sessions/stream</code>, WS: <code className="font-mono">/api/network/sessions/ws</code>.</div>
        <div className="table-wrap">
          <table className="table table-hover">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-3">Subscriber</th><th className="text-left px-4 py-3">Router / NAS</th><th className="text-left px-4 py-3">Session / IP</th><th className="text-left px-4 py-3">Throughput</th><th className="text-left px-4 py-3">Status</th></tr></thead>
            <tbody>
              {filtered.map((s: AnyObj, i: number) => (
                <tr key={s.id || s.username || i} className="border-t border-border/70 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    {s.subscriber_id ? (
                      <Link href={`/subscribers/${s.subscriber_id}/live`} className="block group">
                        <div className="font-semibold text-foreground group-hover:text-primary group-hover:underline underline-offset-2">{s.full_name || s.username || '-'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{s.username || ''} {s.client_code ? `• ${s.client_code}` : ''}</div>
                        <div className="text-[10px] text-primary/80 mt-0.5">Open live dashboard →</div>
                      </Link>
                    ) : (
                      <>
                        <div className="font-semibold">{s.full_name || s.username || '-'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{s.username || ''} {s.client_code ? `• ${s.client_code}` : ''}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{s.provisioning_mode || ''}</div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><Router className="w-3.5 h-3.5 text-muted-foreground"/><span>{s.router_name || '-'}</span></div><div className="text-xs text-muted-foreground">{s.integration_mode || ''}</div></td>
                  <td className="px-4 py-3 text-xs"><div className="font-mono">{s.ip_address || '-'}</div><div className="text-muted-foreground">Uptime: {s.uptime || fmtUptime(s.uptime_sec)}</div></td>
                  <td className="px-4 py-3 text-xs"><div className="text-cyan-400">↓ RX {fmtBps(Number(s.rx_bps || 0))}</div><div className="text-indigo-400">↑ TX {fmtBps(Number(s.tx_bps || 0))}</div></td>
                  <td className="px-4 py-3"><span className={`badge ${String(s.status).toUpperCase()==='ONLINE' ? 'badge-success' : 'badge-secondary'}`}>{s.status || 'UNKNOWN'}</span></td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{loading ? 'Loading live sessions...' : 'No live sessions found for current filter.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}