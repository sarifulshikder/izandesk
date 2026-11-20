/**
 * IzanDesk MCP server — Model Context Protocol over Streamable HTTP.
 *
 * Design principles
 *  - Thin adapter: query tools call the existing role-scoped, bilingual AI
 *    engine (`askAI`) in forced-local mode. No data logic is duplicated.
 *  - Action tools build a validated, closed `AIAction` from MCP arguments and
 *    execute it through IzanDesk's own REST API (`ai-actions.ts`).
 *  - Least privilege: tool lists are filtered by the resolved actor's role and
 *    by API-key scope; read-only keys never see a mutating tool.
 *  - Human in the loop: every mutating tool requires `confirm: true` and is
 *    annotated `destructiveHint` where appropriate.
 *  - Everything is audited with action `MCP_TOOL_CALL`.
 *
 * Protocol: supports both the stateless 2026-07-28 revision (`server/discover`,
 * per-request `_meta`) and the initialization-based 2024-11-05 … 2025-11-25
 * revisions (`initialize`) used by Claude Desktop, Cursor and Claude Code.
 */
import { runAIIntent, capabilitiesFor, type AIActor, type AIResult } from './ai';
import type { AIAction } from './ai';
import { executeAiAction, type AiActionExecutorConfig } from './ai-actions';
import { auditLog } from './audit';

export const MCP_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_SERVER_VERSION = '1.0.0';
const CURRENT_VERSION = MCP_VERSIONS[0];

export type McpActorSource = 'jwt' | 'api_key';

export type McpContext = {
  pool: any;
  actor: AIActor;
  actorSource: McpActorSource;
  keyId?: string;
  keyName?: string;
  readOnly?: boolean;
  allowedTools?: string[] | null;
  executor: AiActionExecutorConfig;
  ip?: string | null;
  clientInfo?: { name?: string; version?: string };
  protocolVersion?: string;
};

type JsonSchema = Record<string, any>;

type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
  kind: 'query' | 'action';
  intent?: string;
  actionType?: AIAction['type'];
  category: string;
  prompt?: (args: Record<string, any>) => string;
};

const str = (v: any) => String(v ?? '');
const identifierProp = {
  type: 'string',
  minLength: 2,
  maxLength: 128,
  description: 'Client code, subscriber ID, username or exact name. Must resolve to a single record.',
};
const confirmProp = {
  type: 'boolean',
  const: true,
  description: 'Omit on the first call to receive a confirmation prompt. Set to true only after the user approves. This tool changes live ISP data and is audited.',
};

