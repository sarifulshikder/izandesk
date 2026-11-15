import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, getPagination, ValidationError } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';

const router: Router = Router();

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function str(v: any): string { return v === undefined || v === null ? '' : String(v).trim(); }
function nullableStr(v: any): string | null { const s = str(v); return s === '' ? null : s; }
function enumVal(v: any, allowed: string[], field: string, fallback: string): string { const s = str(v).toUpperCase() || fallback; if (!allowed.includes(s)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`); return s; }

const DIRECTIONS = ['INBOUND', 'OUTBOUND'];
const CHANNELS = ['CALL', 'EMAIL', 'SMS', 'WHATSAPP', 'TELEGRAM', 'IN_PERSON', 'PORTAL', 'NOTE'];
const STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'COMPLETED'];

/* ------------------------------------------------------------------ */
/* Subscriber Communications CRUD                                     */
/* ------------------------------------------------------------------ */

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const q = str(req.query.q).toLowerCase();
  const subscriber = str(req.query.subscriber_id);
  const channel = str(req.query.channel);
  const direction = str(req.query.direction);
  const from = str(req.query.from);
  const to = str(req.query.to);
  const where: string[] = [];
  const params: any[] = [];
  if (q) { params.push(`%${q}%`); where.push(`(lower(COALESCE(subject,'')) LIKE $${params.length} OR lower(COALESCE(body,'')) LIKE $${params.length} OR lower(COALESCE(contact_person,'')) LIKE $${params.length})`); }
  if (subscriber) { params.push(subscriber); where.push(`subscriber_id = $${params.length}`); }
  if (channel) { params.push(channel); where.push(`channel = $${params.length}`); }
  if (direction) { params.push(direction); where.push(`direction = $${params.length}`); }
  if (from) { params.push(from); where.push(`created_at >= $${params.length}`); }
  if (to) { params.push(to); where.push(`created_at <= $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM subscriber_communications ${whereSql}`, params);
  params.push(limit, offset);
  const rowsRes = await pool.query(`SELECT sc.*, s.full_name as subscriber_name, s.client_code FROM subscriber_communications sc LEFT JOIN subscribers s ON s.id=sc.subscriber_id ${whereSql} ORDER BY sc.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ data: rowsRes.rows, total: totalRes.rows[0].total, page, limit });
}));

