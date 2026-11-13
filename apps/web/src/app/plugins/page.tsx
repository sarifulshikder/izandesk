'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Plug, CreditCard, MessageSquare, Cpu, Puzzle, Save, RotateCcw, ShieldCheck } from 'lucide-react';

type AnyObj = Record<string, any>;

const TYPE_META: Record<string, { label: string; icon: any; desc: string }> = {
  PAYMENT_GATEWAY: { label: 'Payment Gateways', icon: CreditCard, desc: 'Checkout, webhook verification, and payment collection drivers (bKash, Nagad, Rocket, Stripe, PayPal).' },
  SMS_GATEWAY: { label: 'SMS Gateways', icon: MessageSquare, desc: 'Outbound/inbound SMS provider drivers and notification channels.' },
  OLT_DRIVER: { label: 'OLT Drivers', icon: Cpu, desc: 'Vendor-specific FTTH/OLT telemetry and provisioning adapters.' },
  CUSTOM_HOOK: { label: 'Custom Hooks', icon: Puzzle, desc: 'Custom extension hooks and integrations.' },
};

export default function PluginsPage() {
  const { token, user } = useAuth();
  const [data, setData] = useState<AnyObj>({ plugins: [], categories: {}, paymentGateways: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [reloading, setReloading] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { enabled: boolean; mode: string; webhook_secret: string }>>({});

  const canManageGateway = user?.role === 'SUPER_ADMIN' || user?.role === 'BILLING_OPERATOR';
  const canReload = user?.role === 'SUPER_ADMIN' || user?.role === 'NOC_ENGINEER';

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<any>('/api/plugins', {}, token);
      setData(res || { plugins: [], categories: {} });
      const cfgs = (res?.paymentGateways || []) as AnyObj[];
      const next: Record<string, any> = {};
      cfgs.forEach((g) => { next[g.gateway] = { enabled: !!g.enabled, mode: g.mode || 'SANDBOX', webhook_secret: '' }; });
      setForms(prev => ({ ...next, ...prev }));
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const pluginsByType: Record<string, AnyObj[]> = useMemo(() => {
    const cats = data.categories || {};
    const keys = Object.keys(cats);
    if (keys.length) return cats;
    const grouped: Record<string, AnyObj[]> = {};
    (data.plugins || []).forEach((p: AnyObj) => { const k = p.type || 'OTHER'; (grouped[k] = grouped[k] || []).push(p); });
    return grouped;
  }, [data]);

  const reload = async (id?: string) => {
    if (!token) return;
    setReloading(id || 'all'); setError(null); setMsg(null);
    try {
      await apiFetch<any>('/api/plugins/reload', { method: 'POST', body: JSON.stringify(id ? { id } : {}) }, token);
      setMsg(id ? `Reloaded plugin ${id}` : 'Reloaded all plugins');
      await load();
    } catch (e: any) { setError(e.message); } finally { setReloading(null); }
  };

  const saveGateway = async (gateway: string) => {
    if (!token) return;
    const f = forms[gateway] || { enabled: false, mode: 'SANDBOX', webhook_secret: '' };
    setSaving(gateway); setError(null); setMsg(null);
    try {
      await apiFetch<any>(`/api/plugins/payment-gateways/${encodeURIComponent(gateway)}`, {
        method: 'POST',
        body: JSON.stringify({ enabled: f.enabled, mode: f.mode, webhook_secret: f.webhook_secret || undefined })
      }, token);
      setMsg(`Saved payment gateway plugin configuration: ${gateway}`);
      setForms(prev => ({ ...prev, [gateway]: { ...f, webhook_secret: '' } }));
      await load();
    } catch (e: any) { setError(e.message); } finally { setSaving(null); }
  };

  const typeOrder = ['PAYMENT_GATEWAY', 'SMS_GATEWAY', 'OLT_DRIVER', 'CUSTOM_HOOK'];
  const orderedTypes = [...typeOrder.filter(t => pluginsByType[t]?.length), ...Object.keys(pluginsByType).filter(t => !typeOrder.includes(t))];

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Plugins & Integrations</h1>
          <p className="text-sm text-muted-foreground">Hot-reloadable drivers grouped by category. Payment gateway plugins and their configuration are managed here.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
          {canReload && <button onClick={() => reload()} disabled={!!reloading} className="px-3 py-2 rounded-xl border border-primary/40 text-primary text-sm font-semibold inline-flex items-center gap-2"><RotateCcw className="w-4 h-4"/>{reloading==='all'?'Reloading...':'Reload All'}</button>}
        </div>
      </div>
      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {orderedTypes.map((t) => {
          const meta = TYPE_META[t] || { label: t, icon: Plug, desc: 'Plugin category' };
          const Icon = meta.icon;
          return (
            <div key={t} className="p-4 rounded-2xl bg-card border border-border/80">
              <div className="flex items-center gap-2 text-sm font-bold"><Icon className="w-4 h-4 text-primary"/>{meta.label}</div>
              <div className="mt-1 text-2xl font-black">{(pluginsByType[t] || []).length}</div>
              <div className="text-xs text-muted-foreground mt-1">{meta.desc}</div>
            </div>
          );
        })}
      </div>

      {orderedTypes.map((type) => {
        const meta = TYPE_META[type] || { label: type, icon: Plug, desc: '' };
        const Icon = meta.icon;
        const items = pluginsByType[type] || [];
        return (
          <div key={type} className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <div className="font-semibold flex items-center gap-2"><Icon className="w-4 h-4 text-primary"/>{meta.label} <span className="text-xs text-muted-foreground font-normal">({type})</span></div>
                <div className="text-xs text-muted-foreground">{meta.desc}</div>
              </div>
            </div>
            <div className="divide-y divide-border/70">
              {items.map((p: AnyObj) => {
                const gw = p.gateway || (String(p.id||'').startsWith('payment-') ? String(p.id).replace(/^payment-/, '') : null);
                const cfg = p.gatewayConfig || (gw ? (data.paymentGateways || []).find((g:any)=>g.gateway===gw) : null);
                const f = gw ? (forms[gw] || { enabled: !!cfg?.enabled, mode: cfg?.mode || 'SANDBOX', webhook_secret: '' }) : null;
                return (
                  <div key={p.id || p.name} className="p-4 space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-semibold">{p.title || p.name || p.id}</div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted/40 font-mono">{p.id}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${p.status==='OK'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':'bg-red-500/10 text-red-400 border-red-500/20'}`}>{p.status || 'UNKNOWN'}</span>
                          {p.version && <span className="text-[10px] text-muted-foreground">v{p.version}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{p.description || 'No description'}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">Type: <span className="font-mono">{p.type}</span> {p.capabilities?.length ? `• Capabilities: ${p.capabilities.join(', ')}` : ''}</div>
                        {p.lastError && <div className="text-xs text-red-400 mt-1">Last error: {p.lastError}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        {canReload && <button onClick={() => reload(p.id)} disabled={!!reloading} className="px-3 py-1.5 rounded-lg border border-border text-xs inline-flex items-center gap-1"><RotateCcw className="w-3 h-3"/>{reloading===p.id?'...':'Reload'}</button>}
                      </div>
                    </div>

                    {type === 'PAYMENT_GATEWAY' && gw && f && (
                      <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-sm font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary"/>Payment Gateway Configuration <span className="text-xs font-mono text-muted-foreground uppercase">({gw})</span></div>
                          <div className="text-xs text-muted-foreground flex items-center gap-3">
                            <span className={cfg?.has_credentials ? 'text-emerald-400' : ''}>{cfg?.has_credentials ? 'Credentials set' : 'No credentials'}</span>
                            <span className={cfg?.has_webhook_secret ? 'text-emerald-400' : ''}>{cfg?.has_webhook_secret ? 'Webhook secret set' : 'No webhook secret'}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                          <label className="text-xs">
                            <div className="text-muted-foreground mb-1">Enabled</div>
                            <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={f.enabled ? 'true' : 'false'} onChange={e=>setForms(prev=>({...prev,[gw]:{...f, enabled: e.target.value==='true'}}))} disabled={!canManageGateway}>
                              <option value="false">Disabled</option>
                              <option value="true">Enabled</option>
                            </select>
                          </label>
                          <label className="text-xs">
                            <div className="text-muted-foreground mb-1">Mode</div>
                            <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={f.mode} onChange={e=>setForms(prev=>({...prev,[gw]:{...f, mode: e.target.value}}))} disabled={!canManageGateway}>
                              <option value="SANDBOX">SANDBOX</option>
                              <option value="LIVE">LIVE</option>
                            </select>
                          </label>
                          <label className="text-xs md:col-span-1">
                            <div className="text-muted-foreground mb-1">Webhook Secret (set/rotate)</div>
                            <input type="password" className="w-full p-2.5 rounded-xl border border-border bg-card" placeholder={cfg?.has_webhook_secret ? '•••••• (leave blank to keep)' : 'Enter webhook secret/token'} value={f.webhook_secret} onChange={e=>setForms(prev=>({...prev,[gw]:{...f, webhook_secret: e.target.value}}))} disabled={!canManageGateway} />
                          </label>
                          <div className="flex gap-2">
                            <button onClick={()=>saveGateway(gw)} disabled={!canManageGateway || saving===gw} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"><Save className="w-4 h-4"/>{saving===gw?'Saving...':'Save Config'}</button>
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-start gap-2"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-emerald-400"/>Credentials/advanced config can be managed via API <code className="font-mono">POST /api/plugins/payment-gateways/{gw}</code> or <code className="font-mono">/api/billing/gateways/{gw}</code> (fields: <code>enabled</code>, <code>mode</code>, <code>config</code>, <code>credentials</code>, <code>webhook_secret</code>). Webhook: <code className="font-mono">/api/billing/webhooks/{gw}</code>.</div>
                      </div>
                    )}
                  </div>
                );
              })}
              {!items.length && <div className="p-6 text-sm text-muted-foreground">No plugins loaded in this category.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}