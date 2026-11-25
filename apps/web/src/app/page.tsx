'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getApiBaseUrl } from '@/lib/api';
import { MetricsGrid } from '@/components/dashboard/metrics-grid';
import { NetworkHealthCard } from '@/components/dashboard/network-health-card';
import { SystemStatusCard } from '@/components/dashboard/system-status-card';
import { AttentionBar } from '@/components/dashboard/attention-bar';
import { AreaHealthCard } from '@/components/dashboard/area-health-card';
import { RenewalQueueCard } from '@/components/dashboard/renewal-queue-card';
import { RecentCollectionsCard } from '@/components/dashboard/recent-collections-card';
import {
  UserPlus, Activity, CreditCard, AlertTriangle, BellRing, Radio,
  Network as NetworkIcon, ArrowUpRight, Receipt, HardDrive,
} from 'lucide-react';

function money(v: any) {
  return `৳${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function DashboardPage() {
  const { user, activeRole, token } = useAuth();
  const [d, setD] = useState<any>(null);
  const canBilling = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER'].includes(String(activeRole || user?.role));
  const canDiagnostics = canBilling;
  const canNetwork = canBilling;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [sum, sessions, billing, billingTrend, areaHealth, renewals, collections, routers, olts, onus, health, apiHealth, diag, general] = await Promise.all([
        apiFetch<any>('/api/subscribers/summary', {}, token).catch(() => null),
        canNetwork ? apiFetch<any>('/api/network/sessions?nopoll=1', {}, token).catch(() => null) : Promise.resolve(null),
        canBilling ? apiFetch<any>('/api/billing/metrics', {}, token).catch(() => null) : Promise.resolve(null),
        canBilling ? apiFetch<any>('/api/billing/trend', {}, token).catch(() => null) : Promise.resolve(null),
        apiFetch<any>('/api/subscribers/area-health', {}, token).catch(() => null),
        apiFetch<any>('/api/subscribers/renewals?days=7&limit=6', {}, token).catch(() => null),
        canBilling ? apiFetch<any>('/api/billing/payments/recent?limit=6', {}, token).catch(() => null) : Promise.resolve(null),
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
        sessions: sessions?.summary || { online: 0, aggRxBps: 0, aggTxBps: 0 },
        billing: billing?.metrics || {},
        billingTrend: billingTrend?.trend || [],
        areaHealth: areaHealth?.data || [],
        areaTotal: Number(areaHealth?.total || 0),
        renewals: renewals?.data || [],
        renewalTotal: Number(renewals?.total || 0),
        renewalDays: Number(renewals?.days || 7),
        collections: collections?.data || [],
        routers: routers?.data || [],
        olts: olts?.data || [],
        onus: onus?.data || [],
        health, apiHealth, diag,
        company: general?.data?.company_name || 'IzanDesk',
        timezone: general?.data?.timezone || 'Asia/Dhaka',
      });
    } catch {}
  }, [token, canBilling, canDiagnostics, canNetwork]);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const alerts = useMemo(() => {
    if (!d) return [];
    const a: any[] = [];
    const sum = d.summary || {};
    if (Number(sum.suspended || 0) > 0) a.push({ icon: AlertTriangle, label: 'Suspended subscribers', count: sum.suspended, href: '/subscribers?status=SUSPENDED' });
    if (Number(sum.expired || 0) > 0) a.push({ icon: AlertTriangle, label: 'Expired subscribers', count: sum.expired, href: '/subscribers?status=EXPIRED' });
    if (Number(d.billing?.overdueInvoices || 0) > 0) a.push({ icon: Receipt, label: 'Overdue invoices', count: d.billing.overdueInvoices, href: '/billing' });
    if (Number(sum.overdue || 0) > 0) a.push({ icon: AlertTriangle, label: 'Subscribers with due', count: sum.overdue, href: '/subscribers?due=1' });
    const onuCritical = (d.onus || []).filter((u: any) => String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS');
    if (onuCritical.length > 0) a.push({ icon: Radio, label: 'Critical / LOS ONUs', count: onuCritical.length, href: '/olts?onu_status=CRITICAL_LOS' });
    const rOff = (d.routers || []).filter((r: any) => String(r.status).toUpperCase() !== 'ONLINE');
    if (rOff.length > 0) a.push({ icon: NetworkIcon, label: 'Routers offline', count: rOff.length, href: '/routers' });
    const oOff = (d.olts || []).filter((o: any) => String(o.status).toUpperCase() !== 'ONLINE');
    if (oOff.length > 0) a.push({ icon: Radio, label: 'OLTs offline', count: oOff.length, href: '/olts?olt_status=OFFLINE' });
    if (Number(sum.expiring_tomorrow || 0) > 0) a.push({ icon: BellRing, label: 'Expiring tomorrow', count: sum.expiring_tomorrow, href: '/subscribers?expiring=tomorrow' });
    if (Number(sum.expiring_soon || 0) > 0) a.push({ icon: BellRing, label: 'Expiring in 7 days', count: sum.expiring_soon, href: '/subscribers?expiring=7' });
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
  const onuCriticalCount = (d?.onus || []).filter((u: any) => String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS').length;
  const firstName = String(user.name || '').split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const onlinePct = Number(sum.total || 0) > 0 ? Math.round((Number(s.online || 0) / Number(sum.total || 0)) * 100) : 0;
  const billingTrend = Array.isArray(d?.billingTrend) ? d.billingTrend : [];
  const trendMax = Math.max(1, ...billingTrend.map((t: any) => Math.max(Number(t.generated || 0), Number(t.collected || 0))));

  return (
    <div className="space-y-4">
      {/* ── Compact command header ─────────────────────────────────────── */}
      <section className="command-hero">
        <div className="px-5 py-5 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <span className="hero-eyebrow">
                <span className="status-dot online" />
                {dateLabel}
                <span className="text-white/15">/</span>
                <span className="text-[#7f9c90]">{d?.company || 'IzanDesk'}</span>
              </span>
              <h1 className="hero-title !text-[1.7rem] sm:!text-[2rem] !mb-1">{greeting}, <em>{firstName}</em>.</h1>
              <p className="hero-copy !max-w-none">One place for subscribers, revenue, network, and system health.</p>
              <div className="hero-actions mt-4">
                <Link href="/subscribers?new=1" className="hero-mini-btn solid"><UserPlus className="w-3.5 h-3.5" /> Add Client</Link>
                <Link href="/subscribers/live" className="hero-mini-btn"><Activity className="w-3.5 h-3.5" /> Live Sessions</Link>
                <Link href="/billing" className="hero-mini-btn"><CreditCard className="w-3.5 h-3.5" /> Billing</Link>
                <Link href="/olts" className="hero-mini-btn"><Radio className="w-3.5 h-3.5" /> OLT / ONU</Link>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 xl:w-[520px] shrink-0">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                <div className="hero-stat-label"><Activity className="w-3 h-3" /> Online</div>
                <div className="hero-stat-value !text-lg">{Number(s.online || 0)}</div>
                <div className="hero-stat-hint">{onlinePct}% of {Number(sum.total || 0)} clients</div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                <div className="hero-stat-label"><AlertTriangle className="w-3 h-3" /> With Due</div>
                <div className="hero-stat-value !text-lg">{Number(sum.overdue || 0)}</div>
                <div className="hero-stat-hint">Subscribers owing balance</div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                <div className="hero-stat-label"><BellRing className="w-3 h-3" /> Expiring 7d</div>
                <div className="hero-stat-value !text-lg">{Number(sum.expiring_soon || 0)}</div>
                <div className="hero-stat-hint">Renewal window</div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                <div className="hero-stat-label"><Radio className="w-3 h-3" /> Critical ONUs</div>
                <div className="hero-stat-value !text-lg">{onuCriticalCount}</div>
                <div className="hero-stat-hint">{routersOnline + oltsOnline}/{routers.length + olts.length} devices online</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {d && <AttentionBar alerts={alerts} />}

      {/* ── KPI board ─────────────────────────────────────────────────── */}
      {d && <MetricsGrid summary={sum} billing={b} sessions={s} routers={routers} olts={olts} />}

      {/* ── Operations grid ───────────────────────────────────────────── */}
      {d && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="card xl:col-span-1">
            <div className="card-header">
              <div>
                <span className="card-title">Revenue Snapshot</span>
                <div className="card-subtitle">Billing, collection, and receivables</div>
              </div>
              <Link href="/billing" className="text-[10.5px] text-primary font-semibold inline-flex items-center gap-1 hover:underline underline-offset-2">Open <ArrowUpRight className="w-3 h-3" /></Link>
            </div>
            <div className="card-body space-y-4">
              <div className="flex items-center gap-4">
                <div className="ring-stat" style={{ ['--pct' as any]: Math.max(pct, 1) }}>
                  <div className="ring-stat-center">
                    <div className="ring-stat-value">{pct}%</div>
                    <div className="ring-stat-label">Collected</div>
                  </div>
                </div>
                <div className="min-w-0 flex-1 kpi-list">
                  <div className="kpi-row">
                    <span className="kpi-row-label"><span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" /> Billed</span>
                    <span className="kpi-row-value">{money(bill)}</span>
                  </div>
                  <div className="kpi-row">
                    <span className="kpi-row-label"><span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" /> Collected</span>
                    <span className="kpi-row-value text-success">{money(collected)}</span>
                  </div>
                  <div className="kpi-row">
                    <span className="kpi-row-label"><span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" /> Outstanding</span>
                    <span className="kpi-row-value text-warning">{money(b.totalDueOutstanding)}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                  <span>Settlement rate</span><span className="font-mono">{pct}%</span>
                </div>
                <div className="progress"><div className="progress-bar" style={{ width: `${Math.max(pct, 1)}%` }} /></div>
              </div>

              {billingTrend.length > 0 && (
                <div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                    <span>Revenue trend · 6 months</span>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" /> Billed</span>
                      <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" /> Collected</span>
                    </span>
                  </div>
                  <div className="flex items-end gap-1.5 h-[64px] border-b border-border/70" role="img" aria-label="Six-month billed and collected revenue chart">
                    {billingTrend.map((t: any) => {
                      const generated = Number(t.generated || 0);
                      const collected = Number(t.collected || 0);
                      const gh = generated > 0 ? Math.max(2, Math.round((generated / trendMax) * 100)) : 0;
                      const ch = collected > 0 ? Math.max(2, Math.round((collected / trendMax) * 100)) : 0;
                      return (
                        <div key={t.month} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${t.label}: billed ${money(generated)} · collected ${money(collected)}`}>
                          <div className="w-full flex items-end justify-center gap-[3px] h-[52px]">
                            <div className="w-[45%] rounded-t-[3px] bg-[var(--primary)]/70" style={{ height: `${gh}%` }} />
                            <div className="w-[45%] rounded-t-[3px] bg-[var(--success)]/80" style={{ height: `${ch}%` }} />
                          </div>
                          <span className="text-[8.5px] text-muted-foreground font-medium">{t.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <div className="text-muted-foreground">Unpaid invoices</div>
                  <div className="font-semibold text-foreground mt-0.5">{Number(b.unpaidInvoices || 0)}</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <div className="text-muted-foreground">Overdue invoices</div>
                  <div className="font-semibold text-danger mt-0.5">{Number(b.overdueInvoices || 0)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Link href="/collections" className="btn btn-outline btn-sm justify-center">Collections</Link>
                <Link href="/billing/invoices" className="btn btn-outline btn-sm justify-center">Invoices</Link>
              </div>
            </div>
          </div>

          <NetworkHealthCard routers={routers} olts={olts} onus={d.onus} />
          <SystemStatusCard health={d.health} apiHealth={d.apiHealth} diag={d.diag} />
        </div>
      )}

      {/* ── Actionable workload ────────────────────────────────────────── */}
      {d && (
        <div className={`grid grid-cols-1 ${canBilling ? 'xl:grid-cols-3' : 'xl:grid-cols-2'} gap-4`}>
          <AreaHealthCard areas={d.areaHealth || []} total={d.areaTotal} />
          <RenewalQueueCard renewals={d.renewals || []} total={d.renewalTotal} days={d.renewalDays} timezone={d.timezone} />
          {canBilling && <RecentCollectionsCard payments={d.collections || []} timezone={d.timezone} />}
        </div>
      )}

    </div>
  );
}