/** Closed tool catalog. Names are stable; descriptions are written for LLMs. */
export const MCP_TOOLS: McpTool[] = [
  // ── Meta tools (progressive discovery, like Splynx) ────────────────────────
  {
    name: 'search_izandesk_tools',
    title: 'Find IzanDesk tools',
    description: 'Search the available IzanDesk tools by keyword or category. Returns only tools this account is allowed to call. Use get_izandesk_tool_schema before calling an unfamiliar tool.',
    category: 'meta', kind: 'query',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 120, description: 'Words describing the task, e.g. "unpaid invoices", "router health", "suspend customer".' },
        category: { type: 'string', description: 'Optional category: finance, subscribers, network, support, crm, inventory, resellers, actions, meta.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_izandesk_tool_schema',
    title: 'Describe an IzanDesk tool',
    description: 'Return the full input schema, safety annotations and role requirement for one IzanDesk tool.',
    category: 'meta', kind: 'query',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { name: { type: 'string', minLength: 1, maxLength: 128, description: 'Exact tool name from search_izandesk_tools or tools/list.' } },
      required: ['name'],
    },
  },

  // ── Read-only operational tools ────────────────────────────────────────────
  {
    name: 'izandesk_overview', title: 'IzanDesk capability overview',
    description: 'Explain what this MCP server can do and what the connected account is allowed to access. Safe, read-only.',
    category: 'meta', kind: 'query', intent: 'help',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_collections_today', title: "Today's collections",
    description: "Today's collected amount, transaction count and payment gateway breakdown. Role: billing staff and resellers (scoped).",
    category: 'finance', kind: 'query', intent: 'collection_today',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_revenue_month', title: 'Monthly revenue',
    description: 'Revenue totals for the current month and last 30 days. Billing staff only.',
    category: 'finance', kind: 'query', intent: 'revenue_month',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_dues', title: 'Customer dues',
    description: 'Outstanding dues summary and the customers with unpaid bills, ordered by amount. Scoped to the connected reseller where applicable.',
    category: 'finance', kind: 'query', intent: 'dues',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_payment_gateways', title: 'Payment gateway breakdown',
    description: 'Collection split by bKash, Nagad, cash and other gateways.',
    category: 'finance', kind: 'query', intent: 'payment_gateways',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_staff_collections', title: 'Staff collections',
    description: 'Collections attributed to individual staff members. Billing staff only.',
    category: 'finance', kind: 'query', intent: 'staff_collection',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_subscriber_stats', title: 'Subscriber statistics',
    description: 'Total, active, suspended, pending and expired subscriber counts plus MRR.',
    category: 'subscribers', kind: 'query', intent: 'customer_stats',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_customer_lookup', title: 'Look up a customer',
    description: 'Profile, dues, status, package and KYC state for one subscriber. Identifier must match exactly one record.',
    category: 'subscribers', kind: 'query', intent: 'customer_lookup',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { identifier: identifierProp }, required: ['identifier'],
    },
    prompt: (a) => `customer ${str(a.identifier)} profile`,
  },
  {
    name: 'izandesk_new_connections', title: 'New connections',
    description: 'Recently installed or newly created subscriber connections.',
    category: 'subscribers', kind: 'query', intent: 'new_connections',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_expiring_subscribers', title: 'Expiring subscribers',
    description: 'Subscribers whose service expires within the next seven days.',
    category: 'subscribers', kind: 'query', intent: 'expiry',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_online_users', title: 'Online PPPoE users',
    description: 'Current active broadband sessions and live aggregate RX/TX throughput.',
    category: 'network', kind: 'query', intent: 'online_users',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_router_health', title: 'Router health',
    description: 'Router/NAS online status, latency and telemetry summary.',
    category: 'network', kind: 'query', intent: 'router_health',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_olt_health', title: 'OLT / ONU health',
    description: 'OLT reachability and ONU optical status across managed PON networks.',
    category: 'network', kind: 'query', intent: 'olt_health',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_subscriber_live', title: 'Live subscriber session',
    description: 'Live bandwidth and RADIUS session detail for one subscriber.',
    category: 'network', kind: 'query', intent: 'subscriber_live',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { identifier: identifierProp }, required: ['identifier'],
    },
    prompt: (a) => `live session ${str(a.identifier)}`,
  },
  {
    name: 'izandesk_subscriber_onu', title: 'Subscriber ONU details',
    description: 'Linked ONU, PON port and optical readings for one subscriber.',
    category: 'network', kind: 'query', intent: 'subscriber_onu',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { identifier: identifierProp }, required: ['identifier'],
    },
    prompt: (a) => `ONU ${str(a.identifier)}`,
  },
  {
    name: 'izandesk_tickets', title: 'Tickets',
    description: 'Open tickets, SLA breaches and assignment. Scoped to the connected technician or reseller where applicable.',
    category: 'support', kind: 'query', intent: 'tickets',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_leads', title: 'Sales leads',
    description: 'Lead pipeline summary and recent leads.',
    category: 'crm', kind: 'query', intent: 'leads',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_reseller_wallets', title: 'Reseller wallets',
    description: 'Reseller wallet balances, count and top-up activity.',
    category: 'resellers', kind: 'query', intent: 'reseller_wallet',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_hotspot_vouchers', title: 'Hotspot vouchers',
    description: 'Hotspot voucher inventory, activations and expiry summary.',
    category: 'network', kind: 'query', intent: 'hotspot',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_inventory', title: 'Inventory stock',
    description: 'Stock levels, low-stock alerts and serial-tracked ONU inventory.',
    category: 'inventory', kind: 'query', intent: 'inventory',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_packages', title: 'Package / tariff rates',
    description: 'Internet package names, speeds and prices.',
    category: 'subscribers', kind: 'query', intent: 'packages',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_kyc_queue', title: 'KYC queue',
    description: 'Pending KYC documents and verification status.',
    category: 'crm', kind: 'query', intent: 'kyc',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'izandesk_gis_sites', title: 'GIS fibre sites',
    description: 'Areas, zones, distribution boxes and fibre route coverage summary.',
    category: 'network', kind: 'query', intent: 'gis_sites',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },

  // ── Mutating tools — all require confirm:true ─────────────────────────────
  {
    name: 'izandesk_create_subscriber', title: 'Create subscriber',
    description: 'Create a new subscriber with PPPoE credentials. Super Admin only. Requires confirm:true. Provisions the account through the subscribers API.',
    category: 'actions', kind: 'action', actionType: 'create_subscriber', intent: 'create_subscriber',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        full_name: { type: 'string', minLength: 2, maxLength: 160 },
        username: { type: 'string', minLength: 3, maxLength: 64, pattern: '^[A-Za-z0-9._@-]+$' },
        password: { type: 'string', minLength: 6, maxLength: 128 },
        subscriber_type: { type: 'string', enum: ['HOME', 'BUSINESS'], default: 'HOME' },
        connection_type: { type: 'string', enum: ['PPPOE', 'STATIC_IP', 'DHCP', 'HOTSPOT', 'LEASED_LINE_CIR'], default: 'PPPOE' },
        status: { type: 'string', enum: ['PENDING', 'ACTIVE', 'SUSPENDED'], default: 'PENDING' },
        confirm: confirmProp,
      },
      required: ['full_name', 'username', 'password', 'subscriber_type', 'connection_type', 'status'],
    },
  },
  {
    name: 'izandesk_set_subscriber_status', title: 'Suspend or activate subscriber',
    description: 'Change a subscriber to ACTIVE or SUSPENDED. Super Admin only. Applies RADIUS/MikroTik provisioning. Requires confirm:true.',
    category: 'actions', kind: 'action', actionType: 'set_subscriber_status', intent: 'set_subscriber_status',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { identifier: identifierProp, status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] }, confirm: confirmProp },
      required: ['identifier', 'status'],
    },
  },
  {
    name: 'izandesk_record_payment', title: 'Record a payment',
    description: 'Record a payment against one subscriber and auto-reactivate service if due is cleared. Billing staff only. Amounts are capped at 100000. Requires confirm:true.',
    category: 'actions', kind: 'action', actionType: 'record_payment', intent: 'record_payment',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        identifier: identifierProp,
        amount: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
        gateway: { type: 'string', maxLength: 40 },
        note: { type: 'string', maxLength: 300 },
        trx_id: { type: 'string', maxLength: 80 },
        confirm: confirmProp,
      },
      required: ['identifier', 'amount'],
    },
  },
  {
    name: 'izandesk_assign_package', title: 'Change subscriber package',
    description: 'Move a subscriber to a named package. Super Admin and Billing only. Requires confirm:true.',
    category: 'actions', kind: 'action', actionType: 'assign_package', intent: 'assign_package',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        identifier: identifierProp,
        package_name: { type: 'string', minLength: 1, maxLength: 120 },
        bandwidth_mbps: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
        confirm: confirmProp,
      },
      required: ['identifier', 'package_name'],
    },
  },
  {
    name: 'izandesk_create_ticket', title: 'Create a support ticket',
    description: 'Create a ticket, optionally linked to a subscriber. Super Admin only (AI Copilot permission). Requires confirm:true.',
    category: 'actions', kind: 'action', actionType: 'create_ticket', intent: 'create_ticket',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        subject: { type: 'string', minLength: 3, maxLength: 120 },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
        identifier: { ...identifierProp, description: 'Optional subscriber to link the ticket to.' },
        confirm: confirmProp,
      },
      required: ['subject', 'priority'],
    },
  },
  {
    name: 'izandesk_close_ticket', title: 'Close or resolve a ticket',
    description: 'Set a ticket status to CLOSED or RESOLVED. Billing and technicians. Requires confirm:true.',
    category: 'actions', kind: 'action', actionType: 'close_ticket', intent: 'close_ticket',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        ticket_no: { type: 'string', minLength: 2, maxLength: 80, description: 'Ticket number. If omitted, identifier is used.' },
        identifier: { type: 'string', minLength: 2, maxLength: 80 },
        status: { type: 'string', enum: ['CLOSED', 'RESOLVED'], default: 'CLOSED' },
        confirm: confirmProp,
      },
      required: [],
    },
  },
  {
    name: 'izandesk_approve_kyc', title: 'Approve KYC document',
    description: 'Approve the pending KYC document for a subscriber. Billing and technicians. Requires confirm:true.',
    category: 'actions', kind: 'action', actionType: 'approve_kyc', intent: 'approve_kyc',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { identifier: identifierProp, docId: { type: 'string', maxLength: 80 }, confirm: confirmProp },
      required: ['identifier'],
    },
  },
  {
    name: 'izandesk_reject_kyc', title: 'Reject KYC document',
    description: 'Reject the pending KYC document for a subscriber. Requires a reason and confirm:true.',
    category: 'actions', kind: 'action', actionType: 'reject_kyc', intent: 'reject_kyc',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        identifier: identifierProp,
        docId: { type: 'string', maxLength: 80 },
        reason: { type: 'string', minLength: 3, maxLength: 300 },
        confirm: confirmProp,
      },
      required: ['identifier', 'reason'],
    },
  },
  {
    name: 'izandesk_topup_reseller_wallet', title: 'Recharge a reseller wallet',
    description: 'Recharge a reseller wallet from the parent ISP. Super Admin only. Amounts are capped at 100000. Requires confirm:true.',
    category: 'actions', kind: 'action', actionType: 'topup_reseller_wallet', intent: 'topup_reseller_wallet',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        identifier: identifierProp,
        amount: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
        confirm: confirmProp,
      },
      required: ['identifier', 'amount'],
    },
  },
];

