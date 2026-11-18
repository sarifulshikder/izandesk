/**
 * Settings & Security store.
 *
 * One row per key in the `settings` table (key = "<category>.<field>", value JSONB).
 * Schema-driven: SETTINGS_SCHEMA defines every editable field (type, options, default,
 * secret flag). Secrets are masked on read and never logged in plaintext.
 * A short-lived cache backs enforcement reads (auth middleware, billing) so we don't
 * hit the DB on every request.
 */
import { pool } from '../db';
import { auditLog } from './audit';

export type SettingType = 'string' | 'text' | 'number' | 'boolean' | 'select' | 'array' | 'password';

export interface SettingDef {
  key: string;            // "<category>.<field>"
  category: string;
  label: string;
  type: SettingType;
  options?: string[];     // for select
  min?: number; max?: number; // for number
  default: any;
  description?: string;
  secret?: boolean;       // masked on read, blank = keep old on write
  hidden?: boolean;       // internal (not rendered in UI)
}

export const SETTINGS_CATEGORIES: Record<string, { label: string; description: string }> = {
  general: { label: 'General', description: 'Company profile, localization and invoice numbering.' },
  security: { label: 'Security', description: 'Password policy, sessions, lockout, maintenance mode.' },
  notifications: { label: 'Notifications', description: 'SMTP/SMS channels and event toggles.' },
  branding: { label: 'Branding', description: 'Portal/login appearance and white-label fields.' },
  billing: { label: 'Billing', description: 'Due policy, late fees and auto-suspension.' },
  network: { label: 'Network', description: 'Default device/management parameters.' },
  acs: { label: 'ACS / TR-069', description: 'GenieACS (TR-069/CWMP) integration for CPE management.' },
  ai: { label: 'AI Copilot', description: 'Bilingual operations assistant: free local engine, optional Gemini/OpenAI for free-form questions.' },
};

