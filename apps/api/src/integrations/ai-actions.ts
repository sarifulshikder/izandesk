/**
 * Server-side executor for the AI Copilot's closed action allowlist.
 *
 * The web UI executes AIAction descriptors in the browser via
 * `apps/web/src/components/ai/use-ai-actions.ts`. That design is intentional:
 * the existing REST handlers own validation, RBAC, network provisioning and
 * audit logging. This module follows the same rule — it never reimplements a
 * mutation. It re-enters IzanDesk's own REST API with a short-lived, scoped
 * JWT minted for the resolved actor.
 *
 * Result: MCP writes go through exactly the same code path as a click in the
 * UI. No duplicated SQL, no divergent provisioning, no extra permission model.
 */
import jwt = require('jsonwebtoken');
import type { AIAction, AIActor, AICard } from './ai';

export type AiActionExecutorConfig = {
  /** Base URL of this API. Loopback by default; override in container setups. */
  apiBaseUrl: string;
  jwtSecret: string;
};

export type AiActionExecution = {
  ok: boolean;
  message: string;
  cards?: AICard[];
  raw?: any;
};

function mintToken(actor: AIActor, config: AiActionExecutorConfig): string {
  return jwt.sign(
    { sub: actor.id, role: actor.role, email: actor.email || actor.name || actor.id },
    config.jwtSecret,
    { expiresIn: '5m' },
  );
}

async function api<T = any>(
  config: AiActionExecutorConfig,
  actor: AIActor,
  path: string,
  init: { method?: string; body?: any } = {},
): Promise<T> {
  const token = mintToken(actor, config);
  const res = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Izan-Mcp': '1',
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data as T;
}

/** Resolve a search phrase to exactly one record — never guess between matches. */
async function one(config: AiActionExecutorConfig, actor: AIActor, path: string, label: string, identifier: string): Promise<any> {
  const res: any = await api(config, actor, path);
  const rows = Array.isArray(res?.data) ? res.data : [];
  if (!rows.length) throw new Error(`no ${label} matched "${identifier}"`);
  if (rows.length > 1) throw new Error(`${rows.length} ${label}s matched "${identifier}" — be more specific`);
  return rows[0];
}

function money(n: number) {
  return `৳${Number(n || 0).toFixed(2)}`;
}

/**
 * Execute a validated AIAction through IzanDesk's own REST API.
 * `set_theme` is intentionally excluded — it is a browser-only UI concern.
 */
