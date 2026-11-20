'use client';

import React from 'react';
import Link from 'next/link';
import { Server, Database, Zap, HardDrive, MemoryStick, Clock3, Puzzle, Table2, ArrowUpRight } from 'lucide-react';

function Dot({ ok }: { ok: boolean | null | undefined }) {
  if (ok === true) return <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_14%,transparent)] shrink-0" />;
  if (ok === false) return <span className="w-1.5 h-1.5 rounded-full bg-danger shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_14%,transparent)] shrink-0" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />;
}

function humanUptime(sec: number) {
  if (!sec && sec !== 0) return '-';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function SystemStatusCard({ health, apiHealth, diag }: { health: any; apiHealth: any; diag: any }) {
  const c = health?.checks || {};
  const mem = c.memory || {};
  const disk = c.disk || {};
  const diskPct = Number(disk.usedPercent || 0);
  const heapPct = mem.heapTotal ? Math.round((Number(mem.heapUsed || 0) / Number(mem.heapTotal || 1)) * 100) : null;

  const rows: { icon: any; label: string; ok: boolean | null | undefined; value: string }[] = [
    { icon: Server, label: 'API server', ok: apiHealth?.ok ?? c.api?.ok, value: `node ${apiHealth ? '' : ''}${diag?.env?.node || ''}`.trim() || (diag?.env ? `node ${diag.env.node}` : 'running') },
    { icon: Database, label: 'PostgreSQL', ok: c.db?.ok, value: apiHealth?.dbReady ? 'connected' : '—' },
    { icon: Zap, label: 'Redis cache', ok: c.redis?.ok, value: c.redis?.version ? `v${c.redis.version}` : (c.redis?.ok ? 'connected' : 'down') },
    { icon: HardDrive, label: 'Disk', ok: diskPct < 95 ? (c.disk?.ok ?? null) : false, value: `${diskPct}%` },
    { icon: MemoryStick, label: 'Heap', ok: heapPct == null ? null : heapPct < 90, value: heapPct != null ? `${heapPct}%` : '-' },
    { icon: Clock3, label: 'Uptime', ok: true, value: humanUptime(Number(diag?.uptime_sec || 0)) },
    { icon: Puzzle, label: 'Plugins', ok: true, value: `${Number(apiHealth?.pluginCount || 0)}` },
    { icon: Table2, label: 'DB tables', ok: true, value: `${(diag?.tables || []).length}` },
  ];

  const healthy = rows.filter((r) => r.ok !== false).length;

  return (
    <div className="card h-full">
      <div className="card-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="icon-tile shrink-0"><Server /></span>
          <div className="min-w-0">
            <div className="card-title">System Status</div>
            <div className="card-subtitle">Platform health · 10s refresh</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`badge ${healthy === rows.length ? 'badge-success' : 'badge-warning'}`}>{healthy}/{rows.length} healthy</span>
          <Link href="/system/health" className="topbar-icon-btn !w-8 !h-8" title="System Health & Diagnostics"><ArrowUpRight className="w-3.5 h-3.5" /></Link>
        </div>
      </div>

      <div className="card-body py-4">
        <div className="grid grid-cols-2 gap-x-5 gap-y-0">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-1.5 min-w-0 py-1.5 border-b border-border/50 last:border-0">
              <Dot ok={r.ok} />
              <r.icon className="w-3 h-3 text-muted-foreground shrink-0 hidden sm:block" />
              <span className="text-[10px] text-muted-foreground truncate">{r.label}</span>
              <span className="text-[10px] font-mono font-semibold text-foreground ml-auto tabular-nums">{r.value}</span>
            </div>
          ))}
        </div>

        {diskPct > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-[9.5px] text-muted-foreground mb-1.5">
              <span className="inline-flex items-center gap-1"><HardDrive className="w-3 h-3" /> Disk usage</span>
              <span className="font-mono tabular-nums">{diskPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${diskPct > 95 ? 'bg-danger' : diskPct > 85 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, diskPct)}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