export const SETTINGS_SCHEMA: SettingDef[] = [
  // ---- general ----
  { key: 'general.company_name', category: 'general', label: 'Company Name', type: 'string', default: 'IzanDesk ISP' },
  { key: 'general.company_address', category: 'general', label: 'Address', type: 'text', default: '' },
  { key: 'general.company_phone', category: 'general', label: 'Phone', type: 'string', default: '' },
  { key: 'general.company_email', category: 'general', label: 'Email', type: 'string', default: '' },
  { key: 'general.timezone', category: 'general', label: 'Timezone', type: 'select', options: ['Asia/Dhaka', 'UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London'], default: 'Asia/Dhaka' },
  { key: 'general.currency', category: 'general', label: 'Currency', type: 'select', options: ['BDT', 'USD', 'EUR', 'INR', 'GBP', 'AED'], default: 'BDT' },
  { key: 'general.currency_symbol', category: 'general', label: 'Currency Symbol', type: 'string', default: '৳' },
  { key: 'general.date_format', category: 'general', label: 'Date Format', type: 'select', options: ['d/m/Y', 'm/d/Y', 'Y-m-d'], default: 'd/m/Y' },
  { key: 'general.language', category: 'general', label: 'Language', type: 'select', options: ['en', 'bn'], default: 'en' },
  { key: 'general.invoice_prefix', category: 'general', label: 'Invoice Prefix', type: 'string', default: 'INV' },
  { key: 'general.invoice_next_number', category: 'general', label: 'Next Invoice Sequence (per month)', type: 'number', min: 1, default: 1, description: 'Used as the base sequence for monthly invoice numbers.' },
  { key: 'general.fiscal_year_start', category: 'general', label: 'Fiscal Year Start (MM-DD)', type: 'string', default: '01-01' },

  // ---- security ----
  { key: 'security.password_min_length', category: 'security', label: 'Min Password Length', type: 'number', min: 6, max: 64, default: 8 },
  { key: 'security.password_require_upper', category: 'security', label: 'Require Uppercase', type: 'boolean', default: true },
  { key: 'security.password_require_lower', category: 'security', label: 'Require Lowercase', type: 'boolean', default: true },
  { key: 'security.password_require_digit', category: 'security', label: 'Require Digit', type: 'boolean', default: true },
  { key: 'security.password_require_symbol', category: 'security', label: 'Require Symbol', type: 'boolean', default: false },
  { key: 'security.password_expiry_days', category: 'security', label: 'Password Expiry (days, 0=never)', type: 'number', min: 0, max: 3650, default: 90 },
  { key: 'security.session_timeout_minutes', category: 'security', label: 'Session Timeout (minutes)', type: 'number', min: 5, max: 43200, default: 720 },
  { key: 'security.login_max_attempts', category: 'security', label: 'Max Failed Logins before Lockout', type: 'number', min: 1, max: 50, default: 5 },
  { key: 'security.login_lockout_minutes', category: 'security', label: 'Lockout Duration (minutes)', type: 'number', min: 1, max: 1440, default: 15 },
  { key: 'security.require_2fa', category: 'security', label: 'Require 2FA (TOTP) — planned', type: 'boolean', default: false },
  { key: 'security.admin_ip_allowlist', category: 'security', label: 'Admin IP Allowlist (comma-separated, empty=all)', type: 'array', default: [] },
  { key: 'security.maintenance_mode', category: 'security', label: 'Maintenance Mode', type: 'boolean', default: false, description: 'Blocks non-admin API access with 503.' },
  { key: 'security.maintenance_message', category: 'security', label: 'Maintenance Message', type: 'text', default: 'IzanDesk is under maintenance. Please try again later.' },
  { key: 'security.password_overrides', category: 'security', label: 'Password Overrides', type: 'password', default: {}, secret: true, hidden: true, description: 'bcrypt hashes for changed staff passwords (internal).' },

  // ---- notifications ----
  { key: 'notifications.smtp_host', category: 'notifications', label: 'SMTP Host', type: 'string', default: '' },
  { key: 'notifications.smtp_port', category: 'notifications', label: 'SMTP Port', type: 'number', min: 1, max: 65535, default: 587 },
  { key: 'notifications.smtp_secure', category: 'notifications', label: 'SMTP Secure (TLS/SSL)', type: 'boolean', default: false },
  { key: 'notifications.smtp_user', category: 'notifications', label: 'SMTP Username', type: 'string', default: '' },
  { key: 'notifications.smtp_pass', category: 'notifications', label: 'SMTP Password', type: 'password', default: '', secret: true },
  { key: 'notifications.smtp_from', category: 'notifications', label: 'From Address', type: 'string', default: '' },
  { key: 'notifications.sms_gateway', category: 'notifications', label: 'Default SMS Gateway', type: 'select', options: ['none', 'greenweb', 'twilio', 'whatsapp', 'telegram'], default: 'greenweb' },
  { key: 'notifications.notify_invoice_created', category: 'notifications', label: 'Notify on invoice created', type: 'boolean', default: true },
  { key: 'notifications.notify_payment_received', category: 'notifications', label: 'Notify on payment received', type: 'boolean', default: true },
  { key: 'notifications.notify_ticket_update', category: 'notifications', label: 'Notify on ticket update', type: 'boolean', default: true },
  { key: 'notifications.notify_fup_action', category: 'notifications', label: 'Notify on FUP enforcement', type: 'boolean', default: true },
  { key: 'notifications.notify_low_stock', category: 'notifications', label: 'Notify on low stock', type: 'boolean', default: true },

  // ---- branding ----
  { key: 'branding.portal_title', category: 'branding', label: 'Portal Title', type: 'string', default: 'IzanDesk Self-Care' },
  { key: 'branding.primary_color', category: 'branding', label: 'Primary Color', type: 'string', default: '#6366f1' },
  { key: 'branding.secondary_color', category: 'branding', label: 'Secondary Color', type: 'string', default: '#22d3ee' },
  { key: 'branding.logo_url', category: 'branding', label: 'Logo URL', type: 'string', default: '' },
  { key: 'branding.login_tagline', category: 'branding', label: 'Login Tagline', type: 'text', default: 'ISP Billing & Network OSS' },

  // ---- billing ----
  { key: 'billing.auto_invoice_day', category: 'billing', label: 'Auto Invoice Day of Month', type: 'number', min: 1, max: 28, default: 1 },
  { key: 'billing.due_grace_days', category: 'billing', label: 'Due Grace Days', type: 'number', min: 0, max: 60, default: 3 },
  { key: 'billing.late_fee_percent', category: 'billing', label: 'Late Fee (%)', type: 'number', min: 0, max: 100, default: 0 },
  { key: 'billing.auto_suspend_on_overdue', category: 'billing', label: 'Auto-suspend on overdue', type: 'boolean', default: true },
  { key: 'billing.walled_garden_profile', category: 'billing', label: 'Walled-Garden PPP Profile', type: 'string', default: 'walled-garden' },
  { key: 'billing.reminder_days_before_due', category: 'billing', label: 'Reminder Days Before Due (comma-separated)', type: 'array', default: [3, 1] },

  // ---- network ----
  { key: 'network.snmp_default_community', category: 'network', label: 'Default SNMP Community', type: 'password', default: 'public', secret: true },
  { key: 'network.default_ssh_port', category: 'network', label: 'Default SSH Port', type: 'number', min: 1, max: 65535, default: 22 },
  { key: 'network.olt_poll_interval_sec', category: 'network', label: 'OLT Poll Interval (seconds)', type: 'number', min: 10, max: 3600, default: 60 },

  // ---- acs / tr-069 ----
  { key: 'acs.genieacs_url', category: 'acs', label: 'GenieACS NBI URL', type: 'string', default: '', description: 'GenieACS Northbound Interface base URL (e.g. http://genieacs:7557 or http://<server>:7557). Env GENIEACS_URL is used as fallback if not set here.' },
  { key: 'acs.genieacs_user', category: 'acs', label: 'GenieACS Username', type: 'string', default: '', description: 'Optional HTTP Basic auth username for GenieACS NBI.' },
  { key: 'acs.genieacs_pass', category: 'acs', label: 'GenieACS Password', type: 'password', default: '', secret: true, description: 'Optional HTTP Basic auth password for GenieACS NBI.' },

  // ---- ai copilot ----
  { key: 'ai.enabled', category: 'ai', label: 'Enable AI Copilot', type: 'boolean', default: true },
  { key: 'ai.provider', category: 'ai', label: 'Provider', type: 'select', options: ['auto', 'local', 'gemini', 'openai', 'nim'], default: 'auto', description: 'auto/local use the free built-in engine. Gemini/OpenAI/NVIDIA NIM are used only for free-form questions when external access is allowed.' },
  { key: 'ai.allow_external', category: 'ai', label: 'Allow external AI providers', type: 'boolean', default: false, description: 'OFF by default. When ON, free-form questions send aggregate-only metrics (never subscriber PII or credentials) to the configured provider.' },
  { key: 'ai.gemini_api_key', category: 'ai', label: 'Google Gemini API Key', type: 'password', default: '', secret: true, description: 'Optional free-tier key from Google AI Studio.' },
  { key: 'ai.gemini_model', category: 'ai', label: 'Gemini Model', type: 'string', default: 'gemini-2.0-flash' },
  { key: 'ai.openai_api_key', category: 'ai', label: 'OpenAI API Key', type: 'password', default: '', secret: true, description: 'Optional key for GPT-4o-mini.' },
  { key: 'ai.openai_model', category: 'ai', label: 'OpenAI Model', type: 'string', default: 'gpt-4o-mini' },
  { key: 'ai.nim_api_key', category: 'ai', label: 'NVIDIA NIM API Key', type: 'password', default: '', secret: true, description: 'NVIDIA API key (nvapi-…) for NIM / NVIDIA Cloud APIs.' },
  { key: 'ai.nim_base_url', category: 'ai', label: 'NIM Base URL', type: 'string', default: 'https://integrate.api.nvidia.com/v1', description: 'OpenAI-compatible base URL. Use your self-hosted NIM endpoint if applicable (e.g. http://nim-host:8000/v1).' },
  { key: 'ai.nim_model', category: 'ai', label: 'NIM Model', type: 'string', default: 'nvidia/nemotron-3-ultra-550b-a55b', description: 'NIM chat model id, e.g. nvidia/nemotron-3-ultra-550b-a55b or meta/llama-3.3-70b-instruct.' },
  { key: 'ai.rate_limit_per_min', category: 'ai', label: 'Requests per minute per user', type: 'number', min: 1, max: 300, default: 30 },
  { key: 'ai.max_history', category: 'ai', label: 'Max conversation turns sent', type: 'number', min: 0, max: 100, default: 20 },
];

