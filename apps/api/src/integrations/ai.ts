/**
 * IzanDesk AI Copilot engine.
 *
 * Design goals:
 *  - Works with zero configuration: a deterministic, bilingual intent engine
 *    reads role-scoped aggregates straight from the ISP database.
 *  - Optional external LLMs (Gemini / OpenAI) are used ONLY for free-form
 *    questions and ONLY when explicitly enabled by a super admin. They receive
 *    a sanitized, aggregate-only context — never subscriber PII or credentials.
 *  - Every response is deterministic in shape so the UI can render cards,
 *    quick prompts and deep links consistently.
 */
import { getCached } from './settings';

export type AIActor = { id: string; name: string; role: string; resellerId?: string | null };
export type AICard = { title: string; badge?: string; desc?: string; url?: string; prompt?: string };
export type AIResult = {
  reply: string;
  provider: 'local' | 'gemini' | 'openai' | 'nim';
  intent: string;
  lang: 'bn' | 'en';
  cards: AICard[];
  quickPrompts: string[];
  stats: Record<string, any>;
  meta: Record<string, any>;
};

const STAFF_ROLES = ['SUPER_ADMIN', 'NOC_ENGINEER', 'BILLING_OPERATOR', 'TECHNICIAN'];
const MONEY_ROLES = ['SUPER_ADMIN', 'BILLING_OPERATOR'];
const NETWORK_ROLES = ['SUPER_ADMIN', 'NOC_ENGINEER'];
const CRM_ROLES = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'TECHNICIAN'];

export function capabilitiesFor(role: string): string[] {
  if (role === 'SUPER_ADMIN') return ['collections', 'subscribers', 'network', 'olt', 'tickets', 'crm', 'inventory', 'resellers', 'finance', 'hotspot'];
  if (role === 'NOC_ENGINEER') return ['subscribers', 'network', 'olt', 'tickets', 'hotspot'];
  if (role === 'BILLING_OPERATOR') return ['collections', 'subscribers', 'tickets', 'crm', 'finance', 'resellers', 'hotspot'];
  if (role === 'TECHNICIAN') return ['subscribers', 'tickets', 'olt', 'network_read'];
  return ['own_subscribers', 'own_wallet', 'own_tickets']; // RESELLER
}

export function quickPromptsFor(role: string, lang: 'bn' | 'en'): string[] {
  if (lang === 'en') {
    if (role === 'RESELLER') return ['How many customers do I have?', 'My due customers', 'My wallet balance', 'My open tickets'];
    if (role === 'TECHNICIAN') return ['My open tickets', 'Customers expiring soon', 'Online users now', 'OLT health'];
    if (role === 'NOC_ENGINEER') return ['Router health', 'Online users now', 'OLT / ONU status', 'Customers expiring soon'];
    if (role === 'BILLING_OPERATOR') return ["Today's collection", 'Customers with dues', 'Payment gateway breakdown', 'Reseller wallets'];
    return ["Today's collection", 'Total customers', 'Router health', 'Open tickets', 'Customers with dues'];
  }
  if (role === 'RESELLER') return ['আমার কতজন গ্রাহক আছে?', 'আমার বকেয়া গ্রাহক', 'আমার ওয়ালেট ব্যালেন্স', 'আমার খোলা টিকেট'];
  if (role === 'TECHNICIAN') return ['আমার খোলা টিকেট', 'শীঘ্রই মেয়াদ শেষ হওয়া গ্রাহক', 'অনলাইন ইউজার', 'OLT স্ট্যাটাস'];
  if (role === 'NOC_ENGINEER') return ['রাউটার স্ট্যাটাস', 'অনলাইন ইউজার', 'OLT / ONU অবস্থা', 'মেয়াদোত্তীর্ণ গ্রাহক'];
  if (role === 'BILLING_OPERATOR') return ['আজকের কালেকশন কত?', 'বকেয়া গ্রাহকদের তালিকা', 'পেমেন্ট গেটওয়ে বিশ্লেষণ', 'রিসেলার ওয়ালেট'];
  return ['আজকের কালেকশন কত?', 'মোট গ্রাহক সংখ্যা', 'রাউটার স্ট্যাটাস', 'খোলা টিকেট', 'বকেয়া গ্রাহকদের তালিকা'];
}

/** Bengali Unicode block detection — replies follow the question's language. */
function detectLang(message: string): 'bn' | 'en' {
  return /[\u0980-\u09FF]/.test(message) ? 'bn' : 'en';
}

type Detection = { intent: string; lang: 'bn' | 'en'; entity?: string };

const RULES: Array<[string, RegExp]> = [
  ['greeting', /^(hi|hello|hey|assalam|who are you|what can you do|help|start|স্বাগতম|নমস্কার|আসসালামু|কে তুমি|কি করতে পার|কী করতে পারো)/i],
  ['sms_templates', /(sms|whatsapp|reminder template|টেমপ্লেট|রিমাইন্ডার|এসএমএস|হোয়াটসঅ্যাপ)/i],
  ['collection_today', /(today.{0,20}(collect|payment|revenue|income)|collect.{0,20}today|আজকের.{0,20}(কালেকশন|আদায়|পেমেন্ট|সংগ্রহ)|আজ.{0,10}(কত টাকা|কালেকশ))/i],
  ['revenue_month', /(monthly|this month|current month|last month|Revenue|মাসিক|চলতি মাস|এই মাস|গত মাস|মাসের আদায়|মাসের আয়)/i],
  ['dues', /(due|unpaid|overdue|owe|বকেয়া|বাকি|পাওনা|অ unpaid|দেনা)/i],
  ['customer_stats', /(customer|subscriber|client|গ্রাহক|সাবস্ক্রাইবার|কাস্টমার).{0,30}(total|count|how many|status|সংখ্যা|কতজন|অবস্থা|স্ট্যাটাস|ওভারভিউ)|^(total|মোট).{0,15}(customer|subscriber|গ্রাহক|কাস্টমার)/i],
  ['online_users', /(online|active session|live user|pppoe|অনলাইন|লাইভ|সেশন|ইউজার সংখ্যা)/i],
  ['new_connections', /(new connection|new client|new line|নতুন সংযোগ|নতুন লাইন|নতুন গ্রাহক|নতুন কাস্টমার)/i],
  ['expiry', /(expir|মেয়াদ|ডেডলাইন|শেষ হওয়া)/i],
  ['router_health', /(router|mikrotik|routers|মাইক্রোটিক|রাউটার|নেটওয়ার্ক হেলথ)/i],
  ['olt_health', /(olt|onu|optical|fiber|অপটিক্যাল|অনু|ওএলটি|ফাইবার)/i],
  ['tickets', /(ticket|complaint|টিকেট|অভিযোগ|কমপ্লেইন)/i],
  ['leads', /(lead|prospect|সম্ভাব্য|লিড)/i],
  ['reseller_wallet', /(reseller|wallet|রিসেলার|ওয়ালেট|ব্যালেন্স)/i],
  ['hotspot', /(hotspot|voucher|হটস্পট|ভাউচার)/i],
  ['inventory', /(inventory|stock|low stock|ইনভেন্টরি|স্টক|মাল)(?!.*(বকেয়া|due))/i],
  ['packages', /(package|plan|rate list|pricing|প্যাকেজ|প্ল্যান|রেট|দাম)/i],
  ['payment_gateways', /(gateway|bkash|nagad|rocket|payment method|গেটওয়ে|বিকাশ|নগদ|রকেট)/i],
  ['staff_collection', /(collector|staff.{0,10}collection|কালেক্টর|কর্মকর্তা.{0,10}আদায়)/i],
  ['kyc', /(kyc|document verification|নিদ|কেওয়াইসি|డాక్యుమెంట)/i],
  ['gis_sites', /(gis|map|site|zone|area|মানচিত্র|সাইট|জোন|এলাকা)/i],
];