const TOOL_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]));

/** Mirrors ai.ts INTENT_ROLES exactly — MCP inherits AI Copilot permissions. */
const MONEY_ROLES = ['SUPER_ADMIN', 'BILLING_OPERATOR'];
const NETWORK_ROLES = ['SUPER_ADMIN', 'NOC_ENGINEER'];
const CRM_ROLES = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'TECHNICIAN'];
const INTENT_ROLES: Record<string, string[]> = {
  collection_today: [...MONEY_ROLES, 'RESELLER'],
  dues: [...MONEY_ROLES, 'RESELLER'],
  payment_gateways: [...MONEY_ROLES, 'RESELLER'],
  reseller_wallet: [...MONEY_ROLES, 'RESELLER'],
  revenue_month: MONEY_ROLES,
  staff_collection: MONEY_ROLES,
  router_health: [...NETWORK_ROLES, 'BILLING_OPERATOR', 'TECHNICIAN'],
  olt_health: [...NETWORK_ROLES, 'TECHNICIAN'],
  subscriber_onu: [...NETWORK_ROLES, 'TECHNICIAN'],
  subscriber_live: [...NETWORK_ROLES, 'BILLING_OPERATOR', 'TECHNICIAN', 'RESELLER'],
  create_subscriber: ['SUPER_ADMIN'],
  set_subscriber_status: ['SUPER_ADMIN'],
  topup_reseller_wallet: ['SUPER_ADMIN'],
  create_ticket: ['SUPER_ADMIN'],
  record_payment: MONEY_ROLES,
  assign_package: ['SUPER_ADMIN', 'BILLING_OPERATOR'],
  close_ticket: CRM_ROLES,
  approve_kyc: CRM_ROLES,
  reject_kyc: CRM_ROLES,
  leads: CRM_ROLES,
  kyc: CRM_ROLES,
  gis_sites: [...NETWORK_ROLES, 'BILLING_OPERATOR', 'TECHNICIAN'],
  inventory: ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER', 'TECHNICIAN'],
};

