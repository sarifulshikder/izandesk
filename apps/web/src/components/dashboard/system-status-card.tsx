'use client';

import React from 'react';
import Link from 'next/link';
import { Server, Database, Zap, HardDrive, MemoryStick, Clock3, Puzzle, Table2, ExternalLink } from 'lucide-react';

function Dot({ ok }: { ok: boolean | null | undefined }) {
  if (ok === true) return <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />;
  if (ok === false) return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />;
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
    { icon: Server, label: 'API', ok: apiHealth?.ok ?? c.api?.ok, value: `node ${apiHealth ? '' : ''}${diag?.env?.node || ''}`.trim() || (diag?.env ? `node ${diag.env.node}` : 'running') },
    { icon: Database, label: 'PostgreSQL', ok: c.db?.ok, value: apiHealth?.dbReady ? 'connected' : '—' },
    { icon: Zap, label: 'Redis', ok: c.redis?.ok, value: c.redis?.version ? `v${c.redis.version}` : (c.redis?.ok ? 'connected' : 'down') },
    { icon: HardDrive, label: 'Disk', ok: diskPct < 95 ? (c.disk?.ok ?? null) : false, value: `${diskPct}% used` },
    { icon: MemoryStick, label: 'Memory (heap)', ok: heapPct == null ? null : heapPct < 90, value: heapPct != null ? `${heapPct}%` : '-' },
    { icon: Clock3, label: 'Uptime', ok: true, value: humanUptime(Number(diag?.uptime_sec || 0)) },
    { icon: Puzzle, label: 'Plugins loaded', ok: true, value: `${Number(apiHealth?.pluginCount || 0)}` },
    { icon: Table2, label: 'DB tables', ok: true, value: `${(diag?.tables || []).length}` },
  ];

  return (
    <div className="card p-4 h-full">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0"><Server className="w-4 h-4" /></div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground tracking-tight">System Status</h3>
            <p className="text-[11px] text-muted-foreground">Live health checks • 10s refresh</p>
          </div>
        </div>
        <Link href="/system/health" className="p-1.5 rounded-lg border border-border hover:bg-muted shrink-0" title="System Health & Diagnostics"><ExternalLink className="w-3.5 h-3.5" /></Link>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 min-w-0">
            <Dot ok={r.ok} />
            <r.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground truncate">{r.label}</span>
            <span className="text-[11px] font-mono font-semibold text-foreground ml-auto">{r.value}</span>
          </div>
        ))}
      </div>

      {diskPct > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>Disk usage</span><span className="font-mono">{diskPct}%</span></div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${diskPct > 95 ? 'bg-red-500' : diskPct > 85 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, diskPct)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
