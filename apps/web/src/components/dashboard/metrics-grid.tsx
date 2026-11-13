'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Users, CreditCard, AlertTriangle, Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';

function money(v: any) {
  const n = Number(v || 0);
  return `৳ ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtBps(bps: number) {
  const n = Number(bps || 0);
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} Mbps`;
  return `${(n / 1e3).toFixed(0)} Kbps`;
}

export function MetricsGrid() {
  const { token } = useAuth();
  const [data, setData] = useState<any>({ total: 0, online: 0, billing: null, sessions: null });

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [subs, sessions, billing] = await Promise.all([
        apiFetch<any>('/api/subscribers?limit=1', {}, token).catch(() => ({ total: 0 })),
        apiFetch<any>('/api/network/sessions', {}, token).catch(() => ({ data: [], summary: { online: 0, aggRxBps: 0, aggTxBps: 0 } })),
        apiFetch<any>('/api/billing/metrics', {}, token).catch(() => ({ metrics: {} })),
      ]);
      setData({ total: subs.total || 0, online: sessions?.summary?.online || 0, billing: billing?.metrics || {}, sessions: sessions?.summary || {} });
    } catch {}
  }, [token]);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const b = data.billing || {};
  const s = data.sessions || {};
  const kpis = [
    {
      title: 'Subscribers / Online',
      value: `${Number(data.total || 0).toLocaleString()}`,
      change: `${Number(data.online || 0)} online now`,
      isPositive: true,
      subDetail: `Live sessions tracked via AAA/network`,
      icon: Users,
      color: 'from-cyan-500/20 to-blue-500/20 text-cyan-400 border-cyan-500/30',
    },
    {
      title: 'This Month Collection',
      value: money(b.thisMonthCollections),
      change: `Today: ${money(b.todayCollections)}`,
      isPositive: true,
      subDetail: `Billed: ${money(b.monthlyBillGenerated)}`,
      icon: CreditCard,
      color: 'from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/30',
    },
    {
      title: 'Outstanding / Suspended',
      value: money(b.totalDueOutstanding),
      change: `${Number(b.suspendedDue || 0)} suspended/isolated`,
      isPositive: Number(b.totalDueOutstanding || 0) <= 0,
      subDetail: `Expired: ${Number(b.expiredThisMonth || 0)}`,
      icon: AlertTriangle,
      color: 'from-amber-500/20 to-rose-500/20 text-amber-400 border-amber-500/30',
    },
    {
      title: 'Live Throughput',
      value: fmtBps(Number(s.aggRxBps || 0) + Number(s.aggTxBps || 0)),
      change: `RX ${fmtBps(Number(s.aggRxBps || 0))}`,
      isPositive: true,
      subDetail: `TX ${fmtBps(Number(s.aggTxBps || 0))} • ${Number(s.online || data.online || 0)} sessions`,
      icon: Activity,
      color: 'from-indigo-500/20 to-purple-500/20 text-indigo-400 border-indigo-500/30',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {kpis.map((kpi, idx) => {
        const Icon = kpi.icon;
        return (
          <div key={idx} className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{kpi.title}</span>
              <div className={`p-2.5 rounded-xl border bg-gradient-to-br ${kpi.color} shadow-sm group-hover:scale-110 transition-transform`}><Icon className="w-4 h-4" /></div>
            </div>
            <div className="text-2xl font-black tracking-tight text-foreground mb-1.5">{kpi.value}</div>
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="text-[11px] text-muted-foreground font-medium truncate">{kpi.subDetail}</span>
              <span className={`flex items-center font-semibold text-[11px] px-1.5 py-0.5 rounded-md shrink-0 ${kpi.isPositive ? 'text-emerald-500 bg-emerald-500/10' : 'text-amber-500 bg-amber-500/10'}`}>
                {kpi.isPositive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                {kpi.change}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}