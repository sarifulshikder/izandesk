import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, hasGisAccess, hasGisWrite, ValidationError, ConflictError } from './helpers';
import { auditTopology, trashTopology } from '../utils/topology-governance';

const router: Router = Router();

/** Everyone in the GIS read roles may browse topology and the governance views;
 *  only SUPER_ADMIN / NOC_ENGINEER may change it. */
function requireTopologyRead(req: any, res: any, next: any) {
  if (!hasGisAccess(req)) return res.status(403).json({ message: 'Forbidden' });
  next();
}
function requireTopologyRole(req: any, res: any, next: any) {
  if (!hasGisWrite(req)) return res.status(403).json({ message: 'Forbidden' });
  next();
}

/** Reject NaN/out-of-range/half-cleared coordinates before they reach PostGIS. */
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

function conflict(e: any, message: string): never {
  if (String(e?.code) === '23505') throw new ConflictError(message);
  if (String(e?.code) === '23503') throw new ValidationError('Referenced area/zone/box does not exist');
  throw e;
}

// ----- Areas -----
router.get('/areas', asyncHandler(async (_req, res) => {
  const r = await pool.query('SELECT * FROM areas ORDER BY name');
  res.json({ data: r.rows });
}));
router.post('/areas', requireTopologyRole, asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ message: 'name is required' });
  const r = await pool.query('INSERT INTO areas(name) VALUES($1) RETURNING *', [name]).catch(e => conflict(e, `Area "${name}" already exists`));
  await auditTopology(req, 'area', r.rows[0].id, 'CREATE', { name });
  res.status(201).json(r.rows[0]);
}));
router.put('/areas/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const before = (await pool.query('SELECT * FROM areas WHERE id=$1', [req.params.id])).rows[0];
  const r = await pool.query('UPDATE areas SET name=$1 WHERE id=$2 RETURNING *', [req.body?.name, req.params.id]).catch(e => conflict(e, `Area "${req.body?.name}" already exists`));
  await auditTopology(req, 'area', req.params.id, 'UPDATE', { before: before?.name, after: r.rows[0]?.name });
  res.json(r.rows[0]);
}));
router.delete('/areas/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const row = (await pool.query('SELECT * FROM areas WHERE id=$1', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ message: 'Not found' });
  // Zones cascade on area delete — capture them too so restore can recreate them.
  const zones = (await pool.query('SELECT * FROM zones WHERE area_id=$1', [req.params.id])).rows;
  await trashTopology(req, 'area', row.id, { row, zones });
  await pool.query('DELETE FROM areas WHERE id=$1', [row.id]);
  await auditTopology(req, 'area', row.id, 'DELETE', { name: row.name, zones: zones.length });
  res.json({ ok: true });
}));

// ----- Zones -----
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
  await auditTopology(req, 'zone', r.rows[0].id, 'CREATE', { name, area_id });
  res.status(201).json(r.rows[0]);
}));
router.put('/zones/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const before = (await pool.query('SELECT * FROM zones WHERE id=$1', [req.params.id])).rows[0];
  const r = await pool.query('UPDATE zones SET area_id=COALESCE($1,area_id), name=COALESCE($2,name) WHERE id=$3 RETURNING *', [req.body?.area_id || null, req.body?.name || null, req.params.id]).catch(e => conflict(e, `Zone "${req.body?.name}" already exists in this area`));
  await auditTopology(req, 'zone', req.params.id, 'UPDATE', { before: before?.name, after: r.rows[0]?.name, area_id: r.rows[0]?.area_id });
  res.json(r.rows[0]);
}));
router.delete('/zones/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const row = (await pool.query('SELECT * FROM zones WHERE id=$1', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ message: 'Not found' });
  // FK ON DELETE SET NULL unlinks these — remember them for restore.
  const refs = await pool.query(`
    SELECT 'box' as kind, id FROM distribution_boxes WHERE zone_id=$1
    UNION ALL SELECT 'subscriber', id FROM subscribers WHERE zone_id=$1
    UNION ALL SELECT 'lead', id FROM leads WHERE zone_id=$1`, [row.id]);
  await trashTopology(req, 'zone', row.id, { row, refs: refs.rows });
  await pool.query('DELETE FROM zones WHERE id=$1', [row.id]);
  await auditTopology(req, 'zone', row.id, 'DELETE', { name: row.name, links: refs.rows.length });
  res.json({ ok: true });
}));

