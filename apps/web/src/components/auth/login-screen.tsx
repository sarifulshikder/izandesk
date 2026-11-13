'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ShieldCheck, LogIn, Radio, Sun, Moon } from 'lucide-react';

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
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await login(email, password);
    } catch (err: any) {
      setLocalError(err?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4 relative">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-4 right-4 p-2.5 rounded-xl border border-border bg-card hover:bg-muted text-foreground shadow-sm transition-colors"
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-500" />}
      </button>

      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <div className="hidden lg:flex flex-col justify-between rounded-3xl border border-border bg-gradient-to-br from-card via-card to-primary/10 p-8 shadow-xl text-foreground">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-primary to-secondary flex items-center justify-center text-white text-2xl font-black mb-4">I</div>
            <h1 className="text-3xl font-black tracking-tight">Izan<span className="text-primary">Desk</span> ERP</h1>
            <p className="text-muted-foreground mt-2 max-w-md">ISP Billing, Network Automation, Subscribers, Inventory & GIS — secure role-based access.</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm"><ShieldCheck className="w-4 h-4 text-primary" /> Role-based access for Admin, NOC, Billing, Technician, Reseller</div>
            <div className="flex items-center gap-2 text-sm"><Radio className="w-4 h-4 text-emerald-400" /> Live kernel & plugin status integration</div>
            <div className="text-xs text-muted-foreground">Secure sign-in required to access dashboard and modules.</div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card text-foreground p-6 sm:p-8 shadow-xl">
          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <h2 className="text-xl font-bold mb-1 text-foreground">Sign in to IzanDesk</h2>
              <p className="text-sm text-muted-foreground">Authenticate to access the NOC dashboard and role-based modules.</p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" className="mt-1 w-full px-3.5 py-2.5 rounded-xl bg-card border border-border focus:border-primary/50 outline-none text-sm text-foreground placeholder:text-muted-foreground" required />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" className="mt-1 w-full px-3.5 py-2.5 rounded-xl bg-card border border-border focus:border-primary/50 outline-none text-sm text-foreground placeholder:text-muted-foreground" required />
            </div>
            {(localError || error) && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{localError || error}</div>}
            <button disabled={submitting || loading} type="submit" className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-95 disabled:opacity-60">
              <LogIn className="w-4 h-4" /> {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Demo RBAC accounts</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {demoAccounts.map((acc) => (
                <button key={acc.email} type="button" onClick={() => { setEmail(acc.email); setPassword(acc.password); }} className="text-left p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-muted/50 transition-colors">
                  <div className="text-xs font-semibold text-foreground">{acc.label}</div>
                  <div className="text-[11px] text-muted-foreground font-mono break-all">{acc.email}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
