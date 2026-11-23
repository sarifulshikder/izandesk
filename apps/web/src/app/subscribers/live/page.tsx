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
      const res = await apiFetch<{ data: AnyObj[]; summary: AnyObj }>('/api/network/sessions?nopoll=1', {}, token);
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
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Network operations · Live sessions</span>
          <h1 className="page-title">Live Subscribers (Online Sessions)</h1>
          <p className="page-subtitle">PPPoE/RADIUS subscriber sessions, router/NAS binding and provisioning mode from last known state (auto-refreshing, no router polling).</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="stat-grid">
        <div className="dash-stat dash-stat-success"><span className="dash-stat-icon"><Wifi className="w-4 h-4"/></span><span className="dash-stat-body"><span className="dash-stat-label">Online Sessions</span><span className="dash-stat-value">{summary.online || 0}</span><span className="dash-stat-hint">active PPPoE sessions</span></span></div>
        <div className="dash-stat dash-stat-primary"><span className="dash-stat-icon"><Activity className="w-4 h-4"/></span><span className="dash-stat-body"><span className="dash-stat-label">Total Tracked</span><span className="dash-stat-value">{summary.total || sessions.length || 0}</span><span className="dash-stat-hint">in current view</span></span></div>
        <div className="dash-stat dash-stat-info"><span className="dash-stat-icon"><ArrowDown className="w-4 h-4"/></span><span className="dash-stat-body"><span className="dash-stat-label">Aggregate RX</span><span className="dash-stat-value">{fmtBps(Number(summary.aggRxBps || 0))}</span><span className="dash-stat-hint">downstream throughput</span></span></div>
        <div className="dash-stat dash-stat-indigo"><span className="dash-stat-icon"><ArrowUp className="w-4 h-4"/></span><span className="dash-stat-body"><span className="dash-stat-label">Aggregate TX</span><span className="dash-stat-value">{fmtBps(Number(summary.aggTxBps || 0))}</span><span className="dash-stat-hint">upstream throughput</span></span></div>
      </div>

      <div className="toolbar-strip">
        <div className="relative flex-1 min-w-[220px] input-icon">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="form-control pl-9" placeholder="Search username, name, client code, router, IP..." value={q} onChange={e=>setQ(e.target.value)} />
        </div>
        <span className="toolbar-divider"/>
        <select className="form-select !w-[150px]" value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ONLINE">ONLINE</option>
          <option value="OFFLINE">OFFLINE</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header text-xs text-muted-foreground">Data source: <code className="font-mono">/api/network/sessions?nopoll=1</code> (DB polling, no router login). SSE/WS endpoints exist for live streams when explicitly used.</div>
        <div className="table-wrap overflow-auto">
          <table className="table table-hover min-w-[720px]">
            <thead className="sticky top-0 z-10"><tr><th className="text-left px-3 py-2.5">Subscriber</th><th className="text-left px-3 py-2.5">Router / NAS</th><th className="text-left px-3 py-2.5">Session / IP</th><th className="text-left px-3 py-2.5">Throughput</th><th className="text-left px-3 py-2.5">Status</th></tr></thead>
            <tbody>
              {filtered.map((s: AnyObj, i: number) => (
                <tr key={s.id || s.username || i} className="border-t border-border/70 hover:bg-muted/20">
                  <td className="px-3 py-2.5 text-[11px]">
                    {s.subscriber_id ? (
                      <Link href={`/subscribers/${s.subscriber_id}/live`} className="block group">
                        <div className="font-semibold text-foreground group-hover:text-primary group-hover:underline underline-offset-2 truncate max-w-[210px]" title={s.full_name || s.username || ''}>{s.full_name || s.username || '-'}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[210px]">{s.username || ''} {s.client_code ? `• ${s.client_code}` : ''}</div>
                        <div className="text-[10px] text-primary/80 mt-0.5">Open live dashboard →</div>
                      </Link>
                    ) : (
                      <>
                        <div className="font-semibold truncate max-w-[210px]" title={s.full_name || s.username || ''}>{s.full_name || s.username || '-'}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[210px]">{s.username || ''} {s.client_code ? `• ${s.client_code}` : ''}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{s.provisioning_mode || ''}</div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]"><div className="flex items-center gap-2"><Router className="w-3.5 h-3.5 text-muted-foreground"/><span className="truncate max-w-[130px]">{s.router_name || '-'}</span></div><div className="text-[10px] text-muted-foreground">{s.integration_mode || ''}</div></td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums"><div className="font-mono">{s.ip_address || '-'}</div><div className="text-[10px] text-muted-foreground">Uptime: {s.uptime || fmtUptime(s.uptime_sec)}</div></td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums whitespace-nowrap"><div className="text-info">↓ RX {fmtBps(Number(s.rx_bps || 0))}</div><div className="text-indigo">↑ TX {fmtBps(Number(s.tx_bps || 0))}</div></td>
                  <td className="px-3 py-2.5"><span className={`badge ${String(s.status).toUpperCase()==='ONLINE' ? 'badge-success' : 'badge-secondary'}`}>{s.status || 'UNKNOWN'}</span></td>
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