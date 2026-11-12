'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserRole, UserSession } from '@izandesk/shared-types';

interface AuthContextType {
  user: UserSession;
  activeRole: UserRole;
  switchRole: (role: UserRole) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

const mockUsers: Record<UserRole, UserSession> = {
  SUPER_ADMIN: {
    id: 'usr-admin-01',
    name: 'Izan Rahman (CEO)',
    email: 'admin@izandesk.com',
    role: 'SUPER_ADMIN',
    tenantId: 'tnt-primary-01',
    permissions: ['ALL'],
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
  },
  NOC_ENGINEER: {
    id: 'usr-noc-02',
    name: 'Tariqul Islam (NOC Lead)',
    email: 'noc@izandesk.com',
    role: 'NOC_ENGINEER',
    tenantId: 'tnt-primary-01',
    permissions: ['ROUTERS_READ', 'ROUTERS_WRITE', 'OLT_READ', 'SUBSCRIBERS_KICK'],
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80',
  },
  BILLING_OPERATOR: {
    id: 'usr-bill-03',
    name: 'Sadia Akhter (Accounts)',
    email: 'billing@izandesk.com',
    role: 'BILLING_OPERATOR',
    tenantId: 'tnt-primary-01',
    permissions: ['INVOICES_READ', 'PAYMENTS_CREATE', 'BILLS_ADJUST'],
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80',
  },
  TECHNICIAN: {
    id: 'usr-tech-04',
    name: 'Kamrul Hasan (Field Lead)',
    email: 'tech@izandesk.com',
    role: 'TECHNICIAN',
    tenantId: 'tnt-primary-01',
    permissions: ['TICKETS_ASSIGNED', 'OPTICAL_READ', 'CLIENTS_READ'],
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80',
  },
  RESELLER: {
    id: 'usr-reseller-05',
    name: 'Shahriar Kabir (CyberNet Reseller)',
    email: 'reseller@cybernet.bd',
    role: 'RESELLER',
    tenantId: 'tnt-primary-01',
    resellerId: 'res-cybernet-01',
    permissions: ['RESELLER_CLIENTS_ALL', 'WALLET_RECHARGE'],
    avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&auto=format&fit=crop&q=80',
  },
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [activeRole, setActiveRole] = useState<UserRole>('SUPER_ADMIN');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    // Sync with html class for tailwind dark mode
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, [theme]);

  // Global Cmd+K keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const switchRole = (role: UserRole) => {
    setActiveRole(role);
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <AuthContext.Provider
      value={{
        user: mockUsers[activeRole],
        activeRole,
        switchRole,
        theme,
        toggleTheme,
        isCommandPaletteOpen,
        setCommandPaletteOpen,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