/** Pull a subscriber identifier out of a question that clearly names someone. */
const NOT_A_NAME = /^(?:whose|which|that|this|with|from|about|for|the|and|his|her|their|named|called|is|of|in|on|my|our|who|how|what|info|details|status|please|a|an)$/i;
function extractEntity(text: string): string | undefined {
  const quoted = text.match(/["']([a-z0-9][a-z0-9._@ -]{1,63})["']/i);
  if (quoted && !NOT_A_NAME.test(quoted[1].trim())) return quoted[1].trim();
  // "whose name is isa", "subscriber named isa", "username idc040@isa"…
  // The filler guard stops "subscriber whose …" from capturing "whose".
  const named = text.match(/\b(?:name\s+(?:is|of)?\s*|named\s+|called\s+|username\s+(?:is\s*)?|client(?:\s+code)?\s+(?:is\s*)?|customer(?:\s+(?:id|name))?\s+(?:is\s*)?|subscriber(?:\s+(?:id|name))?\s+(?:is\s*)?)(?!whose\b|which\b|that\b|this\b|with\b|from\b|about\b|for\b|the\b|and\b|his\b|her\b|their\b|named\b|called\b|is\b|of\b|in\b|on\b|my\b|our\b|who\b|how\b|what\b|info\b|details\b|status\b|please\b|a\b|an\b)([a-z0-9][a-z0-9._@-]{1,63})\b/i);
  if (named) return named[1];
  const possessive = text.match(/\b([a-z0-9][a-z0-9._@-]{1,63})'s\b/i);
  if (possessive && !NOT_A_NAME.test(possessive[1])) return possessive[1];
  const code = text.match(/\b(?:izn-[a-z0-9-]{3,}|cus-?\d{3,}|0?1[3-9]\d{8,11}|\+?8801[3-9]\d{8,})\b/i);
  return code ? code[0] : undefined;
}

function detectIntent(message: string): Detection {
  const lang = detectLang(message);
  const text = message.trim().toLowerCase();
  // A named subscriber takes priority over topic keywords: "isa's ONU info"
  // must not be answered with the generic OLT health table.
  const entity = extractEntity(text);
  if (entity && /(subscriber|customer|client|name|username|profile|info|details|onu|olt|গ্রাহক|সাবস্ক্রাইবার|কাস্টমার|নাম|অনু|ওএলটি|তথ্য|বিবরণ)/i.test(text)) {
    return { intent: /(onu|olt|optical|অনু|ওএলটি|অপটিক্যাল)/i.test(text) ? 'subscriber_onu' : 'customer_lookup', lang, entity };
  }
  for (const [intent, re] of RULES) if (re.test(text)) return { intent, lang };
  if (/^[a-z0-9._@:-]{3,64}$/.test(text) && /\d/.test(text)) return { intent: 'customer_lookup', lang, entity: text };
  return { intent: 'free_form', lang };
}

type Ctx = { role: string; actor: AIActor };
type Row = Record<string, any>;

async function one(pool: any, sql: string, params: any[] = []): Promise<Row> {
  try { const r = await pool.query(sql, params); return r.rows?.[0] || {}; } catch { return {}; }
}
async function many(pool: any, sql: string, params: any[] = []): Promise<Row[]> {
  try { const r = await pool.query(sql, params); return r.rows || []; } catch { return []; }
}
const num = (v: any) => Number(v || 0);
const money = (v: any, symbol = '৳') => `${symbol}${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Role-scoped WHERE fragments. Every query that touches customer data uses these. */
function subScope(ctx: Ctx, alias = 's'): { sql: string; params: any[] } {
  return ctx.actor.role === 'RESELLER' && ctx.actor.resellerId
    ? { sql: ` AND ${alias}.reseller_id = $R`, params: [ctx.actor.resellerId] }
    : { sql: '', params: [] };
}
function bind(sql: string, params: any[]): [string, any[]] {
  // $R is the role-scope placeholder; these queries contain no other $n tokens.
  let i = 0;
  const text = sql.replace(/\$R/g, () => `$${++i}`);
  return [text, params];
}

async function baseStats(pool: any, ctx: Ctx): Promise<Record<string, any>> {
  const sc = subScope(ctx);
  const [sub, pay, inv, sess, tkt, router, olt, reseller] = await Promise.allSettled([
    (async () => {
      const [sql, p] = bind(`SELECT COUNT(*)::int total,
        COUNT(*) FILTER (WHERE s.status='ACTIVE')::int active,
        COUNT(*) FILTER (WHERE s.status='SUSPENDED')::int suspended,
        COUNT(*) FILTER (WHERE s.status='EXPIRED')::int expired,
        COUNT(*) FILTER (WHERE s.status='PENDING')::int pending,
        COALESCE(SUM(s.monthly_bill),0)::numeric mrr FROM subscribers s WHERE TRUE${sc.sql}`, sc.params);
      return one(pool, sql, p);
    })(),
    (async () => {
      const [sql, p] = bind(`SELECT COALESCE(SUM(p.amount),0)::numeric total, COUNT(*)::int cnt
        FROM payments p LEFT JOIN subscribers s ON s.id=p.subscriber_id
        WHERE p.status IN ('PAID','COMPLETED','VERIFIED') AND p.created_at::date = CURRENT_DATE${sc.sql}`, sc.params);
      return one(pool, sql, p);
    })(),
    (async () => {
      const [sql, p] = bind(`SELECT COALESCE(SUM(i.due_amount),0)::numeric total,
        COUNT(*) FILTER (WHERE i.due_amount > 0)::int cnt FROM invoices i
        LEFT JOIN subscribers s ON s.id=i.subscriber_id WHERE i.status <> 'VOID'${sc.sql}`, sc.params);
      return one(pool, sql, p);
    })(),
    (async () => {
      const [sql, p] = bind(`SELECT COUNT(*) FILTER (WHERE ss.status='ONLINE')::int online,
        COALESCE(SUM(ss.rx_bps),0)::bigint rx, COALESCE(SUM(ss.tx_bps),0)::bigint tx
        FROM subscriber_sessions ss LEFT JOIN subscribers s ON s.id=ss.subscriber_id WHERE TRUE${sc.sql}`, sc.params);
      return one(pool, sql, p);
    })(),
    (async () => {
      const role = ctx.actor.role;
      let where = 'WHERE TRUE'; const params: any[] = [];
      if (role === 'RESELLER' && ctx.actor.resellerId) { where += ' AND t.reseller_id=$1'; params.push(ctx.actor.resellerId); }
      else if (role === 'TECHNICIAN') { where += ' AND t.assigned_technician_id=$1'; params.push(ctx.actor.id); }
      return one(pool, `SELECT COUNT(*) FILTER (WHERE t.status NOT IN ('CLOSED','RESOLVED'))::int open,
        COUNT(*) FILTER (WHERE t.sla_breached)::int breached, COUNT(*)::int total FROM tickets t ${where}`, params);
    })(),
    NETWORK_ROLES.includes(ctx.actor.role) || ctx.actor.role === 'BILLING_OPERATOR'
      ? one(pool, `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE is_enabled)::int enabled,
          COUNT(*) FILTER (WHERE status='ONLINE')::int online FROM network_routers`) : Promise.resolve({}),
    NETWORK_ROLES.includes(ctx.actor.role) || ctx.actor.role === 'TECHNICIAN'
      ? one(pool, `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='ONLINE')::int online FROM olts`) : Promise.resolve({}),
    (async () => {
      if (ctx.actor.role !== 'RESELLER') return MONEY_ROLES.includes(ctx.actor.role)
        ? one(pool, `SELECT COALESCE(SUM(wallet_balance),0)::numeric total, COUNT(*) FILTER (WHERE status='ACTIVE')::int cnt FROM resellers`) : {};
      return one(pool, `SELECT COALESCE(wallet_balance,0)::numeric total, 1::int cnt FROM resellers WHERE id=$1`, [ctx.actor.resellerId]);
    })(),
  ]);
  const val = (r: PromiseSettledResult<any>) => r.status === 'fulfilled' ? r.value : {};
  const s = val(sub) as Row, p = val(pay) as Row, i = val(inv) as Row, ss = val(sess) as Row,
    t = val(tkt) as Row, r = val(router) as Row, o = val(olt) as Row, w = val(reseller) as Row;
  return {
    total_clients: num(s.total), active_clients: num(s.active), suspended_clients: num(s.suspended),
    expired_clients: num(s.expired), pending_clients: num(s.pending), mrr: num(s.mrr),
    today_collection: num(p.total), today_transactions: num(p.cnt),
    total_dues: num(i.total), due_customers: num(i.cnt),
    online_users: num(ss.online), rx_bps: num(ss.rx), tx_bps: num(ss.tx),
    open_tickets: num(t.open), breached_tickets: num(t.breached), total_tickets: num(t.total),
    routers_total: num(r.total), routers_online: num(r.online),
    olts_total: num(o.total), olts_online: num(o.online),
    reseller_count: num(w.cnt), reseller_wallet: num(w.total),
  };
}

async function intentExtras(pool: any, ctx: Ctx, intent: string, entity?: string): Promise<{ stats: Record<string, any>; rows: Row[] }> {
  const sc = subScope(ctx);
  const role = ctx.actor.role;
  const can = (roles: string[]) => roles.includes(role);
  const stats: Record<string, any> = {};
  let rows: Row[] = [];

  switch (intent) {
    case 'dues': {
      if (can(MONEY_ROLES) || role === 'RESELLER') {
        const [sql, p] = bind(`SELECT s.client_code, s.full_name, s.phone, i.due_amount, s.monthly_bill
          FROM invoices i JOIN subscribers s ON s.id=i.subscriber_id
          WHERE i.due_amount > 0${sc.sql} ORDER BY i.due_amount DESC LIMIT 10`, sc.params);
        rows = await many(pool, sql, p);
      }
      break;
    }
    case 'expiry': {
      const [sql, p] = bind(`SELECT s.client_code, s.full_name, s.phone, s.package_name, s.expiry_date
        FROM subscribers s WHERE s.expiry_date IS NOT NULL AND s.expiry_date <= (CURRENT_DATE + INTERVAL '7 days')${sc.sql}
        ORDER BY s.expiry_date ASC LIMIT 15`, sc.params);
      rows = await many(pool, sql, p);
      stats.expiring_soon = rows.length;
      break;
    }
    case 'new_connections': {
      const [sql, p] = bind(`SELECT s.client_code, s.full_name, s.package_name, s.created_at, s.status
        FROM subscribers s WHERE s.created_at >= date_trunc('month', CURRENT_DATE)${sc.sql}
        ORDER BY s.created_at DESC LIMIT 10`, sc.params);
      rows = await many(pool, sql, p);
      stats.new_this_month = num((await one(pool, ...(() => {
        const [q2, p2] = bind(`SELECT COUNT(*)::int n FROM subscribers s WHERE s.created_at >= date_trunc('month', CURRENT_DATE)${sc.sql}`, sc.params);
        return [q2, p2] as [string, any[]];
      })())).n);
      break;
    }
    case 'customer_stats':
    case 'greeting': {
      stats.new_this_month = num((await one(pool, ...(() => {
        const [q2, p2] = bind(`SELECT COUNT(*)::int n FROM subscribers s WHERE s.created_at >= date_trunc('month', CURRENT_DATE)${sc.sql}`, sc.params);
        return [q2, p2] as [string, any[]];
      })())).n);
      break;
    }
    case 'router_health': {
      if (can(NETWORK_ROLES) || role === 'BILLING_OPERATOR' || role === 'TECHNICIAN') {
        rows = await many(pool, `SELECT name, host, integration_mode, status, last_seen_at FROM network_routers ORDER BY name LIMIT 15`);
      }
      break;
    }
    case 'olt_health': {
      if (can(NETWORK_ROLES) || role === 'TECHNICIAN') {
        rows = await many(pool, `SELECT o.name, o.vendor, o.status, COUNT(u.id)::int onus,
          COUNT(u.id) FILTER (WHERE u.status='ONLINE')::int online_onus FROM olts o
          LEFT JOIN onus u ON u.olt_id=o.id GROUP BY o.id ORDER BY o.name LIMIT 15`);
        stats.onu_total = num((await one(pool, `SELECT COUNT(*)::int n FROM onus`)).n);
      }
      break;
    }
    case 'tickets': {
      let where = 'WHERE TRUE'; const params: any[] = [];
      if (role === 'RESELLER' && ctx.actor.resellerId) { where += ' AND t.reseller_id=$1'; params.push(ctx.actor.resellerId); }
      else if (role === 'TECHNICIAN') { where += ' AND t.assigned_technician_id=$1'; params.push(ctx.actor.id); }
      rows = await many(pool, `SELECT t.ticket_no, t.subject, t.status, t.priority, t.category, t.created_at
        FROM tickets t ${where} ORDER BY t.created_at DESC LIMIT 10`, params);
      stats.open_tickets = num((await one(pool, `SELECT COUNT(*) FILTER (WHERE status NOT IN ('CLOSED','RESOLVED'))::int n FROM tickets t ${where}`, params)).n);
      break;
    }
    case 'leads': {
      if (can(CRM_ROLES)) {
        rows = await many(pool, `SELECT status, COUNT(*)::int n FROM leads GROUP BY status ORDER BY n DESC`);
        stats.leads_total = rows.reduce((a, r) => a + num(r.n), 0);
      }
      break;
    }
    case 'reseller_wallet': {
      if (role === 'RESELLER' && ctx.actor.resellerId) {
        rows = await many(pool, `SELECT r.name, r.wallet_balance, r.credit_limit FROM resellers r WHERE r.id=$1`, [ctx.actor.resellerId]);
      } else if (can(MONEY_ROLES)) {
        rows = await many(pool, `SELECT r.name, r.wallet_balance, r.credit_limit FROM resellers r
          WHERE r.status='ACTIVE' ORDER BY r.wallet_balance DESC LIMIT 10`);
      }
      break;
    }
    case 'hotspot': {
      if (can([...MONEY_ROLES, ...NETWORK_ROLES, 'RESELLER'])) {
        const p = role === 'RESELLER' && ctx.actor.resellerId ? [ctx.actor.resellerId] : [];
        const extra = role === 'RESELLER' ? ' AND v.reseller_id=$1' : '';
        rows = await many(pool, `SELECT v.status, COUNT(*)::int n, COALESCE(SUM(v.price),0)::numeric value
          FROM hotspot_vouchers v WHERE TRUE${extra} GROUP BY v.status ORDER BY n DESC`, p);
      }
      break;
    }
    case 'inventory': {
      if (can(['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER', 'TECHNICIAN'])) {
        rows = await many(pool, `SELECT i.name, i.category, i.reorder_level,
          COUNT(DISTINCT s.id)::int on_hand FROM inventory_items i
          LEFT JOIN inventory_serials s ON s.item_id=i.id AND s.status IN ('IN_STOCK','AVAILABLE')
          GROUP BY i.id HAVING COUNT(DISTINCT s.id) < i.reorder_level ORDER BY i.reorder_level DESC LIMIT 10`);
        stats.low_stock_items = rows.length;
      }
      break;
    }
    case 'packages': {
      rows = await many(pool, `SELECT name, profile_name, download_mbps, upload_mbps, price FROM bandwidth_packages
        WHERE is_active=true ORDER BY download_mbps ASC LIMIT 15`);
      break;
    }
    case 'payment_gateways': {
      if (can(MONEY_ROLES) || role === 'RESELLER') {
        const [sql, p] = bind(`SELECT p.gateway, COUNT(*)::int n, COALESCE(SUM(p.amount),0)::numeric total
          FROM payments p LEFT JOIN subscribers s ON s.id=p.subscriber_id
          WHERE p.created_at >= (CURRENT_DATE - INTERVAL '30 days') AND p.status IN ('PAID','COMPLETED','VERIFIED')${sc.sql}
          GROUP BY p.gateway ORDER BY total DESC`, sc.params);
        rows = await many(pool, sql, p);
      }
      break;
    }
    case 'staff_collection': {
      if (can(MONEY_ROLES)) {
        rows = await many(pool, `SELECT COALESCE(payer_info->>'collector_name','Unassigned') AS collector,
          COUNT(*)::int n, COALESCE(SUM(amount),0)::numeric total FROM payments
          WHERE created_at >= date_trunc('month', CURRENT_DATE) AND status IN ('PAID','COMPLETED','VERIFIED')
          GROUP BY 1 ORDER BY total DESC LIMIT 10`);
      }
      break;
    }
    case 'kyc': {
      if (can(CRM_ROLES)) {
        stats.kyc_pending = num((await one(pool, `SELECT COUNT(*)::int n FROM kyc_documents WHERE status IN ('PENDING','UNDER_REVIEW')`)).n);
      }
      break;
    }
    case 'customer_lookup': {
      if (!entity) break;
      const [sql, p] = bind(`SELECT s.client_code, s.full_name, s.username, s.phone, s.status, s.package_name,
        s.monthly_bill, s.created_at, COALESCE(i.due,0) AS due FROM subscribers s
        LEFT JOIN (SELECT subscriber_id, SUM(due_amount) due FROM invoices WHERE due_amount>0 GROUP BY subscriber_id) i ON i.subscriber_id=s.id
        WHERE (s.client_code ILIKE $E OR s.username ILIKE $E OR s.full_name ILIKE $E OR s.phone ILIKE $E)${sc.sql} LIMIT 5`, sc.params);
      const text = sql.replace(/\$E/g, () => `$${p.length + 1}`);
      rows = await many(pool, text, [...p, `%${entity}%`]);
      break;
    }
    case 'subscriber_onu': {
      if (!entity) break;
      const [sql, p] = bind(`SELECT s.client_code, s.full_name, s.username, s.status AS subscriber_status,
        o.name AS onu_name, o.serial_number, o.pon_port, o.onu_id, o.status AS onu_status,
        o.rx_power_dbm, o.tx_power_dbm, o.distance_m, o.last_down_cause, o.last_seen_at,
        ol.name AS olt_name, ol.vendor AS olt_vendor
        FROM subscribers s
        LEFT JOIN onus o ON o.subscriber_id = s.id
        LEFT JOIN olts ol ON ol.id = o.olt_id
        WHERE (s.client_code ILIKE $E OR s.username ILIKE $E OR s.full_name ILIKE $E OR s.phone ILIKE $E)${sc.sql}
        ORDER BY o.updated_at DESC NULLS LAST LIMIT 5`, sc.params);
      rows = await many(pool, sql.replace(/\$E/g, () => `$${p.length + 1}`), [...p, `%${entity}%`]);
      break;
    }
    case 'gis_sites': {
      if (can(['SUPER_ADMIN', 'NOC_ENGINEER', 'BILLING_OPERATOR', 'TECHNICIAN'])) {
        stats.gis_sites = num((await one(pool, `SELECT COUNT(*)::int n FROM distribution_boxes`)).n);
        stats.gis_routes = num((await one(pool, `SELECT COUNT(*)::int n FROM fiber_routes`)).n);
      }
      break;
    }
    case 'revenue_month': {
      const [sql, p] = bind(`SELECT COALESCE(SUM(p.amount),0)::numeric total,
        COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= (CURRENT_DATE - INTERVAL '30 days')),0)::numeric last30
        FROM payments p LEFT JOIN subscribers s ON s.id=p.subscriber_id
        WHERE p.created_at >= date_trunc('month', CURRENT_DATE) AND p.status IN ('PAID','COMPLETED','VERIFIED')${sc.sql}`, sc.params);
      const r = await one(pool, sql, p);
      stats.month_collection = num(r.total); stats.last30_collection = num(r.last30);
      break;
    }
  }
  return { stats, rows };
}

/* ----------------------------- rendering ----------------------------- */

const BN = {
  title: { collection: '💰 কালেকশন ও আর্থিক বিবরণী', customers: '👥 গ্রাহক ও সাবস্ক্রাইবার লাইভ পরিসংখ্যান', dues: '💳 গ্রাহক বকেয়া (Due Bill) সামারি', online: '🔌 লাইভ অনলাইন PPPoE সংযোগের অবস্থা', expiring: '⚠️ মেয়াদোত্তীর্ণ গ্রাহকদের তালিকা', router: '🚀 রাউটার ও সার্ভার স্ট্যাটাস', olt: '🛰️ OLT / ONU অবস্থা', ticket: '🎫 টিকেট ও অভিযোগ', newconn: '🌟 নতুন সংযোগ লাইভ রিপোর্ট', reseller: '🤝 রিসেলার ওয়ালেট', hotspot: '📶 হটস্পট ভাউচার', stock: '📦 ইনভেন্টরি স্টক', package: '📋 প্যাকেজ রেট তালিকা', gateway: '💳 পেমেন্ট গেটওয়ে বিশ্লেষণ', staff: '🧾 স্টাফ কালেকশন', lead: '🎯 লিড পাইপলাইন', kyc: '🪪 KYC ভেরিফিকেশন', gis: '🗺️ GIS সাইট', customer: '🧾 গ্রাহক প্রোফাইল', help: '🤖 IzanDesk AI Copilot' },
};
const EN = {
  title: { collection: '💰 Collection & finance', customers: '👥 Live subscriber statistics', dues: '💳 Customer dues summary', online: '🔌 Live PPPoE sessions', expiring: '⚠️ Customers expiring soon', router: '🚀 Router & server status', olt: '🛰️ OLT / ONU status', ticket: '🎫 Tickets & complaints', newconn: '🌟 New connections report', reseller: '🤝 Reseller wallets', hotspot: '📶 Hotspot vouchers', stock: '📦 Inventory stock', package: '📋 Package rates', gateway: '💳 Payment gateway breakdown', staff: '🧾 Staff collections', lead: '🎯 Lead pipeline', kyc: '🪪 KYC verification', gis: '🗺️ GIS sites', customer: '🧾 Customer profile', help: '🤖 IzanDesk AI Copilot' },
};

function table(headers: string[], rows: any[][]) {
  if (!rows.length) return '';
  return `| ${headers.join(' | ')} |\n|:${headers.map(() => '---').join('|:')}|\n` +
    rows.map(r => `| ${r.map(v => String(v ?? '-')).join(' | ')} |`).join('\n') + '\n';
}
const esc = (v: any) => String(v ?? '-').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function render(intent: string, lang: 'bn' | 'en', s: Record<string, any>, rows: Row[], ctx: Ctx, entity?: string): { reply: string; cards: AICard[] } {
  const T = lang === 'bn' ? BN.title : EN.title;
  const bn = lang === 'bn';
  const cards: AICard[] = [];
  let body = '';
  switch (intent) {
    case 'greeting':
    case 'help': {
      body = `### ${T.help}\n\n` + (bn
        ? `আমি IzanDesk-এর লাইভ ডেটা থেকে বিলিং, গ্রাহক, নেটওয়ার্ক ও টিকেটের তথ্য বাংলা বা ইংরেজিতে দিতে পারি।\n\n` +
          table(['প্যারামিটার', 'লাইভ পরিসংখ্যান'], [
            ['👥 মোট গ্রাহক', `${s.total_clients} জন`], ['🟢 সক্রিয়', `${s.active_clients} জন`],
            ['🔴 মেয়াদোত্তীর্ণ', `${s.expired_clients} জন`], ['⚡ অনলাইন সেশন', `${s.online_users} জন`],
            ['💰 আজকের কালেকশন', money(s.today_collection)], ['🎫 খোলা টিকেট', `${s.open_tickets} টি`],
          ]) + `\n💡 কাস্টমার আইডি, ফোন নম্বর বা যেকোনো রিপোর্টের নাম লিখে জিজ্ঞেস করুন।`
        : `I answer billing, subscriber, network and ticket questions from IzanDesk live data, in Bangla or English.\n\n` +
          table(['Metric', 'Live value'], [
            ['👥 Total customers', `${s.total_clients}`], ['🟢 Active', `${s.active_clients}`],
            ['🔴 Expired', `${s.expired_clients}`], ['⚡ Online sessions', `${s.online_users}`],
            ['💰 Today collection', money(s.today_collection)], ['🎫 Open tickets', `${s.open_tickets}`],
          ]));
      cards.push({ title: bn ? 'সব রিপোর্ট দেখুন' : 'Open all reports', url: '/reports' });
      break;
    }
    case 'collection_today': {
      body = `### ${T.collection}\n\n` + (bn
        ? table(['বিবরণ', 'পরিমাণ', 'নোট'], [
          ['📅 আজকের মোট কালেকশন', `**${money(s.today_collection)}**`, `${s.today_transactions} টি সফল লেনদেন`],
          ['📈 চলতি মাসের আদায়', money(s.month_collection ?? s.today_collection), 'চলতি বিলিং চক্র'],
          ['🏦 মোট বকেয়া', money(s.total_dues), `${s.due_customers} জন গ্রাহক`],
          ['🤝 রিসেলার ওয়ালেট', money(s.reseller_wallet), `${s.reseller_count} জন রিসেলার`],
        ])
        : table(['Description', 'Amount', 'Note'], [
          ["📅 Today's collection", `**${money(s.today_collection)}**`, `${s.today_transactions} successful transactions`],
          ['📈 This month', money(s.month_collection ?? s.today_collection), 'Current billing cycle'],
          ['🏦 Total dues', money(s.total_dues), `${s.due_customers} customers`],
          ['🤝 Reseller wallets', money(s.reseller_wallet), `${s.reseller_count} resellers`],
        ]));
      cards.push({ title: bn ? 'কালেকশন রিপোর্ট' : 'Collection report', url: '/collections' });
      break;
    }
    case 'revenue_month': {
      body = `### ${T.collection}\n\n` + table(
        bn ? ['সময়কাল', 'সংগৃহীত'] : ['Period', 'Collected'],
        [[bn ? 'চলতি মাস' : 'This month', money(s.month_collection)], [bn ? 'গত ৩০ দিন' : 'Last 30 days', money(s.last30_collection)]]);
      cards.push({ title: bn ? 'আয়-ব্যয়' : 'Cash flow', url: '/finance' });
      break;
    }
    case 'customer_stats': {
      body = `### ${T.customers}\n\n` + table(
        bn ? ['ক্যাটাগরি', 'গ্রাহক', 'অনুপাত'] : ['Category', 'Customers', 'Share'],
        [
          [bn ? 'সর্বমোট' : 'Total', `**${s.total_clients}**`, '100%'],
          [bn ? 'সক্রিয়' : 'Active', s.active_clients, pct(s.active_clients, s.total_clients)],
          [bn ? 'স্থগিত' : 'Suspended', s.suspended_clients, pct(s.suspended_clients, s.total_clients)],
          [bn ? 'মেয়াদোত্তীর্ণ' : 'Expired', s.expired_clients, pct(s.expired_clients, s.total_clients)],
          [bn ? 'অনলাইন now' : 'Online now', s.online_users, 'RouterOS'],
          [bn ? 'এই মাসে নতুন' : 'New this month', s.new_this_month ?? 0, '—'],
        ]);
      cards.push({ title: bn ? 'গ্রাহক তালিকা' : 'Subscriber list', url: '/clients' });
      break;
    }
    case 'dues': {
      body = `### ${T.dues}\n\n` + (bn
        ? `• **মোট বকেয়া:** **${money(s.total_dues)}**\n• **বকেয়া থাকা গ্রাহক:** ${s.due_customers} জন\n\n`
          + table(['কাস্টমার আইডি', 'নাম', 'বকেয়া', 'মোবাইল'], rows.map(r => [esc(r.client_code), esc(r.full_name), money(r.due_amount), esc(r.phone)]))
        : `• **Total dues:** **${money(s.total_dues)}**\n• **Customers with dues:** ${s.due_customers}\n\n`
          + table(['Client ID', 'Name', 'Due', 'Phone'], rows.map(r => [esc(r.client_code), esc(r.full_name), money(r.due_amount), esc(r.phone)])));
      if (!rows.length) body += `\n> ${bn ? 'কোনো বকেয়া গ্রাহক পাওয়া যায়নি।' : 'No customers with outstanding dues.'}\n`;
      cards.push({ title: bn ? 'বকেয়া রিপোর্ট' : 'Due report', url: '/due-report' });
      break;
    }
    case 'online_users': {
      body = `### ${T.online}\n\n` + table(
        bn ? ['মেট্রিক', 'মান'] : ['Metric', 'Value'],
        [[bn ? 'লাইভ অনলাইন' : 'Live online', `**${s.online_users}**`],
         [bn ? ' Rx / Tx' : 'Rx / Tx', `${(num(s.rx_bps) / 1e6).toFixed(1)} / ${(num(s.tx_bps) / 1e6).toFixed(1)} Mbps`],
         [bn ? 'সক্রিয় গ্রাহক' : 'Active customers', s.active_clients]]);
      cards.push({ title: bn ? 'লাইভ সেশন' : 'Live sessions', url: '/subscribers/live' });
      break;
    }
    case 'new_connections': {
      body = `### ${T.newconn}\n\n` + table(
        bn ? ['এই মাসে', 'গত মাসে', 'আজকে'] : ['This month', 'Last month', 'Today'],
        [[`**${s.new_this_month ?? 0}**`, '—', '—']]) + '\n' +
        table(bn ? ['কাস্টমার আইডি', 'নাম', 'প্যাকেজ', 'তারিখ'] : ['Client ID', 'Name', 'Package', 'Date'],
          rows.map(r => [esc(r.client_code), esc(r.full_name), esc(r.package_name), esc(String(r.created_at).slice(0, 10))]));
      cards.push({ title: bn ? 'নতুন সংযোগ' : 'New connections', url: '/clients' });
      break;
    }
    case 'expiry': {
      body = `### ${T.expiring}\n\n` + (bn ? `🔴 **${s.expiring_soon ?? rows.length}** জনের লাইনের মেয়াদ শীঘ্রই শেষ হবে।\n\n` : `🔴 **${s.expiring_soon ?? rows.length}** connections expiring soon.\n\n`) +
        table(bn ? ['কাস্টমার আইডি', 'নাম', 'প্যাকেজ', 'মেয়াদ শেষ'] : ['Client ID', 'Name', 'Package', 'Expiry'],
          rows.map(r => [esc(r.client_code), esc(r.full_name), esc(r.package_name), esc(String(r.expiry_date).slice(0, 10))]));
      cards.push({ title: bn ? 'সক্রিয় গ্রাহক' : 'Active subscribers', url: '/clients' });
      break;
    }
    case 'router_health': {
      if (!NETWORK_ROLES.includes(ctx.actor.role) && ctx.actor.role !== 'BILLING_OPERATOR' && ctx.actor.role !== 'TECHNICIAN') {
        body = `### ${T.router}\n\n${denyText(bn)}`;
      } else {
        body = `### ${T.router}\n\n` + table(bn ? ['নাম', 'হোস্ট', 'মোড', 'স্ট্যাটাস'] : ['Name', 'Host', 'Mode', 'Status'],
          rows.map(r => [esc(r.name), esc(r.host), esc(r.integration_mode), r.status === 'ONLINE' ? '🟢 Online' : '🔴 Offline']));
        body += `\n> ${bn ? `${s.routers_online}/${s.routers_total} রাউটার অনলাইন।` : `${s.routers_online}/${s.routers_total} routers online.`}\n`;
        cards.push({ title: bn ? 'রাউটার ওভারভিউ' : 'Router overview', url: '/routers' });
      }
      break;
    }
    case 'olt_health': {
      if (!NETWORK_ROLES.includes(ctx.actor.role) && ctx.actor.role !== 'TECHNICIAN') {
        body = `### ${T.olt}\n\n${denyText(bn)}`;
      } else {
        body = `### ${T.olt}\n\n` + table(bn ? ['OLT', 'ভেন্ডর', 'স্ট্যাটাস', 'ONU'] : ['OLT', 'Vendor', 'Status', 'ONUs'],
          rows.map(r => [esc(r.name), esc(r.vendor), r.status === 'ONLINE' ? '🟢 Online' : '🔴 Offline', `${r.online_onus}/${r.onus}`]));
        cards.push({ title: bn ? 'OLT ম্যানেজার' : 'OLT manager', url: '/olts' });
      }
      break;
    }
    case 'tickets': {
      body = `### ${T.ticket}\n\n` + (bn ? `🟢 **${s.open_tickets}** টি খোলা টিকেট, ⚠️ ${s.breached_tickets} টি SLA breach।\n\n` : `🟢 **${s.open_tickets}** open tickets, ⚠️ ${s.breached_tickets} SLA breaches.\n\n`) +
        table(bn ? ['টিকেট', 'বিষয়', 'অবস্থা', 'অগ্রাধিকার'] : ['Ticket', 'Subject', 'Status', 'Priority'],
          rows.map(r => [esc(r.ticket_no), esc(r.subject), esc(r.status), esc(r.priority)]));
      cards.push({ title: bn ? 'সব টিকেট' : 'All tickets', url: '/tickets' });
      break;
    }
    case 'leads': {
      if (!CRM_ROLES.includes(ctx.actor.role)) { body = `### ${T.lead}\n\n${denyText(bn)}`; break; }
      body = `### ${T.lead}\n\n` + table(bn ? ['অবস্থা', 'সংখ্যা'] : ['Status', 'Count'], rows.map(r => [esc(r.status), r.n]));
      cards.push({ title: bn ? 'লিড পাইপলাইন' : 'Lead pipeline', url: '/leads' });
      break;
    }
    case 'reseller_wallet': {
      if (ctx.actor.role !== 'RESELLER' && !MONEY_ROLES.includes(ctx.actor.role)) { body = `### ${T.reseller}\n\n${denyText(bn)}`; break; }
      body = `### ${T.reseller}\n\n` + table(bn ? ['রিসেলার', 'ব্যালেন্স', 'ক্রেডিট লিমিট'] : ['Reseller', 'Balance', 'Credit limit'],
        rows.map(r => [esc(r.name), money(r.wallet_balance), money(r.credit_limit)]));
      cards.push({ title: bn ? 'রিসেলার টপ-আপ' : 'Reseller top-up', url: '/resellers' });
      break;
    }
    case 'hotspot': {
      body = `### ${T.hotspot}\n\n` + table(bn ? ['স্ট্যাটাস', 'সংখ্যা', 'মূল্য'] : ['Status', 'Count', 'Value'],
        rows.map(r => [esc(r.status), r.n, money(r.value)]));
      cards.push({ title: bn ? 'হটস্পট ভাউচার' : 'Hotspot vouchers', url: '/hotspot' });
      break;
    }
    case 'inventory': {
      if (!['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER', 'TECHNICIAN'].includes(ctx.actor.role)) { body = `### ${T.stock}\n\n${denyText(bn)}`; break; }
      body = `### ${T.stock}\n\n` + (rows.length
        ? table(bn ? ['আইটেম', 'ক্যাটাগরি', 'Reorder', 'হাতে আছে'] : ['Item', 'Category', 'Reorder', 'On hand'],
          rows.map(r => [esc(r.name), esc(r.category), r.reorder_level, r.on_hand]))
        : `> ${bn ? 'কোনো আইটেম reorder level-এর নিচে নেই।' : 'No items below reorder level.'}`);
      cards.push({ title: bn ? 'ইনভেন্টরি' : 'Inventory', url: '/inventory' });
      break;
    }
    case 'packages': {
      body = `### ${T.package}\n\n` + table(bn ? ['নাম', 'ডাউনলোড', 'আপলোড', 'মূল্য'] : ['Name', 'Download', 'Upload', 'Price'],
        rows.map(r => [esc(r.name), `${r.download_mbps} Mbps`, `${r.upload_mbps} Mbps`, money(r.price)]));
      cards.push({ title: bn ? 'ব্যান্ডউইথ প্যাকেজ' : 'Bandwidth packages', url: '/bandwidth' });
      break;
    }
    case 'payment_gateways': {
      if (!MONEY_ROLES.includes(ctx.actor.role) && ctx.actor.role !== 'RESELLER') { body = `### ${T.gateway}\n\n${denyText(bn)}`; break; }
      body = `### ${T.gateway}\n\n` + table(bn ? ['গেটওয়ে', 'লেনদেন', 'গত ৩০ দিন'] : ['Gateway', 'Transactions', 'Last 30 days'],
        rows.map(r => [esc(r.gateway), r.n, money(r.total)]));
      cards.push({ title: bn ? 'পেমেন্ট রিপোর্ট' : 'Payment report', url: '/payments' });
      break;
    }
    case 'staff_collection': {
      if (!MONEY_ROLES.includes(ctx.actor.role)) { body = `### ${T.staff}\n\n${denyText(bn)}`; break; }
      body = `### ${T.staff}\n\n` + table(bn ? ['কালেক্টর', 'লেনদেন', 'মোট'] : ['Collector', 'Transactions', 'Total'],
        rows.map(r => [esc(r.collector), r.n, money(r.total)]));
      cards.push({ title: bn ? 'কালেকশন' : 'Collection', url: '/payments' });
      break;
    }
    case 'kyc': {
      if (!CRM_ROLES.includes(ctx.actor.role)) { body = `### ${T.kyc}\n\n${denyText(bn)}`; break; }
      body = `### ${T.kyc}\n\n` + (bn ? `🪪 **${s.kyc_pending ?? 0}** টি KYC ডকুমেন্ট পেন্ডিং আছে।` : `🪪 **${s.kyc_pending ?? 0}** KYC documents pending.`);
      cards.push({ title: bn ? 'গ্রাহক তালিকা' : 'Subscribers', url: '/clients' });
      break;
    }
    case 'gis_sites': {
      if (!['SUPER_ADMIN', 'NOC_ENGINEER', 'BILLING_OPERATOR', 'TECHNICIAN'].includes(ctx.actor.role)) { body = `### ${T.gis}\n\n${denyText(bn)}`; break; }
      body = `### ${T.gis}\n\n` + (bn ? `🗺️ **${s.gis_sites ?? 0}** টি distribution box, **${s.gis_routes ?? 0}** টি fiber route রেকর্ড আছে।` : `🗺️ **${s.gis_sites ?? 0}** distribution boxes, **${s.gis_routes ?? 0}** fiber routes recorded.`);
      cards.push({ title: bn ? 'GIS মানচিত্র' : 'GIS map', url: '/gis' });
      break;
    }
    case 'sms_templates': {
      body = bn
        ? `### 📱 SMS / WhatsApp টেমপ্লেট\n\nনিচের টেমপ্লেটগুলো কপি করে **SMS Campaigns** বা **WhatsApp Bulk** থেকে পাঠাতে পারেন।\n\n` +
          `#### 🔔 মেয়াদ শেষ হওয়ার পূর্বে রিমাইন্ডার\n\`\`\`text\nপ্রিয় গ্রাহক, আপনার ইন্টারনেট লাইনের মেয়াদ {expire_date} তারিখে শেষ হবে। নির্বিঘ্ন সেবার জন্য মাসিক বিল ৳{amount} পরিশোধ করুন। ধন্যবাদ — IzanDesk\n\`\`\`\n` +
          `#### ⚠️ সাসপেন্ড নোটিশ\n\`\`\`text\nপ্রিয় গ্রাহক, বকেয়া বিলের কারণে আপনার সংযোগ সাময়িকভাবে স্থগিত করা হয়েছে। বিল পরিশোধ করে লাইনটি তৎক্ষণাৎ সচল করুন।\n\`\`\`\n` +
          `#### ✅ পেমেন্ট কনফার্মেশন\n\`\`\`text\nধন্যবাদ! ৳{amount} পেমেন্ট গ্রহণ করা হয়েছে। Trx ID: {trx_id}। আপনার সেবা সচল রয়েছে।\n\`\`\``
        : `### 📱 SMS / WhatsApp templates\n\nCopy these into **SMS Campaigns** or **WhatsApp Bulk**.\n\n` +
          `#### 🔔 Pre-expiry reminder\n\`\`\`text\nDear customer, your internet plan expires on {expire_date}. Please pay ৳{amount} to keep your service active. Thank you — IzanDesk\n\`\`\`\n` +
          `#### ⚠️ Suspension notice\n\`\`\`text\nDear customer, your connection has been temporarily suspended due to outstanding dues. Please recharge to restore service.\n\`\`\`\n` +
          `#### ✅ Payment confirmation\n\`\`\`text\nThank you! Payment of ৳{amount} received. Trx ID: {trx_id}. Your service remains active.\n\`\`\``;
      cards.push({ title: bn ? 'SMS ক্যাম্পেইন' : 'SMS campaigns', url: '/messaging' });
      break;
    }
    case 'customer_lookup': {
      body = `### ${T.customer}\n\n` + (rows.length
        ? rows.map(r => `**${esc(r.full_name)}** · \`${esc(r.client_code)}\` · ${esc(r.status)}\n` +
          `- ${bn ? 'প্যাকেজ' : 'Package'}: ${esc(r.package_name)}\n- ${bn ? 'মাসিক বিল' : 'Monthly bill'}: ${money(r.monthly_bill)} · ${bn ? 'বকেয়া' : 'Due'}: ${money(r.due)}\n- ${bn ? 'ফোন' : 'Phone'}: ${esc(r.phone)}\n`).join('\n')
        : `> ${bn ? `\`${esc(entity)}\` দিয়ে কোনো গ্রাহক পাওয়া যায়নি।` : `No customer found for \`${esc(entity)}\`.`}`);
      cards.push({ title: bn ? 'গ্রাহক তালিকা' : 'Subscriber list', url: '/clients' });
      break;
    }
    case 'subscriber_onu': {
      body = `### ${bn ? '🛰️ গ্রাহকের ONU তথ্য' : '🛰️ Subscriber ONU details'} · \`${esc(entity)}\`\n\n` + (rows.length
        ? rows.map(r => {
            const head = `**${esc(r.full_name)}** · \`${esc(r.client_code)}\` · ${esc(r.username)} · ${esc(r.subscriber_status)}\n`;
            if (!r.onu_name && !r.serial_number) return head + `- ${bn ? 'এই গ্রাহকের সাথে কোনো ONU যুক্ত নেই।' : 'No ONU is linked to this subscriber.'}\n`;
            const rx = r.rx_power_dbm == null ? '-' : `${Number(r.rx_power_dbm).toFixed(2)} dBm`;
            const weak = r.rx_power_dbm != null && Number(r.rx_power_dbm) < -27
              ? (bn ? ' ⚠️ কম সিগন্যাল' : ' ⚠️ weak signal') : '';
            return head + table(
              bn ? ['OLT', 'PON', 'ONU', 'সিরিয়াল', 'স্ট্যাটাস', 'Rx পাওয়ার', 'দূরত্ব'] : ['OLT', 'PON', 'ONU', 'Serial', 'Status', 'Rx power', 'Distance'],
              [[esc(r.olt_name), esc(r.pon_port), esc(r.onu_id), esc(r.serial_number), esc(r.onu_status), `${rx}${weak}`, r.distance_m != null ? `${r.distance_m} m` : '-']]
            ) + (r.last_down_cause ? `> ${bn ? 'শেষ ডাউন কারণ' : 'Last down cause'}: ${esc(r.last_down_cause)}\n` : '');
          }).join('\n')
        : `> ${bn ? `\`${esc(entity)}\` দিয়ে কোনো গ্রাহক পাওয়া যায়নি।` : `No subscriber found for \`${esc(entity)}\`.`}`);
      cards.push({ title: bn ? 'OLT ম্যানেজার' : 'OLT manager', url: '/olts' });
      break;
    }
    default: {
      body = `### ${T.help}\n\n` + (bn
        ? 'আমি আপনার লাইভ ISP ডেটা থেকে প্রশ্নের উত্তর দিই: কালেকশন, গ্রাহক সংখ্যা, বকেয়া, মেয়াদ, রাউটার হেলথ, OLT, টিকেট, লিড, হটস্পট, ইনভেন্টরি ও প্যাকেজ রেট।\n\nকোনো গ্রাহকের নাম, কাস্টমার আইডি বা ফোন নম্বর দিতে পারেন। নেটওয়ার্ক ভূমিকায় “isa-র ONU তথ্য” বললে তার ONU-র বিবরণ দেখাব।'
        : 'I answer questions from your live ISP data: collections, customers, dues, expiry, router health, OLT, tickets, leads, hotspot, inventory and package rates. Give me a customer name, ID or phone number — network roles can also ask for a named subscriber’s ONU details.');
      break;
    }
  }
  return { reply: body, cards };
}

