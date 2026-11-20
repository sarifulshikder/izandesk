'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { UserRole } from '@izandesk/shared-types';
import {
  Search, Moon, Sun, Bell, Command, ChevronDown, Menu,
  LogOut, User, ShieldCheck,
} from 'lucide-react';

const PAGE_LABELS: Record<string, string> = {
  '': 'Command Center',
  subscribers: 'Subscribers',
  leads: 'Leads Pipeline',
  'installation-orders': 'Installation Orders',
  billing: 'Billing & Invoices',
  collections: 'Collections',
  payments: 'Payments',
  'due-report': 'Due Report',
  resellers: 'Resellers',
  routers: 'Network & Routers',
  bandwidth: 'Bandwidth & QoS',
  radius: 'RADIUS & AAA',
  wireguard: 'WireGuard Overlay',
  acs: 'ACS / TR-069',
  olts: 'FTTH & OLTs',
  gis: 'Fiber GIS',
  inventory: 'Inventory & Serials',
  tickets: 'CRM & Tickets',
  messaging: 'Omnichannel Messaging',
  finance: 'Finance & Accounts',
  reports: 'Reports & Analytics',
  hr: 'HR & Payroll',
  procurement: 'Procurement & Assets',
  hotspot: 'Hotspot Vouchers',
  audit: 'Audit & Field Ops',
  plugins: 'Plugin Manager',
  settings: 'Settings & Security',
  system: 'System Health',
  'ai-assistant': 'AI Copilot',
  'ai-settings': 'AI Copilot Settings',
  portal: 'Customer Portal',
  'walled-garden': 'Walled Garden',
  'client-locations': 'Client Locations',
  accounts: 'Accounts',
  'all-info': 'All Client Info',
};

