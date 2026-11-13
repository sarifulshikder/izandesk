import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, getPagination } from './helpers';
import multer = require('multer');
import path = require('path');
import fs = require('fs');
import { mikrotikSyncPppSecret, mikrotikRemovePppSecret } from '../integrations/mikrotik';

const router: Router = Router();
const uploadDir = path.resolve(__dirname, '../../../uploads/kyc');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});
const upload = multer({ storage });

async function generateClientCode(areaId?: string | null) {
  let prefix = 'IZN';
  if (areaId) {
    const a = await pool.query('SELECT name FROM areas WHERE id=$1', [areaId]);
    if (a.rows[0]?.name) {
      prefix = 'IZN-' + String(a.rows[0].name).substring(0, 3).toUpperCase();
    }
  }
  const seq = await pool.query("SELECT nextval(pg_get_serial_sequence('subscribers','id'))").catch(() => null);
  // fallback counter
  const c = await pool.query('SELECT COUNT(*)::int AS n FROM subscribers');
  const n = (c.rows[0]?.n || 0) + 1;
  return `${prefix}-${String(n).padStart(5, '0')}`;
}

function toPointSql(lat?: any, lng?: any) {
  const la = lat === '' || lat == null ? null : Number(lat);
  const lo = lng === '' || lng == null ? null : Number(lng);
  if (Number.isFinite(la) && Number.isFinite(lo)) return { la, lo };
  return { la: null, lo: null };
}

async function normalizeProvisioning(b: any, cur?: any) {
  const provisioning_mode = String(b.provisioning_mode ?? cur?.provisioning_mode ?? 'RADIUS').toUpperCase();
  let router_id: string | null = b.router_id ?? cur?.router_id ?? null;
  if (provisioning_mode === 'RADIUS') {
    router_id = null;
  } else if (provisioning_mode === 'ROUTER') {
    if (!router_id) throw new Error('router_id is required when provisioning_mode is ROUTER (select a specific API/REST router)');
    const r = await pool.query('SELECT id, integration_mode FROM network_routers WHERE id=$1', [router_id]);
    if (!r.rows[0]) throw new Error('Selected router not found');
    const mode = String(r.rows[0].integration_mode || '').toUpperCase();
    if (mode === 'RADIUS') throw new Error('Selected router is RADIUS-mode. Choose an API/REST router for direct provisioning, or select RADIUS mode.');
  } else {
    throw new Error('provisioning_mode must be ROUTER or RADIUS');
  }
  return { provisioning_mode, router_id };
}

async function resolveRouterSecretPayload(sub: any) {
  let profile_name = sub.profile_name || sub.package_name || 'default';
  if (sub.package_name) {
    const p = await pool.query('SELECT profile_name FROM bandwidth_packages WHERE name=$1 LIMIT 1', [sub.package_name]).catch(()=>({rows:[] as any[]}));
    if ((p as any).rows[0]?.profile_name) profile_name = (p as any).rows[0].profile_name;
  }
  return { ...sub, profile_name };
}

async function provisionPppSecret(sub: any) {
  if (!sub || String(sub.provisioning_mode||'').toUpperCase() !== 'ROUTER' || !sub.router_id || !sub.username) return null;
  const r = await pool.query('SELECT * FROM network_routers WHERE id=$1', [sub.router_id]);
  const router = r.rows[0];
  if (!router) return null;
  const mode = String(router.integration_mode||'').toUpperCase();
  if (mode !== 'API' && mode !== 'REST') return null;
  try {
    const payload = await resolveRouterSecretPayload(sub);
    return await mikrotikSyncPppSecret(router, payload);
  } catch (e:any) { return { ok:false, error: e.message }; }
}

