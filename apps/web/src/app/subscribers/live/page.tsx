'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Live Subscribers (Online Sessions)</h1>
          <p className="text-sm text-muted-foreground">Real-time PPPoE/RADIUS subscriber sessions, throughput, router/NAS binding and provisioning mode (auto-refreshing).</p>
        </div>
        <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
      </div>

      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl border border-border bg-card"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>Online Sessions</span><Wifi className="w-4 h-4"/></div><div className="mt-2 text-xl font-black">{summary.online || 0}</div></div>
        <div className="p-4 rounded-2xl border border-border bg-card"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>Total Tracked</span><Activity className="w-4 h-4"/></div><div className="mt-2 text-xl font-black">{summary.total || sessions.length || 0}</div></div>
        <div className="p-4 rounded-2xl border border-border bg-card"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>Aggregate RX</span><ArrowDown className="w-4 h-4"/></div><div className="mt-2 text-xl font-black text-cyan-400">{fmtBps(Number(summary.aggRxBps || 0))}</div></div>
        <div className="p-4 rounded-2xl border border-border bg-card"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>Aggregate TX</span><ArrowUp className="w-4 h-4"/></div><div className="mt-2 text-xl font-black text-indigo-400">{fmtBps(Number(summary.aggTxBps || 0))}</div></div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-card text-sm" placeholder="Search username, name, client code, router, IP..." value={q} onChange={e=>setQ(e.target.value)} />
        </div>
        <select className="px-3 py-2.5 rounded-xl border border-border bg-card text-sm" value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ONLINE">ONLINE</option>
          <option value="OFFLINE">OFFLINE</option>
        </select>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">Live data source: <code className="font-mono">/api/network/sessions</code> (polling). SSE: <code className="font-mono">/api/network/sessions/stream</code>, WS: <code className="font-mono">/api/network/sessions/ws</code>.</div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-3">Subscriber</th><th className="text-left px-4 py-3">Router / NAS</th><th className="text-left px-4 py-3">Session / IP</th><th className="text-left px-4 py-3">Throughput</th><th className="text-left px-4 py-3">Status</th></tr></thead>
            <tbody>
              {filtered.map((s: AnyObj, i: number) => (
                <tr key={s.id || s.username || i} className="border-t border-border/70">
                  <td className="px-4 py-3"><div className="font-semibold">{s.full_name || s.username || '-'}</div><div className="text-xs text-muted-foreground font-mono">{s.username || ''} {s.client_code ? `• ${s.client_code}` : ''}</div><div className="text-[10px] text-muted-foreground mt-0.5">{s.provisioning_mode || ''}</div></td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><Router className="w-3.5 h-3.5 text-muted-foreground"/><span>{s.router_name || '-'}</span></div><div className="text-xs text-muted-foreground">{s.integration_mode || ''}</div></td>
                  <td className="px-4 py-3 text-xs"><div className="font-mono">{s.ip_address || '-'}</div><div className="text-muted-foreground">Uptime: {s.uptime || '-'}</div></td>
                  <td className="px-4 py-3 text-xs"><div className="text-cyan-400">↓ RX {fmtBps(Number(s.rx_bps || 0))}</div><div className="text-indigo-400">↑ TX {fmtBps(Number(s.tx_bps || 0))}</div></td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full border ${String(s.status).toUpperCase()==='ONLINE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-muted text-muted-foreground border-border'}`}>{s.status || 'UNKNOWN'}</span></td>
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