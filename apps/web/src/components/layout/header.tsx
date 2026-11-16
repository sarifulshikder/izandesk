'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { UserRole } from '@izandesk/shared-types';
import {
  Search, Moon, Sun, Bell, Command, ChevronDown, Radio, Menu,
  LogOut, User, ShieldCheck,
} from 'lucide-react';

export function Header() {
  const { user, activeRole, switchRole, theme, toggleTheme, setCommandPaletteOpen, toggleMobileMenu, logout } = useAuth();
  const [roleOpen, setRoleOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  if (!user || !activeRole) return null;

  const roles: { role: UserRole; label: string; desc: string }[] = [
    { role: 'SUPER_ADMIN', label: 'Super Admin', desc: 'Full ISP ownership & ledger' },
    { role: 'NOC_ENGINEER', label: 'NOC Engineer', desc: 'Routers, OLTs & AAA policies' },
    { role: 'BILLING_OPERATOR', label: 'Billing Operator', desc: 'Collections & invoices' },
    { role: 'TECHNICIAN', label: 'Field Technician', desc: 'Assigned tickets & optical' },
    { role: 'RESELLER', label: 'CyberNet Reseller', desc: 'Sub-ISP wholesale wallet' },
  ];

  return (
    <header className="topbar">
      <button onClick={toggleMobileMenu} className="topbar-icon-btn lg:hidden" aria-label="Open menu"><Menu className="w-4 h-4" /></button>

      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="topbar-search text-left"
        title="Search (Ctrl/⌘ + K)"
      >
        <Search className="w-4 h-4 shrink-0" />
        <span className="flex-1 truncate">Search subscribers, routers, invoices…</span>
        <span className="kbd hidden sm:inline-flex"><Command className="w-3 h-3" /> K</span>
      </button>

      <div className="flex-1" />

      <div className="hidden md:flex topbar-chip text-success">
        <span className="status-dot online" />
        <Radio className="w-3.5 h-3.5" />
        <span>System Online</span>
      </div>

      {/* Role switcher (RBAC preview) */}
      <div className="relative">
        <button onClick={() => { setRoleOpen(!roleOpen); setNotifOpen(false); setUserOpen(false); }} className="topbar-chip" title="Switch user role (RBAC)">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          <span className="hidden sm:inline">{roles.find((r) => r.role === activeRole)?.label}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
        {roleOpen && (
          <div className="dropdown-menu right-0 w-64">
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border mb-1">Switch perspective (RBAC)</div>
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
      </div>

      <button onClick={toggleTheme} className="topbar-icon-btn" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
        {theme === 'dark' ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="relative">
        <button onClick={() => { setNotifOpen(!notifOpen); setRoleOpen(false); setUserOpen(false); }} className="topbar-icon-btn relative" title="Notifications">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-danger" />
        </button>
        {notifOpen && (
          <div className="dropdown-menu right-0 w-80 p-2">
            <div className="px-1 pb-2 mb-1 border-b border-border text-xs font-semibold">Notifications</div>
            <div className="text-xs text-muted-foreground p-2 rounded bg-muted/60 border border-border">
              No new alerts. Live operational alerts appear here as monitoring integrations report events.
            </div>
          </div>
        )}
      </div>

      <div className="relative pl-2 border-l border-border">
        <button onClick={() => { setUserOpen(!userOpen); setRoleOpen(false); setNotifOpen(false); }} className="flex items-center gap-2">
          <span className="avatar avatar-primary avatar-sm">{user.name.charAt(0)}</span>
          <span className="hidden xl:flex flex-col text-left leading-tight">
            <span className="text-xs font-semibold">{user.name}</span>
            <span className="text-[10px] text-muted-foreground">{user.email}</span>
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground hidden sm:block" />
        </button>
        {userOpen && (
          <div className="dropdown-menu right-0 w-56">
            <div className="px-2 py-1.5 border-b border-border mb-1">
              <div className="text-xs font-semibold truncate">{user.name}</div>
              <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
            </div>
            <button className="dropdown-item"><User className="w-4 h-4 text-muted-foreground" />My profile</button>
            <button className="dropdown-item"><SettingsIcon />Settings</button>
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