async function removePppSecretFromRouter(routerId: string | null | undefined, username: string | null | undefined) {
  if (!routerId || !username) return null;
  const r = await pool.query('SELECT * FROM network_routers WHERE id=$1', [routerId]);
  const router = r.rows[0];
  if (!router) return null;
  const mode = String(router.integration_mode||'').toUpperCase();
  if (mode !== 'API' && mode !== 'REST') return null;
  try { return await mikrotikRemovePppSecret(router, String(username)); } catch (e:any) { return { ok:false, error: e.message }; }
}

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req);
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim();
  const type = String(req.query.type || req.query.subscriber_type || '').trim();
  const zoneId = String(req.query.zone_id || '').trim();
  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(lower(s.full_name) LIKE $${params.length} OR lower(s.client_code) LIKE $${params.length} OR lower(COALESCE(s.username,'')) LIKE $${params.length} OR lower(COALESCE(s.phone,'')) LIKE $${params.length} OR lower(COALESCE(s.email,'')) LIKE $${params.length})`);
  }
  if (status) { params.push(status); where.push(`s.status = $${params.length}`); }
  if (type) { params.push(type); where.push(`s.subscriber_type = $${params.length}`); }
  if (zoneId) { params.push(zoneId); where.push(`s.zone_id = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM subscribers s ${whereSql}`, params);
  params.push(limit, offset);
  const rowsRes = await pool.query(`
    SELECT s.*, a.name as area_name, z.name as zone_name, d.name as distribution_box_name, d.code as distribution_box_code,
           nr.name as router_name, nr.integration_mode as router_integration_mode
    FROM subscribers s
    LEFT JOIN areas a ON a.id=s.area_id
    LEFT JOIN zones z ON z.id=s.zone_id
    LEFT JOIN distribution_boxes d ON d.id=s.distribution_box_id
    LEFT JOIN network_routers nr ON nr.id=s.router_id
    ${whereSql}
    ORDER BY s.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);
  res.json({ data: rowsRes.rows, total: totalRes.rows[0].total, page, limit });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const r = await pool.query(`
    SELECT s.*, a.name as area_name, z.name as zone_name, d.name as distribution_box_name, d.code as distribution_box_code,
           nr.name as router_name, nr.integration_mode as router_integration_mode
    FROM subscribers s
    LEFT JOIN areas a ON a.id=s.area_id
    LEFT JOIN zones z ON z.id=s.zone_id
    LEFT JOIN distribution_boxes d ON d.id=s.distribution_box_id
    LEFT JOIN network_routers nr ON nr.id=s.router_id
    WHERE s.id=$1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Subscriber not found' });
  const kyc = await pool.query('SELECT * FROM kyc_documents WHERE subscriber_id=$1 ORDER BY uploaded_at DESC', [req.params.id]);
  res.json({ ...r.rows[0], kyc_documents: kyc.rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.full_name) return res.status(400).json({ message: 'full_name is required' });
  let prov;
  try { prov = await normalizeProvisioning(b); } catch (e: any) { return res.status(400).json({ message: e.message }); }
  const clientCode = b.client_code || await generateClientCode(b.area_id);
  const { la, lo } = toPointSql(b.latitude, b.longitude);
  const r = await pool.query(`
    INSERT INTO subscribers (
      client_code, full_name, subscriber_type, connection_type, username, password, phone, email, nid_number,
      package_name, bandwidth_mbps, monthly_bill, status, area_id, zone_id, distribution_box_id, address,
      latitude, longitude, location, ip_address, mac_address, installation_date,
      district, thana, upazila, post_office, village, area_name, ward_no, road_no, house_no,
      provisioning_mode, router_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
      CASE WHEN $18::float IS NOT NULL AND $19::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($19,$18),4326)::geography ELSE NULL END,
      $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
    ) RETURNING *`,
    [clientCode, b.full_name, b.subscriber_type || 'HOME', b.connection_type || 'PPPOE', b.username || null, b.password || null,
     b.phone || null, b.email || null, b.nid_number || null, b.package_name || null, b.bandwidth_mbps || null,
     b.monthly_bill || 0, b.status || 'PENDING', b.area_id || null, b.zone_id || null, b.distribution_box_id || null,
     b.address || null, la, lo, b.ip_address || null, b.mac_address || null, b.installation_date || null,
     b.district || null, b.thana || null, b.upazila || null, b.post_office || null, b.village || null, b.area_name || null, b.ward_no || null, b.road_no || null, b.house_no || null,
     prov.provisioning_mode, prov.router_id]
  );
  const created = r.rows[0];
  const provision_result = await provisionPppSecret(created);
  res.status(201).json({ ...created, ...(provision_result ? { provision_result } : {}) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const existing = await pool.query('SELECT * FROM subscribers WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ message: 'Subscriber not found' });
  const cur = existing.rows[0];
  let prov;
  try { prov = await normalizeProvisioning(b, cur); } catch (e: any) { return res.status(400).json({ message: e.message }); }
  const { la, lo } = toPointSql(b.latitude ?? cur.latitude, b.longitude ?? cur.longitude);
  const r = await pool.query(`
    UPDATE subscribers SET
      full_name=$1, subscriber_type=$2, connection_type=$3, username=$4, password=COALESCE(NULLIF($5,''), password), phone=$6, email=$7, nid_number=$8,
      package_name=$9, bandwidth_mbps=$10, monthly_bill=$11, status=$12, area_id=$13, zone_id=$14, distribution_box_id=$15, address=$16,
      latitude=$17, longitude=$18,
      location=CASE WHEN $17::float IS NOT NULL AND $18::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($18,$17),4326)::geography ELSE NULL END,
      ip_address=$19, mac_address=$20, installation_date=$21,
      district=$22, thana=$23, upazila=$24, post_office=$25, village=$26, area_name=$27, ward_no=$28, road_no=$29, house_no=$30,
      provisioning_mode=$31, router_id=$32,
      updated_at=now()
    WHERE id=$33 RETURNING *`,
    [b.full_name ?? cur.full_name, b.subscriber_type ?? cur.subscriber_type, b.connection_type ?? cur.connection_type, b.username ?? cur.username, b.password ?? '',
     b.phone ?? cur.phone, b.email ?? cur.email, b.nid_number ?? cur.nid_number, b.package_name ?? cur.package_name, b.bandwidth_mbps ?? cur.bandwidth_mbps,
     b.monthly_bill ?? cur.monthly_bill, b.status ?? cur.status, b.area_id ?? cur.area_id, b.zone_id ?? cur.zone_id, b.distribution_box_id ?? cur.distribution_box_id,
     b.address ?? cur.address, la, lo, b.ip_address ?? cur.ip_address, b.mac_address ?? cur.mac_address, b.installation_date ?? cur.installation_date,
     b.district ?? cur.district, b.thana ?? cur.thana, b.upazila ?? cur.upazila, b.post_office ?? cur.post_office, b.village ?? cur.village, b.area_name ?? cur.area_name, b.ward_no ?? cur.ward_no, b.road_no ?? cur.road_no, b.house_no ?? cur.house_no,
     prov.provisioning_mode, prov.router_id,
     req.params.id]
  );
  const updated = r.rows[0];
  const oldWasRouter = String(cur.provisioning_mode || '').toUpperCase() === 'ROUTER' && cur.router_id && cur.username;
  const newIsRouter = String(updated.provisioning_mode || '').toUpperCase() === 'ROUTER' && updated.router_id && updated.username;
  if (oldWasRouter) {
    const routerChanged = String(cur.router_id || '') !== String(updated.router_id || '');
    const userChanged = String(cur.username || '') !== String(updated.username || '');
    const modeChanged = String(cur.provisioning_mode || '').toUpperCase() !== String(updated.provisioning_mode || '').toUpperCase();
    if (modeChanged || routerChanged || userChanged) {
      await removePppSecretFromRouter(cur.router_id, cur.username);
    }
  }
  let provision_result = null;
  if (newIsRouter) {
    provision_result = await provisionPppSecret(updated);
  }
  res.json({ ...updated, ...(provision_result ? { provision_result } : {}) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await pool.query('SELECT * FROM subscribers WHERE id=$1', [req.params.id]);
  const cur = existing.rows[0];
  if (cur && String(cur.provisioning_mode || '').toUpperCase() === 'ROUTER' && cur.router_id && cur.username) {
    await removePppSecretFromRouter(cur.router_id, cur.username);
  }
  await pool.query('DELETE FROM subscribers WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// KYC
router.get('/:id/kyc', asyncHandler(async (req, res) => {
  const r = await pool.query('SELECT * FROM kyc_documents WHERE subscriber_id=$1 ORDER BY uploaded_at DESC', [req.params.id]);
  res.json({ data: r.rows });
}));

router.post('/:id/kyc', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'file is required' });
  const docType = String(req.body.doc_type || 'OTHER');
  const r = await pool.query(
    'INSERT INTO kyc_documents(subscriber_id,doc_type,file_name,file_path,mime_type) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [req.params.id, docType, req.file.originalname, req.file.filename, req.file.mimetype]
  );
  res.status(201).json(r.rows[0]);
}));

router.delete('/:id/kyc/:docId', asyncHandler(async (req, res) => {
  const r = await pool.query('SELECT * FROM kyc_documents WHERE id=$1 AND subscriber_id=$2', [req.params.docId, req.params.id]);
  if (r.rows[0]) {
    const fp = path.join(uploadDir, r.rows[0].file_path);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await pool.query('DELETE FROM kyc_documents WHERE id=$1', [req.params.docId]);
  }
  res.json({ ok: true });
}));

export default router;
