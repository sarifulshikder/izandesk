import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, hasGisAccess, ValidationError, ConflictError } from './helpers';

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

/** Validate and encode a route path as GeoJSON LineString text for PostGIS. */
function buildPathSql(b: any): string | null {
  if (b.path_geojson) return b.path_geojson;
  if (Array.isArray(b.path) && b.path.length >= 2) {
    for (const pt of b.path) {
      const lng = Number(pt?.[0]), lat = Number(pt?.[1]);
      if (!Array.isArray(pt) || !Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        throw new ValidationError('route path points must be [longitude, latitude] pairs within range');
      }
    }
    return JSON.stringify({ type: 'LineString', coordinates: b.path });
  }
  return null;
}

/** Turn Postgres unique violations into a friendly 409 instead of a 500. */
function conflict(e: any, message: string): never {
  if (String(e?.code) === '23505') throw new ConflictError(message);
  if (String(e?.code) === '23503') throw new ValidationError('Referenced area/zone/box does not exist');
  throw e;
}

// Areas
router.get('/areas', asyncHandler(async (_req, res) => {
  const r = await pool.query('SELECT * FROM areas ORDER BY name');
  res.json({ data: r.rows });
}));
router.post('/areas', requireTopologyRole, asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ message: 'name is required' });
  const r = await pool.query('INSERT INTO areas(name) VALUES($1) RETURNING *', [name]).catch(e => conflict(e, `Area "${name}" already exists`));
  res.status(201).json(r.rows[0]);
}));
router.put('/areas/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const r = await pool.query('UPDATE areas SET name=$1 WHERE id=$2 RETURNING *', [req.body?.name, req.params.id]).catch(e => conflict(e, `Area "${req.body?.name}" already exists`));
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
  const r = await pool.query('INSERT INTO zones(area_id,name) VALUES($1,$2) RETURNING *', [area_id, name]).catch(e => conflict(e, `Zone "${name}" already exists in this area`));
  res.status(201).json(r.rows[0]);
}));
router.put('/zones/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const { area_id, name } = req.body || {};
  const r = await pool.query('UPDATE zones SET area_id=COALESCE($1,area_id), name=COALESCE($2,name) WHERE id=$3 RETURNING *', [area_id || null, name || null, req.params.id]).catch(e => conflict(e, `Zone "${name}" already exists in this area`));
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
    [b.zone_id || null, b.name, b.code || null, b.box_type || 'TJ', b.capacity_ports || 8, lat, lng, b.address || null, b.notes || null]).catch(e => conflict(e, b.code ? `Box code "${b.code}" already exists` : 'Could not create box'));
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
    [b.zone_id ?? cur.zone_id, b.name ?? cur.name, b.code ?? cur.code, b.box_type ?? cur.box_type, b.capacity_ports ?? cur.capacity_ports, lat, lng, b.address ?? cur.address, b.notes ?? cur.notes, req.params.id]).catch(e => conflict(e, b.code ? `Box code "${b.code}" already exists` : 'Could not update box'));
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
           ST_AsGeoJSON(f.path::geometry) as path_geojson,
           ROUND(ST_Length(f.path)::numeric) as length_m
    FROM fiber_routes f
    LEFT JOIN distribution_boxes fb ON fb.id=f.from_box_id
    LEFT JOIN distribution_boxes tb ON tb.id=f.to_box_id
    ORDER BY f.created_at DESC`);
  res.json({ data: r.rows });
}));
router.post('/fiber-routes', requireTopologyRole, asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ message: 'name is required' });
  const pathSql = buildPathSql(b);
  const r = await pool.query(`
    INSERT INTO fiber_routes(name,route_type,from_box_id,to_box_id,path,notes)
    VALUES($1,$2,$3,$4, CASE WHEN $5::text IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON($5),4326)::geography ELSE NULL END,$6)
    RETURNING *, ST_AsGeoJSON(path::geometry) as path_geojson`,
    [b.name, b.route_type || 'FIBER', b.from_box_id || null, b.to_box_id || null, pathSql, b.notes || null]).catch(e => conflict(e, 'Could not create route'));
  res.status(201).json(r.rows[0]);
}));
router.put('/fiber-routes/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const cur = (await pool.query('SELECT *, ST_AsGeoJSON(path::geometry) as path_geojson FROM fiber_routes WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ message: 'Not found' });
  const pathSql = (b.path_geojson !== undefined || b.path !== undefined) ? buildPathSql(b) : (cur.path_geojson || null);
  const r = await pool.query(`
    UPDATE fiber_routes SET name=$1, route_type=$2, from_box_id=$3, to_box_id=$4,
      path=CASE WHEN $5::text IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON($5),4326)::geography ELSE NULL END,
      notes=$6
    WHERE id=$7 RETURNING *, ST_AsGeoJSON(path::geometry) as path_geojson`,
    [b.name ?? cur.name, b.route_type ?? cur.route_type, b.from_box_id ?? cur.from_box_id,
     b.to_box_id ?? cur.to_box_id, pathSql, b.notes ?? cur.notes, req.params.id]).catch(e => conflict(e, 'Could not update route'));
  res.json(r.rows[0]);
}));
router.delete('/fiber-routes/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM fiber_routes WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/** Bulk import from a GeoJSON FeatureCollection (the format exported by /gis).
 *  Point features create distribution boxes, LineString features create fiber
 *  routes. Each feature is validated independently so one bad row never aborts
 *  the rest; the response reports created/skipped counts and per-item errors. */
router.post('/import', requireTopologyRole, asyncHandler(async (req, res) => {
  const features = Array.isArray(req.body?.features) ? req.body.features : [];
  if (!features.length) return res.status(400).json({ message: 'No features supplied' });
  const result: any = { created: { boxes: 0, routes: 0 }, skipped: 0, errors: [] as any[] };

  const zoneRows = (await pool.query('SELECT z.id, z.name, a.name as area_name FROM zones z JOIN areas a ON a.id=z.area_id')).rows;
  const zoneByKey = new Map<string, string>();
  for (const z of zoneRows) {
    zoneByKey.set(`${z.area_name}/${z.name}`.toLowerCase(), z.id);
    zoneByKey.set(String(z.name).toLowerCase(), z.id);
  }
  const boxByCode = new Map<string, string>();
  for (const b of (await pool.query('SELECT id, code FROM distribution_boxes WHERE code IS NOT NULL')).rows) {
    boxByCode.set(String(b.code).toLowerCase(), b.id);
  }

  for (let i = 0; i < features.length; i++) {
    const f: any = features[i];
    const p: any = f?.properties || {};
    try {
      if (f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
        const lng = Number(f.geometry.coordinates[0]), lat = Number(f.geometry.coordinates[1]);
        checkCoords(lat, lng);
        if (!p.name) throw new Error('box name is required');
        const zoneId = p.zone_id || (p.zone_name ? zoneByKey.get(String(p.zone_name).toLowerCase()) || null : null);
        const code = p.code || null;
        const r = await pool.query(`
          INSERT INTO distribution_boxes(zone_id,name,code,box_type,capacity_ports,latitude,longitude,location,address,notes)
          VALUES($1,$2,$3,$4,$5,$6,$7, ST_SetSRID(ST_MakePoint($7,$6),4326)::geography,$8,$9) RETURNING id`,
          [zoneId, p.name, code, p.box_type || 'TJ', Number(p.capacity_ports) || 8, lat, lng, p.address || null, p.notes || null])
          .catch(e => conflict(e, `box ${p.name}${code ? ` (${code})` : ''}`));
        if (code) boxByCode.set(String(code).toLowerCase(), r.rows[0].id);
        result.created.boxes++;
      } else if (f?.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates)) {
        const pathSql = buildPathSql({ path: f.geometry.coordinates });
        if (!p.name) throw new Error('route name is required');
        const fromId = p.from_box_id || (p.from_code ? boxByCode.get(String(p.from_code).toLowerCase()) : null) || null;
        const toId = p.to_box_id || (p.to_code ? boxByCode.get(String(p.to_code).toLowerCase()) : null) || null;
        await pool.query(`
          INSERT INTO fiber_routes(name,route_type,from_box_id,to_box_id,path,notes)
          VALUES($1,$2,$3,$4, ST_SetSRID(ST_GeomFromGeoJSON($5),4326)::geography,$6)`,
          [p.name, p.route_type || 'FIBER', fromId, toId, pathSql, p.notes || null])
          .catch(e => conflict(e, `route ${p.name}`));
        result.created.routes++;
      } else result.skipped++;
    } catch (e: any) {
      result.errors.push({ index: i, name: p.name || null, message: e.message });
    }
  }
  res.json(result);
}));

export default router;
