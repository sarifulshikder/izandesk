'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import {
  LayoutDashboard, MapPin, Boxes, Users, UserPlus, Activity, UsersRound, Truck,
  Clock3, UserX, UserMinus, CreditCard, Receipt, Wallet, Landmark, BarChart3,
  ScrollText, Briefcase, Radio, Network, Shield, ShieldCheck, Wifi, Package,
  LifeBuoy, MessageSquare, Puzzle, Smartphone, ShoppingCart, Settings, Server,
  X, ChevronDown, ChevronRight, BellRing, Building2, AlertCircle, Ban, Sparkles,
  ClipboardCheck,
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
  // Reseller "My Portal" is only active when no portal tab is selected.
  if (href === '/resellers') return pathname === '/resellers' && !searchParams?.get('tab');
  if (['/resellers', '/olts', '/routers'].includes(href) && pathname !== href) return false;
  return pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
}

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { token, activeRole, user, isMobileMenuOpen, setMobileMenuOpen } = useAuth();
  const [resellers, setResellers] = useState<any[]>([]);
  const [olts, setOlts] = useState<any[]>([]);
  const [routers, setRouters] = useState<any[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    'Reseller Portal': true, 'Partner Finance': true, 'Partner Operations': true, Dashboard: true, Clients: true, Billing: true, Resellers: false, Network: true, 'OLT & Tools': true,
    Support: false, 'AI Copilot': true, 'Finance & Ops': false, Plugins: false, System: false,
  });
  const [openSub, setOpenSub] = useState<Record<string, boolean>>({
    'Payment Gateways': true, 'All Resellers': true, 'FTTH & OLTs': true, 'Network & Routers': true,
  });
  const isReseller = user?.role === 'RESELLER';

  const loadResellers = useCallback(async () => {
    if (!token) return;
    try { setResellers((await apiFetch<any>('/api/resellers', {}, token)).data || []); } catch { setResellers([]); }
  }, [token]);
  const loadOlts = useCallback(async () => {
    if (!token) return;
    try { setOlts((await apiFetch<any>('/api/olt/olts', {}, token)).data || []); } catch { setOlts([]); }
  }, [token]);
  const loadRouters = useCallback(async () => {
    if (!token) return;
    try { setRouters((await apiFetch<any>('/api/network/routers', {}, token)).data || []); } catch { setRouters([]); }
  }, [token]);

  // Admin-only lookups — resellers have no use for (or access to) the router/OLT lists.
  useEffect(() => { if (!isReseller) { loadResellers(); loadOlts(); loadRouters(); } }, [loadResellers, loadOlts, loadRouters, pathname, isReseller]);

  useEffect(() => {
    const open = (g: string) => setOpenGroups(s => ({ ...s, [g]: true }));
    if (pathname === '/') open('Dashboard');
    if (pathname.startsWith('/subscribers') || pathname.startsWith('/kyc-review') || pathname.startsWith('/leads') || pathname.startsWith('/installation-orders')) open('Clients');
    if (pathname.startsWith('/billing') || pathname.startsWith('/payments') || pathname.startsWith('/collections')) open('Billing');
    if (pathname.startsWith('/resellers')) {
      if (isReseller) { open('Reseller Portal'); open('Partner Finance'); open('Partner Operations'); open('Support'); }
      else { open('Resellers'); setOpenSub(s => ({ ...s, 'All Resellers': true })); }
    }
    if (pathname.startsWith('/routers') || pathname.startsWith('/bandwidth') || pathname.startsWith('/radius') || pathname.startsWith('/wireguard') || pathname.startsWith('/acs')) { open('Network'); setOpenSub(s => ({ ...s, 'Network & Routers': true })); }
    if (pathname.startsWith('/olts')) { open('OLT & Tools'); setOpenSub(s => ({ ...s, 'FTTH & OLTs': true })); }
    if (pathname.startsWith('/tickets') || pathname.startsWith('/messaging') || pathname.startsWith('/portal')) open('Support');
    if (pathname.startsWith('/finance') || pathname.startsWith('/hr') || pathname.startsWith('/procurement') || pathname.startsWith('/hotspot') || pathname.startsWith('/reports') || pathname.startsWith('/audit')) open('Finance & Ops');
    if (pathname.startsWith('/plugins')) { open('Plugins'); setOpenSub(s => ({ ...s, 'Payment Gateways': true })); }
    if (pathname.startsWith('/settings') || pathname.startsWith('/system')) open('System');
  }, [pathname, isReseller]);

  if (!user || !activeRole) return null;

  const toggleGroup = (label: string) => setOpenGroups(s => ({ ...s, [label]: !s[label] }));
  const toggleSub = (label: string) => setOpenSub(s => ({ ...s, [label]: !s[label] }));

  // Resellers only see their own portal, wallet/renew actions and their tickets.
  const resellerGroups: NavGroup[] = [
    {
      label: 'Reseller Portal',
      items: [
        { name: 'My Portal', href: '/resellers', icon: LayoutDashboard },
        { name: 'Users', href: '/resellers?tab=users', icon: Users },
        { name: 'Online Users', href: '/resellers?tab=sessions', icon: Activity },
        { name: 'ONU List', href: '/resellers?tab=onus', icon: Package },
        { name: 'Logs', href: '/resellers?tab=logs', icon: ScrollText },
        { name: 'Notifications', href: '/resellers?tab=notifications', icon: BellRing },
      ],
    },
    {
      label: 'Partner Finance',
      items: [
        { name: 'Balance Report', href: '/resellers?tab=balance', icon: Wallet },
        { name: 'Sharing Report', href: '/resellers?tab=sharing', icon: Landmark },
        { name: 'Billing Overview', href: '/resellers?tab=billing', icon: BarChart3 },
        { name: 'Invoice Payments', href: '/resellers?tab=invoice-payments', icon: CreditCard },
        { name: 'Online Payments', href: '/resellers?tab=online-payments', icon: CreditCard },
        { name: 'Wallet & Transactions', href: '/resellers/wallet', icon: Wallet },
      ],
    },
    {
      label: 'Partner Operations',
      items: [
        { name: 'Renew Subscriber', href: '/resellers/renew', icon: CreditCard },
        { name: 'Branches', href: '/resellers?tab=branches', icon: Building2 },
        { name: 'RADIUS Log', href: '/resellers?tab=radius-log', icon: Radio },
        { name: 'Login Log', href: '/resellers?tab=login-log', icon: ShieldCheck },
        { name: 'Complaints', href: '/resellers?tab=complaints', icon: AlertCircle },
        { name: 'Parental Control', href: '/resellers?tab=parental', icon: Ban },
      ],
    },
    {
      label: 'Support',
      items: [
        { name: 'My Tickets', href: '/tickets', icon: LifeBuoy },
      ],
    },
    {
      label: 'AI Copilot',
      items: [
        { name: 'AI Copilot', href: '/ai-assistant', icon: Sparkles, badge: 'AI' },
      ],
    },
  ];

  const sidebarGroups: NavGroup[] = [
    {
      label: 'Dashboard',
      items: [
        { name: 'Overview', href: '/', icon: LayoutDashboard },
        { name: 'Fiber GIS Map', href: '/gis', icon: MapPin, badge: 'GIS' },
        { name: 'Inventory & Serials', href: '/inventory', icon: Boxes },
      ],
    },
    {
      label: 'Clients',
      items: [
        { name: 'All Subscribers', href: '/subscribers', icon: Users, badge: 'All' },
        { name: 'KYC Review Queue', href: '/kyc-review', icon: ClipboardCheck, badge: 'KYC' },
        { name: 'Add Subscriber', href: '/subscribers?new=1', icon: UserPlus },
        { name: 'Live Sessions', href: '/subscribers/live', icon: Activity, badge: 'Live' },
        { name: 'Leads Pipeline', href: '/leads', icon: UsersRound },
        { name: 'Installation Orders', href: '/installation-orders', icon: Truck },
        { name: 'Expired Validity', href: '/subscribers?validity_expired=1', icon: Clock3 },
        { name: 'Suspended', href: '/subscribers?status=SUSPENDED', icon: UserX },
        { name: 'Pending / Inactive', href: '/subscribers?status=PENDING', icon: UserMinus },
      ],
    },
    {
      label: 'Billing',
      items: [
        { name: 'Billing & Invoices', href: '/billing', icon: CreditCard },
        { name: 'All Bills', href: '/billing/all', icon: Receipt },
        { name: 'Invoices', href: '/billing/invoices', icon: Receipt },
        { name: 'Payments', href: '/billing/payments', icon: Wallet },
        { name: 'Collections', href: '/collections', icon: Landmark },
        { name: 'Due Report', href: '/due-report', icon: BarChart3 },
        { name: 'Monthly Generate', href: '/billing/monthly-generate', icon: Receipt },
        { name: 'Adjust Bill', href: '/billing/adjust-bill', icon: CreditCard },
        { name: 'Auto Suspend', href: '/billing/auto-suspend', icon: UserX },
      ],
    },
    {
      label: 'Resellers',
      items: [
        {
          name: 'All Resellers', icon: Briefcase,
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
        { name: 'RADIUS & AAA', href: '/radius', icon: ShieldCheck },
        { name: 'WireGuard Overlay', href: '/wireguard', icon: Shield, badge: 'WG' },
        { name: 'ACS / TR-069', href: '/acs', icon: Wifi, badge: 'CWMP' },
        {
          name: 'Network & Routers', icon: Network,
          children: [
            { name: 'Overview', href: '/routers' },
            ...routers.map((r: any) => ({ name: r.name || r.host || 'Router', href: `/routers/${r.id}` })),
          ],
        },
      ],
    },
    {
      label: 'OLT & Tools',
      items: [
        {
          name: 'FTTH & OLTs', icon: Package,
          children: [
            { name: 'Overview', href: '/olts' },
            ...olts.map((o: any) => ({ name: o.name || o.host || 'OLT', href: `/olts/${o.id}` })),
          ],
        },
        { name: 'Walled Garden', href: '/walled-garden', icon: Shield },
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
      label: 'AI Copilot',
      items: [
        { name: 'AI Copilot', href: '/ai-assistant', icon: Sparkles, badge: 'AI' },
        { name: 'AI Copilot Settings', href: '/ai-settings', icon: Settings },
      ],
    },
    {
      label: 'Finance & Ops',
      items: [
        { name: 'Finance & Accounts', href: '/finance', icon: Landmark },
        { name: 'Reports & Analytics', href: '/reports', icon: BarChart3 },
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
          name: 'Payment Gateways', icon: Wallet,
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
        { name: 'System Health & Backup', href: '/system/health', icon: Server },
        { name: 'Settings & Security', href: '/settings', icon: Settings },
      ],
    },
  ];

  const groups = isReseller ? resellerGroups : sidebarGroups;

  return (
    <>
      <aside
        className={[
          'sidebar',
          'fixed inset-y-0 left-0 lg:sticky lg:top-0',
          'transition-transform duration-200',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 hidden lg:flex',
        ].join(' ')}
      >
        <div className="sidebar-brand">
          <Link href="/" className="brand-lockup" onClick={() => setMobileMenuOpen(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/izan-logo.svg" alt="Izan" className="brand-mark" />
            <span className="flex flex-col leading-none min-w-0">
              <span className="brand-name">Izan<em>Desk</em></span>
              <span className="brand-sub">ISP Operations Suite</span>
            </span>
          </Link>
          <button onClick={() => setMobileMenuOpen(false)} className="w-8 h-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 lg:hidden flex items-center justify-center" aria-label="Close menu"><X className="w-4 h-4" /></button>
        </div>

        <div className="sidebar-scroll">
          {groups.map((group) => (
            <div key={group.label} className="sidebar-section">
              <button onClick={() => toggleGroup(group.label)} className="sidebar-section-title">
                <span>{group.label}</span>
                {openGroups[group.label] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {openGroups[group.label] && (
                <div>
                  {group.items.map((item: any) => {
                    if (item.children?.length) {
                      const isOpen = !!openSub[item.name];
                      const subActive = item.children.some((c: any) => isItemActive(pathname, searchParams, c.href));
                      return (
                        <div key={item.name}>
                          <button onClick={() => toggleSub(item.name)} className={`sidebar-link ${subActive && !isOpen ? 'active' : ''}`}>
                            <span>{item.icon && <item.icon className="w-4 h-4" />}{item.name}</span>
                            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                          {isOpen && (
                            <div className="border-l border-border ml-4">
                              {item.children.map((c: any) => {
                                const active = isItemActive(pathname, searchParams, c.href);
                                return (
                                  <Link key={`${item.name}-${c.href}-${c.name}`} href={c.href} onClick={() => setMobileMenuOpen(false)} className={`sidebar-sublink ${active ? 'active' : ''}`}>
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
                      <Link key={item.name} href={item.href!} onClick={() => setMobileMenuOpen(false)} className={`sidebar-link ${active ? 'active' : ''}`}>
                        <span>{Icon && <Icon className="w-4 h-4" />}<span className="truncate">{item.name}</span></span>
                        {item.badge && <span className="sidebar-badge">{item.badge}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="rail-status">
            <span className="flex items-center gap-1.5 text-[#9db3aa]">
              <span className="status-dot online" /> System status
            </span>
            <span className="font-semibold text-[#8ff3c9]">Operational</span>
          </div>
          <div className="flex items-center gap-2 mt-2.5 px-0.5">
            <span className="w-6 h-6 rounded-full bg-white/[0.07] border border-white/10 text-[#cfe1d9] text-[10px] font-bold flex items-center justify-center shrink-0">
              {user.name.charAt(0)}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="text-[10px] text-[#7f958d]">Signed in as</div>
              <div className="text-[11px] font-semibold text-[#e3f0ea] truncate">{user.name}</div>
            </div>
          </div>
        </div>
      </aside>

      {isMobileMenuOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />}
    </>
  );
}
