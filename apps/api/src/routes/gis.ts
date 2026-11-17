import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler, sanitizeSubscriber, hasGisAccess } from './helpers';

const router: Router = Router();

/** The GIS map is a global infrastructure view and its subscriber layer
 *  contains customer PII. Hide it from resellers at the API boundary too —
 *  the sidebar/command-palette filtering is UI-only and URL navigation (or a
 *  direct API call) would otherwise bypass it. */
router.use((req, res, next) => {
  if (!hasGisAccess(req)) return res.status(403).json({ message: 'Forbidden' });
  next();
});

/** Defence-in-depth: if a reseller is ever granted GIS access, subscriber data
 *  must still be limited to their own customers. Unknown resellers see nothing
 *  (restricted with no uuid) rather than falling back to the global dataset. */
async function subscriberScope(req: any): Promise<{ restricted: boolean; uuid: string | null }> {
  const user = req.user || {};
  if (user.role !== 'RESELLER') return { restricted: false, uuid: null };
  if (user.resellerId) {
    const r = await pool.query(
      'SELECT id FROM resellers WHERE id::text=$1 OR lower(code)=lower($1) OR lower(subdomain)=lower($1) LIMIT 1',
      [String(user.resellerId)]);
    if (r.rows[0]) return { restricted: true, uuid: r.rows[0].id };
  }
  if (user.email) {
    const e = await pool.query('SELECT id FROM resellers WHERE lower(email)=lower($1) LIMIT 1', [user.email]);
    if (e.rows[0]) return { restricted: true, uuid: e.rows[0].id };
  }
  return { restricted: true, uuid: null };
}

function scopeFor(scope: { restricted: boolean; uuid: string | null }) {
  return {
    sql: scope.restricted ? (scope.uuid ? 's.reseller_id=$1' : 'FALSE') : 'TRUE',
    params: scope.restricted && scope.uuid ? [scope.uuid] : [] as any[],
  };
}

/** Guard against an unbounded payload when a deployment has many geocoded
 *  subscribers. Callers may raise it via ?limit= but never beyond 50000. */
function mapLimit(req: any): number {
  return Math.min(50000, Math.max(1, Number(req.query.limit) || 5000));
}

/** Optional viewport filter: minLng,minLat,maxLng,maxLat. */
function parseBbox(req: any): [number, number, number, number] | null {
  const raw = String(req.query.bbox || '');
  if (!raw) return null;
  const p = raw.split(',').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = p;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) return null;
  return [minLng, minLat, maxLng, maxLat];
}

const GEOCODE_URL = process.env.GIS_GEOCODE_URL || 'https://nominatim.openstreetmap.org/search';
const geocodeCache = new Map<string, { at: number; data: any[] }>();
let lastGeocodeAt = 0;

const SUB_COLUMNS = `s.id, s.client_code, s.full_name, s.status, s.connection_type, s.username,
  s.latitude, s.longitude, s.address, s.distribution_box_id as box_id,
  z.name as zone_name, a.name as area_name, d.name as distribution_box_name`;
const SUB_JOINS = `LEFT JOIN zones z ON z.id=s.zone_id
  LEFT JOIN areas a ON a.id=s.area_id
  LEFT JOIN distribution_boxes d ON d.id=s.distribution_box_id`;

