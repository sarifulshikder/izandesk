'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles, ShieldCheck, Save, Loader2, KeyRound, ExternalLink,
  Server, Gauge, Bot,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';

const SECRET_FIELDS = ['ai.nim_api_key', 'ai.gemini_api_key', 'ai.openai_api_key'];
const PROVIDERS = [
  { value: 'auto', label: 'Auto / Built-in (free, private)' },
  { value: 'local', label: 'Built-in engine only' },
  { value: 'nim', label: 'NVIDIA NIM' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openai', label: 'OpenAI' },
];

export default function AiSettingsPage() {
  const { token, user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [values, setValues] = useState<Record<string, any>>({});
  const [form, setForm] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testRes, setTestRes] = useState<{ ok?: boolean; message?: string } | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  const testConnection = async () => {
    setTestBusy(true); setTestRes(null);
    const provider = String(form['ai.provider'] || 'auto');
    const key = provider === 'gemini' ? form['ai.gemini_api_key']
      : provider === 'openai' ? form['ai.openai_api_key']
      : provider === 'nim' ? form['ai.nim_api_key'] : '';
    try {
      const res = await apiFetch<any>('/api/ai/test-provider', { method: 'POST', body: JSON.stringify({ provider, api_key: key }) }, token);
      setTestRes({ ok: !!res.ok, message: res.message || (res.ok ? 'OK' : 'Test failed') });
    } catch (e: any) { setTestRes({ ok: false, message: e.message }); }
    finally { setTestBusy(false); }
  };

  const load = useCallback(async () => {
    if (!token || !isAdmin) { setLoading(false); return; }
    try {
      const res = await apiFetch<any>('/api/ai/settings', {}, token);
      const v = res.values || {};
      setValues(v);
      const next: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) next[k] = SECRET_FIELDS.includes(k) ? '' : val;
      setForm(next);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [token, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));
  const secretMeta = (key: string) => values[key] as { masked?: string; has_value?: boolean } | undefined;

  const save = async () => {
    if (!token) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await apiFetch<any>('/api/ai/settings', { method: 'PUT', body: JSON.stringify(form) }, token);
      setMsg(`Saved ${res.updated?.length || 0} setting(s).`);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <div className="page-header items-start">
          <div><span className="page-eyebrow">Intelligence · Copilot configuration</span><h1 className="page-title">AI Copilot Settings</h1><p className="page-subtitle">Engine, provider keys and rate limits.</p></div>
        </div>
        <div className="alert alert-warning">Only a Super Admin can view or change AI Copilot settings.</div>
        <Link className="btn btn-outline inline-flex items-center gap-2" href="/ai-assistant"><Sparkles className="w-4 h-4" /> Open AI Copilot</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div className="flex items-center gap-3">
          <div className="page-title-icon"><Sparkles className="w-6 h-6" /></div>
          <div>
            <span className="page-eyebrow">Intelligence · Copilot configuration</span>
            <h1 className="page-title">AI Copilot Settings</h1>
            <p className="page-subtitle">Choose the engine, add provider keys and control cost and privacy.</p>
          </div>
        </div>
        <div className="page-actions">
          <Link className="btn btn-outline inline-flex items-center gap-2" href="/ai-assistant"><Bot className="w-4 h-4" /> Open Copilot</Link>
          <button className="btn btn-primary inline-flex items-center gap-2" onClick={() => void save()} disabled={busy || loading}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save changes
          </button>
        </div>
      </div>

      {msg && <div className="alert alert-success">{msg}</div>}
      {err && <div className="alert alert-danger">{err}</div>}
      {loading && <div className="card p-6 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading settings…</div>}

      {!loading && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="space-y-5">
            {/* Engine */}
            <section className="card p-4 space-y-4">
              <div className="flex items-center gap-2 font-bold"><Gauge className="w-4 h-4 text-primary" /> Engine & behaviour</div>
              <label className="form-check">
                <input type="checkbox" checked={!!form['ai.enabled']} onChange={(e) => set('ai.enabled', e.target.checked)} />
                <span>Enable AI Copilot</span>
              </label>
              <div>
                <label className="form-label">Provider</label>
                <select className="form-select" value={form['ai.provider'] || 'auto'} onChange={(e) => set('ai.provider', e.target.value)}>
                  {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <p className="form-hint">The built-in engine answers all supported reporting topics for free. An external provider is used only for free-form questions.</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="btn btn-outline text-xs" onClick={() => void testConnection()} disabled={testBusy || (form['ai.provider'] || 'auto') === 'local'}>
                  {testBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gauge className="w-3 h-3" />} Test connection
                </button>
                {testRes?.message && (
                  <span className={`text-xs ${testRes.ok ? 'text-success' : 'text-danger'}`}>{testRes.message}</span>
                )}
              </div>
              <label className="form-check">
                <input type="checkbox" checked={!!form['ai.allow_external']} onChange={(e) => set('ai.allow_external', e.target.checked)} />
                <span>Allow external AI providers</span>
              </label>
              <div className="alert alert-warning text-xs">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Off by default. When on, free-form questions send <b>aggregate, role-filtered metrics only</b> — never subscriber names, phones, passwords or secrets.</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Requests / minute / user</label>
                  <input className="form-control" type="number" min={1} max={300} value={form['ai.rate_limit_per_min'] ?? 30} onChange={(e) => set('ai.rate_limit_per_min', Number(e.target.value))} />
                </div>
                <div>
                  <label className="form-label">History turns sent</label>
                  <input className="form-control" type="number" min={0} max={100} value={form['ai.max_history'] ?? 20} onChange={(e) => set('ai.max_history', Number(e.target.value))} />
                </div>
              </div>
            </section>

            {/* NIM */}
            <section className="card p-4 space-y-4">
              <div className="flex items-center gap-2 font-bold"><Server className="w-4 h-4 text-primary" /> NVIDIA NIM</div>
              <div>
                <label className="form-label">NVIDIA API key</label>
                <input
                  className="form-control" type="password" autoComplete="off"
                  value={form['ai.nim_api_key'] || ''}
                  placeholder={secretMeta('ai.nim_api_key')?.has_value ? '•••••••• (saved — leave blank to keep)' : 'nvapi-…'}
                  onChange={(e) => set('ai.nim_api_key', e.target.value)}
                />
                <p className="form-hint">Used with Bearer auth. Blank keeps the saved key.</p>
              </div>
              <div>
                <label className="form-label">NIM base URL</label>
                <input className="form-control" type="text" value={form['ai.nim_base_url'] || ''} onChange={(e) => set('ai.nim_base_url', e.target.value)} placeholder="https://integrate.api.nvidia.com/v1" />
                <p className="form-hint">NVIDIA Cloud: <code>https://integrate.api.nvidia.com/v1</code>. Self-hosted NIM: your container URL, e.g. <code>http://nim-host:8000/v1</code>.</p>
              </div>
              <div>
                <label className="form-label">Model ID</label>
                <input className="form-control" type="text" value={form['ai.nim_model'] || ''} onChange={(e) => set('ai.nim_model', e.target.value)} placeholder="meta/llama-3.3-70b-instruct" />
                <p className="form-hint">Any NIM chat model id, e.g. <code>meta/llama-3.3-70b-instruct</code> or <code>nvidia/llama-3.3-nemotron-super-49b-v1</code>.</p>
              </div>
              <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href="https://build.nvidia.com/" target="_blank" rel="noreferrer">
                Browse NVIDIA NIM models <ExternalLink className="w-3 h-3" />
              </a>
            </section>
          </div>

          <div className="space-y-5">
            {/* Gemini */}
            <section className="card p-4 space-y-4">
              <div className="flex items-center gap-2 font-bold"><KeyRound className="w-4 h-4 text-primary" /> Google Gemini</div>
              <div>
                <label className="form-label">API key</label>
                <input className="form-control" type="password" autoComplete="off" value={form['ai.gemini_api_key'] || ''}
                  placeholder={secretMeta('ai.gemini_api_key')?.has_value ? '•••••••• (saved — leave blank to keep)' : 'AI Studio key'}
                  onChange={(e) => set('ai.gemini_api_key', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Model</label>
                <input className="form-control" type="text" value={form['ai.gemini_model'] || ''} onChange={(e) => set('ai.gemini_model', e.target.value)} placeholder="gemini-2.0-flash" />
              </div>
            </section>

            {/* OpenAI */}
            <section className="card p-4 space-y-4">
              <div className="flex items-center gap-2 font-bold"><KeyRound className="w-4 h-4 text-primary" /> OpenAI</div>
              <div>
                <label className="form-label">API key</label>
                <input className="form-control" type="password" autoComplete="off" value={form['ai.openai_api_key'] || ''}
                  placeholder={secretMeta('ai.openai_api_key')?.has_value ? '•••••••• (saved — leave blank to keep)' : 'sk-…'}
                  onChange={(e) => set('ai.openai_api_key', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Model</label>
                <input className="form-control" type="text" value={form['ai.openai_model'] || ''} onChange={(e) => set('ai.openai_model', e.target.value)} placeholder="gpt-4o-mini" />
              </div>
            </section>

            <section className="card p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-bold text-foreground text-sm">How keys are handled</div>
              <div>• Keys are stored server-side and masked on read — the API never returns their value.</div>
              <div>• Leaving a key field blank keeps the existing key.</div>
              <div>• Changing the provider or keys takes effect immediately (5-second settings cache).</div>
              <div>• All changes are audit-logged with the actor and changed fields.</div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
