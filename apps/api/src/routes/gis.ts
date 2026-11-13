import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';

const router: Router = Router();

router.get('/overview', asyncHandler(async (_req, res) => {
  const boxes = await pool.query(`
    SELECT d.id, d.name, d.code, d.box_type, d.capacity_ports, d.latitude, d.longitude, d.address,
           z.name as zone_name, a.name as area_name,
           (SELECT COUNT(*)::int FROM subscribers s WHERE s.distribution_box_id=d.id) as subscriber_count
    FROM distribution_boxes d
    LEFT JOIN zones z ON z.id=d.zone_id
    LEFT JOIN areas a ON a.id=z.area_id
    WHERE d.latitude IS NOT NULL AND d.longitude IS NOT NULL`);
  const subs = await pool.query(`
    SELECT s.id, s.client_code, s.full_name, s.status, s.connection_type, s.username, s.latitude, s.longitude, s.address,
           z.name as zone_name, a.name as area_name, d.name as distribution_box_name
    FROM subscribers s
    LEFT JOIN zones z ON z.id=s.zone_id
    LEFT JOIN areas a ON a.id=s.area_id
    LEFT JOIN distribution_boxes d ON d.id=s.distribution_box_id
    WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL`);
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

// Trace: subscriber -> box -> upstream routes
router.get('/trace/subscriber/:id', asyncHandler(async (req, res) => {
  const s = await pool.query(`SELECT s.*, d.id as box_id, d.name as box_name, d.latitude as box_lat, d.longitude as box_lng
    FROM subscribers s LEFT JOIN distribution_boxes d ON d.id=s.distribution_box_id WHERE s.id=$1`, [req.params.id]);
  if (!s.rows[0]) return res.status(404).json({ message: 'Subscriber not found' });
  const sub = s.rows[0];
  let routes: any[] = [];
  if (sub.box_id) {
    const r = await pool.query(`SELECT f.*, ST_AsGeoJSON(f.path::geometry) as path_geojson FROM fiber_routes f WHERE f.from_box_id=$1 OR f.to_box_id=$1`, [sub.box_id]);
    routes = r.rows;
  }
  res.json({ subscriber: sub, routes });
}));

export default router;
