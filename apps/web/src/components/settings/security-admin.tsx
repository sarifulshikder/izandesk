'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Laptop, RefreshCw, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';

type MfaStatus = {
  enabled: boolean;
  required: boolean;
  enrolled: boolean;
  recovery_codes_remaining: number;
};

type StaffSession = {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked?: boolean;
};

export function SecurityAdmin({ token, isSuperAdmin }: { token: string | null; isSuperAdmin: boolean }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [sessions, setSessions] = useState<StaffSession[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [enrollPassword, setEnrollPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [stepCode, setStepCode] = useState('');
  const [stepReady, setStepReady] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [s, list] = await Promise.all([
        apiFetch<MfaStatus>('/api/auth/mfa/status', {}, token),
        apiFetch<{ data: StaffSession[] }>(`/api/auth/sessions${showAll && isSuperAdmin ? '?all=true' : ''}`, {}, token),
      ]);
      setStatus(s);
      setSessions(list.data || []);
      const stepUp = sessionStorage.getItem('izandesk_step_up');
      setStepReady(!!stepUp && Number(sessionStorage.getItem('izandesk_step_up_at') || 0) + 300_000 > Date.now());
    } catch (e: any) {
      setErr(e?.message || 'Could not load security status');
    }
  }, [token, showAll, isSuperAdmin]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); await load(); }
    catch (e: any) { setErr(e?.message || 'Request failed'); }
    finally { setBusy(false); }
  };

  const enroll = () => run(async () => {
    const r = await apiFetch<{ secret: string; otpauth_uri: string }>('/api/auth/mfa/enroll', {
      method: 'POST', body: JSON.stringify({ password: enrollPassword }),
    }, token);
    setEnrollment(r);
    setRecoveryCodes([]);
    setMsg('Scan the QR/secret with an authenticator app, then enter a code to confirm.');
  });

  const confirm = () => run(async () => {
    const r = await apiFetch<{ recovery_codes: string[] }>('/api/auth/mfa/confirm', {
      method: 'POST', body: JSON.stringify({ code: confirmCode }),
    }, token);
    setRecoveryCodes(r.recovery_codes || []);
    setEnrollment(null);
    setConfirmCode('');
    setMsg('TOTP enabled. Save the one-time recovery codes below.');
  });

  const disable = () => run(async () => {
    await apiFetch('/api/auth/mfa/disable', {
      method: 'POST', body: JSON.stringify({ password: disablePassword, code: disableCode }),
    }, token);
    setDisablePassword(''); setDisableCode(''); setRecoveryCodes([]);
    setMsg('TOTP disabled.');
  });

  const stepUp = () => run(async () => {
    const r = await apiFetch<{ step_up_token: string }>('/api/auth/mfa/step-up', {
      method: 'POST', body: JSON.stringify({ code: stepCode }),
    }, token);
    sessionStorage.setItem('izandesk_step_up', r.step_up_token);
    sessionStorage.setItem('izandesk_step_up_at', String(Date.now()));
    setStepCode('');
    setStepReady(true);
    setMsg('Step-up verified for 5 minutes. Sensitive MCP key changes are now allowed.');
  });

  const revoke = (sessionId: string | null) => run(async () => {
    const payload = sessionId ? { session_id: sessionId } : { all: true };
    const label = sessionId ? 'session' : 'all other sessions';
    if (!sessionId && !window.confirm('Sign out every active session for your account?')) return;
    const r = await apiFetch<{ revoked: number }>('/api/auth/sessions/revoke', {
      method: 'POST', body: JSON.stringify(payload),
    }, token);
    setMsg(`Revoked ${r.revoked} ${label}.`);
  });

  return (
    <div className="space-y-4" data-testid="security-admin">
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Multi-factor authentication
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {status?.enabled ? 'TOTP is protecting this account.' : status?.required ? 'TOTP is required by policy — enroll now.' : 'Add an authenticator app for stronger account protection.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${status?.enabled ? 'badge-success' : 'badge-secondary'}`}>{status?.enabled ? 'Enabled' : 'Not enabled'}</span>
            {status?.required && <span className="badge badge-warning">Required by policy</span>}
            <button onClick={() => void load()} disabled={busy} className="btn btn-outline btn-sm"><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
          </div>
        </div>

        {err && <div className="alert alert-danger">{err}</div>}
        {msg && <div className="alert alert-success">{msg}</div>}

        {!status?.enabled && !enrollment && (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
            <div>
              <label className="form-label">Current password</label>
              <input type="password" className="form-control" value={enrollPassword} onChange={(e) => setEnrollPassword(e.target.value)} placeholder="Required to enroll" />
            </div>
            <button onClick={() => void enroll()} disabled={busy || !enrollPassword} className="btn btn-primary"><Smartphone className="w-4 h-4" />Start TOTP enrollment</button>
          </div>
        )}

        {enrollment && (
          <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-3">
            <div className="text-[11px] font-semibold">1. Add this secret to Google Authenticator, 1Password or Authy</div>
            <code className="block text-[13px] font-mono tracking-[0.18em] select-all break-all">{enrollment.secret}</code>
            <a href={enrollment.otpauth_uri} className="text-[11px] text-primary underline underline-offset-2">Open otpauth:// enrollment link</a>
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
              <div>
                <label className="form-label">2. Enter the 6-digit code</label>
                <input className="form-control font-mono tracking-[0.3em]" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} placeholder="000000" inputMode="numeric" />
              </div>
              <button onClick={() => void confirm()} disabled={busy || confirmCode.length < 6} className="btn btn-primary"><KeyRound className="w-4 h-4" />Confirm enrollment</button>
            </div>
          </div>
        )}

        {recoveryCodes.length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
            <div className="text-[11px] font-bold mb-2">One-time recovery codes — save these now</div>
            <div className="grid grid-cols-2 gap-1.5">{recoveryCodes.map((c) => <code key={c} className="text-[12px] font-mono">{c}</code>)}</div>
          </div>
        )}

        {status?.enabled && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border p-3 space-y-2">
              <div className="text-[11px] font-bold flex items-center gap-2"><KeyRound className="w-3.5 h-3.5" />Fresh verification (step-up)</div>
              <p className="text-[10.5px] text-muted-foreground">Required for sensitive admin actions such as MCP key changes.</p>
              <div className="flex gap-2">
                <input className="form-control font-mono tracking-[0.3em]" value={stepCode} onChange={(e) => setStepCode(e.target.value)} placeholder="000000" inputMode="numeric" />
                <button onClick={() => void stepUp()} disabled={busy || stepCode.length < 6} className="btn btn-outline">Verify</button>
              </div>
              {stepReady && <span className="badge badge-success">Step-up active (5 min)</span>}
            </div>
            <div className="rounded-xl border border-border p-3 space-y-2">
              <div className="text-[11px] font-bold flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5" />Disable TOTP</div>
              <p className="text-[10.5px] text-muted-foreground">{status.recovery_codes_remaining} recovery code(s) remaining.</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="password" className="form-control" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} placeholder="Password" />
                <input className="form-control font-mono tracking-[0.3em]" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="Code" inputMode="numeric" />
              </div>
              <button onClick={() => void disable()} disabled={busy || !disablePassword || disableCode.length < 6} className="btn btn-danger btn-sm">Disable TOTP</button>
            </div>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2">
              <Laptop className="w-4 h-4" /> Active sessions
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Revoke a device immediately, or sign out every session at once.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSuperAdmin && (
              <label className="form-check text-[11px]">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                Show all users
              </label>
            )}
            <button onClick={() => void revoke(null)} disabled={busy} className="btn btn-danger btn-sm"><Trash2 className="w-3.5 h-3.5" />Log out all devices</button>
          </div>
        </div>
        <div className="table-wrap overflow-auto max-h-[280px]">
          <table className="table table-hover min-w-[640px]">
            <thead className="sticky top-0 z-10"><tr className="border-b border-border">
              <th className="px-3 py-2.5">User</th><th className="px-3 py-2.5">IP address</th><th className="px-3 py-2.5">Device</th><th className="px-3 py-2.5">Last seen</th><th className="px-3 py-2.5">Action</th>
            </tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-border/50">
                  <td className="px-3 py-2.5 text-[11px] font-mono">{s.user_id}</td>
                  <td className="px-3 py-2.5 text-[11px]">{s.ip_address || '-'}</td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground max-w-[220px] truncate" title={s.user_agent || ''}>{s.user_agent || '-'}</td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2.5 text-[11px]"><button onClick={() => void revoke(s.id)} disabled={busy || !!s.revoked} className="btn btn-outline btn-sm">Revoke</button></td>
                </tr>
              ))}
              {!sessions.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-[11px] text-muted-foreground">No active sessions found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
