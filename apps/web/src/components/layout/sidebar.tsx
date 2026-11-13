'use client';

import React, { useState, useEffect } from 'react';
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
  ChevronDown,
  ChevronRight,
  Plug,
  Wallet,
  Smartphone,
  Globe,
} from 'lucide-react';

interface NavLeaf {
  name: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string;
}
interface NavGroup {
  label: string;
  items: (NavLeaf | NavGroupItem)[];
}
interface NavGroupItem {
  name: string;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: { name: string; href: string }[];
  badge?: string;
}

const sidebarGroups: NavGroup[] = [
  {
    label: 'Core',
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'Subscribers', href: '/subscribers', icon: Users, badge: '3,842' },
      { name: 'Fiber GIS Map', href: '/gis', icon: MapPin, badge: 'Live GIS' },
      { name: 'Inventory & Serials', href: '/inventory', icon: Boxes, badge: 'Stock' },
    ],
  },
  {
    label: 'Network',
    items: [
      { name: 'Bandwidth & QoS', href: '/bandwidth', icon: Radio },
      { name: 'Network & Routers', href: '/routers', icon: Network, badge: '12 Live' },
      { name: 'WireGuard Overlay', href: '/wireguard', icon: Shield, badge: 'WG' },
      { name: 'RADIUS & AAA', href: '/radius', icon: ShieldCheck },
      { name: 'FTTH & OLTs', href: '/olts', icon: Package },
    ],
  },
  {
    label: 'Billing',
    items: [
      { name: 'Billing & Invoices', href: '/billing', icon: CreditCard, badge: 'Due: 42' },
      { name: 'Resellers & Wallet', href: '/resellers', icon: Briefcase },
    ],
  },
  {
    label: 'Support',
    items: [
      { name: 'CRM & Tickets', href: '/tickets', icon: LifeBuoy, badge: '5 Open' },
      { name: 'Omnichannel SMS', href: '/messaging', icon: MessageSquare },
    ],
  },
  {
    label: 'Plugins',
    items: [
      {
        name: 'Plugin Manager',
        href: '/plugins',
        icon: Puzzle,
        badge: 'Plugins',
      },
      {
        name: 'Payment Gateways',
        icon: Wallet,
        children: [
          { name: 'bKash', href: '/plugins/payment-gateways/bkash' },
          { name: 'Nagad', href: '/plugins/payment-gateways/nagad' },
          { name: 'Rocket', href: '/plugins/payment-gateways/rocket' },
          { name: 'Stripe', href: '/plugins/payment-gateways/stripe' },
          { name: 'PayPal', href: '/plugins/payment-gateways/paypal' },
        ],
      },
      { name: 'SMS Gateways', href: '/plugins?category=SMS_GATEWAY', icon: Smartphone },
    ],
  },
  {
    label: 'System',
    items: [
      { name: 'Settings & Security', href: '/settings', icon: Settings },
    ],
  },
];

function isItemActive(pathname: string, href?: string) {
  if (!href) return false;
  if (href.includes('?')) {
    const [p] = href.split('?');
    return pathname === p || pathname.startsWith(p + '/');
  }
  return pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
}

export function Sidebar() {
  const pathname = usePathname();
  const { activeRole, user, isMobileMenuOpen, setMobileMenuOpen } = useAuth();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Core: true, Network: true, Billing: true, Support: false, Plugins: true, System: false });
  const [openSub, setOpenSub] = useState<Record<string, boolean>>({ 'Payment Gateways': true });

  useEffect(() => {
    if (pathname.startsWith('/plugins')) setOpenGroups(s => ({ ...s, Plugins: true }));
    if (pathname.startsWith('/plugins/payment-gateways')) setOpenSub(s => ({ ...s, 'Payment Gateways': true }));
  }, [pathname]);

  if (!user || !activeRole) return null;

  const toggleGroup = (label: string) => setOpenGroups(s => ({ ...s, [label]: !s[label] }));
  const toggleSub = (label: string) => setOpenSub(s => ({ ...s, [label]: !s[label] }));

  return (
    <>
      <aside
        className={[
          'flex flex-col w-72 border-r border-border bg-card/95 dark:bg-card/80 backdrop-blur-md h-screen z-40 transition-transform duration-300 shadow-xl lg:shadow-none',
          'fixed inset-y-0 left-0',
          'lg:sticky lg:top-0 lg:translate-x-0',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileMenuOpen(false)}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/20 text-white font-black text-xl tracking-wider">I</div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-lg tracking-tight text-foreground">Izan<span className="text-primary">Desk</span></span>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">ERP v1.0</span>
              </div>
              <p className="text-[11px] text-muted-foreground font-medium">ISP Automation Core</p>
            </div>
          </Link>
          <button onClick={() => setMobileMenuOpen(false)} className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label="Close menu"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-4 py-3 mx-3 my-2 rounded-lg bg-muted/60 border border-border/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <div className="text-xs">
              <div className="font-semibold text-foreground truncate max-w-[120px]">{user.name}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{activeRole.replace(/_/g, ' ')}</div>
            </div>
          </div>
          <ShieldCheck className="w-4 h-4 text-primary" />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {sidebarGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              <button onClick={() => toggleGroup(group.label)} className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider font-bold text-muted-foreground hover:text-foreground">
                <span>{group.label}</span>
                {openGroups[group.label] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {openGroups[group.label] && (
                <div className="space-y-0.5">
                  {group.items.map((item: any) => {
                    if (item.children && item.children.length) {
                      const isOpen = !!openSub[item.name];
                      return (
                        <div key={item.name}>
                          <button onClick={() => toggleSub(item.name)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-foreground/80 hover:bg-muted/80">
                            <span className="flex items-center gap-2">{item.icon && <item.icon className="w-4 h-4 text-foreground/70" />}{item.name}</span>
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                          {isOpen && (
                            <div className="ml-4 pl-3 border-l border-border/70 space-y-0.5 mt-0.5">
                              {item.children.map((c: any) => {
                                const active = isItemActive(pathname, c.href);
                                return (
                                  <Link key={c.href} href={c.href} onClick={() => setMobileMenuOpen(false)} className={`block px-3 py-2 rounded-lg text-xs ${active ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'}`}>
                                    {c.name}
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }
                    const active = isItemActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <Link key={item.name} href={item.href!} onClick={() => setMobileMenuOpen(false)} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium ${active ? 'bg-primary text-primary-foreground font-semibold' : 'text-foreground/80 hover:bg-muted/80'}`}>
                        <span className="flex items-center gap-2">{Icon && <Icon className="w-4 h-4" />}{item.name}</span>
                        {item.badge && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground'}`}>{item.badge}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Carrier Engine</span>
            <span className="font-mono text-[11px] text-emerald-400">99.99% UP</span>
          </div>
          <div className="w-full bg-border rounded-full h-1 overflow-hidden"><div className="bg-primary h-1 rounded-full w-[94%]" /></div>
        </div>
      </aside>

      {isMobileMenuOpen && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />}
    </>
  );
}