'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Save, RefreshCw, ArrowLeft, ShieldCheck, KeyRound, Globe } from 'lucide-react';
import Link from 'next/link';

type AnyObj = Record<string, any>;

const GATEWAY_META: Record<string, { title: string; fields: { key: string; label: string; type?: string; placeholder?: string }[]; notes?: string }> = {
  bkash: {
    title: 'bKash Configuration',
    fields: [
      { key: 'app_key', label: 'App Key', placeholder: 'bKash app key' },
      { key: 'app_secret', label: 'App Secret', type: 'password', placeholder: 'bKash app secret' },
      { key: 'username', label: 'Username', placeholder: 'Tokenized checkout username' },
      { key: 'password', label: 'Password', type: 'password', placeholder: 'Tokenized checkout password' },
      { key: 'base_url', label: 'Base URL', placeholder: 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout' },
      { key: 'callback_url', label: 'Callback URL (optional)', placeholder: 'https://your-domain/api/billing/webhooks/bkash' },
    ],
    notes: 'Configure bKash Tokenized Checkout and Personal MFS settings. Sandbox/live credentials are stored in gateway config (DB). Webhook: /api/billing/webhooks/bkash. Personal MFS SMS ingest: /api/billing/payments/sms/ingest (plugin hook parses SMS).'
  },
  nagad: {
    title: 'Nagad Configuration',
    fields: [
      { key: 'merchant_id', label: 'Merchant ID' },
      { key: 'merchant_number', label: 'Merchant Number' },
      { key: 'public_key', label: 'Public Key' },
      { key: 'private_key', label: 'Private Key', type: 'password' },
      { key: 'base_url', label: 'Base URL', placeholder: 'https://sandbox.mynagad.com:30000/remote-payment-gateway-1.0' },
      { key: 'callback_url', label: 'Callback URL (optional)' },
    ],
    notes: 'Nagad merchant PGW configuration. Webhook: /api/billing/webhooks/nagad.'
  },
  rocket: {
    title: 'Rocket Configuration',
    fields: [
      { key: 'merchant_id', label: 'Merchant ID' },
      { key: 'merchant_account', label: 'Merchant Account' },
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'base_url', label: 'Base URL' },
      { key: 'callback_url', label: 'Callback URL (optional)' },
    ],
    notes: 'Rocket merchant PGW configuration. Webhook: /api/billing/webhooks/rocket.'
  },
  stripe: {
    title: 'Stripe Configuration',
    fields: [
      { key: 'publishable_key', label: 'Publishable Key' },
      { key: 'secret_key', label: 'Secret Key', type: 'password' },
      { key: 'webhook_signing_secret', label: 'Webhook Signing Secret', type: 'password' },
      { key: 'success_url', label: 'Success URL (optional)' },
      { key: 'cancel_url', label: 'Cancel URL (optional)' },
    ],
    notes: 'Stripe Elements/cards/Apple Pay/Google Pay configuration. Webhook: /api/billing/webhooks/stripe.'
  },
  paypal: {
    title: 'PayPal Configuration',
    fields: [
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
      { key: 'webhook_id', label: 'Webhook ID' },
      { key: 'base_url', label: 'Base URL', placeholder: 'https://api-m.sandbox.paypal.com' },
      { key: 'return_url', label: 'Return URL (optional)' },
      { key: 'cancel_url', label: 'Cancel URL (optional)' },
    ],
    notes: 'PayPal Smart Buttons configuration. Webhook: /api/billing/webhooks/paypal.'
  },
};