function denyText(bn: boolean) {
  return bn ? '> 🔒 আপনার ভূমিকায় এই তথ্য উপলব্ধ নয়।' : '> 🔒 This data is not available for your role.';
}

/** Hard role gate: the local engine never renders a denied topic, and the
 *  response `stats` blob is filtered too, so no hidden totals leak through. */
const INTENT_ROLES: Record<string, string[]> = {
  collection_today: [...MONEY_ROLES, 'RESELLER'],
  dues: [...MONEY_ROLES, 'RESELLER'],
  payment_gateways: [...MONEY_ROLES, 'RESELLER'],
  reseller_wallet: [...MONEY_ROLES, 'RESELLER'],
  revenue_month: MONEY_ROLES,
  staff_collection: MONEY_ROLES,
  router_health: [...NETWORK_ROLES, 'TECHNICIAN'],
  olt_health: [...NETWORK_ROLES, 'TECHNICIAN'],
  subscriber_onu: [...NETWORK_ROLES, 'TECHNICIAN'],
  leads: CRM_ROLES,
  kyc: CRM_ROLES,
  gis_sites: [...NETWORK_ROLES, 'BILLING_OPERATOR', 'TECHNICIAN'],
  inventory: ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER', 'TECHNICIAN'],
};
function intentAllowed(intent: string, role: string) {
  const allowed = INTENT_ROLES[intent];
  return !allowed || allowed.includes(role);
}
const MONEY_FIELDS = ['today_collection', 'today_transactions', 'total_dues', 'due_customers', 'reseller_wallet', 'reseller_count', 'mrr', 'month_collection', 'last30_collection'];
const NETWORK_FIELDS = ['routers_total', 'routers_online', 'olts_total', 'olts_online', 'rx_bps', 'tx_bps'];
function filterStatsForRole(stats: Record<string, any>, role: string) {
  const out = { ...stats };
  if (!MONEY_ROLES.includes(role) && role !== 'RESELLER') for (const k of MONEY_FIELDS) delete out[k];
  if (role === 'TECHNICIAN' || role === 'RESELLER' || role === 'BILLING_OPERATOR') for (const k of NETWORK_FIELDS) delete out[k];
  return out;
}
const TITLE_KEYS: Record<string, string> = {
  collection_today: 'collection', revenue_month: 'collection', dues: 'dues', customer_stats: 'customers',
  online_users: 'online', expiring: 'expiring', router_health: 'router', olt_health: 'olt', subscriber_onu: 'olt', tickets: 'ticket',
  new_connections: 'newconn', reseller_wallet: 'reseller', hotspot: 'hotspot', inventory: 'stock',
  packages: 'package', payment_gateways: 'gateway', staff_collection: 'staff', leads: 'lead', kyc: 'kyc',
  gis_sites: 'gis', customer_lookup: 'customer', greeting: 'help', help: 'help', free_form: 'help', sms_templates: 'help',
};
function pct(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '—';
}

