import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, hasGisAccess, ValidationError } from './helpers';

const router: Router = Router();

/** Reading reference/topology data is safe for every authenticated role (the
 *  reseller subscriber wizard needs areas/zones/boxes). Mutations are admin/ops
 *  only — the same boundary as the GIS map. */
function requireTopologyRole(req: any, res: any, next: any) {
  if (!hasGisAccess(req)) return res.status(403).json({ message: 'Forbidden' });
  next();
}

/** Reject NaN/out-of-range/half-cleared coordinates before they reach PostGIS.
 *  Called with the exact values that will be written. */
function checkCoords(lat: any, lng: any): void {
  const hasLat = lat !== undefined && lat !== null && lat !== '';
  const hasLng = lng !== undefined && lng !== null && lng !== '';
  if (hasLat !== hasLng) throw new ValidationError('latitude and longitude must be provided together');
  if (!hasLat) return;
  const nlat = Number(lat), nlng = Number(lng);
  if (!Number.isFinite(nlat) || !Number.isFinite(nlng) || nlat < -90 || nlat > 90 || nlng < -180 || nlng > 180) {
    throw new ValidationError('latitude must be between -90 and 90, longitude between -180 and 180');
  }
}

// Areas
router.get('/areas', asyncHandler(async (_req, res) => {
  const r = await pool.query('SELECT * FROM areas ORDER BY name');
  res.json({ data: r.rows });
}));
router.post('/areas', requireTopologyRole, asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ message: 'name is required' });
  const r = await pool.query('INSERT INTO areas(name) VALUES($1) RETURNING *', [name]);
  res.status(201).json(r.rows[0]);
}));
router.put('/areas/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const r = await pool.query('UPDATE areas SET name=$1 WHERE id=$2 RETURNING *', [req.body?.name, req.params.id]);
  res.json(r.rows[0]);
}));
router.delete('/areas/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM areas WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Zones
router.get('/zones', asyncHandler(async (req, res) => {
  const areaId = String(req.query.area_id || '');
  const r = areaId
    ? await pool.query('SELECT z.*, a.name as area_name FROM zones z JOIN areas a ON a.id=z.area_id WHERE z.area_id=$1 ORDER BY z.name', [areaId])
    : await pool.query('SELECT z.*, a.name as area_name FROM zones z JOIN areas a ON a.id=z.area_id ORDER BY a.name, z.name');
  res.json({ data: r.rows });
}));
router.post('/zones', requireTopologyRole, asyncHandler(async (req, res) => {
  const { area_id, name } = req.body || {};
  if (!area_id || !name) return res.status(400).json({ message: 'area_id and name are required' });
  const r = await pool.query('INSERT INTO zones(area_id,name) VALUES($1,$2) RETURNING *', [area_id, name]);
  res.status(201).json(r.rows[0]);
}));
router.put('/zones/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const { area_id, name } = req.body || {};
  const r = await pool.query('UPDATE zones SET area_id=COALESCE($1,area_id), name=COALESCE($2,name) WHERE id=$3 RETURNING *', [area_id || null, name || null, req.params.id]);
  res.json(r.rows[0]);
}));
router.delete('/zones/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM zones WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Distribution boxes
router.get('/boxes', asyncHandler(async (req, res) => {
  const zoneId = String(req.query.zone_id || '');
  const q = zoneId ? 'WHERE d.zone_id=$1' : '';
  const params = zoneId ? [zoneId] : [];
  const r = await pool.query(`
    SELECT d.*, z.name as zone_name, a.name as area_name,
      (SELECT COUNT(*)::int FROM subscribers s WHERE s.distribution_box_id=d.id) as subscriber_count
    FROM distribution_boxes d
    LEFT JOIN zones z ON z.id=d.zone_id
    LEFT JOIN areas a ON a.id=z.area_id
    ${q}
    ORDER BY d.created_at DESC`, params);
  res.json({ data: r.rows });
}));
router.post('/boxes', requireTopologyRole, asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ message: 'name is required' });
  const lat = b.latitude === '' || b.latitude == null ? null : Number(b.latitude);
  const lng = b.longitude === '' || b.longitude == null ? null : Number(b.longitude);
  checkCoords(lat, lng);
  const r = await pool.query(`
    INSERT INTO distribution_boxes(zone_id,name,code,box_type,capacity_ports,latitude,longitude,location,address,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7, CASE WHEN $6::float IS NOT NULL AND $7::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($7,$6),4326)::geography ELSE NULL END,$8,$9)
    RETURNING *`,
    [b.zone_id || null, b.name, b.code || null, b.box_type || 'TJ', b.capacity_ports || 8, lat, lng, b.address || null, b.notes || null]);
  res.status(201).json(r.rows[0]);
}));
router.put('/boxes/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const curR = await pool.query('SELECT * FROM distribution_boxes WHERE id=$1', [req.params.id]);
  if (!curR.rows[0]) return res.status(404).json({ message: 'Not found' });
  const cur = curR.rows[0];
  const lat = b.latitude === '' || b.latitude == null ? (b.latitude === null ? null : cur.latitude) : Number(b.latitude);
  const lng = b.longitude === '' || b.longitude == null ? (b.longitude === null ? null : cur.longitude) : Number(b.longitude);
  checkCoords(lat, lng);
  const r = await pool.query(`
    UPDATE distribution_boxes SET zone_id=$1,name=$2,code=$3,box_type=$4,capacity_ports=$5,latitude=$6,longitude=$7,
      location=CASE WHEN $6::float IS NOT NULL AND $7::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($7,$6),4326)::geography ELSE NULL END,
      address=$8,notes=$9
    WHERE id=$10 RETURNING *`,
    [b.zone_id ?? cur.zone_id, b.name ?? cur.name, b.code ?? cur.code, b.box_type ?? cur.box_type, b.capacity_ports ?? cur.capacity_ports, lat, lng, b.address ?? cur.address, b.notes ?? cur.notes, req.params.id]);
  res.json(r.rows[0]);
}));
router.delete('/boxes/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM distribution_boxes WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Fiber routes
router.get('/fiber-routes', asyncHandler(async (_req, res) => {
  const r = await pool.query(`
    SELECT f.*, fb.name as from_box_name, tb.name as to_box_name,
           ST_AsGeoJSON(f.path::geometry) as path_geojson
    FROM fiber_routes f
    LEFT JOIN distribution_boxes fb ON fb.id=f.from_box_id
    LEFT JOIN distribution_boxes tb ON tb.id=f.to_box_id
    ORDER BY f.created_at DESC`);
  res.json({ data: r.rows });
}));
router.post('/fiber-routes', requireTopologyRole, asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ message: 'name is required' });
  // path as GeoJSON LineString or array of [lng,lat]
  let pathSql: any = null;
  if (b.path_geojson) pathSql = b.path_geojson;
  else if (Array.isArray(b.path) && b.path.length >= 2) {
    pathSql = JSON.stringify({ type: 'LineString', coordinates: b.path });
  }
  const r = await pool.query(`
    INSERT INTO fiber_routes(name,route_type,from_box_id,to_box_id,path,notes)
    VALUES($1,$2,$3,$4, CASE WHEN $5::text IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON($5),4326)::geography ELSE NULL END,$6)
    RETURNING *, ST_AsGeoJSON(path::geometry) as path_geojson`,
    [b.name, b.route_type || 'FIBER', b.from_box_id || null, b.to_box_id || null, pathSql, b.notes || null]);
  res.status(201).json(r.rows[0]);
}));
router.delete('/fiber-routes/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM fiber_routes WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