export async function executeAiAction(
  action: AIAction,
  actor: AIActor,
  config: AiActionExecutorConfig,
): Promise<AiActionExecution> {
  if (action.type === 'set_theme') {
    return { ok: false, message: 'Theme changes apply to the web UI only and are not available over MCP.' };
  }

  const p: any = (action as any).payload || {};

  switch (action.type) {
    case 'create_subscriber': {
      const created: any = await api(config, actor, '/api/subscribers', { method: 'POST', body: p });
      return {
        ok: true,
        message: `Created ${created.full_name || p.full_name} (${created.client_code || 'no client code'}). ` +
          `Connection ${p.connection_type}, status ${created.status || p.status}.`,
        cards: [{ title: 'Open subscriber', url: `/clients?q=${encodeURIComponent(created.client_code || p.username)}` }],
        raw: created,
      };
    }

    case 'set_subscriber_status': {
      const sub = await one(config, actor, `/api/subscribers?q=${encodeURIComponent(p.identifier)}`, 'subscriber', p.identifier);
      const updated: any = await api(config, actor, `/api/subscribers/${sub.id}`, {
        method: 'PUT', body: { status: p.status },
      });
      return {
        ok: true,
        message: `${updated.full_name || sub.full_name} (${updated.client_code || sub.client_code || p.identifier}) is now ${updated.status || p.status}. Provisioning was applied.`,
        cards: [{ title: 'Open subscriber', url: `/subscribers/${sub.id}` }],
        raw: updated,
      };
    }

    case 'topup_reseller_wallet': {
      const reseller = await one(config, actor, `/api/resellers?q=${encodeURIComponent(p.identifier)}`, 'reseller', p.identifier);
      const result: any = await api(config, actor, `/api/resellers/${reseller.id}/wallet/recharge`, {
        method: 'POST', body: { amount: p.amount, description: 'MCP Copilot recharge' },
      });
      return {
        ok: true,
        message: `Recharged ${reseller.name} (${reseller.code || p.identifier}) by ${money(p.amount)}. New balance: ${money(result.balance || 0)}.`,
        cards: [{ title: 'Open reseller', url: `/resellers/${reseller.id}` }],
        raw: result,
      };
    }

    case 'create_ticket': {
      let subscriber_id: string | undefined;
      if (p.identifier) {
        const sub = await one(config, actor, `/api/subscribers?q=${encodeURIComponent(p.identifier)}`, 'subscriber', p.identifier);
        subscriber_id = sub.id;
      }
      const res: any = await api(config, actor, '/api/tickets', {
        method: 'POST',
        body: { subject: p.subject, priority: p.priority, source: 'MCP_COPILOT', ...(subscriber_id ? { subscriber_id } : {}) },
      });
      const ticket = res?.data || res;
      return {
        ok: true,
        message: `Ticket ${ticket.ticket_no || ''} created: "${ticket.subject || p.subject}" (${ticket.priority || p.priority}).`,
        cards: [{ title: 'Open ticket', url: `/tickets/${ticket.id}` }],
        raw: ticket,
      };
    }

    case 'record_payment': {
      // This endpoint resolves the identifier itself with exactly-one semantics,
      // so pass it through verbatim rather than shortcutting its validation.
      const res: any = await api(config, actor, '/api/billing/payments/record', {
        method: 'POST',
        body: {
          identifier: p.identifier,
          amount: p.amount,
          gateway: p.gateway || 'MCP_COPILOT',
          ...(p.note ? { note: p.note } : {}),
          ...(p.trx_id ? { trx_id: p.trx_id } : {}),
        },
      });
      const data = res?.data || {};
      return {
        ok: true,
        message: `Payment of ${money(p.amount)} recorded for ${p.identifier}${res?.duplicate ? ' (already recorded — not double-counted)' : ''}. Due left: ${money(data.due_left || 0)}.`,
        cards: [{ title: 'Collection report', url: '/collections' }],
        raw: res,
      };
    }

    case 'assign_package': {
      const sub = await one(config, actor, `/api/subscribers?q=${encodeURIComponent(p.identifier)}`, 'subscriber', p.identifier);
      const pkgs: any = await api(config, actor, '/api/network/packages');
      const list = pkgs?.data || [];
      const lower = String(p.package_name || '').toLowerCase();
      const pkg = list.find((x: any) =>
        String(x.name || '').toLowerCase() === lower || String(x.profile_name || '').toLowerCase() === lower);
      if (!pkg) throw new Error(`No package matched "${p.package_name}"`);
      const updated: any = await api(config, actor, `/api/subscribers/${sub.id}`, {
        method: 'PUT',
        body: { package_name: pkg.name || p.package_name, ...(p.bandwidth_mbps ? { bandwidth_mbps: p.bandwidth_mbps } : {}) },
      });
      return {
        ok: true,
        message: `${updated.full_name || sub.full_name || p.identifier} moved to package ${updated.package_name || pkg.name}.`,
        cards: [{ title: 'Open subscriber', url: `/subscribers/${sub.id}` }],
        raw: updated,
      };
    }

    case 'close_ticket': {
      const ref = p.ticket_no || p.identifier;
      const ticket = await one(config, actor, `/api/tickets?q=${encodeURIComponent(ref)}`, 'ticket', ref);
      const res: any = await api(config, actor, `/api/tickets/${ticket.id}`, {
        method: 'PUT', body: { status: p.status || 'CLOSED' },
      });
      const closed = res?.data || res;
      return {
        ok: true,
        message: `Ticket ${closed.ticket_no || ticket.ticket_no} set to ${closed.status || p.status || 'CLOSED'}.`,
        cards: [{ title: 'Tickets', url: '/tickets' }],
        raw: closed,
      };
    }

    case 'approve_kyc':
    case 'reject_kyc': {
      const match: any = await one(config, actor, `/api/subscribers?q=${encodeURIComponent(p.identifier)}`, 'subscriber', p.identifier);
      // The list view is intentionally lean; the detail endpoint includes KYC docs.
      const sub: any = await api(config, actor, `/api/subscribers/${match.id}`);
      const docs = (sub.kyc_documents || []) as any[];
      const doc = docs.find((d) => p.docId ? d.id === p.docId : (!d.status || d.status === 'PENDING'));
      if (!doc) throw new Error('No matching KYC document found for this subscriber');
      const result: any = await api(config, actor, `/api/subscribers/${sub.id}/kyc/${doc.id}/status`, {
        method: 'PUT',
        body: {
          status: action.type === 'approve_kyc' ? 'APPROVED' : 'REJECTED',
          ...(p.reason ? { reason: p.reason } : {}),
        },
      });
      return {
        ok: true,
        message: `KYC document ${doc.doc_type || doc.id} for ${sub.full_name || p.identifier} ${action.type === 'approve_kyc' ? 'approved' : 'rejected'}.`,
        raw: result,
      };
    }

    default:
      return { ok: false, message: `Unsupported action: ${(action as any).type}` };
  }
}