export function toolAllowed(tool: McpTool, ctx: McpContext): boolean {
  if (ctx.allowedTools && !ctx.allowedTools.includes('*') && !ctx.allowedTools.includes(tool.name)) return false;
  if (ctx.readOnly && tool.annotations?.readOnlyHint !== true) return false;
  if (!tool.intent) return true;
  const roles = INTENT_ROLES[tool.intent];
  return !roles || roles.includes(String(ctx.actor.role || ''));
}

function publicTool(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations || { readOnlyHint: tool.kind === 'query' },
  };
}

/** Minimal JSON Schema validation for MCP tool arguments (no external deps). */
function validateArgs(schema: JsonSchema, args: any): string | null {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  const props = schema.properties || {};
  for (const key of schema.required || []) {
    if (!(key in args)) return `missing required argument: ${key}`;
  }
  if (schema.additionalProperties === false) {
    const extra = Object.keys(args).filter((k) => !(k in props));
    if (extra.length) return `unexpected argument(s): ${extra.join(', ')}`;
  }
  for (const [key, rule] of Object.entries<any>(props)) {
    if (!(key in args)) continue;
    const val = args[key];
    if (rule.const !== undefined && val !== rule.const) return `${key} must be ${JSON.stringify(rule.const)}`;
    if (rule.enum && !rule.enum.includes(val)) return `${key} must be one of: ${rule.enum.join(', ')}`;
    const t = rule.type;
    if (t === 'string' && typeof val !== 'string') return `${key} must be a string`;
    if (t === 'boolean' && typeof val !== 'boolean') return `${key} must be a boolean`;
    if ((t === 'integer' || t === 'number') && (typeof val !== 'number' || !Number.isFinite(val))) return `${key} must be a number`;
    if (t === 'integer' && !Number.isInteger(val)) return `${key} must be an integer`;
    if (typeof val === 'string') {
      if (rule.minLength && val.length < rule.minLength) return `${key} is too short`;
      if (rule.maxLength && val.length > rule.maxLength) return `${key} is too long`;
      if (rule.pattern && !new RegExp(rule.pattern).test(val)) return `${key} has an invalid format`;
    }
    if (typeof val === 'number') {
      if (rule.minimum !== undefined && val < rule.minimum) return `${key} is below the minimum`;
      if (rule.maximum !== undefined && val > rule.maximum) return `${key} exceeds the maximum`;
      if (rule.exclusiveMinimum !== undefined && val <= rule.exclusiveMinimum) return `${key} must be greater than ${rule.exclusiveMinimum}`;
    }
  }
  return null;
}

