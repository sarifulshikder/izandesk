'use client';

import { useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import type { AiMessage, AiMessageAction } from './chat-message';

/** Executes server-approved, allowlisted AI actions with the signed-in user's
 *  own token, so the existing subscriber RBAC, validation and audit log apply.
 *  The AI never gets an API key and never supplies arbitrary request fields. */
export function useAiActions(onResult: (message: AiMessage) => void) {
  const { token } = useAuth();
  const working = useRef(false);

  return useCallback(async (action: AiMessageAction) => {
    if (action.type !== 'create_subscriber' || working.current || !token) return;
    working.current = true;
    try {
      const created = await apiFetch<any>('/api/subscribers', {
        method: 'POST',
        body: JSON.stringify(action.payload),
      }, token);
      const p = action.payload;
      onResult({
        role: 'assistant',
        intent: 'create_subscriber_result',
        provider: 'local',
        content: `✅ Created **${created.full_name || p.full_name}** (\`${created.client_code || '—'}\`).\n\n` +
          `- ${created.subscriber_type === 'HOME' ? 'Home' : 'Subscriber'} · ${p.connection_type} · ${created.status || p.status}\n` +
          `- PPPoE user: \`${p.username}\`\n- PPPoE password: \`${p.password}\`\n\n` +
          `The portal login copy of the password was hashed and stored by the subscribers API.`,
        cards: [{ title: 'Open subscriber list', url: `/clients?q=${encodeURIComponent(created.client_code || p.username)}` }],
      });
    } catch (e: any) {
      onResult({
        role: 'assistant',
        intent: 'create_subscriber_error',
        provider: 'local',
        content: `⚠️ Could not create the subscriber: ${e?.message || 'request failed'}`,
      });
    } finally {
      working.current = false;
    }
  }, [token, onResult]);
}
