'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, CalendarDays, CheckCircle2, ChevronRight } from 'lucide-react';

function expiryLabel(value: any, timezone: string) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: timezone });
}

function money(value: any) {
  return `৳${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function RenewalQueueCard({ renewals, total, days = 7, timezone = 'Asia/Dhaka' }: { renewals: any[]; total?: number; days?: number; timezone?: string }) {
  return (
    <div className="card h-full">
      <div className="card-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="icon-tile shrink-0"><CalendarDays /></span>
          <div className="min-w-0">
            <div className="card-title">Renewal Queue</div>
            <div className="card-subtitle">Next {days} days · earliest first</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {Number(total || 0) > 0 && <span className="badge badge-warning">{total}</span>}
          <Link href={`/subscribers?expiring=${days}`} className="topbar-icon-btn !w-8 !h-8" title="View upcoming renewals"><ArrowUpRight className="w-3.5 h-3.5" /></Link>
        </div>
      </div>
      <div className="card-body py-3">
        {renewals.length > 0 ? (
          <div className="space-y-1">
            {renewals.slice(0, 6).map((subscriber) => {
              const daysLeft = Number(subscriber.days_left || 0);
              const timing = daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days`;
              return (
                <Link key={subscriber.id} href={`/subscribers/${subscriber.id}`} className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-transparent hover:border-border hover:bg-muted/35 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-semibold truncate group-hover:text-primary transition-colors">{subscriber.full_name || subscriber.username || subscriber.client_code}</div>
                    <div className="text-[9px] text-muted-foreground truncate mt-0.5">
                      {subscriber.client_code || subscriber.username}{subscriber.package_name ? ` · ${subscriber.package_name}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10.5px] font-semibold tabular-nums">{money(subscriber.monthly_bill)}</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">{expiryLabel(subscriber.expiry_date, timezone)}</div>
                  </div>
                  <span className={`badge shrink-0 ${daysLeft <= 1 ? 'badge-danger' : 'badge-warning'}`}>{timing}</span>
                  <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-state !py-10 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <span>No renewals due in the next {days} days.</span>
          </div>
        )}
      </div>
    </div>
  );
}
