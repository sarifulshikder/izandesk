import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, ValidationError } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';
import { verifySmtpConnection } from '../integrations/mailer';
import {
  SETTINGS_SCHEMA, SETTINGS_CATEGORIES, defFor,
  getAllSettings, setCategory, resetCategory, maskedView,
} from '../integrations/settings';

const router: Router = Router();

function requireAdmin(req: any, res: any) {
  if (!['SUPER_ADMIN'].includes(String(req.user?.role || ''))) {
    res.status(403).json({ message: 'Settings changes require SUPER_ADMIN' });
    return false;
  }
  return true;
}

// Schema (categories, fields, types, defaults, labels) — drives the UI
router.get('/schema', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    ok: true,
    categories: SETTINGS_CATEGORIES,
    fields: SETTINGS_SCHEMA.filter((d) => !d.hidden).map((d) => ({
      key: d.key, category: d.category, field: d.key.slice(d.category.length + 1),
      label: d.label, type: d.type, options: d.options, min: d.min, max: d.max,
      default: d.default, description: d.description, secret: !!d.secret,
    })),
  });
}));

// All settings grouped by category, secrets masked
router.get('/', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const all = await getAllSettings();
  const masked = maskedView(all);
  const grouped: Record<string, any> = {};
  for (const cat of Object.keys(SETTINGS_CATEGORIES)) grouped[cat] = {};
  for (const k of Object.keys(masked)) {
    const cat = k.split('.')[0];
    const field = k.slice(cat.length + 1);
    (grouped[cat] = grouped[cat] || {})[field] = masked[k];
  }
  res.json({ ok: true, data: grouped, raw: masked });
}));

router.get('/:category', asyncHandler(async (req, res) => {
  const cat = String(req.params.category || '').toLowerCase();
  // General settings contain display/billing metadata (company name, currency,
  // timezone) needed by every dashboard. The schema, aggregate and every other
  // category — including secret-bearing ones — remain SUPER_ADMIN-only.
  if (cat !== 'general' && !requireAdmin(req, res)) return;
  if (!SETTINGS_CATEGORIES[cat]) throw new ValidationError(`Unknown category: ${cat}`);
  const all = maskedView(await getAllSettings());
  const out: Record<string, any> = {};
  for (const def of SETTINGS_SCHEMA.filter((d) => d.category === cat && !d.hidden)) {
    out[def.key.slice(cat.length + 1)] = all[def.key];
  }
  res.json({ ok: true, category: cat, data: out });
}));

// Update a category: body { values: { field: value } } — secret fields blank = keep
router.put('/:category', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const cat = String(req.params.category || '').toLowerCase();
  if (!SETTINGS_CATEGORIES[cat]) throw new ValidationError(`Unknown category: ${cat}`);
  const values = (req.body as any)?.values || {};
  // reject unknown fields
  const allowed = new Set(SETTINGS_SCHEMA.filter((d) => d.category === cat).map((d) => d.key.slice(cat.length + 1)));
  for (const k of Object.keys(values)) if (!allowed.has(k)) throw new ValidationError(`Unknown field for ${cat}: ${k}`);
  try {
    const result = await setCategory(cat, values, reqActor(req));
    res.json({ ok: true, ...result });
  } catch (e: any) {
    throw new ValidationError(e.message || 'Invalid setting value');
  }
}));

// Reset a category to defaults
router.post('/reset/:category', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const cat = String(req.params.category || '').toLowerCase();
  if (!SETTINGS_CATEGORIES[cat]) throw new ValidationError(`Unknown category: ${cat}`);
  const result = await resetCategory(cat, reqActor(req));
  res.json({ ok: true, ...result });
}));

// Real SMTP verification (auth + TLS/STARTTLS) via Nodemailer, with optional test email
router.post('/test-smtp', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const b = req.body || {};
  const host = String(b.host || '').trim();
  const port = Number(b.port || 587);
  if (!host) throw new ValidationError('host is required');
  const result = await verifySmtpConnection({
    host,
    port,
    ...(b.secure !== undefined ? { secure: b.secure === true || b.secure === 'true' } : {}),
    ...(b.user !== undefined ? { user: String(b.user) } : {}),
    ...(b.pass ? { pass: String(b.pass) } : {}),
    ...(b.from ? { from: String(b.from) } : {}),
    ...(b.test_to ? { test_to: String(b.test_to).trim() } : {}),
  });
  await auditLog({ ...reqActor(req), action: 'settings.test_smtp', entity_type: 'settings', entity_id: 'notifications.smtp', details: { host, port, ok: result.ok } });
  res.json({ ok: result.ok, ...result });
}));

// Who changed what lately (settings audit trail)
router.get('/audit/recent', asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const limit = Math.min(100, Number((req.query as any)?.limit || 25));
  const r = await pool.query(
    `SELECT * FROM audit_logs WHERE entity_type='settings' ORDER BY created_at DESC LIMIT $1`, [limit]
  );
  res.json({ ok: true, data: r.rows });
}));

export default router;
