'use client';

import React from 'react';
import Link from 'next/link';
import {
  Users, Wifi, UserCheck, WifiOff, UserX, Clock3, BellRing,
  Receipt, Wallet, AlertTriangle, Router, RadioTower,
} from 'lucide-react';

function money(v: any) {
  return `৳${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

type Tile = {
  label: string; value: string; hint: string; icon: any; accent: string; href: string;
};

export function MetricsGrid({ summary, billing, sessions, routers, olts }: {
  summary: any; billing: any; sessions: any; routers: any[]; olts: any[];
}) {
  const s = summary || {};
  const b = billing || {};
  const online = Number(sessions?.online || 0);
  const total = Number(s.total || 0);
  const active = Number(s.active || b.activeSubscribers || 0);
  const routersOnline = (routers || []).filter((r: any) => String(r.status || '').toUpperCase() === 'ONLINE').length;
  const oltsOnline = (olts || []).filter((o: any) => String(o.status || '').toUpperCase() === 'ONLINE').length;
  const onlinePct = total > 0 ? Math.round((online / total) * 100) : 0;
  const inactive = Math.max(total - active, 0);

  const tiles: Tile[] = [
    { label: 'Total Clients', value: String(total), hint: 'Across every package', icon: Users, accent: 'primary', href: '/subscribers' },
    { label: 'Online Now', value: String(online), hint: `${onlinePct}% of subscriber base`, icon: Wifi, accent: 'success', href: '/subscribers/live' },
    { label: 'Active Lines', value: String(active), hint: `${inactive} inactive accounts`, icon: UserCheck, accent: 'teal', href: '/subscribers?status=ACTIVE' },
    { label: 'Offline', value: String(Number(s.offline || Math.max(total - online, 0))), hint: 'No active PPPoE session', icon: WifiOff, accent: 'secondary', href: '/subscribers?status=OFFLINE' },
    { label: 'Suspended', value: String(Number(s.suspended || 0)), hint: 'Access currently restricted', icon: UserX, accent: 'danger', href: '/subscribers?status=SUSPENDED' },
    { label: 'Expired', value: String(Number(s.expired || 0)), hint: 'Awaiting renewal', icon: Clock3, accent: 'warning', href: '/subscribers?status=EXPIRED' },
    { label: 'Expiring · 7 days', value: String(Number(s.expiring_soon || 0)), hint: 'Renewal window approaching', icon: BellRing, accent: 'orange', href: '/subscribers?status=EXPIRING' },
    { label: 'This Month Bill', value: money(b.monthlyBillGenerated), hint: 'Net amount invoiced', icon: Receipt, accent: 'purple', href: '/billing' },
    { label: 'Collected', value: money(b.thisMonthCollections), hint: 'Payments posted this month', icon: Wallet, accent: 'success', href: '/billing/payments' },
    { label: 'Outstanding', value: money(b.totalDueOutstanding), hint: `${Number(b.overdueInvoices || 0)} overdue invoices`, icon: AlertTriangle, accent: 'danger', href: '/billing/unpaid' },
    { label: 'Routers Online', value: `${routersOnline}/${(routers || []).length}`, hint: 'Edge & NAS fleet', icon: Router, accent: 'info', href: '/routers' },
    { label: 'OLTs Online', value: `${oltsOnline}/${(olts || []).length}`, hint: 'Optical line terminals', icon: RadioTower, accent: 'indigo', href: '/olts' },
  ];

  return (
    <div className="stat-grid">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Link key={t.label} href={t.href} className={`dash-stat dash-stat-${t.accent}`} title={t.label}>
            <span className="dash-stat-icon"><Icon /></span>
            <span className="dash-stat-body">
              <span className="dash-stat-label">{t.label}</span>
              <span className="dash-stat-value">{t.value}</span>
              <span className="dash-stat-hint">{t.hint}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
