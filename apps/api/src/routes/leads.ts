import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, getPagination, ValidationError, ConflictError } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';

const router: Router = Router();

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function str(v: any): string {
  return v === undefined || v === null ? '' : String(v).trim();
}
function nullableStr(v: any): string | null {
  const s = str(v);
  return s === '' ? null : s;
}
function enumVal(v: any, allowed: string[], field: string, fallback: string): string {
  const s = str(v).toUpperCase() || fallback;
  if (!allowed.includes(s)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  return s;
}

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'];
const LEAD_SOURCES = ['WALK_IN', 'CALL', 'WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'CAMPAIGN', 'OTHER'];
const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'WHATSAPP', 'SITE_VISIT', 'NOTE'];

async function nextLeadNo() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const r = await pool.query(`SELECT COUNT(*)::int as c FROM leads WHERE lead_no LIKE $1`, [`LD-${ym}-%`]);
  const n = (r.rows[0]?.c || 0) + 1;
  return `LD-${ym}-${String(n).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Lead CRUD                                                          */
/* ------------------------------------------------------------------ */

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const q = str(req.query.q).toLowerCase();
  const status = str(req.query.status);
  const source = str(req.query.source);
  const assigned = str(req.query.assigned_to);
  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(lower(full_name) LIKE $${params.length} OR lower(COALESCE(phone,'')) LIKE $${params.length} OR lower(COALESCE(email,'')) LIKE $${params.length} OR lower(COALESCE(lead_no,'')) LIKE $${params.length})`);
  }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (source) { params.push(source); where.push(`source = $${params.length}`); }
  if (assigned) { params.push(assigned); where.push(`assigned_to = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM leads ${whereSql}`, params);
  params.push(limit, offset);
  const rowsRes = await pool.query(`SELECT * FROM leads ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ data: rowsRes.rows, total: totalRes.rows[0].total, page, limit });
}));

router.get('/summary', asyncHandler(async (_req, res) => {
  const byStatus = await pool.query(`SELECT status, COUNT(*)::int AS c FROM leads GROUP BY status`);
  const bySource = await pool.query(`SELECT source, COUNT(*)::int AS c FROM leads GROUP BY source`);
  const total = (await pool.query('SELECT COUNT(*)::int AS c FROM leads')).rows[0].c;
  const thisMonth = (await pool.query(`SELECT COUNT(*)::int AS c FROM leads WHERE date_trunc('month', created_at) = date_trunc('month', now())`)).rows[0].c;
  const won = (await pool.query(`SELECT COUNT(*)::int AS c FROM leads WHERE status='WON'`)).rows[0].c;
  const lost = (await pool.query(`SELECT COUNT(*)::int AS c FROM leads WHERE status='LOST'`)).rows[0].c;
  res.json({
    ok: true,
    summary: {
      total: Number(total),
      this_month: Number(thisMonth),
      won: Number(won),
      lost: Number(lost),
      conversion_rate: won + lost > 0 ? +((won / (won + lost)) * 100).toFixed(1) : 0,
      by_status: Object.fromEntries(byStatus.rows.map(r => [r.status, Number(r.c)])),
      by_source: Object.fromEntries(bySource.rows.map(r => [r.source, Number(r.c)])),
    }
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const lead = (await pool.query('SELECT * FROM leads WHERE id=$1', [req.params.id])).rows[0];
  if (!lead) return res.status(404).json({ message: 'Lead not found' });
  const activities = (await pool.query('SELECT * FROM lead_activities WHERE lead_id=$1 ORDER BY created_at DESC', [req.params.id])).rows;
  res.json({ ok: true, lead, activities });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const lead_no = await nextLeadNo();
  const r = await pool.query(`INSERT INTO leads(lead_no, full_name, phone, email, address, latitude, longitude, area_id, zone_id, interested_package, source, status, priority, assigned_to, notes, metadata, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [lead_no, str(b.full_name), nullableStr(b.phone), nullableStr(b.email), nullableStr(b.address),
     b.latitude ? Number(b.latitude) : null, b.longitude ? Number(b.longitude) : null,
     nullableStr(b.area_id), nullableStr(b.zone_id), nullableStr(b.interested_package),
     enumVal(b.source, LEAD_SOURCES, 'source', 'OTHER'),
     enumVal(b.status, LEAD_STATUSES, 'status', 'NEW'),
     enumVal(b.priority, ['LOW','MEDIUM','HIGH'], 'priority', 'MEDIUM'),
     nullableStr(b.assigned_to), nullableStr(b.notes), JSON.stringify(b.metadata || {}), b.created_by || reqActor(req).actor_name]);
  await auditLog({ ...reqActor(req), action: 'LEAD_CREATE', entity_type: 'lead', entity_id: r.rows[0].id, details: { lead_no, full_name: r.rows[0].full_name } });
  res.status(201).json({ ok: true, lead: r.rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const existing = (await pool.query('SELECT * FROM leads WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Lead not found' });

  const status = b.status ? enumVal(b.status, LEAD_STATUSES, 'status', existing.status) : existing.status;
  const source = b.source ? enumVal(b.source, LEAD_SOURCES, 'source', existing.source) : existing.source;
  const priority = b.priority ? enumVal(b.priority, ['LOW','MEDIUM','HIGH'], 'priority', existing.priority) : existing.priority;

  const r = await pool.query(`UPDATE leads SET
    full_name=$1, phone=$2, email=$3, address=$4, latitude=$5, longitude=$6,
    area_id=$7, zone_id=$8, interested_package=$9, source=$10, status=$11, priority=$12,
    assigned_to=$13, notes=$14, metadata=$15, updated_at=now()
    WHERE id=$16 RETURNING *`,
    [str(b.full_name) || existing.full_name, nullableStr(b.phone), nullableStr(b.email), nullableStr(b.address),
     b.latitude ? Number(b.latitude) : existing.latitude, b.longitude ? Number(b.longitude) : existing.longitude,
     nullableStr(b.area_id) || existing.area_id, nullableStr(b.zone_id) || existing.zone_id,
     nullableStr(b.interested_package) || existing.interested_package, source, status, priority,
     nullableStr(b.assigned_to) || existing.assigned_to, nullableStr(b.notes) || existing.notes,
     JSON.stringify(b.metadata || existing.metadata || {}), req.params.id]);
  await auditLog({ ...reqActor(req), action: 'LEAD_UPDATE', entity_type: 'lead', entity_id: r.rows[0].id, details: { changes: { status: { from: existing.status, to: status } } } });
  res.json({ ok: true, lead: r.rows[0] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = (await pool.query('SELECT * FROM leads WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Lead not found' });
  await pool.query('DELETE FROM leads WHERE id=$1', [req.params.id]);
  await auditLog({ ...reqActor(req), action: 'LEAD_DELETE', entity_type: 'lead', entity_id: req.params.id, details: { lead_no: existing.lead_no } });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Lead Activities                                                    */
/* ------------------------------------------------------------------ */

router.post('/:id/activities', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const lead = (await pool.query('SELECT * FROM leads WHERE id=$1', [req.params.id])).rows[0];
  if (!lead) return res.status(404).json({ message: 'Lead not found' });

  const r = await pool.query(`INSERT INTO lead_activities(lead_id, activity_type, subject, description, outcome, scheduled_at, completed_at, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.id, enumVal(b.activity_type, ACTIVITY_TYPES, 'activity_type', 'NOTE'),
     nullableStr(b.subject), nullableStr(b.description), nullableStr(b.outcome),
     b.scheduled_at ? new Date(b.scheduled_at) : null, b.completed_at ? new Date(b.completed_at) : null, b.created_by || reqActor(req).actor_name]);
  res.status(201).json({ ok: true, activity: r.rows[0] });
}));

router.put('/activities/:activityId', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const r = await pool.query(`UPDATE lead_activities SET activity_type=$1, subject=$2, description=$3, outcome=$4, scheduled_at=$5, completed_at=$6 WHERE id=$7 RETURNING *`,
    [enumVal(b.activity_type, ACTIVITY_TYPES, 'activity_type', 'NOTE'), nullableStr(b.subject), nullableStr(b.description), nullableStr(b.outcome),
     b.scheduled_at ? new Date(b.scheduled_at) : null, b.completed_at ? new Date(b.completed_at) : null, req.params.activityId]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Activity not found' });
  res.json({ ok: true, activity: r.rows[0] });
}));

router.delete('/activities/:activityId', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM lead_activities WHERE id=$1', [req.params.activityId]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Convert Lead to Subscriber                                         */
/* ------------------------------------------------------------------ */

router.post('/:id/convert', asyncHandler(async (req, res) => {
  const lead = (await pool.query('SELECT * FROM leads WHERE id=$1', [req.params.id])).rows[0];
  if (!lead) return res.status(404).json({ message: 'Lead not found' });
  if (lead.converted_subscriber_id) return res.status(400).json({ message: 'Lead already converted' });

  const b = req.body || {};
  const clientCode = b.client_code || `IZN-${Date.now().toString().slice(-6)}`;

  // Create subscriber from lead
  const sub = await pool.query(`INSERT INTO subscribers(
    client_code, full_name, subscriber_type, connection_type, phone, email, address,
    latitude, longitude, location, area_id, zone_id, package_name, status, notes,
    billing_cycle_day, auto_suspend_enabled, auto_pay_enabled, provisioning_mode, reseller_id
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,
    CASE WHEN $8::float IS NOT NULL AND $9::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($9,$8),4326)::geography ELSE NULL END,
    $10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [clientCode, lead.full_name, 'HOME', 'PPPOE', lead.phone, lead.email, lead.address,
     lead.latitude, lead.longitude, lead.area_id, lead.zone_id,
     lead.interested_package || 'Home 20 Mbps', 'PENDING', `Converted from lead ${lead.lead_no}`,
     1, true, false, 'RADIUS', null]);

  await pool.query('UPDATE leads SET status=$1, converted_subscriber_id=$2, updated_at=now() WHERE id=$3', ['WON', sub.rows[0].id, req.params.id]);
  await auditLog({ ...reqActor(req), action: 'LEAD_CONVERT', entity_type: 'lead', entity_id: lead.id, details: { subscriber_id: sub.rows[0].id, subscriber_code: sub.rows[0].client_code } });

  res.json({ ok: true, lead: { ...lead, status: 'WON', converted_subscriber_id: sub.rows[0].id }, subscriber: sub.rows[0] });
}));

export default router;