function audit(ctx: McpContext, action: string, entityId: string, details: any) {
  return auditLog({
    actor_id: ctx.actor.id,
    actor_name: ctx.actor.name,
    actor_role: ctx.actor.role,
    action,
    entity_type: 'mcp',
    entity_id: entityId,
    ip_address: ctx.ip || null,
    details: { ...details, via: ctx.actorSource, key_id: ctx.keyId || null, client: ctx.clientInfo?.name || null },
  });
}

function textResult(result: any, isError = false) {
  return {
    resultType: 'complete',
    content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
    isError,
  };
}

function structuredResult(text: string, structured: any, isError = false) {
  return {
    resultType: 'complete',
    content: [{ type: 'text', text }],
    structuredContent: structured,
    isError,
  };
}

// ── Resources ────────────────────────────────────────────────────────────────

const MCP_RESOURCES = [
  { uri: 'izandesk://capabilities', name: 'Role capabilities', description: 'What the connected account can see and do.', mimeType: 'application/json' },
  { uri: 'izandesk://tools', name: 'Tool catalog', description: 'All tools visible to the connected account.', mimeType: 'application/json' },
  { uri: 'izandesk://audit/recent', name: 'Recent MCP activity', description: 'Recent MCP tool calls made by this account.', mimeType: 'application/json' },
];

