'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import {
  LogIn, User, Lock, Moon, Sun, ShieldCheck, Activity, RadioTower, Sparkles,
  ArrowUpRight, CheckCircle2, Network,
} from 'lucide-react';

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
    <div className="auth-shell">
      {/* ── Brand / story panel ─────────────────────────────────────────── */}
      <aside className="auth-brand">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/izan-logo.svg" alt="Izan" className="w-10 h-10 rounded-xl shadow-[0_0_0_1px_rgba(255,255,255,.1),0_12px_30px_-12px_rgba(74,227,172,.55)]" />
            <div className="leading-none">
              <div className="text-[17px] font-extrabold tracking-tight text-white">Izan<span className="text-[#8ff3c9]">Desk</span></div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#7f9c90] mt-1">ISP Operations Suite</div>
            </div>
          </Link>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.04] text-[9px] font-bold uppercase tracking-[0.12em] text-[#a4bdb3]">
            <span className="status-dot online" /> Enterprise
          </span>
        </div>

        <div className="max-w-xl py-10">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.04] text-[9px] font-bold uppercase tracking-[0.16em] text-[#8ff3c9] mb-6">
            <Sparkles className="w-3 h-3" /> Built for modern fiber operators
          </div>
          <h1 className="auth-title">The <em>calm</em> control room for modern ISPs.</h1>
          <p className="auth-lede mt-5">
            Subscribers, billing, optical telemetry and field operations in one considered
            workspace. Less noise, faster decisions, happier customers.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-8 max-w-lg">
            <div className="auth-feature">
              <RadioTower className="w-4 h-4" />
              <div><div className="auth-feature-title">Optical intelligence</div><div className="auth-feature-desc">OLT & ONU telemetry with real-time optical health.</div></div>
            </div>
            <div className="auth-feature">
              <Activity className="w-4 h-4" />
              <div><div className="auth-feature-title">Revenue pulse</div><div className="auth-feature-desc">Collections and dues that update while you watch.</div></div>
            </div>
            <div className="auth-feature">
              <Network className="w-4 h-4" />
              <div><div className="auth-feature-title">Network command</div><div className="auth-feature-desc">MikroTik, RADIUS and WireGuard in one fabric.</div></div>
            </div>
            <div className="auth-feature">
              <ShieldCheck className="w-4 h-4" />
              <div><div className="auth-feature-title">Role-aware access</div><div className="auth-feature-desc">Every team sees exactly what they need.</div></div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-white/10 pt-5">
          <div className="flex items-center gap-7">
            {[['565+', 'Built-in capabilities'], ['18', 'Telecom domains'], ['<2s', 'Auto-reactivation']].map(([v, l]) => (
              <div key={l}>
                <div className="text-lg font-bold tracking-tight text-white tabular-nums">{v}</div>
                <div className="text-[9px] uppercase tracking-[0.12em] text-[#7f9c90] font-semibold mt-0.5">{l}</div>
              </div>
            ))}
          </div>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-[#7f9c90]">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#4ae3ac]" /> All systems operational
          </span>
        </div>
      </aside>

      {/* ── Form panel ───────────────────────────────────────────────────── */}
      <main className="auth-form-side relative">
        <button
          type="button"
          onClick={toggleTheme}
          className="topbar-icon-btn border border-border bg-card absolute top-5 right-5 shadow-sm"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="w-full max-w-[430px]">
          {/* compact mobile brand */}
          <div className="flex lg:hidden items-center justify-center gap-2.5 mb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/izan-logo.svg" alt="Izan" className="w-9 h-9 rounded-xl" />
            <div className="leading-none">
              <div className="text-[16px] font-extrabold tracking-tight">Izan<span className="text-primary">Desk</span></div>
              <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mt-1">ISP Operations Suite</div>
            </div>
          </div>

          <div className="auth-card">
            <div className="mb-6">
              <div className="page-eyebrow mb-2"><span className="w-1.5 h-1.5 rounded-full bg-primary" /> Secure access</div>
              <h2 className="text-[1.55rem] font-bold tracking-[-0.035em] leading-tight">Welcome back</h2>
              <p className="text-[12px] text-muted-foreground mt-1.5">Sign in to your IzanDesk operations workspace.</p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="form-label" htmlFor="login-username">Username or email</label>
                <div className="input-icon">
                  <User />
                  <input id="login-username" value={email} onChange={(e) => setEmail(e.target.value)} type="text" autoComplete="username" className="form-control" placeholder="you@company.com" required />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="form-label" htmlFor="login-password">Password</label>
                  <Link href="/forgot-password" className="text-[10.5px] text-primary font-semibold hover:underline underline-offset-2">Forgot password?</Link>
                </div>
                <div className="input-icon">
                  <Lock />
                  <input id="login-password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" className="form-control" placeholder="Your password" required />
                </div>
              </div>
              <label className="form-check cursor-pointer select-none">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Keep me signed in on this device
              </label>
              {(localError || error) && <div className="alert alert-danger">{localError || error}</div>}
              <button disabled={submitting || loading} type="submit" className="btn btn-primary w-full !h-[42px]">
                <LogIn className="w-4 h-4" /> {submitting ? 'Signing in…' : 'Sign in to workspace'}
              </button>
            </form>

            <div className="mt-5 pt-4 border-t border-border flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              Customer? <Link href="/portal" className="text-primary font-semibold hover:underline underline-offset-2 inline-flex items-center gap-0.5">Open the self-care portal <ArrowUpRight className="w-3 h-3" /></Link>
            </div>
          </div>

          <div className="mt-3.5 card overflow-hidden">
            <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-border">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Demo accounts · click to fill</span>
              <span className="badge badge-secondary">RBAC</span>
            </div>
            <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => { setEmail(acc.email); setPassword(acc.password); }}
                  className="text-left px-2.5 py-2 rounded-lg border border-transparent hover:border-border hover:bg-muted/60 transition-colors group"
                >
                  <div className="text-[11px] font-semibold text-foreground group-hover:text-primary transition-colors">{acc.label}</div>
                  <div className="text-[9.5px] text-muted-foreground truncate">{acc.email}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-[9.5px] text-muted-foreground mt-4 px-1">
            <span>© 2026 IzanDesk ERP</span>
            <span className="font-mono">v1.0 · optical</span>
          </div>
        </div>
      </main>
    </div>
  );
}
