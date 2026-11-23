'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Send, MessageSquare, Bot, Smartphone, FileText } from 'lucide-react';

type AnyObj = Record<string, any>;

export default function MessagingPage() {
  const { token, user } = useAuth();
  const [channels, setChannels] = useState<AnyObj[]>([]);
  const [templates, setTemplates] = useState<AnyObj[]>([]);
  const [logs, setLogs] = useState<AnyObj[]>([]);
  const [, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [msg, setMsg] = useState<string|null>(null);
  const [test, setTest] = useState<any>({ channel_id:'', to:'', body:'Test SMS from IzanDesk Gateway Tester.', variables:'{}' });
  const [sending, setSending] = useState(false);

  const canManage = ['SUPER_ADMIN','BILLING_OPERATOR','NOC_ENGINEER'].includes(String(user?.role));

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const [c,t,l] = await Promise.all([
        apiFetch<any>('/api/messaging/channels', {}, token),
        apiFetch<any>('/api/messaging/templates', {}, token),
        apiFetch<any>('/api/messaging/logs?limit=100', {}, token),
      ]);
      setChannels(c.data || []); setTemplates(t.data || []); setLogs(l.data || []);
      if (!test.channel_id && (c.data||[]).length) setTest((v:any)=>({...v, channel_id: c.data[0].id}));
    } catch(e:any){ setErr(e.message); } finally { setLoading(false); }
  }, [token, test.channel_id]);

  useEffect(()=>{ load(); }, [load]);

  const sendTest = async () => {
    if (!token) return;
    setSending(true); setErr(null); setMsg(null);
    try {
      let variables: any = {};
      try { variables = test.variables ? JSON.parse(test.variables) : {}; } catch { throw new Error('Variables must be valid JSON'); }
      const r = await apiFetch<any>('/api/messaging/send-test', { method:'POST', body: JSON.stringify({ channel_id: test.channel_id || undefined, to: test.to || undefined, body: test.body, variables }) }, token);
      setMsg(`${r.result?.status || 'OK'}: ${r.result?.note || 'Message dispatched.'} (log ${r.log?.status || ''})`);
      await load();
    } catch(e:any){ setErr(e.message); } finally { setSending(false); }
  };

  const toggleChannel = async (ch:any) => {
    if (!token) return;
    try {
      await apiFetch(`/api/messaging/channels/${ch.id}`, { method:'PUT', body: JSON.stringify({ enabled: !ch.enabled }) }, token);
      await load();
    } catch(e:any){ setErr(e.message); }
  };

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Communications · Omnichannel delivery</span>
          <h1 className="page-title">Omnichannel Messaging</h1>
          <p className="page-subtitle">SMS (Local BD &amp; Twilio), WhatsApp Business API (invoice delivery), Telegram Bot (NOC alerts &amp; daily revenue summaries), templates, and gateway tester.</p>
        </div>
        <div className="page-actions"><button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4"/>Refresh</button></div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <div className="card p-4">
            <h2 className="card-title mb-3 flex items-center gap-2"><Smartphone className="w-4 h-4 text-primary"/>Messaging Channels</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {channels.map(ch => (
                <div key={ch.id} className="card card-body-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm">{ch.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{ch.channel_type} • {ch.provider} {ch.is_default ? '• default' : ''}</div>
                    </div>
                    <span className={`badge ${ch.enabled?'badge-success':'badge-secondary'}`}>{ch.enabled?'ENABLED':'DISABLED'}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-2">Credentials: {ch.has_credentials?'configured':'not set'} • Webhook secret: {ch.has_webhook_secret?'set':'not set'}</div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={()=>toggleChannel(ch)} disabled={!canManage} className="btn btn-outline btn-sm">{ch.enabled?'Disable':'Enable'}</button>
                  </div>
                </div>
              ))}
              {!channels.length && <div className="md:col-span-2"><div className="empty-panel">
                <span className="empty-panel-icon"><Smartphone className="w-5 h-5" /></span>
                <div>
                  <div className="text-sm font-semibold text-foreground">No channels configured</div>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-[280px] leading-relaxed">Add an SMS, WhatsApp or Telegram channel to start delivering customer notifications.</p>
                </div>
              </div></div>}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">Local BD SMS (e.g. GreenWeb) and Twilio international SMS are supported as channels. WhatsApp Business API supports invoice delivery (including invoice PDF links) and Telegram Bot supports NOC alerts and daily executive revenue summaries when provider credentials/tokens are configured.</div>
          </div>

          <div className="card p-4">
            <h2 className="card-title mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-primary"/>Message Templates</h2>
            <div className="table-wrap overflow-auto max-h-[320px]">
              <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Name</th><th className="px-3 py-2.5">Channel</th><th className="px-3 py-2.5">Purpose</th><th className="px-3 py-2.5">Preview</th></tr></thead>
                <tbody>{templates.map(t=>(
                  <tr key={t.id} className="border-b border-border/50 align-top"><td className="px-3 py-2.5 text-[11px] font-medium">{t.name}</td><td className="px-3 py-2.5 text-[11px]">{t.channel_type}</td><td className="px-3 py-2.5 text-[11px]">{t.purpose||'-'}</td><td className="px-3 py-2.5 text-[11px] text-muted-foreground max-w-[420px] truncate">{t.subject ? `[${t.subject}] ` : ''}{t.body}</td></tr>
                ))}{!templates.length && <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No templates.</td></tr>}</tbody>
              </table>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="card-title mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary"/>Delivery Logs</h2>
            <div className="table-wrap overflow-auto max-h-[320px]">
              <table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Time</th><th className="px-3 py-2.5">Channel</th><th className="px-3 py-2.5">Recipient</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Message</th></tr></thead>
                <tbody>{logs.map(l=>(
                  <tr key={l.id} className="border-b border-border/50 align-top"><td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">{l.created_at ? new Date(l.created_at).toLocaleString() : '-'}</td><td className="px-3 py-2.5 text-[11px]">{l.channel_type}<div className="text-muted-foreground">{l.provider}</div></td><td className="px-3 py-2.5 text-[11px]">{l.recipient || '-'}</td><td className="px-3 py-2.5 text-[11px]"><span className={`badge ${['SENT','SIMULATED'].includes(String(l.status))?'badge-success':String(l.status)==='FAILED'?'badge-danger':'badge-secondary'}`}>{l.status}</span></td><td className="px-3 py-2.5 text-[11px] text-muted-foreground max-w-[360px] truncate" title={l.body||''}>{l.body}</td></tr>
                ))}{!logs.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No messages sent yet.</td></tr>}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-4 space-y-3">
            <h2 className="card-title"><Send className="w-4 h-4 text-primary"/>Gateway Tester (Dispatch Test SMS)</h2>
            <p className="text-xs text-muted-foreground">Select an SMS/messaging channel and send a test message. If live provider credentials are not configured, the gateway returns a simulated dispatch and logs it for verification.</p>
            <label className="block text-sm"><div className="form-label">Channel</div>
              <select className="form-select" value={test.channel_id} onChange={e=>setTest({...test,channel_id:e.target.value})}>
                <option value="">Select channel...</option>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name} ({c.channel_type}/{c.provider}){c.enabled?'':' [disabled]'}</option>)}
              </select>
            </label>
            <label className="block text-sm"><div className="form-label">Recipient / To (phone, WhatsApp number, or Telegram chat id)</div>
              <input className="form-control" value={test.to} onChange={e=>setTest({...test,to:e.target.value})} placeholder="e.g. +8801XXXXXXXXX or chat id" />
            </label>
            <label className="block text-sm"><div className="form-label">Message</div>
              <textarea className="form-control min-h-[100px]" value={test.body} onChange={e=>setTest({...test,body:e.target.value})} />
            </label>
            <label className="block text-sm"><div className="form-label">Template Variables (JSON, optional)</div>
              <textarea className="form-control min-h-[70px] font-mono" value={test.variables} onChange={e=>setTest({...test,variables:e.target.value})} />
            </label>
            <button onClick={sendTest} disabled={sending || (!test.channel_id)} className="btn btn-primary w-full"><Send className="w-4 h-4"/>{sending?'Sending...':'Dispatch Test Message'}</button>
            <div className="text-[11px] text-muted-foreground">Tip: pick a BD Local SMS channel (GreenWeb) or Twilio SMS channel to test SMS dispatch as per verification milestone.</div>
          </div>

          <div className="card p-4 space-y-2 text-sm">
            <h2 className="card-title"><Bot className="w-4 h-4 text-primary"/>Automation Channels</h2>
            <div className="text-xs text-muted-foreground space-y-2">
              <p><b>WhatsApp Business API:</b> template/message delivery supported; invoice delivery can include invoice PDF links (configure access token & phone number id).</p>
              <p><b>Telegram Bot:</b> NOC alerts and daily executive revenue summaries supported (configure bot token and chat id).</p>
              <p><b>SMS:</b> Local Bangladesh gateways (GreenWeb) and Twilio international SMS.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