export function defFor(key: string): SettingDef | undefined {
  return SETTINGS_SCHEMA.find((d) => d.key === key);
}

export function maskSecret(v: any): string {
  return v === undefined || v === null || v === '' ? '' : '••••••••';
}

/* ----------------------------- reads ----------------------------- */

let cache: { at: number; data: Record<string, any> } = { at: 0, data: {} };
const CACHE_TTL_MS = 5000;

async function loadAll(): Promise<Record<string, any>> {
  const r = await pool.query('SELECT key, value FROM settings');
  const data: Record<string, any> = {};
  for (const row of r.rows) data[row.key] = row.value;
  return data;
}

async function ensureSeeded() {
  // seed defaults for any missing key
  for (const def of SETTINGS_SCHEMA) {
    await pool.query(
      `INSERT INTO settings(key, category, value) VALUES($1, $2, $3::jsonb) ON CONFLICT (key) DO NOTHING`,
      [def.key, def.category, JSON.stringify(def.default)]
    );
  }
}

export async function getAllSettings(): Promise<Record<string, any>> {
  await ensureSeeded();
  const all = await loadAll();
  const out: Record<string, any> = {};
  for (const def of SETTINGS_SCHEMA) {
    out[def.key] = def.key in all ? all[def.key] : def.default;
  }
  // include hidden extras not in schema (e.g. password_overrides handled via schema too)
  for (const k of Object.keys(all)) if (!(k in out)) out[k] = all[k];
  return out;
}

