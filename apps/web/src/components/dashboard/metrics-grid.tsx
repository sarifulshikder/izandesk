'use client';

import React from 'react';
import Link from 'next/link';
import { Users, CreditCard, AlertTriangle, Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';

function money(v: any) {
  return `৳${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtBps(bps: number) {
  const n = Number(bps || 0);
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} Mbps`;
  return `${Math.max(0, n / 1e3).toFixed(0)} Kbps`;
}

export function MetricsGrid({ total, online, billing, rx, tx }: { total: number; online: number; billing: any; rx: number; tx: number }) {
  const b = billing || {};
  const due = Number(b.totalDueOutstanding || 0);
  const kpis = [
    {
      title: 'Subscribers',
      value: `${Number(total || 0).toLocaleString()}`,
      chip: `${Number(online || 0)} online now`,
      isPositive: true,
      sub: `${Number(b.activeSubscribers || 0)} active`,
      icon: Users,
      color: 'from-cyan-500/20 to-blue-500/20 text-cyan-400 border-cyan-500/30',
      href: '/subscribers',
    },
    {
      title: 'Collection (Month)',
      value: money(b.thisMonthCollections),
      chip: `Today ${money(b.todayCollections)}`,
      isPositive: true,
      sub: `Billed ${money(b.monthlyBillGenerated)}`,
      icon: CreditCard,
      color: 'from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/30',
      href: '/billing?view=collections',
    },
    {
      title: 'Outstanding Dues',
      value: money(due),
      chip: due > 0 ? 'needs follow-up' : 'all clear',
      isPositive: due <= 0,
      sub: `${Number(b.suspendedDue || 0)} suspended • ${Number(b.overdueInvoices || 0)} overdue inv.`,
      icon: AlertTriangle,
      color: 'from-amber-500/20 to-rose-500/20 text-amber-400 border-amber-500/30',
      href: '/billing?status=unpaid',
    },
    {
      title: 'Live Throughput',
      value: fmtBps(rx + tx),
      chip: `${Number(online || 0)} sessions`,
      isPositive: true,
      sub: `RX ${fmtBps(rx)} • TX ${fmtBps(tx)}`,
      icon: Activity,
      color: 'from-indigo-500/20 to-purple-500/20 text-indigo-400 border-indigo-500/30',
      href: '/subscribers/live',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {kpis.map((kpi, idx) => {
        const Icon = kpi.icon;
        const content = (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{kpi.title}</span>
              <div className={`p-2.5 rounded-xl border bg-gradient-to-br ${kpi.color} shadow-sm group-hover:scale-110 transition-transform`}><Icon className="w-4 h-4" /></div>
            </div>
            <div className="text-2xl font-black tracking-tight text-foreground mb-1.5 font-mono">{kpi.value}</div>
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="text-[11px] text-muted-foreground font-medium truncate">{kpi.sub}</span>
              <span className={`flex items-center font-semibold text-[11px] px-1.5 py-0.5 rounded-md shrink-0 ${kpi.isPositive ? 'text-emerald-500 bg-emerald-500/10' : 'text-amber-500 bg-amber-500/10'}`}>
                {kpi.isPositive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                {kpi.chip}
              </span>
            </div>
          </>
        );
        return kpi.href ? (
          <Link key={idx} href={kpi.href} className="block p-5 rounded-2xl bg-card border border-border/80 shadow-sm hover:shadow-md hover:border-primary/30 transition-all group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary/40">
            {content}
          </Link>
        ) : (
          <div key={idx} className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm hover:shadow-md hover:border-primary/30 transition-all group relative overflow-hidden">
            {content}
          </div>
        );
      })}
    </div>
  );
}
