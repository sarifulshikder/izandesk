'use client';

import React from 'react';
import Link from 'next/link';
import { Users, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';

export function RecentSubscribersTable({ subscribers }: { subscribers: any[] }) {
  return (
    <div className="card p-4 h-full">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0"><Users className="w-4 h-4" /></div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground tracking-tight">Recent Subscribers</h3>
            <p className="text-[11px] text-muted-foreground">Latest onboarded clients</p>
          </div>
        </div>
        <Link href="/subscribers" className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1 shrink-0">View All <ExternalLink className="w-3 h-3"/></Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground uppercase text-[10px] tracking-wider">
              <th className="py-2.5 px-3">Subscriber</th>
              <th className="py-2.5 px-3">Connection</th>
              <th className="py-2.5 px-3">Package / Bill</th>
              <th className="py-2.5 px-3">Location</th>
              <th className="py-2.5 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {subscribers.map((sub) => {
              const status = String(sub.status || '').toUpperCase();
              const ok = status === 'ACTIVE';
              return (
                <tr key={sub.id} className="hover:bg-muted/40 transition-colors">
                  <td className="py-3 px-3">
                    <div className="font-bold text-foreground">{sub.full_name}</div>
                    <div className="text-[11px] font-mono text-primary">{sub.client_code} {sub.username ? `• ${sub.username}` : ''}</div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-semibold text-foreground">{sub.connection_type || '-'}</div>
                    <div className="text-[10px] text-muted-foreground">{sub.provisioning_mode === 'ROUTER' ? `Router: ${sub.router_name || 'specific'}` : 'RADIUS pool'}</div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-semibold text-foreground">{sub.package_name || '-'}</div>
                    <div className={`text-[10px] ${Number(sub.current_due||0) > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'}`}>{sub.monthly_bill ? `৳${Number(sub.monthly_bill).toLocaleString()}` : ''} {Number(sub.current_due||0) > 0 ? `• Due ৳${Number(sub.current_due).toLocaleString()}` : '• No due'}</div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-foreground">{[sub.zone_name, sub.area_name, sub.district].filter(Boolean).join(', ') || '-'}</div>
                    <div className="text-[10px] text-muted-foreground">{sub.distribution_box_name || sub.distribution_box_code || ''}</div>
                  </td>
                  <td className="py-3 px-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : status==='SUSPENDED' ? 'bg-red-500/10 text-red-400 border-red-500/20' : status==='EXPIRED' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-muted text-muted-foreground border-border'}`}>
                      {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                      {status || 'UNKNOWN'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!subscribers.length && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No subscribers found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
