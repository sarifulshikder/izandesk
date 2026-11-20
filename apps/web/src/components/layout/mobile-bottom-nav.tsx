'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Network,
  LifeBuoy,
  AlertCircle,
  Ban,
} from 'lucide-react';

type NavItem = { name: string; href: string; icon: any; tab?: string };

export function MobileBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const isReseller = user?.role === 'RESELLER';
  const activeTab = searchParams?.get('tab') || 'dashboard';

  const adminNavs: NavItem[] = [
    { name: 'Home', href: '/', icon: LayoutDashboard },
    { name: 'Clients', href: '/subscribers', icon: Users },
    { name: 'Billing', href: '/billing', icon: CreditCard },
    { name: 'Network', href: '/routers', icon: Network },
    { name: 'Tickets', href: '/tickets', icon: LifeBuoy },
  ];
  const resellerNavs: NavItem[] = [
    { name: 'Portal', href: '/resellers', tab: 'dashboard', icon: LayoutDashboard },
    { name: 'Complaints', href: '/resellers?tab=complaints', tab: 'complaints', icon: AlertCircle },
    { name: 'Parental', href: '/resellers?tab=parental', tab: 'parental', icon: Ban },
    { name: 'Wallet', href: '/resellers/wallet', icon: CreditCard },
    { name: 'Renew', href: '/resellers/renew', icon: Users },
    { name: 'Tickets', href: '/tickets', icon: LifeBuoy },
  ];
  const navs = isReseller ? resellerNavs : adminNavs;
  const compact = navs.length >= 6;

  const isActive = (item: NavItem) => {
    // Portal tab items live on the same path; the ?tab query decides which is active.
    if (item.tab) return pathname === '/resellers' && activeTab === item.tab;
    return item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/');
  };

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5">
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-[color-mix(in_srgb,var(--card)_90%,transparent)] backdrop-blur-xl shadow-lg px-1.5 py-1.5 flex items-center justify-around">
        {navs.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`mobile-nav-item ${active ? 'active' : ''} ${compact ? 'px-1.5' : 'px-3'}`}
            >
              <Icon className={`${compact ? 'w-[18px] h-[18px]' : 'w-5 h-5'} shrink-0`} />
              <span className="tracking-tight leading-none whitespace-nowrap">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
