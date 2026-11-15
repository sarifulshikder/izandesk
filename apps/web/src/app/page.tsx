'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { MetricsGrid } from '@/components/dashboard/metrics-grid';
import { LiveTrafficChart } from '@/components/dashboard/live-traffic-chart';
import { NetworkHealthCard } from '@/components/dashboard/network-health-card';
import { SystemStatusCard } from '@/components/dashboard/system-status-card';
import { AttentionBar } from '@/components/dashboard/attention-bar';
import { RecentSubscribersTable } from '@/components/dashboard/recent-subscribers-table';
import {
  UserPlus, Activity, CreditCard, Wifi, AlertTriangle, BellRing,
  Radio, Network as NetworkIcon, Receipt, HardDrive,
} from 'lucide-react';

function money(v: any) {
  return `৳${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function DashboardPage() {
  const { user, activeRole, token } = useAuth();
  const [d, setD] = useState<any>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [sum, subs, sessions, billing, routers, olts, onus, health, apiHealth, diag, general] = await Promise.all([
        apiFetch<any>('/api/subscribers/summary', {}, token).catch(() => null),
        apiFetch<any>('/api/subscribers?limit=6', {}, token).catch(() => null),
        apiFetch<any>('/api/network/sessions', {}, token).catch(() => null),
        apiFetch<any>('/api/billing/metrics', {}, token).catch(() => null),
        apiFetch<any>('/api/network/routers', {}, token).catch(() => null),
        apiFetch<any>('/api/olt/olts', {}, token).catch(() => null),
        apiFetch<any>('/api/olt/onus', {}, token).catch(() => null),
        fetch(`${getApiBaseUrl()}/api/system/health`).then((r) => r.json()).catch(() => null),
        fetch(`${getApiBaseUrl()}/api/health`).then((r) => r.json()).catch(() => null),
        apiFetch<any>('/api/system/diagnostics', {}, token).catch(() => null),
        apiFetch<any>('/api/settings/general', {}, token).catch(() => null),
      ]);
      setD({
        summary: sum?.summary || {},
        recent: subs?.data || [],
        total: subs?.total ?? sum?.summary?.total ?? 0,
        sessions: sessions?.summary || { online: 0, aggRxBps: 0, aggTxBps: 0 },
        billing: billing?.metrics || {},
        routers: routers?.data || [],
        olts: olts?.data || [],
        onus: onus?.data || [],
        health, apiHealth, diag,
        company: general?.data?.company_name || 'IzanDesk',
      });
    } catch {}
  }, [token]);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const alerts = useMemo(() => {
    if (!d) return [];
    const a: any[] = [];
    const sum = d.summary || {};
    if (Number(sum.suspended || 0) > 0) a.push({ icon: AlertTriangle, label: 'Suspended subscribers', count: sum.suspended, href: '/subscribers?status=SUSPENDED', cls: 'text-red-400 border-red-500/30 bg-red-500/10' });
    if (Number(d.billing?.overdueInvoices || 0) > 0) a.push({ icon: Receipt, label: 'Overdue invoices', count: d.billing.overdueInvoices, href: '/billing', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' });
    if (Number(sum.overdue || 0) > 0) a.push({ icon: AlertTriangle, label: 'Subscribers with due', count: sum.overdue, href: '/subscribers', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' });
    const onuCritical = d.onus.filter((u: any) => String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS');
    if (onuCritical.length > 0) a.push({ icon: Radio, label: 'Critical / LOS ONUs', count: onuCritical.length, href: '/olts', cls: 'text-red-400 border-red-500/30 bg-red-500/10' });
    const rOff = d.routers.filter((r: any) => String(r.status).toUpperCase() !== 'ONLINE');
    if (rOff.length > 0) a.push({ icon: NetworkIcon, label: 'Routers offline', count: rOff.length, href: '/routers', cls: 'text-red-400 border-red-500/30 bg-red-500/10' });
    const oOff = d.olts.filter((o: any) => String(o.status).toUpperCase() !== 'ONLINE');
    if (oOff.length > 0) a.push({ icon: Radio, label: 'OLTs offline', count: oOff.length, href: '/olts', cls: 'text-red-400 border-red-500/30 bg-red-500/10' });
    if (Number(sum.expiring_soon || 0) > 0) a.push({ icon: BellRing, label: 'Expiring in 7 days', count: sum.expiring_soon, href: '/subscribers', cls: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' });
    const disk = d.health?.checks?.disk;
    if (disk && Number(disk.usedPercent || 0) > 90) a.push({ icon: HardDrive, label: `Disk ${disk.usedPercent}% full`, href: '/system/health', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' });
    return a;
  }, [d]);

  if (!user || !activeRole) return null;
  const b = d?.billing || {};
  const s = d?.sessions || { online: 0, aggRxBps: 0, aggTxBps: 0 };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card to-primary/10 p-5 sm:p-6 shadow-sm">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">Operations Dashboard</h1>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Welcome, <span className="text-foreground font-semibold">{user.name}</span> • <span className="text-primary font-semibold">{activeRole.replace(/_/g, ' ')}</span> • {d?.company || 'IzanDesk'}
            </p>
            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card/70"><Wifi className="w-3.5 h-3.5 text-emerald-400"/><b className="text-foreground">{Number(s.online || 0)}</b> online</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card/70"><AlertTriangle className="w-3.5 h-3.5 text-amber-400"/><b className="text-foreground">{money(b.totalDueOutstanding)}</b> outstanding</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card/70"><BellRing className={`w-3.5 h-3.5 ${alerts.length ? 'text-red-400' : 'text-emerald-400'}`}/><b className="text-foreground">{alerts.length}</b> alerts</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link href="/subscribers?new=1" className="px-3.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 shadow-sm shadow-primary/20"><UserPlus className="w-4 h-4"/>Add Subscriber</Link>
            <Link href="/subscribers/live" className="px-3.5 py-2.5 rounded-xl border border-border bg-card text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted/50"><Activity className="w-4 h-4"/>Live Sessions</Link>
            <Link href="/billing" className="px-3.5 py-2.5 rounded-xl border border-border bg-card text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted/50"><CreditCard className="w-4 h-4"/>Billing</Link>
          </div>
        </div>
      </div>

      {/* Needs attention */}
      {d && <AttentionBar alerts={alerts} />}

      {/* Key metrics */}
      {d && (
        <MetricsGrid
          total={Number(d.total || 0)}
          online={Number(s.online || 0)}
          billing={b}
          rx={Number(s.aggRxBps || 0)}
          tx={Number(s.aggTxBps || 0)}
        />
      )}

      {/* Network: live throughput + health */}
      {d && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2">
            <LiveTrafficChart rx={Number(s.aggRxBps || 0)} tx={Number(s.aggTxBps || 0)} online={Number(s.online || 0)} />
          </div>
          <NetworkHealthCard routers={d.routers} olts={d.olts} onus={d.onus} />
        </div>
      )}

      {/* Subscribers + system */}
      {d && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2">
            <RecentSubscribersTable subscribers={d.recent} />
          </div>
          <SystemStatusCard health={d.health} apiHealth={d.apiHealth} diag={d.diag} />
        </div>
      )}
    </div>
  );
}
