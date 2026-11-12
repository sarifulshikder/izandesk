'use client';

import React from 'react';
import { useAuth } from '@/lib/auth-context';
import { MetricsGrid } from '@/components/dashboard/metrics-grid';
import { LiveTrafficChart } from '@/components/dashboard/live-traffic-chart';
import { RouterTelemetryCard } from '@/components/dashboard/router-telemetry-card';
import { OltTelemetryCard } from '@/components/dashboard/olt-telemetry-card';
import { HotReloadPluginCard } from '@/components/dashboard/hot-reload-plugin-card';
import { RecentSubscribersTable } from '@/components/dashboard/recent-subscribers-table';
import { Radio, ShieldCheck, Zap } from 'lucide-react';

export default function DashboardPage() {
  const { user, activeRole } = useAuth();

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Executive Welcome Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-2xl bg-gradient-to-r from-card via-card to-primary/5 border border-border/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
              Network Operations Center (NOC)
            </h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              Real-Time
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            Logged in as <span className="text-foreground font-semibold">{user.name}</span> • Role:{' '}
            <span className="text-primary font-semibold">{activeRole.replace('_', ' ')}</span>
          </p>
        </div>

        {/* Quick Phase 1 Verification Chip */}
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs font-semibold flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            <span>Phase 1 Verified: UI & Hot-Reload Kernel</span>
          </div>
        </div>
      </div>

      {/* KPI Metrics Grid */}
      <MetricsGrid />

      {/* Real-time Traffic Graph & Hot-Reload Plugins */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LiveTrafficChart />
        <HotReloadPluginCard />
      </div>

      {/* Network Hardware Cards: Routers & OLTs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RouterTelemetryCard />
        <OltTelemetryCard />
      </div>

      {/* Recent Subscribers & Active Sessions */}
      <RecentSubscribersTable />
    </div>
  );
}
