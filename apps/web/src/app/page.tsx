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
  LayoutDashboard, UserPlus, Activity, CreditCard, Wifi, AlertTriangle, BellRing,
  Radio, Network as NetworkIcon, Receipt, HardDrive, ExternalLink,
} from 'lucide-react';

function money(v: any) {
  return `৳${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function DashboardPage() {
  const { user, activeRole, token } = useAuth();
  const [d, setD] = useState<any>(null);

  const load = useCallback(async () => {
    if (!token) return;
    // Diagnostics is admin-only — skip it for reseller/technician roles instead of firing a 403.
    const canDiagnostics = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER'].includes(String(activeRole || user?.role));
    // Billing metrics are tenant-wide; skip for roles without billing access
    // instead of firing a 403 (resellers use their own scoped dashboard).
    const canBilling = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER'].includes(String(activeRole || user?.role));
    try {
      const [sum, subs, sessions, billing, routers, olts, onus, health, apiHealth, diag, general] = await Promise.all([
        apiFetch<any>('/api/subscribers/summary', {}, token).catch(() => null),
        apiFetch<any>('/api/subscribers?limit=6', {}, token).catch(() => null),
        apiFetch<any>('/api/network/sessions', {}, token).catch(() => null),
        canBilling ? apiFetch<any>('/api/billing/metrics', {}, token).catch(() => null) : Promise.resolve(null),
        apiFetch<any>('/api/network/routers', {}, token).catch(() => null),
        apiFetch<any>('/api/olt/olts', {}, token).catch(() => null),
        apiFetch<any>('/api/olt/onus', {}, token).catch(() => null),
        fetch(`${getApiBaseUrl()}/api/system/health`).then((r) => r.json()).catch(() => null),
        fetch(`${getApiBaseUrl()}/api/health`).then((r) => r.json()).catch(() => null),
        canDiagnostics ? apiFetch<any>('/api/system/diagnostics', {}, token).catch(() => null) : Promise.resolve(null),
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
  }, [token, activeRole, user?.role]);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const alerts = useMemo(() => {
    if (!d) return [];
    const a: any[] = [];
    const sum = d.summary || {};
    if (Number(sum.suspended || 0) > 0) a.push({ icon: AlertTriangle, label: 'Suspended subscribers', count: sum.suspended, href: '/subscribers?status=SUSPENDED' });
    if (Number(d.billing?.overdueInvoices || 0) > 0) a.push({ icon: Receipt, label: 'Overdue invoices', count: d.billing.overdueInvoices, href: '/billing' });
    if (Number(sum.overdue || 0) > 0) a.push({ icon: AlertTriangle, label: 'Subscribers with due', count: sum.overdue, href: '/subscribers' });
    const onuCritical = (d.onus || []).filter((u: any) => String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS');
    if (onuCritical.length > 0) a.push({ icon: Radio, label: 'Critical / LOS ONUs', count: onuCritical.length, href: '/olts' });
    const rOff = (d.routers || []).filter((r: any) => String(r.status).toUpperCase() !== 'ONLINE');
    if (rOff.length > 0) a.push({ icon: NetworkIcon, label: 'Routers offline', count: rOff.length, href: '/routers' });
    const oOff = (d.olts || []).filter((o: any) => String(o.status).toUpperCase() !== 'ONLINE');
    if (oOff.length > 0) a.push({ icon: Radio, label: 'OLTs offline', count: oOff.length, href: '/olts' });
    if (Number(sum.expiring_soon || 0) > 0) a.push({ icon: BellRing, label: 'Expiring in 7 days', count: sum.expiring_soon, href: '/subscribers' });
    const disk = d.health?.checks?.disk;
    if (disk && Number(disk.usedPercent || 0) > 90) a.push({ icon: HardDrive, label: `Disk ${disk.usedPercent}% full`, href: '/system/health' });
    return a;
  }, [d]);

  if (!user || !activeRole) return null;
  const b = d?.billing || {};
  const s = d?.sessions || { online: 0, aggRxBps: 0, aggTxBps: 0 };
  const bill = Number(b.monthlyBillGenerated || 0);
  const collected = Number(b.thisMonthCollections || 0);
  const pct = bill > 0 ? Math.min(100, Math.round((collected / bill) * 100)) : (collected > 0 ? 100 : 0);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Page header — CIS style */}
      <div className="page-header">
        <div>
          <h1 className="page-title"><LayoutDashboard className="page-title-icon w-5 h-5" /> Dashboard</h1>
          <p className="page-subtitle">
            Welcome back, <span className="font-semibold text-foreground">{user.name}</span> · {activeRole.replace(/_/g, ' ')} · {d?.company || 'IzanDesk'}
          </p>
        </div>
        <div className="page-actions">
          <Link href="/subscribers?new=1" className="btn btn-primary"><UserPlus className="w-4 h-4" /> Add Client</Link>
          <Link href="/subscribers/live" className="btn btn-outline"><Activity className="w-4 h-4" /> Live Sessions</Link>
          <Link href="/billing" className="btn btn-outline"><CreditCard className="w-4 h-4" /> Billing</Link>
        </div>
      </div>

      {d && <AttentionBar alerts={alerts} />}

      {/* KPI stat tiles */}
      {d && <MetricsGrid summary={d.summary} billing={b} sessions={s} routers={d.routers} olts={d.olts} />}

      {/* Billing progress / Invoice status / Network health */}
      {d && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card">
            <div className="card-header">
              <span className="card-title">Billing Progress</span>
              <Link href="/billing" className="text-xs text-primary font-semibold inline-flex items-center gap-1">View billing <ExternalLink className="w-3 h-3" /></Link>
            </div>
            <div className="card-body space-y-3">
              <div className="flex items-end justify-between">
                <div className="text-2xl font-bold">{pct}%</div>
                <span className="text-xs text-muted-foreground">Collected against net bill</span>
              </div>
              <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div><div className="text-[10px] uppercase text-muted-foreground">Bill</div><div className="text-sm font-semibold">{money(bill)}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">Collected</div><div className="text-sm font-semibold text-success">{money(collected)}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">Remaining</div><div className="text-sm font-semibold text-danger">{money(Math.max(bill - collected, 0))}</div></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Invoice Status</span>
              <Link href="/billing/invoices" className="text-xs text-primary font-semibold inline-flex items-center gap-1">View invoices <ExternalLink className="w-3 h-3" /></Link>
            </div>
            <div className="card-body space-y-2.5">
              <div className="flex items-center justify-between py-1.5 border-b border-border">
                <span className="flex items-center gap-2 text-sm"><span className="status-dot warning" /> Unpaid</span>
                <span className="badge badge-warning">{Number(b.unpaidInvoices || 0)}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border">
                <span className="flex items-center gap-2 text-sm"><span className="status-dot danger" /> Overdue</span>
                <span className="badge badge-danger">{Number(b.overdueInvoices || 0)}</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="flex items-center gap-2 text-sm"><span className="status-dot online" /> Outstanding</span>
                <span className="text-sm font-semibold">{money(b.totalDueOutstanding)}</span>
              </div>
            </div>
          </div>

          <NetworkHealthCard routers={d.routers} olts={d.olts} onus={d.onus} />
        </div>
      )}

      {/* Live throughput + system status */}
      {d && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2"><LiveTrafficChart rx={Number(s.aggRxBps || 0)} tx={Number(s.aggTxBps || 0)} online={Number(s.online || 0)} /></div>
          <SystemStatusCard health={d.health} apiHealth={d.apiHealth} diag={d.diag} />
        </div>
      )}

      {/* Recent subscribers */}
      {d && <RecentSubscribersTable subscribers={d.recent} />}
    </div>
  );
}
