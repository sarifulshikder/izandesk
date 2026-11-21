'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import McpAdmin from '@/components/settings/mcp-admin';
import { SecurityAdmin } from '@/components/settings/security-admin';
import {
  Settings as SettingsIcon, Shield, Bell, Palette, Receipt, Network as NetworkIcon,
  Save, RotateCcw, KeyRound, Send, AlertTriangle, CheckCircle2, Building2, Bot,
} from 'lucide-react';

type Field = {
  key: string; category: string; field: string; label: string; type: string;
  options?: string[]; min?: number; max?: number; default: any; description?: string; secret?: boolean;
};
type CategoryMeta = { label: string; description: string };

const TAB_ICONS: Record<string, any> = {
  general: Building2, security: Shield, notifications: Bell, branding: Palette, billing: Receipt, network: NetworkIcon, acs: NetworkIcon, mcp: Bot,
};

export default function SettingsPage() {
  const { token, user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [schema, setSchema] = useState<{ categories: Record<string, CategoryMeta>; fields: Field[] } | null>(null);
  const [values, setValues] = useState<Record<string, any>>({}); // category -> {field: value}
  const [tab, setTab] = useState('general');
  const [form, setForm] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // change-password
  const [pw, setPw] = useState({ old: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [smtpMsg, setSmtpMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [s, v] = await Promise.all([
        apiFetch<any>('/api/settings/schema', {}, token),
        apiFetch<any>('/api/settings', {}, token),
      ]);
      setSchema({ categories: s.categories, fields: s.fields });
      setValues(v.data || {});
      const cat = Object.keys(v.data || {})[0] || 'general';
      setTab((t) => (v.data[t] ? t : cat));
    } catch (e: any) { setErr(e.message); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const fields = useMemo(() => (schema?.fields || []).filter((f) => f.category === tab), [schema, tab]);

  // when switching tab, load current values into the form
  useEffect(() => {
    const v = values[tab] || {};
    const f: Record<string, any> = {};
    for (const field of fields) {
      const cur = v[field.field];
      f[field.field] = field.secret ? '' : (Array.isArray(cur) ? cur.join(', ') : (cur?.masked !== undefined ? '' : cur ?? ''));
    }
    setForm(f); setMsg(null); setSmtpMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, schema]);

  const setF = (field: string, val: any) => setForm((f) => ({ ...f, [field]: val }));

  const save = async () => {
    if (!token) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const payload: Record<string, any> = {};
      for (const field of fields) {
        let v = form[field.field];
        if (field.type === 'number') v = v === '' ? field.default : Number(v);
        if (field.type === 'boolean') v = v === true || v === 'true';
        if (field.type === 'array' && typeof v === 'string') v = v.split(',').map((s) => s.trim()).filter(Boolean);
        payload[field.field] = v;
      }
      const r = await apiFetch<any>(`/api/settings/${tab}`, { method: 'PUT', body: JSON.stringify({ values: payload }) }, token);
      setMsg(`Saved ${r.updated?.length || 0} change(s) in ${tab}.`);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!token || !confirm(`Reset ${tab} settings to defaults?`)) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const r = await apiFetch<any>(`/api/settings/reset/${tab}`, { method: 'POST' }, token);
      setMsg(`Reset ${r.reset?.length || 0} keys in ${tab} to defaults.`);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const testSmtp = async () => {
    if (!token) return;
    setSmtpMsg(null);
    try {
      const saved = values.notifications || {};
      const r = await apiFetch<any>('/api/settings/test-smtp', {
        method: 'POST',
        body: JSON.stringify({
          host: form.smtp_host || saved.smtp_host || '',
          port: Number(form.smtp_port ?? saved.smtp_port ?? 587),
        }),
      }, token);
      setSmtpMsg(r.ok ? `✅ ${r.detail}` : `❌ ${r.detail}`);
    } catch (e: any) { setSmtpMsg(`❌ ${e.message}`); }
  };

  const changePw = async () => {
    if (!token) return;
    setPwMsg(null); setPwErr(null);
    if (pw.next !== pw.confirm) { setPwErr('New passwords do not match'); return; }
    try {
      const r = await apiFetch<any>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ old_password: pw.old, new_password: pw.next }) }, token);
      setPwMsg(r.message || 'Password updated');
      setPw({ old: '', next: '', confirm: '' });
    } catch (e: any) { setPwErr(e.message); }
  };

  const maint = values.security?.maintenance_mode;

  const renderField = (f: Field) => {
    const cur = values[tab]?.[f.field];
    const common = 'form-control';
    if (f.type === 'boolean') {
      return (
        <select className="form-select" value={String(form[f.field] ?? false)} onChange={(e) => setF(f.field, e.target.value === 'true')} disabled={!isAdmin}>
          <option value="true">Enabled</option><option value="false">Disabled</option>
        </select>
      );
    }
    if (f.type === 'select') {
      return (
        <select className="form-select" value={String(form[f.field] ?? '')} onChange={(e) => setF(f.field, e.target.value)} disabled={!isAdmin}>
          {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (f.type === 'text') {
      return <textarea className={common} rows={2} value={form[f.field] ?? ''} onChange={(e) => setF(f.field, e.target.value)} disabled={!isAdmin} />;
    }
    if (f.type === 'password') {
      return (
        <div>
          <input type="password" className={common} placeholder={cur?.has_value ? '•••••••• (set — leave blank to keep)' : 'not set'} value={form[f.field] ?? ''} onChange={(e) => setF(f.field, e.target.value)} disabled={!isAdmin} />
        </div>
      );
    }
    if (f.type === 'number') {
      return <input type="number" className={common} min={f.min} max={f.max} value={form[f.field] ?? ''} onChange={(e) => setF(f.field, e.target.value)} disabled={!isAdmin} />;
    }
    // array -> comma separated
    return <input type="text" className={common} placeholder="comma, separated, values" value={form[f.field] ?? ''} onChange={(e) => setF(f.field, e.target.value)} disabled={!isAdmin} />;
  };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Workspace administration · Control plane</span>
          <h1 className="page-title"><SettingsIcon className="w-6 h-6"/>Settings &amp; Security</h1>
          <p className="page-subtitle">Company profile, security policy, notifications, branding, billing defaults and network parameters — every change audited.</p>
        </div>
        {!isAdmin && <span className="badge badge-warning">Read-only · SUPER_ADMIN can edit</span>}
      </div>

      {maint === true && (
        <div className="alert alert-warning">
          <AlertTriangle className="w-4 h-4"/> Maintenance mode is ON — non-admin API access is blocked with 503. ({values.security?.maintenance_message || ''})
        </div>
      )}
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success"><CheckCircle2 className="w-4 h-4"/>{msg}</div>}

      <div className="page-tabbar">
        {Object.entries(schema?.categories || {}).map(([k, meta]) => {
          const Icon = TAB_ICONS[k] || SettingsIcon;
          return (
            <button key={k} onClick={() => setTab(k)} className={`page-tab ${tab === k ? 'active' : ''}`}>
              <Icon className="w-3.5 h-3.5"/>{meta.label}
            </button>
          );
        })}
      </div>

      {schema && (
        <div className="card overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-4 py-3.5 border-b border-border bg-card-cap/60">
            <div>
              <h2 className="text-[13px] font-bold text-foreground">{schema.categories[tab]?.label}</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">{schema.categories[tab]?.description}</p>
            </div>
            <span className="badge badge-secondary whitespace-nowrap">{fields.length} keys</span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fields.map((f) => (
                <label key={f.key} className={`block ${f.type === 'text' ? 'md:col-span-2' : ''}`}>
                  <div className="form-label">{f.label}</div>
                  {renderField(f)}
                  {f.description && <div className="text-[11px] text-muted-foreground mt-1">{f.description}</div>}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-t border-border bg-card-cap/50">
            {isAdmin ? (
              <>
                <button onClick={save} disabled={busy} className="btn btn-primary"><Save className="w-4 h-4"/>{busy ? 'Saving…' : 'Save changes'}</button>
                <button onClick={reset} disabled={busy} className="btn btn-outline"><RotateCcw className="w-4 h-4"/>Reset to defaults</button>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">Viewing in read-only mode.</span>
            )}
            {tab === 'notifications' && isAdmin && (
              <button onClick={testSmtp} className="btn btn-outline"><Send className="w-4 h-4"/>Test SMTP</button>
            )}
            {smtpMsg && <span className="text-xs text-muted-foreground">{smtpMsg}</span>}
          </div>
        </div>
      )}

      {tab === 'mcp' && <McpAdmin token={token} isAdmin={isAdmin} />}

      {tab === 'security' && (
        <div className="card p-4 space-y-3">
          <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2"><KeyRound className="w-4 h-4"/>Change my password</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="password" placeholder="Current password" className="form-control" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
            <input type="password" placeholder="New password" className="form-control" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <input type="password" placeholder="Confirm new password" className="form-control" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={changePw} className="btn btn-primary">Update password</button>
            {pwMsg && <span className="text-xs text-success">{pwMsg}</span>}
            {pwErr && <span className="text-xs text-danger">{pwErr}</span>}
          </div>
          <div className="text-[11px] text-muted-foreground">Policy enforced from Security tab: min {values.security?.password_min_length ?? 8} chars, upper {String(values.security?.password_require_upper ?? true)}, lower {String(values.security?.password_require_lower ?? true)}, digit {String(values.security?.password_require_digit ?? true)}, symbol {String(values.security?.password_require_symbol ?? false)}. Passwords are stored bcrypt-hashed and survive restarts. Changing your password signs out other sessions.</div>
        </div>
      )}

      {tab === 'security' && <SecurityAdmin token={token} isSuperAdmin={isAdmin} />}

    </div>
  );
}
