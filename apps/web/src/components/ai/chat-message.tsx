'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bot, User, Copy, Volume2, Check, ExternalLink } from 'lucide-react';
import Markdown from './markdown';
import { useAuth } from '@/lib/auth-context';

/** Allowlisted actions emitted by the local intent engine or the external
 *  LLM (after server-side validation). Never trust arbitrary payloads. */
export type AiMessageAction =
  | { type: 'set_theme'; value: 'dark' | 'light' | 'toggle' }
  | { type: 'create_subscriber'; payload: {
      full_name: string; username: string; password: string;
      subscriber_type: string; connection_type: string; status: string;
    } }
  | { type: 'set_subscriber_status'; payload: { identifier: string; status: 'ACTIVE' | 'SUSPENDED' } }
  | { type: 'topup_reseller_wallet'; payload: { identifier: string; amount: number } }
  | { type: 'create_ticket'; payload: { subject: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; identifier?: string } }
  | { type: 'record_payment'; payload: { identifier: string; amount: number; gateway?: string; note?: string; trx_id?: string } }
  | { type: 'assign_package'; payload: { identifier: string; package_name: string; bandwidth_mbps?: number } }
  | { type: 'close_ticket'; payload: { ticket_no?: string; identifier?: string; status?: 'CLOSED' | 'RESOLVED' } }
  | { type: 'approve_kyc'; payload: { identifier: string; docId?: string } }
  | { type: 'reject_kyc'; payload: { identifier: string; docId?: string; reason?: string } };

export type AiMessage = {
  role: 'user' | 'assistant';
  content: string;
  cards?: Array<{ title: string; badge?: string; desc?: string; url?: string }>;
  provider?: string;
  intent?: string;
  meta?: Record<string, any>;
  action?: AiMessageAction;
};

export function speakReply(text: string, enabled: boolean) {
  if (!enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const clean = String(text).replace(/[#*`>|]/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 1200);
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = /[\u0980-\u09FF]/.test(clean) ? 'bn-BD' : 'en-US';
    window.speechSynthesis.speak(utter);
  } catch { /* speech is best-effort */ }
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be unavailable */ }
}

export default function ChatMessage({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  msg, index: _index, voice = false, compact = false, onAction,
}: { msg: AiMessage; index: number; voice?: boolean; compact?: boolean; onAction?: (action: AiMessageAction) => void }) {
  const [copied, setCopied] = useState(false);
  const appliedAction = useRef(false);
  const { theme, setTheme } = useAuth();
  const isUser = msg.role === 'user';
  const doCopy = async () => { await copyText(msg.content); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  // A Copilot theme command applies once, on the message that carried it.
  // The action is a closed allowlist from the local engine; never trust arbitrary payloads.
  useEffect(() => {
    const a = msg.action;
    if (msg.role !== 'assistant' || appliedAction.current || !a) return;
    appliedAction.current = true;
    if (a.type === 'set_theme') {
      if (a.value === 'toggle') setTheme(theme === 'dark' ? 'light' : 'dark');
      else setTheme(a.value);
    } else {
      onAction?.(a);
    }
  }, [msg.action, msg.role, theme, setTheme, onAction]);

  return (
    <div className={`flex gap-2 sm:gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <span className={`${compact ? 'w-7 h-7' : 'w-8 h-8'} rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0`}>
          <Bot className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        </span>
      )}
      <div className={`${compact ? 'max-w-[86%]' : 'max-w-[88%] sm:max-w-[82%]'} min-w-0 rounded-xl px-3 py-2.5 ${compact ? 'text-xs' : 'text-sm'} ${
        isUser ? 'bg-primary text-primary-foreground' : 'border border-border/70 bg-muted/20'
      }`}>
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        ) : (
          <>
            <Markdown text={msg.content} />
            {!!msg.cards?.length && (
              <div className="mt-3 space-y-2">
                {msg.cards.map((c, ci) => (
                  <Link key={ci} href={c.url || '#'} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border/60 bg-card/60 hover:border-primary/40 transition-colors text-xs">
                    <span className="min-w-0">
                      <span className="font-bold block truncate">{c.title}</span>
                      {!compact && c.desc && <span className="text-muted-foreground block truncate">{c.desc}</span>}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {c.badge && <span className="badge badge-primary">{c.badge}</span>}
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2 mt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              <button className="inline-flex items-center gap-1 hover:text-primary" onClick={() => void doCopy()}>
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy
              </button>
              <button className="inline-flex items-center gap-1 hover:text-primary" onClick={() => speakReply(msg.content, voice)}>
                <Volume2 className="w-3 h-3" /> Read
              </button>
              {msg.provider && <span className="ml-auto">via {msg.provider}</span>}
              {msg.meta?.restricted && <span className="badge badge-warning">restricted</span>}
            </div>
          </>
        )}
      </div>
      {isUser && (
        <span className={`${compact ? 'w-7 h-7' : 'w-8 h-8'} rounded-lg bg-muted flex items-center justify-center shrink-0`}>
          <User className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        </span>
      )}
    </div>
  );
}
