'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
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
  Activity,
  UserPlus,
  UserX,
  UserMinus,
  Clock3,
  Landmark,
  UsersRound,
  ShoppingCart,
  Ticket,
  BarChart3,
  ScrollText,
  Wifi,
  Truck,
} from 'lucide-react';

interface NavGroup {
  label: string;
  items: any[];
}

function isItemActive(pathname: string, searchParams: URLSearchParams | null, href?: string) {
  if (!href) return false;
  if (href.includes('?')) {
    const [p, q] = href.split('?');
    if (pathname !== p) return false;
    const want = new URLSearchParams(q);
    for (const [k, v] of want.entries()) {
      if (searchParams?.get(k) !== v) return false;
    }
    return true;
  }
  if (href === '/subscribers' && pathname === '/subscribers') {
    if (searchParams?.get('new') === '1' || searchParams?.get('action') === 'new' || searchParams?.get('add') === '1') return false;
    return true;
  }
  if (href === '/resellers' && pathname === '/resellers') return true;
  if (href === '/olts' && pathname === '/olts') return true;
  if (href === '/olts') return false;
  return pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
}

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { token, activeRole, user, isMobileMenuOpen, setMobileMenuOpen } = useAuth();
  const [resellers, setResellers] = useState<any[]>([]);
  const [olts, setOlts] = useState<any[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Core: true, Subscribers: true, Resellers: true, Network: true, Billing: true, Support: true, 'Finance & Ops': true, Plugins: true, System: false });
  const [openSub, setOpenSub] = useState<Record<string, boolean>>({ 'Payment Gateways': true, 'All Resellers': true, 'FTTH & OLTs': true });

  const loadResellers = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch<any>('/api/resellers', {}, token);
      setResellers(r.data || []);
    } catch {
      setResellers([]);
    }
  }, [token]);

  const loadOlts = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch<any>('/api/olt/olts', {}, token);
      setOlts(r.data || []);
    } catch {
      setOlts([]);
    }
  }, [token]);

  useEffect(() => { loadResellers(); loadOlts(); }, [loadResellers, loadOlts, pathname]);

  useEffect(() => {
    if (pathname.startsWith('/subscribers')) setOpenGroups(s => ({ ...s, Subscribers: true }));
    if (pathname.startsWith('/resellers')) { setOpenGroups(s => ({ ...s, Resellers: true })); setOpenSub(s => ({ ...s, 'All Resellers': true })); }
    if (pathname.startsWith('/olts')) { setOpenGroups(s => ({ ...s, Network: true })); setOpenSub(s => ({ ...s, 'FTTH & OLTs': true })); }
    if (pathname.startsWith('/plugins')) setOpenGroups(s => ({ ...s, Plugins: true }));
    if (pathname.startsWith('/plugins/payment-gateways')) setOpenSub(s => ({ ...s, 'Payment Gateways': true }));
    if (pathname.startsWith('/finance') || pathname.startsWith('/hr') || pathname.startsWith('/procurement') || pathname.startsWith('/hotspot') || pathname.startsWith('/reports') || pathname.startsWith('/audit')) setOpenGroups(s => ({ ...s, 'Finance & Ops': true }));
  }, [pathname]);

  if (!user || !activeRole) return null;

  const toggleGroup = (label: string) => setOpenGroups(s => ({ ...s, [label]: !s[label] }));
  const toggleSub = (label: string) => setOpenSub(s => ({ ...s, [label]: !s[label] }));

  const sidebarGroups: NavGroup[] = [
    {
      label: 'Core',
      items: [
        { name: 'Dashboard', href: '/', icon: LayoutDashboard },
        { name: 'Fiber GIS Map', href: '/gis', icon: MapPin, badge: 'Live GIS' },
        { name: 'Inventory & Serials', href: '/inventory', icon: Boxes, badge: 'Stock' },
      ],
    },
    {
      label: 'Subscribers',
      items: [
        { name: 'All Subscribers', href: '/subscribers', icon: Users, badge: 'All' },
        { name: 'Add Subscriber', href: '/subscribers?new=1', icon: UserPlus },
        { name: 'Live Sessions', href: '/subscribers/live', icon: Activity },
          { name: 'Leads Pipeline', href: '/leads', icon: UsersRound, badge: 'CRM' },
          { name: 'Installation Orders', href: '/installation-orders', icon: Truck, badge: 'Field' },
          { name: 'Expired Subscribers', href: '/subscribers?status=EXPIRED', icon: Clock3 },
        { name: 'Suspended Subscribers', href: '/subscribers?status=SUSPENDED', icon: UserX },
        { name: 'Pending / Inactive', href: '/subscribers?status=PENDING', icon: UserMinus },
      ],
    },
    {
      label: 'Resellers',
      items: [
        {
          name: 'All Resellers',
          icon: Briefcase,
          children: [
            { name: 'Overview', href: '/resellers' },
            ...resellers.map((r: any) => ({ name: r.name, href: `/resellers/${r.id}` })),
          ],
        },
        { name: 'Add Reseller', href: '/resellers/add', icon: UserPlus },
        { name: 'Wallet & Recharge', href: '/resellers/wallet', icon: Wallet },
        { name: 'Renew Subscriber', href: '/resellers/renew', icon: CreditCard },
      ],
    },
    {
      label: 'Network',
      items: [
        { name: 'Bandwidth & QoS', href: '/bandwidth', icon: Radio },
        { name: 'Network & Routers', href: '/routers', icon: Network, badge: 'NAS' },
        { name: 'WireGuard Overlay', href: '/wireguard', icon: Shield, badge: 'WG' },
        { name: 'RADIUS & AAA', href: '/radius', icon: ShieldCheck },
        {
          name: 'FTTH & OLTs',
          icon: Package,
          children: [
            { name: 'Overview', href: '/olts' },
            ...olts.map((o: any) => ({ name: o.name || o.host || 'OLT', href: `/olts/${o.id}` })),
          ],
        },
      ],
    },
    {
      label: 'Billing',
      items: [
        { name: 'Billing & Invoices', href: '/billing', icon: CreditCard },
      ],
    },
    {
      label: 'Support',
      items: [
        { name: 'CRM & Tickets', href: '/tickets', icon: LifeBuoy },
        { name: 'Omnichannel SMS', href: '/messaging', icon: MessageSquare },
        { name: 'Customer Portal', href: '/portal', icon: Users, badge: 'PWA' },
      ],
    },
    {
      label: 'Finance & Ops',
      items: [
        { name: 'Reports & Analytics', href: '/reports', icon: BarChart3, badge: 'P7' },
        { name: 'Finance & Accounts', href: '/finance', icon: Landmark },
        { name: 'HR & Payroll', href: '/hr', icon: UsersRound },
        { name: 'Procurement & Assets', href: '/procurement', icon: ShoppingCart },
        { name: 'Hotspot Vouchers', href: '/hotspot', icon: Wifi },
        { name: 'Audit & Field Ops', href: '/audit', icon: ScrollText },
      ],
    },
    {
      label: 'Plugins',
      items: [
        { name: 'Plugin Manager', href: '/plugins', icon: Puzzle },
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
        { name: 'System Health & Backup', href: '/system/health', icon: ShieldCheck, badge: 'Ops' },
        { name: 'Settings & Security', href: '/settings', icon: Settings },
      ],
    },
  ];

  return (
    <>
      <aside
        className={[
          'flex flex-col w-72 border-r border-border bg-card/95 dark:bg-[#0b1020]/95 backdrop-blur-md h-screen z-40 transition-transform duration-300 shadow-2xl lg:shadow-none',
          'fixed inset-y-0 left-0',
          'lg:sticky lg:top-0 lg:translate-x-0',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/80">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileMenuOpen(false)}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-primary to-cyan-500 flex items-center justify-center shadow-lg shadow-primary/25 text-white font-black text-lg">I</div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-lg tracking-tight text-foreground">Izan<span className="text-primary">Desk</span></span>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">ERP</span>
              </div>
              <p className="text-[11px] text-muted-foreground">ISP Billing & Network OSS</p>
            </div>
          </Link>
          <button onClick={() => setMobileMenuOpen(false)} className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted" aria-label="Close menu"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-3 py-3 border-b border-border/60">
          <div className="px-3 py-2.5 rounded-xl bg-muted/50 border border-border/70 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">{user.name}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{activeRole.replace(/_/g, ' ')}</div>
              </div>
            </div>
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {sidebarGroups.map((group) => (
            <div key={group.label} className="rounded-xl border border-border/50 bg-muted/10">
              <button onClick={() => toggleGroup(group.label)} className="w-full flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-wider font-bold text-muted-foreground hover:text-foreground">
                <span>{group.label}</span>
                {openGroups[group.label] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {openGroups[group.label] && (
                <div className="px-2 pb-2 space-y-0.5">
                  {group.items.map((item: any) => {
                    if (item.children && item.children.length) {
                      const isOpen = !!openSub[item.name];
                      const subActive = item.children.some((c: any) => isItemActive(pathname, searchParams, c.href));
                      return (
                        <div key={item.name} className="rounded-lg">
                          <button onClick={() => toggleSub(item.name)} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${subActive ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-muted/70 hover:text-foreground'}`}>
                            <span className="flex items-center gap-2.5">{item.icon && <item.icon className="w-4 h-4" />}{item.name}</span>
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                          {isOpen && (
                            <div className="ml-4 mt-0.5 pl-3 border-l border-primary/20 space-y-0.5 max-h-64 overflow-auto">
                              {item.children.map((c: any) => {
                                const active = isItemActive(pathname, searchParams, c.href);
                                return (
                                  <Link key={`${item.name}-${c.href}-${c.name}`} href={c.href} onClick={() => setMobileMenuOpen(false)} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${active ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'}`}>
                                    <span className="truncate">{c.name}</span>
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }
                    const active = isItemActive(pathname, searchParams, item.href);
                    const Icon = item.icon;
                    return (
                      <Link key={item.name} href={item.href!} onClick={() => setMobileMenuOpen(false)} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors border border-transparent ${active ? 'bg-primary text-primary-foreground font-semibold shadow-sm shadow-primary/20' : 'text-foreground/80 hover:bg-muted/70 hover:text-foreground'}`}>
                        <span className="flex items-center gap-2.5">{Icon && <Icon className={`w-4 h-4 ${active ? '' : 'text-primary/80'}`} />}{item.name}</span>
                        {item.badge && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground border border-border/60'}`}>{item.badge}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-border/70 bg-muted/20">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Carrier Engine</span>
            <span className="font-mono text-[11px] text-emerald-400">ONLINE</span>
          </div>
          <div className="w-full bg-border/70 rounded-full h-1.5 overflow-hidden"><div className="bg-gradient-to-r from-primary to-cyan-500 h-1.5 rounded-full w-[94%]" /></div>
        </div>
      </aside>

      {isMobileMenuOpen && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />}
    </>
  );
}
