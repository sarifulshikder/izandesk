'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  LayoutDashboard,
  Users,
  Network,
  CreditCard,
  Briefcase,
  LifeBuoy,
  MapPin,
  MessageSquare,
  Package,
  Settings,
  Puzzle,
  ShieldCheck,
  Radio,
  Boxes,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  roles?: string[];
}

const navItems: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Subscribers', href: '/subscribers', icon: Users, badge: '3,842' },
  { name: 'Fiber GIS Map', href: '/gis', icon: MapPin, badge: 'Live GIS' },
  { name: 'Inventory & Serials', href: '/inventory', icon: Boxes, badge: 'Stock' },
  { name: 'Bandwidth & QoS', href: '/bandwidth', icon: Radio },
  { name: 'Network & Routers', href: '/routers', icon: Network, badge: '12 Live' },
  { name: 'FTTH & OLTs', href: '/olts', icon: Package },
  { name: 'Billing & Invoices', href: '/billing', icon: CreditCard, badge: 'Due: 42' },
  { name: 'Resellers & Wallet', href: '/resellers', icon: Briefcase },
  { name: 'CRM & Tickets', href: '/tickets', icon: LifeBuoy, badge: '5 Open' },
  { name: 'Omnichannel SMS', href: '/messaging', icon: MessageSquare },
  { name: 'Plugin Kernel', href: '/plugins', icon: Puzzle, badge: '4 Active' },
  { name: 'Settings & Security', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { activeRole, user } = useAuth();

  return (
    <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-card/70 backdrop-blur-md h-screen sticky top-0 z-30 transition-all duration-300">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-border">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/20 text-white font-black text-xl tracking-wider">
            I
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg tracking-tight text-foreground">
                Izan<span className="text-primary">Desk</span>
              </span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                ERP v1.0
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground font-medium">ISP Automation Core</p>
          </div>
        </Link>
      </div>

      {/* Role Badge Indicator */}
      <div className="px-4 py-3 mx-3 my-2 rounded-lg bg-muted/60 border border-border/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <div className="text-xs">
            <div className="font-semibold text-foreground truncate max-w-[120px]">{user.name}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{activeRole.replace('_', ' ')}</div>
          </div>
        </div>
        <ShieldCheck className="w-4 h-4 text-primary" />
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-medium transition-all group ${
                isActive
                  ? 'bg-primary text-primary-foreground font-semibold shadow-md shadow-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 transition-transform group-hover:scale-110 ${
                    isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-primary'
                  }`}
                />
                <span>{item.name}</span>
              </div>
              {item.badge && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                    isActive
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* System Status Footer */}
      <div className="p-4 border-t border-border bg-muted/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Carrier Engine
          </span>
          <span className="font-mono text-[11px] text-emerald-400">99.99% UP</span>
        </div>
        <div className="w-full bg-border rounded-full h-1 overflow-hidden">
          <div className="bg-primary h-1 rounded-full w-[94%]" />
        </div>
      </div>
    </aside>
  );
}
