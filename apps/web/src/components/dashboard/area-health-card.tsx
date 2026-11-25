'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, MapPin } from 'lucide-react';

export function AreaHealthCard({ areas, total }: { areas: any[]; total?: number }) {
  return (
    <div className="card h-full">
      <div className="card-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="icon-tile shrink-0"><MapPin /></span>
          <div className="min-w-0">
            <div className="card-title">Area Health</div>
            <div className="card-subtitle">Clients, connectivity & renewal risk</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {Number(total || 0) > 0 && <span className="badge badge-secondary">{total} areas</span>}
          <Link href="/subscribers" className="topbar-icon-btn !w-8 !h-8" title="View subscribers"><ArrowUpRight className="w-3.5 h-3.5" /></Link>
        </div>
      </div>
      <div className="card-body py-3">
        {areas.length > 0 ? (
          <div className="space-y-1">
            {areas.slice(0, 6).map((area) => {
              const count = Number(area.total || 0);
              const active = Number(area.active || 0);
              const activePct = count > 0 ? Math.round((active / count) * 100) : 0;
              const href = area.area_id ? `/subscribers?area_id=${encodeURIComponent(area.area_id)}` : '/subscribers';
              return (
                <Link key={area.area_id || 'unassigned'} href={href} className="group block px-2.5 py-2 rounded-lg border border-transparent hover:border-border hover:bg-muted/35 transition-colors">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className="text-[11.5px] font-semibold truncate group-hover:text-primary transition-colors">{area.area_name}</span>
                    <span className="text-[9.5px] text-muted-foreground shrink-0 tabular-nums">{count} clients</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden mb-1.5">
                    <div className={`h-full rounded-full ${activePct < 70 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${activePct}%` }} />
                  </div>
                  <div className="flex items-center gap-x-2.5 gap-y-0.5 text-[9px] text-muted-foreground flex-wrap">
                    <span><b className="text-success font-semibold">{active}</b> active</span>
                    <span><b className="text-foreground font-semibold">{Number(area.online || 0)}</b> online</span>
                    <span className={Number(area.due || 0) > 0 ? 'text-warning' : ''}><b className="font-semibold">{Number(area.due || 0)}</b> due</span>
                    <span className={Number(area.expired_validity || 0) > 0 ? 'text-danger' : ''}><b className="font-semibold">{Number(area.expired_validity || 0)}</b> expired</span>
                    <span><b className="font-semibold">{Number(area.expiring || 0)}</b> expiring</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-state !py-10">No subscriber areas available yet.</div>
        )}
        <div className="mt-2 pt-2 border-t border-border/60 text-[9px] text-muted-foreground">
          Online counts reflect the last-known session state.
        </div>
      </div>
    </div>
  );
}
