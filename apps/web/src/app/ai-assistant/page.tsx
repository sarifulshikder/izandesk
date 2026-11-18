'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles, Send, RotateCcw, Volume2, VolumeX, Download, Bot,
  Loader2, ShieldCheck, Globe2, Zap,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import ChatMessage, { speakReply, type AiMessage } from '@/components/ai/chat-message';
import { useAiActions } from '@/components/ai/use-ai-actions';

type Msg = AiMessage;

type Status = {
  ok?: boolean; available?: boolean; engine?: string; active_mode?: string;
  role?: string; capabilities?: string[]; quick_prompts?: string[];
  limits?: Record<string, number>; privacy?: string;
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', NOC_ENGINEER: 'NOC Engineer', BILLING_OPERATOR: 'Billing Operator',
  TECHNICIAN: 'Field Technician', RESELLER: 'Reseller',
};

export default function AiAssistantPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const handleActionResult = useCallback((m: AiMessage) => setMessages((prev) => [...prev, m]), []);
  const handleAction = useAiActions(handleActionResult);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [voice, setVoice] = useState(false);
  const [usage, setUsage] = useState<any>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [s, u] = await Promise.all([
        apiFetch<Status>('/api/ai/status', {}, token),
        apiFetch<any>('/api/ai/usage', {}, token).catch(() => ({ data: null })),
      ]);
      setStatus(s); setUsage(u.data || null);
    } catch (e: any) { setErr(e.message); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const speak = useCallback((text: string) => speakReply(text, voice), [voice]);

  const send = useCallback(async (text: string) => {
    const msg = String(text || '').trim();
    if (!token || !msg || busy || status?.available === false) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content })).slice(-20);
    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setInput(''); setBusy(true); setErr(null);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    try {
      const res = await apiFetch<any>('/api/ai/chat', {
        method: 'POST', body: JSON.stringify({ message: msg, history }),
      }, token);
      const reply: Msg = {
        role: 'assistant', content: res.reply || 'No reply returned.',
        cards: res.cards || [], provider: res.provider, intent: res.intent, meta: res.meta,
        action: res.action,
      };
      setMessages((prev) => [...prev, reply]);
      speak(res.reply || '');
      apiFetch<any>('/api/ai/usage', {}, token).then((u) => setUsage(u.data || null)).catch(() => {});
    } catch (e: any) {
      setErr(e.message);
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${e.message || 'Request failed.'}` }]);
    } finally { setBusy(false); inputRef.current?.focus(); }
  }, [token, busy, messages, status, speak]);

  const newChat = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setMessages([]); setErr(null); inputRef.current?.focus();
  };

  const exportChat = () => {
    if (!messages.length) return;
    const body = ['# IzanDesk AI Copilot — Chat Log', `Date: ${new Date().toLocaleString()}`, '']
      .concat(messages.flatMap((m) => [`### ${m.role === 'user' ? 'User' : 'IzanDesk AI'}`, m.content, '', '---', ''])).join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `izandesk-ai-chat-${Date.now()}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); }
  };
  const resize = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 130)}px`; };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <div className="page-title-icon"><Sparkles className="w-6 h-6" /></div>
          <div>
            <h1 className="page-title">AI Copilot</h1>
            <p className="page-subtitle">Bilingual, role-scoped answers from your live ISP data — free local engine, optional AI providers.</p>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-outline inline-flex items-center gap-2" onClick={() => setVoice((v) => !v)} title="Read replies aloud">
            {voice ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}<span className="hidden sm:inline">{voice ? 'Voice on' : 'Voice off'}</span>
          </button>
          <button className="btn btn-outline inline-flex items-center gap-2" onClick={exportChat} disabled={!messages.length}>
            <Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span>
          </button>
          <button className="btn btn-primary inline-flex items-center gap-2" onClick={newChat}>
            <RotateCcw className="w-4 h-4" />New chat
          </button>
        </div>
      </div>

      {err && <div className="alert alert-danger">{err}</div>}
      {status?.available === false && <div className="alert alert-warning">The AI Copilot is disabled by an administrator.</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Chat */}
        <div className="card xl:col-span-2 overflow-hidden min-w-0">
          <div className="card-header flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex w-8 h-8 rounded-lg bg-primary/10 text-primary items-center justify-center shrink-0"><Bot className="w-4 h-4" /></span>
              <div className="min-w-0">
                <div className="font-bold truncate">IzanDesk AI Copilot</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {status?.active_mode || 'Loading engine…'} · {ROLE_LABEL[status?.role || ''] || status?.role || 'staff'}
                </div>
              </div>
            </div>
            <span className="badge badge-success shrink-0"><span className="status-dot bg-emerald-500" /> Live</span>
          </div>

          <div className="card-body-sm p-0">
            <div className="h-[52vh] sm:h-[58vh] overflow-y-auto p-3 sm:p-4 space-y-4" aria-live="polite">
              {!messages.length && (
                <div className="py-8 max-w-xl mx-auto text-center space-y-4">
                  <div className="inline-flex w-14 h-14 rounded-2xl bg-primary/10 text-primary items-center justify-center">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg">Ask your ISP anything</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      Collections, subscribers, dues, expiry, routers, OLTs, tickets, leads, hotspot, inventory and package rates — in Bangla or English.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {(status?.quick_prompts || []).slice(0, 6).map((p) => (
                      <button key={p} className="filter-chip" onClick={() => void send(p)}>{p}</button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, idx) => (
                <ChatMessage key={idx} msg={m} index={idx} voice={voice} onAction={handleAction} />
              ))}

              {busy && (
                <div className="flex gap-3 items-center text-xs text-muted-foreground">
                  <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Bot className="w-4 h-4" /></span>
                  <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t border-border/60 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); resize(e.target); }}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder="Ask about collection, customers, routers…  (Enter to send, Shift+Enter for a new line)"
                  className="form-control resize-none min-h-[42px] max-h-[130px]"
                  disabled={busy || status?.available === false}
                />
                <button className="btn btn-primary h-[42px] w-[42px] p-0 inline-flex items-center justify-center shrink-0" onClick={() => void send(input)} disabled={busy || !input.trim() || status?.available === false} title="Send">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1.5">
                Answers come from live IzanDesk data and are scoped to your role. Never share passwords or secrets with the assistant.
              </div>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4 min-w-0">
          <div className="card p-4">
            <div className="font-bold flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Engine</div>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Mode</span><span className="font-medium text-right">{status?.active_mode || '—'}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Role</span><span className="font-medium">{ROLE_LABEL[status?.role || ''] || status?.role || '—'}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Limit</span><span className="font-medium">{status?.limits?.per_minute ?? 30}/min</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Today</span><span className="font-medium">{usage?.requests ?? 0} requests</span></div>
            </div>
            <div className="mt-3 flex items-start gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{status?.privacy || 'Local-only by default — data stays in IzanDesk.'}</span>
            </div>
          </div>

          <div className="card p-4">
            <div className="font-bold flex items-center gap-2"><Globe2 className="w-4 h-4 text-primary" /> Your capabilities</div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {(status?.capabilities || []).map((c) => <span key={c} className="badge badge-outline">{c.replace(/_/g, ' ')}</span>)}
            </div>
            <div className="divider my-3" />
            <div className="font-bold text-xs mb-2">Suggested questions</div>
            <div className="flex flex-wrap gap-2">
              {(status?.quick_prompts || []).map((p) => <button key={p} className="filter-chip" onClick={() => void send(p)}>{p}</button>)}
            </div>
          </div>

          <div className="card p-4 text-[11px] text-muted-foreground space-y-1">
            <div className="font-bold text-foreground text-xs">Tips</div>
            <div>• Type a customer ID, PPPoE username or phone number for an instant profile.</div>
            <div>• Ask in Bangla or English — the reply follows your language.</div>
            <div>• Use <span className="kbd">Enter</span> to send, <span className="kbd">Shift+Enter</span> for a new line.</div>
            <div>• Turn on Voice to hear replies read aloud.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
