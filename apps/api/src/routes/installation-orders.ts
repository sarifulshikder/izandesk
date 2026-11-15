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

const ORDER_TYPES = ['INSTALLATION', 'REPAIR', 'RELOCATION', 'UPGRADE', 'DISCONNECTION', 'EQUIPMENT_SWAP'];
const ORDER_STATUSES = ['PENDING', 'SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

async function nextOrderNo() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const r = await pool.query(`SELECT COUNT(*)::int as c FROM installation_orders WHERE order_no LIKE $1`, [`IO-${ym}-%`]);
  const n = (r.rows[0]?.c || 0) + 1;
  return `IO-${ym}-${String(n).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Installation Order CRUD                                            */
/* ------------------------------------------------------------------ */

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const q = str(req.query.q).toLowerCase();
  const status = str(req.query.status);
  const type = str(req.query.type);
  const technician = str(req.query.technician_id);
  const subscriber = str(req.query.subscriber_id);
  const from = str(req.query.from);
  const to = str(req.query.to);
  const where: string[] = [];
  const params: any[] = [];
  if (q) { params.push(`%${q}%`); where.push(`(lower(order_no) LIKE $${params.length} OR lower(site_address) LIKE $${params.length} OR lower(site_contact_name) LIKE $${params.length})`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (type) { params.push(type); where.push(`order_type = $${params.length}`); }
  if (technician) { params.push(technician); where.push(`assigned_technician_id = $${params.length}`); }
  if (subscriber) { params.push(subscriber); where.push(`subscriber_id = $${params.length}`); }
  if (from) { params.push(from); where.push(`scheduled_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`scheduled_date <= $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM installation_orders ${whereSql}`, params);
  params.push(limit, offset);
  const rowsRes = await pool.query(`SELECT io.*, h.full_name as technician_name_full FROM installation_orders io LEFT JOIN hr_employees h ON h.id=io.assigned_technician_id ${whereSql} ORDER BY io.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ data: rowsRes.rows, total: totalRes.rows[0].total, page, limit });
}));

router.get('/summary', asyncHandler(async (_req, res) => {
  const byStatus = await pool.query(`SELECT status, COUNT(*)::int AS c FROM installation_orders GROUP BY status`);
  const byType = await pool.query(`SELECT order_type, COUNT(*)::int AS c FROM installation_orders GROUP BY order_type`);
  const pending = (await pool.query(`SELECT COUNT(*)::int AS c FROM installation_orders WHERE status IN ('PENDING','SCHEDULED','ASSIGNED')`)).rows[0].c;
  const inProgress = (await pool.query(`SELECT COUNT(*)::int AS c FROM installation_orders WHERE status='IN_PROGRESS'`)).rows[0].c;
  const completed = (await pool.query(`SELECT COUNT(*)::int AS c FROM installation_orders WHERE status='COMPLETED'`)).rows[0].c;
  const overdue = (await pool.query(`SELECT COUNT(*)::int AS c FROM installation_orders WHERE status IN ('PENDING','SCHEDULED','ASSIGNED','IN_PROGRESS') AND sla_due_at < now()`)).rows[0].c;
  res.json({ ok: true, summary: { pending: Number(pending), in_progress: Number(inProgress), completed: Number(completed), overdue: Number(overdue), by_status: Object.fromEntries(byStatus.rows.map(r=>[r.status,Number(r.c)])), by_type: Object.fromEntries(byType.rows.map(r=>[r.order_type,Number(r.c)])) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const order = (await pool.query(`SELECT io.*, h.full_name as technician_name_full FROM installation_orders io LEFT JOIN hr_employees h ON h.id=io.assigned_technician_id WHERE io.id=$1`, [req.params.id])).rows[0];
  if (!order) return res.status(404).json({ message: 'Order not found' });
  const checklist = (await pool.query('SELECT * FROM installation_checklist_items WHERE order_id=$1 ORDER BY sort_order', [req.params.id])).rows;
  res.json({ ok: true, order, checklist });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.subscriber_id && !b.lead_id) throw new ValidationError('subscriber_id or lead_id is required');
  const order_no = await nextOrderNo();
  const r = await pool.query(`INSERT INTO installation_orders(order_no, subscriber_id, lead_id, order_type, status, priority,
    scheduled_date, scheduled_time_start, scheduled_time_end, assigned_technician_id, assigned_technician_name,
    site_address, site_latitude, site_longitude, site_contact_name, site_contact_phone,
    required_equipment, checklist, sla_due_at, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [order_no, nullableStr(b.subscriber_id), nullableStr(b.lead_id),
     enumVal(b.order_type, ORDER_TYPES, 'order_type', 'INSTALLATION'),
     enumVal(b.status, ORDER_STATUSES, 'status', 'PENDING'),
     enumVal(b.priority, PRIORITIES, 'priority', 'NORMAL'),
     b.scheduled_date ? new Date(b.scheduled_date) : null, nullableStr(b.scheduled_time_start), nullableStr(b.scheduled_time_end),
     nullableStr(b.assigned_technician_id), nullableStr(b.assigned_technician_name),
     nullableStr(b.site_address), b.site_latitude ? Number(b.site_latitude) : null, b.site_longitude ? Number(b.site_longitude) : null,
     nullableStr(b.site_contact_name), nullableStr(b.site_contact_phone),
     JSON.stringify(b.required_equipment || []), JSON.stringify(b.checklist || []),
     b.sla_due_at ? new Date(b.sla_due_at) : null, b.created_by || reqActor(req).actor_name]);
  await auditLog({ ...reqActor(req), action: 'ORDER_CREATE', entity_type: 'installation_order', entity_id: r.rows[0].id, details: { order_no, type: r.rows[0].order_type } });
  res.status(201).json({ ok: true, order: r.rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const existing = (await pool.query('SELECT * FROM installation_orders WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Order not found' });

  const status = b.status ? enumVal(b.status, ORDER_STATUSES, 'status', existing.status) : existing.status;
  const type = b.order_type ? enumVal(b.order_type, ORDER_TYPES, 'order_type', existing.order_type) : existing.order_type;
  const priority = b.priority ? enumVal(b.priority, PRIORITIES, 'priority', existing.priority) : existing.priority;

  const r = await pool.query(`UPDATE installation_orders SET
    order_type=$1, status=$2, priority=$3,
    scheduled_date=$4, scheduled_time_start=$5, scheduled_time_end=$6,
    assigned_technician_id=$7, assigned_technician_name=$8,
    site_address=$9, site_latitude=$10, site_longitude=$11,
    site_contact_name=$12, site_contact_phone=$13,
    required_equipment=$14, checklist=$15, sla_due_at=$16,
    completion_notes=$17, completion_photos=$18,
    actual_start_at=$19, actual_end_at=$20,
    updated_at=now()
    WHERE id=$21 RETURNING *`,
    [type, status, priority,
     b.scheduled_date ? new Date(b.scheduled_date) : existing.scheduled_date,
     nullableStr(b.scheduled_time_start) || existing.scheduled_time_start,
     nullableStr(b.scheduled_time_end) || existing.scheduled_time_end,
     nullableStr(b.assigned_technician_id) || existing.assigned_technician_id,
     nullableStr(b.assigned_technician_name) || existing.assigned_technician_name,
     nullableStr(b.site_address) || existing.site_address,
     b.site_latitude ? Number(b.site_latitude) : existing.site_latitude,
     b.site_longitude ? Number(b.site_longitude) : existing.site_longitude,
     nullableStr(b.site_contact_name) || existing.site_contact_name,
     nullableStr(b.site_contact_phone) || existing.site_contact_phone,
     JSON.stringify(b.required_equipment || existing.required_equipment || []),
     JSON.stringify(b.checklist || existing.checklist || []),
     b.sla_due_at ? new Date(b.sla_due_at) : existing.sla_due_at,
     nullableStr(b.completion_notes) || existing.completion_notes,
     JSON.stringify(b.completion_photos || existing.completion_photos || []),
     b.actual_start_at ? new Date(b.actual_start_at) : existing.actual_start_at,
     b.actual_end_at ? new Date(b.actual_end_at) : existing.actual_end_at,
     req.params.id]);
  await auditLog({ ...reqActor(req), action: 'ORDER_UPDATE', entity_type: 'installation_order', entity_id: r.rows[0].id, details: { status_change: { from: existing.status, to: status } } });
  res.json({ ok: true, order: r.rows[0] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = (await pool.query('SELECT * FROM installation_orders WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Order not found' });
  await pool.query('DELETE FROM installation_orders WHERE id=$1', [req.params.id]);
  await auditLog({ ...reqActor(req), action: 'ORDER_DELETE', entity_type: 'installation_order', entity_id: req.params.id, details: { order_no: existing.order_no } });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Checklist Items                                                    */
/* ------------------------------------------------------------------ */

router.post('/:id/checklist', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const order = (await pool.query('SELECT id FROM installation_orders WHERE id=$1', [req.params.id])).rows[0];
  if (!order) return res.status(404).json({ message: 'Order not found' });
  const maxSort = (await pool.query('SELECT COALESCE(MAX(sort_order),0) as m FROM installation_checklist_items WHERE order_id=$1', [req.params.id])).rows[0].m;
  const r = await pool.query(`INSERT INTO installation_checklist_items(order_id, item_text, is_required, sort_order) VALUES($1,$2,$3,$4) RETURNING *`,
    [req.params.id, str(b.item_text) || 'Checklist item', b.is_required !== false, Number(maxSort) + 1]);
  res.status(201).json({ ok: true, item: r.rows[0] });
}));

router.put('/checklist/:itemId', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const r = await pool.query(`UPDATE installation_checklist_items SET item_text=$1, is_required=$2, is_completed=$3, completed_at=$4, completed_by=$5, notes=$6, sort_order=$7 WHERE id=$8 RETURNING *`,
    [str(b.item_text), b.is_required !== false, b.is_completed === true, b.is_completed ? new Date() : null, b.completed_by || reqActor(req).actor_name, nullableStr(b.notes), b.sort_order ?? 0, req.params.itemId]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Checklist item not found' });
  res.json({ ok: true, item: r.rows[0] });
}));

router.delete('/checklist/:itemId', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM installation_checklist_items WHERE id=$1', [req.params.itemId]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Bulk Complete Checklist                                            */
/* ------------------------------------------------------------------ */

router.post('/:id/checklist/complete-all', asyncHandler(async (req, res) => {
  await pool.query(`UPDATE installation_checklist_items SET is_completed=true, completed_at=now(), completed_by=$2 WHERE order_id=$1 AND is_completed=false`, [req.params.id, reqActor(req).actor_name]);
  const items = (await pool.query('SELECT * FROM installation_checklist_items WHERE order_id=$1 ORDER BY sort_order', [req.params.id])).rows;
  res.json({ ok: true, items });
}));

export default router;