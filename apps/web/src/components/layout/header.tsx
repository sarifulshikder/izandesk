'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { UserRole } from '@izandesk/shared-types';
import {
  Search,
  Moon,
  Sun,
  Bell,
  Command,
  UserCheck,
  ChevronDown,
  Radio,
  Menu,
  LogOut,
} from 'lucide-react';

export function Header() {
  const { user, activeRole, switchRole, theme, toggleTheme, setCommandPaletteOpen, toggleMobileMenu, logout } = useAuth();
  if (!user || !activeRole) return null;
  const [isRoleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [isNotificationOpen, setNotificationOpen] = useState(false);

  const roles: { role: UserRole; label: string; desc: string }[] = [
    { role: 'SUPER_ADMIN', label: 'Super Admin', desc: 'Full ISP ownership & ledger' },
    { role: 'NOC_ENGINEER', label: 'NOC Engineer', desc: 'Routers, OLTs & AAA policies' },
    { role: 'BILLING_OPERATOR', label: 'Billing Operator', desc: 'Collections & invoices' },
    { role: 'TECHNICIAN', label: 'Field Technician', desc: 'Assigned tickets & optical' },
    { role: 'RESELLER', label: 'CyberNet Reseller', desc: 'Sub-ISP wholesale wallet' },
  ];

  return (
    <header className="sticky top-0 z-20 w-full border-b border-border bg-card/80 dark:bg-card/60 backdrop-blur-md px-3 sm:px-4 lg:px-8 py-2.5 sm:py-3.5">
      <div className="flex items-center justify-between gap-2 sm:gap-4 flex-wrap sm:flex-nowrap">
      {/* Hamburger — mobile only */}
      <button
        onClick={toggleMobileMenu}
        className="lg:hidden p-2 rounded-xl text-foreground/80 hover:text-foreground bg-muted/50 hover:bg-muted border border-border transition-all shrink-0"
        aria-label="Open menu"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Search & Command Palette Trigger */}
      <div className="flex items-center gap-3 flex-1 min-w-[140px] max-w-md order-last sm:order-none w-full sm:w-auto">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-foreground/70 dark:text-muted-foreground bg-muted/60 border border-border rounded-xl hover:border-primary/50 hover:bg-muted transition-all group shadow-sm"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Search className="w-4 h-4 text-foreground/60 dark:text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            <span className="truncate">Search subscribers, routers, invoices...</span>
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-1 font-mono text-[10px] font-semibold bg-background px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0 ml-2">
            <Command className="w-3 h-3" /> K
          </kbd>
        </button>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0 ml-auto sm:ml-0">
        {/* Network/AAA status indicator */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <Radio className="w-3.5 h-3.5" />
          <span>System Online</span>
        </div>

        {/* Role Switcher Dropdown (Allows testing all roles in Phase 1) */}
        <div className="relative">
          <button
            onClick={() => setRoleDropdownOpen(!isRoleDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-xl bg-muted/80 border border-border hover:border-primary/40 transition-all text-foreground"
            title="Switch User Role"
          >
            <UserCheck className="w-3.5 h-3.5 text-primary" />
            <span className="hidden sm:inline-block font-semibold">{roles.find((r) => r.role === activeRole)?.label}</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>

          {isRoleDropdownOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-card border border-border shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3 py-2 text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/50">
                Switch Perspective (RBAC)
              </div>
              <div className="py-1 space-y-1">
                {roles.map((r) => (
                  <button
                    key={r.role}
                    onClick={() => {
                      switchRole(r.role);
                      setRoleDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex flex-col ${
                      activeRole === r.role
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <span className="font-semibold">{r.label}</span>
                    <span className={`text-[10px] ${activeRole === r.role ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {r.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          className="p-2 rounded-xl text-muted-foreground hover:text-red-400 bg-muted/50 hover:bg-red-500/10 border border-border hover:border-red-500/30 transition-all"
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
        </button>

        {/* Theme Switcher */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-xl text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-border transition-all"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-500" />}
        </button>

        {/* Notifications Bell */}
        <div className="relative">
          <button
            onClick={() => setNotificationOpen(!isNotificationOpen)}
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-border transition-all relative"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
          </button>

          {isNotificationOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-card border border-border shadow-2xl p-3 z-50">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border text-xs font-semibold">
                <span>Notifications</span>
              </div>
              <div className="text-xs text-muted-foreground p-2 rounded-lg bg-muted/30 border border-border/60">
                No new alerts. Live operational alerts will appear here as monitoring integrations report events.
              </div>
            </div>
          )}
        </div>

        {/* User Profile Avatar */}
        <div className="flex items-center gap-2 pl-1 sm:pl-2 border-l border-border shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary to-secondary p-[2px] shadow-sm">
            <div className="w-full h-full rounded-[10px] bg-card flex items-center justify-center font-bold text-xs text-primary">
              {user.name.charAt(0)}
            </div>
          </div>
          <div className="hidden xl:block text-left">
            <div className="text-xs font-semibold leading-tight text-foreground">{user.name}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">{user.email}</div>
          </div>
        </div>
      </div>
      </div>
    </header>
  );
}
