'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LoginResponse, UserRole, UserSession } from '@izandesk/shared-types';
import { apiFetch } from './api';

interface AuthContextType {
  user: UserSession | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  mfaRequired: boolean;
  mfaToken: string | null;
  mfaEnrollmentRequired: boolean;
  mfaEnrollment: { secret: string; otpauth_uri: string } | null;
  verifyMfa: (code: string) => Promise<void>;
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
  const rememberRef = useRef(true);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false);
  const [mfaEnrollment, setMfaEnrollment] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  // Read the saved theme during the first render: an effect read raced with the
  // mount write of the stale 'light' value (StrictMode re-ran the read after
  // localStorage had already been overwritten), so a saved 'dark' reverted to
  // light on refresh. With lazy init, state, document classes and
  // localStorage all start from the same value.
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('izandesk_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return 'light';
  });
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeRole, setActiveRole] = useState<UserRole | null>(null);

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

  const applySession = (nextToken: string, nextUser: UserSession, remember: boolean) => {
    setToken(nextToken);
    setUser(nextUser);
    setActiveRole(nextUser.role);
    setMfaRequired(false);
    setMfaToken(null);
    setMfaEnrollmentRequired(false);
    setMfaEnrollment(null);
    if (typeof window !== 'undefined') {
      if (remember) localStorage.setItem(TOKEN_KEY, nextToken);
      else localStorage.removeItem(TOKEN_KEY);
    }
  };

  const login = async (email: string, password: string, remember = true) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<LoginResponse & { mfa_required?: boolean; mfa_token?: string; mfa_enrollment_required?: boolean }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (res.mfa_required) {
        rememberRef.current = remember;
        setMfaToken(res.mfa_token || null);
        setMfaRequired(true);
        if (res.mfa_enrollment_required && res.mfa_token) {
          setMfaEnrollmentRequired(true);
          const enrollment = await apiFetch<{ secret: string; otpauth_uri: string }>('/api/auth/mfa/enroll', {
            method: 'POST',
            body: JSON.stringify({ password }),
          }, res.mfa_token);
          setMfaEnrollment({ secret: enrollment.secret, otpauth_uri: enrollment.otpauth_uri });
        } else {
          setMfaEnrollmentRequired(false);
          setMfaEnrollment(null);
        }
        return;
      }
      applySession(res.token, res.user, remember);
    } catch (e: any) {
      setError(e?.message || 'Login failed');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const verifyMfa = async (code: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<LoginResponse>(mfaEnrollmentRequired ? '/api/auth/mfa/confirm' : '/api/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ mfa_token: mfaToken, code }),
      }, mfaEnrollmentRequired ? mfaToken : undefined);
      applySession(res.token, res.user, rememberRef.current);
    } catch (e: any) {
      setError(e?.message || 'Verification failed');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    if (token) void apiFetch('/api/auth/logout', { method: 'POST' }, token).catch(() => {});
    setUser(null);
    setToken(null);
    setActiveRole(null);
    setMfaRequired(false);
    setMfaToken(null);
    setMfaEnrollmentRequired(false);
    setMfaEnrollment(null);
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
    mfaRequired,
    mfaToken,
    mfaEnrollmentRequired,
    mfaEnrollment,
    verifyMfa,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- functions are stable in this context shape
  }), [user, token, loading, error, mfaRequired, mfaToken, mfaEnrollmentRequired, mfaEnrollment, theme, isCommandPaletteOpen, isMobileMenuOpen, activeRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