/* ------------------------- external LLM (opt-in) ------------------------ */

async function freeFormExternal(pool: any, ctx: Ctx, message: string, lang: 'bn' | 'en', s: Record<string, any>): Promise<{ reply: string; provider: 'gemini' | 'openai' | 'nim' } | null> {
  const allow = await getCached('ai.allow_external', false);
  if (!allow) return null;
  const provider = String(await getCached('ai.provider', 'auto'));
  if (!['gemini', 'openai', 'nim'].includes(provider)) return null;
  const key = String(await getCached(`ai.${provider}_api_key`, ''));
  if (!key) return null;

  const safe = filterStatsForRole(s, ctx.role);
  const context = JSON.stringify({
    scope: ctx.actor.role,
    period: 'live / current billing cycle',
    metrics: {
      total_customers: safe.total_clients, active: safe.active_clients, expired: safe.expired_clients,
      online_users: safe.online_users, open_tickets: safe.open_tickets,
      ...(safe.today_collection !== undefined ? { today_collection: safe.today_collection, total_dues: safe.total_dues, reseller_wallet: safe.reseller_wallet } : {}),
      ...(safe.routers_total !== undefined ? { routers_online: safe.routers_online, routers_total: safe.routers_total } : {}),
    },
    currency: 'BDT',
  });
  const system = `You are IzanDesk AI Copilot, an ISP operations assistant. Reply in ${lang === 'bn' ? 'Bengali' : 'English'}. ` +
    `Use ONLY the aggregate metrics in the provided context. Never invent numbers, never request or repeat passwords, ` +
    `tokens, phone numbers or personal data. If the answer is not in the context, say you don't have that data and suggest ` +
    `asking one of the supported topics. Keep it short and practical. Context: ${context}`;

  try {
    if (provider === 'openai') {
      const model = String(await getCached('ai.openai_model', 'gpt-4o-mini'));
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_tokens: 600 }),
        signal: (AbortSignal as any).timeout(12000),
      });
      if (!r.ok) return null;
      const j: any = await r.json();
      const text = j?.choices?.[0]?.message?.content;
      return text ? { reply: String(text).slice(0, 4000), provider: 'openai' } : null;
    }
    if (provider === 'nim') {
      // NVIDIA NIM exposes an OpenAI-compatible Chat Completions API, both for
      // NIM Cloud (integrate.api.nvidia.com) and self-hosted NIM containers.
      const base = String(await getCached('ai.nim_base_url', 'https://integrate.api.nvidia.com/v1')).replace(/\/+$/, '');
      const model = String(await getCached('ai.nim_model', 'nvidia/nemotron-3-ultra-550b-a55b'));
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_tokens: 600, temperature: 0.2, stream: false }),
        signal: (AbortSignal as any).timeout(20000),
      });
      if (!r.ok) return null;
      const j: any = await r.json();
      const text = j?.choices?.[0]?.message?.content;
      return text ? { reply: String(text).slice(0, 4000), provider: 'nim' } : null;
    }
    const model = String(await getCached('ai.gemini_model', 'gemini-2.0-flash'));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: message }] }], generationConfig: { maxOutputTokens: 600 } }),
      signal: (AbortSignal as any).timeout(12000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('\n');
    return text ? { reply: String(text).slice(0, 4000), provider: 'gemini' } : null;
  } catch {
    return null;
  }
}

