'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Send, MessageSquare, Mail, Bot, Smartphone, FileText, CheckCircle2 } from 'lucide-react';

type AnyObj = Record<string, any>;

export default function MessagingPage() {
  const { token, user } = useAuth();
  const [channels, setChannels] = useState<AnyObj[]>([]);
  const [templates, setTemplates] = useState<AnyObj[]>([]);
  const [logs, setLogs] = useState<AnyObj[]>([]);
  const [loading, setLoading] = useState(false);
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
  }, [token]);

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

  const smsChannels = channels.filter(c=>String(c.channel_type).toUpperCase()==='SMS');

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Omnichannel Messaging</h1>
          <p className="text-sm text-muted-foreground">SMS (Local BD & Twilio), WhatsApp Business API (invoice delivery), Telegram Bot (NOC alerts & daily revenue summaries), templates, and gateway tester.</p>
        </div>
        <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/>Refresh</button>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><Smartphone className="w-4 h-4 text-primary"/>Messaging Channels</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {channels.map(ch => (
                <div key={ch.id} className="p-4 rounded-xl border border-border bg-muted/20">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm">{ch.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{ch.channel_type} • {ch.provider} {ch.is_default ? '• default' : ''}</div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${ch.enabled?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':'bg-muted text-muted-foreground border-border'}`}>{ch.enabled?'ENABLED':'DISABLED'}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-2">Credentials: {ch.has_credentials?'configured':'not set'} • Webhook secret: {ch.has_webhook_secret?'set':'not set'}</div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={()=>toggleChannel(ch)} disabled={!canManage} className="px-3 py-1.5 rounded-lg border border-border text-xs disabled:opacity-50">{ch.enabled?'Disable':'Enable'}</button>
                  </div>
                </div>
              ))}
              {!channels.length && <div className="text-sm text-muted-foreground">No channels configured.</div>}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">Local BD SMS (e.g. GreenWeb) and Twilio international SMS are supported as channels. WhatsApp Business API supports invoice delivery (including invoice PDF links) and Telegram Bot supports NOC alerts and daily executive revenue summaries when provider credentials/tokens are configured.</div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-primary"/>Message Templates</h2>
            <div className="overflow-auto max-h-[320px]">
              <table className="w-full text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Name</th><th className="text-left py-2 px-2">Channel</th><th className="text-left py-2 px-2">Purpose</th><th className="text-left py-2 px-2">Preview</th></tr></thead>
                <tbody>{templates.map(t=>(
                  <tr key={t.id} className="border-b border-border/50 align-top"><td className="py-2 px-2 font-medium">{t.name}</td><td className="py-2 px-2">{t.channel_type}</td><td className="py-2 px-2">{t.purpose||'-'}</td><td className="py-2 px-2 text-muted-foreground max-w-[420px] truncate">{t.subject ? `[${t.subject}] ` : ''}{t.body}</td></tr>
                ))}{!templates.length && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No templates.</td></tr>}</tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary"/>Delivery Logs</h2>
            <div className="overflow-auto max-h-[320px]">
              <table className="w-full text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Time</th><th className="text-left py-2 px-2">Channel</th><th className="text-left py-2 px-2">Recipient</th><th className="text-left py-2 px-2">Status</th><th className="text-left py-2 px-2">Message</th></tr></thead>
                <tbody>{logs.map(l=>(
                  <tr key={l.id} className="border-b border-border/50 align-top"><td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{l.created_at ? new Date(l.created_at).toLocaleString() : '-'}</td><td className="py-2 px-2">{l.channel_type}<div className="text-muted-foreground">{l.provider}</div></td><td className="py-2 px-2">{l.recipient || '-'}</td><td className="py-2 px-2"><span className={`px-2 py-0.5 rounded-full border ${['SENT','SIMULATED'].includes(String(l.status))?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':String(l.status)==='FAILED'?'bg-red-500/10 text-red-400 border-red-500/20':'bg-muted text-muted-foreground border-border'}`}>{l.status}</span></td><td className="py-2 px-2 text-muted-foreground max-w-[360px] truncate" title={l.body||''}>{l.body}</td></tr>
                ))}{!logs.length && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No messages sent yet.</td></tr>}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h2 className="font-bold flex items-center gap-2"><Send className="w-4 h-4 text-primary"/>Gateway Tester (Dispatch Test SMS)</h2>
            <p className="text-xs text-muted-foreground">Select an SMS/messaging channel and send a test message. If live provider credentials are not configured, the gateway returns a simulated dispatch and logs it for verification.</p>
            <label className="block text-sm"><div className="text-xs text-muted-foreground mb-1">Channel</div>
              <select className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" value={test.channel_id} onChange={e=>setTest({...test,channel_id:e.target.value})}>
                <option value="">Select channel...</option>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name} ({c.channel_type}/{c.provider}){c.enabled?'':' [disabled]'}</option>)}
              </select>
            </label>
            <label className="block text-sm"><div className="text-xs text-muted-foreground mb-1">Recipient / To (phone, WhatsApp number, or Telegram chat id)</div>
              <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" value={test.to} onChange={e=>setTest({...test,to:e.target.value})} placeholder="e.g. +8801XXXXXXXXX or chat id" />
            </label>
            <label className="block text-sm"><div className="text-xs text-muted-foreground mb-1">Message</div>
              <textarea className="w-full p-2.5 rounded-xl border border-border bg-card text-sm min-h-[100px]" value={test.body} onChange={e=>setTest({...test,body:e.target.value})} />
            </label>
            <label className="block text-sm"><div className="text-xs text-muted-foreground mb-1">Template Variables (JSON, optional)</div>
              <textarea className="w-full p-2.5 rounded-xl border border-border bg-card text-xs min-h-[70px] font-mono" value={test.variables} onChange={e=>setTest({...test,variables:e.target.value})} />
            </label>
            <button onClick={sendTest} disabled={sending || (!test.channel_id)} className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"><Send className="w-4 h-4"/>{sending?'Sending...':'Dispatch Test Message'}</button>
            <div className="text-[11px] text-muted-foreground">Tip: pick a BD Local SMS channel (GreenWeb) or Twilio SMS channel to test SMS dispatch as per verification milestone.</div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-2 text-sm">
            <h2 className="font-bold flex items-center gap-2"><Bot className="w-4 h-4 text-primary"/>Automation Channels</h2>
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
