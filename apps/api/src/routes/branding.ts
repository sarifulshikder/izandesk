import { Router } from 'express';
import { pool } from '../db';
import { asyncHandler } from './helpers';

const router: Router = Router();

router.get('/resolve', asyncHandler(async (req, res) => {
  const host = String(req.query.host || req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().split(':')[0].toLowerCase();
  if (!host) return res.json({ ok: true, brand: null });
  const sub = host.split('.')[0];
  const r = await pool.query(
    `SELECT id, name, code, tier, subdomain, custom_domain, brand_name, logo_url, primary_color, secondary_color, portal_title, status
     FROM resellers WHERE lower(custom_domain)=lower($1) OR lower(subdomain)=lower($2) OR lower(subdomain)=lower($1) LIMIT 1`,
    [host, sub]
  );
  res.json({ ok: true, host, brand: r.rows[0] || null });
}));

export default router;
