import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, getPagination, ValidationError } from './helpers';
import { auditLog, reqActor } from '../integrations/audit';
import { resellerScope, assertSubscriberOwnership } from './subscriber-scope';

const router: Router = Router();

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function str(v: any): string { return v === undefined || v === null ? '' : String(v).trim(); }
function nullableStr(v: any): string | null { const s = str(v); return s === '' ? null : s; }
function enumVal(v: any, allowed: string[], field: string, fallback: string): string { const s = str(v).toUpperCase() || fallback; if (!allowed.includes(s)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`); return s; }

const EQUIP_TYPES = ['ONU', 'ROUTER', 'SWITCH', 'AP', 'CPE', 'MODEM', 'SPLITTER', 'OTHER'];
const EQUIP_STATUSES = ['ASSIGNED', 'INSTALLED', 'FAULTY', 'RMA', 'RETURNED', 'RETIRED'];

/* ------------------------------------------------------------------ */
/* Subscriber Equipment CRUD                                          */
/* ------------------------------------------------------------------ */

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const q = str(req.query.q).toLowerCase();
  const subscriber = str(req.query.subscriber_id);
  const type = str(req.query.type);
  const status = str(req.query.status);
  const where: string[] = [];
  const params: any[] = [];
  if (q) { params.push(`%${q}%`); where.push(`(lower(serial_number) LIKE $${params.length} OR lower(COALESCE(mac_address,'')) LIKE $${params.length} OR lower(COALESCE(firmware_version,'')) LIKE $${params.length})`); }
  if (subscriber) { params.push(subscriber); where.push(`subscriber_id = $${params.length}`); }
  if (type) { params.push(type); where.push(`equipment_type = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  const scope = await resellerScope(req);
  if (scope.restricted && !scope.uuid) return res.status(403).json({ message: 'No reseller account linked to this login' });
  if (scope.restricted) {
    params.push(scope.uuid);
    where.push(`subscriber_id IN (SELECT id FROM subscribers WHERE reseller_id=$${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM subscriber_equipment ${whereSql}`, params);
  params.push(limit, offset);
  const rowsRes = await pool.query(`SELECT se.*, s.full_name as subscriber_name, s.client_code, s.username FROM subscriber_equipment se LEFT JOIN subscribers s ON s.id=se.subscriber_id ${whereSql} ORDER BY se.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ data: rowsRes.rows, total: totalRes.rows[0].total, page, limit });
}));

router.get('/subscriber/:subscriberId', asyncHandler(async (req, res) => {
  if (!(await assertSubscriberOwnership(req, res, req.params.subscriberId))) return;
  const rows = (await pool.query('SELECT * FROM subscriber_equipment WHERE subscriber_id=$1 ORDER BY created_at DESC', [req.params.subscriberId])).rows;
  res.json({ ok: true, data: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const equip = (await pool.query('SELECT * FROM subscriber_equipment WHERE id=$1', [req.params.id])).rows[0];
  if (!equip) return res.status(404).json({ message: 'Equipment not found' });
  if (!(await assertSubscriberOwnership(req, res, equip.subscriber_id))) return;
  res.json({ ok: true, equipment: equip });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.subscriber_id) throw new ValidationError('subscriber_id is required');
  if (!b.serial_number) throw new ValidationError('serial_number is required');
  if (!b.equipment_type) throw new ValidationError('equipment_type is required');
  if (!(await assertSubscriberOwnership(req, res, b.subscriber_id))) return;

  // Check if serial already assigned
  const existing = await pool.query('SELECT id FROM subscriber_equipment WHERE serial_number=$1 AND status NOT IN ($2,$3)', [b.serial_number, 'RETURNED', 'RETIRED']);
  if (existing.rows[0]) throw new ValidationError(`Serial ${b.serial_number} already assigned`);

  const r = await pool.query(`INSERT INTO subscriber_equipment(subscriber_id, equipment_type, serial_number, mac_address, inventory_serial_id, onu_id, status, location_details, firmware_version, config_backup, notes, assigned_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [b.subscriber_id, enumVal(b.equipment_type, EQUIP_TYPES, 'equipment_type', 'CPE'), str(b.serial_number), nullableStr(b.mac_address), nullableStr(b.inventory_serial_id), nullableStr(b.onu_id),
     enumVal(b.status, EQUIP_STATUSES, 'status', 'ASSIGNED'), nullableStr(b.location_details), nullableStr(b.firmware_version), JSON.stringify(b.config_backup || {}), nullableStr(b.notes), b.assigned_by || reqActor(req).actor_name]);

  // If inventory_serial_id provided, update its status
  if (b.inventory_serial_id) {
    await pool.query('UPDATE inventory_serials SET status=$2, assigned_subscriber_id=$3, updated_at=now() WHERE id=$1', [b.inventory_serial_id, 'ASSIGNED', b.subscriber_id]);
  }

  await auditLog({ ...reqActor(req), action: 'EQUIPMENT_ASSIGN', entity_type: 'subscriber_equipment', entity_id: r.rows[0].id, details: { subscriber_id: b.subscriber_id, serial: b.serial_number, type: b.equipment_type } });
  res.status(201).json({ ok: true, equipment: r.rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const existing = (await pool.query('SELECT * FROM subscriber_equipment WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Equipment not found' });
  if (!(await assertSubscriberOwnership(req, res, existing.subscriber_id))) return;

  const type = b.equipment_type ? enumVal(b.equipment_type, EQUIP_TYPES, 'equipment_type', existing.equipment_type) : existing.equipment_type;
  const status = b.status ? enumVal(b.status, EQUIP_STATUSES, 'status', existing.status) : existing.status;

  const r = await pool.query(`UPDATE subscriber_equipment SET
    equipment_type=$1, serial_number=$2, mac_address=$3, inventory_serial_id=$4, onu_id=$5,
    status=$6, location_details=$7, firmware_version=$8, config_backup=$9, notes=$10,
    installed_at=$11, installed_by=$12, updated_at=now()
    WHERE id=$13 RETURNING *`,
    [type, nullableStr(b.serial_number) || existing.serial_number, nullableStr(b.mac_address) || existing.mac_address,
     nullableStr(b.inventory_serial_id) || existing.inventory_serial_id, nullableStr(b.onu_id) || existing.onu_id,
     status, nullableStr(b.location_details) || existing.location_details, nullableStr(b.firmware_version) || existing.firmware_version,
     JSON.stringify(b.config_backup || existing.config_backup || {}), nullableStr(b.notes) || existing.notes,
     status === 'INSTALLED' && !existing.installed_at ? new Date() : (b.installed_at ? new Date(b.installed_at) : existing.installed_at),
     status === 'INSTALLED' && !existing.installed_by ? reqActor(req).actor_name : (b.installed_by || existing.installed_by),
     req.params.id]);

  // Sync inventory serial status
  if (b.inventory_serial_id && b.inventory_serial_id !== existing.inventory_serial_id) {
    if (existing.inventory_serial_id) await pool.query('UPDATE inventory_serials SET status=$2, assigned_subscriber_id=NULL, updated_at=now() WHERE id=$1', [existing.inventory_serial_id, 'IN_STOCK']);
    await pool.query('UPDATE inventory_serials SET status=$2, assigned_subscriber_id=$3, updated_at=now() WHERE id=$1', [b.inventory_serial_id, status === 'ASSIGNED' || status === 'INSTALLED' ? 'ASSIGNED' : 'IN_STOCK', existing.subscriber_id]);
  } else if (status === 'RETURNED' || status === 'RETIRED') {
    if (existing.inventory_serial_id) await pool.query('UPDATE inventory_serials SET status=$2, assigned_subscriber_id=NULL, updated_at=now() WHERE id=$1', [existing.inventory_serial_id, 'IN_STOCK']);
  }

  await auditLog({ ...reqActor(req), action: 'EQUIPMENT_UPDATE', entity_type: 'subscriber_equipment', entity_id: r.rows[0].id, details: { status_change: { from: existing.status, to: status } } });
  res.json({ ok: true, equipment: r.rows[0] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = (await pool.query('SELECT * FROM subscriber_equipment WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Equipment not found' });
  if (!(await assertSubscriberOwnership(req, res, existing.subscriber_id))) return;
  if (existing.inventory_serial_id) await pool.query('UPDATE inventory_serials SET status=$2, assigned_subscriber_id=NULL, updated_at=now() WHERE id=$1', [existing.inventory_serial_id, 'IN_STOCK']);
  await pool.query('DELETE FROM subscriber_equipment WHERE id=$1', [req.params.id]);
  await auditLog({ ...reqActor(req), action: 'EQUIPMENT_DELETE', entity_type: 'subscriber_equipment', entity_id: req.params.id, details: { serial: existing.serial_number, subscriber_id: existing.subscriber_id } });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Quick Actions                                                      */
/* ------------------------------------------------------------------ */

router.post('/:id/mark-installed', asyncHandler(async (req, res) => {
  const target = (await pool.query('SELECT subscriber_id FROM subscriber_equipment WHERE id=$1', [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ message: 'Equipment not found' });
  if (!(await assertSubscriberOwnership(req, res, target.subscriber_id))) return;
  const r = await pool.query(`UPDATE subscriber_equipment SET status='INSTALLED', installed_at=now(), installed_by=$2, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id, reqActor(req).actor_name]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Equipment not found' });
  await auditLog({ ...reqActor(req), action: 'EQUIPMENT_INSTALLED', entity_type: 'subscriber_equipment', entity_id: r.rows[0].id, details: {} });
  res.json({ ok: true, equipment: r.rows[0] });
}));

router.post('/:id/mark-faulty', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const target = (await pool.query('SELECT subscriber_id FROM subscriber_equipment WHERE id=$1', [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ message: 'Equipment not found' });
  if (!(await assertSubscriberOwnership(req, res, target.subscriber_id))) return;
  const r = await pool.query(`UPDATE subscriber_equipment SET status='FAULTY', notes=COALESCE(notes,'') || $2, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id, `\n[FAULTY ${new Date().toISOString()}]: ${b.reason || 'Marked faulty'}`]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Equipment not found' });
  await auditLog({ ...reqActor(req), action: 'EQUIPMENT_FAULTY', entity_type: 'subscriber_equipment', entity_id: r.rows[0].id, details: { reason: b.reason } });
  res.json({ ok: true, equipment: r.rows[0] });
}));

router.post('/:id/initiate-rma', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const target = (await pool.query('SELECT subscriber_id FROM subscriber_equipment WHERE id=$1', [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ message: 'Equipment not found' });
  if (!(await assertSubscriberOwnership(req, res, target.subscriber_id))) return;
  const r = await pool.query(`UPDATE subscriber_equipment SET status='RMA', notes=COALESCE(notes,'') || $2, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id, `\n[RMA ${new Date().toISOString()}]: ${b.reason || 'RMA initiated'}`]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Equipment not found' });
  if (r.rows[0].inventory_serial_id) await pool.query('UPDATE inventory_serials SET status=$2, updated_at=now() WHERE id=$1', [r.rows[0].inventory_serial_id, 'RMA']);
  await auditLog({ ...reqActor(req), action: 'EQUIPMENT_RMA', entity_type: 'subscriber_equipment', entity_id: r.rows[0].id, details: { reason: b.reason } });
  res.json({ ok: true, equipment: r.rows[0] });
}));

router.post('/:id/return', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const existing = (await pool.query('SELECT * FROM subscriber_equipment WHERE id=$1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ message: 'Equipment not found' });
  if (!(await assertSubscriberOwnership(req, res, existing.subscriber_id))) return;
  const r = await pool.query(`UPDATE subscriber_equipment SET status='RETURNED', notes=COALESCE(notes,'') || $2, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id, `\n[RETURNED ${new Date().toISOString()}]: ${b.reason || 'Equipment returned'}`]);
  if (existing.inventory_serial_id) await pool.query('UPDATE inventory_serials SET status=$2, assigned_subscriber_id=NULL, updated_at=now() WHERE id=$1', [existing.inventory_serial_id, 'IN_STOCK']);
  await auditLog({ ...reqActor(req), action: 'EQUIPMENT_RETURN', entity_type: 'subscriber_equipment', entity_id: r.rows[0].id, details: { reason: b.reason } });
  res.json({ ok: true, equipment: r.rows[0] });
}));

export default router;