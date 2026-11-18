'use client';

import { useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import type { AiMessage, AiMessageAction } from './chat-message';

/** Executes server-approved, allowlisted AI actions with the signed-in user's
 *  own token, so existing RBAC, validation and audit logs still apply. The AI
 *  never gets an API key and never supplies arbitrary request fields. */
export function useAiActions(onResult: (message: AiMessage) => void) {
  const { token } = useAuth();
  const working = useRef(false);

  return useCallback(async (action: AiMessageAction) => {
    if (working.current || !token || action.type === 'set_theme') return;
    working.current = true;
    const ok = (content: string, cards?: AiMessage['cards']) =>
      onResult({ role: 'assistant', intent: `${action.type}_result`, provider: 'local', content, cards });
    const fail = (error: any) =>
      onResult({
        role: 'assistant', intent: `${action.type}_error`, provider: 'local',
        content: `⚠️ Could not complete that action: ${error?.message || 'request failed'}`,
      });

    // Resolve a search query to exactly one record — never guess between matches.
    const one = async (path: string, label: string, identifier: string) => {
      const res = await apiFetch<any>(path, {}, token);
      const rows = res?.data || [];
      if (rows.length === 0) throw new Error(`no ${label} matched "${identifier}"`);
      if (rows.length > 1) throw new Error(`${rows.length} ${label}s matched "${identifier}" — be more specific`);
      return rows[0];
    };

    try {
      if (action.type === 'create_subscriber') {
        const created = await apiFetch<any>('/api/subscribers', { method: 'POST', body: JSON.stringify(action.payload) }, token);
        const p = action.payload;
        ok(`✅ Created **${created.full_name || p.full_name}** (\`${created.client_code || '—'}\`).\n\n` +
          `- ${created.subscriber_type === 'HOME' ? 'Home' : 'Subscriber'} · ${p.connection_type} · ${created.status || p.status}\n` +
          `- PPPoE user: \`${p.username}\`\n- PPPoE password: \`${p.password}\`\n\n` +
          `The portal login copy of the password was hashed and stored by the subscribers API.`,
          [{ title: 'Open subscriber list', url: `/clients?q=${encodeURIComponent(created.client_code || p.username)}` }]);
      } else if (action.type === 'set_subscriber_status') {
        const { identifier, status } = action.payload;
        const sub = await one(`/api/subscribers?q=${encodeURIComponent(identifier)}`, 'subscriber', identifier);
        const updated = await apiFetch<any>(`/api/subscribers/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status }) }, token);
        ok(`✅ **${updated.full_name || sub.full_name}** (\`${updated.client_code || sub.client_code}\`) is now **${updated.status || status}**.\n\n` +
          `Provisioning was applied by the subscribers API.`,
          [{ title: 'Open subscriber', url: `/subscribers/${sub.id}` }]);
      } else if (action.type === 'topup_reseller_wallet') {
        const { identifier, amount } = action.payload;
        const reseller = await one(`/api/resellers?q=${encodeURIComponent(identifier)}`, 'reseller', identifier);
        const result = await apiFetch<any>(`/api/resellers/${reseller.id}/wallet/recharge`, {
          method: 'POST', body: JSON.stringify({ amount, description: 'AI Copilot recharge' }),
        }, token);
        ok(`✅ Recharged **${reseller.name}** (\`${reseller.code || '—'}\`) by **৳${Number(amount).toFixed(2)}**.\n\n` +
          `New wallet balance: **৳${Number(result.balance || 0).toFixed(2)}**.`,
          [{ title: 'Open reseller', url: `/resellers/${reseller.id}` }]);
      } else if (action.type === 'create_ticket') {
        const { subject, priority, identifier } = action.payload;
        let subscriber_id: string | undefined;
        if (identifier) {
          const sub = await one(`/api/subscribers?q=${encodeURIComponent(identifier)}`, 'subscriber', identifier);
          subscriber_id = sub.id;
        }
        const result = await apiFetch<any>('/api/tickets', {
          method: 'POST',
          body: JSON.stringify({ subject, priority, source: 'AI_COPILOT', ...(subscriber_id ? { subscriber_id } : {}) }),
        }, token);
        const ticket = result.data || result;
        ok(`✅ Ticket **${ticket.ticket_no || ''}** created — "${ticket.subject || subject}" (${ticket.priority || priority}).`,
          [{ title: 'Open ticket', url: `/tickets/${ticket.id}` }]);
      }
    } catch (e: any) {
      fail(e);
    } finally {
      working.current = false;
    }
  }, [token, onResult]);
}
