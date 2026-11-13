'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Plug, CreditCard, MessageSquare, Cpu, Puzzle, RotateCcw, Settings, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';

type AnyObj = Record<string, any>;

const TYPE_META: Record<string, { label: string; icon: any; desc: string }> = {
  PAYMENT_GATEWAY: { label: 'Payment Gateways', icon: CreditCard, desc: 'Checkout, webhooks, verification, and payment collection drivers (bKash, Nagad, Rocket, Stripe, PayPal).' },
  SMS_GATEWAY: { label: 'SMS Gateways', icon: MessageSquare, desc: 'Outbound/inbound SMS provider drivers and notification channels.' },
  OLT_DRIVER: { label: 'OLT Drivers', icon: Cpu, desc: 'Vendor-specific FTTH/OLT telemetry and provisioning adapters.' },
  CUSTOM_HOOK: { label: 'Custom Hooks', icon: Puzzle, desc: 'Custom extension hooks and integrations.' },
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Plugin Manager</h1>
          <p className="text-sm text-muted-foreground">Hot-reloadable drivers organized by category. Open a plugin to view details and configure it (e.g. Payment Gateways → bKash/Nagad/Rocket/Stripe/PayPal).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
          {canReload && <button onClick={() => reload()} disabled={!!reloading} className="px-3 py-2 rounded-xl border border-primary/40 text-primary text-sm font-semibold inline-flex items-center gap-2"><RotateCcw className="w-4 h-4"/>{reloading==='all'?'Reloading...':'Reload All'}</button>}
        </div>
      </div>
      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
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

      {/* Payment Gateways - prominent section */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary"/>Payment Gateways <span className="text-xs text-muted-foreground font-normal">(PLUGIN CATEGORY: PAYMENT_GATEWAY)</span></div>
            <div className="text-xs text-muted-foreground">Select a gateway to open its configuration page (credentials, mode, webhook, enable/disable).</div>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {paymentPlugins.map((p: AnyObj) => {
            const gw = p.gateway || String(p.id || '').replace(/^payment-/, '');
            const cfg = p.gatewayConfig || (data.paymentGateways || []).find((g:any)=>g.gateway===gw) || null;
            return (
              <div key={p.id} className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-base">{gatewayLabel(gw)}</div>
                    <div className="text-xs text-muted-foreground font-mono">{p.id}</div>
                    <div className="text-xs text-muted-foreground mt-1">{p.title || p.name}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${p.status==='OK'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':'bg-red-500/10 text-red-400 border-red-500/20'}`}>{p.status || 'UNKNOWN'}</span>
                </div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className={`px-2 py-1 rounded-lg border ${cfg?.enabled ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-border text-muted-foreground'}`}>{cfg?.enabled ? 'Enabled' : 'Disabled'}</span>
                  <span className="px-2 py-1 rounded-lg border border-border">{cfg?.mode || 'SANDBOX'}</span>
                  <span className={`px-2 py-1 rounded-lg border inline-flex items-center gap-1 ${cfg?.has_credentials ? 'border-emerald-500/30 text-emerald-300' : 'border-border text-muted-foreground'}`}>{cfg?.has_credentials ? <CheckCircle2 className="w-3 h-3"/> : <XCircle className="w-3 h-3"/>}Credentials</span>
                  <span className={`px-2 py-1 rounded-lg border inline-flex items-center gap-1 ${cfg?.has_webhook_secret ? 'border-emerald-500/30 text-emerald-300' : 'border-border text-muted-foreground'}`}>{cfg?.has_webhook_secret ? <CheckCircle2 className="w-3 h-3"/> : <XCircle className="w-3 h-3"/>}Webhook secret</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Link href={`/plugins/payment-gateways/${gw}`} className="flex-1 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-2"><Settings className="w-4 h-4"/>Open Configuration</Link>
                  {canReload && <button onClick={() => reload(p.id)} disabled={!!reloading} className="px-3 py-2 rounded-xl border border-border text-sm inline-flex items-center gap-2"><RotateCcw className="w-4 h-4"/></button>}
                </div>
              </div>
            );
          })}
          {!paymentPlugins.length && <div className="text-sm text-muted-foreground">No payment gateway plugins loaded.</div>}
        </div>
      </div>

      {/* Other categories */}
      {orderedTypes.filter(t => t !== 'PAYMENT_GATEWAY').map((type) => {
        const meta = TYPE_META[type] || { label: type, icon: Plug, desc: '' };
        const Icon = meta.icon;
        const items = pluginsByType[type] || [];
        return (
          <div key={type} className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="font-semibold flex items-center gap-2"><Icon className="w-4 h-4 text-primary"/>{meta.label} <span className="text-xs text-muted-foreground font-normal">({type})</span></div>
              <div className="text-xs text-muted-foreground">{meta.desc}</div>
            </div>
            <div className="divide-y divide-border/70">
              {items.map((p: AnyObj) => (
                <div key={p.id || p.name} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold">{p.title || p.name || p.id}</div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted/40 font-mono">{p.id}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${p.status==='OK'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':'bg-red-500/10 text-red-400 border-red-500/20'}`}>{p.status || 'UNKNOWN'}</span>
                      {p.version && <span className="text-[10px] text-muted-foreground">v{p.version}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{p.description || 'No description'}</div>
                  </div>
                  {canReload && <button onClick={() => reload(p.id)} disabled={!!reloading} className="px-3 py-1.5 rounded-lg border border-border text-xs inline-flex items-center gap-1"><RotateCcw className="w-3 h-3"/>{reloading===p.id?'...':'Reload'}</button>}
                </div>
              ))}
              {!items.length && <div className="p-6 text-sm text-muted-foreground">No plugins loaded in this category.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}