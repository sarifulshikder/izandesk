'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { LogIn, User, Lock, Moon, Sun } from 'lucide-react';

const demoAccounts = [
  { email: 'admin@izandesk.com', password: 'admin123', label: 'Super Admin' },
  { email: 'noc@izandesk.com', password: 'noc123', label: 'NOC Engineer' },
  { email: 'billing@izandesk.com', password: 'billing123', label: 'Billing Operator' },
  { email: 'tech@izandesk.com', password: 'tech123', label: 'Technician' },
  { email: 'reseller@cybernet.bd', password: 'reseller123', label: 'Reseller' },
];

export function LoginScreen() {
  const { login, loading, error, theme, toggleTheme } = useAuth();
  const [email, setEmail] = useState('admin@izandesk.com');
  const [password, setPassword] = useState('admin123');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await login(email, password, remember);
    } catch (err: any) {
      setLocalError(err?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-4 relative">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-4 right-4 topbar-icon-btn border border-border bg-card"
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="w-full max-w-[420px]">
        <div className="card overflow-hidden">
          <div className="card-stamp">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/izan-watermark.svg" alt="" />
          </div>
          <div className="card-body p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-6">
              <span className="avatar avatar-lg avatar-primary">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/izan-logo.svg" alt="Izan" className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Admin</div>
                <h1 className="text-xl font-bold mb-0">Welcome back</h1>
                <p className="text-xs text-muted-foreground">Sign in to continue</p>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="form-label" htmlFor="login-username">Username</label>
                <div className="input-icon">
                  <User className="w-4 h-4" />
                  <input id="login-username" value={email} onChange={(e) => setEmail(e.target.value)} type="text" autoComplete="username" className="form-control" placeholder="Your username" required />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="form-label" htmlFor="login-password">Password</label>
                  <Link href="/forgot-password" className="text-[11px] text-primary hover:underline">Forgot password?</Link>
                </div>
                <div className="input-icon">
                  <Lock className="w-4 h-4" />
                  <input id="login-password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" className="form-control" placeholder="Your password" required />
                </div>
              </div>
              <label className="form-check cursor-pointer select-none">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember me
              </label>
              {(localError || error) && <div className="alert alert-danger">{localError || error}</div>}
              <button disabled={submitting || loading} type="submit" className="btn btn-primary w-full">
                <LogIn className="w-4 h-4" /> {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <div className="mt-4 text-center text-xs text-muted-foreground">
              Customer? <Link href="/portal" className="text-primary font-medium hover:underline">Open the portal</Link>
              <span className="mx-1.5">·</span>
              <Link href="/portal" className="text-primary font-medium hover:underline">Register</Link>
            </div>
          </div>
        </div>

        <div className="mt-4 card">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Demo accounts (click to fill)</span>
            <span className="badge badge-secondary">RBAC</span>
          </div>
          <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {demoAccounts.map((acc) => (
              <button key={acc.email} type="button" onClick={() => { setEmail(acc.email); setPassword(acc.password); }} className="text-left px-2.5 py-2 rounded border border-border hover:border-primary/40 hover:bg-muted/50 transition-colors">
                <div className="text-[11px] font-semibold text-foreground">{acc.label}</div>
                <div className="text-[10px] text-muted-foreground truncate">{acc.email}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="text-center text-[11px] text-muted-foreground mt-4">© 2026 IzanDesk ERP</div>
      </div>
    </div>
  );
}
