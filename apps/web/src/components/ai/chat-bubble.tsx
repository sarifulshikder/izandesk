'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles, X, Send, RotateCcw, Volume2, VolumeX, Bot,
  Loader2, Maximize2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import ChatMessage, { speakReply, type AiMessage } from './chat-message';
import { useAiActions } from './use-ai-actions';

/** Floating quick-access assistant, mounted in the app shell so it is
 *  available on every staff/reseller page. State survives navigation because
 *  the shell stays mounted across route changes. */
export default function AiChatBubble() {
  const pathname = usePathname();
  const { token, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const handleActionResult = useCallback((m: AiMessage) => setMessages((prev) => [...prev, m]), []);
  const handleAction = useAiActions(handleActionResult);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hidden = pathname === '/ai-assistant' || !user;

  const loadStatus = useCallback(async () => {
    if (!token) return;
    try { setStatus(await apiFetch<any>('/api/ai/status', {}, token)); } catch { /* non-critical */ }
  }, [token]);

  useEffect(() => { if (!hidden) void loadStatus(); }, [hidden, loadStatus]);
  // The full page supersedes the widget — don't leave its panel hanging open.
  useEffect(() => { if (pathname === '/ai-assistant') setOpen(false); }, [pathname]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy, open]);

  const send = useCallback(async (text: string) => {
    const msg = String(text || '').trim();
    if (!token || !msg || busy) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content })).slice(-20);
    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setInput(''); setBusy(true); setErr(null);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    try {
      const res = await apiFetch<any>('/api/ai/chat', {
        method: 'POST', body: JSON.stringify({ message: msg, history }),
      }, token);
      const reply: AiMessage = {
        role: 'assistant', content: res.reply || 'No reply returned.',
        cards: res.cards || [], provider: res.provider, intent: res.intent, meta: res.meta,
        action: res.action,
      };
      setMessages((prev) => [...prev, reply]);
      speakReply(res.reply || '', voice);
    } catch (e: any) {
      setErr(e.message);
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${e.message || 'Request failed.'}` }]);
    } finally { setBusy(false); inputRef.current?.focus(); }
  }, [token, busy, messages, voice]);

  const newChat = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setMessages([]); setErr(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); }
  };
  const resize = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 100)}px`; };

  if (hidden) return null;

  return (
    <div className="fixed z-50 bottom-20 lg:bottom-6 right-3 lg:right-6 flex flex-col items-end gap-3 pointer-events-none">
      {open && (
        <div className="pointer-events-auto w-[calc(100vw-1.5rem)] sm:w-[380px] h-[62vh] sm:h-[540px] max-h-[calc(100dvh-9rem)] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
          {/* header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/70 bg-muted/20 shrink-0">
            <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm truncate">AI Copilot</div>
              <div className="text-[10px] text-muted-foreground truncate">{status?.active_mode || 'Live assistant'}</div>
            </div>
            <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" onClick={() => setVoice((v) => !v)} title={voice ? 'Voice on' : 'Voice off'}>
              {voice ? <Volume2 className="w-4 h-4 text-primary" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" onClick={newChat} title="New chat">
              <RotateCcw className="w-4 h-4" />
            </button>
            <Link href="/ai-assistant" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="Open full assistant" onClick={() => setOpen(false)}>
              <Maximize2 className="w-4 h-4" />
            </Link>
            <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" onClick={() => setOpen(false)} title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0" aria-live="polite">
            {!messages.length && (
              <div className="space-y-3 pt-2">
                <div className="text-center space-y-1">
                  <Sparkles className="w-6 h-6 mx-auto text-primary" />
                  <p className="text-xs font-semibold">Ask your ISP anything</p>
                  <p className="text-[11px] text-muted-foreground">Bangla or English · scoped to your role</p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {(status?.quick_prompts || []).slice(0, 5).map((p: string) => (
                    <button key={p} className="filter-chip text-[11px]" onClick={() => void send(p)}>{p}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, idx) => <ChatMessage key={idx} msg={m} index={idx} voice={voice} compact onAction={handleAction} />)}
            {busy && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Bot className="w-4 h-4 text-primary" /><Loader2 className="w-3 h-3 animate-spin" /> Thinking…
              </div>
            )}
            {err && <div className="alert alert-danger text-[11px] py-2">{err}</div>}
            <div ref={endRef} />
          </div>

          {/* composer */}
          <div className="border-t border-border/70 p-2.5 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); resize(e.target); }}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Ask about collection, customers, routers…"
                className="form-control resize-none min-h-[38px] max-h-[100px] text-xs"
                disabled={busy || status?.available === false}
              />
              <button
                className="btn btn-primary h-[38px] w-[38px] p-0 inline-flex items-center justify-center shrink-0"
                onClick={() => void send(input)}
                disabled={busy || !input.trim() || status?.available === false}
                title="Send"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 text-center">
              Enter to send · Shift+Enter for a new line
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open) void loadStatus(); }}
        className="pointer-events-auto w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl hover:scale-105 transition-transform flex items-center justify-center relative"
        title={open ? 'Close AI Copilot' : 'Open AI Copilot'}
        aria-label={open ? 'Close AI Copilot' : 'Open AI Copilot'}
      >
        {open ? <X className="w-5 h-5" /> : <Sparkles className="w-6 h-6" />}
        {!open && <span className="absolute -top-1 -right-1 badge badge-warning text-[9px] px-1.5">AI</span>}
      </button>
    </div>
  );
}
