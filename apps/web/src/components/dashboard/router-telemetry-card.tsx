'use client';

import React from 'react';
import { Network, Cpu, HardDrive, RefreshCw } from 'lucide-react';
import { RouterTelemetry } from '@izandesk/shared-types';

const mockRouters: RouterTelemetry[] = [
  {
    id: 'rtr-01',
    name: 'MikroTik CCR2004 — Core BDIX',
    ipAddress: '103.150.24.1',
    type: 'MIKROTIK_ROS7',
    isOnline: true,
    cpuLoad: 18,
    ramUsagePercent: 34,
    uptime: '48d 14h 22m',
    activePppoeCount: 2180,
    totalThroughputMbps: { download: 4820, upload: 1940 },
  },
  {
    id: 'rtr-02',
    name: 'MikroTik CHR — Cloud Gateway',
    ipAddress: '172.16.171.9',
    type: 'MIKROTIK_ROS7',
    isOnline: true,
    cpuLoad: 24,
    ramUsagePercent: 42,
    uptime: '112d 08h 10m',
    activePppoeCount: 1662,
    totalThroughputMbps: { download: 3600, upload: 1220 },
  },
];

export function RouterTelemetryCard() {
  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground tracking-tight">Core MikroTik Routers</h3>
            <p className="text-[11px] text-muted-foreground">RouterOS v7 REST & API Sync</p>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          All Synced (2/2)
        </span>
      </div>

      <div className="space-y-3">
        {mockRouters.map((router) => (
          <div
            key={router.id}
            className="p-3.5 rounded-xl bg-muted/40 border border-border/60 hover:border-primary/40 transition-all"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold text-foreground">{router.name}</span>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{router.ipAddress}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-primary" />
                <span>CPU: {router.cpuLoad}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-secondary" />
                <span>RAM: {router.ramUsagePercent}%</span>
              </div>
              <div className="text-right font-medium text-foreground">
                {router.activePppoeCount} PPPoE
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
