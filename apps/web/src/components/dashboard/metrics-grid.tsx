'use client';

import React from 'react';
import {
  Users,
  CreditCard,
  AlertTriangle,
  Network,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';

export function MetricsGrid() {
  const kpis = [
    {
      title: 'Active Subscribers',
      value: '3,842',
      change: '+142 this month',
      isPositive: true,
      subDetail: '3,120 Online Now • 722 Standby',
      icon: Users,
      color: 'from-cyan-500/20 to-blue-500/20 text-cyan-400 border-cyan-500/30',
    },
    {
      title: 'This Month Collection',
      value: 'BDT 2,485,000',
      change: '+18.4% vs last month',
      isPositive: true,
      subDetail: 'Target: BDT 2,800,000 (88.7%)',
      icon: CreditCard,
      color: 'from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/30',
    },
    {
      title: 'Outstanding Due',
      value: 'BDT 315,000',
      change: '42 Suspended • 85 In Grace',
      isPositive: false,
      subDetail: 'Auto-Suspend Active at 00:00',
      icon: AlertTriangle,
      color: 'from-amber-500/20 to-rose-500/20 text-amber-400 border-amber-500/30',
    },
    {
      title: 'Network Throughput',
      value: '8.42 Gbps',
      change: 'Peak: 9.8 Gbps (85% Link)',
      isPositive: true,
      subDetail: 'BDIX: 4.2G • IIG Transit: 4.22G',
      icon: Activity,
      color: 'from-indigo-500/20 to-purple-500/20 text-indigo-400 border-indigo-500/30',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {kpis.map((kpi, idx) => {
        const Icon = kpi.icon;

        return (
          <div
            key={idx}
            className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm hover:shadow-md transition-all group relative overflow-hidden"
          >
            {/* Top Row */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {kpi.title}
              </span>
              <div className={`p-2.5 rounded-xl border bg-gradient-to-br ${kpi.color} shadow-sm group-hover:scale-110 transition-transform`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>

            {/* Metric Value */}
            <div className="text-2xl font-black tracking-tight text-foreground mb-1.5">
              {kpi.value}
            </div>

            {/* Sub-detail & Trend */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-[11px] text-muted-foreground font-medium">
                {kpi.subDetail}
              </span>
              <span
                className={`flex items-center font-semibold text-[11px] px-1.5 py-0.5 rounded-md ${
                  kpi.isPositive
                    ? 'text-emerald-500 bg-emerald-500/10'
                    : 'text-amber-500 bg-amber-500/10'
                }`}
              >
                {kpi.isPositive ? (
                  <ArrowUpRight className="w-3 h-3 mr-0.5" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 mr-0.5" />
                )}
                {kpi.change}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