async function readResource(ctx: McpContext, uri: string): Promise<any> {
  if (uri === 'izandesk://capabilities') {
    return {
      role: ctx.actor.role,
      capabilities: capabilitiesFor(String(ctx.actor.role)),
      source: ctx.actorSource,
      readOnly: !!ctx.readOnly,
      allowedTools: ctx.allowedTools || null,
      keyName: ctx.keyName || null,
    };
  }
  if (uri === 'izandesk://tools') {
    return MCP_TOOLS.filter((t) => toolAllowed(t, ctx)).map((t) => ({
      name: t.name, category: t.category, readOnly: t.annotations?.readOnlyHint === true,
      destructive: t.annotations?.destructiveHint === true,
    }));
  }
  if (uri === 'izandesk://audit/recent') {
    if (!['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(ctx.actor.role))) {
      throw Object.assign(new Error('This resource requires billing or super-admin access'), { toolError: true });
    }
    const rows = await ctx.pool.query(
      `SELECT created_at, action, entity_id, details FROM audit_logs
       WHERE entity_type='mcp' AND actor_id=$1 ORDER BY created_at DESC LIMIT 25`,
      [ctx.actor.id],
    );
    return rows.rows || [];
  }
  throw Object.assign(new Error(`Unknown resource: ${uri}`), { protocolError: -32602 });
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const MCP_PROMPTS = [
  { name: 'collections_review', title: 'Review today\'s collections', description: 'Walk through collections, dues and gateway breakdown.', arguments: [] },
  { name: 'noc_handover', title: 'NOC shift handover', description: 'Summarise network and ticket state for a shift handover.', arguments: [] },
  { name: 'subscriber_onboarding', title: 'Onboard a subscriber', description: 'Guide a new subscriber connection with verification steps.', arguments: [{ name: 'identifier', description: 'Client code or name (optional)', required: false }] },
  { name: 'billing_close', title: 'Billing close checklist', description: 'Review revenue, dues and staff collections before closing the day.', arguments: [] },
];

function getPrompt(name: string, args: any) {
  const tasks: Record<string, string[]> = {
    collections_review: [
      'Call izandesk_collections_today and summarise cash collected and gateways used.',
      'Call izandesk_dues and list the highest outstanding accounts.',
      'Flag any reseller wallet or payment gateway that looks unusual, then ask before taking action.',
    ],
    noc_handover: [
      'Call izandesk_router_health, izandesk_olt_health and izandesk_online_users.',
      'Call izandesk_tickets and highlight SLA breaches.',
      'Produce a short handover note: what is healthy, what is degraded, what needs a technician.',
    ],
    subscriber_onboarding: [
      'Call izandesk_customer_lookup for the identifier if one was provided.',
      'Call izandesk_packages and izandesk_subscriber_stats for context.',
      'Explain the verification steps before creating anything. Only call izandesk_create_subscriber after the user explicitly confirms every field.',
    ],
    billing_close: [
      'Call izandesk_revenue_month, izandesk_collections_today and izandesk_staff_collections.',
      'Call izandesk_dues and note accounts that may need suspension.',
      'Present a close checklist. Never suspend or record a payment without explicit user confirmation.',
    ],
  };
  const lines = tasks[name];
  if (!lines) throw Object.assign(new Error(`Unknown prompt: ${name}`), { protocolError: -32602 });
  const suffix = args?.identifier ? ` Focus on identifier: ${str(args.identifier)}.` : '';
  return {
    resultType: 'complete',
    description: name,
    messages: [{ role: 'user', content: { type: 'text', text: `IzanDesk ${name.replace(/_/g, ' ')}.${suffix}\n\n` + lines.map((l, i) => `${i + 1}. ${l}`).join('\n') } }],
  };
}

// ── Tool dispatch ────────────────────────────────────────────────────────────

async function callTool(ctx: McpContext, name: string, args: any): Promise<any> {
  const started = Date.now();
  let outcome = 'ok';
  let resultOk: boolean | undefined;
  try {
    const tool = TOOL_BY_NAME.get(name);
    if (!tool) {
      outcome = 'unknown_tool';
      throw Object.assign(new Error(`Unknown tool: ${name}`), { protocolError: -32602 });
    }
    if (!toolAllowed(tool, ctx)) {
      outcome = 'denied';
      return structuredResult(`Access denied: "${name}" is not available for ${ctx.actor.role}${ctx.readOnly ? ' with a read-only key' : ''}.`, {}, true);
    }
    const invalid = validateArgs(tool.inputSchema, args || {});
    if (invalid) {
      outcome = 'invalid_args';
      return structuredResult(`Invalid arguments for ${name}: ${invalid}`, {}, true);
    }

    // Meta tools never touch data.
    if (name === 'search_izandesk_tools') {
      const q = str(args.query).toLowerCase();
      const category = args.category ? str(args.category).toLowerCase() : '';
      const limit = Number(args.limit || 10);
      const matches = MCP_TOOLS
        .filter((t) => toolAllowed(t, ctx))
        .filter((t) => !category || t.category === category)
        .map((t) => ({
          ...t,
          score: (t.name.includes(q) ? 3 : 0) + (t.title.toLowerCase().includes(q) ? 2 : 0)
            + (t.description.toLowerCase().includes(q) ? 1 : 0) + (t.category === q ? 2 : 0),
        }))
        .filter((t) => t.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((t) => ({ name: t.name, title: t.title, description: t.description, category: t.category, score: t.score, readOnly: t.annotations?.readOnlyHint === true }));
      return structuredResult(`Found ${matches.length} tool(s).`, { tools: matches });
    }
    if (name === 'get_izandesk_tool_schema') {
      const tool2 = TOOL_BY_NAME.get(str(args.name));
      if (!tool2 || !toolAllowed(tool2, ctx)) {
        outcome = 'unknown_tool';
        return structuredResult(`No accessible tool named "${str(args.name)}".`, {}, true);
      }
      return structuredResult(`${tool2.name} — ${tool2.description}`, {
        tool: publicTool(tool2),
        required_role: INTENT_ROLES[tool2.intent || ''] || 'all roles',
      });
    }

    // Read-only query tools run the exact AI intent named by the tool. This
    // avoids keyword-detection ambiguity while reusing role gates + rendering.
    if (tool.kind === 'query') {
      const intent = tool.intent || 'help';
      const result: AIResult = await runAIIntent(ctx.pool, ctx.actor, {
        intent,
        entity: typeof args.identifier === 'string' ? args.identifier : undefined,
      });
      const payload = {
        intent: result.intent,
        reply: result.reply,
        stats: result.stats,
        cards: result.cards,
        lang: result.lang,
        restricted: !!result.meta?.restricted,
      };
      return structuredResult(result.reply, payload, !!result.meta?.restricted);
    }

    // Mutating tools: build a closed AIAction from validated arguments.
    if (args.confirm !== true) {
      outcome = 'needs_confirm';
      return structuredResult(
        `This tool changes live data. Review the arguments and call again with "confirm": true.`,
        { requires_confirmation: true, tool: name, arguments: args },
        true,
      );
    }

    const payload: Record<string, any> = { ...args };
    delete payload.confirm;
    const action = { type: tool.actionType, payload } as AIAction;
    const executed = await executeAiAction(action, ctx.actor, ctx.executor);
    resultOk = executed.ok;
    outcome = executed.ok ? 'mutation_ok' : 'mutation_failed';
    const extra = {
      action: tool.actionType,
      ok: executed.ok,
      result: executed.raw ?? null,
      cards: executed.cards || [],
      audited: true,
    };
    return structuredResult(executed.message, extra, !executed.ok);
  } finally {
    await audit(ctx, 'MCP_TOOL_CALL', name, {
      outcome,
      arguments: redact(args),
      duration_ms: Date.now() - started,
      protocol: ctx.protocolVersion || null,
      ...(resultOk !== undefined ? { result_ok: resultOk } : {}),
    }).catch(() => {});
  }
}

function redact(args: any) {
  if (!args || typeof args !== 'object') return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(args)) {
    if (/password|secret|token|trx_id|note/i.test(k)) out[k] = '[redacted]';
    else out[k] = v;
  }
  return out;
}

// ── JSON-RPC request handler ─────────────────────────────────────────────────

export type McpRpcResponse = { status: number; body?: any };

function rpcError(id: any, code: number, message: string, status = 200, data?: any): McpRpcResponse {
  return { status, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } } };
}
function rpcResult(id: any, result: any, status = 200): McpRpcResponse {
  const providedMeta = result?._meta || {};
  return {
    status,
    body: {
      jsonrpc: '2.0',
      id,
      result: {
        resultType: 'complete',
        ...result,
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: 'izandesk-mcp', version: MCP_SERVER_VERSION },
          ...providedMeta,
        },
      },
    },
  };
}

