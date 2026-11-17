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

/** Guard against an unbounded payload when a deployment has many geocoded
 *  subscribers. Callers may raise it via ?limit= but never beyond 10000. */
function mapLimit(req: any): number {
  return Math.min(10000, Math.max(1, Number(req.query.limit) || 5000));
}

const SUB_COLUMNS = `s.id, s.client_code, s.full_name, s.status, s.connection_type, s.username,
  s.latitude, s.longitude, s.address, z.name as zone_name, a.name as area_name,
  d.name as distribution_box_name`;

router.get('/overview', asyncHandler(async (req, res) => {
  const scope = await subscriberScope(req);
  const subWhere = scope.restricted ? (scope.uuid ? 'AND s.reseller_id=$1' : 'AND FALSE') : '';
  const params: any[] = scope.restricted && scope.uuid ? [scope.uuid] : [];
  params.push(mapLimit(req));

  const boxes = await pool.query(`
    SELECT d.id, d.name, d.code, d.box_type, d.capacity_ports, d.latitude, d.longitude, d.address,
           z.name as zone_name, a.name as area_name,
           (SELECT COUNT(*)::int FROM subscribers s WHERE s.distribution_box_id=d.id ${scope.uuid ? 'AND s.reseller_id=$1' : ''}) as subscriber_count
    FROM distribution_boxes d
    LEFT JOIN zones z ON z.id=d.zone_id
    LEFT JOIN areas a ON a.id=z.area_id
    WHERE d.latitude IS NOT NULL AND d.longitude IS NOT NULL`, params.slice(0, scope.uuid ? 1 : 0));
  const subs = await pool.query(`
    SELECT ${SUB_COLUMNS}
    FROM subscribers s
    LEFT JOIN zones z ON z.id=s.zone_id
    LEFT JOIN areas a ON a.id=s.area_id
    LEFT JOIN distribution_boxes d ON d.id=s.distribution_box_id
    WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL ${subWhere}
    ORDER BY s.id LIMIT $${params.length}`, params);
  const routes = await pool.query(`
    SELECT f.id, f.name, f.route_type, f.notes, fb.name as from_box_name, tb.name as to_box_name,
           ST_AsGeoJSON(f.path::geometry) as path_geojson
    FROM fiber_routes f
    LEFT JOIN distribution_boxes fb ON fb.id=f.from_box_id
    LEFT JOIN distribution_boxes tb ON tb.id=f.to_box_id
    WHERE f.path IS NOT NULL`);

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
    properties: { id: r.id, name: r.name, route_type: r.route_type, notes: r.notes, from_box_name: r.from_box_name, to_box_name: r.to_box_name, kind: 'fiber_route' },
  })).filter((f: any) => f.geometry);

  res.json({
    boxes: toFeatureCollection(boxFeatures),
    subscribers: toFeatureCollection(subFeatures),
    fiberRoutes: toFeatureCollection(routeFeatures),
  });
}));

// Trace: subscriber -> box -> upstream routes. Explicit column allowlist and
// the same reseller scope as the overview — never SELECT * of a subscriber.
router.get('/trace/subscriber/:id', asyncHandler(async (req, res) => {
  const scope = await subscriberScope(req);
  const scopeClause = scope.restricted ? (scope.uuid ? 'AND s.reseller_id=$2' : 'AND FALSE') : '';
  const params: any[] = [req.params.id];
  if (scope.restricted && scope.uuid) params.push(scope.uuid);
  const s = await pool.query(`
    SELECT ${SUB_COLUMNS}, s.distribution_box_id, s.reseller_id, s.provisioning_mode
    FROM subscribers s LEFT JOIN distribution_boxes d ON d.id=s.distribution_box_id
    WHERE s.id=$1 ${scopeClause}`, params);
  if (!s.rows[0]) return res.status(404).json({ message: 'Subscriber not found' });
  const sub = s.rows[0];
  let routes: any[] = [];
  if (sub.distribution_box_id) {
    const r = await pool.query(`SELECT f.*, ST_AsGeoJSON(f.path::geometry) as path_geojson FROM fiber_routes f WHERE f.from_box_id=$1 OR f.to_box_id=$1`, [sub.distribution_box_id]);
    routes = r.rows;
  }
  res.json({ subscriber: sanitizeSubscriber(sub), routes });
}));

export default router;
