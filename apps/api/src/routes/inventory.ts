import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';

const router: Router = Router();

// Inventory carries serial numbers and asset locations — staff only.
const INVENTORY_READ_ROLES = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER', 'TECHNICIAN'];
const INVENTORY_WRITE_ROLES = ['SUPER_ADMIN', 'BILLING_OPERATOR', 'NOC_ENGINEER'];
router.use((req: any, res: any, next: any) => {
  const role = String(req.user?.role || '');
  if (!INVENTORY_READ_ROLES.includes(role)) return res.status(403).json({ message: 'Inventory access is restricted to staff accounts' });
  if (req.method !== 'GET' && req.method !== 'HEAD' && !INVENTORY_WRITE_ROLES.includes(role)) {
    return res.status(403).json({ message: 'Insufficient permissions to modify inventory' });
  }
  return next();
});

// Warehouses
router.get('/warehouses', asyncHandler(async (_req, res) => {
  const r = await pool.query(`
    SELECT w.*, 
      (SELECT COUNT(*)::int FROM inventory_serials s WHERE s.warehouse_id=w.id AND s.status='IN_STOCK') as in_stock_count
    FROM inventory_warehouses w ORDER BY w.name`);
  res.json({ data: r.rows });
}));
router.post('/warehouses', asyncHandler(async (req, res) => {
  const { name, location } = req.body || {};
  if (!name) return res.status(400).json({ message: 'name is required' });
  const r = await pool.query('INSERT INTO inventory_warehouses(name,location) VALUES($1,$2) RETURNING *', [name, location || null]);
  res.status(201).json(r.rows[0]);
}));
router.put('/warehouses/:id', asyncHandler(async (req, res) => {
  const { name, location } = req.body || {};
  const r = await pool.query('UPDATE inventory_warehouses SET name=COALESCE($1,name), location=COALESCE($2,location) WHERE id=$3 RETURNING *', [name || null, location || null, req.params.id]);
  res.json(r.rows[0]);
}));
router.delete('/warehouses/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM inventory_warehouses WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Items
router.get('/items', asyncHandler(async (_req, res) => {
  const r = await pool.query(`
    SELECT i.*,
      COUNT(s.id)::int as total_serials,
      COUNT(*) FILTER (WHERE s.status='IN_STOCK')::int as in_stock,
      COUNT(*) FILTER (WHERE s.status='ASSIGNED')::int as assigned,
      COUNT(*) FILTER (WHERE s.status='FAULTY')::int as faulty
    FROM inventory_items i
    LEFT JOIN inventory_serials s ON s.item_id=i.id
    GROUP BY i.id
    ORDER BY i.category, i.name`);
  res.json({ data: r.rows });
}));
router.post('/items', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.category) return res.status(400).json({ message: 'name and category are required' });
  const r = await pool.query('INSERT INTO inventory_items(name,category,brand,model,unit,reorder_level) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [b.name, b.category, b.brand || null, b.model || null, b.unit || 'pcs', b.reorder_level || 0]);
  res.status(201).json(r.rows[0]);
}));
router.put('/items/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const r = await pool.query(`UPDATE inventory_items SET name=COALESCE($1,name),category=COALESCE($2,category),brand=$3,model=$4,unit=COALESCE($5,unit),reorder_level=COALESCE($6,reorder_level) WHERE id=$7 RETURNING *`,
    [b.name || null, b.category || null, b.brand ?? null, b.model ?? null, b.unit || null, b.reorder_level ?? null, req.params.id]);
  res.json(r.rows[0]);
}));
router.delete('/items/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM inventory_items WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Serials
router.get('/serials', asyncHandler(async (req, res) => {
  const { item_id, warehouse_id, status, q, source } = req.query as any;
  const where: string[] = [];
  const params: any[] = [];
  if (item_id) { params.push(item_id); where.push(`s.item_id=$${params.length}`); }
  if (warehouse_id) { params.push(warehouse_id); where.push(`s.warehouse_id=$${params.length}`); }
  if (status) { params.push(status); where.push(`s.status=$${params.length}`); }
  if (source) { params.push(source); where.push(`s.source=$${params.length}`); }
  if (q) { params.push(`%${String(q).toLowerCase()}%`); where.push(`(lower(s.serial_number) LIKE $${params.length} OR lower(COALESCE(s.mac_address,'')) LIKE $${params.length})`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(`
    SELECT s.*, i.name as item_name, i.category as item_category, i.brand, i.model, w.name as warehouse_name,
           sub.full_name as subscriber_name, sub.client_code as subscriber_code,
           eq.id as equipment_id, eq.onu_id, o.pon_port as onu_pon_port, o.status as onu_status,
           ol.name as olt_name, ol.vendor as olt_vendor
    FROM inventory_serials s
    JOIN inventory_items i ON i.id=s.item_id
    LEFT JOIN inventory_warehouses w ON w.id=s.warehouse_id
    LEFT JOIN subscribers sub ON sub.id=s.assigned_subscriber_id
    LEFT JOIN subscriber_equipment eq ON eq.inventory_serial_id = s.id
    LEFT JOIN onus o ON o.id = eq.onu_id
    LEFT JOIN olts ol ON ol.id = o.olt_id
    ${whereSql}
    ORDER BY s.created_at DESC`, params);
  res.json({ data: r.rows });
}));

// ONU-imported serials summary (the trick overview)
router.get('/serials/onu-import/summary', asyncHandler(async (_req, res) => {
  const r = await pool.query(`
    SELECT
      COUNT(*)::int AS total_onu_serials,
      COUNT(*) FILTER (WHERE s.status='ASSIGNED')::int AS assigned,
      COUNT(*) FILTER (WHERE s.status='IN_STOCK')::int AS in_stock,
      COUNT(*) FILTER (WHERE s.status='FAULTY')::int AS faulty,
      COUNT(*) FILTER (WHERE s.status='RMA')::int AS rma,
      COUNT(DISTINCT s.item_id)::int AS onu_item_types,
      COUNT(DISTINCT s.assigned_subscriber_id)::int AS subscribers_with_onu
    FROM inventory_serials s WHERE s.source='ONU_IMPORT'`);
  const byVendor = await pool.query(`
    SELECT i.brand AS vendor, COUNT(*)::int AS count
    FROM inventory_serials s JOIN inventory_items i ON i.id=s.item_id
    WHERE s.source='ONU_IMPORT' GROUP BY i.brand ORDER BY count DESC`);
  res.json({ data: { ...r.rows[0], by_vendor: byVendor.rows } });
}));
router.post('/serials', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.item_id || !b.serial_number) return res.status(400).json({ message: 'item_id and serial_number are required' });
  const r = await pool.query(`INSERT INTO inventory_serials(item_id,warehouse_id,serial_number,mac_address,status,assigned_subscriber_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.item_id, b.warehouse_id || null, b.serial_number, b.mac_address || null, b.status || 'IN_STOCK', b.assigned_subscriber_id || null, b.notes || null]);
  res.status(201).json(r.rows[0]);
}));
router.put('/serials/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const r = await pool.query(`UPDATE inventory_serials SET warehouse_id=$1,serial_number=COALESCE($2,serial_number),mac_address=$3,status=COALESCE($4,status),assigned_subscriber_id=$5,notes=$6,updated_at=now() WHERE id=$7 RETURNING *`,
    [b.warehouse_id ?? null, b.serial_number || null, b.mac_address ?? null, b.status || null, b.assigned_subscriber_id ?? null, b.notes ?? null, req.params.id]);
  res.json(r.rows[0]);
}));
router.delete('/serials/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM inventory_serials WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
