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
  X,
  Shield,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const navItems: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Subscribers', href: '/subscribers', icon: Users, badge: '3,842' },
  { name: 'Fiber GIS Map', href: '/gis', icon: MapPin, badge: 'Live GIS' },
  { name: 'Inventory & Serials', href: '/inventory', icon: Boxes, badge: 'Stock' },
  { name: 'Bandwidth & QoS', href: '/bandwidth', icon: Radio },
  { name: 'Network & Routers', href: '/routers', icon: Network, badge: '12 Live' },
  { name: 'WireGuard Overlay', href: '/wireguard', icon: Shield, badge: 'WG' },
  { name: 'RADIUS & AAA', href: '/radius', icon: ShieldCheck },
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
  const { activeRole, user, isMobileMenuOpen, setMobileMenuOpen } = useAuth();
  if (!user || !activeRole) return null;

  return (
    <>
      {/* Sidebar panel */}
      <aside
        className={[
          'flex flex-col w-64 border-r border-border bg-card/95 dark:bg-card/80 backdrop-blur-md h-screen z-40 transition-transform duration-300 shadow-xl lg:shadow-none',
          // On mobile: fixed overlay, slide in/out
          'fixed inset-y-0 left-0',
          // On desktop: sticky, always visible
          'lg:sticky lg:top-0 lg:translate-x-0',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileMenuOpen(false)}>
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
          {/* Close button — mobile only */}
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Role Badge */}
        <div className="px-4 py-3 mx-3 my-2 rounded-lg bg-muted/60 border border-border/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <div className="text-xs">
              <div className="font-semibold text-foreground truncate max-w-[120px]">{user.name}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {activeRole.replace(/_/g, ' ')}
              </div>
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
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-medium transition-all group ${
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold shadow-md shadow-primary/20'
                    : 'text-foreground/80 dark:text-muted-foreground hover:text-foreground hover:bg-muted/80'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 transition-transform group-hover:scale-110 ${
                      isActive ? 'text-primary-foreground' : 'text-foreground/70 dark:text-muted-foreground group-hover:text-primary'
                    }`}
                  />
                  <span className={isActive ? '' : 'text-foreground dark:text-inherit'}>{item.name}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                      isActive
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : 'bg-muted text-foreground/70 dark:text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
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

      {/* Mobile backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
}
