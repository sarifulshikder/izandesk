'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { MetricsGrid } from '@/components/dashboard/metrics-grid';
import { NetworkHealthCard } from '@/components/dashboard/network-health-card';
import { SystemStatusCard } from '@/components/dashboard/system-status-card';
import { AttentionBar } from '@/components/dashboard/attention-bar';
import {
  UserPlus, Activity, CreditCard, AlertTriangle, BellRing, Radio,
  Network as NetworkIcon, Receipt, HardDrive, ArrowUpRight, ArrowDownRight,
  Wallet, CircleDollarSign,
} from 'lucide-react';

function money(v: any) {
  return `৳${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function DashboardPage() {
  const { user, activeRole, token } = useAuth();
  const [d, setD] = useState<any>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const canDiagnostics = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER'].includes(String(activeRole || user?.role));
    const canBilling = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER'].includes(String(activeRole || user?.role));
    const canNetwork = canBilling;
    try {
      const [sum, subs, sessions, billing, routers, olts, onus, health, apiHealth, diag, general] = await Promise.all([
        apiFetch<any>('/api/subscribers/summary', {}, token).catch(() => null),
        apiFetch<any>('/api/subscribers?limit=6', {}, token).catch(() => null),
        canNetwork ? apiFetch<any>('/api/network/sessions?nopoll=1', {}, token).catch(() => null) : Promise.resolve(null),
        canBilling ? apiFetch<any>('/api/billing/metrics', {}, token).catch(() => null) : Promise.resolve(null),
        canNetwork ? apiFetch<any>('/api/network/routers?nopoll=1', {}, token).catch(() => null) : Promise.resolve(null),
        canNetwork ? apiFetch<any>('/api/olt/olts', {}, token).catch(() => null) : Promise.resolve(null),
        canNetwork ? apiFetch<any>('/api/olt/onus', {}, token).catch(() => null) : Promise.resolve(null),
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
  const sum = d?.summary || {};
  const bill = Number(b.monthlyBillGenerated || 0);
  const collected = Number(b.thisMonthCollections || 0);
  const pct = bill > 0 ? Math.min(100, Math.round((collected / bill) * 100)) : (collected > 0 ? 100 : 0);
  const routers = d?.routers || [];
  const olts = d?.olts || [];
  const routersOnline = routers.filter((r: any) => String(r.status).toUpperCase() === 'ONLINE').length;
  const oltsOnline = olts.filter((o: any) => String(o.status).toUpperCase() === 'ONLINE').length;
  const firstName = String(user.name || '').split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const healthPct = Number(bill) > 0 ? pct : 0;

  return (
    <div className="space-y-5">
      {/* ── Command hero ─────────────────────────────────────────────────── */}
      <section className="command-hero">
        <div className="p-5 sm:p-7">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
            <div className="min-w-0 xl:max-w-[58%]">
              <span className="hero-eyebrow">
                <span className="status-dot online" />
                {dateLabel}
                <span className="text-white/15">/</span>
                <span className="text-[#7f9c90]">{d?.company || 'IzanDesk'}</span>
              </span>
              <h1 className="hero-title">{greeting}, <em>{firstName}</em>.</h1>
              <p className="hero-copy">
                Your network, revenue and field operations in one calm view — measured live from
                {' '}{routersOnline}/{routers.length || 0} routers and {oltsOnline}/{olts.length || 0} optical line terminals.
              </p>
              <div className="hero-actions mt-5">
                <Link href="/subscribers?new=1" className="hero-mini-btn solid"><UserPlus className="w-3.5 h-3.5" /> Add Client</Link>
                <Link href="/subscribers/live" className="hero-mini-btn"><Activity className="w-3.5 h-3.5" /> Live Sessions</Link>
                <Link href="/billing" className="hero-mini-btn"><CreditCard className="w-3.5 h-3.5" /> Billing Center</Link>
              </div>
            </div>

            <div className="xl:w-[400px] shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#7f9c90]">Today at a glance</span>
                <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#8ff3c9]">
                  <span className="status-dot online" /> Live
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-3">
                  <div className="flex items-center justify-between">
                    <span className="hero-stat-label"><Wallet className="w-3 h-3" /> Collected</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-[#8ff3c9]" />
                  </div>
                  <div className="hero-stat-value">{money(collected)}</div>
                  <div className="hero-stat-hint">This month · {pct}% of billed</div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-3">
                  <div className="flex items-center justify-between">
                    <span className="hero-stat-label"><CircleDollarSign className="w-3 h-3" /> Outstanding</span>
                    <ArrowDownRight className="w-3.5 h-3.5 text-[#e8b64c]" />
                  </div>
                  <div className="hero-stat-value">{money(b.totalDueOutstanding)}</div>
                  <div className="hero-stat-hint">{Number(b.overdueInvoices || 0)} overdue invoices</div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-3">
                  <div className="flex items-center justify-between">
                    <span className="hero-stat-label"><Activity className="w-3 h-3" /> Online now</span>
                    <span className="text-[9px] font-mono text-[#8ff3c9]">{Number(sum.total || 0)} total</span>
                  </div>
                  <div className="hero-stat-value">{Number(s.online || 0)}</div>
                  <div className="hero-stat-hint">PPPoE & RADIUS sessions</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {d && <AttentionBar alerts={alerts} />}

      {/* ── KPI board ────────────────────────────────────────────────────── */}
      {d && <MetricsGrid summary={sum} billing={b} sessions={s} routers={routers} olts={olts} />}

      {/* ── Revenue · invoices · network ─────────────────────────────────── */}
      {d && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card">
            <div className="card-header">
              <div>
                <span className="card-title">Billing Progress</span>
                <div className="card-subtitle">Collection against net bill this month</div>
              </div>
              <Link href="/billing" className="text-[10.5px] text-primary font-semibold inline-flex items-center gap-1 hover:underline underline-offset-2">Open <ArrowUpRight className="w-3 h-3" /></Link>
            </div>
            <div className="card-body">
              <div className="flex items-center gap-5">
                <div className="ring-stat" style={{ ['--pct' as any]: Math.max(healthPct, 1) }}>
                  <div className="ring-stat-center">
                    <div className="ring-stat-value">{pct}%</div>
                    <div className="ring-stat-label">Collected</div>
                  </div>
                </div>
                <div className="min-w-0 flex-1 kpi-list">
                  <div className="kpi-row">
                    <span className="kpi-row-label"><span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" /> Bill</span>
                    <span className="kpi-row-value">{money(bill)}</span>
                  </div>
                  <div className="kpi-row">
                    <span className="kpi-row-label"><span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" /> Collected</span>
                    <span className="kpi-row-value text-success">{money(collected)}</span>
                  </div>
                  <div className="kpi-row">
                    <span className="kpi-row-label"><span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" /> Remaining</span>
                    <span className="kpi-row-value text-warning">{money(Math.max(bill - collected, 0))}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                <Receipt className="w-3.5 h-3.5" />
                <span>{Number(b.unpaidInvoices || 0)} unpaid invoices · {Number(b.overdueInvoices || 0)} overdue</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <span className="card-title">Invoice Status</span>
                <div className="card-subtitle">Receivables and settlement health</div>
              </div>
              <Link href="/billing/invoices" className="text-[10.5px] text-primary font-semibold inline-flex items-center gap-1 hover:underline underline-offset-2">Invoices <ArrowUpRight className="w-3 h-3" /></Link>
            </div>
            <div className="card-body">
              <div className="space-y-0.5">
                <div className="kpi-row">
                  <span className="kpi-row-label"><span className="status-dot warning" /> Unpaid</span>
                  <span className="badge badge-warning">{Number(b.unpaidInvoices || 0)} invoices</span>
                </div>
                <div className="kpi-row">
                  <span className="kpi-row-label"><span className="status-dot danger" /> Overdue</span>
                  <span className="badge badge-danger">{Number(b.overdueInvoices || 0)} invoices</span>
                </div>
                <div className="kpi-row">
                  <span className="kpi-row-label"><span className="status-dot online" /> Outstanding value</span>
                  <span className="kpi-row-value">{money(b.totalDueOutstanding)}</span>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                  <span>Settlement rate</span><span className="font-mono">{pct}%</span>
                </div>
                <div className="progress"><div className="progress-bar" style={{ width: `${Math.max(pct, 1)}%` }} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <Link href="/collections" className="btn btn-outline btn-sm justify-center">Collections</Link>
                <Link href="/billing/payments" className="btn btn-outline btn-sm justify-center">Payments</Link>
              </div>
            </div>
          </div>

          <NetworkHealthCard routers={routers} olts={olts} onus={d.onus} />
        </div>
      )}

      {/* ── System ──────────────────────────────────────────────────────── */}
      {d && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-3"><SystemStatusCard health={d.health} apiHealth={d.apiHealth} diag={d.diag} /></div>
        </div>
      )}

    </div>
  );
}
