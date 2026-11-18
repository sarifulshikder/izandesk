'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { LoginResponse, UserRole, UserSession } from '@izandesk/shared-types';
import { apiFetch } from './api';

interface AuthContextType {
  user: UserSession | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  isMobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  toggleMobileMenu: () => void;
  // Phase 1 convenience: allow perspective preview while keeping authenticated identity
  activeRole: UserRole | null;
  switchRole: (role: UserRole) => void;
  can: (permission: string) => boolean;
}

const TOKEN_KEY = 'izandesk_token';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeRole, setActiveRole] = useState<UserRole | null>(null);

  useEffect(() => {
    const savedTheme = (typeof window !== 'undefined' && localStorage.getItem('izandesk_theme')) as 'dark' | 'light' | null;
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    if (typeof window !== 'undefined') localStorage.setItem('izandesk_theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const saved = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
        if (!saved) {
          setLoading(false);
          return;
        }
        setToken(saved);
        const res = await apiFetch<{ user: UserSession }>('/api/auth/me', {}, saved);
        setUser(res.user);
        setActiveRole(res.user.role);
      } catch {
        if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setActiveRole(null);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const login = async (email: string, password: string, remember = true) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      setUser(res.user);
      setActiveRole(res.user.role);
      if (typeof window !== 'undefined') {
        if (remember) localStorage.setItem(TOKEN_KEY, res.token);
        else localStorage.removeItem(TOKEN_KEY);
      }
    } catch (e: any) {
      setError(e?.message || 'Login failed');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setActiveRole(null);
    if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY);
  };

  const toggleTheme = () => setTheme((p) => (p === 'dark' ? 'light' : 'dark'));
  const toggleMobileMenu = () => setMobileMenuOpen((p) => !p);

  const can = (permission: string) => {
    if (!user) return false;
    return user.permissions.includes('ALL') || user.permissions.includes(permission);
  };

  const value = useMemo(() => ({
    user,
    token,
    loading,
    error,
    login,
    logout,
    theme,
    setTheme,
    toggleTheme,
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    isMobileMenuOpen,
    setMobileMenuOpen,
    toggleMobileMenu,
    activeRole,
    switchRole: (role: UserRole) => setActiveRole(role),
    can,
  }), [user, token, loading, error, theme, isCommandPaletteOpen, isMobileMenuOpen, activeRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
