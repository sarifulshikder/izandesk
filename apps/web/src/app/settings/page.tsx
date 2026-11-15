'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import {
  Settings as SettingsIcon, Shield, Bell, Palette, Receipt, Network as NetworkIcon,
  Save, RotateCcw, KeyRound, Send, AlertTriangle, CheckCircle2, Building2,
} from 'lucide-react';

type Field = {
  key: string; category: string; field: string; label: string; type: string;
  options?: string[]; min?: number; max?: number; default: any; description?: string; secret?: boolean;
};
type CategoryMeta = { label: string; description: string };

const TAB_ICONS: Record<string, any> = {
  general: Building2, security: Shield, notifications: Bell, branding: Palette, billing: Receipt, network: NetworkIcon,
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
    const common = 'w-full px-3 py-2 rounded-xl bg-background border border-border text-sm';
    if (f.type === 'boolean') {
      return (
        <select className={common} value={String(form[f.field] ?? false)} onChange={(e) => setF(f.field, e.target.value === 'true')} disabled={!isAdmin}>
          <option value="true">Enabled</option><option value="false">Disabled</option>
        </select>
      );
    }
    if (f.type === 'select') {
      return (
        <select className={common} value={String(form[f.field] ?? '')} onChange={(e) => setF(f.field, e.target.value)} disabled={!isAdmin}>
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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2"><SettingsIcon className="w-6 h-6"/>Settings & Security</h1>
          <p className="text-sm text-muted-foreground">Company profile, security policy, notifications, branding, billing defaults and network parameters. Changes are audited.</p>
        </div>
        {!isAdmin && <span className="text-xs px-3 py-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300 w-fit">Read-only — SUPER_ADMIN can edit</span>}
      </div>

      {maint === true && (
        <div className="p-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4"/> Maintenance mode is ON — non-admin API access is blocked with 503. ({values.security?.maintenance_message || ''})
        </div>
      )}
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/>{msg}</div>}

      <div className="flex gap-2 flex-wrap">
        {Object.entries(schema?.categories || {}).map(([k, meta]) => {
          const Icon = TAB_ICONS[k] || SettingsIcon;
          return (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-medium border inline-flex items-center gap-2 ${tab === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border'}`}>
              <Icon className="w-4 h-4"/>{meta.label}
            </button>
          );
        })}
      </div>

      {schema && (
        <div className="p-5 rounded-2xl bg-card border border-border/80 space-y-4">
          <div className="text-sm text-muted-foreground">{schema.categories[tab]?.description}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map((f) => (
              <label key={f.key} className={`block ${f.type === 'text' ? 'md:col-span-2' : ''}`}>
                <div className="text-xs font-semibold text-muted-foreground mb-1">{f.label}</div>
                {renderField(f)}
                {f.description && <div className="text-[11px] text-muted-foreground mt-1">{f.description}</div>}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {isAdmin && (
              <>
                <button onClick={save} disabled={busy} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"><Save className="w-4 h-4"/>{busy ? 'Saving…' : 'Save'}</button>
                <button onClick={reset} disabled={busy} className="px-4 py-2 rounded-xl border border-border text-sm inline-flex items-center gap-2 hover:bg-muted"><RotateCcw className="w-4 h-4"/>Reset to defaults</button>
              </>
            )}
            {tab === 'notifications' && isAdmin && (
              <button onClick={testSmtp} className="px-4 py-2 rounded-xl border border-border text-sm inline-flex items-center gap-2 hover:bg-muted"><Send className="w-4 h-4"/>Test SMTP</button>
            )}
            {smtpMsg && <span className="text-xs text-muted-foreground">{smtpMsg}</span>}
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="p-5 rounded-2xl bg-card border border-border/80 space-y-3">
          <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2"><KeyRound className="w-4 h-4"/>Change my password</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="password" placeholder="Current password" className="px-3 py-2 rounded-xl bg-background border border-border text-sm" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
            <input type="password" placeholder="New password" className="px-3 py-2 rounded-xl bg-background border border-border text-sm" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <input type="password" placeholder="Confirm new password" className="px-3 py-2 rounded-xl bg-background border border-border text-sm" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={changePw} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">Update password</button>
            {pwMsg && <span className="text-xs text-emerald-300">{pwMsg}</span>}
            {pwErr && <span className="text-xs text-red-300">{pwErr}</span>}
          </div>
          <div className="text-[11px] text-muted-foreground">Policy enforced from Security tab: min {values.security?.password_min_length ?? 8} chars, upper {String(values.security?.password_require_upper ?? true)}, lower {String(values.security?.password_require_lower ?? true)}, digit {String(values.security?.password_require_digit ?? true)}, symbol {String(values.security?.password_require_symbol ?? false)}. Passwords are stored bcrypt-hashed and survive restarts.</div>
        </div>
      )}

    </div>
  );
}