// ----- Distribution boxes -----
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
  await auditTopology(req, 'box', r.rows[0].id, 'CREATE', { name: b.name, code: b.code || null });
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
  // Marker drags only land here; keep those audit entries compact.
  const moved = Number.isFinite(Number(b.latitude)) && Number.isFinite(Number(b.longitude))
    && Math.abs(Number(b.latitude) - Number(cur.latitude)) > 0.00001;
  await auditTopology(req, 'box', req.params.id, moved ? 'MOVE' : 'UPDATE',
    moved ? { name: cur.name, from: [cur.latitude, cur.longitude], to: [lat, lng] } : { name: cur.name, after: b.name ?? cur.name });
  res.json(r.rows[0]);
}));
router.delete('/boxes/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const row = (await pool.query('SELECT * FROM distribution_boxes WHERE id=$1', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ message: 'Not found' });
  const refs = await pool.query(`
    (SELECT 'subscriber' as kind, id FROM subscribers WHERE distribution_box_id=$1)
    UNION ALL (SELECT 'route_from', id FROM fiber_routes WHERE from_box_id=$1)
    UNION ALL (SELECT 'route_to', id FROM fiber_routes WHERE to_box_id=$1)`, [row.id]);
  await trashTopology(req, 'box', row.id, { row, refs: refs.rows });
  await pool.query('DELETE FROM distribution_boxes WHERE id=$1', [row.id]);
  await auditTopology(req, 'box', row.id, 'DELETE', { name: row.name, links: refs.rows.length });
  res.json({ ok: true });
}));

// ----- Fiber routes -----
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
  await auditTopology(req, 'route', r.rows[0].id, 'CREATE', { name: b.name, route_type: b.route_type || 'FIBER' });
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
  await auditTopology(req, 'route', req.params.id, 'UPDATE', { name: cur.name, after: b.name ?? cur.name });
  res.json(r.rows[0]);
}));
router.delete('/fiber-routes/:id', requireTopologyRole, asyncHandler(async (req, res) => {
  const row = (await pool.query('SELECT *, ST_AsGeoJSON(path::geometry) as path_geojson FROM fiber_routes WHERE id=$1', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ message: 'Not found' });
  await trashTopology(req, 'route', row.id, { row });
  await pool.query('DELETE FROM fiber_routes WHERE id=$1', [row.id]);
  await auditTopology(req, 'route', row.id, 'DELETE', { name: row.name });
  res.json({ ok: true });
}));

// ----- Governance: audit, trash and restore -----
router.get('/audit', requireTopologyRead, asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const r = await pool.query('SELECT * FROM topology_audit ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json({ data: r.rows });
}));

router.get('/trash', requireTopologyRead, asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const r = await pool.query(`
    SELECT id, entity_type, entity_id, deleted_by, deleted_at,
           payload->'row'->>'name' as name
    FROM topology_trash ORDER BY deleted_at DESC LIMIT $1`, [limit]);
  res.json({ data: r.rows });
}));

