'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

export type Alert = {
  icon: any;
  label: string;
  count?: number;
  href: string;
  cls: string;
};

export function AttentionBar({ alerts }: { alerts: Alert[] }) {
  return (
    <div className={`p-3.5 rounded-2xl border shadow-sm ${alerts.length ? 'bg-card border-amber-500/25' : 'bg-card border-border/80'}`}>
      {alerts.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <span className="font-semibold">All systems nominal</span>
          <span className="text-xs text-muted-foreground font-normal">— no active alerts across network, fiber and billing</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mr-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Needs attention
          </span>
          {alerts.map((a) => (
            <Link key={a.label} href={a.href} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold hover:opacity-80 transition-opacity ${a.cls}`}>
              <a.icon className="w-3.5 h-3.5" />
              {a.label}
              {a.count != null && <b className="font-black">{a.count}</b>}
              <ArrowRight className="w-3 h-3" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
