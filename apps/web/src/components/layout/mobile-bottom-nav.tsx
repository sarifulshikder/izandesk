'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Network,
  LifeBuoy,
} from 'lucide-react';

export function MobileBottomNav() {
  const pathname = usePathname();

  const navs = [
    { name: 'Home', href: '/', icon: LayoutDashboard },
    { name: 'Clients', href: '/subscribers', icon: Users },
    { name: 'Billing', href: '/billing', icon: CreditCard },
    { name: 'Network', href: '/routers', icon: Network },
    { name: 'Tickets', href: '/tickets', icon: LifeBuoy },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/90 backdrop-blur-lg border-t border-border px-3 py-2 flex items-center justify-around shadow-2xl">
      {navs.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.name}
            href={item.href}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
              isActive ? 'text-primary font-bold' : 'text-muted-foreground'
            }`}
          >
            <Icon className={`w-5 h-5 ${isActive ? 'scale-110 text-primary' : ''}`} />
            <span className="text-[10px] tracking-tight">{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