/**
 * Validate per-request MCP metadata and mirrored headers. Legacy clients that
 * use `initialize` are intentionally tolerated: they send no modern _meta.
 */
export function validateModernRequest(body: any, headers: Record<string, any>): McpRpcResponse | null {
  const method = body?.method;
  if (method === 'initialize' || !method) return null;
  const meta = body?.params?._meta || {};
  const bodyVersion = meta['io.modelcontextprotocol/protocolVersion'];
  const headerVersion = headers['mcp-protocol-version'] || headers['MCP-Protocol-Version'];
  const modern = bodyVersion !== undefined || headerVersion !== undefined;
  if (!modern) return null; // initialize-era client

  if (bodyVersion === undefined) {
    return rpcError(body?.id, -32602, 'Missing _meta.io.modelcontextprotocol/protocolVersion', 400);
  }
  if (!MCP_VERSIONS.includes(bodyVersion)) {
    return rpcError(body?.id, -32022, `Unsupported protocol version: ${bodyVersion}`, 400, { supported: [...MCP_VERSIONS] });
  }
  if (headerVersion === undefined) {
    return rpcError(body?.id, -32020, 'Missing required header: MCP-Protocol-Version', 400);
  }
  if (headerVersion !== bodyVersion) {
    return rpcError(body?.id, -32020, `Header mismatch: MCP-Protocol-Version '${headerVersion}' does not match body '${bodyVersion}'`, 400);
  }
  const accept = String(headers.accept || '');
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    return rpcError(body?.id, -32600, 'Accept header must list application/json and text/event-stream', 400);
  }
  if (!meta['io.modelcontextprotocol/clientInfo'] || typeof meta['io.modelcontextprotocol/clientInfo'] !== 'object') {
    return rpcError(body?.id, -32602, 'Missing _meta.io.modelcontextprotocol/clientInfo', 400);
  }
  if (!meta['io.modelcontextprotocol/clientCapabilities'] || typeof meta['io.modelcontextprotocol/clientCapabilities'] !== 'object') {
    return rpcError(body?.id, -32602, 'Missing _meta.io.modelcontextprotocol/clientCapabilities', 400);
  }

  const headerMethod = headers['mcp-method'] || headers['Mcp-Method'];
  if (headerMethod === undefined) {
    return rpcError(body?.id, -32020, 'Missing required header: Mcp-Method', 400);
  }
  if (headerMethod !== method) {
    return rpcError(body?.id, -32020, `Header mismatch: Mcp-Method '${headerMethod}' does not match body '${method}'`, 400);
  }

  const nameFromBody = body?.params?.name ?? body?.params?.uri;
  if (['tools/call', 'resources/read', 'prompts/get'].includes(method) && nameFromBody !== undefined) {
    const headerName = headers['mcp-name'] || headers['Mcp-Name'];
    if (headerName === undefined) {
      return rpcError(body?.id, -32020, 'Missing required header: Mcp-Name', 400);
    }
    const decoded = String(headerName).startsWith('=?base64?') && String(headerName).endsWith('?=')
      ? Buffer.from(String(headerName).slice(9, -2), 'base64').toString('utf8')
      : String(headerName);
    if (decoded !== String(nameFromBody)) {
      return rpcError(body?.id, -32020, `Header mismatch: Mcp-Name '${decoded}' does not match body '${nameFromBody}'`, 400);
    }
  }
  return null;
}