router.get('/subscriber/:subscriberId', asyncHandler(async (req, res) => {
  const { limit = '50', offset = '0' } = req.query;
  const rows = (await pool.query('SELECT * FROM subscriber_communications WHERE subscriber_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [req.params.subscriberId, limit, offset])).rows;
  res.json({ ok: true, data: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const comm = (await pool.query('SELECT * FROM subscriber_communications WHERE id=$1', [req.params.id])).rows[0];
  if (!comm) return res.status(404).json({ message: 'Communication not found' });
  res.json({ ok: true, communication: comm });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.subscriber_id) throw new ValidationError('subscriber_id is required');
  if (!b.channel) throw new ValidationError('channel is required');
  if (!b.direction) throw new ValidationError('direction is required');

  const r = await pool.query(`INSERT INTO subscriber_communications(subscriber_id, direction, channel, subject, body, contact_person, contact_phone, contact_email, related_type, related_id, status, provider_message_id, metadata, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [b.subscriber_id, enumVal(b.direction, DIRECTIONS, 'direction', 'OUTBOUND'), enumVal(b.channel, CHANNELS, 'channel', 'NOTE'),
     nullableStr(b.subject), nullableStr(b.body), nullableStr(b.contact_person), nullableStr(b.contact_phone), nullableStr(b.contact_email),
     nullableStr(b.related_type), nullableStr(b.related_id), enumVal(b.status, STATUSES, 'status', 'COMPLETED'), nullableStr(b.provider_message_id),
     JSON.stringify(b.metadata || {}), b.created_by || reqActor(req).actor_name]);

  await auditLog({ ...reqActor(req), action: 'COMM_CREATE', entity_type: 'subscriber_communication', entity_id: r.rows[0].id, details: { subscriber_id: b.subscriber_id, channel: b.channel, direction: b.direction } });
  res.status(201).json({ ok: true, communication: r.rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const existing = (await pool.query('SELECT * FROM subscriber_communications WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Communication not found' });

  const status = b.status ? enumVal(b.status, STATUSES, 'status', existing.status) : existing.status;

  const r = await pool.query(`UPDATE subscriber_communications SET
    subject=$1, body=$2, contact_person=$3, contact_phone=$4, contact_email=$5,
    related_type=$6, related_id=$7, status=$8, provider_message_id=$9, metadata=$10, updated_at=now()
    WHERE id=$11 RETURNING *`,
    [nullableStr(b.subject) || existing.subject, nullableStr(b.body) || existing.body,
     nullableStr(b.contact_person) || existing.contact_person, nullableStr(b.contact_phone) || existing.contact_phone,
     nullableStr(b.contact_email) || existing.contact_email, nullableStr(b.related_type) || existing.related_type,
     nullableStr(b.related_id) || existing.related_id, status, nullableStr(b.provider_message_id) || existing.provider_message_id,
     JSON.stringify(b.metadata || existing.metadata || {}), req.params.id]);
  res.json({ ok: true, communication: r.rows[0] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = (await pool.query('SELECT * FROM subscriber_communications WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Communication not found' });
  await pool.query('DELETE FROM subscriber_communications WHERE id=$1', [req.params.id]);
  await auditLog({ ...reqActor(req), action: 'COMM_DELETE', entity_type: 'subscriber_communication', entity_id: req.params.id, details: {} });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Quick Log Helpers                                                  */
/* ------------------------------------------------------------------ */

// Log a call
router.post('/log-call', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.subscriber_id) throw new ValidationError('subscriber_id required');
  const r = await pool.query(`INSERT INTO subscriber_communications(subscriber_id, direction, channel, subject, body, contact_person, contact_phone, status, created_by)
    VALUES($1,'OUTBOUND','CALL',$2,$3,$4,$5,'COMPLETED',$6) RETURNING *`,
    [b.subscriber_id, nullableStr(b.subject), nullableStr(b.body), nullableStr(b.contact_person), nullableStr(b.contact_phone), b.created_by || reqActor(req).actor_name]);
  res.status(201).json({ ok: true, communication: r.rows[0] });
}));

// Log WhatsApp
router.post('/log-whatsapp', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.subscriber_id) throw new ValidationError('subscriber_id required');
  const r = await pool.query(`INSERT INTO subscriber_communications(subscriber_id, direction, channel, subject, body, contact_person, contact_phone, status, created_by)
    VALUES($1,'OUTBOUND','WHATSAPP',$2,$3,$4,$5,'COMPLETED',$6) RETURNING *`,
    [b.subscriber_id, nullableStr(b.subject), nullableStr(b.body), nullableStr(b.contact_person), nullableStr(b.contact_phone), b.created_by || reqActor(req).actor_name]);
  res.status(201).json({ ok: true, communication: r.rows[0] });
}));

// Log Email
router.post('/log-email', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.subscriber_id) throw new ValidationError('subscriber_id required');
  const r = await pool.query(`INSERT INTO subscriber_communications(subscriber_id, direction, channel, subject, body, contact_person, contact_email, status, created_by)
    VALUES($1,'OUTBOUND','EMAIL',$2,$3,$4,$5,'COMPLETED',$6) RETURNING *`,
    [b.subscriber_id, nullableStr(b.subject), nullableStr(b.body), nullableStr(b.contact_person), nullableStr(b.contact_email), b.created_by || reqActor(req).actor_name]);
  res.status(201).json({ ok: true, communication: r.rows[0] });
}));

// Log SMS
router.post('/log-sms', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.subscriber_id) throw new ValidationError('subscriber_id required');
  const r = await pool.query(`INSERT INTO subscriber_communications(subscriber_id, direction, channel, subject, body, contact_person, contact_phone, status, created_by)
    VALUES($1,'OUTBOUND','SMS',$2,$3,$4,$5,'COMPLETED',$6) RETURNING *`,
    [b.subscriber_id, nullableStr(b.subject), nullableStr(b.body), nullableStr(b.contact_person), nullableStr(b.contact_phone), b.created_by || reqActor(req).actor_name]);
  res.status(201).json({ ok: true, communication: r.rows[0] });
}));

// Log Note
router.post('/log-note', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.subscriber_id) throw new ValidationError('subscriber_id required');
  const r = await pool.query(`INSERT INTO subscriber_communications(subscriber_id, direction, channel, subject, body, status, created_by)
    VALUES($1,'INBOUND','NOTE',$2,$3,'COMPLETED',$4) RETURNING *`,
    [b.subscriber_id, nullableStr(b.subject), nullableStr(b.body), b.created_by || reqActor(req).actor_name]);
  res.status(201).json({ ok: true, communication: r.rows[0] });
}));

export default router;