router.get('/overview', asyncHandler(async (req, res) => {
  const scope = await subscriberScope(req);
  const scoped = scopeFor(scope);
  const limit = mapLimit(req);
  const bbox = parseBbox(req);
  const subParams: any[] = [...scoped.params];
  let bboxSql = '';
  if (bbox) {
    const b0 = subParams.length + 1;
    subParams.push(bbox[0], bbox[2], bbox[1], bbox[3]);
    bboxSql = ` AND s.longitude BETWEEN $${b0} AND $${b0 + 1} AND s.latitude BETWEEN $${b0 + 2} AND $${b0 + 3}`;
  }
  const scopedAndBbox = `${scoped.sql}${bboxSql}`;
  const limitParam = `$${subParams.length + 1}`;

  const boxes = await pool.query(`
    SELECT d.id, d.name, d.code, d.box_type, d.capacity_ports, d.latitude, d.longitude, d.address,
           z.name as zone_name, a.name as area_name,
           (SELECT COUNT(*)::int FROM subscribers s WHERE s.distribution_box_id=d.id ${scope.uuid ? 'AND s.reseller_id=$1' : ''}) as subscriber_count
    FROM distribution_boxes d
    LEFT JOIN zones z ON z.id=d.zone_id
    LEFT JOIN areas a ON a.id=z.area_id
    WHERE d.latitude IS NOT NULL AND d.longitude IS NOT NULL`, scoped.params);
  const subs = await pool.query(`
    SELECT ${SUB_COLUMNS}
    FROM subscribers s ${SUB_JOINS}
    WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL AND ${scopedAndBbox}
    ORDER BY s.id LIMIT ${limitParam}`, [...subParams, limit]);
  const routes = await pool.query(`
    SELECT f.id, f.name, f.route_type, f.notes, fb.name as from_box_name, tb.name as to_box_name,
           ST_AsGeoJSON(f.path::geometry) as path_geojson,
           ROUND(ST_Length(f.path)::numeric) as length_m
    FROM fiber_routes f
    LEFT JOIN distribution_boxes fb ON fb.id=f.from_box_id
    LEFT JOIN distribution_boxes tb ON tb.id=f.to_box_id
    WHERE f.path IS NOT NULL`);
  const totals = await pool.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL)::int AS geocoded
    FROM subscribers s WHERE ${scopedAndBbox}`, subParams);
  const byStatus = await pool.query(`
    SELECT s.status, count(*)::int AS n FROM subscribers s WHERE ${scopedAndBbox}
    GROUP BY s.status ORDER BY n DESC`, subParams);
  const boxTotals = await pool.query('SELECT count(*)::int AS total FROM distribution_boxes');

  const toFeatureCollection = (features: any[]) => ({ type: 'FeatureCollection', features });
  const boxFeatures = boxes.rows.map((b: any) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(b.longitude), Number(b.latitude)] },
    properties: { ...b, kind: 'box' },
  }));
  const subFeatures = subs.rows.map((s: any) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(s.longitude), Number(s.latitude)] },
    properties: { ...s, kind: 'subscriber' },
  }));
  const routeFeatures = routes.rows.map((r: any) => ({
    type: 'Feature',
    geometry: r.path_geojson ? JSON.parse(r.path_geojson) : null,
    properties: { id: r.id, name: r.name, route_type: r.route_type, notes: r.notes,
      from_box_name: r.from_box_name, to_box_name: r.to_box_name, length_m: r.length_m, kind: 'fiber_route' },
  })).filter((f: any) => f.geometry);

  const totalSubs = totals.rows[0]?.total || 0;
  const geocodedSubs = totals.rows[0]?.geocoded || 0;
  const summary = {
    subscribers_total: totalSubs,
    subscribers_geocoded: geocodedSubs,
    geocoded_coverage_pct: totalSubs ? Math.round((geocodedSubs / totalSubs) * 100) : 0,
    by_status: Object.fromEntries(byStatus.rows.map((r: any) => [r.status || 'UNKNOWN', r.n])),
    boxes_total: boxTotals.rows[0]?.total || 0,
    boxes_mapped: boxes.rows.length,
    boxes_in_use: boxes.rows.filter((b: any) => Number(b.subscriber_count) > 0).length,
    capacity_ports: boxes.rows.reduce((a: number, b: any) => a + Number(b.capacity_ports || 0), 0),
    routes_total: routeFeatures.length,
    route_length_m: Math.round(routeFeatures.reduce((a: number, f: any) => a + Number(f.properties.length_m || 0), 0)),
    // True when the ?limit= cap hid geocoded subscribers from the map.
    truncated: geocodedSubs > limit,
  };

  res.json({
    boxes: toFeatureCollection(boxFeatures),
    subscribers: toFeatureCollection(subFeatures),
    fiberRoutes: toFeatureCollection(routeFeatures),
    summary,
    viewport: bbox ? { minLng: bbox[0], minLat: bbox[1], maxLng: bbox[2], maxLat: bbox[3] } : null,
  });
}));

/** Everything attached to one distribution box — subscribers and upstream routes.
 *  Powers the box details panel in the GIS workbench. */
router.get('/boxes/:id/details', asyncHandler(async (req, res) => {
  const scope = await subscriberScope(req);
  const scoped = scopeFor(scope);
  const boxIdParam = `$${scoped.params.length + 1}`;
  const box = await pool.query(`
    SELECT d.*, z.name as zone_name, a.name as area_name
    FROM distribution_boxes d
    LEFT JOIN zones z ON z.id=d.zone_id
    LEFT JOIN areas a ON a.id=z.area_id
    WHERE d.id=$1`, [req.params.id]);
  if (!box.rows[0]) return res.status(404).json({ message: 'Box not found' });
  const subs = await pool.query(`
    SELECT ${SUB_COLUMNS} FROM subscribers s ${SUB_JOINS}
    WHERE s.distribution_box_id=${boxIdParam} AND ${scoped.sql}
    ORDER BY s.full_name`, scoped.params.concat(req.params.id));
  const routes = await pool.query(`
    SELECT f.*, ST_AsGeoJSON(f.path::geometry) as path_geojson,
           ROUND(ST_Length(f.path)::numeric) as length_m
    FROM fiber_routes f WHERE f.from_box_id=$1 OR f.to_box_id=$1`, [req.params.id]);
  res.json({ box: box.rows[0], subscribers: subs.rows, routes: routes.rows });
}));

// Trace: subscriber -> box -> upstream routes. Explicit column allowlist and
// the same reseller scope as the overview — never SELECT * of a subscriber.
router.get('/trace/subscriber/:id', asyncHandler(async (req, res) => {
  const scope = await subscriberScope(req);
  const scoped = scopeFor(scope);
  const idParam = `$${scoped.params.length + 1}`;
  const s = await pool.query(`
    SELECT ${SUB_COLUMNS}, s.distribution_box_id, s.reseller_id, s.provisioning_mode
    FROM subscribers s ${SUB_JOINS}
    WHERE s.id=${idParam} AND ${scoped.sql}`, scoped.params.concat(req.params.id));
  if (!s.rows[0]) return res.status(404).json({ message: 'Subscriber not found' });
  const sub = s.rows[0];
  let routes: any[] = [];
  if (sub.distribution_box_id) {
    const r = await pool.query(`SELECT f.*, ST_AsGeoJSON(f.path::geometry) as path_geojson FROM fiber_routes f WHERE f.from_box_id=$1 OR f.to_box_id=$1`, [sub.distribution_box_id]);
    routes = r.rows;
  }
  res.json({ subscriber: sanitizeSubscriber(sub), routes });
}));

/** Currently online subscribers that have coordinates — powers the live
 *  session layer on the map. */
router.get('/live-sessions', asyncHandler(async (req, res) => {
  const scope = await subscriberScope(req);
  const scoped = scopeFor(scope);
  const r = await pool.query(`
    SELECT DISTINCT ON (s.id) s.id, s.client_code, s.full_name, s.status, s.latitude, s.longitude,
           ss.status as session_status, ss.rx_bps, ss.tx_bps, ss.ip_address, ss.updated_at
    FROM subscriber_sessions ss
    JOIN subscribers s ON s.id=ss.subscriber_id
    WHERE ${scoped.sql} AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
      AND upper(ss.status)='ONLINE'
    ORDER BY s.id, ss.updated_at DESC LIMIT 500`, scoped.params);
  res.json({ data: r.rows });
}));

/** Address -> coordinates via Nominatim (or GIS_GEOCODE_URL). Server-side so
 *  the browser doesn't depend on a third party directly; cached for 24h and
 *  throttled to respect the provider's usage policy. */
router.get('/geocode', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.status(400).json({ message: 'q must be at least 3 characters' });
  const cached = geocodeCache.get(q);
  if (cached && Date.now() - cached.at < 24 * 3600 * 1000) return res.json({ data: cached.data, cached: true });
  const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastGeocodeAt = Date.now();
  try {
    const url = `${GEOCODE_URL}?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'IzanDesk-GIS/1.0 (administrative geocoding)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) throw new Error(`provider returned ${resp.status}`);
    const rows: any[] = await resp.json() as any[];
    const data = rows.map(r => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon), type: r.type }))
      .filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
    if (geocodeCache.size > 200) geocodeCache.delete(geocodeCache.keys().next().value as string);
    geocodeCache.set(q, { at: Date.now(), data });
    res.json({ data });
  } catch (e: any) {
    res.status(502).json({ message: `Geocoding unavailable: ${e.message}` });
  }
}));

export default router;
