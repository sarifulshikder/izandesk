'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

export type Alert = {
  icon: any;
  label: string;
  count?: number;
  href: string;
  cls?: string;
};

export function AttentionBar({ alerts }: { alerts: Alert[] }) {
  return (
    <div className={`card ${alerts.length ? 'alert-warning' : ''}`}>
      <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mr-1">
          <AlertTriangle className="w-3.5 h-3.5 text-warning" /> Live workload
        </span>
        {alerts.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="w-4 h-4" /> All systems nominal
            <span className="text-muted-foreground font-normal">— no active alerts across network, fiber and billing</span>
          </span>
        ) : (
          alerts.map((a) => (
            <Link key={a.label} href={a.href} className="filter-chip hover:opacity-90">
              <a.icon className="w-3.5 h-3.5" />
              {a.label}
              {a.count != null && <b>{a.count}</b>}
              <ArrowRight className="w-3 h-3" />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
