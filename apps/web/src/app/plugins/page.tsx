'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Plug, CreditCard, MessageSquare, Cpu, Puzzle, RotateCcw, Settings, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';

type AnyObj = Record<string, any>;

const TYPE_META: Record<string, { label: string; icon: any; desc: string; tone?: string }> = {
  PAYMENT_GATEWAY: { label: 'Payment Gateways', icon: CreditCard, tone: 'primary', desc: 'Checkout, webhooks, verification, and payment collection drivers (bKash, Nagad, Rocket, Stripe, PayPal).' },
  SMS_GATEWAY: { label: 'SMS Gateways', icon: MessageSquare, tone: 'info', desc: 'Outbound/inbound SMS provider drivers and notification channels.' },
  OLT_DRIVER: { label: 'OLT Drivers', icon: Cpu, tone: 'teal', desc: 'Vendor-specific FTTH/OLT telemetry and provisioning adapters.' },
  CUSTOM_HOOK: { label: 'Custom Hooks', icon: Puzzle, tone: 'purple', desc: 'Custom extension hooks and integrations.' },
};

function gatewayLabel(id: string) {
  const map: Record<string, string> = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', stripe: 'Stripe', paypal: 'PayPal' };
  return map[id] || id;
}

export default function PluginsPage() {
  const { token, user } = useAuth();
  const [data, setData] = useState<AnyObj>({ plugins: [], categories: {}, paymentGateways: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reloading, setReloading] = useState<string | null>(null);

  const canReload = user?.role === 'SUPER_ADMIN' || user?.role === 'NOC_ENGINEER';

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<any>('/api/plugins', {}, token);
      setData(res || { plugins: [], categories: {}, paymentGateways: [] });
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const pluginsByType: Record<string, AnyObj[]> = useMemo(() => {
    const cats = data.categories || {};
    if (Object.keys(cats).length) return cats;
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

  const typeOrder = ['PAYMENT_GATEWAY', 'SMS_GATEWAY', 'OLT_DRIVER', 'CUSTOM_HOOK'];
  const orderedTypes = [...typeOrder.filter(t => pluginsByType[t]?.length), ...Object.keys(pluginsByType).filter(t => !typeOrder.includes(t))];
  const paymentPlugins = pluginsByType['PAYMENT_GATEWAY'] || [];

  return (
    <div className="space-y-6">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Platform · Extension registry</span>
          <h1 className="page-title">Plugin Manager</h1>
          <p className="page-subtitle">Hot-reloadable drivers organized by category. Open a plugin to view details and configure it (e.g. Payment Gateways → bKash/Nagad/Rocket/Stripe/PayPal).</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
          {canReload && <button onClick={() => reload()} disabled={!!reloading} className="btn btn-primary"><RotateCcw className="w-4 h-4"/>{reloading==='all'?'Reloading...':'Reload All'}</button>}
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="stat-grid">
        {orderedTypes.map((t) => {
          const meta = TYPE_META[t] || { label: t, icon: Plug, desc: 'Plugin category' };
          const Icon = meta.icon;
          return (
            <div key={t} className={`dash-stat dash-stat-${meta.tone || 'secondary'}`}>
              <span className="dash-stat-icon"><Icon className="w-4 h-4"/></span>
              <span className="dash-stat-body"><span className="dash-stat-label">{meta.label}</span><span className="dash-stat-value">{(pluginsByType[t] || []).length}</span><span className="dash-stat-hint" title={meta.desc}>{meta.desc}</span></span>
            </div>
          );
        })}
      </div>

      {/* Payment Gateways - prominent section */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <div>
            <div className="font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary"/>Payment Gateways <span className="text-xs text-muted-foreground font-normal">(PLUGIN CATEGORY: PAYMENT_GATEWAY)</span></div>
            <div className="text-xs text-muted-foreground">Select a gateway to open its configuration page (credentials, mode, webhook, enable/disable).</div>
          </div>
        </div>
        <div className="card-body grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {paymentPlugins.map((p: AnyObj) => {
            const gw = p.gateway || String(p.id || '').replace(/^payment-/, '');
            const cfg = p.gatewayConfig || (data.paymentGateways || []).find((g:any)=>g.gateway===gw) || null;
            return (
              <div key={p.id} className="card card-body-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-base">{gatewayLabel(gw)}</div>
                    <div className="text-xs text-muted-foreground font-mono">{p.id}</div>
                    <div className="text-xs text-muted-foreground mt-1">{p.title || p.name}</div>
                  </div>
                  <span className={`badge ${p.status==='OK'?'badge-success':'badge-danger'}`}>{p.status || 'UNKNOWN'}</span>
                </div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className={`badge ${cfg?.enabled ? 'badge-success' : 'badge-secondary'}`}>{cfg?.enabled ? 'Enabled' : 'Disabled'}</span>
                  <span className="badge badge-outline">{cfg?.mode || 'SANDBOX'}</span>
                  <span className={`badge ${cfg?.has_credentials ? 'badge-success' : 'badge-secondary'}`}>{cfg?.has_credentials ? <CheckCircle2 className="w-3 h-3"/> : <XCircle className="w-3 h-3"/>}Credentials</span>
                  <span className={`badge ${cfg?.has_webhook_secret ? 'badge-success' : 'badge-secondary'}`}>{cfg?.has_webhook_secret ? <CheckCircle2 className="w-3 h-3"/> : <XCircle className="w-3 h-3"/>}Webhook secret</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Link href={`/plugins/payment-gateways/${gw}`} className="btn btn-primary flex-1"><Settings className="w-4 h-4"/>Open Configuration</Link>
                  {canReload && <button onClick={() => reload(p.id)} disabled={!!reloading} className="btn btn-outline btn-icon"><RotateCcw className="w-4 h-4"/></button>}
                </div>
              </div>
            );
          })}
          {!paymentPlugins.length && <div className="col-span-full p-4"><div className="empty-panel">
            <span className="empty-panel-icon"><CreditCard className="w-5 h-5"/></span>
            <div>
              <div className="text-sm font-semibold">No payment gateways loaded</div>
              <p className="text-[11px] text-muted-foreground mt-1">Refresh the plugin registry to discover installed gateway drivers.</p>
            </div>
          </div></div>}
        </div>
      </div>

      {/* Other categories */}
      {orderedTypes.filter(t => t !== 'PAYMENT_GATEWAY').map((type) => {
        const meta = TYPE_META[type] || { label: type, icon: Plug, desc: '' };
        const Icon = meta.icon;
        const items = pluginsByType[type] || [];
        return (
          <div key={type} className="card overflow-hidden">
            <div className="card-header">
              <div className="font-semibold flex items-center gap-2"><Icon className="w-4 h-4 text-primary"/>{meta.label} <span className="text-xs text-muted-foreground font-normal">({type})</span></div>
              <div className="text-xs text-muted-foreground">{meta.desc}</div>
            </div>
            <div className="divide-y divide-border/70">
              {items.map((p: AnyObj) => (
                <div key={p.id || p.name} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold">{p.title || p.name || p.id}</div>
                      <span className="badge badge-secondary font-mono">{p.id}</span>
                      <span className={`badge ${p.status==='OK'?'badge-success':'badge-danger'}`}>{p.status || 'UNKNOWN'}</span>
                      {p.version && <span className="text-[10px] text-muted-foreground">v{p.version}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{p.description || 'No description'}</div>
                  </div>
                  {canReload && <button onClick={() => reload(p.id)} disabled={!!reloading} className="btn btn-outline btn-sm"><RotateCcw className="w-3 h-3"/>{reloading===p.id?'...':'Reload'}</button>}
                </div>
              ))}
              {!items.length && <div className="empty-state">No plugins loaded in this category.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}