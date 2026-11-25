'use client';

import React from 'react';
import Link from 'next/link';
import {
  Users, Wifi, UserCheck, WifiOff, UserX, Clock3, BellRing,
  Router, RadioTower,
} from 'lucide-react';

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
    { label: 'Expired Validity', value: String(Number(s.expired_validity ?? s.expired ?? 0)), hint: 'Past package expiry date', icon: Clock3, accent: 'warning', href: '/subscribers?validity_expired=1' },
    { label: 'Expiring Tomorrow', value: String(Number(s.expiring_tomorrow || 0)), hint: 'Act before expiry', icon: BellRing, accent: 'orange', href: '/subscribers?expiring=tomorrow' },
    { label: 'Expiring · 7 days', value: String(Number(s.expiring_soon || 0)), hint: 'Renewal window approaching', icon: BellRing, accent: 'warning', href: '/subscribers?expiring=7' },
    { label: 'Routers Online', value: `${routersOnline}/${(routers || []).length}`, hint: 'Edge & NAS fleet', icon: Router, accent: 'info', href: '/routers' },
    { label: 'OLTs Online', value: `${oltsOnline}/${(olts || []).length}`, hint: 'Optical line terminals', icon: RadioTower, accent: 'indigo', href: '/olts' },
  ];

  return (
    <div className="stat-grid dashboard-metrics-grid">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Link key={t.label} href={t.href} className={`dash-stat dash-stat-${t.accent} compact`} title={t.label}>
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
