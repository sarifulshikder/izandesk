'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { MetricsGrid } from '@/components/dashboard/metrics-grid';
import { LiveTrafficChart } from '@/components/dashboard/live-traffic-chart';
import { RouterTelemetryCard } from '@/components/dashboard/router-telemetry-card';
import { OltTelemetryCard } from '@/components/dashboard/olt-telemetry-card';
import { HotReloadPluginCard } from '@/components/dashboard/hot-reload-plugin-card';
import { RecentSubscribersTable } from '@/components/dashboard/recent-subscribers-table';
import { UserPlus, Users, Activity, CreditCard, Router, ShieldCheck, Plug, MapPin, AlertTriangle, FileText, ArrowRight, Wifi } from 'lucide-react';

const quickActions = [
  { title: 'Add Subscriber', href: '/subscribers?new=1', icon: UserPlus, desc: 'Onboard & provision', color: 'text-cyan-400' },
  { title: 'All Subscribers', href: '/subscribers', icon: Users, desc: 'Client list & profiles', color: 'text-blue-400' },
  { title: 'Live Sessions', href: '/subscribers/live', icon: Activity, desc: 'Online PPPoE/RADIUS', color: 'text-emerald-400' },
  { title: 'Billing & Invoices', href: '/billing', icon: CreditCard, desc: 'Collections & dues', color: 'text-amber-400' },
  { title: 'Routers & NAS', href: '/routers', icon: Router, desc: 'MikroTik & RADIUS', color: 'text-indigo-400' },
  { title: 'RADIUS & AAA', href: '/radius', icon: ShieldCheck, desc: 'Auth, acct, CoA', color: 'text-violet-400' },
  { title: 'Plugins', href: '/plugins', icon: Plug, desc: 'Gateways & drivers', color: 'text-fuchsia-400' },
  { title: 'Fiber GIS Map', href: '/gis', icon: MapPin, desc: 'Topology & coverage', color: 'text-rose-400' },
];

export default function DashboardPage() {
  const { user, activeRole, token } = useAuth();
  const [snap, setSnap] = useState<any>({ billing: null, online: 0 });

  const loadSnap = useCallback(async () => {
    if (!token) return;
    try {
      const [b, s] = await Promise.all([
        apiFetch<any>('/api/billing/metrics', {}, token).catch(() => ({ metrics: null })),
        apiFetch<any>('/api/network/sessions', {}, token).catch(() => ({ summary: { online: 0 } })),
      ]);
      setSnap({ billing: b?.metrics || null, online: s?.summary?.online || 0 });
    } catch {}
  }, [token]);

  useEffect(() => { loadSnap(); const t = setInterval(loadSnap, 20000); return () => clearInterval(t); }, [loadSnap]);

  if (!user || !activeRole) return null;
  const b = snap.billing || {};

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
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
              Welcome, <span className="text-foreground font-semibold">{user.name}</span> • <span className="text-primary font-semibold">{activeRole.replace(/_/g, ' ')}</span> • IzanDesk NOC & BSS
            </p>
            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card/70"><Wifi className="w-3.5 h-3.5 text-emerald-400"/><b className="text-foreground">{Number(snap.online || 0)}</b> sessions online</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card/70"><AlertTriangle className="w-3.5 h-3.5 text-amber-400"/><b className="text-foreground">৳{Number(b.totalDueOutstanding || 0).toLocaleString()}</b> outstanding</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card/70"><FileText className="w-3.5 h-3.5 text-cyan-400"/><b className="text-foreground">{Number(b.suspendedDue || 0)}</b> suspended/isolated</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link href="/subscribers/live" className="px-3.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 shadow-sm shadow-primary/20"><Activity className="w-4 h-4"/>Live Sessions</Link>
            <Link href="/subscribers?new=1" className="px-3.5 py-2.5 rounded-xl border border-border bg-card text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted/50"><UserPlus className="w-4 h-4"/>Add Subscriber</Link>
            <Link href="/billing" className="px-3.5 py-2.5 rounded-xl border border-border bg-card text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted/50"><CreditCard className="w-4 h-4"/>Billing</Link>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight">Quick Actions</h2>
          <span className="text-xs text-muted-foreground">Common operations & shortcuts</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5">
          {quickActions.map((a) => (
            <Link key={a.href} href={a.href} className="group p-3.5 rounded-xl border border-border/80 bg-card hover:bg-muted/30 hover:border-primary/30 transition-all shadow-sm">
              <div className={`w-8 h-8 rounded-lg bg-muted/50 border border-border/60 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform ${a.color}`}>
                <a.icon className="w-4 h-4" />
              </div>
              <div className="text-xs font-semibold leading-tight text-foreground">{a.title}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{a.desc}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight">Key Metrics</h2>
          <span className="text-xs text-muted-foreground">Subscribers, collections, dues & throughput</span>
        </div>
        <MetricsGrid />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight">Network Operations</h2>
          <Link href="/routers" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">Open network views <ArrowRight className="w-3 h-3"/></Link>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <LiveTrafficChart />
          <div className="grid grid-cols-1 gap-5">
            <RouterTelemetryCard />
            <OltTelemetryCard />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight">Subscribers & System</h2>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/subscribers" className="text-primary hover:underline">Subscribers</Link>
            <Link href="/plugins" className="text-primary hover:underline">Plugins</Link>
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2">
            <RecentSubscribersTable />
          </div>
          <div>
            <HotReloadPluginCard />
          </div>
        </div>
      </section>
    </div>
  );
}