export function advertisedCapabilities() {
  return {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    prompts: { listChanged: false },
  };
}

export async function handleMcpRpc(body: any, ctx: McpContext): Promise<McpRpcResponse> {
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError(body?.id, -32600, 'Invalid JSON-RPC request', 400);
  }
  const { id, method } = body;
  const params = body.params && typeof body.params === 'object' ? body.params : {};
  const isNotification = id === undefined || id === null;

  // Client identity from per-request _meta (modern) or initialize params (legacy).
  const meta = params._meta || {};
  const clientInfo = meta['io.modelcontextprotocol/clientInfo'] || params.clientInfo || {};
  if (clientInfo?.name) ctx.clientInfo = { name: str(clientInfo.name).slice(0, 80), version: str(clientInfo.version).slice(0, 40) };
  const requestedVersion = str(meta['io.modelcontextprotocol/protocolVersion'] || params.protocolVersion || ctx.protocolVersion || '');
  if (requestedVersion && (MCP_VERSIONS as readonly string[]).includes(requestedVersion)) ctx.protocolVersion = requestedVersion;

  if (method.startsWith('notifications/')) return { status: 202 };

  switch (method) {
    case 'ping':
      return isNotification ? { status: 202 } : rpcResult(id, {});

    case 'server/discover':
      return rpcResult(id, {
        supportedVersions: [...MCP_VERSIONS],
        capabilities: advertisedCapabilities(),
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'izandesk-mcp', version: MCP_SERVER_VERSION } },
        ttlMs: 3_600_000,
        cacheScope: 'public',
      });

    case 'initialize': {
      const asked = str(params.protocolVersion || '');
      const version = (MCP_VERSIONS as readonly string[]).includes(asked) ? asked : CURRENT_VERSION;
      ctx.protocolVersion = version;
      await audit(ctx, 'MCP_INIT', 'initialize', { version, client: ctx.clientInfo || null });
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: advertisedCapabilities(),
        serverInfo: { name: 'izandesk-mcp', version: MCP_SERVER_VERSION },
        instructions: 'IzanDesk ISP operations. Query tools are read-only. Mutating tools require confirm:true. All calls are audited.',
      });
    }

    case 'tools/list': {
      const tools = MCP_TOOLS.filter((t) => toolAllowed(t, ctx)).map(publicTool);
      return rpcResult(id, { tools, nextCursor: undefined, ttlMs: 300_000, cacheScope: 'authenticated' });
    }

    case 'tools/call': {
      const name = str(params.name);
      if (!name) return rpcError(id, -32602, 'Missing tool name');
      const result = await callTool(ctx, name, params.arguments || {});
      return rpcResult(id, result);
    }

    case 'resources/list':
      return rpcResult(id, { resources: MCP_RESOURCES, ttlMs: 600_000, cacheScope: 'authenticated' });

    case 'resources/read': {
      try {
        const uri = str(params.uri);
        const data = await readResource(ctx, uri);
        const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        return rpcResult(id, { contents: [{ uri, mimeType: 'application/json', text }] });
      } catch (e: any) {
        if (e?.protocolError) return rpcError(id, e.protocolError, e.message);
        return rpcResult(id, { content: [{ type: 'text', text: e?.message || 'Resource read failed' }], isError: true });
      }
    }

    case 'prompts/list':
      return rpcResult(id, { prompts: MCP_PROMPTS, ttlMs: 600_000, cacheScope: 'authenticated' });

    case 'prompts/get':
      try {
        return rpcResult(id, getPrompt(str(params.name), params.arguments || {}));
      } catch (e: any) {
        return rpcError(id, e?.protocolError || -32602, e?.message || 'Unknown prompt');
      }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`, 404);
  }
}