function titleCase(s: string) {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Header() {
  const { user, token, activeRole, switchRole, theme, toggleTheme, setCommandPaletteOpen, toggleMobileMenu, logout } = useAuth();
  const [roleOpen, setRoleOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const isReseller = user?.role === 'RESELLER';
  useEffect(() => {
    if (!isReseller || !token) return;
    let alive = true;
    const load = async () => { try { const r = await apiFetch<any>('/api/resellers/me/notification-log?unread=1', {}, token).catch(()=>null); if (alive && r) { setNotifications(r.data || []); setUnread(r.unread || 0); } } catch {} };
    load(); const t = setInterval(load, 60000); return () => { alive = false; clearInterval(t); };
  }, [isReseller, token]);
  if (!user || !activeRole) return null;

  const roles: { role: UserRole; label: string; desc: string }[] = [
    { role: 'SUPER_ADMIN', label: 'Super Admin', desc: 'Full ISP ownership & ledger' },
    { role: 'NOC_ENGINEER', label: 'NOC Engineer', desc: 'Routers, OLTs & AAA policies' },
    { role: 'BILLING_OPERATOR', label: 'Billing Operator', desc: 'Collections & invoices' },
    { role: 'TECHNICIAN', label: 'Field Technician', desc: 'Assigned tickets & optical' },
    { role: 'RESELLER', label: 'CyberNet Reseller', desc: 'Sub-ISP wholesale wallet' },
  ];

  const seg = (pathname || '/').split('/').filter(Boolean);
  const pageTitle = PAGE_LABELS[seg[0] || ''] || (seg[0] ? titleCase(seg[0]) : 'Command Center');
  const crumbTail = seg.length > 1 ? (PAGE_LABELS[seg[1]] || titleCase(seg[1])) : null;

  return (
    <header className="topbar">
      <button onClick={toggleMobileMenu} className="topbar-icon-btn lg:hidden shrink-0" aria-label="Open menu"><Menu className="w-4 h-4" /></button>

      <div className="topbar-crumb hidden md:block shrink-0 max-w-[220px]">
        <div className="topbar-crumb-label">IzanDesk · Operations</div>
        <div className="topbar-crumb-title">{pageTitle}{crumbTail ? <span className="text-muted-foreground font-medium"> / {crumbTail}</span> : null}</div>
      </div>

      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="topbar-search text-left"
        title="Search (Ctrl/⌘ + K)"
      >
        <Search className="w-4 h-4 shrink-0" />
        <span className="flex-1 truncate">Search subscribers, routers, invoices…</span>
        <span className="kbd hidden sm:inline-flex"><Command className="w-2.5 h-2.5" /> K</span>
      </button>

      <div className="flex-1" />

      <span className="hidden 2xl:inline-flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.13em] text-muted-foreground shrink-0">
        <span className="status-dot online" /> Live
      </span>

      {/* Role switcher (RBAC preview) — admins only; resellers must not see admin role options */}
      {user?.role !== 'RESELLER' && <div className="relative shrink-0">
        <button onClick={() => { setRoleOpen(!roleOpen); setNotifOpen(false); setUserOpen(false); }} className="topbar-chip" title="Switch user role (RBAC)">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          <span className="hidden sm:inline">{roles.find((r) => r.role === activeRole)?.label}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
        {roleOpen && (
          <div className="dropdown-menu right-0 w-64">
            <div className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground border-b border-border mb-1.5">Switch perspective (RBAC)</div>
            {roles.map((r) => (
              <button
                key={r.role}
                onClick={() => { switchRole(r.role); setRoleOpen(false); }}
                className={`dropdown-item flex-col items-start gap-0 ${activeRole === r.role ? 'active' : ''}`}
              >
                <span className="font-semibold">{r.label}</span>
                <span className="text-[10px] text-muted-foreground font-normal">{r.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>}

      <button onClick={toggleTheme} className="topbar-icon-btn shrink-0" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
        {theme === 'dark' ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="relative shrink-0">
        <button onClick={() => { setNotifOpen(!notifOpen); setRoleOpen(false); setUserOpen(false); }} className="topbar-icon-btn relative" title="Notifications">
          <Bell className="w-4 h-4" />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center px-1 ring-2 ring-[var(--card)]">{unread}</span>}
        </button>
        {notifOpen && (
          <div className="dropdown-menu right-0 w-80 p-2">
            <div className="px-1.5 pb-2 mb-1.5 border-b border-border text-xs font-semibold flex items-center justify-between">Notifications {isReseller && <button onClick={()=>{ setNotifOpen(false); router.push('/resellers?tab=notifications'); }} className="text-primary text-[11px]">View log →</button>}</div>
            {isReseller && notifications.length ? notifications.slice(0,6).map(n => (
              <div key={n.id} className={`px-2 py-1.5 rounded-lg mb-1 ${n.is_read ? '' : 'bg-primary/5'}`}>
                <div className="text-xs font-semibold truncate">{n.title}</div>
                <div className="text-[11px] text-muted-foreground truncate">{n.message}</div>
              </div>
            )) : <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50 border border-border leading-relaxed">No new alerts. Live operational alerts appear here as they are generated.</div>}
          </div>
        )}
      </div>

      <div className="relative pl-2.5 border-l border-border shrink-0">
        <button onClick={() => { setUserOpen(!userOpen); setRoleOpen(false); setNotifOpen(false); }} className="flex items-center gap-2.5 group">
          <span className="avatar avatar-primary avatar-sm">{user.name.charAt(0)}</span>
          <span className="hidden xl:flex flex-col text-left leading-tight">
            <span className="text-[11.5px] font-bold">{user.name}</span>
            <span className="text-[9.5px] text-muted-foreground">{user.email}</span>
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground hidden sm:block group-hover:text-foreground transition-colors" />
        </button>
        {userOpen && (
          <div className="dropdown-menu right-0 w-56">
            <div className="px-2 py-1.5 border-b border-border mb-1.5">
              <div className="text-xs font-semibold truncate">{user.name}</div>
              <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
            </div>
            <button onClick={()=>{ setUserOpen(false); router.push(isReseller ? '/resellers?tab=dashboard' : '/settings'); }} className="dropdown-item"><User className="w-4 h-4 text-muted-foreground" />My profile</button>
            <button onClick={()=>{ setUserOpen(false); router.push(isReseller ? '/resellers?tab=notifications' : '/settings'); }} className="dropdown-item"><SettingsIcon />Settings</button>
            <div className="divider my-1" />
            <button onClick={logout} className="dropdown-item text-danger"><LogOut className="w-4 h-4" />Logout</button>
          </div>
        )}
      </div>
    </header>
  );
}

function SettingsIcon() {
  return (
    <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 0 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 0 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z" />
    </svg>
  );
}