/** Cached read for hot paths (auth middleware etc.). Falls back to defaults on DB error. */
export async function getCached(key: string, fallback?: any): Promise<any> {
  const def = defFor(key);
  const fb = fallback !== undefined ? fallback : def?.default;
  try {
    if (Date.now() - cache.at > CACHE_TTL_MS) {
      cache = { at: Date.now(), data: await getAllSettings() };
    }
    return key in cache.data ? cache.data[key] : fb;
  } catch {
    return fb;
  }
}

export async function getSetting(key: string, fallback?: any): Promise<any> {
  const all = await getAllSettings();
  return key in all ? all[key] : (fallback !== undefined ? fallback : defFor(key)?.default);
}

export function invalidateCache() { cache = { at: 0, data: {} }; }

/* ----------------------------- writes ----------------------------- */

function coerce(def: SettingDef, raw: any): any {
  switch (def.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${def.label}: must be a number`);
      if (def.min !== undefined && n < def.min) throw new Error(`${def.label}: must be >= ${def.min}`);
      if (def.max !== undefined && n > def.max) throw new Error(`${def.label}: must be <= ${def.max}`);
      return n;
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on';
    case 'select':
      if (def.options && !def.options.includes(String(raw))) throw new Error(`${def.label}: must be one of ${def.options.join(', ')}`);
      return String(raw);
    case 'array': {
      const arr = Array.isArray(raw) ? raw : String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
      return arr.map(String);
    }
    case 'password':
    case 'string':
    case 'text':
    default:
      return String(raw ?? '');
  }
}

export interface SetResult { category: string; updated: string[]; values: Record<string, any> }

export async function setCategory(
  category: string,
  values: Record<string, any>,
  actor?: { actor_id?: any; actor_name?: any; actor_role?: any; ip_address?: any }
): Promise<SetResult> {
  const defs = SETTINGS_SCHEMA.filter((d) => d.category === category);
  if (!defs.length) throw new Error(`Unknown category: ${category}`);
  const current = await getAllSettings();
  const updated: string[] = [];
  const out: Record<string, any> = {};
  for (const def of defs) {
    const field = def.key.slice(category.length + 1);
    if (!(field in (values || {}))) continue;
    let v = values[field];
    // secret fields: blank means "keep existing"
    if (def.secret && (v === '' || v === undefined || v === null)) {
      out[field] = current[def.key];
      continue;
    }
    v = coerce(def, v);
    if (JSON.stringify(current[def.key]) === JSON.stringify(v)) { out[field] = v; continue; }
    await pool.query(
      `INSERT INTO settings(key, category, value, updated_by) VALUES($1,$2,$3::jsonb,$4)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [def.key, category, JSON.stringify(v), actor?.actor_name || null]
    );
    await auditLog({
      ...actor,
      action: 'settings.update',
      entity_type: 'settings',
      entity_id: def.key,
      details: { category, field, old: def.secret ? maskSecret(current[def.key]) : current[def.key], new: def.secret ? maskSecret(v) : v },
    });
    updated.push(def.key);
    out[field] = v;
  }
  invalidateCache();
  const fresh = await getAllSettings();
  const grouped: Record<string, any> = {};
  for (const def of defs) grouped[def.key.slice(category.length + 1)] = fresh[def.key];
  return { category, updated, values: grouped };
}

