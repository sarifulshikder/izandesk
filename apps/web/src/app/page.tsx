'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { MetricsGrid } from '@/components/dashboard/metrics-grid';
import { LiveTrafficChart } from '@/components/dashboard/live-traffic-chart';
import { RouterTelemetryCard } from '@/components/dashboard/router-telemetry-card';
import { OltTelemetryCard } from '@/components/dashboard/olt-telemetry-card';
import { HotReloadPluginCard } from '@/components/dashboard/hot-reload-plugin-card';
import { RecentSubscribersTable } from '@/components/dashboard/recent-subscribers-table';
import { Zap, UserPlus, Users, Activity, CreditCard, FileText, Router, ShieldCheck, Plug, MapPin, Ticket } from 'lucide-react';

const quickActions = [
  { title: 'Add Subscriber', href: '/subscribers?new=1', icon: UserPlus, desc: 'Onboard new client' },
  { title: 'All Subscribers', href: '/subscribers', icon: Users, desc: 'Manage client list' },
  { title: 'Live Sessions', href: '/subscribers/live', icon: Activity, desc: 'Online PPPoE/RADIUS' },
  { title: 'Billing & Invoices', href: '/billing', icon: CreditCard, desc: 'Collections & dues' },
  { title: 'Routers & NAS', href: '/routers', icon: Router, desc: 'MikroTik/RADIUS' },
  { title: 'RADIUS & AAA', href: '/radius', icon: ShieldCheck, desc: 'Auth, acct, CoA' },
  { title: 'Plugins', href: '/plugins', icon: Plug, desc: 'Gateways & drivers' },
  { title: 'Fiber GIS Map', href: '/gis', icon: MapPin, desc: 'Topology & map' },
];

export default function DashboardPage() {
  const { user, activeRole } = useAuth();
  if (!user || !activeRole) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-card via-card to-primary/10 border border-border/80 shadow-sm overflow-hidden">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-lg sm:text-2xl font-black text-foreground tracking-tight">Operations Dashboard (NOC & BSS)</h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              Live
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-medium break-words">
            Welcome, <span className="text-foreground font-semibold">{user.name}</span> • <span className="text-primary font-semibold">{activeRole.replace(/_/g, ' ')}</span> • IzanDesk ISP ERP
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/subscribers/live" className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5"><Activity className="w-3.5 h-3.5"/>Live Sessions</Link>
          <Link href="/subscribers?new=1" className="px-3 py-2 rounded-xl border border-border bg-card text-xs font-semibold inline-flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5"/>Add Subscriber</Link>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-sm">Quick Actions</h2>
          <span className="text-xs text-muted-foreground">Common operations</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {quickActions.map((a) => (
            <Link key={a.href} href={a.href} className="p-3 rounded-xl border border-border/80 bg-muted/20 hover:bg-muted/40 hover:border-primary/30 transition-colors group">
              <a.icon className="w-4 h-4 text-primary mb-2 group-hover:scale-110 transition-transform" />
              <div className="text-xs font-semibold leading-tight">{a.title}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{a.desc}</div>
            </Link>
          ))}
        </div>
      </div>

      <MetricsGrid />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LiveTrafficChart />
        <HotReloadPluginCard />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RouterTelemetryCard />
        <OltTelemetryCard />
      </div>

      <RecentSubscribersTable />
    </div>
  );
}