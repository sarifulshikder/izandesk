'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw, Shield, Trash2, UserCheck, UserX, Users } from 'lucide-react';
import { apiFetch } from '@/lib/api';

type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'NOC_ENGINEER' | 'BILLING_OPERATOR' | 'TECHNICIAN' | 'RESELLER';
  reseller_id?: string | null;
  is_active: boolean;
  mfa_enabled?: boolean;
  active_sessions?: number;
  last_login_at?: string | null;
  is_demo?: boolean;
};

const ROLES = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'NOC_ENGINEER', label: 'NOC Engineer' },
  { value: 'BILLING_OPERATOR', label: 'Billing Operator' },
  { value: 'TECHNICIAN', label: 'Technician' },
  { value: 'RESELLER', label: 'Reseller' },
] as const;

export function StaffAdmin({ token, currentUserId }: { token: string | null; currentUserId?: string }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'NOC_ENGINEER', reseller_id: '' });
  const [resetTarget, setResetTarget] = useState<StaffRow | null>(null);
  const [resetPw, setResetPw] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await apiFetch<{ data: StaffRow[] }>('/api/staff', {}, token);
      setRows(r.data || []);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load staff users');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const createStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await apiFetch('/api/staff', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          ...(form.role === 'RESELLER' && form.reseller_id ? { reseller_id: form.reseller_id } : {}),
        }),
      }, token);
      setForm({ name: '', email: '', password: '', role: 'NOC_ENGINEER', reseller_id: '' });
      setMsg('Staff operator created.');
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Failed to create staff user');
    } finally {
      setBusy(false);
    }
  };

  const patchStaff = async (row: StaffRow, patch: Record<string, any>, label: string) => {
    if (!token) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await apiFetch(`/api/staff/${row.id}`, { method: 'PUT', body: JSON.stringify(patch) }, token);
      setMsg(`${label} (${row.email}).`);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const submitResetPassword = async () => {
    if (!token || !resetTarget) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ revoked_sessions?: number }>(`/api/staff/${resetTarget.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: resetPw, revoke_sessions: true }),
      }, token);
      setMsg(`Password reset for ${resetTarget.email} (revoked ${r.revoked_sessions ?? 0} session(s)).`);
      setResetTarget(null);
      setResetPw('');
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Password reset failed');
    } finally {
      setBusy(false);
    }
  };

  const deleteStaff = async (row: StaffRow) => {
    if (!token || !window.confirm(`Delete staff user ${row.email}?`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await apiFetch(`/api/staff/${row.id}`, { method: 'DELETE' }, token);
      setMsg(`Deleted ${row.email}.`);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="staff-admin">
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <form onSubmit={createStaff} className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Staff Operator
          </div>
          <button type="button" onClick={() => void load()} disabled={busy || loading} className="btn btn-outline btn-sm">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <input className="form-control" placeholder="Full Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input type="email" className="form-control" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input type="password" className="form-control" placeholder="Initial Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {form.role === 'RESELLER' ? (
            <input className="form-control" placeholder="Reseller ID (e.g. RES-01)" value={form.reseller_id} onChange={(e) => setForm({ ...form, reseller_id: e.target.value })} required />
          ) : (
            <button type="submit" disabled={busy} className="btn btn-primary"><Plus className="w-4 h-4" />Create Operator</button>
          )}
        </div>
        {form.role === 'RESELLER' && (
          <div><button type="submit" disabled={busy} className="btn btn-primary"><Plus className="w-4 h-4" />Create Reseller Operator</button></div>
        )}
      </form>

      {resetTarget && (
        <div className="card p-4 border-primary/40 space-y-3">
          <div className="text-xs font-bold flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" />Reset Password for {resetTarget.email}</div>
          <div className="flex flex-wrap gap-2 items-center">
            <input type="password" className="form-control max-w-xs" placeholder="New password (meets security policy)" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
            <button type="button" onClick={() => void submitResetPassword()} disabled={busy || !resetPw} className="btn btn-primary btn-sm">Confirm Reset</button>
            <button type="button" onClick={() => { setResetTarget(null); setResetPw(''); }} className="btn btn-outline btn-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2">
            <Users className="w-4 h-4" /> Staff &amp; RBAC Directory ({rows.length})
          </div>
        </div>
        <div className="table-wrap overflow-auto">
          <table className="table table-hover text-xs">
            <thead>
              <tr>
                <th className="px-3 py-2.5">Operator</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">MFA / Sessions</th>
                <th className="px-3 py-2.5">Last Login</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSelf = r.id === currentUserId;
                return (
                  <tr key={r.id} className="border-t border-border/70">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold">{r.name} {isSelf && <span className="badge badge-info ml-1">You</span>}</div>
                      <div className="text-muted-foreground font-mono text-[11px]">{r.email}</div>
                      {r.reseller_id && <div className="text-[10px] text-muted-foreground">Reseller: {r.reseller_id}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        className="form-select text-xs py-1"
                        value={r.role}
                        disabled={busy || isSelf}
                        onChange={(e) => void patchStaff(r, { role: e.target.value }, `Updated role to ${e.target.value}`)}
                      >
                        {ROLES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`badge ${r.is_active ? 'badge-success' : 'badge-danger'}`}>{r.is_active ? 'Active' : 'Disabled'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`badge ${r.mfa_enabled ? 'badge-success' : 'badge-secondary'} mr-1`}>
                        <Shield className="w-3 h-3 mr-0.5 inline" />{r.mfa_enabled ? 'TOTP' : 'No MFA'}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{r.active_sessions ?? 0} sess</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {r.last_login_at ? new Date(r.last_login_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right space-x-1 whitespace-nowrap">
                      <button type="button" onClick={() => { setResetTarget(r); setResetPw(''); }} disabled={busy} className="btn btn-outline btn-sm" title="Reset Password">
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                      {!isSelf && (
                        <>
                          <button
                            type="button"
                            onClick={() => void patchStaff(r, { is_active: !r.is_active }, r.is_active ? 'Disabled operator' : 'Enabled operator')}
                            disabled={busy}
                            className="btn btn-outline btn-sm"
                            title={r.is_active ? 'Disable account' : 'Enable account'}
                          >
                            {r.is_active ? <UserX className="w-3.5 h-3.5 text-warning" /> : <UserCheck className="w-3.5 h-3.5 text-success" />}
                          </button>
                          <button type="button" onClick={() => void deleteStaff(r)} disabled={busy} className="btn btn-outline btn-sm" title="Delete operator">
                            <Trash2 className="w-3.5 h-3.5 text-danger" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{loading ? 'Loading...' : 'No staff records found.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
