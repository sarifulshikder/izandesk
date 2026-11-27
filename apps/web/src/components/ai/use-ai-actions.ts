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

    // Package lookup by name (case-insensitive) for assign_package actions.
    const findPackage = async (name: string): Promise<any | null> => {
      const pkgs = await apiFetch<any>('/api/network/packages', {}, token);
      const list = pkgs?.data || [];
      const lower = String(name || '').toLowerCase();
      return list.find((p: any) => String(p.name || '').toLowerCase() === lower || String(p.profile_name || '').toLowerCase() === lower) || null;
    };
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
        // Payment-gated activation: created-EXPIRED can't be activated by raw status PUT;
        // route through POST /api/subscribers/:id/renew (recorded payment == package price, single transaction).
        const isCreatedExpired = String(sub.status || '').toUpperCase() === 'EXPIRED' && String(sub.suspension_source || '').toUpperCase() === 'CREATION';
        if (String(status).toUpperCase() === 'ACTIVE' && isCreatedExpired) {
          const r = await apiFetch<any>(`/api/subscribers/${sub.id}/renew`, { method: 'POST', body: JSON.stringify({}) }, token);
          ok(`✅ **${r.subscriber?.full_name || sub.full_name}** (\`${r.subscriber?.client_code || sub.client_code}\`) recharged **৳${Number(r.amount || 0).toLocaleString()}** (payment recorded, no invoice) and is now **ACTIVE**.\n\nNew expiry: ${r.expiry_date || '-'}.`,
            [{ title: 'Open subscriber', url: `/subscribers/${sub.id}` }]);
        } else {
          const updated = await apiFetch<any>(`/api/subscribers/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status }) }, token);
          ok(`✅ **${updated.full_name || sub.full_name}** (\`${updated.client_code || sub.client_code}\`) is now **${updated.status || status}**.\n\n` +
            `Provisioning was applied by the subscribers API.`,
            [{ title: 'Open subscriber', url: `/subscribers/${sub.id}` }]);
        }
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
      } else if (action.type === 'record_payment') {
        const { identifier, amount, gateway, note, trx_id } = action.payload;
        const sub = await one(`/api/subscribers?q=${encodeURIComponent(identifier)}`, 'subscriber', identifier);
        // The API resolves the identifier itself (exactly-one semantics). Sending
        // a pre-resolved subscriber_id used to fail with "identifier is required".
        const res = await apiFetch<any>('/api/billing/payments/record', {
          method: 'POST',
          body: JSON.stringify({ identifier, amount, gateway, note, trx_id }),
        }, token);
        const data = res?.data || {};
        ok(`✅ Payment of **৳${Number(amount).toFixed(2)}** recorded for **${sub.full_name || identifier}** (${gateway || 'cash'}).${res?.duplicate ? ' (Already recorded — not double-counted.)' : ''} Due left: **৳${Number(data.due_left || 0).toFixed(2)}**.`,
          [{ title: 'View collection report', url: '/collections' }]);
      } else if (action.type === 'assign_package') {
        const { identifier, package_name, bandwidth_mbps } = action.payload;
        const sub = await one(`/api/subscribers?q=${encodeURIComponent(identifier)}`, 'subscriber', identifier);
        let pkg = await findPackage(package_name);
        if (!pkg && package_name) pkg = await findPackage(identifier).catch(() => null);
        if (!pkg) throw new Error(`No package matched "${package_name}"`);
        const body: Record<string, any> = { package_name: pkg.name || package_name };
        if (bandwidth_mbps) body.bandwidth_mbps = bandwidth_mbps;
        const updated = await apiFetch<any>(`/api/subscribers/${sub.id}`, { method: 'PUT', body: JSON.stringify(body) }, token);
        ok(`✅ **${sub.full_name || identifier}** moved to package **${updated.package_name || pkg.name || package_name}**.`,
          [{ title: 'Open subscriber', url: `/subscribers/${sub.id}` }]);
      } else if (action.type === 'close_ticket') {
        const { ticket_no, identifier, status } = action.payload;
        const t = await one(`/api/tickets?q=${encodeURIComponent(ticket_no || identifier || '')}`, 'ticket', ticket_no || identifier || '');
        const result = await apiFetch<any>(`/api/tickets/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: status || 'CLOSED' }) }, token);
        const ticket = result?.data || result;
        ok(`✅ Ticket **${ticket.ticket_no}** closed.`, [{ title: 'Open tickets', url: '/tickets' }]);
      } else if (action.type === 'approve_kyc' || action.type === 'reject_kyc') {
        const sub = await one(`/api/subscribers?q=${encodeURIComponent(action.payload.identifier)}`, 'subscriber', action.payload.identifier);
        // The list endpoint intentionally omits kyc_documents; fetch the detail view.
        const detail = await apiFetch<any>(`/api/subscribers/${sub.id}`, {}, token);
        const docs = ((detail?.kyc_documents || sub.kyc_documents || []) as any[]);
        const doc = docs.find((d) => !d.status || d.status === 'PENDING') || docs.find((d) => d.id === action.payload.docId);
        if (!doc) throw new Error('No pending KYC document found for this subscriber');
        const kycReason = (action.payload as { reason?: string }).reason;
        await apiFetch<any>(`/api/subscribers/${sub.id}/kyc/${doc.id}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: action.type === 'approve_kyc' ? 'APPROVED' : 'REJECTED', ...(kycReason ? { reason: kycReason } : {}) }),
        }, token);
        ok(`✅ KYC document **${doc.doc_type}** (${doc.file_name}) ${action.type === 'approve_kyc' ? 'approved' : 'rejected'} for **${sub.full_name || sub.client_code || action.payload.identifier}**.`);
      }
    } catch (e: any) {
      fail(e);
    } finally {
      working.current = false;
    }
  }, [token, onResult]);
}