/* ------------------------------- public -------------------------------- */

export async function askAI(pool: any, actor: AIActor, message: string, _history: Array<{ role: string; content: string }> = []): Promise<AIResult> {
  const ctx: Ctx = { role: actor.role, actor };
  const start = Date.now();
  const detected = detectIntent(message);
  const allowed = intentAllowed(detected.intent, actor.role);
  const s = await baseStats(pool, ctx);
  const extras = allowed ? await intentExtras(pool, ctx, detected.intent, detected.entity) : { stats: {}, rows: [] };
  const merged = { ...s, ...extras.stats };

  let provider: AIResult['provider'] = 'local';
  let reply: string;
  let cards: AICard[] = [];
  if (!allowed) {
    const T = detected.lang === 'bn' ? BN.title : EN.title;
    reply = `### ${(T as any)[TITLE_KEYS[detected.intent] || 'help']}\n\n${denyText(detected.lang === 'bn')}`;
  } else {
    const rendered = render(detected.intent, detected.lang, merged, extras.rows, ctx, detected.entity);
    reply = rendered.reply;
    cards = rendered.cards;
    if (detected.intent === 'free_form') {
      const external = await freeFormExternal(pool, ctx, message, detected.lang, merged);
      if (external) { reply = external.reply; provider = external.provider; }
    }
  }

  return {
    reply,
    provider,
    intent: detected.intent,
    lang: detected.lang,
    cards,
    quickPrompts: quickPromptsFor(actor.role, detected.lang),
    stats: filterStatsForRole(merged, actor.role),
    meta: { role: actor.role, restricted: !allowed, latency_ms: Date.now() - start, at: new Date().toISOString() },
  };
}
