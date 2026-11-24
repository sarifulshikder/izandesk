'use client';

import React from 'react';
import Link from 'next/link';
import { Network as NetworkIcon, Radio, Cpu, HardDrive, ArrowUpRight, AlertOctagon } from 'lucide-react';

const online = (x: any) => String(x?.status || '').toUpperCase() === 'ONLINE';

export function NetworkHealthCard({ routers, olts, onus }: { routers: any[]; olts: any[]; onus: any[] }) {
  const rOn = routers.filter(online).length;
  const oOn = olts.filter(online).length;
  const worstCpu = [...routers].sort((a, b) => Number(b.cpu_load || 0) - Number(a.cpu_load || 0))[0];
  const onuTotal = onus.length;
  const onuOnline = onus.filter((u) => String(u.status).toUpperCase() === 'ONLINE').length;
  const onuCritical = onus.filter((u) => String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS').length;

  const statusPill = (on: number, total: number) => (
    <span className={`badge ${total && on === total ? 'badge-success' : 'badge-warning'}`}>
      {total ? `${on}/${total} online` : 'none set'}
    </span>
  );

  return (
    <div className="card h-full">
      <div className="card-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="icon-tile shrink-0"><NetworkIcon /></span>
          <div className="min-w-0">
            <div className="card-title">Network Health</div>
            <div className="card-subtitle">Edge, NAS & optical plants</div>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Link href="/routers" className="topbar-icon-btn !w-8 !h-8" title="Routers"><ArrowUpRight className="w-3.5 h-3.5" /></Link>
          <Link href="/olts" className="topbar-icon-btn !w-8 !h-8" title="OLTs"><ArrowUpRight className="w-3.5 h-3.5" /></Link>
        </div>
      </div>

      <div className="card-body py-4 space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="section-label">Edge / NAS</span>
            {statusPill(rOn, routers.length)}
          </div>
          <div className="space-y-1.5">
            {routers.slice(0, 3).map((r) => {
              const memPct = r.memory_total_mb ? Math.round((Number(r.memory_used_mb || 0) / Number(r.memory_total_mb || 1)) * 100) : null;
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-muted/40 border border-border/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online(r) ? 'bg-success' : 'bg-danger'}`} />
                    <div className="min-w-0">
                      <div className="text-[11.5px] font-semibold text-foreground truncate leading-tight">{r.name}</div>
                      <div className="font-mono text-[9px] text-muted-foreground truncate">{r.host}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[9.5px] text-muted-foreground shrink-0">
                    {r.cpu_load != null && <span className="inline-flex items-center gap-1"><Cpu className="w-2.5 h-2.5 text-primary" />{r.cpu_load}%</span>}
                    {memPct != null && <span className="inline-flex items-center gap-1"><HardDrive className="w-2.5 h-2.5 text-[var(--muted-foreground)]" />{memPct}%</span>}
                  </div>
                </div>
              );
            })}
            {!routers.length && <div className="text-[10.5px] text-muted-foreground px-2.5 py-2 border border-dashed border-border rounded-lg">No routers configured.</div>}
          </div>
          {worstCpu && worstCpu.cpu_load != null && (
            <div className="text-[9.5px] text-muted-foreground mt-1.5 flex items-center gap-1">
              <Cpu className="w-2.5 h-2.5" /> Peak CPU {worstCpu.cpu_load}% on {worstCpu.name}
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-border/70">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="section-label">Optical / FTTH</span>
            <span className="flex items-center gap-1.5">
              {statusPill(oOn, olts.length)}
              {onuCritical > 0 && <Link href="/olts?onu_status=CRITICAL_LOS" className="badge badge-danger hover:opacity-90"><AlertOctagon className="w-2.5 h-2.5" />{onuCritical}</Link>}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mb-2 text-[9.5px] text-muted-foreground">
            <Radio className="w-2.5 h-2.5 text-[var(--teal)]" />
            {onuTotal} ONUs discovered · {onuOnline} online
          </div>
          <div className="space-y-1.5">
            {olts.slice(0, 2).map((o) => {
              const n = onus.filter((u) => u.olt_id === o.id).length;
              const c = onus.filter((u) => u.olt_id === o.id && (String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS')).length;
              return (
                <div key={o.id} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-muted/40 border border-border/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online(o) ? 'bg-success' : 'bg-danger'}`} />
                    <div className="min-w-0">
                      <div className="text-[11.5px] font-semibold text-foreground truncate leading-tight">{o.name}</div>
                      <div className="text-[9px] text-muted-foreground truncate">{o.vendor}{o.model ? ` · ${o.model}` : ''}</div>
                    </div>
                  </div>
                  <span className={`text-[9.5px] shrink-0 font-semibold tabular-nums ${c > 0 ? 'text-danger' : 'text-muted-foreground'}`}>
                    {n} ONUs{c > 0 ? ` · ${c} crit` : ''}
                  </span>
                </div>
              );
            })}
            {!olts.length && <div className="text-[10.5px] text-muted-foreground px-2.5 py-2 border border-dashed border-border rounded-lg">No OLTs configured.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