export async function resetCategory(category: string, actor?: any): Promise<{ category: string; reset: string[] }> {
  const defs = SETTINGS_SCHEMA.filter((d) => d.category === category);
  if (!defs.length) throw new Error(`Unknown category: ${category}`);
  const reset: string[] = [];
  for (const def of defs) {
    if (def.hidden) continue;
    await pool.query(
      `INSERT INTO settings(key, category, value, updated_by) VALUES($1,$2,$3::jsonb,$4)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [def.key, category, JSON.stringify(def.default), actor?.actor_name || null]
    );
    reset.push(def.key);
  }
  await auditLog({ ...actor, action: 'settings.reset', entity_type: 'settings', entity_id: category, details: { category, keys: reset } });
  invalidateCache();
  return { category, reset };
}

/* --------------------- password policy (enforcement) --------------------- */

export async function validatePasswordPolicy(pw: string): Promise<string | null> {
  const min = Number(await getCached('security.password_min_length', 8)) || 8;
  const up = await getCached('security.password_require_upper', true);
  const low = await getCached('security.password_require_lower', true);
  const digit = await getCached('security.password_require_digit', true);
  const symbol = await getCached('security.password_require_symbol', false);
  if (pw.length < min) return `Password must be at least ${min} characters`;
  if (up && !/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter';
  if (low && !/[a-z]/.test(pw)) return 'Password must contain a lowercase letter';
  if (digit && !/[0-9]/.test(pw)) return 'Password must contain a digit';
  if (symbol && !/[^A-Za-z0-9]/.test(pw)) return 'Password must contain a symbol';
  return null;
}

/** Masked view for API responses: secrets become { masked, has_value }. */
export function maskedView(all: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const def of SETTINGS_SCHEMA) {
    const v = all[def.key];
    out[def.key] = def.secret ? { masked: maskSecret(v), has_value: !!(v && String(v).length) } : v;
  }
  return out;
}
