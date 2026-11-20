'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, BellRing } from 'lucide-react';

export type Alert = {
  icon: any;
  label: string;
  count?: number;
  href: string;
  cls?: string;
};

export function AttentionBar({ alerts }: { alerts: Alert[] }) {
  const hasAlerts = alerts.length > 0;
  return (
    <div
      className="card overflow-hidden"
      style={{ borderLeft: `3px solid ${hasAlerts ? 'var(--warning)' : 'var(--success)'}` }}
    >
      <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${hasAlerts ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
            {hasAlerts ? <BellRing className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          </span>
          {hasAlerts ? 'Needs attention' : 'All clear'}
        </span>
        {!hasAlerts ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
            No active alerts across network, fiber and billing.
          </span>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {alerts.map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="group inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-lg border border-border bg-[color-mix(in_srgb,var(--card)_75%,var(--muted))] text-[11px] font-semibold text-foreground hover:border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] hover:bg-[color-mix(in_srgb,var(--warning)_7%,var(--card))] transition-colors"
              >
                <a.icon className="w-3 h-3 text-warning" />
                <span>{a.label}</span>
                {a.count != null && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-md bg-warning/12 text-warning text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                    {a.count}
                  </span>
                )}
                <ArrowRight className="w-2.5 h-2.5 text-muted-foreground opacity-0 -ml-0.5 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