export default function GatewayConfigPage() {
  const params = useParams<{ gateway: string }>();
  const gateway = String(params?.gateway || '').toLowerCase();
  const meta = GATEWAY_META[gateway] || { title: `${gateway.toUpperCase()} Configuration`, fields: [] };
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [plugin, setPlugin] = useState<AnyObj | null>(null);
  const [cfg, setCfg] = useState<AnyObj | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'SANDBOX'|'LIVE'>('SANDBOX');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [cred, setCred] = useState<Record<string, string>>({});
  const [configJson, setConfigJson] = useState('{}');

  const canManage = user?.role === 'SUPER_ADMIN' || user?.role === 'BILLING_OPERATOR';

  const load = useCallback(async () => {
    if (!token || !gateway) return;
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<any>('/api/plugins/payment-gateways', {}, token);
      const item = (res.data || []).find((x: any) => String(x.gateway || '').toLowerCase() === gateway || String(x.id || '') === gateway || String(x.id || '') === `payment-${gateway}`);
      const cfgRow = item?.gatewayConfig || (res.configs || []).find((x: any) => String(x.gateway).toLowerCase() === gateway) || null;
      setPlugin(item || null);
      setCfg(cfgRow);
      setEnabled(!!cfgRow?.enabled);
      setMode((cfgRow?.mode || 'SANDBOX') as any);
      setConfigJson(JSON.stringify(cfgRow?.config || {}, null, 2));
      // credentials are not returned for security; keep local form state but don't overwrite with secrets from server
      // If user already typed, keep; else empty.
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [token, gateway]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!token) return;
    setSaving(true); setError(null); setMsg(null);
    try {
      let parsedConfig: any = {};
      try { parsedConfig = configJson.trim() ? JSON.parse(configJson) : {}; } catch { throw new Error('Config JSON is invalid'); }
      const credentials: Record<string, string> = {};
      Object.entries(cred).forEach(([k, v]) => { if (v != null && String(v).trim() !== '') credentials[k] = String(v); });
      const body: any = { enabled, mode, config: parsedConfig };
      if (Object.keys(credentials).length) body.credentials = credentials;
      if (webhookSecret.trim()) body.webhook_secret = webhookSecret.trim();
      const r = await apiFetch<any>(`/api/plugins/payment-gateways/${encodeURIComponent(gateway)}`, { method: 'POST', body: JSON.stringify(body) }, token);
      setMsg(`Saved ${gateway} configuration (${r?.gateway?.mode || mode}, ${enabled ? 'enabled' : 'disabled'}).`);
      setWebhookSecret('');
      setCred({});
      await load();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="page-header flex items-center justify-between gap-3">
        <div>
          <Link href="/plugins" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-1"><ArrowLeft className="w-3 h-3"/>Back to Plugins</Link>
          <h1 className="page-title">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">Plugins → Payment Gateways → {gateway}</p>
        </div>
        <div className="page-actions flex gap-2">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button>
          <button onClick={save} disabled={!canManage || saving} className="btn btn-primary"><Save className="w-4 h-4"/>{saving?'Saving...':'Save Configuration'}</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          <div className="card p-4 space-y-4">
            <h2 className="font-bold flex items-center gap-2"><Globe className="w-4 h-4 text-primary"/>Gateway Settings</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm"><div className="form-label">Enabled</div>
                <select className="form-select" value={enabled ? 'true':'false'} onChange={e=>setEnabled(e.target.value==='true')} disabled={!canManage}>
                  <option value="false">Disabled</option><option value="true">Enabled</option>
                </select>
              </label>
              <label className="text-sm"><div className="form-label">Mode</div>
                <select className="form-select" value={mode} onChange={e=>setMode(e.target.value as any)} disabled={!canManage}>
                  <option value="SANDBOX">SANDBOX</option><option value="LIVE">LIVE</option>
                </select>
              </label>
            </div>
            <label className="text-sm block"><div className="form-label">Webhook Secret / Signature Token (set/rotate)</div>
              <input type="password" className="form-control" placeholder={cfg?.has_webhook_secret ? '•••••• (leave blank to keep existing)' : 'Enter webhook secret'} value={webhookSecret} onChange={e=>setWebhookSecret(e.target.value)} disabled={!canManage} />
            </label>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Webhook endpoint (configure at provider): <code className="font-mono">https://&lt;your-domain&gt;/api/billing/webhooks/{gateway}</code></div>
              {gateway === 'bkash' && <div>Personal MFS SMS ingest: <code className="font-mono">https://&lt;your-domain&gt;/api/billing/payments/sms/ingest</code> (set <code className="font-mono">MFS_SMS_INGEST_TOKEN</code> for unauthenticated forwarders).</div>}
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <h2 className="font-bold flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary"/>Credentials</h2>
            <p className="text-xs text-muted-foreground">Enter values to set/update credentials. Leave a field blank to keep existing stored value unchanged. Credentials are not displayed after save.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {meta.fields.map(f => (
                <label key={f.key} className="text-sm">
                  <div className="form-label">{f.label}</div>
                  <input type={f.type || 'text'} className="form-control" placeholder={f.placeholder || f.label} value={cred[f.key] || ''} onChange={e=>setCred(prev=>({...prev,[f.key]: e.target.value}))} disabled={!canManage} />
                </label>
              ))}
              {!meta.fields.length && <div className="text-sm text-muted-foreground">No predefined fields; use Config JSON below for credentials/config.</div>}
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="font-bold">Advanced Config (JSON)</h2>
            <textarea className="form-control min-h-[180px] font-mono" value={configJson} onChange={e=>setConfigJson(e.target.value)} disabled={!canManage} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4 space-y-2 text-sm">
            <h2 className="font-bold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary"/>Plugin & Status</h2>
            <div><span className="text-muted-foreground">Plugin:</span> {plugin?.title || plugin?.name || `payment-${gateway}`}</div>
            <div><span className="text-muted-foreground">Version:</span> {plugin?.version || '-'}</div>
            <div><span className="text-muted-foreground">Status:</span> <span className={plugin?.status==='OK'?'text-emerald-400':''}>{plugin?.status || 'Unknown'}</span></div>
            <div><span className="text-muted-foreground">Configured:</span> {cfg ? `${cfg.mode} • ${cfg.enabled ? 'enabled':'disabled'}` : 'Not configured'}</div>
            <div><span className="text-muted-foreground">Credentials stored:</span> {cfg?.has_credentials ? 'Yes' : 'No'}</div>
            <div><span className="text-muted-foreground">Webhook secret:</span> {cfg?.has_webhook_secret ? 'Set' : 'Not set'}</div>
          </div>
          <div className="card p-4 text-xs text-muted-foreground space-y-2">
            <div className="font-semibold text-foreground">Notes</div>
            <p>{meta.notes || 'Configure this payment gateway plugin. Settings are stored in gateway config and used by the hot-reloadable plugin driver.'}</p>
            <p>Use <b>SANDBOX</b> for testing, then switch to <b>LIVE</b> with real credentials, webhook secrets and provider callback configuration.</p>
            {gateway === 'bkash' && <p>Personal MFS SMS hook supported by plugin; ingest via <code className="font-mono">POST /api/billing/payments/sms/ingest</code> (use <code>MFS_SMS_INGEST_TOKEN</code> if needed).</p>}
          </div>
        </div>
      </div>
    </div>
  );
}