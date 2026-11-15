'use client';

import React from 'react';
import Link from 'next/link';
import { Network as NetworkIcon, Radio, Cpu, HardDrive, ExternalLink, AlertOctagon } from 'lucide-react';

const online = (x: any) => String(x?.status || '').toUpperCase() === 'ONLINE';

export function NetworkHealthCard({ routers, olts, onus }: { routers: any[]; olts: any[]; onus: any[] }) {
  const rOn = routers.filter(online).length;
  const oOn = olts.filter(online).length;
  const worstCpu = [...routers].sort((a, b) => Number(b.cpu_load || 0) - Number(a.cpu_load || 0))[0];
  const onuTotal = onus.length;
  const onuOnline = onus.filter((u) => String(u.status).toUpperCase() === 'ONLINE').length;
  const onuCritical = onus.filter((u) => String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS').length;

  const pill = (on: number, total: number, label: string) => (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${total && on === total ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
      {total ? `${on}/${total} ${label} online` : `No ${label}`}
    </span>
  );

  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary shrink-0"><NetworkIcon className="w-4 h-4" /></div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground tracking-tight">Network Health</h3>
            <p className="text-[11px] text-muted-foreground">Routers & FTTH — live status</p>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Link href="/routers" className="p-1.5 rounded-lg border border-border hover:bg-muted" title="Routers"><ExternalLink className="w-3.5 h-3.5" /></Link>
          <Link href="/olts" className="p-1.5 rounded-lg border border-border hover:bg-muted" title="OLTs"><ExternalLink className="w-3.5 h-3.5" /></Link>
        </div>
      </div>

      {/* Routers */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {pill(rOn, routers.length, 'routers')}
        {worstCpu && worstCpu.cpu_load != null && (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted/30 text-muted-foreground inline-flex items-center gap-1">
            <Cpu className="w-3 h-3 text-primary" /> max CPU {worstCpu.cpu_load}% ({worstCpu.name})
          </span>
        )}
      </div>
      <div className="space-y-2 mb-3">
        {routers.slice(0, 3).map((r) => {
          const memPct = r.memory_total_mb ? Math.round((Number(r.memory_used_mb || 0) / Number(r.memory_total_mb || 1)) * 100) : null;
          return (
            <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/60">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${online(r) ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-xs font-bold text-foreground truncate">{r.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0 hidden sm:inline">{r.host}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                {r.cpu_load != null && <span className="inline-flex items-center gap-1"><Cpu className="w-3 h-3 text-primary" />{r.cpu_load}%</span>}
                {memPct != null && <span className="inline-flex items-center gap-1"><HardDrive className="w-3 h-3 text-secondary" />{memPct}%</span>}
              </div>
            </div>
          );
        })}
        {!routers.length && <div className="text-xs text-muted-foreground px-3 py-2 border border-dashed border-border rounded-xl">No routers configured.</div>}
      </div>

      {/* OLT / FTTH */}
      <div className="flex items-center gap-2 mb-2 flex-wrap pt-2 border-t border-border/60">
        {pill(oOn, olts.length, 'OLTs')}
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted/30">{onuTotal} ONUs • {onuOnline} online</span>
        {onuCritical > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/20 inline-flex items-center gap-1"><AlertOctagon className="w-3 h-3" />{onuCritical} critical</span>}
      </div>
      <div className="space-y-2">
        {olts.slice(0, 2).map((o) => {
          const n = onus.filter((u) => u.olt_id === o.id).length;
          const c = onus.filter((u) => u.olt_id === o.id && (String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS')).length;
          return (
            <div key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/60">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${online(o) ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-xs font-bold text-foreground truncate">{o.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{o.vendor}{o.model ? ` • ${o.model}` : ''}</span>
              </div>
              <span className={`text-[10px] shrink-0 font-semibold ${c > 0 ? 'text-rose-400' : 'text-muted-foreground'}`}>
                <Radio className="w-3 h-3 inline mr-1 text-cyan-400" />{n} ONUs{c > 0 ? ` • ${c} crit` : ''}
              </span>
            </div>
          );
        })}
        {!olts.length && <div className="text-xs text-muted-foreground px-3 py-2 border border-dashed border-border rounded-xl">No OLTs configured.</div>}
      </div>
    </div>
  );
}