router.post('/trash/:id/restore', requireTopologyRole, asyncHandler(async (req, res) => {
  const entry = (await pool.query('SELECT * FROM topology_trash WHERE id=$1', [req.params.id])).rows[0];
  if (!entry) return res.status(404).json({ message: 'Trash entry not found' });
  const payload = entry.payload;
  const row = payload.row;
  try {
    if (entry.entity_type === 'area') {
      await pool.query('INSERT INTO areas(id,name,created_at) VALUES($1,$2,$3)', [row.id, row.name, row.created_at || null]);
      for (const z of (payload.zones || [])) {
        await pool.query('INSERT INTO zones(id,area_id,name,created_at) VALUES($1,$2,$3,$4)', [z.id, z.area_id, z.name, z.created_at || null]);
      }
    } else if (entry.entity_type === 'zone') {
      await pool.query('INSERT INTO zones(id,area_id,name,created_at) VALUES($1,$2,$3,$4)', [row.id, row.area_id, row.name, row.created_at || null]);
      const table: Record<string, string> = { box: 'distribution_boxes', subscriber: 'subscribers', lead: 'leads' };
      for (const ref of (payload.refs || [])) {
        if (table[ref.kind]) await pool.query(`UPDATE ${table[ref.kind]} SET zone_id=$1 WHERE id=$2`, [row.id, ref.id]);
      }
    } else if (entry.entity_type === 'box') {
      await pool.query(`
        INSERT INTO distribution_boxes(id,zone_id,name,code,box_type,capacity_ports,latitude,longitude,location,address,notes,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $7::float IS NOT NULL AND $8::float IS NOT NULL THEN ST_SetSRID(ST_MakePoint($8,$7),4326)::geography ELSE NULL END,$9,$10,$11)`,
        [row.id, row.zone_id || null, row.name, row.code || null, row.box_type || 'TJ', row.capacity_ports || 8,
         row.latitude || null, row.longitude || null, row.address || null, row.notes || null, row.created_at || null]);
      for (const ref of (payload.refs || [])) {
        if (ref.kind === 'subscriber') await pool.query('UPDATE subscribers SET distribution_box_id=$1 WHERE id=$2', [row.id, ref.id]);
        if (ref.kind === 'route_from') await pool.query('UPDATE fiber_routes SET from_box_id=$1 WHERE id=$2', [row.id, ref.id]);
        if (ref.kind === 'route_to') await pool.query('UPDATE fiber_routes SET to_box_id=$1 WHERE id=$2', [row.id, ref.id]);
      }
    } else if (entry.entity_type === 'route') {
      await pool.query(`
        INSERT INTO fiber_routes(id,name,route_type,from_box_id,to_box_id,path,notes,created_at)
        VALUES($1,$2,$3,$4,$5, CASE WHEN $6::text IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON($6),4326)::geography ELSE NULL END,$7,$8)`,
        [row.id, row.name, row.route_type || 'FIBER', row.from_box_id || null, row.to_box_id || null,
         row.path_geojson || null, row.notes || null, row.created_at || null]);
    } else throw new ValidationError('Unknown entity type in trash');
    await pool.query('DELETE FROM topology_trash WHERE id=$1', [entry.id]);
    await auditTopology(req, entry.entity_type, row.id, 'RESTORE', { name: row.name });
    res.json({ ok: true, entity_type: entry.entity_type, id: row.id });
  } catch (e: any) {
    conflict(e, `Could not restore ${entry.entity_type}`);
  }
}));

/** Bulk import from a GeoJSON FeatureCollection (the format exported by /gis). */
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
        const r = await pool.query(`
          INSERT INTO fiber_routes(name,route_type,from_box_id,to_box_id,path,notes)
          VALUES($1,$2,$3,$4, ST_SetSRID(ST_GeomFromGeoJSON($5),4326)::geography,$6) RETURNING id`,
          [p.name, p.route_type || 'FIBER', fromId, toId, pathSql, p.notes || null])
          .catch(e => conflict(e, `route ${p.name}`));
        result.routes = result.routes || [];
        result.routes.push(r.rows[0].id);
        result.created.routes++;
      } else result.skipped++;
    } catch (e: any) {
      result.errors.push({ index: i, name: p.name || null, message: e.message });
    }
  }
  await auditTopology(req, 'import', null, 'IMPORT', result.created);
  res.json(result);
}));

export default router;
