'use client';

import React from 'react';
import Link from 'next/link';
import { Users, ArrowUpRight, CheckCircle2, AlertTriangle } from 'lucide-react';

function statusBadge(status: string) {
  switch (status) {
    case 'ACTIVE': return 'badge-success';
    case 'SUSPENDED': return 'badge-danger';
    case 'EXPIRED': return 'badge-warning';
    case 'PENDING': return 'badge-info';
    default: return 'badge-secondary';
  }
}

export function RecentSubscribersTable({ subscribers }: { subscribers: any[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="icon-tile shrink-0"><Users /></span>
          <div className="min-w-0">
            <div className="card-title">Recent Subscribers</div>
            <div className="card-subtitle">Latest onboarded clients across your network</div>
          </div>
        </div>
        <Link href="/subscribers" className="btn btn-outline btn-sm shrink-0">View all <ArrowUpRight className="w-3 h-3" /></Link>
      </div>

      <div className="table-wrap">
        <table className="table table-hover">
          <thead>
            <tr>
              <th>Subscriber</th>
              <th>Connection</th>
              <th>Package / Bill</th>
              <th>Location</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((sub) => {
              const status = String(sub.status || '').toUpperCase();
              const ok = status === 'ACTIVE';
              return (
                <tr key={sub.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="avatar avatar-sm avatar-primary">{(sub.full_name || '?').charAt(0).toUpperCase()}</span>
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground text-[12px] truncate">{sub.full_name}</div>
                        <div className="text-[9.5px] font-mono text-muted-foreground">{sub.client_code}{sub.username ? ` · ${sub.username}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="font-medium text-[11.5px]">{sub.connection_type || '-'}</div>
                    <div className="text-[9.5px] text-muted-foreground">{sub.provisioning_mode === 'ROUTER' ? `Router · ${sub.router_name || 'specific'}` : 'RADIUS pool'}</div>
                  </td>
                  <td>
                    <div className="font-medium text-[11.5px]">{sub.package_name || '-'}</div>
                    <div className={`text-[9.5px] ${Number(sub.current_due || 0) > 0 ? 'text-danger font-semibold' : 'text-success'}`}>
                      {sub.monthly_bill ? `৳${Number(sub.monthly_bill).toLocaleString()}` : ''} {Number(sub.current_due || 0) > 0 ? `· Due ৳${Number(sub.current_due).toLocaleString()}` : '· No due'}
                    </div>
                  </td>
                  <td>
                    <div className="text-[11px]">{ [sub.zone_name, sub.area_name, sub.district].filter(Boolean).join(', ') || '-' }</div>
                    <div className="text-[9.5px] text-muted-foreground">{sub.distribution_box_name || sub.distribution_box_code || ''}</div>
                  </td>
                  <td>
                    <span className={`badge ${statusBadge(status)}`}>
                      {ok ? <CheckCircle2 /> : <AlertTriangle />}
                      {status || 'UNKNOWN'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!subscribers.length && (
              <tr><td colSpan={5} className="py-10 text-center text-muted-foreground text-xs">No subscribers found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
